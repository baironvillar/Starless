# Design

## Direction

Brief-pinned by the user. Not a roll, not a challenger: the user rejected two rounds of grounded directions and then pinned this one directly.

**Floating translucent glass.** The player bar and the navigation rail float above the content instead of being docked to the window edges. Components are round, layered, and semi-transparent, with an iOS-adjacent feel — depth from light and blur rather than from borders and shadows.

This is a technique, not Apple's product. Do not call it "Liquid Glass" in code, copy, or UI: that is Apple's design language name and calling Starless by it invites exactly the trademark problem PRODUCT.md is trying to avoid. Describe it internally as *floating glass*.

Two constraints sharpen it, and both come from PRODUCT.md rather than from taste:

- Starless promises a sub-second cold start and a small memory footprint. Glass is the most expensive thing this app could render. Every rule in Performance Budget exists to protect that promise.
- The user is Premium and frustrated. A glass bar that becomes unreadable over a bright album cover is a worse experience than a solid one, and it would be their first impression.

## Shape

Three floating layers over a black ground lit by a grey bloom, and no more.

| Layer | Role | Radius |
|---|---|---|
| Top bar | Home, library toggle, centred search, secondary actions | 20px |
| Library sidebar | The user's playlists and liked songs | 20px |
| Player bar | Transport, progress, volume — arrives with the music | 20px |

The three panels are the same width inset, cut from the same glass recipe. **They read as one sheet of glass floating over the content**, not as three components that happen to match. Anything that breaks that symmetry — a different radius on one of them, a different inset — makes the app look assembled instead of designed.

The library rail and the play queue are the two docked side panels, and they are **not the same width on purpose**: the library has two of its own, because a 240px column of playlist *names* spends a quarter of a laptop screen saying what the artwork next to it already says. Collapsed, it is a 72px riel of covers — 20px of inset, 72px of rail, 20px of gap — and the name is in the header over the list it opens. Expanded it claims 280px. The queue is 240px and always is: its rows carry a title, an artist and a duration, and there is no second line to fall back on. **Both dock at every width**, and below 1000px the library is always the riel: an open library and the queue would leave a 340px reading column at 900px, so the narrow window takes the names away and gives them back, as they were, when it widens. A side panel that turns into a full-bleed sheet on a narrow window stops being a panel you read while the music plays — it becomes a modal, and the content it was supposed to sit beside is the thing it covers. The content needs every pixel it can get, because the lyrics are a reading column and a wide panel on each side is a narrow one in the middle.

Floating means inset from the window edges: 20px on every side. The corner radius of a floating surface is what tells the eye it is detached — square corners on a floating surface read as a bug.

The top bar is a three-column grid, `1fr auto 1fr`, so the search stays optically centred however wide navigation grows. Both side columns are `min-w-0 overflow-hidden`: without that they push their contents *through* the centre column instead of yielding to it. The row sheds items by breakpoint — library pills at `lg`, device and overflow at `xl`, the language toggle at `sm` — rather than ever overlapping.

## Brand

The mark is **"wave over equalizer"**: a ring, eight bars that fade from light grey to almost black — the sound going out into silence — and a sine wave that draws an S over them. **It has no stars, and nothing in Starless ever should**: the name is a night without them. It replaced a fading star, which said the opposite of the name.

The mark is grey only. Ember lives in the interface, never in the logo.

| File | Use |
|---|---|
| `public/starless-glass.svg` | The main mark, liquid glass. Splash, sign-in, the landing hero — anything ≥ 64px |
| `public/starless.svg` | Flat grey on dark. Favicon, tray, anything < 64px, where the glass filters blur into nothing |
| `public/starless-light.svg` / `starless-dev.svg` | Inverted grey for light grounds; the development build's mark |
| `public/starless-mono.svg` | One ink, `currentColor` |

All of them, and every app icon in `src-tauri/icons`, come out of `scripts/logo.ts` (`bun run logo`, and `bun run logo:invert` for `icons-dev`). The approved originals and the canvas they were chosen on are in `brand-kit/`, beside the repo. Geometry, on a 100×100 viewBox: ring r=43 stroke 5; bars 5 wide at x = 19.5 + 8n, heights 30 52 62 52 38 26 16 8, centred on y=50; wave `M16 50 C 27 20, 39 20, 50 50 S 73 80, 84 50`, stroke 7, round caps.

The wordmark is lowercase "starless" in Syne 700, −0.03em, silver gradient (`.sl-wordmark` on the landing).

## Colour

"A night without stars": deep blacks, one warm light. The same tokens as the landing (`site/DESIGN.md`) and `brand-kit/tokens.css`. Roughly 60% Void, 22% Night, 10% Bone, the rest accents.

| Token | Value | Use |
|---|---|---|
| `--color-ground` | `#0B0B0F` | Void. Behind everything |
| `--color-night` | `#15151B` | Night. Surfaces, the glass base |
| `--color-eclipse` | `#24242C` | Eclipse. Borders, tracks, elevation |
| `--color-ink` | `#EDEAE3` | Bone. Primary text |
| `--color-ink-muted` | `#9A97A0` | Smoke. Secondary text, timecodes |
| `--color-ink-faint` | `#8C8992` | Tertiary text. Must stay at or above this — see Contrast below |
| `--color-accent` | `#FF5A36` | Ember. Play, active nav, progress fill, the primary button. ≤ 10% of the screen. The user can still pick another in Settings |
| `--color-on-accent` | `#0B0B0F` | The label on an Ember fill. Void, not Bone: Bone on Ember is 2.6:1 |
| `--color-live` | `#FF5A36` | Currently playing. Ember, and stays Ember when the user changes the accent |
| `--color-ok` | `#3DD6C4` | Tide. Played, downloaded, confirmed |
| `--color-warn` | `#F5B83D` | Amber. Failed to load |

Ash `#B8381A` is Ember on a light ground, where Ember fails contrast for text. Ultraviolet `#7C6CFF` is the secondary accent of the brand and is offered as an accent preset, not used by the chrome.

**The palette has been lime, then achromatic chrome, and both are gone.** The lime `#C9F73C` over `#0A0A12` was the old identity; the chrome `#C8CCD4` on `#08080A` was a stopgap that matched the landing. Neither should come back.

The accent and the live mark share Ember by default, and that is accepted rather than overlooked: the play button and the row that is sounding are the same idea. What stays reserved is the *shape* of the live mark — the breathing dot in the track list — and it is never reused for hover or selection.

## Contrast

WCAG AA wants 4.5:1 for body text. `--color-ink-faint` `#8C8992` gives 5.7:1 on Void and 5.3:1 on Night `#15151B`, the opaque end of the glass base. **Any new tertiary text token must be checked against `#0B0B0F` and against `#15151B`, not against a screenshot.** Never tint a text token toward the accent to make it feel integrated; that is exactly how contrast quietly disappears.

## The light theme

Settings → General → Theme: dark (the default, and what everything above is written around), light, or the system's. The light theme is the same design with the brand's two ends swapped: **Bone for the ground and Night for the ink**. It is one block in `index.css` under `:root[data-theme="light"]`, plus a handful of channels (`--glass-rgb`, `--line-rgb`, `--bloom-a/b`, `--lift-alpha`, `--glass-lift`, `--glass-saturate`) that the dark theme sets on `:root`.

| Token | Light value | On ground `#D6D1C6` | On glass `#F4F2ED` |
|---|---|---|---|
| `--color-ground` | `#D6D1C6` | — | 1.36:1 |
| `--color-night` | `#F4F2ED` | — | — |
| `--color-eclipse` | `#C4BFB4` | — | — |
| `--color-ink` | `#15151B` | 11.9:1 | 16.3:1 |
| `--color-ink-muted` | `#4F4C55` | 5.5:1 | 7.5:1 |
| `--color-ink-faint` | `#55525C` | 5.0:1 | 6.8:1 |
| `--color-live-ink` | `#9A2E18` | 5.0:1 | 6.8:1 |
| `--color-warn-ink` | `#764C00` | 4.9:1 | 6.7:1 |
| `--color-accent-ink` | the accent mixed 55% with black | 4.9 to 7.9:1 for the six presets | higher |

**The ground is a step below the panels, like paper under cards.** It was `#E4E1DA`, 1.17:1 from the panels' `#F4F2ED`, and the rail, the queue and the content melted into one white sheet. Three things separate them now, and they work together: the ground is darker and warmer (1.36:1); the surfaces get the sheets' lift toward solid (`--surface-bg` uses `--glass-lift`, so the default 32% draws at 59%) so a panel is lighter than what it sits on; and a light surface carries a soft shadow and a top highlight at every opacity (`--surface-lift`, `--surface-edge`). The dark theme waits for 55% before it draws a lift because an outer shadow under a translucent dark fill reads as dirt; on light it reads as depth. The bloom is a warm paper light (`233 228 218`), not white: white bloom painted the middle of the window white, exactly where the panels needed something darker to stand on.

**`--color-white` is Night in the light theme, on purpose.** About two hundred veils and hairlines are written `bg-white/6` or `border-white/8`, which on black means "a little lighter". On Bone the same intent is "a little darker", so redefining white turns every one of them in one line. The cost is a rule: **a thing that must be white in both themes — a toggle's knob — is written `#fff`, never `white`.**

**Colour as text has its own token.** Ember on Bone is 2.4:1, so `text-accent`, `text-live` and `text-warn` became `text-accent-ink`, `text-live-ink` and `text-warn-ink`. In dark they are the colours themselves; in light they darken. A fill (`bg-accent`, `bg-live`) keeps the bright colour in both.

**A light glass lets colour through.** At 55% over a pink cover, the settings sheet turned pink: a dark tint swallows what is behind it and a light one does not. The light theme keeps the person's alpha as a position on the slider and lifts it toward solid (`--glass-lift`: 55% draws at 73%, 100% stays 100%), and the blur saturates at 130% instead of 180%.

The pointer light becomes white on Bone. Grain is inverted, because white noise on Bone is invisible. The picture's veil is the ground colour, so it darkens in dark and lightens in light — the control says "Atenuar", not "Oscurecer".

The choice is saved in Rust like every other setting, and also cached in localStorage, because the first frame is painted before any `invoke` answers. `system` listens to Windows while it is the choice.

## Type

`Syne` (700/800, −0.02em) for `h1`/`h2` and the wordmark, `DM Sans` for everything else, `DM Mono` for numbers — timecodes, counts, the version (`.tabular`, with tabular figures, so a countdown never shifts). The landing uses the same three. Not Inter: the detector flags it as `overused-font`.

## A grey bloom, never a coloured one

Behind everything sits a static bloom of pale light on black: three radials in Bone and silver, brightest at the top centre. It gives the glass something to show through without bringing hue back, the same way the landing gets colour only from reflected light. It is fixed (a per-album tint once pushed violet through the whole interface) and never animates.
**One light follows the pointer** (`CursorGlow.tsx`): a 900px pool of Bone at 16% that drifts after the mouse on a soft spring. It is the one exception to the static backdrop, asked for by the user. It costs a blur re-sample on the glass while the pointer moves, so it moves only by `transform`, only with the pointer, and is not drawn with reduced motion. If the app drops below 60fps, this is the first thing to cut.

**The person can take the movement back.** Settings → Personalisation has the pointer light (on/off), the pulse on the volume (with waves, soft, off), the bloom (normal, soft at half, off) and the interface animations (on/off: off forces Motion's reduced motion through `MotionConfig` and stops every CSS transition and keyframe under `:root[data-still]`, the same rule the system's reduced motion gets). **Quiet mode** sits above them: it is not a stored setting, it is on when all four are off, and switching it writes all four — off, or back to the shipped values. The shipped values are the ones described here; `settings::EFFECTS` lists them, first value first.

**The ground is also the person's to shape, and it stays still.** The bloom has four shapes (top, corners, centre, side), all the same two greys, so moving the light never brings hue back. Grain is a fixed tile of noise at 7% over the ground: texture, and it breaks the bands a soft gradient draws over black. And the person can put **their own picture** behind the glass, darkened (0–90%) and blurred (0–40px): the one place hue may come back, because it is chosen once by the person and does not change with the music — the per-album tint that this section forbids was neither. The picture is copied to `%LOCALAPPDATA%\Starless\background` (`background.rs`), sits under the bloom and the grain, and never animates. Quiet mode does not touch any of the three: they are how the ground looks, not movement.

## The glass recipe

A glass surface is three stacked things, never one. Omitting the middle layer is what turns translucency into unreadable.

```
1. base       rgba(21,21,27,0.46)   ← Night; the bars (`glass`) sit mostly over the bloom, so they go below the 0.5 floor for more see-through. Menus and sheets keep their own alpha
2. blur       blur(24px) saturate(180%)
3. lift       0 24px 48px -12px rgba(0,0,0,0.6)
```

The base is not optional decoration. It is what makes text legible over a bright cover. **Any glass surface carrying text needs an opaque-enough base — alpha 0.5 or above. Never place text directly on unblurred artwork**, with the one exception below.

### The surfaces

The top bar, the rail, the player bar, the queue and the shortcuts on Home are one material, and Settings → Customisation → Appearance → Surface opacity is one slider for all of them, from 6% to 100%.

| Slider | Base | Frost | Edge | Lift |
|---|---|---|---|---|
| 6%, the bottom | `--line-rgb` at 6% | none | none | none |
| 20% | between the two | blur 12px, saturate 136% | full | none |
| 32%, the default | between the two | blur 22px, saturate 160% | full | none |
| 55% | between the two | blur 24px, saturate 160% | full | none |
| 100% | the glass colour, solid | blur 24px, saturate 160% | full | full |

**The slider changes the material, not only the amount.** The base adds almost the same light at every value, so on its own it only dims the picture, and it has to cross the picture's brightness on the way from lighter to darker: over a picture at 105 the rail read +9 at 6%, -2 at 20%, and vanishes near 15%. That cannot be tuned away, because the picture is the person's. So the surface stops relying on brightness: frost separates it by texture, the edge separates it on flat ground, and the lift waits for 55%, because an outer shadow is not drawn under its own box and below that it reads as a dirty halo.

**The content's fade gives way to the frost.** The shortcuts, the song lists and Home's cards live inside `<main>`, whose fade is a mask, and a mask makes a backdrop root: a blur under it never reaches the picture. So above 6%, which is when there is frost, `<main>` has no mask and a row is cut flat at the edge of the scroller. At 6% nothing blurs and the fade stays.

**The menus, the jam and the settings sheet follow the same number from 55% up**, and they keep their blur: they float over content, and under 55% the text behind them collides with their own.

**The bottom of the slider is the exception to the rule above, and it is the person's call.** It puts text on a 6% veil over their own picture, and a bright picture costs contrast; moving the slider up is the way out. It holds only because nothing scrolls behind these surfaces on a desktop. Anything that floats over content stays on glass, except the desktop menus: the phone's bars and menu, the dialogs, the jam, the settings sheet.

**A desktop menu is a surface.** The search, the three dots and the sort menu had their own darker glass with a 55% floor, and it read as a different object in the window however it was tuned. They now take the surfaces' tint and follow the slider all the way down (`surface-menu`). Three things differ, because a menu opens over content: the blur stays at 24px, so a title behind it cannot land on its own text; the edge is always there; and what is behind is dimmed to 85%, or a menu over the queue would be the queue's grey. The cost is contrast, and it is the person's call like the bottom of the slider. At the default 32%, the ink measures 6.1:1 over a picture at 120, 4.0:1 at 170, 3.1:1 at 200 and 2.1:1 over pure white, before the blur averages in what is around it. Moving the slider up is the way out.

**Sheets and dialogs are the same grey with a floor.** 55% of plain Night over a picture at 200 comes out at 102, where the old secondary text measured 2.0:1. So they start from the surfaces' lifted grey and reach Night with the slider. They dim what is behind them (`brightness(0.72)`), saturate it barely (110%, because 180% turned one cover into a stain under the text), carry the surfaces' edge, and use secondary text close to the ink (`#D3D0D4`, `#C6C3C9`). The muted text measures 5.0:1 over a picture at 170, 4.3:1 at 200 and 3.3:1 over pure white; that last one is the price of not being a black slab. The light theme keeps its tokens and does not dim, because its glass is already lifted toward solid.

**Text standing on the picture has no surface for the slider to act on.** A subtitle under a cover, a note under a heading and the lyrics sit directly on what the person chose. With a picture, and only then, `.on-ground` moves the greys close to the ink, raises the lyric tiers (idle 0.9, near 0.72, far 0.55) and adds a tight halo of the glass colour. It stays tight because `truncate` also clips the shadow, and a wide halo ended in a straight line under a title. A small control standing on the picture, like a tab capsule, takes the material itself (`surface-chip`). Over a very bright part of a picture small text is still the weakest case; the picture's darkening and blur are the way out.

**There is no specular border.** A 1px `rgba(255,255,255,0.12)` ring with a matching `inset 0 1px 0` highlight used to be layer three, and it was a signal saying the same thing the radius and the lift already say. Measured against the bloom — which is all that sits behind the bars — it was a hairline you had to look at to see. **A floating surface reads as floating because of its radius and its shadow, not because it is outlined.** Adding an outline to a floating surface is how a design gets described as "boxes on a dark background".

The border and the inset highlight go together: drop one and keep the other and what is left is a bright line along the top edge and nothing on the other three sides, which reads as a rendering fault.

**The surfaces are the exception, because a picture is not the bloom.** That measurement was made over the bloom, where the edge had nothing to add. Over a person's picture it is the only thing that keeps a surface on screen where its tint matches what is behind it. So it is one even ring of `--line-rgb` at 10%, all four sides and no top highlight, starting at nothing at the bottom of the slider. `glass` stays without one.

The track list takes the same material (`surface-card`) and keeps its `border-white/8`. It is content, not chrome: a list of songs needs a structure to hang on, at 6% too, where the surfaces' edge is still nothing. Chrome edges were decoration; that one is information.

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

**Customisation is judged by looking at the app, so the panel steps aside.** It covers
nearly the whole window, which turned every choice into a guess. Dragging a slider fades
the panel out and leaves that one control on its own small glass, on the same pixels,
with the window changing about 15 times a second; it comes back 80ms after the release.
A hold-to-preview button does the same for what cannot be dragged. It is a hold and not a
toggle, because a toggle leaves the panel hidden with nothing that says how to bring it
back. Only the panel's opacity fades, never its blur.

**A switch is compared, not just previewed.** The hand holding the preview button cannot
also flip the switch, so each row of a discrete control offers an eye: the panel leaves
and that control stays on a small glass, to flip as many times as it takes. Done, Escape
or a click elsewhere ends it. The ordinary switch stays one click.

**An option that was changed offers its way back.** A round arrow appears on its row only
while the value differs from what ships, so the arrows also say what has been changed.
The picture has none: it already has its own Remove button.

**The arrow and the eye sit beside the title, out of the flow.** A row has to be the same
size whether or not it has been changed. Beside the control they took its width, which
collapsed the hint into a column and pushed a select onto its own line.

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

## The phone

Decided with the user on 2026-11-02, one question at a time. The desktop layout does not
change; this is a second shape of the same glass for a screen about 360dp wide, chosen by
`isMobile()` —a fact of the build, never the window's width.

**Why a second shape and not the first one squeezed.** On a phone the rail, the 20px
insets and the side panels ate a third of the width: the settings panel put its section
list across most of the screen and its content against the edge. A phone is held in one
hand and read in a column, and the thumb lives at the bottom.

**The glass stays floating, with a 12px inset.** Rounded, detached surfaces are the
direction, and a phone does not change that; it changes how many pixels the inset can
spend. 12px on every side, and the same radius as on the desktop.

| Layer | On the phone |
|---|---|
| Tab bar | Floating at the bottom: Inicio, Buscar, Biblioteca. Where the thumb is |
| Mini player | Floating just above the tab bar, with the music, like the desktop bar |
| Content | One column between the top inset and the mini player |

There is no top bar and no rail. **Three tabs, not four**: Settings opens a few times
in the life of the app and does not earn a place under the thumb, so it is a gear at the
top right of Inicio. The library is a tab and a full screen, not a riel.

**The player is two sizes.** The mini player is the artwork, the title and the artist,
play/pause and next. Tapping it, or swiping it up, opens the full player: the large
artwork, the seek bar with the running-time column, the transport, and two buttons that
put the queue or the lyrics *where the artwork was*. The transport stays put underneath:
reading or choosing never costs the controls. Swiping the full player down, or its ⌄,
closes it, and the drag starts anywhere in its top half: the strip, the artwork, and the
queue or the lyrics once they are scrolled to the top — a list that is not at its top
scrolls instead.

**Skipping is a carousel.** Swiping the mini player or the full artwork sideways moves
the song with the finger; let go past the threshold and it leaves by that side while the
next one comes in by the other. The skip buttons bring the next song in the same way. A
song that changes on its own — the queue advancing — rises into the mini player, as on
the desktop bar.

**No volume control on the phone.** The phone's buttons are the volume, as in every
music app, and the app's own attenuation stays at its maximum: two volumes that multiply
are a sound that is quiet for no visible reason.

**A song row is the cover, the title over the artist, and the ⋯.** The desktop table
(number, title, album, date, time) left the title about 40px on a phone: one letter of
each name. The title and the artist take the whole width; the album and the rest are in
the ⋯, and the column headers go with the columns. One row (`PhoneTrackRow`) serves the
playlist, the album and the search lists.

**Every song row shows its ⋯, and holding the row opens the same menu.** The desktop's
"controls appear on approach" rule has no approach on a touch screen: a hover that never
comes hides the menu for good. The button is what can be seen; the long press is the
shortcut of somebody who already knows. The menu is a sheet of glass rising from the
bottom with the song at its top and options a finger can hit, closed by swiping it down
or tapping outside —not the desktop popover, whose rows are sized for a pointer and
whose edge is the screen's. Every menu of the app is that sheet on the phone, and "Add to
playlist" opens inside it with a way back instead of a submenu beside it: the sheet is the
whole width, and there is no side left to open on.

**Playlists are a list, with the cover and the whole name.** The two-column shelf cut
the names ("Canciones qu…"); a row fits more and cuts none. The library's own list/grid
choice is still respected; the list is the phone's default.

**The back button closes what is on top, one layer at a time**: the menu sheet, the
full player, a settings section and then Settings, and then the page —an artist or album,
the search results, a playlist back to the library list, another tab back to Home. On Home
the app goes behind the others instead of closing, because closing it stops the music
(`src/lib/back.ts`).

**Settings are two levels.** The section list fills the screen: one group of rows, each an
icon, the name and a ›, with "saved automatically" and the build under it. A section
enters from the right with a back arrow, and the list slides a little to the left and
fades —the two share one glass, and a translucent page over another is two pages read at
once. The rows and cards are the panel's own —it is still the reference— with one change:
a switch stays beside its text, and every wider control (a select, a slider, buttons) goes
under it at the whole width.
