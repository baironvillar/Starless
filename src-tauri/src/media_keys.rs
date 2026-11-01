// The media keys and the "now playing" card that Windows shows over the volume
// flyout and on the lock screen.
//
// **Both are the same thing to Windows: the System Media Transport Controls.**
// The play/pause key on a keyboard or a headset is not a keypress that reaches
// the focused window — Windows routes it to whichever app owns the current
// media session. An app with no session never hears the key, minimised or not,
// and that is why a `keydown` listener in the webview could never be this.
//
// The session is borrowed from a `MediaPlayer` that never plays anything. That
// is the documented way for a desktop app to reach the controls without a
// `CoreWindow`: the player brings its own session, and turning its command
// manager off leaves the buttons to us instead of to a player with no source.
//
// The buttons do not act here. They are sent to the webview as `media://key`,
// because what "next" means — the queue, the DJ, the radio — lives in
// `App.tsx`, and a second copy of that decision in Rust would drift from the
// one the player bar uses.

use serde::Deserialize;

/// What the card shows. `None` from the frontend means nothing is loaded.
#[derive(Debug, Clone, Deserialize)]
pub struct NowPlaying {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub artwork: Option<String>,
    pub playing: bool,
}

/// Tell Windows which app this process is, so the media card says "Starless"
/// with its icon instead of "Unknown application".
///
/// **Windows names a media session by the process's AppUserModelID, and an
/// unpackaged process only has one when it was launched from a shortcut that
/// carries it.** The installer's Start menu shortcut does
/// (`System.AppUserModel.ID` = the bundle identifier), so a Starless opened
/// from there was named and every other Starless — `bun run app`, the relaunch
/// after an update, the `.exe` double-clicked — was an unknown app. Claiming
/// the same id by hand makes every launch the one from the shortcut: Windows
/// finds that shortcut by the id, and takes the name and the icon from it.
/// Where no shortcut exists (a machine that never installed it) the card
/// stays unnamed; nothing else changes.
///
/// **Only in release.** The id takes the taskbar icon from the shortcut too,
/// and on a development machine that shortcut points at whatever version is
/// installed: `bun run app` came up with the installed 0.5.4's old star in the
/// taskbar and on the card, instead of its own inverted icon. A dev build
/// keeps its own icon and an unnamed card; the installed build is the
/// shortcut's own target, so its icon is the right one.
pub fn claim_app_id(id: &str) {
    #[cfg(all(windows, not(debug_assertions)))]
    {
        use windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;
        use windows::core::HSTRING;
        // SAFETY: a plain Win32 call with an owned, NUL-terminated string that
        // outlives it; it touches no memory of ours afterwards.
        if let Err(error) = unsafe { SetCurrentProcessExplicitAppUserModelID(&HSTRING::from(id)) } {
            log::warn!("teclas multimedia: Windows no aceptó el id de la app: {error}");
        }
    }
    #[cfg(any(not(windows), debug_assertions))]
    let _ = id;
}

#[cfg(windows)]
mod imp {
    use std::sync::Mutex;
    use std::sync::mpsc::{Sender, channel};

    use tauri::{AppHandle, Emitter};
    use windows::Foundation::{TypedEventHandler, Uri};
    use windows::Media::Playback::MediaPlayer;
    use windows::Media::{
        MediaPlaybackStatus, MediaPlaybackType, SystemMediaTransportControls,
        SystemMediaTransportControlsButton, SystemMediaTransportControlsButtonPressedEventArgs,
    };
    use windows::Storage::Streams::RandomAccessStreamReference;
    use windows::core::{HSTRING, Ref};

    use super::NowPlaying;

    /// The way into the thread that owns the controls.
    ///
    /// **The WinRT objects never leave that thread.** The thread holds the
    /// player for the whole run — dropping it ends the session and the keys
    /// go back to whoever had them — and everything else only sends it what
    /// to show.
    pub struct MediaKeys(Mutex<Option<Sender<Option<NowPlaying>>>>);

    impl MediaKeys {
        pub fn start(app: AppHandle) -> Self {
            let (tx, rx) = channel::<Option<NowPlaying>>();
            let spawned = std::thread::Builder::new()
                .name("media-keys".into())
                .spawn(move || {
                    let controls = match open(app) {
                        Ok(controls) => controls,
                        Err(error) => {
                            // Not fatal: the app plays the same without the
                            // keys, and saying so is the whole recovery.
                            log::warn!("teclas multimedia: no se pudo abrir la sesión de Windows: {error}");
                            return;
                        }
                    };
                    let (_player, smtc) = controls;
                    while let Ok(now) = rx.recv() {
                        if let Err(error) = show(&smtc, now.as_ref()) {
                            log::warn!("teclas multimedia: no se pudo actualizar la tarjeta: {error}");
                        }
                    }
                });
            if let Err(error) = &spawned {
                log::warn!("teclas multimedia: no se pudo arrancar el hilo: {error}");
            }
            Self(Mutex::new(spawned.ok().map(|_| tx)))
        }

        pub fn update(&self, now: Option<NowPlaying>) {
            if let Ok(guard) = self.0.lock() {
                if let Some(tx) = guard.as_ref() {
                    let _ = tx.send(now);
                }
            }
        }
    }

    fn open(app: AppHandle) -> windows::core::Result<(MediaPlayer, SystemMediaTransportControls)> {
        let player = MediaPlayer::new()?;
        // Without this the player answers the buttons itself — with a source
        // that does not exist — and our handler sees nothing.
        player.CommandManager()?.SetIsEnabled(false)?;
        let smtc = player.SystemMediaTransportControls()?;
        smtc.SetIsPlayEnabled(true)?;
        smtc.SetIsPauseEnabled(true)?;
        smtc.SetIsNextEnabled(true)?;
        smtc.SetIsPreviousEnabled(true)?;
        // Hidden until something is loaded: a card that says nothing is
        // playing is a card about a state the person can already see.
        smtc.SetIsEnabled(false)?;
        smtc.ButtonPressed(&TypedEventHandler::new(
            move |_: Ref<SystemMediaTransportControls>,
                  args: Ref<SystemMediaTransportControlsButtonPressedEventArgs>| {
                let key = match args.ok()?.Button()? {
                    SystemMediaTransportControlsButton::Play => "play",
                    SystemMediaTransportControlsButton::Pause => "pause",
                    SystemMediaTransportControlsButton::Next => "next",
                    SystemMediaTransportControlsButton::Previous => "previous",
                    _ => return Ok(()),
                };
                let _ = app.emit("media://key", key);
                Ok(())
            },
        ))?;
        Ok((player, smtc))
    }

    fn show(smtc: &SystemMediaTransportControls, now: Option<&NowPlaying>) -> windows::core::Result<()> {
        let Some(now) = now else {
            return smtc.SetIsEnabled(false);
        };
        smtc.SetIsEnabled(true)?;
        smtc.SetPlaybackStatus(if now.playing {
            MediaPlaybackStatus::Playing
        } else {
            MediaPlaybackStatus::Paused
        })?;
        let display = smtc.DisplayUpdater()?;
        display.SetType(MediaPlaybackType::Music)?;
        let music = display.MusicProperties()?;
        music.SetTitle(&HSTRING::from(&now.title))?;
        music.SetArtist(&HSTRING::from(&now.artist))?;
        music.SetAlbumTitle(&HSTRING::from(&now.album))?;
        // A cover that fails to parse is a card without a cover, not a card
        // that never updates: the title is the part that matters.
        let thumbnail = now
            .artwork
            .as_deref()
            .and_then(|url| Uri::CreateUri(&HSTRING::from(url)).ok())
            .and_then(|uri| RandomAccessStreamReference::CreateFromUri(&uri).ok());
        display.SetThumbnail(thumbnail.as_ref())?;
        display.Update()
    }
}

#[cfg(not(windows))]
mod imp {
    use tauri::AppHandle;

    use super::NowPlaying;

    /// Windows is the only platform Starless ships on; elsewhere the keys are
    /// simply not there.
    pub struct MediaKeys;

    impl MediaKeys {
        pub fn start(_app: AppHandle) -> Self {
            Self
        }

        pub fn update(&self, _now: Option<NowPlaying>) {}
    }
}

pub use imp::MediaKeys;
