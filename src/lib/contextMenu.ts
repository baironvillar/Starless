/**
 * What a right-click does, decided once for the whole window.
 *
 * The webview's own menu offered Back and Reload, and Reload in an app restarts
 * the page under whatever the person was doing. So it is off everywhere except
 * in text fields, where cut, copy and paste are what a right-click is for.
 *
 * Where the press lands on something that already has a menu, that menu opens
 * at the mouse: a song row (its three dots, `data-track-menu`), a playlist's
 * heading (`data-playlist-menu`), or a playlist in the rail or on Home
 * (`data-playlist-id`, which has no dots and gets the shared menu in `App`).
 * The menus keep their own logic; this only tells them where to open.
 */

import { type RefObject, useEffect, useRef } from "react";

/** Sent to a menu's trigger: open, at `detail`. */
export const MENU_AT = "starless:menu-at";
/** Sent to the window: open the shared playlist menu for `detail.id`. */
export const PLAYLIST_MENU = "starless:playlist-menu";

export type MenuPoint = { x: number; y: number };

const TRIGGERS = "[data-track-menu], [data-playlist-menu]";

/**
 * The trigger of the row the press landed in, and only of that row.
 *
 * A song row is already marked: its dots appear on `group-hover`, so the row
 * is the `.group` they live in. The playlist heading says so itself with
 * `data-menu-row`. Looking further up — "the one trigger above here" — would
 * find a stranger's: a search with one result would answer a right-click
 * anywhere on the screen with that song's menu.
 */
export function triggerFor(target: Element): HTMLElement | null {
  const row = target.closest(".group, [data-menu-row]");
  return row?.querySelector<HTMLElement>(TRIGGERS) ?? null;
}

export function routeContextMenu(): void {
  window.addEventListener("contextmenu", (event) => {
    // In development, Shift + right-click keeps the webview's menu, for Inspect.
    if (import.meta.env.DEV && event.shiftKey) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("input, textarea, [contenteditable='true']")) return;
    event.preventDefault();
    if (!target) return;
    const point: MenuPoint = { x: event.clientX, y: event.clientY };
    const id = target.closest<HTMLElement>("[data-playlist-id]")?.dataset.playlistId;
    if (id) {
      window.dispatchEvent(new CustomEvent(PLAYLIST_MENU, { detail: { id, ...point } }));
      return;
    }
    triggerFor(target)?.dispatchEvent(new CustomEvent<MenuPoint>(MENU_AT, { detail: point }));
  });
}

/** A menu's trigger listens here, and opens at the point a right-click asked for. */
export function useMenuAt(anchor: RefObject<HTMLElement | null>, open: (point: MenuPoint) => void) {
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    const node = anchor.current;
    if (!node) return;
    const listener = (event: Event) => openRef.current((event as CustomEvent<MenuPoint>).detail);
    node.addEventListener(MENU_AT, listener);
    return () => node.removeEventListener(MENU_AT, listener);
  }, [anchor]);
}
