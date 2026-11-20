//! Starless became Star Music, and a person who updates keeps what they had.
//!
//! **Everything with the old name moves once, before anything reads it.** The
//! rename reached the inside too: the folders under `%APPDATA%` and
//! `%LOCALAPPDATA%`, the bundle identifier — which names the folder WebView2
//! keeps its storage in —, the log file, the Soloist key in the Credential
//! Manager and the "start with Windows" entry. Without this, the first launch
//! after the update would be a first launch: signed out, settings gone, the
//! theme back to the default, and a sign-in entry pointing at an executable
//! the installer removed.
//!
//! **A move, never a copy, and never over something that is there.** If the
//! new folder exists, this launch is not the first one, and what is in it is
//! newer than whatever the old one has. If a move fails — a file held open by
//! a Starless that is still running — the app starts with what it has and the
//! old folder stays where it was, for the next launch to try again. Nothing is
//! deleted here.
//!
//! **What does not move:** the Spotify device id (see `auth::session_config`)
//! and the relay's address and its issue marks (see `relay/wrangler.toml`):
//! the first is how Spotify knows this machine, and the second is where the
//! builds already installed send their reports.

use std::path::Path;

/// The bundle identifier while the app was called Starless. WebView2 keeps the
/// page's storage — the theme, the effects, the library's order — under it.
const LEGACY_IDENTIFIER: &str = "app.starless.desktop";

/// Run every step. Called first thing in `run`, before the log exists, so what
/// happened is handed back to be logged once the log is open.
pub fn run(identifier: &str) -> Vec<String> {
    let mut notes = Vec::new();
    #[cfg(desktop)]
    {
        use crate::paths::{APP_DIR, LEGACY_APP_DIR};
        for base in [dirs::data_dir(), dirs::data_local_dir()].into_iter().flatten() {
            move_dir(&base.join(LEGACY_APP_DIR), &base.join(APP_DIR), &mut notes);
            move_dir(&base.join(LEGACY_IDENTIFIER), &base.join(identifier), &mut notes);
        }
        if let Some(base) = dirs::data_local_dir() {
            let dir = base.join(APP_DIR);
            for (old, new) in [("starless.log", "star-music.log"), ("starless.log.1", "star-music.log.1")] {
                move_file(&dir.join(old), &dir.join(new), &mut notes);
            }
        }
        crate::soloist::migrate_key();
        crate::startup::migrate();
    }
    #[cfg(mobile)]
    let _ = identifier;
    notes
}

fn move_dir(old: &Path, new: &Path, notes: &mut Vec<String>) {
    if !old.is_dir() || new.exists() {
        return;
    }
    match std::fs::rename(old, new) {
        Ok(()) => notes.push(format!("migración: {} → {}", old.display(), new.display())),
        Err(error) => notes.push(format!("migración: no se pudo mover {}: {error}", old.display())),
    }
}

fn move_file(old: &Path, new: &Path, notes: &mut Vec<String>) {
    if !old.is_file() || new.exists() {
        return;
    }
    if let Err(error) = std::fs::rename(old, new) {
        notes.push(format!("migración: no se pudo mover {}: {error}", old.display()));
    }
}

#[cfg(test)]
mod tests {
    use super::{move_dir, move_file};

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("star-music-migrate-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn the_old_folder_moves_to_the_new_name() {
        let root = scratch("moves");
        let old = root.join("Starless");
        std::fs::create_dir_all(&old).unwrap();
        std::fs::write(old.join("settings.json"), "{}").unwrap();
        let mut notes = Vec::new();
        move_dir(&old, &root.join("Star Music"), &mut notes);
        assert!(!old.exists());
        assert!(root.join("Star Music").join("settings.json").is_file());
        assert_eq!(notes.len(), 1);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_new_folder_that_exists_is_never_overwritten() {
        let root = scratch("keeps");
        let old = root.join("Starless");
        let new = root.join("Star Music");
        std::fs::create_dir_all(&old).unwrap();
        std::fs::create_dir_all(&new).unwrap();
        std::fs::write(old.join("settings.json"), "viejo").unwrap();
        std::fs::write(new.join("settings.json"), "nuevo").unwrap();
        let mut notes = Vec::new();
        move_dir(&old, &new, &mut notes);
        move_file(&old.join("settings.json"), &new.join("settings.json"), &mut notes);
        assert_eq!(std::fs::read_to_string(new.join("settings.json")).unwrap(), "nuevo");
        assert!(old.join("settings.json").is_file());
        assert!(notes.is_empty());
        let _ = std::fs::remove_dir_all(root);
    }
}
