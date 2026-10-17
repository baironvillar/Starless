//! Self-test for the part of Starless nobody can see.
//!
//! Whether audio actually comes out depends on four things that all fail
//! silently: the output device opening, librespot's session completing its
//! handshake, Spotify deciding to hand over a decryption key, and the decoder
//! surviving the stream. In a GUI app none of that has anywhere to surface.
//!
//! With `STARLESS_DIAGNOSTIC=1` the backend plays one real track from the
//! account on startup and records the whole chain in `starless.log`. That turns
//! "it doesn't play" into a line to read, which is the difference between
//! debugging and guessing.

use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager};

use crate::playback::PlaybackState;
use crate::{SessionState, TokenState};

/// How long to wait for librespot's handshake before giving up. It opens a
/// connection to Spotify's access point, which is seconds on a good network and
/// never happens on a dead one.
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(25);
const POLL_INTERVAL: Duration = Duration::from_millis(500);

/// `true` when the environment asks for it. Read once, at startup.
pub fn requested() -> bool {
    std::env::var("STARLESS_DIAGNOSTIC")
        .map(|value| value != "0" && !value.is_empty())
        .unwrap_or(false)
}

/// Play one track on the account's behalf, from the account's own library.
pub fn run(app: AppHandle) {
    tauri::async_runtime::spawn_blocking(move || {
        log::info!("=== STARLESS_DIAGNOSTIC: prueba de reproducción ===");

        let Some(session) = wait_for_session(&app) else {
            log::error!("DIAGNOSTIC: la sesión no llegó a conectar en 25s");
            emit(&app, "diagnostic_session_timeout");
            return;
        };
        log::info!(
            "DIAGNOSTIC: sesión conectada como {}",
            session.username()
        );

        // The first liked track: something this account is definitely allowed to
        // play, so a refusal means a refusal and not a guess about permissions.
        let Some((track_id, name)) = first_track(&app) else {
            log::error!("DIAGNOSTIC: no se pudo obtener una pista de prueba");
            emit(&app, "diagnostic_no_track");
            return;
        };
        log::info!("DIAGNOSTIC: probando con {name} ({track_id})");

        let Some(state) = app.try_state::<PlaybackState>() else {
            return;
        };
        crate::playback::ensure_player(&app, &session);

        match crate::playback::play(&state, &track_id, 0, 0) {
            Ok(()) => {
                emit(&app, "diagnostic_load_issued");
                // Give librespot time to fetch keys and start the stream, then say
                // plainly whether it did. The absence of `Playing` here is the
                // finding.
                std::thread::sleep(Duration::from_secs(20));
                let status = state.status();
                log::info!(
                    "DIAGNOSTIC: resultado playing={} loading={} position_ms={} error={:?}",
                    status.playing,
                    status.loading,
                    status.position_ms,
                    status.error
                );
                if status.playing {
                    log::info!("DIAGNOSTIC: OK — el audio está sonando");
                    emit(&app, "diagnostic_ok");
                } else {
                    log::error!(
                        "DIAGNOSTIC: FALLO — no llegó a sonar. Mira las líneas \
                         `audio key` o `Symphonia` justo encima."
                    );
                    emit(&app, "diagnostic_failed");
                }
            }
            Err(code) => {
                log::error!("DIAGNOSTIC: play_track devolvió {code}");
                emit(&app, "diagnostic_command_failed");
            }
        }
    });
}

/// Block until librespot reports a username, which it fills in as the last step
/// of the handshake.
fn wait_for_session(app: &AppHandle) -> Option<librespot_core::Session> {
    let deadline = Instant::now() + HANDSHAKE_TIMEOUT;
    while Instant::now() < deadline {
        if let Some(session) = app.try_state::<SessionState>() {
            if let Ok(guard) = session.0.lock() {
                if let Some(session) = guard.as_ref() {
                    if !session.username().is_empty() {
                        return Some(session.clone());
                    }
                }
            }
        }
        std::thread::sleep(POLL_INTERVAL);
    }
    None
}

/// The first thing this account likes, through the same Web API path the
/// library screen uses — so a failure here is a real signal rather than a test
/// fixture that happens to work.
fn first_track(app: &AppHandle) -> Option<(String, String)> {
    let state = app.try_state::<TokenState>()?;
    let access = crate::token::ensure_fresh(&state).ok()?.access_token;

    let tracks = crate::webapi::liked_tracks(&access).ok()?;
    let track = tracks.into_iter().next()?;
    Some((track.id, track.name))
}

/// Mirror the verdict into the UI as well as the log, so the person looking at
/// the screen is not the only one who has to read a file.
fn emit(app: &AppHandle, verdict: &str) {
    let _ = app.emit("diagnostic://verdict", verdict);
}