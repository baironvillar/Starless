import { useEffect, useRef } from "react";
import { coverImage, mediaSession, onMediaKey, type Track, trackArtists } from "./spotify";

/**
 * What the keys can ask the player for.
 *
 * Every entry is the same function the matching button calls, so a key and a
 * click can never disagree — with the DJ talking, "play" is "start the music"
 * from either one. `null` means the control is off right now, exactly when its
 * button is disabled.
 */
export type PlayerActions = {
  toggle: (() => void) | null;
  /** For a media key that says which way: "play" while playing does nothing. */
  playing: boolean;
  next: (() => void) | null;
  previous: (() => void) | null;
  /** Relative, in milliseconds. */
  seekBy: ((deltaMs: number) => void) | null;
  /** Relative, as a fraction of full scale. */
  volumeBy: (delta: number) => void;
  toggleMute: () => void;
  toggleShuffle: (() => void) | null;
  cycleRepeat: (() => void) | null;
};

const SEEK_STEP_MS = 5000;
const VOLUME_STEP = 0.1;

/**
 * Whether the keypress belongs to a field the person is typing in.
 *
 * A range input is not one: arrows on a focused slider move the slider, but
 * Space and the Ctrl chords have nothing to do there and should still reach
 * the player.
 */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    return !["range", "checkbox", "radio", "button", "submit"].includes(target.type);
  }
  return false;
}

/**
 * The player's keyboard: shortcuts inside the window, and the media keys from
 * anywhere.
 *
 * **The media keys are not handled here as `keydown`.** WebView2 also sees
 * `MediaPlayPause` while the window has focus, and Windows delivers the same
 * press to the media session: listening to both would toggle twice and leave
 * the music where it was. They come only through `media://key`, which works
 * minimised too.
 *
 * The actions live in a ref so the listeners subscribe once: the bar re-renders
 * twice a second with the position, and re-subscribing on each one would drop
 * a key that lands in between.
 */
export function usePlayerKeys(actions: PlayerActions) {
  const latest = useRef(actions);
  latest.current = actions;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.altKey || e.metaKey) return;
      if (typing(e.target)) return;
      const a = latest.current;
      const run = (action: (() => void) | null) => {
        // The chord is ours even when the control is off: Ctrl+R with nothing
        // loaded must not fall through to the webview and reload the window.
        e.preventDefault();
        if (action && !e.repeat) action();
      };

      if (e.ctrlKey && !e.shiftKey) {
        switch (e.key) {
          case "ArrowRight":
            return run(a.next);
          case "ArrowLeft":
            return run(a.previous);
          case "ArrowUp":
            e.preventDefault();
            return a.volumeBy(VOLUME_STEP);
          case "ArrowDown":
            e.preventDefault();
            return a.volumeBy(-VOLUME_STEP);
          case "s":
          case "S":
            return run(a.toggleShuffle);
          case "r":
          case "R":
            return run(a.cycleRepeat);
        }
        return;
      }
      if (e.ctrlKey) return;

      if (e.shiftKey) {
        // Held down, these keep going: holding Shift+→ is how a person scrubs.
        if (e.key === "ArrowRight" && a.seekBy) {
          e.preventDefault();
          a.seekBy(SEEK_STEP_MS);
        } else if (e.key === "ArrowLeft" && a.seekBy) {
          e.preventDefault();
          a.seekBy(-SEEK_STEP_MS);
        }
        return;
      }

      if (e.key === " ") {
        // Always ours, even on a focused button: Space toggling the music from
        // everywhere but the last thing clicked is a shortcut nobody can trust.
        // Enter still presses the button.
        return run(a.toggle);
      }
      if (e.key === "m" || e.key === "M") return run(a.toggleMute);
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const unlisten = onMediaKey((key) => {
      const a = latest.current;
      if (key === "next") a.next?.();
      else if (key === "previous") a.previous?.();
      // Windows sends "play" or "pause" from the card, and a headset may send
      // either: the one that matches what is already happening is a no-op.
      else if ((key === "play") !== a.playing) a.toggle?.();
    });
    return () => {
      void unlisten?.then((stop) => stop());
    };
  }, []);
}

/**
 * Keep Windows' media card in step with the bar — and, on the phone, the lock
 * screen and the notification (`MainActivity`'s bridge, `NowPlayingCenter.kt`).
 *
 * The DJ counts as something playing, like it does for the bar: the voice is
 * on, and the keys are how a person skips it.
 *
 * `loading` and the position only matter to the phone. A song that is loading
 * is a song that will play, so the phone keeps the processor awake through it;
 * the position goes with each change of state and not with each tick, because
 * the lock screen moves its own bar from the last one it was given.
 */
export function useMediaSession(
  track: Track | null,
  dj: { speaker: string | null } | null | undefined,
  playing: boolean,
  djLabel: string,
  loading = false,
  positionMs = 0,
  durationMs = 0,
) {
  const title = dj ? (dj.speaker ?? djLabel) : (track?.name ?? null);
  const artist = dj ? "" : track ? trackArtists(track) : "";
  const album = dj ? "" : (track?.album?.name ?? "");
  const artwork = dj ? null : (coverImage(track?.album?.images)?.url ?? null);
  const on = dj ? true : playing;
  const at = useRef({ positionMs, durationMs });
  at.current = { positionMs, durationMs };

  useEffect(() => {
    void mediaSession(
      title === null
        ? null
        : { title, artist, album, artwork, playing: on, loading, ...at.current },
    ).catch(() => {});
  }, [title, artist, album, artwork, on, loading]);
}
