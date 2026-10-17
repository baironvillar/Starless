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
mod playback;
mod report;
mod selftest;
mod settings;
mod token;
mod webapi;

use std::sync::Mutex;

use librespot_core::session::Session;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use playback::{PlaybackState, PlaybackStatus};
use token::TokenState;
use webapi::{Account, Playlist, Track};

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

/// The live streaming session, if any. `Mutex` because `Session` is not `Sync`.
#[derive(Default)]
pub struct SessionState(Mutex<Option<Session>>);

/// Everything the login screen needs to decide what to show, and nothing else.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    /// A client id was found. False means Starless cannot log in at all yet.
    pub configured: bool,
    /// The streaming session exists.
    pub signed_in: bool,
    /// A Web API token is on disk.
    ///
    /// Separate from `signed_in` on purpose, because they can disagree: the
    /// streaming session can be perfectly healthy while the Web API token is
    /// missing, and only the second one can fetch a library. Collapsing them
    /// into one boolean is what made an earlier build unrecoverable — the UI
    /// said "sign in" while offering no way to sign in.
    pub web_ready: bool,
    /// Display name only. Never the account's email, never a token.
    pub username: Option<String>,
    /// A kebab-case error code, never a sentence. See `AuthGate`'s `AUTH_ERRORS`.
    pub detail: Option<String>,
}

#[tauri::command]
fn auth_status(session_state: State<SessionState>, token_state: State<TokenState>) -> AuthStatus {
    let guard = match session_state.0.lock() {
        Ok(guard) => guard,
        Err(_) => {
            return AuthStatus {
                configured: true,
                signed_in: false,
                web_ready: false,
                username: None,
                detail: Some("session_busy".into()),
            };
        }
    };

    let username = guard.as_ref().map(|s| s.username()).unwrap_or_default();

    AuthStatus {
        configured: true,
        // librespot fills the username in as the last step of the handshake, so an
        // empty one means "connected to nothing yet", not "no session".
        signed_in: !username.is_empty(),
        // Read the in-memory copy, not the disk. `AuthGate` polls this while a
        // login is in flight, and a file read per poll is both slower and a
        // chance to observe a half-written token.
        web_ready: token_state.get().is_some(),
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
    token_state: State<'_, TokenState>,
) -> Result<AuthStatus, String> {
    let (session, web_token) = tauri::async_runtime::spawn_blocking(auth::login_interactively)
        .await
        .map_err(|e| {
            log::error!("[login_task_failed]: {e}");
            "login_task_failed".to_string()
        })??;

    // Same reasoning as the restore path: the device is opened while the handshake
    // completes, so the first song after signing in is not the thing that pays for it.
    playback::warm_audio_device(&app, session.clone());

    // The one place a token enters the app: disk *and* the in-memory cache the
    // Web API commands read, in one step. Skipping this left the file written and
    // the cache empty, so `ensure_fresh` answered "not signed in" to a session
    // that had authenticated seconds earlier.
    token_state.set(web_token);

    let username = session.username();

    let status = AuthStatus {
        configured: true,
        // The handshake has not finished yet; librespot fills the username in
        // when it does. Reporting success here would be a lie the UI would repeat.
        signed_in: !username.is_empty(),
        // Read it back rather than asserting it. This command used to hardcode
        // `true`, which is how a failed token write could present as a working
        // app right up until the first library query came back signed out.
        web_ready: token_state.get().is_some(),
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

    log::info!(
        "login completo: session={} web_token={}",
        status.signed_in,
        status.web_ready
    );
    Ok(status)
}

/// Forget the cached credentials and drop the live session.
#[tauri::command]
fn sign_out(
    app: AppHandle,
    session_state: State<SessionState>,
    token_state: State<TokenState>,
    playback_state: State<PlaybackState>,
) -> Result<(), String> {
    // Hand the audio device back before dropping the session it was decoding for.
    playback::shutdown(&playback_state);
    if let Ok(mut guard) = session_state.0.lock() {
        if let Some(session) = guard.take() {
            session.shutdown();
        }
    }
    token_state.clear();
    auth::forget_credentials()?;

    // Announce it. The webview used to find out by reloading the whole window, and
    // that reload is exactly what left stale library queries behind: it fired once
    // more between the session dropping and the page going away, cached its
    // `not_signed_in`, and depending on timing either lost that cache or kept it.
    // The gate now listens for this instead of guessing.
    let _ = app.emit(
        "auth://status",
        AuthStatus {
            configured: true,
            signed_in: false,
            web_ready: false,
            username: None,
            detail: None,
        },
    );
    Ok(())
}

// --- The account's own data -------------------------------------------------
//
// Each of these is "refresh the token, then do one blocking HTTP call on a
// blocking thread". Repeating that shape four times would be noise, so it lives
// in a macro: one definition, one place to get it wrong.

/// Run a Web API call off the UI thread, refreshing the token first.
///
/// **The refresh happens inside the blocking closure, not before it.** That is the
/// whole difference between this working and this silently emptying the library:
/// [`token::ensure_fresh`] says outright that it must be called from a blocking
/// thread, because refreshing is an HTTP round trip through a blocking client —
/// and a blocking client cannot be built inside an async runtime. Called from
/// here it panicked the runtime with *"Cannot drop a runtime in a context where
/// blocking is not allowed"*, every webapi command died with it, and the log
/// showed a burst of panics with no `webapi:` line anywhere, because the request
/// was never made. It only happened once the stored token was old enough to need
/// renewing, which is why the app worked for an hour and then did not.
///
/// `AppHandle` instead of `State<TokenState>` because the state is read *inside*
/// the closure: `State` borrows the app for the lifetime of the command, and
/// `spawn_blocking` needs an owned, `'static` handle.
///
/// The trailing arguments are the call's own inputs; they are handed to the
/// blocking closure by reference, which is what lets `$inner` take `&str` and
/// `&[String]` instead of owning a copy of every string the webview sent.
macro_rules! webapi_command {
    ($name:ident, $inner:path, $ty:ty $(, $arg:ident : $arg_ty:ty)*) => {
        #[tauri::command]
        async fn $name(app: AppHandle $(, $arg: $arg_ty)*) -> Result<$ty, String> {
            tauri::async_runtime::spawn_blocking(move || {
                let access = token::ensure_fresh(&app.state::<TokenState>())?.access_token;
                $inner(&access $(, &$arg)*)
            })
            .await
            .map_err(|e| {
                eprintln!("Starless [command_failed]: {e}");
                "command_failed".to_string()
            })?
        }
    };
}

webapi_command!(account, webapi::account, Account);
webapi_command!(my_playlists, webapi::playlists, Vec<Playlist>);
webapi_command!(liked_tracks, webapi::liked_tracks, Vec<Track>);
webapi_command!(playlist_tracks, webapi::playlist_tracks, Vec<Track>, playlist_id: String);
webapi_command!(
    add_to_playlist,
    webapi::add_to_playlist,
    (),
    playlist_id: String,
    track_ids: Vec<String>
);
webapi_command!(create_playlist, webapi::create_playlist, Playlist, name: String);
webapi_command!(album_tracks, webapi::album_tracks, Vec<webapi::Track>, album_id: String);
webapi_command!(artist_profile, webapi::artist_profile, webapi::ArtistProfile, artist_id: String);

/// Everything one query turned up, across songs, albums, artists and playlists.
///
/// Split from [`search_tracks`] rather than folded into it: the menu under the
/// search field only ever shows songs, and asking Spotify for four types on every
/// keystroke to use one of them is four times the payload for nothing.
#[tauri::command]
async fn search_all(app: AppHandle, query: String) -> Result<webapi::SearchResults, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let access = token::ensure_fresh(&app.state::<TokenState>())?.access_token;
        webapi::search_all(&access, &query)
    })
    .await
    .map_err(|e| {
        eprintln!("Starless [command_failed]: {e}");
        "command_failed".to_string()
    })?
}

#[tauri::command]
async fn search_tracks(app: AppHandle, query: String) -> Result<Vec<Track>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let access = token::ensure_fresh(&app.state::<TokenState>())?.access_token;
        webapi::search(&access, &query)
    })
    .await
    .map_err(|e| {
        eprintln!("Starless [command_failed]: {e}");
        "command_failed".to_string()
    })?
}

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
        .manage(TokenState::default())
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

            // A stored Web API token is a plain file read — do it inline, it is
            // microseconds, and every screen needs it immediately.
            if let Some(stored) = token::load() {
                if let Some(state) = handle.try_state::<TokenState>() {
                    state.set(stored);
                }
            }

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
            add_to_playlist,
            create_playlist,
            search_tracks,
            search_all,
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