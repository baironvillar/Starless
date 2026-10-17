// The Tauri side of Starless.
//
// Rule that shapes this whole file: **the webview never holds a credential.** It
// asks whether a session exists and gets a boolean and a display name. Tokens,
// cookies and the librespot session itself stay in Rust. If a future bug ever
// needs the frontend to read a token, that is the bug, not the design.

mod auth;
// Named `selftest`, never `diagnostic`: the `diagnostic` crate provides the
// `#[diagnostic::on_unimplemented]` attribute that `#[tauri::command]` expands
// to, and a local module of the same name shadows it at the crate root — which
// breaks every command in this file with an error that points nowhere useful.
mod logging;
mod models;
mod playback;
mod report;
mod selftest;
mod settings;
mod spclient;

use std::sync::Mutex;

use librespot_core::session::Session;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use playback::{PlaybackState, PlaybackStatus};
use models::{Account, ArtistProfile, Playlist, Track};

/// The version a report carries, read from the compiled-in crate metadata.
///
/// `Cargo.toml` is one of the three manifests `scripts/version.ts` keeps in step,
/// and CI fails the build if they drift, so this is the version that actually
/// shipped — the same number `tauri.conf.json` compiled into the binary.
pub fn version_line() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

// ---------------------------------------------------------------------------
// Crash reporting
// ---------------------------------------------------------------------------

/// The Spotify account name, if there is a session.
///
/// Handed to the scrubber so the account is removed by exact value rather than by
/// pattern. Every shape-based rule here is a guess about what identifying text
/// looks like; this is not a guess, it is the thing itself.
fn account_name(state: &State<SessionState>) -> Option<String> {
    let session = state.0.lock().ok()?;
    let name = session.as_ref().map(|s| s.username().to_string())?;
    (!name.is_empty()).then_some(name)
}

/// Did the run before this one end without being closed?
///
/// Read on the first render, before `mark_session_start` has overwritten the
/// marker — that ordering is what makes the answer describe the previous session
/// rather than this one.
#[tauri::command]
fn previous_session_crashed() -> bool {
    report::previous_session_crashed()
}

/// The report as it would be sent, already scrubbed, so the person deciding can
/// read exactly what would leave the machine.
#[tauri::command]
fn crash_report_preview(state: State<SessionState>) -> String {
    report::preview(report::Kind::Crash, "", true, account_name(&state).as_deref())
}

/// Send it. With a token compiled in this creates the issue outright; without one
/// it hands back a pre-filled URL for the caller to open.
///
/// Async, and the send happens on a blocking thread. A Tauri command without
/// `async` runs on the main thread, and this one makes an HTTP request with a
/// twenty second timeout — a frozen window with no explanation is what that looks
/// like, on the one screen where the user is already reporting something broken.
#[tauri::command]
async fn submit_crash_report(app: AppHandle) -> Result<report::ReportOutcome, String> {
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<SessionState>();
        report::submit(report::Kind::Crash, "", true, account_name(&state).as_deref())
    })
    .await
    .map_err(|e| {
        log::error!("[crash_report_failed]: {e}");
        "crash_report_failed".to_string()
    })??;

    // Reported or dismissed, this crash is dealt with. Leaving the marker would
    // make the same prompt reappear on every launch from here on.
    report::acknowledge();
    Ok(outcome)
}

/// The same preview, for something the user chose to write rather than a crash.
#[tauri::command]
fn feedback_report_preview(
    message: String,
    attach_log: bool,
    state: State<SessionState>,
) -> String {
    report::preview(
        report::Kind::Feedback,
        &message,
        attach_log,
        account_name(&state).as_deref(),
    )
}

/// Send feedback. Same path as a crash report, because "send me this and nothing
/// else" should not be two different buttons with two different disclosure rules.
///
/// Async for the same reason as [`submit_crash_report`]: it is the same HTTP
/// round trip, and it must not run on the thread that draws the window.
#[tauri::command]
async fn submit_feedback(
    app: AppHandle,
    message: String,
    attach_log: bool,
) -> Result<report::ReportOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<SessionState>();
        report::submit(
            report::Kind::Feedback,
            &message,
            attach_log,
            account_name(&state).as_deref(),
        )
    })
    .await
    .map_err(|e| {
        log::error!("[feedback_report_failed]: {e}");
        "feedback_report_failed".to_string()
    })?
}

/// The user said no, or dealt with it later. Either way: never again.
#[tauri::command]
fn dismiss_crash_report() {
    report::acknowledge();
}

/// A session that is about to end on purpose, announced in advance.
///
/// The updater hands the installer to Windows from inside `downloadAndInstall`
/// and the process is gone before the runner's `Exit` event can be heard, so the
/// marker survives and the next launch greets someone with a crash report about
/// an update that did exactly what it was asked. This is the one clean exit the
/// app can announce before it happens, so it is the one it announces.
///
/// Cheap enough to be a plain command: one file, removed, on the main thread.
#[tauri::command]
fn announce_clean_exit() {
    log::info!("salida anunciada: la actualización se lleva la sesión");
    report::mark_session_end();
}

/// Development only: plant a crashed session on disk so the crash flow can be
/// walked without crashing.
///
/// The command stays in the handler list in every build, because `generate_handler!`
/// has no way to drop one entry without building two different closures and
/// boxing the result — a small piece of ceremony that would put a dev tool one
/// careless edit away from a release build. So the guard lives in the body: a
/// release build compiles the planting away entirely and answers with an error, and
/// the button that calls this does not exist in a release frontend either. Two
/// independent gates, because the one that matters is the one that is checked.
#[tauri::command]
fn simulate_crash() -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        report::simulate_crash()
    }
    #[cfg(not(debug_assertions))]
    {
        Err("esto sólo existe en una build de desarrollo".into())
    }
}

/// The live streaming session, if any. `Mutex` because `Session` is not `Sync`.
#[derive(Default)]
pub struct SessionState(Mutex<Option<Session>>);

/// Everything the login screen needs to decide what to show, and nothing else.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    /// There are cached credentials, so a session can be restored without asking.
    ///
    /// This used to be hardcoded `true` — there was always a client id compiled
    /// in — which meant the field carried one piece of information for two readers
    /// and the second one read a lie. It now asks the question it names: a machine
    /// with nothing saved is what somebody signed out looks like, and one with
    /// something saved is what somebody who quit the app looks like. Telling those
    /// two apart is the whole reason this field exists.
    ///
    /// **It says nothing about whether a login is possible.** The streaming client
    /// id is always there, so a login is always possible; `false` is the ordinary
    /// answer on a machine that has never signed in, and the UI must not read it as
    /// "this build cannot log in" — that mistake greys out the only button on the
    /// screen, on exactly the machine that needs it.
    pub configured: bool,
    /// The streaming session exists.
    pub signed_in: bool,
    /// Display name only. Never the account's email, never a token.
    pub username: Option<String>,
    /// A kebab-case error code, never a sentence. See `AuthGate`'s `AUTH_ERRORS`.
    pub detail: Option<String>,
}

#[tauri::command]
fn auth_status(session_state: State<SessionState>) -> AuthStatus {
    let guard = match session_state.0.lock() {
        Ok(guard) => guard,
        Err(_) => {
            return AuthStatus {
                configured: true,
                signed_in: false,
                username: None,
                detail: Some("session_busy".into()),
            };
        }
    };

    let username = guard.as_ref().map(|s| s.username()).unwrap_or_default();

    AuthStatus {
        // Asked of librespot, not assumed. See the field's doc: this answers
        // "is there something to restore", and nothing about whether a login is
        // possible — the streaming client id is always there.
        configured: auth::has_cached_credentials(),
        // librespot fills the username in as the last step of the handshake, so an
        // empty one means "connected to nothing yet", not "no session".
        signed_in: !username.is_empty(),
        username: (!username.is_empty()).then_some(username),
        detail: None,
    }
}

/// Open the browser, wait for the approval, and come back with a session.
///
/// The wait is user-paced — it blocks until they finish in the browser — so it
/// runs on a blocking thread and the window stays responsive the whole time.
#[tauri::command]
async fn begin_login(
    app: AppHandle,
    session_state: State<'_, SessionState>,
) -> Result<AuthStatus, String> {
    let session = tauri::async_runtime::spawn_blocking(auth::login_interactively)
        .await
        .map_err(|e| {
            log::error!("[login_task_failed]: {e}");
            "login_task_failed".to_string()
        })??;

    // Same reasoning as the restore path: the device is opened while the handshake
    // completes, so the first song after signing in is not the thing that pays for it.
    playback::warm_audio_device(&app, session.clone());

    let username = session.username();

    let status = AuthStatus {
        // Read it rather than asserting it. The credentials librespot writes are
        // what the next launch restores from, and the app used to report success
        // without ever checking that the write had happened.
        configured: auth::has_cached_credentials(),
        // The handshake has not finished yet; librespot fills the username in
        // when it does. Reporting success here would be a lie the UI would repeat.
        signed_in: !username.is_empty(),
        username: (!username.is_empty()).then_some(username),
        detail: None,
    };

    // Shut the old session down before installing the new one. Signing in while
    // already signed in used to just overwrite the slot, which left the previous
    // session connected to Spotify's access point with its keepalive running.
    //
    // Two live sessions for one account is not a cosmetic leak: both are competing
    // for the same audio keys, and the loser decodes another session's bytes. What
    // that looks like from the app is a track that streams four and a half megabytes
    // and then dies in the MP3 decoder, reported as "Spotify did not deliver this
    // song" — which sends everyone looking at Spotify instead of here.
    if let Ok(mut guard) = session_state.0.lock() {
        if let Some(previous) = guard.replace(session) {
            log::info!("cierro la sesion anterior antes de instalar la nueva");
            previous.shutdown();
        }
    } else {
        return Err("session_busy".to_string());
    }

    log::info!("login completo: session={}", status.signed_in);
    Ok(status)
}

/// Forget the cached credentials and drop the live session.
#[tauri::command]
fn sign_out(
    app: AppHandle,
    session_state: State<SessionState>,
    playback_state: State<PlaybackState>,
) -> Result<(), String> {
    // Hand the audio device back before dropping the session it was decoding for.
    playback::shutdown(&playback_state);
    if let Ok(mut guard) = session_state.0.lock() {
        if let Some(session) = guard.take() {
            session.shutdown();
        }
    }
    auth::forget_credentials()?;

    // Announce it. The webview used to find out by reloading the whole window, and
    // that reload is exactly what left stale library queries behind: it fired once
    // more between the session dropping and the page going away, cached its
    // `not_signed_in`, and depending on timing either lost that cache or kept it.
    // The gate now listens for this instead of guessing.
    let _ = app.emit(
        "auth://status",
        AuthStatus {
            // The credentials are gone by the time this is emitted, so `false` is
            // read back rather than assumed — `forget_credentials` is what deleted
            // them and it can fail.
            configured: auth::has_cached_credentials(),
            signed_in: false,
            username: None,
            detail: None,
        },
    );
    Ok(())
}

// --- The account's own data -------------------------------------------------

/// Run a library read off the UI thread, against the streaming session.
///
/// **One macro for every command that reads the account's data, and the reason it
/// is one is the shape they share, not that they are alike.** `spclient` makes
/// network trips, and a Tauri command without `async` runs on the main thread — a
/// blocking HTTP call there is thirty seconds of frozen window. So each one hops to
/// `spawn_blocking` first.
///
/// The input is the thing that actually changed: these used to take a Web API
/// access token, and now they take librespot's session. That is why the macro is
/// not a leftover from `webapi_command` — that one is gone, along with the token it
/// refreshed.
///
/// The lock is taken here and not inside the blocking thread: `State` cannot move
/// to a blocking thread, but the session can, and all that is needed is a copy.
macro_rules! spclient_command {
    ($name:ident, $inner:path, $ty:ty $(, $arg:ident : $arg_ty:ty)*) => {
        #[tauri::command]
        async fn $name(session_state: State<'_, SessionState> $(, $arg: $arg_ty)*) -> Result<$ty, String> {
            let session = session_state
                .0
                .lock()
                .ok()
                .and_then(|guard| guard.clone())
                .ok_or_else(|| "no_session".to_string())?;

            tauri::async_runtime::spawn_blocking(move || $inner(&session $(, &$arg)*))
                .await
                .map_err(|e| {
                    eprintln!("Starless [command_failed]: {e}");
                    "command_failed".to_string()
                })?
        }
    };
}

spclient_command!(account, spclient::account, Account);
spclient_command!(my_playlists, spclient::playlists, Vec<Playlist>);
spclient_command!(liked_tracks, spclient::liked_tracks, Vec<Track>);
spclient_command!(playlist_tracks, spclient::playlist_tracks, Vec<Track>, playlist_id: String);
spclient_command!(album_tracks, spclient::album_tracks, Vec<Track>, album_id: String);
spclient_command!(search_tracks, spclient::search_tracks, Vec<Track>, query: String);
spclient_command!(artist_profile, spclient::artist_profile, ArtistProfile, artist_id: String);

// --- Playback --------------------------------------------------------------

/// The player's live state. Polled by the UI rather than pushed for volume and
/// transport; only track and position changes are emitted, as `player://status`.
#[tauri::command]
fn player_status(state: State<PlaybackState>) -> PlaybackStatus {
    state.status()
}

#[tauri::command]
fn play_track(
    app: AppHandle,
    state: State<PlaybackState>,
    session_state: State<SessionState>,
    track_id: String,
    position_ms: Option<u32>,
    duration_ms: Option<u32>,
) -> Result<(), String> {
    // The audio device is opened here, on the first request to make a sound —
    // not at launch. An app that grabs an output handle before the user has asked
    // for anything is holding a device it has not been given.
    let session = session_state
        .0
        .lock()
        .map_err(|_| "session_busy".to_string())?
        .clone()
        .ok_or_else(|| "not_signed_in".to_string())?;
    playback::ensure_player(&app, &session);
    playback::play(
        &state,
        &track_id,
        position_ms.unwrap_or(0),
        duration_ms.unwrap_or(0),
    )?;

    // Push the state we just set. Without this the UI learns nothing until
    // librespot emits something, and on the failure paths it never does — which
    // is why a click could produce no visible change whatsoever.
    let _ = app.emit("player://status", state.status());
    Ok(())
}

#[tauri::command]
fn toggle_playback(state: State<PlaybackState>) -> Result<(), String> {
    playback::toggle(&state)
}

#[tauri::command]
fn seek_playback(state: State<PlaybackState>, position_ms: u32) -> Result<(), String> {
    playback::seek(&state, position_ms)
}

#[tauri::command]
fn stop_playback(state: State<PlaybackState>) -> Result<(), String> {
    playback::stop(&state)
}

#[tauri::command]
fn set_volume(state: State<PlaybackState>, volume: u16) {
    playback::set_volume(&state, volume);
}

/// How opaque the menus are, as a percentage. The default is opaque, not 55%.
#[tauri::command]
fn menu_opacity() -> u8 {
    settings::saved_menu_opacity()
}

/// Remember it. Clamped in `settings`, because the value lands in a CSS colour.
#[tauri::command]
fn set_menu_opacity(opacity: u8) {
    settings::save_menu_opacity(opacity);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // The updater only downloads and verifies; *when* it runs is decided by the
        // UI. An app that plays music must not install over itself mid-track, so
        // Starless asks instead — see `update.rs`.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(SessionState::default())
        .manage(PlaybackState::default())
        .setup(|app| {
            // librespot narrates every refusal through `log`, and Starless is a
            // windowed app with no console to narrate into. Both halves matter:
            // without a logger a refusal is invisible, and without a file it is
            // invisible to the user and to us. See `logging`.
            //
            // `RUST_LOG` still wins, e.g. `RUST_LOG=librespot=debug bun run app`.
            logging::init();

            // Order matters here, and it is the whole design. The marker from the
            // previous run is *moved aside* rather than overwritten, so the question
            // "did it end cleanly?" stays answerable from the frontend long after
            // setup has returned — and no race between setup and the first render can
            // swallow a crash.
            //
            // The panic hook goes in before anything else can fail, because the run
            // it is meant to catch is this one.
            report::install_panic_hook();
            report::mark_session_start();

            let handle = app.handle().clone();
            let restore = handle.clone();

            // Restoring the streaming session opens a connection to Spotify, so it
            // happens off the setup thread — the window must appear immediately.
            // No client id is needed here: the session presents Spotify's own.
            tauri::async_runtime::spawn_blocking(move || {
                let Ok(cache) = auth::open_cache() else {
                    return;
                };
                if let Some(session) = auth::cached_session(&cache) {
                    // Open the audio device while the handshake is still finishing.
                    // Nothing is playing yet and nothing is open to a device the
                    // account owns, so the only thing this costs is a handle — and
                    // what it buys is the first song not paying for the device on the
                    // critical path.
                    playback::warm_audio_device(&restore, session.clone());
                    if let Some(state) = restore.try_state::<SessionState>() {
                        if let Ok(mut guard) = state.0.lock() {
                            *guard = Some(session);
                        }
                    }
                }
            });

            // Off the setup thread, and started independently of the restore
            // above: the self-test waits for the session itself.
            // Same shape, different question: what this session can answer on
            // its own. Kept out of the self-test because that one plays music.
            // Before it because both wait for the same session and the self-test
            // takes the handle by value.
            #[cfg(debug_assertions)]
            if spclient::requested() {
                spclient::run_probe(handle.clone());
            }
            #[cfg(debug_assertions)]
            if spclient::shapes_requested() {
                spclient::run_shape_probe(handle.clone());
            }
            if selftest::requested() {
                selftest::run(handle);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            auth_status,
            begin_login,
            sign_out,
            account,
            my_playlists,
            liked_tracks,
            playlist_tracks,
            search_tracks,
            album_tracks,
            artist_profile,
            player_status,
            play_track,
            toggle_playback,
            seek_playback,
            stop_playback,
            set_volume,
            menu_opacity,
            set_menu_opacity,
            previous_session_crashed,
            announce_clean_exit,
            simulate_crash,
            crash_report_preview,
            submit_crash_report,
            dismiss_crash_report,
            feedback_report_preview,
            submit_feedback
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // `build` + `run` instead of the shorthand `.run(context)`, because the
    // shorthand gives no way to hear the app finish — and hearing it finish is the
    // only signal that separates a quit from a crash.
    //
    // `Exit`, not `ExitRequested`: the latter fires on the way in and can still be
    // prevented, so clearing the marker there would mark a crash as a clean exit.
    app.run(|_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            report::mark_session_end();
        }
    });
}