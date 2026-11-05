import { onBackButtonPress } from "@tauri-apps/api/app";
import { useEffect, useRef } from "react";
import { isMobile } from "./version";

/**
 * Android's back button, one layer at a time.
 *
 * Without a listener the button reaches the activity, and the activity closes:
 * `MainActivity.onDestroy` stops the service that keeps the music alive, so
 * "back" from a menu stopped the song. With one, nothing happens unless the
 * app says what — so the app keeps a stack of what is open on top, and the
 * button closes the last one that opened: a menu over the full player, the
 * full player over the page, a settings section over its list.
 *
 * The stack is in the order things opened, not in the tree: a menu opened
 * from the queue inside the full player is a portal, and it is still the one
 * on top. When the stack is empty the page itself goes back (`useBackRoot`).
 */
type Handler = { current: () => void };
const stack: Handler[] = [];
let root: Handler | null = null;
let listening = false;

declare global {
  interface Window {
    /** `MainActivity`'s bridge: moves the app behind the others without closing it. */
    StarlessAndroid?: { moveToBack: () => void };
  }
}

/** Closes something with the back button while `open` is true. */
export function useBack(open: boolean, onBack: () => void) {
  const handler = useRef(onBack);
  handler.current = onBack;
  useEffect(() => {
    if (!open || !isMobile()) return;
    stack.push(handler);
    return () => {
      const at = stack.lastIndexOf(handler);
      if (at >= 0) stack.splice(at, 1);
    };
  }, [open]);
}

/**
 * What the button does when nothing is open on top: the page goes back.
 * `onBack` returns false when the page is already where the app starts, and
 * then the app goes behind the others —like Home on a phone— instead of
 * closing, because closing it would stop the music.
 */
export function useBackRoot(onBack: () => boolean) {
  const page = useRef(onBack);
  page.current = onBack;
  const handler = useRef(() => {
    if (!page.current()) window.StarlessAndroid?.moveToBack();
  });
  useEffect(() => {
    if (!isMobile()) return;
    root = handler;
    if (!listening) {
      listening = true;
      void onBackButtonPress(() => {
        const top = stack[stack.length - 1];
        if (top) top.current();
        else root?.current();
      }).catch((e) => console.error("Starless: no se pudo escuchar el botón atrás", e));
    }
  }, []);
}
