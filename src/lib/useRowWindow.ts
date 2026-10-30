import { type RefObject, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

/** Below this many rows a list is drawn whole: windowing would buy nothing. */
const WINDOW_FROM = 60;
/** Rows drawn past each edge of the visible part, so a fast scroll never shows a gap. */
const OVERSCAN = 40;

/**
 * Which rows of a long list are near the screen: `[first, last)` and the
 * distance from one row to the next.
 *
 * **Only those rows are rendered.** `App` re-renders on every change — the
 * volume, the position, a menu opening — and a playlist of a thousand songs
 * rendered every row each time: 300 to 700 ms with the window frozen, measured
 * in the app. The rows are one height per view, so the rest of the list is two
 * spacers and the scrollbar still tells the truth.
 *
 * The rows are the children of `list` marked `data-row`; their pitch is read
 * from the first two, so a change of view or of font size is measured, not
 * assumed. `remeasure` is whatever changes that pitch (the view).
 */
export function useRowWindow(
  list: RefObject<HTMLElement | null>,
  count: number,
  remeasure: unknown = null,
): { first: number; last: number; pitch: number } {
  const whole = count < WINDOW_FROM;
  const [range, setRange] = useState({ first: 0, last: Math.min(count, OVERSCAN * 3), pitch: 0 });
  // Kept across lists: a new list can arrive with nothing drawn where the old
  // one was scrolled to, and the pitch is what finds where to draw.
  const pitchRef = useRef(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `remeasure` is the trigger that makes the pitch be read again when the rows change height.
  useEffect(() => {
    const el = list.current;
    if (whole || !el) return;

    let scroller: HTMLElement | null = el.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement;
    }
    const target: HTMLElement | Window = scroller ?? window;

    let drawn = { first: -1, last: -1 };
    // Called from the scroll event itself and committed with `flushSync`, so
    // the rows exist before the frame is painted: deferred to the next frame,
    // a fast scroll outran them and the list was seen filling in row by row.
    // It only renders when the visible part gets near an edge of what is drawn.
    const update = (sync: boolean) => {
      const rows = el.querySelectorAll<HTMLElement>("[data-row]");
      if (rows.length > 1)
        pitchRef.current = rows[1].offsetTop - rows[0].offsetTop || pitchRef.current;
      const pitch = pitchRef.current;
      if (!pitch) return;
      const top = el.getBoundingClientRect().top;
      const viewTop = scroller ? scroller.getBoundingClientRect().top : 0;
      const viewHeight = scroller ? scroller.clientHeight : innerHeight;
      const seenFirst = Math.max(0, Math.floor((viewTop - top) / pitch));
      const seenLast = Math.min(count, Math.ceil((viewTop - top + viewHeight) / pitch));
      const margin = OVERSCAN / 4;
      const covered =
        drawn.first <= Math.max(0, seenFirst - margin) &&
        drawn.last >= Math.min(count, seenLast + margin);
      if (covered) return;
      const first = Math.min(count, Math.max(0, seenFirst - OVERSCAN));
      const last = Math.min(count, Math.max(first, seenLast + OVERSCAN));
      drawn = { first, last };
      // Not inside the effect's own first call: React refuses `flushSync` there.
      if (sync) flushSync(() => setRange({ first, last, pitch }));
      else setRange({ first, last, pitch });
    };

    const onScroll = () => update(true);
    update(false);
    target.addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    return () => {
      target.removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
    };
  }, [list, count, whole, remeasure]);

  if (whole) return { first: 0, last: count, pitch: 0 };
  // Until the pitch is measured, draw the top of the list: the pitch is read
  // from two drawn rows, so a list that mounted empty and filled later (Liked
  // Songs, which loads after the screen opens) never drew one and stayed blank.
  if (!range.pitch) return { first: 0, last: Math.min(count, OVERSCAN * 3), pitch: 0 };
  return range;
}
