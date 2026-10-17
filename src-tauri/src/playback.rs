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
    atomic::{AtomicU64, Ordering},
};

use librespot_core::{Session, SpotifyId, SpotifyUri};
use librespot_playback::{
    audio_backend::BACKENDS,
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

const MAX_VOLUME: u16 = 65535;

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

/// A volume the user can actually perceive.
///
/// The mapping is quadratic on purpose: a linear slider spends most of its
/// travel in a range where you cannot hear the difference, and then a user who
/// wants "half volume" sets it to 25% and concludes the app is quiet.
struct SoftVolume(Arc<AtomicU64>);

impl VolumeGetter for SoftVolume {
    fn attenuation_factor(&self) -> f64 {
        f64::from_bits(self.0.load(Ordering::Relaxed))
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

    // Look the backend up by name rather than naming its type: the sink types
    // behind this list are private, which is the crate telling us the list is the
    // supported way in.
    let Some(builder) = BACKENDS
        .iter()
        .find(|(name, _)| *name == "rodio")
        .map(|(_, builder)| *builder)
    else {
        state.mutate(|s| s.error = Some("no_audio_backend".into()));
        return;
    };

    let mut config = PlayerConfig::default();
    config.position_update_interval = Some(std::time::Duration::from_millis(POSITION_INTERVAL_MS));

    let player = Player::new(
        config,
        session.clone(),
        Box::new(SoftVolume(state.attenuation.clone())),
        move || builder(None, AudioFormat::F32),
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

    forward_events(app.clone(), player);
}

/// librespot reports on its own task; the webview gets a coarse summary.
fn forward_events(app: AppHandle, player: Arc<Player>) {
    let mut receiver = player.get_player_event_channel();

    tauri::async_runtime::spawn(async move {
        while let Some(event) = receiver.recv().await {
            let Some(state) = app.try_state::<PlaybackState>() else {
                return;
            };

            // Every event is recorded, including the boring ones. The interesting
            // failure ("click, nothing happens") is usually absent from the log
            // entirely, and the event that *would* have explained it is the one
            // that never arrives — so the absence is itself the evidence.
            match &event {
                PlayerEvent::Unavailable { track_id, .. } => {
                    log::error!("[track_unavailable] {track_id}");
                    state.mutate(|s| {
                        s.playing = false;
                        s.loading = false;
                        s.error = Some("track_unavailable".into());
                    });
                }
                PlayerEvent::Loading { .. } => state.mutate(|s| {
                    s.loading = true;
                    s.playing = false;
                }),
                PlayerEvent::Playing { position_ms, .. } => {
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
                PlayerEvent::Paused { .. } => state.mutate(|s| s.playing = false),
                PlayerEvent::Stopped { .. } => state.mutate(|s| {
                    s.playing = false;
                    s.loading = false;
                    s.finished = false;
                    s.position_ms = 0;
                }),
                PlayerEvent::EndOfTrack { .. } => state.mutate(|s| {
                    s.playing = false;
                    s.loading = false;
                    s.finished = true;
                }),
                PlayerEvent::PositionChanged { position_ms, .. }
                | PlayerEvent::Seeked { position_ms, .. }
                | PlayerEvent::PositionCorrection { position_ms, .. } => {
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

            let _ = app.emit("player://status", state.status());
        }
        log::warn!("el canal de eventos del player se cerró");
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

    let started = std::time::Instant::now();
    log::info!("play {track_id} @ {position_ms}ms");
    if let Ok(mut guard) = state.requested_at.lock() {
        *guard = Some(started);
    }

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

    player.load(uri, true, position_ms);
    Ok(())
}

pub fn toggle(state: &PlaybackState) -> Result<(), String> {
    let player = state.live_player()?;
    let current = state.status();
    if current.playing {
        player.pause();
        state.mutate(|s| s.playing = false);
    } else {
        player.play();
        // Clearing `finished` here is what makes pressing play on a finished track
        // mean "again", not "next". Leaving it set would let the advance effect
        // fire on the user's own resume and skip the track they asked to hear.
        state.mutate(|s| {
            s.playing = true;
            s.loading = false;
            s.finished = false;
        });
    }
    Ok(())
}

pub fn seek(state: &PlaybackState, position_ms: u32) -> Result<(), String> {
    let player = state.live_player()?;
    player.seek(position_ms);
    state.mutate(|s| s.position_ms = position_ms);
    Ok(())
}

pub fn stop(state: &PlaybackState) -> Result<(), String> {
    let player = state.live_player()?;
    player.stop();
    Ok(())
}

pub fn set_volume(state: &PlaybackState, volume: u16) {
    // Remember the value the user asked for, before `apply_volume` runs the curve.
    // Persisting the attenuated number would re-square it on the next launch.
    crate::settings::save_volume(volume);
    let volume = state.apply_volume(volume);
    if let Some(player) = state.player() {
        player.emit_volume_changed_event(volume);
    }
    state.mutate(|s| s.volume = volume);
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