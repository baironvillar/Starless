//! Real playback.
//!
//! **Audio never touches the webview.** `rodio` opens the output device through
//! cpal, which on Windows is WASAPI, and decoded PCM is pushed straight into it
//! from a librespot thread. No sample crosses a command boundary, so there is no
//! base64 round trip per buffer and no way for the UI to stall the audio.
//!
//! The player is created lazily, once, on the first request to make a sound.
//! Opening an output device before the user has asked for anything is a rude
//! thing for an app to do at launch.

use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
};

use librespot_core::{Session, SpotifyId, SpotifyUri};
use librespot_playback::{
    config::{AudioFormat, PlayerConfig},
    mixer::VolumeGetter,
    player::{Player, PlayerEvent},
};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::auth;

/// How often the player reports its position. Fast enough for a smooth seek bar,
/// slow enough that the UI is not repainting several times a second for a number
/// that changes in seconds anyway.
const POSITION_INTERVAL_MS: u64 = 500;

/// How often the state is allowed to travel to the webview while a value that
/// changes on every pointer event is moving.
///
/// The volume is the one value that moves fifty times a second, and the status
/// it travels in is the whole status — which lands in the root component's
/// state and re-renders the app. A hundred milliseconds is fast enough for
/// anything the eye compares between two frames, and slow enough that the
/// webview's thread is free for the pointer that is asking.
const STATUS_ECHO_MS: u64 = 100;

const MAX_VOLUME: u16 = 65535;

/// How long the player can stay quiet before the app stops believing it.
///
/// While the audio flows the position moves twice a second. Twenty seconds of
/// it not moving is not a quiet moment: it is a player that stopped answering,
/// and a player that stopped answering is worse than a dead one — a dead one
/// is visible (`is_invalid` says so) and a silent one looks exactly like a
/// working one.
const STALL_AFTER: std::time::Duration = std::time::Duration::from_secs(20);

/// How long a load can take before the app stops believing it.
///
/// A load is a round trip to Spotify plus a decryption: half a second is
/// normal and a slow network can make it several. A quarter of a minute means
/// the command was never executed, not that the network is slow.
const LOAD_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(25);

/// How often the app looks at the player.
const WATCHDOG_INTERVAL: std::time::Duration = std::time::Duration::from_secs(2);

/// What the webview is allowed to know about playback.
///
/// A number and a flag. Not a buffer of samples, not a file handle, not a track
/// the backend is mid-way through decrypting.
#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackStatus {
    pub available: bool,
    pub track_id: Option<String>,
    /// True only once librespot says audio is actually flowing.
    pub playing: bool,
    /// Set between `play` and the first `Playing` event. Decryption and fetching
    /// a track takes a moment, and during it nothing is audible — so reporting
    /// "playing" here would be showing the user a claim we have not verified.
    pub loading: bool,
    pub position_ms: u32,
    pub duration_ms: u32,
    /// 0..=65535, matching librespot's own scale. The UI maps it to 0..=100.
    pub volume: u16,
    /// The track ran to its end and nothing replaced it.
    ///
    /// Distinct from `playing == false`, which also means paused. The UI has to
    /// tell those apart: a pause is the user holding a button, an ended track is
    /// the app asking to be told what comes next. Without this field the UI sees
    /// the same state twice and either auto-advances when the user pauses, or
    /// sits silent when a song finishes.
    pub finished: bool,
    pub error: Option<String>,
}

/// The volume, as the player sees it: untouched.
///
/// **The player attenuates before the audio is queued, and that is a whole
/// queue too early.** The sink of this app keeps up to 26 packets waiting —
/// almost 700 ms of music — and the packets that were already waiting carry
/// the volume they had when they were decoded. A volume change therefore took
/// as long as the queue took to drain, and in the last seconds of a song, when
/// the crossfade lets the queue grow to hold the whole ending, it took
/// *seconds*.
///
/// So the player hands the audio over untouched and the sink attenuates each
/// sample as it leaves the queue: the change is heard in the next sample.
///
/// The mapping itself is quadratic on purpose: a linear slider spends most of
/// its travel in a range where you cannot hear the difference, and then a
/// user who wants "half volume" sets it to 25% and concludes the app is
/// quiet. See `apply_volume`.
struct Unattenuated;

impl VolumeGetter for Unattenuated {
    fn attenuation_factor(&self) -> f64 {
        1.0
    }
}

#[derive(Default)]
pub struct PlaybackState {
    player: Mutex<Option<Arc<Player>>>,
    /// `f64` bits of the current attenuation factor.
    attenuation: Arc<AtomicU64>,
    status: Mutex<PlaybackStatus>,
    /// When the current `load` was asked for.
    ///
    /// Exists to answer one question with a number instead of an opinion: how long
    /// between the click and the first sample. Almost all of it is Spotify's round
    /// trips, and without this the only way to find that out is to guess which layer
    /// to blame — which is how a network wait gets "optimised" in the wrong place.
    requested_at: Mutex<Option<std::time::Instant>>,
    /// Whether a reconnection is already on its way.
    ///
    /// A dead session produces one `Unavailable` per track, and the app asks
    /// for the next one every time. Without this the app would open a session
    /// per failed track, and a machine with no network would open them
    /// forever.
    reconnecting: AtomicBool,
    /// How many reconnections have been tried since the last track that played.
    ///
    /// The counter is reset by the first track that plays, so a session that
    /// comes back and dies again next week starts from zero. What it stops is
    /// a loop *inside* one outage.
    reconnects: AtomicU32,
    /// Which player the state belongs to.
    ///
    /// Every player gets a number, and the number is what says whether an
    /// event is about the player that is running now or about one that was
    /// left behind. A player that stopped answering is not thrown away — it
    /// is parked inside the audio device and cannot be thrown away — and its
    /// events keep coming for a while. Applying them would put the old song's
    /// position on top of the new one's.
    generation: AtomicU32,
    /// Whether the player is holding no track at all.
    ///
    /// **This is what makes "play" and "play again" different commands.**
    /// `Player::play` only does something from `Paused` or `Loading`: from
    /// `Stopped` or `EndOfTrack` librespot answers with an error and silence.
    /// And the player is left in exactly those two states by two ordinary
    /// things —the DJ, who needs the silence to say its line, and a track that
    /// ran to its end—. So the app has to know which of the two it is in,
    /// because "play" after either of them means "load the track again" and
    /// not "carry on".
    holds_no_track: AtomicBool,
    /// The track the user asked for while the session was being rebuilt.
    ///
    /// The reconnection takes a couple of seconds —a handshake with Spotify— and
    /// the user does not stop clicking during it. The last request is the one
    /// that plays: the song somebody asked for is not the song that happened
    /// to fail.
    requested: Mutex<Option<(String, u32)>>,
}

impl PlaybackState {
    /// How long since the current track was asked for, if it is still in flight.
    fn pending_ms(&self) -> Option<u128> {
        self.requested_at
            .lock()
            .ok()
            .and_then(|guard| *guard)
            .map(|at| at.elapsed().as_millis())
    }
    fn apply_volume(&self, volume: u16) -> u16 {
        let volume = volume.min(MAX_VOLUME);
        let linear = f64::from(volume) / f64::from(MAX_VOLUME);
        self.attenuation
            .store(linear.powi(2).to_bits(), Ordering::Relaxed);
        volume
    }

    fn player(&self) -> Option<Arc<Player>> {
        self.player.lock().ok().and_then(|guard| guard.clone())
    }

    /// A live player, or the reason there isn't one.
    ///
    /// The distinction matters because librespot's `rodio` backend opens the output
    /// device with a bare `.unwrap()`. When that fails the sink thread panics,
    /// `Player`'s command channel has no receiver left, and every later `load()`
    /// returns without doing anything at all — silently. From the outside that is
    /// indistinguishable from a track Spotify will not serve: the user clicks, the
    /// app does nothing, and nothing is written anywhere.
    ///
    /// `is_invalid` reports the dead thread, so the failure can finally be named
    /// instead of inferred from silence. The dead player is dropped so the next
    /// attempt rebuilds it — a device that was busy a second ago may not be now.
    fn live_player(&self) -> Result<Arc<Player>, String> {
        let Some(player) = self.player() else {
            return Err(auth::fail("no_player", "no hay player"));
        };
        if player.is_invalid() {
            if let Ok(mut guard) = self.player.lock() {
                *guard = None;
            }
            return Err(auth::fail(
                "audio_device_failed",
                "el hilo de audio murió al abrir el dispositivo de salida",
            ));
        }
        Ok(player)
    }

    fn mutate(&self, change: impl FnOnce(&mut PlaybackStatus)) {
        if let Ok(mut guard) = self.status.lock() {
            change(&mut guard);
        }
    }

    pub fn status(&self) -> PlaybackStatus {
        self.status.lock().map(|g| g.clone()).unwrap_or_default()
    }
}

/// Create the player, once, against a live session.
///
/// Returns quietly if there is already one: the session is rebuilt on every
/// launch, but the audio device should not be reopened under a track that is
/// already playing.
pub fn ensure_player(app: &AppHandle, session: &Session) {
    let Some(state) = app.try_state::<PlaybackState>() else {
        return;
    };
    if state.player().is_some() {
        return;
    }

    let started = std::time::Instant::now();
    build_player(app, &state, session);
    log::info!("dispositivo de audio abierto en {} ms", started.elapsed().as_millis());
}

/// Open the output device on its own time, before anything is asked to play.
///
/// Opening a WASAPI device is not free, and doing it inside the click that starts
/// music puts it squarely on the path between "the user pressed something" and "the
/// user hears something". The device has to exist before anyone asks, not when they
/// ask — and holding it open before it is needed is not a cost either: it is a
/// handle on hardware the account already owns.
///
/// Blocking. Call it from a blocking thread.
pub fn warm_audio_device(app: &AppHandle, session: Session) {
    // `AppHandle` is cheap to clone and owns what it points at, which is what lets
    // this outlive the closure it was handed to.
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || ensure_player(&app, &session));
}

fn build_player(app: &AppHandle, state: &PlaybackState, session: &Session) {
    let mut config = PlayerConfig::default();
    config.position_update_interval = Some(std::time::Duration::from_millis(POSITION_INTERVAL_MS));

    // La voz del DJ lee esta misma atenuación, así que el volumen de la app
    // es el volumen de la voz. Sin esto, mutear la app callaba la música y
    // dejaba al DJ hablando.
    crate::voice::publish_attenuation(state.attenuation.clone());
    // Y la música la lee el sink, cuando el audio sale de la cola: atenuado
    // antes de encolarse, el cambio de volumen tardaba lo que la cola tarda
    // en vaciarse en llegar al oído.
    crate::crossfade::publish_attenuation(state.attenuation.clone());
    crate::crossfade::set_seconds(u32::from(crate::settings::saved_crossfade_seconds()));

    let player = Player::new(
        config,
        session.clone(),
        Box::new(Unattenuated),
        // El sink es de Starless y no de librespot.
        //
        // El de librespot no deja ver el `Mixer` del stream, y sin ese mixer la
        // voz del DJ tendría que abrir un segundo stream en el mismo
        // dispositivo —y en Windows dos clientes del mismo WASAPI se pelean,
        // y el que pierde le pasa sus bytes al otro. Con el sink propio, la
        // música y la voz salen por la misma salida. Ver `voice.rs`.
        move || crate::voice::build_sink(None, AudioFormat::F32),
    );

    if let Ok(mut guard) = state.player.lock() {
        *guard = Some(player.clone());
    }
    // Open at the volume the user last chose, not at full scale.
    //
    // `Player::new` starts at maximum, and every launch used to be a fresh maximum:
    // set the music to half at night, reopen the app in the morning, and it is
    // suddenly loud. A setting that resets itself once per launch is a setting the
    // user has to redo forever, so it gets remembered. `None` on a first run keeps
    // the old behaviour rather than inventing a default the user did not ask for.
    let opening_volume = crate::settings::saved_volume();
    state.mutate(|s| {
        s.available = true;
        s.volume = state.apply_volume(opening_volume.unwrap_or(MAX_VOLUME));
    });
    log::info!("player creado (backend rodio)");

    // El frontend tiene que saber el volumen **antes** de que suene nada.
    //
    // Los eventos del player llegan cuando el player hace algo, y el primero
    // puede no llegar nunca: el DJ habla por el mixer y el player ni se
    // entera. Sin este aviso, la barra muestra "silenciado" y el control en
    // el mínimo mientras el DJ habla a todo volumen —el sonido estaba, la
    // pantalla mentía—.
    let _ = app.emit("player://status", state.status());

    forward_events(app.clone(), player, state.generation.load(Ordering::Relaxed));
}

/// Watch the player, and notice when it stops answering.
///
/// **This exists because of a failure that looks like nothing happening.**
/// librespot's rodio sink waits for the output device inside `write`, in a
/// loop with no end: `while self.rodio_sink.len() > 26 { sleep(10ms) }`. If
/// the device stops consuming, the player thread stays there forever. It is
/// not dead — `is_invalid` says alive, because the thread is running — it is
/// just never coming back to the loop that reads commands. The app sends a
/// command, the command waits in the channel, and nothing happens: no
/// `PlayRequestIdChanged`, no `Loading`, no `EndOfTrack`, no position. The
/// window looks perfect and the music is gone.
///
/// So the app asks the one question the player cannot answer: has the
/// position moved? If it has not, for long enough that no slow device could
/// explain it, the player is stuck and the app goes and builds another one.
pub fn watch(app: AppHandle) {
    // A development tool: `STARLESS_STALL_TEST=1` forces one stall recovery
    // twenty seconds in, so the recovery can be tried without waiting for a
    // device that really stops answering.
    #[cfg(debug_assertions)]
    let forced = forced_stall_requested();
    #[cfg(not(debug_assertions))]
    let forced = false;

    std::thread::spawn(move || {
        let started = std::time::Instant::now();
        let mut forced_done = !forced;
        let mut last_position: Option<u32> = None;
        let mut last_change = std::time::Instant::now();
        let mut last_tick = last_change;

        loop {
            std::thread::sleep(WATCHDOG_INTERVAL);
            let now = std::time::Instant::now();

            // The machine was asleep. The clock jumped, and nothing that
            // happened during the sleep can be called a stall — a connection
            // that died while the laptop was closed has its own way of
            // noticing, and the player is not the one to blame for it.
            if now.duration_since(last_tick) > WATCHDOG_INTERVAL * 4 {
                last_tick = now;
                last_change = now;
                last_position = None;
                continue;
            }
            last_tick = now;

            if !forced_done
                && now.duration_since(started) >= std::time::Duration::from_secs(20)
            {
                forced_done = true;
                log::warn!("[audio_stalled] STARLESS_STALL_TEST: simulando un player trabado");
                recover_from_stall(&app, "prueba manual (STARLESS_STALL_TEST)");
                continue;
            }

            let Some(state) = app.try_state::<PlaybackState>() else {
                return;
            };
            // No player, nothing to watch.
            if state.player().is_none() {
                continue;
            }

            let status = state.status();

            if status.playing {
                match last_position {
                    // The position did not move since the last look.
                    Some(previous) if previous == status.position_ms => {
                        if now.duration_since(last_change) > STALL_AFTER {
                            recover_from_stall(&app, "la posición no avanza");
                            last_change = now;
                        }
                    }
                    // It moved, or this is the first look: the player is alive.
                    _ => {
                        last_position = Some(status.position_ms);
                        last_change = now;
                    }
                }
                continue;
            }

            if status.loading
                && state
                    .pending_ms()
                    .is_some_and(|ms| ms > LOAD_TIMEOUT.as_millis() as u128)
            {
                recover_from_stall(&app, "la carga no terminó");
            }

            last_position = None;
            last_change = now;
        }
    });
}

/// `true` when the environment asks for a forced stall. Read once, at startup.
///
/// A device that stops answering is not something anybody can reproduce on
/// purpose, so the recovery would otherwise only be testable the day it
/// happens to a real person. `STARLESS_STALL_TEST=1` forces it, twenty
/// seconds in.
///
/// It is compiled out of release: the gate is the build, not the branch.
#[cfg(debug_assertions)]
fn forced_stall_requested() -> bool {
    std::env::var("STARLESS_STALL_TEST")
        .map(|value| value != "0" && !value.is_empty())
        .unwrap_or(false)
}

/// The player stopped answering. Build another one.
///
/// Three things happen here, and the order is the point:
///
/// 1. The player that stopped answering is left behind — not dropped, because
///    dropping one joins its thread, and that thread is parked inside the
///    audio device. It is told to stop first, so that a player which wakes up
///    later silences itself instead of pushing the rest of an old song into a
///    device that by then belongs to somebody else.
/// 2. The session is rebuilt. Not because the session is the problem — it may
///    be perfectly fine — but because the stuck player is still holding the
///    device, and the only thing that makes it quiet is having nothing left
///    to fetch. A session that is gone leaves it with silence.
/// 3. A new player is built on the new session, and the track goes back on.
fn recover_from_stall(app: &AppHandle, reason: &str) {
    let Some(state) = app.try_state::<PlaybackState>() else {
        return;
    };

    // One at a time. The dead-connection path (`schedule_reconnect`) uses the
    // same flag: a stall and a dropped session are the same kind of trouble
    // and they must not both be rebuilding at once.
    if state.reconnecting.swap(true, Ordering::SeqCst) {
        return;
    }

    if state.reconnects.fetch_add(1, Ordering::Relaxed) >= MAX_RECONNECTS {
        log::error!("[audio_stalled] se agotaron los reintentos ({reason})");
        state.mutate(|s| {
            s.playing = false;
            s.loading = false;
            s.error = Some("audio_device_failed".into());
        });
        state.reconnecting.store(false, Ordering::SeqCst);
        return;
    }

    log::error!("[audio_stalled] el player dejó de responder: {reason}");

    state.mutate(|s| {
        s.playing = false;
        s.loading = false;
        s.error = Some("audio_stalled".into());
    });

    // The old player's events stop counting from here: the state belongs to
    // the player that is coming.
    state.generation.fetch_add(1, Ordering::SeqCst);

    let old = state
        .player
        .lock()
        .ok()
        .and_then(|mut guard| guard.take());
    if let Some(player) = old {
        abandon(player);
    }

    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        rebuild_after_stall(&app);
    });
}

/// Put the player back together after it stopped answering.
///
/// Blocking: it waits for the handshake. It runs on its own thread.
fn rebuild_after_stall(app: &AppHandle) {
    let Some(state) = app.try_state::<PlaybackState>() else {
        return;
    };

    let session = match auth::open_cache().and_then(|cache| auth::connect_now(&cache)) {
        Ok(session) => session,
        Err(error) => {
            log::error!("[audio_stalled] no se pudo abrir una sesión nueva: {error}");
            state.mutate(|s| s.error = Some("connection_lost".into()));
            state.reconnecting.store(false, Ordering::SeqCst);
            return;
        }
    };

    // The new session takes the old one's place, and the old one is shut down:
    // the player that is stuck is still using it, and a session that is gone
    // leaves that player with nothing to fetch.
    install_session(app, &session);

    // And a new player, on the new session.
    ensure_player(app, &session);

    // The device could not be opened: the audio thread died on it. librespot
    // opens the output device with a bare `unwrap`, so a device that is not
    // there takes the thread down with it — and the thread needs a moment to
    // get that far.
    std::thread::sleep(std::time::Duration::from_millis(150));
    if state.player().is_some_and(|player| player.is_invalid()) {
        log::error!("[audio_stalled] el dispositivo de salida no se pudo abrir");
        state.mutate(|s| {
            s.playing = false;
            s.loading = false;
            s.error = Some("audio_device_failed".into());
        });
        state.reconnecting.store(false, Ordering::SeqCst);
        return;
    }

    // The track that was playing goes back on, from the beginning: it stopped
    // in the middle and there is no position to come back to.
    let status = state.status();
    if let Some(track_id) = status.track_id
        && let Err(error) = play(&state, &track_id, 0, status.duration_ms)
    {
        log::error!("[audio_stalled] no se pudo volver a cargar la pista: {error}");
        state.mutate(|s| s.error = Some("audio_device_failed".into()));
    }

    state.reconnecting.store(false, Ordering::SeqCst);
}

/// Leave a player behind without waiting for it.
///
/// `Player::drop` joins the player thread, and a thread that is parked inside
/// the audio device does not come back on its own: joining it would freeze
/// the app for good, on whatever thread happened to drop it. So the player is
/// forgotten instead of dropped — the thread stays where it is, the device
/// handle stays with it, and the app goes on with a new one.
///
/// The `stop` goes first, so a player that wakes up later silences itself
/// instead of pushing the rest of an old song into a device that by then
/// belongs to somebody else.
fn abandon(player: Arc<Player>) {
    player.stop();
    std::mem::forget(player);
}

/// librespot reports on its own task; the webview gets a coarse summary.
fn forward_events(app: AppHandle, player: Arc<Player>, generation: u32) {
    let mut receiver = player.get_player_event_channel();

    tauri::async_runtime::spawn(async move {
        // Whether this player was left behind on purpose. A player that is
        // parked inside the audio device must not be dropped here: dropping it
        // joins its thread, and that thread is not coming back.
        let mut left_behind = false;
        // When the last status went out to the webview. A drag is a flood and
        // the echo does not have to travel at the speed of the hand.
        let mut last_echo: Option<std::time::Instant> = None;

        while let Some(event) = receiver.recv().await {
            let Some(state) = app.try_state::<PlaybackState>() else {
                // The app is going away. Whatever happens to the player thread
                // now is not this task's problem, and waiting for it could
                // freeze a runtime worker for good.
                left_behind = true;
                break;
            };

            // A player that was replaced is not the player the state belongs
            // to. Its events are about a device that is no longer ours, and
            // applying them would put the old song's position on top of the
            // new one's.
            if state.generation.load(Ordering::Relaxed) != generation {
                left_behind = true;
                break;
            }

            // Every event is recorded, including the boring ones. The interesting
            // failure ("click, nothing happens") is usually absent from the log
            // entirely, and the event that *would* have explained it is the one
            // that never arrives — so the absence is itself the evidence.
            match &event {
                PlayerEvent::Unavailable { track_id, .. } => {
                    // Is this the track's fault, or is there nobody left to ask
                    // it for the decryption key?
                    //
                    // librespot gives up on a dead connection and **never comes
                    // back on its own** — its keep-alive marks the session invalid
                    // and stops, with a `TODO: Optionally reconnect` where the
                    // reconnect would go. After that every track fails, and it
                    // fails the worst possible way: the key request times out and
                    // instead of refusing, librespot plays the file *undecrypted*
                    // on the assumption that "not all audio files are encrypted".
                    // Symphonia is then handed ciphertext, calls it junk, and the
                    // track comes back unavailable.
                    //
                    // So one dead connection was being reported six times in
                    // fourteen seconds as six songs Spotify would not deliver —
                    // a diagnosis that points at the one place the problem is
                    // not. `is_invalid` is the public answer to "is the session
                    // still there", and it is the only signal that tells those
                    // two cases apart.
                    // One closure, one `bool`: the `MutexGuard` cannot outlive the
                    // borrow of the `State` that owns it, so the whole question is
                    // asked and answered inside.
                    let session_gone = app
                        .try_state::<crate::SessionState>()
                        .map(|state| {
                            state
                                .0
                                .lock()
                                .ok()
                                .and_then(|guard| guard.as_ref().map(|s| s.is_invalid()))
                                .unwrap_or(false)
                        })
                        .unwrap_or(false);

                    if session_gone {
                        log::error!("[connection_lost] {track_id}: la sesión de reproducción ya no está");
                        // Stop instead of letting librespot walk the queue. Every
                        // remaining track would fail identically and each one
                        // would overwrite the message with a worse one.
                        player.stop();
                        state.mutate(|s| {
                            s.playing = false;
                            s.loading = false;
                            s.error = Some("reconnecting".into());
                        });
                        // And then go and get the session back.
                        //
                        // The message on screen is the truth about what is
                        // happening: this is not a track that cannot be played,
                        // it is a connection that has to be rebuilt. The track
                        // that failed goes back on when it is up.
                        schedule_reconnect(&app, track_id, state.status().duration_ms);
                    } else {
                        log::error!("[track_unavailable] {track_id}");
                        state.mutate(|s| {
                            s.playing = false;
                            s.loading = false;
                            s.error = Some("track_unavailable".into());
                        });
                    }
                }
                PlayerEvent::Loading { .. } => {
                    state.holds_no_track.store(false, Ordering::Relaxed);
                    state.mutate(|s| {
                        s.loading = true;
                        s.playing = false;
                    })
                }
                PlayerEvent::PlayRequestIdChanged { play_request_id } => {
                    crate::crossfade::request_changed(*play_request_id);
                }
                PlayerEvent::Playing {
                    position_ms,
                    play_request_id,
                    ..
                } => {
                    crate::crossfade::position(*play_request_id, *position_ms);
                    // Audio is flowing, so whatever outage came before this one
                    // is over. The reconnect counter starts from zero again:
                    // what it bounds is a loop inside one outage, not the
                    // number of times the connection may die in a month.
                    state.reconnects.store(0, Ordering::Relaxed);
                    state.holds_no_track.store(false, Ordering::Relaxed);
                    if let Some(ms) = state.pending_ms() {
                        log::info!("primera muestra tras {ms} ms");
                    }
                    if let Ok(mut guard) = state.requested_at.lock() {
                        *guard = None;
                    }
                    state.mutate(|s| {
                        s.playing = true;
                        s.loading = false;
                        s.finished = false;
                        s.error = None;
                        s.position_ms = *position_ms;
                    })
                }
                // A paused player still holds its track, so "play" on it means
                // "carry on" and librespot's `Player::play` does the right
                // thing without help.
                PlayerEvent::Paused { .. } => {
                    state.holds_no_track.store(false, Ordering::Relaxed);
                    state.mutate(|s| s.playing = false)
                }
                // And these two leave the player with nothing in it. The DJ
                // stops it to have the silence, and a track that ran to its
                // end leaves it there. `Player::play` refuses both, so the
                // play button has to load the track again instead.
                PlayerEvent::Stopped { .. } => {
                    state.holds_no_track.store(true, Ordering::Relaxed);
                    state.mutate(|s| {
                        s.playing = false;
                        s.loading = false;
                        s.finished = false;
                        s.position_ms = 0;
                    })
                }
                PlayerEvent::EndOfTrack { .. } => {
                    state.holds_no_track.store(true, Ordering::Relaxed);
                    state.mutate(|s| {
                        s.playing = false;
                        s.loading = false;
                        s.finished = true;
                    })
                }
                PlayerEvent::PositionChanged {
                    position_ms,
                    play_request_id,
                    ..
                }
                | PlayerEvent::Seeked {
                    position_ms,
                    play_request_id,
                    ..
                }
                | PlayerEvent::PositionCorrection {
                    position_ms,
                    play_request_id,
                    ..
                } => {
                    crate::crossfade::position(*play_request_id, *position_ms);
                    state.mutate(|s| s.position_ms = *position_ms)
                }
                PlayerEvent::VolumeChanged { volume } => state.mutate(|s| s.volume = *volume),
                PlayerEvent::SessionDisconnected { .. } => state.mutate(|s| {
                    s.playing = false;
                    s.loading = false;
                    s.error = Some("session_dropped".into());
                }),
                PlayerEvent::SessionConnected { user_name, .. } => {
                    log::info!("sesión de reproducción conectada como {user_name}");
                }
                _ => {}
            }

            // `PositionChanged` arrives twice a second; the others are rare enough
            // to be worth having in full.
            if !matches!(event, PlayerEvent::PositionChanged { .. }) {
                log::info!("evento de player: {}", describe(&event));
            }

            // **A drag is an avalanche, and the echo does not have to be.**
            //
            // The volume changes on every step of a thumb —fifty times a
            // second— and every one of those used to push the whole status to
            // the webview, where it lands in the root component's state and
            // **re-renders the whole app**. The webview's thread is then
            // spending its time on the app instead of on the pointer that is
            // asking, and the thumb ends up trailing the cursor: the slider
            // that was supposed to follow the hand was the thing making the
            // hand late.
            //
            // The thumb does not need the echo — it knows what it asked for —
            // so the volume's echo goes out at a human pace. Everything else
            // is rare enough to go out as it happens.
            let is_volume = matches!(event, PlayerEvent::VolumeChanged { .. });
            let due = match last_echo {
                Some(at) => at.elapsed() >= std::time::Duration::from_millis(STATUS_ECHO_MS),
                None => true,
            };
            if !is_volume || due {
                last_echo = Some(std::time::Instant::now());
                let _ = app.emit("player://status", state.status());
            }
        }

        if left_behind {
            // The player was left behind on purpose. Dropping it here would
            // join a thread that may be parked inside the audio device, and
            // that thread is not coming back: the join would never return.
            std::mem::forget(player);
        } else {
            log::warn!("el canal de eventos del player se cerró");
        }
    });
}

/// librespot's `PlayerEvent` derives `Debug`, but a `Debug` dump of an event that
/// failed to play says nothing about *why*. `Unavailable` in particular carries
/// no reason at all; the real one is in `librespot_core::audio_key`'s log line,
/// which is why the logger is not optional.
fn describe(event: &PlayerEvent) -> &'static str {
    match event {
        PlayerEvent::PlayRequestIdChanged { .. } => "PlayRequestIdChanged",
        PlayerEvent::Stopped { .. } => "Stopped",
        PlayerEvent::Loading { .. } => "Loading",
        PlayerEvent::Preloading { .. } => "Preloading",
        PlayerEvent::Playing { .. } => "Playing",
        PlayerEvent::Paused { .. } => "Paused",
        PlayerEvent::TimeToPreloadNextTrack { .. } => "TimeToPreloadNextTrack",
        PlayerEvent::EndOfTrack { .. } => "EndOfTrack",
        PlayerEvent::Unavailable { .. } => "Unavailable",
        PlayerEvent::VolumeChanged { .. } => "VolumeChanged",
        PlayerEvent::PositionCorrection { .. } => "PositionCorrection",
        PlayerEvent::PositionChanged { .. } => "PositionChanged",
        PlayerEvent::Seeked { .. } => "Seeked",
        PlayerEvent::TrackChanged { .. } => "TrackChanged",
        PlayerEvent::SessionConnected { .. } => "SessionConnected",
        PlayerEvent::SessionDisconnected { .. } => "SessionDisconnected",
        PlayerEvent::SessionClientChanged { .. } => "SessionClientChanged",
        PlayerEvent::ShuffleChanged { .. } => "ShuffleChanged",
        PlayerEvent::RepeatChanged { .. } => "RepeatChanged",
        PlayerEvent::AutoPlayChanged { .. } => "AutoPlayChanged",
        PlayerEvent::FilterExplicitContentChanged { .. } => "FilterExplicitContentChanged",
    }
}

/// A Spotify track id is base62; librespot wants a typed URI.
fn track_uri(track_id: &str) -> Result<SpotifyUri, String> {
    let id = SpotifyId::from_base62(track_id)
        .map_err(|e| auth::fail("bad_track_id", format!("{track_id}: {e}")))?;
    Ok(SpotifyUri::Track { id })
}

pub fn play(
    state: &PlaybackState,
    track_id: &str,
    position_ms: u32,
    duration_ms: u32,
) -> Result<(), String> {
    let player = state.live_player()?;
    let uri = track_uri(track_id)?;

    // **Una cola congelada por una pausa no se descongela acá.** Descongelarla
    // aquí volvía a poner a sonar la canción de antes encima de la nueva: la
    // cola congelada es la de la canción vieja, y la nueva entra en una cola
    // nueva —eso lo hace `before_load`—.

    let started = std::time::Instant::now();
    log::info!("play {track_id} @ {position_ms}ms");
    if let Ok(mut guard) = state.requested_at.lock() {
        *guard = Some(started);
    }

    // The previous track ending on its own is the one case that crossfades:
    // the frontend asks for the next track while the status still says
    // `finished`. A click, a pick from search or a reconnection does not —
    // what the user asked for plays now. In a crossfade the next track comes
    // in a little way in, so the position may move.
    let position_ms =
        crate::crossfade::before_load(state.status().finished, duration_ms, position_ms);

    // Set before `load`, not from the event: the event carries a URI, converting
    // it back to the id the UI already had is work with no purpose.
    state.mutate(|s| {
        s.track_id = Some(track_id.to_string());
        s.duration_ms = duration_ms;
        s.position_ms = position_ms;
        // Deliberately NOT `playing`. librespot still has to fetch, decrypt and
        // start the stream; until it says so, nothing is audible.
        s.playing = false;
        s.loading = true;
        s.finished = false;
        s.error = None;
    });

    // From here on the player holds a track again, so "play" means "carry on"
    // and not "load it again". The `Loading` event says the same thing a
    // moment later; this says it before the command leaves.
    state.holds_no_track.store(false, Ordering::Relaxed);

    player.load(uri, true, position_ms);
    Ok(())
}

/// Cortar lo que esté sonando.
///
/// Lo usa el DJ: cuando habla, la música se calla. La voz y la canción al
/// mismo tiempo es una conversación que nadie pidió, y el DJ dice su
/// entrada antes de que empiece la música, no encima.
///
/// Toma el `AppHandle` y no el estado porque la called la hace **el hilo de la
/// voz**, que corre fuera del hilo de los comandos: el estado de Tauri se
/// presta, no se clona, y el `PlaybackState` no se puede copiar.
pub fn stop(app: &AppHandle) -> Result<(), String> {
    let Some(state) = app.try_state::<PlaybackState>() else {
        return Err("no_player".to_string());
    };
    let player = state.live_player()?;
    // With the crossfade on, the end of the song may already be queued. The DJ
    // speaks after it, so it plays out whole instead of being cut to make room.
    crate::crossfade::release_tail();
    player.stop();
    // The player is left holding no track, and `Player::play` does nothing on
    // one: it only resumes from `Paused` or `Loading`. So this is also the
    // moment where "play" has to become "load the track again" — otherwise the
    // button would answer the user with silence.
    state.holds_no_track.store(true, Ordering::Relaxed);
    state.mutate(|s| {
        s.playing = false;
        s.loading = false;
        s.finished = false;
        s.position_ms = 0;
    });
    // El corte también es un cambio de estado, y el player no avisa de él: lo
    // que se calla es el sink, no la canción. Sin este aviso, la barra seguía
    // diciendo "sonando" mientras el DJ hablaba.
    let _ = app.emit("player://status", state.status());
    Ok(())
}

pub fn toggle(app: &AppHandle, state: &PlaybackState) -> Result<(), String> {
    let player = state.live_player()?;
    let current = state.status();

    // **A player with no track in it cannot be paused, and that is the first
    // thing to check.**
    //
    // `Player::play` only does something from `Paused` or `Loading`: from
    // `Stopped` or `EndOfTrack` librespot answers with an error and silence.
    // The player is left in exactly those two states by two ordinary things —
    // the DJ, who needs the silence to say its line, and a track that ran to
    // its end — and calling `play()` on it is how the app ends up claiming to
    // be playing while nothing is audible.
    //
    // The order matters, and it was the wrong way round. A click that landed
    // right when the track ended was answered with a `pause()` on a player
    // that had already finished: librespot refused it (`Player::pause called
    // from invalid state: EndOfTrack`), the app set its own flag to "playing"
    // anyway, and **the next click asked for a pause on a player that was
    // never playing**. Three clicks, three refusals, and nothing on screen
    // changed — because a state the app changes on its own is a state the
    // webview never hears about.
    if state.holds_no_track.load(Ordering::Relaxed) {
        let Some(track_id) = current.track_id.clone() else {
            return Err(auth::fail("no_track", "no hay ninguna pista cargada"));
        };
        // **La música y la voz no se pisan.** Si el DJ estaba hablando, la
        // frase era para otra cosa: el usuario pidió música, y la música entra
        // sola. Es la misma regla que corta al DJ cuando se elige una canción.
        crate::voice::stop();
        play(state, &track_id, 0, current.duration_ms)?;
        push_status(app, state);
        return Ok(());
    }

    if current.playing {
        player.pause();
        // **Pausar el player no calla la música.** El player deja de pedir
        // audio, pero lo que ya estaba en la cola sigue en el mixer y sigue
        // sonando: casi 700 ms de música que la pausa no tapa. La cola se
        // apaga y se congela acá, y al volver a play sigue donde estaba.
        crate::crossfade::silence();
        state.mutate(|s| s.playing = false);
    } else {
        player.play();
        // La cola congelada vuelve a sonar con el volumen que tenía, y la
        // música sigue donde la dejaste: no hay salto.
        crate::crossfade::resume();
        // Clearing `finished` here is what makes pressing play on a finished track
        // mean "again", not "next". Leaving it set would let the advance effect
        // fire on the user's own resume and skip the track they asked to hear.
        state.mutate(|s| {
            s.playing = true;
            s.loading = false;
            s.finished = false;
        });
    }

    // **The state the app just changed, pushed.**
    //
    // Without this the webview only learns what librespot says, and on the
    // paths where librespot says nothing —a command it refuses— it learns
    // nothing at all: the button looks dead and the app's own idea of what is
    // playing drifts away from what the person sees.
    push_status(app, state);
    Ok(())
}

/// Tell the webview what the player is doing right now.
fn push_status(app: &AppHandle, state: &PlaybackState) {
    let _ = app.emit("player://status", state.status());
}

pub fn seek(state: &PlaybackState, position_ms: u32) -> Result<(), String> {
    let player = state.live_player()?;
    // A seek into the last seconds' buffered end would play that end first.
    crate::crossfade::cut(position_ms);
    player.seek(position_ms);
    state.mutate(|s| s.position_ms = position_ms);
    Ok(())
}

pub fn set_volume(state: &PlaybackState, volume: u16) {
    // **The sound first, the disk afterwards.**
    //
    // The attenuation is an atomic and librespot's mixer reads it on every
    // buffer, so from here the volume has already changed: the hand is the
    // reference and the sound has to be there with it.
    //
    // The file was written first, and that put a disk round trip —a read and a
    // write of the whole settings file, on the thread that also answers the
    // clicks— between the hand and the sound.
    //
    // Remember the value the user asked for, before `apply_volume` runs the
    // curve. Persisting the attenuated number would re-square it on the next
    // launch.
    let volume = state.apply_volume(volume);
    state.mutate(|s| s.volume = volume);
    if let Some(player) = state.player() {
        player.emit_volume_changed_event(volume);
    }
    crate::settings::save_volume(volume);
}

/// Hand the audio device back. Called on sign-out, so the next session opens a
/// fresh one instead of inheriting a handle nobody owns.
pub fn shutdown(state: &PlaybackState) {
    if let Ok(mut guard) = state.player.lock() {
        if let Some(player) = guard.take() {
            player.stop();
        }
    }
    if let Ok(mut guard) = state.status.lock() {
        *guard = PlaybackStatus::default();
    }
}

/// How many times the app will try to rebuild a dead session in a row.
const MAX_RECONNECTS: u32 = 3;

/// Start putting the session back, once.
///
/// The guard is the whole of it. A dead session produces one `Unavailable` per
/// track, and the app asks for the next one every time, so without the guard
/// a machine with no network would open a session per failed track, forever.
fn schedule_reconnect(app: &AppHandle, track_id: &SpotifyUri, duration_ms: u32) {
    let Some(state) = app.try_state::<PlaybackState>() else {
        return;
    };

    if state.reconnecting.swap(true, Ordering::SeqCst) {
        // One at a time. The one already running is the one that matters.
        return;
    }

    if state.reconnects.fetch_add(1, Ordering::Relaxed) >= MAX_RECONNECTS {
        log::error!("[reconnect_failed] se agotaron los reintentos de reconexión");
        state.reconnecting.store(false, Ordering::SeqCst);
        state.mutate(|s| s.error = Some("connection_lost".into()));
        return;
    }

    // Only a track can fail this way, but a URI that is not one is not
    // something this app can put back on.
    let SpotifyUri::Track { id } = track_id else {
        log::error!("[reconnect_failed] lo que falló no es una pista: {track_id}");
        state.reconnecting.store(false, Ordering::SeqCst);
        return;
    };

    let Ok(track_id) = id.to_base62() else {
        log::error!("[reconnect_failed] no se pudo volver al id de la pista");
        state.reconnecting.store(false, Ordering::SeqCst);
        return;
    };

    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        rebuild_and_resume(&app, (track_id, duration_ms));
    });
}

/// Put the session back, and the track the user asked for back on.
///
/// **This is the other way into a dead session.** The reconnection exists for
/// a track that *failed* on a dead connection, and a session that dies while
/// the queue is empty never produces one: the track that was buffered plays to
/// its end, nothing replaces it, and nothing failed — so nothing asked for the
/// session back, and the app sat there with a dead connection and a window that
/// looked perfectly fine.
///
/// A click is the same request a failure makes, and the only one a person can
/// make. The session goes up again and the track goes back on with it.
pub fn reconnect_and_play(app: &AppHandle, track_id: &str, duration_ms: u32) -> Result<(), String> {
    let uri = track_uri(track_id)?;
    let Some(state) = app.try_state::<PlaybackState>() else {
        return Ok(());
    };

    // The click is the request, and it goes in the state so that it wins over
    // whatever the reconnection was originally for.
    if let Ok(mut guard) = state.requested.lock() {
        *guard = Some((track_id.to_string(), duration_ms));
    }

    // A click starts the budget over. The counter exists to stop a *loop* — a
    // dead session fails one track at a time and the app asks for the next one
    // every time — and a person clicking is not a loop. Without this, three
    // failed attempts would leave the app unable to play anything at all until
    // it was restarted.
    state.reconnects.store(0, Ordering::Relaxed);

    // The message on screen is the truth about what is happening: this is not
    // a track that cannot be played, it is a connection that has to be rebuilt.
    state.mutate(|s| {
        s.playing = false;
        s.loading = true;
        s.error = Some("reconnecting".into());
    });

    schedule_reconnect(app, &uri, duration_ms);
    Ok(())
}

/// Put the session back together, and the track back on.
///
/// **This is the way out of a dead session.** librespot gives up on a
/// connection and never comes back on its own: its keep-alive marks the
/// session invalid and stops, with a `TODO: Optionally reconnect` where the
/// reconnect would go. The session object is not the account — the credential
/// is — and the credential is on disk. So the way back is the way in: a new
/// session from the cached credentials, and the track that failed loaded again.
///
/// **The player changes session instead of being replaced.** `Player::set_session`
/// points the running player at a different session, so the reconnect does not
/// open a second output device — Windows does not let two apps hold the same
/// one — and does not leave an old player behind holding a handle nobody owns.
/// The player is the one thing in this app that is worth keeping: it owns the
/// audio device, and the device is what the user is here for.
///
/// Blocking: it waits for the handshake. It runs on its own thread.
fn rebuild_and_resume(app: &AppHandle, fallback: (String, u32)) {
    let Some(state) = app.try_state::<PlaybackState>() else {
        return;
    };

    let session = match auth::open_cache().and_then(|cache| auth::connect_now(&cache)) {
        Ok(session) => session,
        Err(error) => {
            log::error!("[reconnect_failed] {error}");
            state.mutate(|s| s.error = Some("connection_lost".into()));
            state.reconnecting.store(false, Ordering::SeqCst);
            return;
        }
    };

    match state.player() {
        Some(player) => player.set_session(session.clone()),
        None => ensure_player(app, &session),
    }

    // The new session takes the old one's place. The old one is dead already
    // — `is_invalid` is final — so there is nothing to salvage from it.
    install_session(app, &session);

    // Which track goes back on. **The last request wins.** The reconnection
    // takes a couple of seconds and the user does not stop clicking during it,
    // and the song somebody asked for is not the song that happened to fail.
    let (track_id, duration_ms) = requested_track(&state, fallback);

    // And the track that failed goes back on, from the beginning: it never
    // started, so there is no position to come back to.
    if let Err(error) = play(&state, &track_id, 0, duration_ms) {
        log::error!("[reconnect_failed] no se pudo volver a cargar la pista: {error}");
        state.mutate(|s| s.error = Some("connection_lost".into()));
    }

    state.reconnecting.store(false, Ordering::SeqCst);
}

/// Put a session in the place of the one that died.
///
/// The old one is shut down outside the lock: `shutdown` is a teardown of the
/// network, and there is no reason to hold the lock through it.
fn install_session(app: &AppHandle, session: &Session) {
    let Some(state) = app.try_state::<crate::SessionState>() else {
        return;
    };
    let previous = {
        let Ok(mut guard) = state.0.lock() else {
            return;
        };
        guard.replace(session.clone())
    };
    if let Some(previous) = previous {
        previous.shutdown();
    }
}

/// Which track goes back on when the session comes back.
///
/// **The last request wins.** The reconnection takes a couple of seconds and
/// the user does not stop clicking during it, and the song somebody asked for
/// is not the song that happened to fail. When nobody asked for anything else,
/// the track that failed is the one that goes back on: it never started, so
/// there is no position to come back to.
fn requested_track(state: &PlaybackState, fallback: (String, u32)) -> (String, u32) {
    state
        .requested
        .lock()
        .ok()
        .and_then(|mut guard| guard.take())
        .unwrap_or(fallback)
}

/// `true` when the environment asks for the connection to be cut on purpose.
///
/// **The reason this exists is the same as `STARLESS_STALL_TEST`.** A session
/// that dies on its own is not something anybody can reproduce when they want
/// to: Spotify drops it when it drops it, and the bug around it —a session
/// that dies while the queue is empty never fails a track, so nothing ever
/// asks for the session back, and the app sits there mute with a window that
/// looks perfect— is worth more than the lines it takes to see it.
///
/// It is compiled out of release: the gate is the build, not the branch.
#[cfg(debug_assertions)]
pub fn kill_session_requested() -> bool {
    std::env::var("STARLESS_KILL_SESSION")
        .map(|value| value != "0" && !value.is_empty())
        .unwrap_or(false)
}

/// The track the probe puts back on after cutting the connection.
///
/// It is a track that really exists in the account: the probe is not about the
/// track, it is about whether the session comes back —and the music with it.
#[cfg(debug_assertions)]
pub const PROBE_TRACK: &str = "6Nle9hKrkL1wQpwNfEkxjh";

/// Cut the connection on purpose, and see what the app does without it.
///
/// The session is shut down, which is exactly what librespot's own keep-alive
/// does when the connection drops: the session is marked invalid and never
/// comes back on its own. The credential is on disk, so the way back is the
/// way in —and the point of the probe is to watch that door open on a click.
#[cfg(debug_assertions)]
pub fn kill_session(app: &AppHandle) {
    let Some(state) = app.try_state::<crate::SessionState>() else {
        return;
    };
    let session = state.0.lock().ok().and_then(|guard| guard.clone());
    if let Some(session) = session {
        log::warn!("[connection_lost] STARLESS_KILL_SESSION: la sesión se cortó a propósito");
        session.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The song the user asked for last is the one that plays, and not the one
    /// that happened to fail while the session was being rebuilt.
    #[test]
    fn the_last_request_is_the_one_that_plays() {
        let state = PlaybackState::default();
        state
            .requested
            .lock()
            .expect("the state is not poisoned")
            .replace(("pedida".to_string(), 1));

        let chosen = requested_track(&state, ("fallida".to_string(), 2));
        assert_eq!(chosen, ("pedida".to_string(), 1));
    }

    /// And with nobody asking for anything else, the track that failed is the
    /// one that goes back on.
    #[test]
    fn the_failed_track_plays_when_there_is_no_other_request() {
        let state = PlaybackState::default();

        let chosen = requested_track(&state, ("fallida".to_string(), 2));
        assert_eq!(chosen, ("fallida".to_string(), 2));
    }

    /// A request is taken once: the second reconnection must not replay the
    /// song of the first one.
    #[test]
    fn a_request_is_taken_only_once() {
        let state = PlaybackState::default();
        state
            .requested
            .lock()
            .expect("the state is not poisoned")
            .replace(("pedida".to_string(), 1));

        let _ = requested_track(&state, ("fallida".to_string(), 2));
        let second = requested_track(&state, ("fallida".to_string(), 2));
        assert_eq!(second, ("fallida".to_string(), 2));
    }
}