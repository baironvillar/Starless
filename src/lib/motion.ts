/**
 * The springs the interface moves on.
 *
 * They were a `const SPRING` at the top of eleven components, byte-identical,
 * and the reason nobody ever tuned one is that tuning it meant finding eleven
 * places to tune it. A spring that appears once can be changed once.
 *
 * Three values rather than one, because they are not the same motion:
 *
 * - `SPRING` is the default. Cards, rows, headers, menus — anything that
 *   arrives on its own and should feel like it was already there.
 * - `SPRING_SHEET` is slower to settle. It belongs to the surfaces that dock
 *   over the content rather than inside it: Settings, the queue, the library
 *   rail. They are glass the user has to look *through*, and the couple of
 *   extra milliseconds of settle is what keeps them from reading as a flash.
 * - `SPRING_GATE` is the sign-in screen. It is the only moment the app is not
 *   the app yet, and it settles a touch faster than the panels do.
 *
 * The `as const` on `type` is not decoration: `motion`'s `transition` prop is
 * typed as a union that widens `type` to `string` without it, and every one of
 * these is passed straight into that prop.
 */

export const SPRING = { type: "spring", stiffness: 520, damping: 36 } as const;

/**
 * Not a spring any more. A spring never says when it ends — the tail of one is the
 * "panel still moving after I closed it" — and the CSS beside it (the rail, the
 * content, the bars) is a fixed `--dur-panel`. Same duration and same curve in
 * both directions is what lets the two clocks stay together and what makes
 * closing feel like the opening played backwards.
 */
export const SPRING_SHEET = { duration: 0.24, ease: [0.32, 0.72, 0, 1] } as const;

export const SPRING_GATE = { type: "spring", stiffness: 520, damping: 38 } as const;

/**
 * `--ease-glass` from `index.css`, for `motion`.
 *
 * The two have to be the same curve, not two curves that look alike: the
 * library rail and the content beside it move together, one in CSS and one in
 * `motion`, and a gap between them that breathes is the bug this exists to
 * close.
 */
export const EASE_GLASS = [0.32, 0.72, 0, 1] as const;

/**
 * How a docked panel leaves: **exactly as it came.** It used to be faster (180 ms
 * out against a spring in), and the mismatch was what read as "opens slow, closes
 * abrupt". The shared token keeps the two directions from drifting apart again.
 */
export const SHEET_EXIT = SPRING_SHEET;

/** The same three numbers as `--dur-*` in `index.css`, in seconds, for `motion`. */
export const DURATION = { fast: 0.15, base: 0.2, panel: 0.24 } as const;

/**
 * How a floating menu appears and leaves: one short tween, the same both ways.
 *
 * It was `SPRING`, and a spring's tail is the part that felt like a delay: the
 * menu is 95% there after ~120 ms and spends another ~100 on the last 5%, and on
 * the way out the click that closed it was still watching the menu settle. A menu
 * answers a click, so it moves for exactly one `fast` beat.
 */
export const MENU = { duration: DURATION.fast, ease: EASE_GLASS } as const;
