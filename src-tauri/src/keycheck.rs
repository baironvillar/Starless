//! Does Spotify hand this account the keys that unlock its audio?
//!
//! Some Premium accounts get every audio key refused (`error audio key 0 1`,
//! librespot #1649): the session connects, the library reads, and no song ever
//! sounds. `keyprobe` measured it on one of them — 0 of 20 keys across every
//! format — so the refusal is the account's, and asking once is enough to know.
//!
//! **Asked at sign-in, not at the first play.** Without this the person found
//! out by pressing play and watching the queue burn through song after song, each
//! one reported as unavailable. Knowing before the first click is what lets the
//! app say the truth while the person is still looking at the library, and offer
//! the way out (`docs/soloist.md`).
//!
//! **Only a refusal counts.** A key that times out, a song with no metadata or a
//! library with nothing in it says nothing about the account, and the verdict
//! stays unknown: warning someone whose account is fine would be the app lying
//! the other way round.
//!
//! It asks for one key and downloads no audio. It is the same request a play
//! makes, done once per session.

use std::sync::Mutex;
use std::time::Duration;

use librespot_core::audio_key::AudioKeyError;
use librespot_core::error::ErrorKind;
use librespot_core::{Session, SpotifyId, SpotifyUri};
use librespot_metadata::audio::AudioFileFormat;
use librespot_metadata::{Metadata, Track as MetaTrack};
use tauri::{AppHandle, Emitter, Manager};

use crate::SessionState;

/// The verdict for the session that is up, or `None` while it is not known.
#[derive(Default)]
pub struct KeyCheckState(Mutex<Option<bool>>);

impl KeyCheckState {
    pub fn refused(&self) -> Option<bool> {
        self.0.lock().ok().and_then(|guard| *guard)
    }

    fn set(&self, verdict: Option<bool>) {
        if let Ok(mut guard) = self.0.lock() {
            *guard = verdict;
        }
    }
}

/// What the frontend hears when the verdict arrives or is cleared.
pub const EVENT: &str = "playback://keys";

/// How long the whole check may take. A key answers in a fraction of a second;
/// past this the network is the question, not the account.
const CHECK_TIMEOUT: Duration = Duration::from_secs(20);

/// The order librespot's 160 kbps default walks, so the key asked for is the
/// one a play would ask for first.
const FORMATS: [AudioFileFormat; 4] = [
    AudioFileFormat::OGG_VORBIS_160,
    AudioFileFormat::OGG_VORBIS_96,
    AudioFileFormat::OGG_VORBIS_320,
    AudioFileFormat::AAC_24,
];

/// Check the session that is being installed, off the calling thread.
///
/// Called from both doors a session comes in through —the restore at launch and
/// the login— right after it is put in its slot. It waits for the handshake the
/// way every command does (`SessionState::ready`).
pub fn spawn(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(state) = app.try_state::<KeyCheckState>() else {
            return;
        };
        state.set(None);
        let Ok(session) = app.state::<SessionState>().ready() else {
            return;
        };
        let verdict = check(&session);
        match verdict {
            Some(true) => log::warn!(
                "[keys_refused] Spotify le niega las claves de audio a esta cuenta; se ofrece Soloist"
            ),
            Some(false) => log::info!("claves de audio: la cuenta las recibe"),
            None => log::info!("claves de audio: no se pudo saber (sin red o sin canciones)"),
        }
        state.set(verdict);
        let _ = app.emit(EVENT, verdict);
        // A refused account that already set Soloist up plays through it
        // from the start, without asking again. Its build is renewed first
        // when it is close to expiring.
        if verdict == Some(true) {
            crate::soloist::renew_if_due(&app);
            if let Err(code) = crate::soloist::start(&app) {
                if code != "soloist_not_installed" && code != "soloist_no_key" {
                    log::warn!("soloist: no arrancó al iniciar sesión ({code})");
                }
            }
        }
    });
}

/// Forget the verdict: the account that earned it signed out.
pub fn clear(app: &AppHandle) {
    if let Some(state) = app.try_state::<KeyCheckState>() {
        state.set(None);
    }
    let _ = app.emit(EVENT, None::<bool>);
}

/// `Some(true)` when Spotify refuses the key, `Some(false)` when it hands it
/// over, `None` when the question could not be asked.
fn check(session: &Session) -> Option<bool> {
    let song = crate::spclient::liked_tracks(session).ok()?.into_iter().next()?;
    let id = SpotifyId::from_base62(&song.id).ok()?;

    let (tx, rx) = std::sync::mpsc::channel();
    let owned = session.clone();
    session.spawn(async move {
        let uri = SpotifyUri::Track { id };
        let verdict = match MetaTrack::get(&owned, &uri).await {
            Ok(track) => match FORMATS.iter().find_map(|format| track.files.get(format)) {
                Some(file) => {
                    verdict(owned.audio_key().request(id, *file).await.map(|_| ()).as_ref().err())
                }
                None => None,
            },
            Err(_) => None,
        };
        let _ = tx.send(verdict);
    });
    rx.recv_timeout(CHECK_TIMEOUT).ok().flatten()
}

/// What one key request says about the account.
///
/// **Only Spotify's own refusal counts, and the kind alone does not say it.**
/// librespot files three different things under `ErrorKind::Unavailable`:
/// Spotify refusing the key (`AudioKeyError::AesKey`), a session that is not
/// connected (`SessionError::NotConnected`) and a network error
/// (`SessionError::IoError`). Reading the kind alone would mark a healthy
/// account as refused whenever its connection dropped during the check — and
/// that account would see the warning and have its real song errors relabelled
/// as `keys_refused`. So the error itself is looked at: an `AesKey` is a
/// refusal, everything else is "could not tell".
pub(crate) fn verdict(error: Option<&librespot_core::Error>) -> Option<bool> {
    let Some(error) = error else {
        return Some(false);
    };
    let refused = error.kind == ErrorKind::Unavailable
        && matches!(
            error.error.downcast_ref::<AudioKeyError>(),
            Some(AudioKeyError::AesKey)
        );
    refused.then_some(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use librespot_core::session::SessionError;

    #[test]
    fn a_key_that_arrives_means_the_account_plays() {
        assert_eq!(verdict(None), Some(false));
    }

    #[test]
    fn only_spotifys_refusal_marks_the_account() {
        let refused: librespot_core::Error = AudioKeyError::AesKey.into();
        assert_eq!(verdict(Some(&refused)), Some(true));
    }

    #[test]
    fn a_dead_connection_is_not_a_refusal() {
        // Same `ErrorKind::Unavailable` as a refusal: the kind alone would lie.
        let gone: librespot_core::Error = SessionError::NotConnected.into();
        assert_eq!(gone.kind, ErrorKind::Unavailable);
        assert_eq!(verdict(Some(&gone)), None);
        let io: librespot_core::Error =
            SessionError::IoError(std::io::Error::other("connection reset")).into();
        assert_eq!(verdict(Some(&io)), None);
    }

    #[test]
    fn a_key_that_never_answers_is_not_a_refusal() {
        let timeout: librespot_core::Error = AudioKeyError::Timeout.into();
        assert_eq!(verdict(Some(&timeout)), None);
        let channel: librespot_core::Error = AudioKeyError::Channel.into();
        assert_eq!(verdict(Some(&channel)), None);
    }
}
