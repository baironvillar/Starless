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
mod selftest;
mod token;
mod webapi;

use std::sync::Mutex;

use librespot_core::session::Session;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use playback::{PlaybackState, PlaybackStatus};
use token::TokenState;
use webapi::{Account, Playlist, Track};

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
/// The trailing arguments are the call's own inputs; they are handed to the
/// blocking closure by reference, which is what lets `$inner` take `&str` and
/// `&[String]` instead of owning a copy of every string the webview sent.
macro_rules! webapi_command {
    ($name:ident, $inner:path, $ty:ty $(, $arg:ident : $arg_ty:ty)*) => {
        #[tauri::command]
        async fn $name(state: State<'_, TokenState> $(, $arg: $arg_ty)*) -> Result<$ty, String> {
            let access = token::ensure_fresh(&state)?.access_token;
            tauri::async_runtime::spawn_blocking(move || $inner(&access $(, &$arg)*))
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
async fn search_all(
    state: State<'_, TokenState>,
    query: String,
) -> Result<webapi::SearchResults, String> {
    let access = token::ensure_fresh(&state)?.access_token;
    tauri::async_runtime::spawn_blocking(move || webapi::search_all(&access, &query))
        .await
        .map_err(|e| {
            eprintln!("Starless [command_failed]: {e}");
            "command_failed".to_string()
        })?
}

#[tauri::command]
async fn search_tracks(state: State<'_, TokenState>, query: String) -> Result<Vec<Track>, String> {
    let access = token::ensure_fresh(&state)?.access_token;
    tauri::async_runtime::spawn_blocking(move || webapi::search(&access, &query))
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
            set_volume
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}