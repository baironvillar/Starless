// The icon in the notification area, and what it does.
//
// It is how Starless stays reachable once its window is gone: the close button
// can hide the window (`settings::saved_close_to_tray`) and a launch at login
// starts without one, and in both cases the music keeps playing with nothing
// on screen. The menu is the player bar, small: what is playing, the three
// transport buttons, a way back to the window and a way out.
//
// **The transport goes through the webview, like the media keys.** The menu
// sends `media://key`, and the player bar answers it with the same handlers as
// its own buttons — what "next" means lives in `App.tsx`, and a tray that
// decided it in Rust would be a second answer to the same question.
//
// **The words come from the webview too.** Every user-facing string lives in
// `lib/i18n.ts`, in both languages, and the tray is user-facing. The frontend
// sends them on start and on every language change; until then the items carry
// no text, which is a fraction of a second nobody can open a menu in.

use std::sync::Mutex;

use serde::Deserialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::media_keys::NowPlaying;

/// The menu's words, in the language the app is in.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct TrayLabels {
    pub play: String,
    pub pause: String,
    pub next: String,
    pub previous: String,
    pub show: String,
    pub quit: String,
}

pub struct Tray {
    now: MenuItem<Wry>,
    toggle: MenuItem<Wry>,
    next: MenuItem<Wry>,
    previous: MenuItem<Wry>,
    show: MenuItem<Wry>,
    quit: MenuItem<Wry>,
    labels: Mutex<TrayLabels>,
    playing: Mutex<Option<NowPlaying>>,
}

/// Build the icon. A failure is logged and the app goes on without it — but
/// then nothing may hide the window, and `exists` is how the rest asks.
pub fn install(app: &AppHandle) {
    match build(app) {
        Ok(tray) => {
            app.manage(tray);
        }
        Err(error) => log::warn!("bandeja: no se pudo crear el ícono: {error}"),
    }
}

/// Whether there is a tray to come back from. Hiding the window without one
/// leaves a process with no way to reach it but the Task Manager.
pub fn exists(app: &AppHandle) -> bool {
    app.try_state::<Tray>().is_some()
}

fn build(app: &AppHandle) -> tauri::Result<Tray> {
    let now = MenuItem::with_id(app, "now", "Starless", false, None::<&str>)?;
    let toggle = MenuItem::with_id(app, "toggle", "", false, None::<&str>)?;
    let next = MenuItem::with_id(app, "next", "", false, None::<&str>)?;
    let previous = MenuItem::with_id(app, "previous", "", false, None::<&str>)?;
    let show = MenuItem::with_id(app, "show", "", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &now,
            &PredefinedMenuItem::separator(app)?,
            &toggle,
            &next,
            &previous,
            &PredefinedMenuItem::separator(app)?,
            &show,
            &quit,
        ],
    )?;

    let mut builder = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .tooltip("Starless")
        // Left click is the way back to the window, as everywhere else on
        // Windows; the menu is the right click.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle" => {
                // "play" or "pause" and not a bare toggle: the bar ignores
                // the one that matches what is already happening, so a menu
                // opened a moment before the song ended cannot flip it back.
                let playing = app
                    .try_state::<Tray>()
                    .and_then(|tray| tray.playing.lock().ok().and_then(|now| now.as_ref().map(|n| n.playing)))
                    .unwrap_or(false);
                let _ = app.emit("media://key", if playing { "pause" } else { "play" });
            }
            "next" => {
                let _ = app.emit("media://key", "next");
            }
            "previous" => {
                let _ = app.emit("media://key", "previous");
            }
            "show" => crate::bring_to_front(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                crate::bring_to_front(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;

    Ok(Tray {
        now,
        toggle,
        next,
        previous,
        show,
        quit,
        labels: Mutex::new(TrayLabels::default()),
        playing: Mutex::new(None),
    })
}

/// New words, from the frontend.
pub fn set_labels(app: &AppHandle, labels: TrayLabels) {
    let Some(tray) = app.try_state::<Tray>() else {
        return;
    };
    if let Ok(mut guard) = tray.labels.lock() {
        *guard = labels;
    }
    refresh(&tray);
}

/// What is playing, from the same call that feeds Windows' media card.
pub fn set_playing(app: &AppHandle, now: Option<NowPlaying>) {
    let Some(tray) = app.try_state::<Tray>() else {
        return;
    };
    if let Ok(mut guard) = tray.playing.lock() {
        *guard = now;
    }
    refresh(&tray);
}

fn refresh(tray: &Tray) {
    let labels = tray.labels.lock().map(|l| l.clone()).unwrap_or_default();
    let playing = tray.playing.lock().ok().and_then(|now| now.clone());

    let loaded = playing.is_some();
    let now_text = match &playing {
        Some(now) if now.artist.is_empty() => menu_text(&now.title),
        Some(now) => menu_text(&format!("{} — {}", now.title, now.artist)),
        None => "Starless".to_string(),
    };
    let _ = tray.now.set_text(now_text);
    let _ = tray
        .toggle
        .set_text(if playing.as_ref().is_some_and(|n| n.playing) { &labels.pause } else { &labels.play });
    let _ = tray.next.set_text(&labels.next);
    let _ = tray.previous.set_text(&labels.previous);
    let _ = tray.show.set_text(&labels.show);
    let _ = tray.quit.set_text(&labels.quit);
    // Off with nothing loaded, the way the bar's buttons are.
    let _ = tray.toggle.set_enabled(loaded);
    let _ = tray.next.set_enabled(loaded);
    let _ = tray.previous.set_enabled(loaded);
}

/// A song's name, safe for a Windows menu.
///
/// **`&` is not a character there: it marks the next one as the item's
/// keyboard mnemonic,** so "Simon & Garfunkel" would lose its ampersand and
/// underline the space. Doubled, it is one `&`.
/// And a menu item is one line wide, so a long title is cut instead of
/// stretching the menu across the screen.
fn menu_text(text: &str) -> String {
    const MAX_CHARS: usize = 60;
    let cut: String = if text.chars().count() > MAX_CHARS {
        let mut short: String = text.chars().take(MAX_CHARS - 1).collect();
        short.push('…');
        short
    } else {
        text.to_string()
    };
    cut.replace('&', "&&")
}

#[cfg(test)]
mod tests {
    use super::menu_text;

    #[test]
    fn an_ampersand_survives_the_menu() {
        assert_eq!(menu_text("Simon & Garfunkel"), "Simon && Garfunkel");
    }

    #[test]
    fn a_long_title_is_cut_on_a_character() {
        let long = "á".repeat(80);
        let text = menu_text(&long);
        assert_eq!(text.chars().count(), 60);
        assert!(text.ends_with('…'));
    }
}
