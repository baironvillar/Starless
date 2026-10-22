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

export const SPRING = { type: "spring", stiffness: 420, damping: 32 } as const;

export const SPRING_SHEET = { type: "spring", stiffness: 380, damping: 34 } as const;

export const SPRING_GATE = { type: "spring", stiffness: 380, damping: 32 } as const;
