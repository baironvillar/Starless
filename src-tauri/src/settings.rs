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

    /// How many seconds two songs overlap when one ends on its own; 0 is off.
    ///
    /// It describes how the person likes to listen on this machine, like the
    /// volume, so it lives here and survives a sign-out.
    #[serde(default)]
    pub crossfade_seconds: Option<u8>,

    /// The accent colour the user picked, as `#rrggbb`, or `None` for the one
    /// DESIGN.md ships.
    ///
    /// A string rather than three bytes because this one is never read back in
    /// Rust: the frontend applies it to a CSS variable, and the only thing Rust
    /// does with it is refuse a value that is not a colour. See `save_accent`.
    #[serde(default)]
    pub accent: Option<String>,

    /// How the library is ordered, as one of [`LIBRARY_SORTS`].
    ///
    /// A string rather than an enum because this file outlives any build: a value a
    /// later version drops still has to deserialise. `saved_library_sort` is what
    /// checks it.
    #[serde(default)]
    pub library_sort: Option<String>,

    /// Grid or list, as one of [`LIBRARY_VIEWS`]. Same reasoning as `library_sort`.
    #[serde(default)]
    pub library_view: Option<String>,
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

/// Remember the crossfade. Clamped on the way in, like the opacity: a slider
/// is only a suggestion, and the audio thread reads this number.
pub fn save_crossfade_seconds(seconds: u8) {
    let seconds = seconds.min(crate::crossfade::MAX_SECONDS as u8);
    if load().crossfade_seconds == Some(seconds) {
        return;
    }
    update(|settings| settings.crossfade_seconds = Some(seconds));
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

/// How the library opens: by name, and which way round.
pub const DEFAULT_LIBRARY_SORT: &str = "name-asc";

/// The four orders the data can answer. Anything else in the file is ignored.
pub const LIBRARY_SORTS: [&str; 4] = ["name-asc", "name-desc", "creator", "tracks"];

/// Which way the shelf is drawn. The grid is the one that ships, because the card
/// is what the artwork is for.
pub const DEFAULT_LIBRARY_VIEW: &str = "grid";

pub const LIBRARY_VIEWS: [&str; 2] = ["grid", "list"];

/// Remember how the library is ordered.
///
/// Refuses anything outside [`LIBRARY_SORTS`] for the reason `save_accent` refuses
/// anything that is not a colour: a `settings.json` is a file on disk, and a value
/// that reaches the frontend as an order is a switch statement with a hole in it.
pub fn save_library_sort(sort: &str) {
    if !LIBRARY_SORTS.contains(&sort) {
        log::warn!("orden de biblioteca ignorado, no es una orden conocida: {sort}");
        return;
    }
    if load().library_sort.as_deref() == Some(sort) {
        return;
    }
    update(|settings| settings.library_sort = Some(sort.to_string()));
}

/// Same gate on the way out as on the way in. See `saved_accent`.
pub fn saved_library_sort() -> &'static str {
    known_or_default(load().library_sort.as_deref(), &LIBRARY_SORTS, DEFAULT_LIBRARY_SORT)
}

pub fn save_library_view(view: &str) {
    if !LIBRARY_VIEWS.contains(&view) {
        log::warn!("vista de biblioteca ignorada, no es una vista conocida: {view}");
        return;
    }
    if load().library_view.as_deref() == Some(view) {
        return;
    }
    update(|settings| settings.library_view = Some(view.to_string()));
}

pub fn saved_library_view() -> &'static str {
    known_or_default(load().library_view.as_deref(), &LIBRARY_VIEWS, DEFAULT_LIBRARY_VIEW)
}

/// The saved value when it is one this build knows, and the default when it is not.
///
/// A hand-edited file is as likely as a bad write, and an order this build does not
/// know would reach the frontend and leave a switch with no case that matches.
fn known_or_default<'a>(
    saved: Option<&str>,
    known: &[&'a str],
    default: &'a str,
) -> &'a str {
    saved
        .and_then(|value| known.iter().find(|option| **option == value).copied())
        .unwrap_or(default)
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

/// The chosen crossfade in seconds, or 0 — off — when it was never chosen.
pub fn saved_crossfade_seconds() -> u8 {
    load()
        .crossfade_seconds
        .unwrap_or(0)
        .min(crate::crossfade::MAX_SECONDS as u8)
}

#[cfg(test)]
mod tests {
    use super::{
        is_hex_color, known_or_default, LIBRARY_SORTS, LIBRARY_VIEWS, DEFAULT_LIBRARY_SORT,
    };

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

    /// The order and the view cross to the frontend as a string that a `switch` acts
    /// on, so an unrecognised value is the same class of problem as a value that
    /// would escape a custom property: the file on disk decides, and the file on
    /// disk can be anything.
    #[test]
    fn only_the_orders_and_the_views_this_build_knows_are_kept() {
        for sort in LIBRARY_SORTS {
            assert_eq!(known_or_default(Some(sort), &LIBRARY_SORTS, DEFAULT_LIBRARY_SORT), sort);
        }

        // A hand edit, an older build, and a value that is not an order at all.
        assert_eq!(
            known_or_default(Some("recently-added"), &LIBRARY_SORTS, DEFAULT_LIBRARY_SORT),
            DEFAULT_LIBRARY_SORT
        );
        assert_eq!(
            known_or_default(Some(""), &LIBRARY_SORTS, DEFAULT_LIBRARY_SORT),
            DEFAULT_LIBRARY_SORT
        );
        assert_eq!(known_or_default(None, &LIBRARY_SORTS, DEFAULT_LIBRARY_SORT), DEFAULT_LIBRARY_SORT);

        // The same list, not the other one: "grid" is not an order and "tracks" is
        // not a view, so neither may satisfy the other's gate.
        assert!(!LIBRARY_VIEWS.contains(&"tracks"));
        assert!(!LIBRARY_SORTS.contains(&"grid"));
    }
}