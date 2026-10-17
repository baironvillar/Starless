//! The handful of choices that should survive a restart.
//!
//! Small on purpose. A setting that nobody has been asked to change twice does not
//! belong in a file.
//!
//! **`%LOCALAPPDATA%`, never the credential directory, and the reason is a bug this
//! project already hit once.** `auth::forget_credentials` answers sign-out with
//! `remove_dir_all` over the whole cache directory, so anything sitting beside
//! `credentials.json` is deleted along with it — the log used to live there, and
//! signing out deleted the log mid-write. Volume has the same argument in reverse:
//! it describes the machine the user is listening on, not the account they are
//! signed into, so signing out has no business resetting it. `%LOCALAPPDATA%` is
//! the directory that sign-out never touches, and it is already ours because the
//! log lives there.
//!
//! ## A missing or corrupt file is the default, not an error
//!
//! Settings are a convenience, and a convenience that can stop the app from
//! starting is not one. A first run has no file; a file truncated by a power cut
//! has no volume. Both answers are "whatever the default is", and the app opens.

use std::fs;
use std::path::PathBuf;

/// Where the file lives.
pub fn settings_path() -> Option<PathBuf> {
    dirs::data_local_dir().map(|base| base.join("Starless").join("settings.json"))
}

/// Every field is optional, and every field defaults.
///
/// `#[serde(default)]` is what makes a file written by an older build readable by
/// a newer one: a key that did not exist yet simply comes back as `None` instead of
/// failing the whole parse.
#[derive(Default, serde::Serialize, serde::Deserialize)]
pub struct Settings {
    /// The user's chosen volume, on librespot's 0..=65535 scale.
    ///
    /// Stored **before** attenuation. `PlaybackState::apply_volume` maps this
    /// quadratically on the way to the audio device, so persisting the attenuated
    /// value instead would re-apply the curve on every launch and quietly fade the
    /// volume a little further each time.
    #[serde(default)]
    pub volume: Option<u16>,
}

/// Read the settings, or the defaults.
///
/// Never fails: an unreadable file is logged and treated as absent, because the
/// alternative is a settings file that can wedge the app on startup.
pub fn load() -> Settings {
    let Some(path) = settings_path() else {
        return Settings::default();
    };
    let Ok(raw) = fs::read_to_string(&path) else {
        return Settings::default();
    };
    match serde_json::from_str(&raw) {
        Ok(settings) => settings,
        Err(e) => {
            log::warn!("ajustes ilegibles, se usan los valores por defecto: {e}");
            Settings::default()
        }
    }
}

/// Remember one volume. Failures are logged and otherwise ignored.
///
/// Called on every step of the volume slider, so this runs a handful of times per
/// drag. That is fine at this size — a ~30 byte file, written a few dozen times
/// while a thumb moves — and it buys a synchronous save with no thread, no timer
/// and no "the last volume before the app closed is the one you didn't save" edge
/// case.
pub fn save_volume(volume: u16) {
    let Some(path) = settings_path() else {
        return;
    };
    if let Some(parent) = path.parent()
        && let Err(e) = fs::create_dir_all(parent)
    {
        log::warn!("no se pudo crear el directorio de ajustes: {e}");
        return;
    }

    // Read-modify-write rather than a fresh `Settings { volume: Some(..) }`: the day
    // a second field appears, this keeps working without remembering to touch it.
    let mut settings = load();
    if settings.volume == Some(volume) {
        return;
    }
    settings.volume = Some(volume);

    match serde_json::to_string_pretty(&settings) {
        Ok(json) => {
            if let Err(e) = fs::write(&path, json) {
                log::warn!("no se pudo guardar el volumen: {e}");
            }
        }
        Err(e) => log::warn!("no se pudo serializar los ajustes: {e}"),
    }
}

/// The volume to open at, or `None` when the user has never chosen one.
pub fn saved_volume() -> Option<u16> {
    load().volume
}