//! Local library choices, kept outside the credential cache and scoped by account.
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

static WRITES: Mutex<()> = Mutex::new(());

#[derive(Clone, Default, Deserialize, Serialize)]
pub struct Preference {
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub position: Option<u32>,
}

type Library = BTreeMap<String, Preference>;
type Accounts = BTreeMap<String, Library>;

fn path() -> Result<std::path::PathBuf, String> {
    crate::settings::settings_path()
        .and_then(|path| {
            path.parent()
                .map(|parent| parent.join("library-organisation.json"))
        })
        .ok_or_else(|| "command_failed".to_string())
}

fn read(path: &Path) -> Result<Accounts, String> {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| "command_failed".to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Accounts::default()),
        Err(_) => Err("command_failed".to_string()),
    }
}

pub fn load(account: &str) -> Result<Library, String> {
    let _guard = WRITES.lock().map_err(|_| "command_failed".to_string())?;
    let mut library = read(&path()?)?.remove(account).unwrap_or_default();
    normalise(&mut library);
    Ok(library)
}

pub fn save(account: &str, id: &str, preference: Preference) -> Result<Library, String> {
    let _guard = WRITES.lock().map_err(|_| "command_failed".to_string())?;
    save_at(&path()?, account, id, preference)
}

fn save_at(
    path: &Path,
    account: &str,
    id: &str,
    mut preference: Preference,
) -> Result<Library, String> {
    if account.is_empty()
        || account.len() > 256
        || id.len() != 22
        || !id.bytes().all(|byte| byte.is_ascii_alphanumeric())
    {
        return Err("bad_id".to_string());
    }
    let mut accounts = read(path)?;
    let library = accounts.entry(account.to_string()).or_default();
    normalise(library);
    // A pin keeps its own place when archived or restored. A newly pinned list
    // joins the end; the current alphabetical/recent sort never chooses it.
    preference.position = if preference.pinned {
        library
            .get(id)
            .filter(|old| old.pinned)
            .and_then(|old| old.position)
            .or_else(|| Some(library.values().filter(|entry| entry.pinned).count() as u32))
    } else {
        None
    };
    if !preference.pinned && !preference.archived {
        library.remove(id);
    } else {
        library.insert(id.to_string(), preference);
    }
    let updated = library.clone();
    write(path, &accounts)?;
    Ok(updated)
}

fn normalise(library: &mut Library) {
    let mut ids: Vec<String> = library
        .iter()
        .filter(|(_, preference)| preference.pinned)
        .map(|(id, _)| id.clone())
        .collect();
    ids.sort_by(|a, b| {
        library[a]
            .position
            .unwrap_or(u32::MAX)
            .cmp(&library[b].position.unwrap_or(u32::MAX))
            .then_with(|| a.cmp(b))
    });
    for (position, id) in ids.into_iter().enumerate() {
        if let Some(preference) = library.get_mut(&id) {
            preference.position = Some(position as u32);
        }
    }
}

pub fn reorder(account: &str, ids: Vec<String>) -> Result<Library, String> {
    let _guard = WRITES.lock().map_err(|_| "command_failed".to_string())?;
    reorder_at(&path()?, account, ids)
}

fn reorder_at(path: &Path, account: &str, ids: Vec<String>) -> Result<Library, String> {
    if account.is_empty() || account.len() > 256 {
        return Err("bad_id".to_string());
    }
    let mut accounts = read(path)?;
    let library = accounts.entry(account.to_string()).or_default();
    let pinned: BTreeSet<String> = library
        .iter()
        .filter(|(_, value)| value.pinned)
        .map(|(id, _)| id.clone())
        .collect();
    // Reject a stale or incomplete order rather than silently losing a pin.
    if ids.len() != pinned.len() || ids.iter().cloned().collect::<BTreeSet<_>>() != pinned {
        return Err("command_failed".to_string());
    }
    for (position, id) in ids.into_iter().enumerate() {
        if let Some(preference) = library.get_mut(&id) {
            preference.position = Some(position as u32);
        }
    }
    let updated = library.clone();
    write(path, &accounts)?;
    Ok(updated)
}

fn write(path: &Path, accounts: &Accounts) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| "command_failed".to_string())?;
    std::fs::create_dir_all(parent).map_err(|_| "command_failed".to_string())?;
    // Write a sibling first: interruption must not turn every archived list visible.
    let pending = path.with_extension("json.pending");
    let bytes = serde_json::to_vec_pretty(&accounts).map_err(|_| "command_failed".to_string())?;
    std::fs::write(&pending, bytes).map_err(|_| "command_failed".to_string())?;
    std::fs::rename(pending, path).map_err(|_| "command_failed".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestFile(std::path::PathBuf);

    impl TestFile {
        fn new() -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock after epoch")
                .as_nanos();
            Self(std::env::temp_dir().join(format!(
                "star-music-library-{}-{nonce}.json",
                std::process::id()
            )))
        }
    }

    impl Drop for TestFile {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
            let _ = std::fs::remove_file(self.0.with_extension("json.pending"));
        }
    }

    #[test]
    fn saving_and_restoring_one_account_preserves_the_other() {
        let file = TestFile::new();
        let id = "1".repeat(22);
        let archived = Preference {
            pinned: true,
            archived: true,
            position: None,
        };
        save_at(&file.0, "first", &id, archived.clone()).expect("first save");
        save_at(&file.0, "second", &id, archived).expect("replace existing file");
        save_at(&file.0, "first", &id, Preference::default()).expect("restore");
        let accounts = read(&file.0).expect("read saved preferences");
        assert!(!accounts["first"].contains_key(&id));
        assert!(accounts["second"][&id].archived);
        assert!(accounts["second"][&id].pinned);
        assert!(!file.0.with_extension("json.pending").exists());
    }

    #[test]
    fn corrupt_storage_is_reported_without_overwriting_it() {
        let file = TestFile::new();
        std::fs::write(&file.0, b"broken").expect("fixture");
        assert!(save_at(&file.0, "first", &"1".repeat(22), Preference::default()).is_err());
        assert_eq!(
            std::fs::read(&file.0).expect("unchanged fixture"),
            b"broken"
        );
    }

    #[test]
    fn pin_order_survives_reload_and_archive_without_crossing_accounts() {
        let file = TestFile::new();
        let a = "1".repeat(22);
        let b = "2".repeat(22);
        let pin = Preference {
            pinned: true,
            ..Preference::default()
        };
        save_at(&file.0, "first", &a, pin.clone()).expect("pin a");
        save_at(&file.0, "first", &b, pin.clone()).expect("pin b");
        save_at(&file.0, "second", &a, pin.clone()).expect("other account");
        reorder_at(&file.0, "first", vec![b.clone(), a.clone()]).expect("reorder");
        let archived = Preference {
            archived: true,
            ..pin.clone()
        };
        save_at(&file.0, "first", &b, archived).expect("archive");
        let restored = save_at(&file.0, "first", &b, pin).expect("restore");
        assert_eq!(restored[&b].position, Some(0));
        assert_eq!(restored[&a].position, Some(1));
        let reloaded = read(&file.0).expect("reload");
        assert_eq!(reloaded["first"][&b].position, Some(0));
        assert_eq!(reloaded["second"][&a].position, Some(0));
        let before = std::fs::read(&file.0).expect("before invalid order");
        assert!(reorder_at(&file.0, "first", vec![a.clone(), a]).is_err());
        assert_eq!(std::fs::read(&file.0).expect("after invalid order"), before);
    }
}
