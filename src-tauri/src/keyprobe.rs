//! A probe for the one question `error audio key 0 1` leaves open: does
//! Spotify refuse the key for the **account**, or for the **file**?
//!
//! librespot asks for exactly one key per song — the file its bitrate order
//! picks — and gives up when that one is refused. A song offers four files
//! (OGG 96/160/320 and AAC), and alternatives may offer more. If the refusal is
//! per file, asking for another file's key through the same official channel
//! would play the song. If every file is refused, the refusal is the account's
//! and there is nothing to ask for (librespot #1649).
//!
//! `STARLESS_SP_KEYS=1` runs it once, a few seconds after the session is up,
//! against the first liked songs. It only asks for keys — it downloads no audio
//! and writes no key to the log, only whether it came. Debug only, like the
//! other probes.

#![cfg(debug_assertions)]

use std::time::Duration;

use librespot_core::{Session, SpotifyId, SpotifyUri};
use librespot_metadata::{Metadata, Track as MetaTrack};
use tauri::AppHandle;

/// How many songs to ask about. Enough to tell "every song" from "this song".
const SONGS: usize = 5;

pub fn requested() -> bool {
    std::env::var("STARLESS_SP_KEYS")
        .map(|value| value != "0" && !value.is_empty())
        .unwrap_or(false)
}

pub fn run(app: AppHandle) {
    tauri::async_runtime::spawn_blocking(move || {
        log::info!("=== STARLESS_SP_KEYS: una clave por archivo ===");
        let Some(session) = crate::selftest::wait_for_session(&app) else {
            log::error!("keys: la sesión no llegó a conectar");
            return;
        };
        let tracks = match crate::spclient::liked_tracks(&session) {
            Ok(tracks) => tracks,
            Err(error) => {
                log::error!("keys: no se pudieron leer las canciones guardadas: {error}");
                return;
            }
        };
        let ids: Vec<String> = tracks.into_iter().take(SONGS).map(|track| track.id).collect();

        let (tx, rx) = std::sync::mpsc::channel();
        let owned = session.clone();
        session.spawn(async move {
            let (mut granted, mut refused) = (0usize, 0usize);
            for id in ids {
                let Ok(spotify_id) = SpotifyId::from_base62(&id) else { continue };
                let uri = SpotifyUri::Track { id: spotify_id };
                let mut candidates = vec![uri.clone()];
                match MetaTrack::get(&owned, &uri).await {
                    Ok(track) => {
                        candidates.extend(track.alternatives.iter().cloned());
                        for candidate in candidates {
                            let (g, r) = ask_every_file(&owned, &id, &candidate).await;
                            granted += g;
                            refused += r;
                        }
                    }
                    Err(error) => log::warn!("keys: {id}: sin metadata: {error}"),
                }
            }
            let _ = tx.send((granted, refused));
        });

        match rx.recv_timeout(Duration::from_secs(120)) {
            Ok((granted, refused)) => log::info!(
                "keys: RESULTADO {granted} claves entregadas, {refused} negadas{}",
                if granted == 0 && refused > 0 {
                    " — la negativa es de la cuenta, no del archivo"
                } else if granted > 0 && refused > 0 {
                    " — la negativa es por archivo: hay formatos que sí suenan"
                } else {
                    ""
                }
            ),
            Err(_) => log::error!("keys: la sonda no terminó en dos minutos"),
        }
    });
}

/// Ask for the key of every file one track offers, and say which came.
async fn ask_every_file(session: &Session, song: &str, uri: &SpotifyUri) -> (usize, usize) {
    let track = if let SpotifyUri::Track { .. } = uri {
        match MetaTrack::get(session, uri).await {
            Ok(track) => track,
            Err(error) => {
                log::warn!("keys: {song} ({uri}): sin metadata: {error}");
                return (0, 0);
            }
        }
    } else {
        return (0, 0);
    };
    let SpotifyUri::Track { id } = uri else { return (0, 0) };
    let mut files: Vec<_> = track.files.iter().map(|(format, file)| (*format, *file)).collect();
    files.sort_by_key(|(format, _)| format!("{format:?}"));
    let (mut granted, mut refused) = (0, 0);
    for (format, file) in files {
        let verdict = match session.audio_key().request(*id, file).await {
            Ok(_) => {
                granted += 1;
                "ENTREGADA".to_string()
            }
            Err(error) => {
                refused += 1;
                format!("negada ({error})")
            }
        };
        // One at a time: each request is awaited before the next, so the answer
        // is about the file and not about a burst.
        log::info!("keys: {song} via {uri} {format:?}: {verdict}");
    }
    (granted, refused)
}
