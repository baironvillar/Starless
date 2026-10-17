//! A log that outlives the terminal.
//!
//! Starless is a windowed app. Someone double-clicking it has no console, so a
//! message written to stderr goes nowhere and the app just silently refuses to
//! make a sound. That is exactly how two root causes went unnoticed here: a
//! wrong client id, and Spotify refusing to hand over audio keys.
//!
//! So the log goes to a file next to the credentials, and the settings panel can
//! show that path. `RUST_LOG` still overrides the filter for anyone debugging
//! from a terminal.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::PathBuf;

/// Roll the file over once it gets this big. Big enough to hold a full session of
/// `librespot=debug`, small enough not to matter on disk.
const MAX_BYTES: u64 = 2 * 1024 * 1024;

/// Where the log lives. Shown to the user in Ajustes so a bug report can carry
/// the actual evidence instead of a description of it.
///
/// **`%LOCALAPPDATA%`, not the credential directory, and that separation is the
/// whole point.** Signing out deletes `credentials.json` along with everything
/// else beside it — and when the log shared that folder, signing out deleted the
/// log too, mid-write, leaving env_logger holding a handle to a file that no
/// longer had a name. Every question asked after a sign-out was then
/// unanswerable, which is exactly when an answer is most needed.
///
/// Windows already draws this line: `%APPDATA%` roams with the profile and holds
/// the user's data, `%LOCALAPPDATA%` stays on the machine and holds what belongs
/// to this installation. A log belongs to the second kind.
pub fn log_path() -> Option<PathBuf> {
    dirs::data_local_dir().map(|base| base.join("Starless").join("starless.log"))
}

/// Writes each line to both the file and the terminal.
///
/// A GUI app has no terminal, but a developer running `bun run tauri dev` does,
/// and losing the console stream would make development strictly worse than it
/// is now. `env_logger` installs exactly one target, so the tee is ours to make.
struct Tee {
    file: File,
    to_terminal: bool,
}

impl Write for Tee {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        // The file is the point. A failure there must not take the console with
        // it, and must not take the app down either.
        if self.to_terminal {
            let _ = io::stderr().write_all(buf);
        }
        match self.file.write_all(buf) {
            Ok(()) => Ok(buf.len()),
            Err(e) => {
                eprintln!("Starless: no se pudo escribir el log: {e}");
                self.to_terminal = true;
                Ok(buf.len())
            }
        }
    }

    fn flush(&mut self) -> io::Result<()> {
        if self.to_terminal {
            let _ = io::stderr().flush();
        }
        self.file.flush()
    }
}

/// Rotate rather than truncate.
///
/// `cargo tauri dev` restarts the backend dozens of times while someone is
/// iterating, and a debug log that is wiped on every launch is a log that never
/// contains the launch you needed. One generation of history is enough.
fn open_log_file(path: &PathBuf) -> io::Result<File> {
    if let Ok(meta) = fs::metadata(path) {
        if meta.len() >= MAX_BYTES {
            let previous = path.with_extension("log.1");
            let _ = fs::remove_file(&previous);
            let _ = fs::rename(path, &previous);
        }
    }
    OpenOptions::new().create(true).append(true).open(path)
}

/// Install the logger. Called once, from `setup`.
///
/// Failures are deliberately non-fatal: an app that cannot write a log file
/// should still be an app that runs.
pub fn init() {
    // `starless_lib`, not `starless`: `env_logger` matches the crate name as
    // compiled, and the lib target carries the `_lib` suffix that Windows needs.
    // Getting this wrong filters out every line Starless writes about itself,
    // which leaves only librespot's — and librespot's is not the half that
    // explains our own decisions.
    let mut builder = env_logger::Builder::from_env(
        env_logger::Env::default()
            .default_filter_or("warn,librespot=info,starless_lib=info"),
    );
    builder.format_timestamp_millis();

    match log_path().and_then(|path| {
        fs::create_dir_all(path.parent()?).ok()?;
        open_log_file(&path).ok()
    }) {
        Some(file) => {
            let tee = Tee {
                file,
                to_terminal: true,
            };
            builder.target(env_logger::Target::Pipe(Box::new(tee)));
            builder.init();
            log::info!("log abierto en {}", log_path().unwrap_or_default().display());
        }
        None => {
            // No file, but the console is still worth having.
            builder.init();
            eprintln!("Starless [log_unavailable]: no se pudo abrir el archivo de log");
        }
    }
}