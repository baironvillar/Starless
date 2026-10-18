# Design

## Direction

Brief-pinned by the user. Not a roll, not a challenger: the user rejected two rounds of grounded directions and then pinned this one directly.

**Floating translucent glass.** The player bar and the navigation rail float above the content instead of being docked to the window edges. Components are round, layered, and semi-transparent, with an iOS-adjacent feel — depth from light and blur rather than from borders and shadows.

This is a technique, not Apple's product. Do not call it "Liquid Glass" in code, copy, or UI: that is Apple's design language name and calling Starless by it invites exactly the trademark problem PRODUCT.md is trying to avoid. Describe it internally as *floating glass*.

Two constraints sharpen it, and both come from PRODUCT.md rather than from taste:

- Starless promises a sub-second cold start and a small memory footprint. Glass is the most expensive thing this app could render. Every rule in Performance Budget exists to protect that promise.
- The user is Premium and frustrated. A glass bar that becomes unreadable over a bright album cover is a worse experience than a solid one, and it would be their first impression.

## Shape

Four floating layers, and no more. Each sits above the one beneath.

| Layer | Role | Radius |
|---|---|---|
| Colour bloom | A large soft radial wash behind everything | full |
| Top bar | Home, library toggle, centred search, secondary actions | 20px |
| Library sidebar | The user's playlists and liked songs | 20px |
| Player bar | Transport, progress, volume — always visible | 20px |

The three panels are the same width inset, cut from the same glass recipe. **They read as one sheet of glass floating over the content**, not as three components that happen to match. Anything that breaks that symmetry — a different radius on one of them, a different inset — makes the app look assembled instead of designed.

The library rail and the play queue are the two docked side panels, and they are **not the same width on purpose**: the library has two of its own, because a 240px column of playlist *names* spends a quarter of a laptop screen saying what the artwork next to it already says. Collapsed, it is a 72px riel of covers — 20px of inset, 72px of rail, 20px of gap — and the name is in the header over the list it opens. Expanded it claims 280px. The queue is 240px and always is: its rows carry a title, an artist and a duration, and there is no second line to fall back on. **Both dock at every width.** A side panel that turns into a full-bleed sheet on a narrow window stops being a panel you read while the music plays — it becomes a modal, and the content it was supposed to sit beside is the thing it covers. The content needs every pixel it can get, because the lyrics are a reading column and a wide panel on each side is a narrow one in the middle.

Floating means inset from the window edges: 20px on every side. The corner radius of a floating surface is what tells the eye it is detached — square corners on a floating surface read as a bug.

The top bar is a three-column grid, `1fr auto 1fr`, so the search stays optically centred however wide navigation grows. Both side columns are `min-w-0 overflow-hidden`: without that they push their contents *through* the centre column instead of yielding to it. The row sheds items by breakpoint — library pills at `lg`, device and overflow at `xl`, the language toggle at `sm` — rather than ever overlapping.

## Colour

Vivid, as the user asked. The saturation lives in the bloom and in state marks, not in flat panel fills — a large saturated field is what turns a glass UI cheap.

| Token | Value | Use |
|---|---|---|
| `--ink-ground` | `#0A0A12` | Behind everything |
| `--ink` | `#F4F4FA` | Primary text |
| `--ink-muted` | `#9A9AB0` | Secondary text, timecodes |
| `--ink-faint` | `#9090A8` | Tertiary text. Must stay at or above `#9090A8` — see Contrast below |
| `--accent` | `#C9F73C` | Primary actions, active nav, progress fill |
| `--accent-live` | `#FF5A36` | Currently playing. Reserved |
| `--accent-ok` | `#3DDC97` | Played, confirmed |
| `--accent-warn` | `#FFB020` | Failed to load |

**The palette is warm and acidic on purpose.** An earlier violet-on-dark bloom was rejected by the impeccable detector as `ai-color-palette` — purple gradients on a dark ground are the single most recognizable tell of AI-generated UI, and a design system that carries one cannot escape it. Violet and cyan are both out of the chrome.

`--accent-live` is reserved. It appears on exactly one thing at a time: the track currently sounding. Reusing it for a hovered button or a selected tab is the fastest way to lose the signal the whole design is built on.

## Contrast

The detector caught `--ink-faint` at 2.7:1 against the ground and 3.4:1 against glass. WCAG AA wants 4.5:1 for body text.

The floor is now `#9090A8` on the ground and on the glass base, which is about 5.5:1 in both. **Any new tertiary text token must be checked against `#0A0A12` and against the glass base `#23232C`, not against a screenshot.** Never tint a text token toward the accent to make it feel integrated; that is exactly how contrast quietly disappears.

## Type

`Manrope` for UI, `JetBrains Mono` for timecodes. Not Inter: the detector flags it as `overused-font`, and it is right — Inter is where every generated UI converges, and a design system that ships it has no voice. Manrope's slightly rounded terminals also carry the roundness the direction is built on.

## The bloom is fixed, not per-album

Resolved: the bloom **does not tint per album**. An earlier version derived its hue from the current track, which meant a Radiohead track pushed violet through the entire interface and a different artist would produce a different product. Palette consistency beat per-album mood, and it is cheaper: the bloom is a static stack of three radials that never repaints.

## The glass recipe

A glass surface is three stacked things, never one. Omitting the middle layer is what turns translucency into unreadable.

```
1. base       rgba(20,20,32,0.55)   ← guarantees the contrast floor
2. blur       blur(24px) saturate(180%)
3. specular   1px rgba(255,255,255,0.12) border
              + inset 0 1px 0 rgba(255,255,255,0.10)
              + 0 24px 48px -12px rgba(0,0,0,0.6) lift
```

The base is not optional decoration. It is what makes text legible over a bright cover. **Any surface carrying text needs an opaque-enough base — alpha 0.5 or above. Never place text directly on unblurred artwork.**

Nesting glass inside glass is forbidden. Each level multiplies the blur cost and compounds the contrast loss. If a control sits on the player bar, it is a plain tinted control, not a second glass layer.

## Performance budget

This is the part that decides whether the direction survives contact with a real machine.

- **Blur radius caps at 24px.** Past that the cost climbs with no visible gain at these element sizes.
- **Never animate `backdrop-filter`.** Animating the blur value forces a re-sample every frame. Animate `transform` and `opacity` only. A glass bar that fades in fades its *opacity*, never its blur.
- **One glass layer over the content area.** The bar and the rail are separate regions; do not blur a container that contains another blurred element.
- **The bloom behind the glass is static.** A fixed stack of three radial gradients that never repaints. A continuously animating backdrop under a blurred surface is the single worst thing this design could do — it repaints the blur every frame.
- **`contain: paint`** on glass surfaces, so their repaint cannot leak into the content behind them.
- **`will-change: transform`**, never `will-change: filter`.

If the app ever drops below 60fps, the bloom's animation is the first thing to cut, then blur radius drops to 16px. Dropping the glass entirely is the last resort and probably wrong.

## Motion

Motion is what separates "designed" from "assembled", and it is one of the three product claims in PRODUCT.md.

- Springs, not durations, for anything the user touches. Tailwind/Motion spring: stiffness ~420, damping ~32.
- Press feedback is a scale to 0.94 with a ~120ms spring. It must feel instant.
- The bar enters once on first launch: fade and rise 16px, ~320ms. Never on every navigation.
- Track change: nothing in the chrome moves. The bloom is fixed, so a track change only updates the artwork swatch and the running-time column.
- Nothing animates on a loop, with exactly one exception: the now-playing mark in the track list breathes slowly. It is the only thing on screen allowed to move indefinitely, and it is 8px across. An app open all day must otherwise be able to sit completely still.

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

Native `<input type="range">` is redrawn by the `.slider` recipe in `index.css`: a 4px
track, a 12px thumb, and a fill driven by the `--fill` custom property each control
sets from its own value. The browser default looks like a different app wearing our
clothes, and there are only two of these, so one recipe covers both.

## Layout rules

- The bar is always present. The user never navigates somewhere to control playback.
- The rail persists and swaps its contents; the layout never reflows between sections.
- The content area carries the only large artwork. Chrome stays quiet so the album is the brightest thing on screen.
- Spanish and English ship together; every string comes from a translation map, never inline.

## Open

- Whether the nav rail floats permanently or can collapse to icons on narrow windows.
- Whether glass is the only layer treatment, or solid surfaces are offered as a performance fallback in settings.