//! Local library choices, kept outside the credential cache and scoped by account.
use std::collections::BTreeMap;
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
}

type Library = BTreeMap<String, Preference>;
type Accounts = BTreeMap<String, Library>;

fn path() -> Result<std::path::PathBuf, String> {
    crate::settings::settings_path()
        .and_then(|path| path.parent().map(|parent| parent.join("library-organisation.json")))
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
    Ok(read(&path()?)?.remove(account).unwrap_or_default())
}

pub fn save(account: &str, id: &str, preference: Preference) -> Result<(), String> {
    let _guard = WRITES.lock().map_err(|_| "command_failed".to_string())?;
    save_at(&path()?, account, id, preference)
}

fn save_at(path: &Path, account: &str, id: &str, preference: Preference) -> Result<(), String> {
    if account.is_empty()
        || account.len() > 256
        || id.len() != 22
        || !id.bytes().all(|byte| byte.is_ascii_alphanumeric())
    {
        return Err("bad_id".to_string());
    }
    let mut accounts = read(path)?;
    let library = accounts.entry(account.to_string()).or_default();
    if !preference.pinned && !preference.archived {
        library.remove(id);
    } else {
        library.insert(id.to_string(), preference);
    }
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
                "starless-library-{}-{nonce}.json",
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
        assert_eq!(std::fs::read(&file.0).expect("unchanged fixture"), b"broken");
    }
}
