//! The picture the person puts behind the glass.
//!
//! **One file in `%LOCALAPPDATA%\Starless`, beside the settings, and for the same
//! reason.** Sign-out runs `remove_dir_all` over the credential directory; a
//! wallpaper describes the person at this machine, not the account, and losing it
//! every time someone signs out would be the same bug the log already paid for.
//!
//! The bytes cross the bridge raw, both ways. A picture is megabytes, and the
//! default JSON body would turn every byte into a number in an array — five
//! megabytes of photo into twenty of text, parsed on the main thread.
//!
//! The file is **copied in**, not referenced where the person picked it: a photo
//! in Downloads gets cleaned up, a USB stick gets unplugged, and a background that
//! silently goes back to black on the next launch is a setting that forgot itself.

use std::fs;
use std::path::PathBuf;

use tauri::ipc::{InvokeBody, Request, Response};

/// Where the copy lives. No extension: the webview sniffs the format, and one
/// fixed name means replacing a PNG with a JPEG never leaves the old one behind.
fn image_path() -> Option<PathBuf> {
    crate::settings::settings_path().map(|path| path.with_file_name("background"))
}

/// Big enough for any photo off a phone or a 4K wallpaper, small enough that a
/// mistaken pick of a RAW file is refused instead of read into memory twice.
const MAX_BYTES: usize = 25 * 1024 * 1024;

/// PNG, JPEG, WebP and GIF, by their first bytes rather than by the name the
/// file came with: a `.jpg` that is really a PDF would otherwise be stored, and
/// the window would answer it with a black background and no reason.
fn is_supported(bytes: &[u8]) -> bool {
    bytes.starts_with(&[0x89, b'P', b'N', b'G'])
        || bytes.starts_with(&[0xFF, 0xD8, 0xFF])
        || bytes.starts_with(b"GIF8")
        || (bytes.len() > 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP")
}

/// The saved picture, or an empty body when there is none. Empty and not an
/// error, because no picture is the normal answer on every first run.
#[tauri::command]
pub async fn background_image() -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let bytes = image_path().and_then(|path| fs::read(path).ok()).unwrap_or_default();
        Response::new(bytes)
    })
    .await
    .map_err(|_| "command_failed".to_string())
}

/// Store a new picture. The body is the file itself, raw.
#[tauri::command]
pub async fn set_background_image(request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("image_unsupported".into());
    };
    if bytes.len() > MAX_BYTES {
        return Err("image_too_large".into());
    }
    if !is_supported(bytes) {
        return Err("image_unsupported".into());
    }
    let bytes = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || write(&bytes))
        .await
        .map_err(|_| "command_failed".to_string())?
}

/// Written beside and then renamed over: a crash halfway through a write would
/// otherwise leave half a JPEG, and the next launch would draw the top of it.
fn write(bytes: &[u8]) -> Result<(), String> {
    let path = image_path().ok_or("command_failed")?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            log::warn!("fondo: no se pudo crear el directorio: {e}");
            "command_failed".to_string()
        })?;
    }
    let partial = path.with_file_name("background.partial");
    fs::write(&partial, bytes)
        .and_then(|()| fs::rename(&partial, &path))
        .map_err(|e| {
            log::warn!("fondo: no se pudo guardar la imagen: {e}");
            let _ = fs::remove_file(&partial);
            "command_failed".to_string()
        })
}

/// Forget the picture. A file that is already gone is the outcome asked for.
#[tauri::command]
pub async fn clear_background_image() -> Result<(), String> {
    let Some(path) = image_path() else {
        return Ok(());
    };
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => {
            log::warn!("fondo: no se pudo borrar la imagen: {e}");
            Err("command_failed".into())
        }
    }
}

/// How dark and how soft the picture is drawn, as percentages of the range the
/// frontend maps them onto.
#[derive(serde::Serialize)]
pub struct Look {
    pub dim: u8,
    pub blur: u8,
}

#[tauri::command]
pub fn background_look() -> Look {
    let (dim, blur) = crate::settings::saved_background_look();
    Look { dim, blur }
}

#[tauri::command]
pub fn set_background_look(dim: u8, blur: u8) {
    crate::settings::save_background_look(dim, blur);
}

#[cfg(test)]
mod tests {
    use super::is_supported;

    #[test]
    fn the_format_is_read_from_the_bytes_not_the_name() {
        assert!(is_supported(b"\x89PNG\r\n\x1a\n...."));
        assert!(is_supported(b"\xFF\xD8\xFF\xE0...."));
        assert!(is_supported(b"RIFF\0\0\0\0WEBPVP8 "));
        assert!(!is_supported(b"%PDF-1.7"));
        assert!(!is_supported(b"RIFF\0\0\0\0WAVEfmt "));
        assert!(!is_supported(b""));
    }
}
