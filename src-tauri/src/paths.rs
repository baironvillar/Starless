//! Where Starless keeps its files, asked in one place.
//!
//! **On a desktop the answer is `dirs`, and it does not move.** The credentials
//! live in `%APPDATA%\Starless` and everything that must survive a sign-out in
//! `%LOCALAPPDATA%\Starless` (see `AGENTS.md`), and a person who updates keeps
//! both where they were.
//!
//! **On Android `dirs` has no answer.** It falls through to the Linux rules,
//! which want `$HOME`, and an app's process has none: the credentials had
//! nowhere to go and the login could not finish. The app's own sandbox comes
//! from Tauri, which needs a running app to ask — so `setup` hands it here
//! before anything else reads a path. See `docs/android.md`.

use std::path::PathBuf;

#[cfg(mobile)]
use std::sync::OnceLock;

#[cfg(mobile)]
struct Roots {
    local: PathBuf,
    temp: PathBuf,
}

#[cfg(mobile)]
static ROOTS: OnceLock<Roots> = OnceLock::new();

/// Read the sandbox from the running app. Called first thing in `setup`:
/// the log, the crash marker and the session restore all ask for a path.
#[cfg(mobile)]
pub fn init(app: &tauri::AppHandle) {
    use tauri::Manager;
    let path = app.path();
    let (Ok(local), Ok(temp)) = (path.app_local_data_dir(), path.app_cache_dir()) else {
        // Nothing to log into yet: the log is one of the things without a home.
        return;
    };
    let _ = ROOTS.set(Roots { local, temp });
}

/// The base the credential directory hangs from. **Never the same folder as
/// [`data_local_dir`]**: signing out removes the credential directory whole.
pub fn data_dir() -> Option<PathBuf> {
    #[cfg(desktop)]
    return dirs::data_dir();
    #[cfg(mobile)]
    return ROOTS.get().map(|roots| roots.local.join("credentials"));
}

/// The base for what belongs to the person at this machine: settings, the log,
/// the history, the crash marker, the background.
pub fn data_local_dir() -> Option<PathBuf> {
    #[cfg(desktop)]
    return dirs::data_local_dir();
    #[cfg(mobile)]
    return ROOTS.get().map(|roots| roots.local.clone());
}

/// Where librespot writes each track while it downloads.
///
/// **On Android `std::env::temp_dir()` is `/data/local/tmp`**, which an app
/// cannot write: every track failed to load and came back as unavailable —
/// with a live session, so the app blamed the song.
pub fn temp_dir() -> PathBuf {
    #[cfg(desktop)]
    return std::env::temp_dir();
    #[cfg(mobile)]
    return ROOTS
        .get()
        .map(|roots| roots.temp.clone())
        .unwrap_or_else(std::env::temp_dir);
}
