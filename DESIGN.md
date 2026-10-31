# Design

## Direction

Brief-pinned by the user. Not a roll, not a challenger: the user rejected two rounds of grounded directions and then pinned this one directly.

**Floating translucent glass.** The player bar and the navigation rail float above the content instead of being docked to the window edges. Components are round, layered, and semi-transparent, with an iOS-adjacent feel — depth from light and blur rather than from borders and shadows.

This is a technique, not Apple's product. Do not call it "Liquid Glass" in code, copy, or UI: that is Apple's design language name and calling Starless by it invites exactly the trademark problem PRODUCT.md is trying to avoid. Describe it internally as *floating glass*.

Two constraints sharpen it, and both come from PRODUCT.md rather than from taste:

- Starless promises a sub-second cold start and a small memory footprint. Glass is the most expensive thing this app could render. Every rule in Performance Budget exists to protect that promise.
- The user is Premium and frustrated. A glass bar that becomes unreadable over a bright album cover is a worse experience than a solid one, and it would be their first impression.

## Shape

Three floating layers over a black ground lit by a frost bloom, and no more.

| Layer | Role | Radius |
|---|---|---|
| Top bar | Home, library toggle, centred search, secondary actions | 20px |
| Library sidebar | The user's playlists and liked songs | 20px |
| Player bar | Transport, progress, volume — arrives with the music | 20px |

The three panels are the same width inset, cut from the same glass recipe. **They read as one sheet of glass floating over the content**, not as three components that happen to match. Anything that breaks that symmetry — a different radius on one of them, a different inset — makes the app look assembled instead of designed.

The library rail and the play queue are the two docked side panels, and they are **not the same width on purpose**: the library has two of its own, because a 240px column of playlist *names* spends a quarter of a laptop screen saying what the artwork next to it already says. Collapsed, it is a 72px riel of covers — 20px of inset, 72px of rail, 20px of gap — and the name is in the header over the list it opens. Expanded it claims 280px. The queue is 240px and always is: its rows carry a title, an artist and a duration, and there is no second line to fall back on. **Both dock at every width**, and below 1000px the library is always the riel: an open library and the queue would leave a 340px reading column at 900px, so the narrow window takes the names away and gives them back, as they were, when it widens. A side panel that turns into a full-bleed sheet on a narrow window stops being a panel you read while the music plays — it becomes a modal, and the content it was supposed to sit beside is the thing it covers. The content needs every pixel it can get, because the lyrics are a reading column and a wide panel on each side is a narrow one in the middle.

Floating means inset from the window edges: 20px on every side. The corner radius of a floating surface is what tells the eye it is detached — square corners on a floating surface read as a bug.

The top bar is a three-column grid, `1fr auto 1fr`, so the search stays optically centred however wide navigation grows. Both side columns are `min-w-0 overflow-hidden`: without that they push their contents *through* the centre column instead of yielding to it. The row sheds items by breakpoint — library pills at `lg`, device and overflow at `xl`, the language toggle at `sm` — rather than ever overlapping.

## Colour

Achromatic, taken from the landing (`site/DESIGN.md`) so the site and the app read as one product: near-black ground, cool frost for type, chrome for the one action colour. No hue lives in the chrome; colour appears only in the album art and in the reserved state marks.

| Token | Value | Use |
|---|---|---|
| `--ink-ground` | `#08080A` | Behind everything (the landing's Speaker Black) |
| `--ink` | `#F4F5F7` | Primary text (Frost) |
| `--ink-muted` | `#9A9EA8` | Secondary text, timecodes (Mute) |
| `--ink-faint` | `#8F939C` | Tertiary text. Must stay at or above `#8F939C` — see Contrast below |
| `--accent` | `#C8CCD4` | Primary actions, active nav, progress fill (Chrome). The user can still pick another in Settings |
| `--accent-live` | `#FF5A36` | Currently playing. Reserved |
| `--accent-ok` | `#3DDC97` | Played, confirmed |
| `--accent-warn` | `#FFB020` | Failed to load |

**The palette used to be warm and acidic** (a lime accent over an orange-and-green bloom), chosen after a violet bloom was rejected by the impeccable detector as `ai-color-palette`. It was replaced by the landing's achromatic ramp so the app looks like the page that sells it. Violet stays out.

`--accent-live` is reserved. It appears on exactly one thing at a time: the track currently sounding. Reusing it for a hovered button or a selected tab is the fastest way to lose the signal the whole design is built on.

## Contrast

The detector caught `--ink-faint` at 2.7:1 against the ground and 3.4:1 against glass. WCAG AA wants 4.5:1 for body text.

The floor is now `#8F939C`: 6.5:1 on the ground and 5.5:1 on graphite `#1C1D21`, the opaque end of the glass base. **Any new tertiary text token must be checked against `#08080A` and against `#1C1D21`, not against a screenshot.** Never tint a text token toward the accent to make it feel integrated; that is exactly how contrast quietly disappears.

## Type

`Funnel Sans` for UI and `Funnel Display` for `h1`/`h2` titles, the landing's pair. Timecodes stay in Funnel Sans with tabular figures (`.tabular`), so a countdown never shifts; the system monospace is left only for raw logs and codes. Not Inter: the detector flags it as `overused-font`. Manrope, the earlier choice, was dropped so the app and the site share one voice.

## A frost bloom, never a coloured one

Behind everything sits a static bloom of white light on black: three radials in frost and chrome, brightest at the top centre. It gives the glass something to show through without bringing hue back, the same way the landing gets colour only from reflected light. It is fixed (a per-album tint once pushed violet through the whole interface) and never animates.
**One light follows the pointer** (`CursorGlow.tsx`): a 900px pool of frost at 16% that drifts after the mouse on a soft spring. It is the one exception to the static backdrop, asked for by the user. It costs a blur re-sample on the glass while the pointer moves, so it moves only by `transform`, only with the pointer, and is not drawn with reduced motion. If the app drops below 60fps, this is the first thing to cut.

**The person can take the movement back.** Settings → Personalisation has the pointer light (on/off), the pulse on the volume (with waves, soft, off), the bloom (normal, soft at half, off) and the interface animations (on/off: off forces Motion's reduced motion through `MotionConfig` and stops every CSS transition and keyframe under `:root[data-still]`, the same rule the system's reduced motion gets). **Quiet mode** sits above them: it is not a stored setting, it is on when all four are off, and switching it writes all four — off, or back to the shipped values. The shipped values are the ones described here; `settings::EFFECTS` lists them, first value first.

## The glass recipe

A glass surface is three stacked things, never one. Omitting the middle layer is what turns translucency into unreadable.

```
1. base       rgba(28,29,33,0.46)   ← graphite; the bars (`glass`) sit mostly over the bloom, so they go below the 0.5 floor for more see-through. Menus and sheets keep their own alpha
2. blur       blur(24px) saturate(180%)
3. lift       0 24px 48px -12px rgba(0,0,0,0.6)
```

The base is not optional decoration. It is what makes text legible over a bright cover. **Any surface carrying text needs an opaque-enough base — alpha 0.5 or above. Never place text directly on unblurred artwork.**

**There is no specular border.** A 1px `rgba(255,255,255,0.12)` ring with a matching `inset 0 1px 0` highlight used to be layer three, and it was a signal saying the same thing the radius and the lift already say. Measured against the bloom — which is all that sits behind the bars — it was a hairline you had to look at to see. **A floating surface reads as floating because of its radius and its shadow, not because it is outlined.** Adding an outline to a floating surface is how a design gets described as "boxes on a dark background".

The border and the inset highlight go together: drop one and keep the other and what is left is a bright line along the top edge and nothing on the other three sides, which reads as a rendering fault.

The one surface that keeps a hairline is the track list — `border-white/8` on a `bg-white/4` card — and it is deliberately not glass. It is content, not chrome: a list of songs needs a structure to hang on, and after the chrome lost its outlines that card is what still separates a list from the ground. Chrome edges were decoration; that one is information.

Nesting glass inside glass is forbidden. Each level multiplies the blur cost and compounds the contrast loss. If a control sits on the player bar, it is a plain tinted control, not a second glass layer.

## Performance budget

This is the part that decides whether the direction survives contact with a real machine.

- **Blur radius caps at 24px.** Past that the cost climbs with no visible gain at these element sizes.
- **Never animate `backdrop-filter`.** Animating the blur value forces a re-sample every frame. Animate `transform` and `opacity` only. A glass bar that fades in fades its *opacity*, never its blur.
- **One glass layer over the content area.** The bar and the rail are separate regions; do not blur a container that contains another blurred element.
- **What sits behind the glass is static.** The bloom is a fixed stack of radials that never repaints; a continuously animating backdrop under a blurred surface is the single worst thing this design could do — it repaints the blur every frame.
- **`contain: paint`** on glass surfaces, so their repaint cannot leak into the content behind them.
- **`will-change: transform`**, never `will-change: filter`.

If the app ever drops below 60fps, the pointer glow goes first, then blur radius drops to 16px. Dropping the glass entirely is the last resort and probably wrong.

## Motion

Motion is what separates "designed" from "assembled", and it is one of the three product claims in PRODUCT.md.

- Springs, not durations, for anything the user touches. Tailwind/Motion spring: stiffness ~420, damping ~32.
- Press feedback is a scale to 0.94 with a ~120ms spring. It must feel instant.
- The bar enters **with the music**: fade and rise 16px, ~320ms. It is not on screen before the first song — an empty bar is the shape of an absence — and it never re-enters on navigation.
- The bar leaves the way it came: the same fade, the same 16px, downward. The window gives the bar its room at the same time, so the two are one movement and not two gestures. The library, the rail and the queue stop 20px above the window's edge when there is no bar, and at 144px — where the bar begins — when there is one.
- Track change: nothing in the chrome moves. A track change only updates the artwork swatch and the running-time column.
- Nothing animates on a loop, with two exceptions, and both only while music sounds: the now-playing mark in the track list breathes slowly, and the volume thumb beats with the music — a glow that swells with the pulse and a ring that leaves it on each kick. The pulse is measured in Rust where the sample is heard (`beat.rs`), never guessed from a tempo, and reaches the bar as a motion value, not React state. Paused, muted or with reduced motion, both are still: an app open all day must otherwise be able to sit completely still.

## Signature move

**The running-time column.** Elapsed and remaining sit in the player bar as monospaced tabular figures, counting down live, and the same figures appear in the track list on the row currently sounding. A cue-sheet habit, carried into the glass system — it is the one thing the user should recognise from the earlier directions.

## The settings panel is the reference

`SettingsPanel.tsx` is the most resolved surface in the app, so it is the reference
rather than one surface among equals: the main content area is cut from it, not
invented beside it.

What that means concretely:

- **One bordered surface, hairline-separated rows.** A list is a `rounded-card` with
  `border-white/8` over `bg-white/4`, its rows divided by `border-white/8`. Bare rows
  floating on a bare background are exactly what made the main area read as busier
  than the panel.
- **A label opposite its value.** Column headers are 11.5px semibold uppercase in
  `ink-faint`; row titles are 13.5px semibold; secondary lines are 12.5px muted.
  The same three sizes everywhere, no exceptions.
- **Controls appear on approach.** A row's play affordance lives over the artwork at
  `opacity-0` and is revealed by hover. Nothing performs on its own.
- **No glow, no coloured border, no gradient on chrome.** The only saturated fills in
  the app are the accent home button and the reserved state marks.
- **The version footer says which build this is.** A `pre-release` pill next to the
  version, in the same reserved state mark the changelog uses —accent at 15%, 10.5px
  uppercase— and only on builds that came from `develop`. A release says nothing,
  because there is nothing to say. The inverted icon says the same thing, but only
  to somebody who knows what it means; two copies of the app on one machine used to
  look identical.

## Player bar geometry

Three columns — `1fr auto 1fr` — so the transport sits on the optical centre of the
window however long the track title gets.

**The seek bar sits directly under the transport, on the same centre axis.** A
progress bar that runs off to one side reads as a separate widget; the pairing of
"what I am hearing" with "how far in I am" only holds when they share a centre.

The centre column is `clamp(190px, 34vw, 560px)` rather than a fixed width, so the two
flanking columns keep enough room for artwork and title all the way down to the app's
own 768px minimum. The bar is 104px tall, which puts the content boundary at
`bottom-[144px]` — one 20px gap beneath it, the same gap the top bar leaves at
`top-[104px]`.

**That boundary has two values, and they follow the bar.** While the bar is on screen the
content, the rail and the queue stop at 144px, where the bar begins. Before the first song
there is no bar, and they go down to the window's own 20px inset: that space belongs to
the content, and a band of empty ground under the library is a hole, not breathing room.
The bar arriving and the content moving are one movement, so both take the 300ms the
panels already use.

Native `<input type="range">` is redrawn by the `.slider` recipe in `index.css`: a 4px
track, a 12px thumb, and a fill driven by the `--fill` custom property each control
sets from its own value. The browser default looks like a different app wearing our
clothes, and there are only two of these, so one recipe covers both.

## Layout rules

- The bar is present whenever there is something to play. The user never navigates somewhere to control playback.
- The rail persists and swaps its contents; the layout never reflows between sections.
- The content area carries the only large artwork. Chrome stays quiet so the album is the brightest thing on screen.
- Spanish and English ship together; every string comes from a translation map, never inline.

## Open

- Whether glass is the only layer treatment, or solid surfaces are offered as a performance fallback in settings.