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

    /// How opaque the menus are, as a percentage.
    ///
    /// The user's own glass. It exists because `glass-overlay` cannot promise to
    /// stay readable on its own: the blur it leans on is not rendered in the
    /// packaged build, and how much translucency someone is willing to trade for
    /// depth is their call, not the design system's.
    #[serde(default)]
    pub menu_opacity: Option<u8>,

    /// The accent colour the user picked, as `#rrggbb`, or `None` for the one
    /// DESIGN.md ships.
    ///
    /// A string rather than three bytes because this one is never read back in
    /// Rust: the frontend applies it to a CSS variable, and the only thing Rust
    /// does with it is refuse a value that is not a colour. See `save_accent`.
    #[serde(default)]
    pub accent: Option<String>,
}

/// Read-modify-write, so the day a third field appears this keeps working
/// without anyone having to remember to touch it.
fn update(change: impl FnOnce(&mut Settings)) {
    let Some(path) = settings_path() else {
        return;
    };
    if let Some(parent) = path.parent()
        && let Err(e) = fs::create_dir_all(parent)
    {
        log::warn!("no se pudo crear el directorio de ajustes: {e}");
        return;
    }

    let mut settings = load();
    change(&mut settings);

    match serde_json::to_string_pretty(&settings) {
        Ok(json) => {
            if let Err(e) = fs::write(&path, json) {
                log::warn!("no se pudieron guardar los ajustes: {e}");
            }
        }
        Err(e) => log::warn!("no se pudo serializar los ajustes: {e}"),
    }
}

/// How opaque the menus are when nobody has said otherwise.
///
/// Translucent, at the bottom of the range: this is the glass DESIGN.md is written
/// around, and it was solid only while the packaged build shipped a dead blur — at
/// 55% with nothing blurring it you could read the library straight through the
/// settings panel. Now that the blur is back, the translucent surface is the safe
/// one again, and the slider goes up from here for whoever wants it solid.
pub const DEFAULT_MENU_OPACITY: u8 = 55;

/// The ends of the slider. The floor is where the blur stops turning what is
/// behind a menu into a smear and starts letting it back into being text.
pub const MENU_OPACITY_MIN: u8 = 55;
pub const MENU_OPACITY_MAX: u8 = 100;

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
    // Called on every step of the volume slider, so this runs a handful of times
    // per drag. That is fine at this size — a ~30 byte file, written a few dozen
    // times while a thumb moves — and it buys a synchronous save with no thread,
    // no timer and no "the last volume before the app closed is the one you
    // didn't save" edge case.
    if load().volume == Some(volume) {
        return;
    }
    update(|settings| settings.volume = Some(volume));
}

/// Remember how opaque the menus should be. Clamped on the way in, because this
/// value ends up in a CSS colour and a slider is only a suggestion.
pub fn save_menu_opacity(opacity: u8) {
    let opacity = opacity.clamp(MENU_OPACITY_MIN, MENU_OPACITY_MAX);
    if load().menu_opacity == Some(opacity) {
        return;
    }
    update(|settings| settings.menu_opacity = Some(opacity));
}

/// Remember the accent colour. Refuses anything that is not `#rrggbb`.
///
/// This is the one setting in the file whose value becomes a CSS custom
/// property on `:root`, so it is the one that can put a string written por
/// alguien en la página entera. The check lives here and not in the frontend
/// because the frontend is the part that can be talked into skipping it.
pub fn save_accent(color: &str) {
    if !is_hex_color(color) {
        log::warn!("color de acento ignorado, no es #rrggbb: {color}");
        return;
    }
    let color = color.to_ascii_lowercase();
    if load().accent.as_deref() == Some(color.as_str()) {
        return;
    }
    update(|settings| settings.accent = Some(color));
}

/// The chosen accent, or `None` to leave the one from DESIGN.md in place.
///
/// Checked on the way out too, not only on the way in: a `settings.json` is a
/// file on disk and a hand edit is as likely as a bad write. A colour that is
/// not a colour falls back to the default instead of reaching the page.
pub fn saved_accent() -> Option<String> {
    let accent = load().accent?;
    is_hex_color(&accent).then(|| accent.to_ascii_lowercase())
}

fn is_hex_color(value: &str) -> bool {
    let Some(hex) = value.strip_prefix('#') else {
        return false;
    };
    hex.len() == 6 && hex.bytes().all(|b| b.is_ascii_hexdigit())
}

/// The volume to open at, or `None` when the user has never chosen one.
pub fn saved_volume() -> Option<u16> {
    load().volume
}

/// The chosen menu opacity, already clamped, or the default.
pub fn saved_menu_opacity() -> u8 {
    load()
        .menu_opacity
        .unwrap_or(DEFAULT_MENU_OPACITY)
        .clamp(MENU_OPACITY_MIN, MENU_OPACITY_MAX)
}

#[cfg(test)]
mod tests {
    use super::is_hex_color;

    /// The accent is the one setting whose value is written onto `:root`, so the
    /// gate that keeps it a colour is the test that matters. A `settings.json` is
    /// a file on disk: a hand edit is as likely as a bad write, and whatever is in
    /// it ends up in the page.
    #[test]
    fn only_six_hex_digits_count_as_a_colour() {
        assert!(is_hex_color("#c9f73c"));
        assert!(is_hex_color("#C9F73C"), "mayúsculas, se normalizan después");

        assert!(!is_hex_color("c9f73c"), "sin el # no es un color CSS");
        assert!(!is_hex_color("#c9f73"), "cinco dígitos");
        assert!(!is_hex_color("#c9f73cff"), "ocho dígitos");
        assert!(!is_hex_color("#c9f73g"), "g no es hexadecimal");
        assert!(!is_hex_color("#-9f73c"), "guion donde va un dígito");
        assert!(!is_hex_color(""), "vacío");
    }

    /// What the check is actually for: a value that would end the property and
    /// start another one.
    #[test]
    fn a_value_that_would_escape_the_property_is_refused() {
        assert!(!is_hex_color("#c9f73c; background: red"));
        assert!(!is_hex_color("#c9f73c;} :root{--color-accent:red"));
        assert!(!is_hex_color("url(javascript:alert(1))"));
    }
}