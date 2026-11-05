---
name: Starless landing
description: The ferrofluid speaker. A black pool that keeps the beat, and a still page around it.
colors:
  ground: "#0b0b0f"
  night: "#15151b"
  chrome: "#c4c1c8"
  glass: "rgb(255 255 255 / 0.14)"
  frost: "#edeae3"
  body: "#c4c1c8"
  mute: "#9a97a0"
  ember: "#ff5a36"
  hairline: "rgb(237 234 227 / 0.1)"
  track: "#24242c"
typography:
  display:
    fontFamily: "Syne, DM Sans, sans-serif"
    fontSize: "clamp(64px, 7.4vw, 112px)"
    fontWeight: 700
    lineHeight: 0.95
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Syne, DM Sans, sans-serif"
    fontSize: "clamp(36px, 4.6vw, 72px)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Syne, DM Sans, sans-serif"
    fontSize: "clamp(24px, 2.4vw, 34px)"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  title-small:
    fontFamily: "Syne, DM Sans, sans-serif"
    fontSize: "21px"
    fontWeight: 700
    letterSpacing: "-0.02em"
  lead:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "clamp(17px, 1.4vw, 20px)"
    fontWeight: 400
    lineHeight: 1.55
  body:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "DM Mono, ui-monospace, monospace"
    fontSize: "13px"
    fontWeight: 400
    fontFeature: "tnum"
  action:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
rounded:
  focus: "4px"
  player: "18px"
  capsule: "999px"
spacing:
  gutter: "clamp(20px, 4vw, 56px)"
  section: "clamp(96px, 14vh, 160px)"
  container: "1200px"
  row: "20px"
  block: "48px"
components:
  download-key:
    backgroundColor: "{colors.glass}"
    textColor: "{colors.frost}"
    typography: "{typography.action}"
    rounded: "{rounded.capsule}"
    padding: "15px 24px"
  download-key-compact:
    backgroundColor: "{colors.glass}"
    textColor: "{colors.frost}"
    rounded: "{rounded.capsule}"
    padding: "12px 18px"
  player-bar:
    backgroundColor: "rgb(21 21 27 / 0.62)"
    textColor: "{colors.frost}"
    rounded: "{rounded.player}"
    padding: "10px 10px 10px 12px"
    width: "min(760px, calc(100% - 24px))"
  nav-link:
    textColor: "{colors.mute}"
    typography: "{typography.label}"
  nav-link-hover:
    textColor: "{colors.frost}"
  track-row:
    textColor: "{colors.body}"
    padding: "20px 8px"
---

# Design System: Starless landing

## Brand

The mark is **"wave over equalizer"**: a ring, eight bars fading from light grey to almost black, and a sine wave drawing an S over them. **No stars, ever**: it replaced a fading star. The mark is grey only; Ember is for the interface.

- **Hero:** `starless-glass.svg` on a `.sl-glass` plate with the app icon's corner (22.5%), above the wordmark.
- **Header and favicon:** `starless.svg`, the flat grey mark, at 28px; the glass blurs into nothing that small.
- **Wordmark:** lowercase "starless" in Syne 700, -0.03em, silver gradient (`.sl-wordmark`). It is the hero's `h1` and the header's name.

The SVGs in `site/public` are written by `bun run logo` at the repo root, from the same geometry as the app icons. Do not edit them by hand. Tokens, `.sl-glass` and `.sl-wordmark` come from `brand-kit/tokens.css`.

## Overview

**Creative North Star: "The Ferrofluid Speaker"**

The page is a still room with one thing moving in it: a pool of black ferrofluid, rendered live, that raises its spikes on a 112 BPM kick and on the speed of the visitor's hand. Everything else stays monochrome and moves only with the hand: the page is a playlist, and scrolling is what changes the track. A section arrives as it comes up from the bottom and stays lit for as long as it is on screen, hairlines draw themselves in, the app's window changes screen while it holds still, the DJ says its line a word at a time, the feature list lights the row in the middle of the screen, and each thing Starless doesn't do is crossed out. All of it is scroll-driven CSS; without scroll timelines, or with reduced motion, the page is still and complete. The music is made visible; the interface stays out of its way.

**Nothing on the page may be dimmed out of sight, and nothing on it may flicker.** The scroll drives the page, not the reader: an effect may bring something in, draw it, light it or take it away, but whatever is on screen is legible. A section that fades to a tenth of its opacity on the way out reads as a broken page, not as a transition, and the same goes for a row that cannot be read and a digit that vanishes — the first version of this page did all three, and scrolling it felt like losing the text. A frame that leaves the text unpainted is the same failure by another road: the words are there, and the reader sees them blink out and back. So the decoration may never make the page stutter while it is read.

Order comes from the flow itself, not from boxes and not from curves. Sections are separated by space and by the hairlines between their rows: nothing sits in a card, nothing behind glass, and nothing is divided by a drawn curve. Nothing marks the section being read either — the player bar names it.

Colour is withheld on purpose. Void for the ground, glass over Night for the one floating surface, Bone for type, and frosted glass with an Ember light under it for the single action. Ember is the one hue: under the download keys and on the player's progress fill, nothing else; everything else is reflected light. The user rejected a colourful, retro, giant-condensed world before this one; this system is the answer to that rejection.

**Key Characteristics:**
- One moving object (the pool); everything else still.
- The content's own hairlines as the page's structure; nothing drawn between the sections.
- Grey palette; one warm light (Ember) on the progress fill; otherwise hue only as reflected light.
- One action, the download key: frosted glass with an ember breathing under it.
- Hairline rules instead of containers.
- A fixed player bar that treats each section as a track.

## Colors

A grey ramp from Void to Bone, faintly warm, with one accent: Ember.

### Primary
- **Ember under glass**: the download key and nothing else. A capsule of frosted glass (white 14% to 4%, white 18% border, `blur(16px) saturate(160%)`) with a blurred Ember light beneath it.
- **Silver** (chrome, `#C4C1C8`): the second song in the crossfade figure.

### Neutral
- **Void** (ground, `#0B0B0F`): the page, the room around the pool, and the shader's floor colour.
- **Night** (night, `#15151B`): the base under the player's glass, the window frame, the pool's fallback.
- **Ember** (ember, `#FF5A36`): the light under the download keys and the player's progress fill. The only hue on the page; never in the logo, never anywhere else.
- **Bone** (frost, `#EDEAE3`): headings, the active player title, focus outline, selection.
- **Body** (body, `#C4C1C8`): reading copy in paragraphs, ledes and lists; one step under frost so headings lead.
- **Smoke** (mute, `#9A97A0`): metadata, nav links at rest, version numbers, fine print, captions.
- **Hairline** (hairline): frost at 10% for every rule. A stronger frost at 45% marks the single lead block in "Antes de instalar".
- **Groove** (track): the empty progress track under the player title.

### Named Rules
**The Reflected Light Rule.** Apart from Ember under the keys and on the progress fill, no hue is applied as a fill, accent, or text colour. Colour appears only where the shader computes reflected light. The shader's lights were moved from cool blue to the brand's grey with the new identity.

**The One Ember Rule.** The light under the glass belongs to the download action alone. A second glowing object on the page dilutes the only thing the eye should reach for after the pool.

## Typography

**Display Font:** Syne 600-800 (with DM Sans)
**Body Font:** DM Sans (with system-ui, sans-serif)
**Numbers:** DM Mono for versions, counts, durations (`.nums`)

**Character:** Syne's wide, slightly eccentric forms carry the name and the headlines; DM Sans stays out of the way in reading. The app uses the same three.

### Hierarchy
- **Display** (700, clamp 64–112px, 0.95, -0.03em, silver gradient): the wordmark in the hero only.
- **Headline** (700, clamp 36–72px, 1, -0.02em): one per section, a short declarative sentence ending in a full stop.
- **Title** (700, clamp 24–34px, 1.1): promise names; smaller steps at 26px (the lead note), 21px (feature rows) and 19px (facts).
- **Lead** (400, clamp 17–20px, 1.55): the hero offer, max 26rem; section ledes at 18px / 1.6, max 34rem.
- **Body** (400, 16–17px, 1.55–1.65): reading copy in body colour.
- **Label** (400, 13–14px; numbers in DM Mono): metadata, versions, durations, fine print, nav, in mute.
- **Action** (600, 15px; 14px in the player): the key's label and the player title.

### Named Rules
**The Tabular Numbers Rule.** Every version, count and duration sets in tabular figures so columns of numbers align and do not jitter.

**The Normal Width Rule.** Headlines stay at Syne's normal width. Condensed or giant display type is a rejected direction.

## Layout

A centred container of 1200px inside a fluid gutter (clamp 20–56px). The hero fills the viewport: the pool's canvas spans it full-bleed with the pool centred at 66% across and 50% down, and the words (max 34rem) sit left, vertically centred. Sections stack with tall vertical padding (clamp 96–160px) so each one owns its own space. Inside sections, structure is a two-column grid (1fr : 1.2fr for promises; 1fr : 1fr for the install notes) or a numbered list of rows (number, title, line, version), separated only by hairlines. Blocks start 48–56px under their headline.

At 860px and below the pool moves above the words (centred at 50% across, 34% down, radius 42% of the shorter side) and the words drop to the bottom of the hero. Two-column grids collapse to one; feature rows fold their description under the title; the nav keeps only its last link; the player key drops its label to an icon. The footer leaves 150px at the bottom so the fixed player never covers content.

## Elevation & Depth

Flat ground; depth is rendered, not stacked. The pool's depth comes from the oblique raymarch and its own lighting, the key's from the light diffused through its glass. The page itself is one plane of hairlines on black. The glass surfaces are the fixed player bar, the hero's logo plate and the download keys.

### Shadow Vocabulary
- **Glass** (`.sl-glass`: white 6% fill, white 16% border, `inset 0 1px 0` white 30% highlight, `0 30px 60px` black 50%, `blur(24px) saturate(140%)`): the player bar (over a Night base at 62%, so its title stays legible over running text) and the hero's logo plate.

### Named Rules
**The Glass Rule.** Only the player and the logo plate are glass. Nothing in the reading flow gets a drop shadow, a glass blur, or a raised tone.

## Shapes

Circles and capsules echo the speaker: the pool, the player's round bead, the capsule key (999px). The player bar has gently rounded corners (18px). Everything in the reading flow is square-cornered and unbordered, separated by full-width hairlines top and bottom. There is no other shape on the page: no rings, no dot, nothing drawn between the sections.

## Components

### Buttons
- **Download key:** a frosted-glass capsule (999px), Bone label at 600 with a 17px stroked download arrow, padding 15px 24px; the compact player variant is 12px 18px at 14px, and icon-only (12px 14px) at 860px and below. Edge: `inset 0 1px 0` white 40% on top, a faint Ember `inset 0 -8px 18px` at the bottom, and a `0 14px 34px` black 50% drop.
- **Ember under the glass (`::before`):** a radial Ember light at the bottom of the capsule, blurred 10px and spilling a little past the edge. At rest it sits low (6px down, 80% wide) at 45% opacity and breathes with the pool's kick (`--beat`, set every frame from the same 112 BPM pulse).
- **Hover / Focus:** the ember rises and grows (opacity to 85%, scale 1.05, 320–420ms ease-out) and follows the pointer across the key (`--mx`); a white specular line crosses the face over 800ms (`::after`); the arrow drops 2px; the border warms; the pool's energy surges. Pressing scales to 0.97 over 160ms. Focus is a 2px frost outline offset 3px. Reduced motion: no transitions, no beat.

### Navigation
- **Style:** a top line of 14px mute links, 26px apart, with the grey mark, the wordmark and a "Beta" capsule (DM Mono, 11px, uppercase, a hairline pill in mute) at left. The version number used to sit there and read as noise next to the name; what a visitor needs to know is that the app is still a beta. Hover shifts to frost over 200ms. On phones only the last link (GitHub) and the language switch remain.
- **Language:** English is the page the build writes; both languages live in `src/i18n/en.json` and `es.json`, and each text carries its key in `data-i18n` (and `data-i18n-label`, `data-i18n-track`). How to add one is in `docs/landing-i18n.md`. The switch is "EN / ES" in DM Mono, the language being read in frost. Changing it dissolves the words (`filter: blur(4px) opacity(0)`, 180ms out, 280ms back in) and nothing else: the pool, the glass and the layout stay. It is a filter because the scroll timelines own the opacity of half those elements. The choice is remembered in `localStorage`; reduced motion swaps instantly.

### Feature rows
- **Style:** an ordered list of four-column rows (number, title, line, version) at 20px vertical padding between hairlines. Hover lifts the row to frost at 4% over 200ms. An upcoming item carries "Próxima" in frost in place of a version.
- **The row in the middle of the screen** comes up to full light and a meter starts on its beat next to its number; the rest wait dimmed at 45%, which is dim enough to read. The number never goes away: the meter sits beside it, not on it.

### Player bar (signature)
- **Structure:** fixed 16px above the bottom, centred, max 760px, glass over Night, 18px corners. A 42px round bead at left, the current track title (15px, 600) over a mute subline, a 2px progress groove filled in Ember, and the compact download key at right.
- **Behaviour:** the title is the section in view, named as a track; changes roll the old title up and the new one in from below over 420ms. One roll at a time: a fast scroll crosses two sections at once, and the title that is still arriving changes its text instead of starting a second roll — two rolls in flight put the two titles on top of each other. The progress fill follows scroll position. The bead pulses with the kick and scroll speed.

### Ferrofluid pool (signature)
- **Render:** a full-screen WebGL fragment shader at one pixel per CSS pixel. An oblique view (foreshortened ground, height lifting on screen) marched in 64 steps plus 6 bisections, early-out to the dish's footprint; outside the dish only the floor is shaded.
- **Form:** a low dome carrying a hexagonal lattice of cones whose footprints overlap so neighbours meet in saddles; the spikes fade before the rim so the edge reads as a meniscus.
- **Light:** black liquid that shows only what it faces: a tight key specular, a broad sheen and fresnel masked to the flanks, two softbox strips (tall and wide), and a cool rim; the floor carries four expanding rings and a contact shadow.
- **Energy:** 0.42 base plus a kick at 112 BPM that decays fast, plus scroll velocity, plus a surge while a download key is hovered or focused. Rendering pauses when the hero leaves the viewport.
- **Reduced motion:** a single frame at fixed energy; no travelling mark, no title roll.

### The app window (drawn, not photographed)
- **What it is:** the app's own window, drawn in HTML and CSS — the glass, the riel, the table of tracks, the bar that comes with the music. Four screens: the library, a playlist, the queue, the settings, and the hand scrolls from one to the next.
- **Why it is drawn:** the captures that used to be here were photographs of a real account: its playlists, its songs, its name and other people's artwork. `public/` is published with the site, so a photograph in it is a disclosure. A drawing is not.
- **What is left out:** the names are bars where the word would be, and the covers are gradients that belong to nobody. The app's own words stay — "Tu biblioteca", "Cola de reproducción", "Orden personalizado" — because the chrome is the product.
- **How it scales:** the drawing is made at 1440 and every size is a multiple of `--u`, a hundredth of the window's width, so the window shows the app at its own size instead of a shrunk photograph of a bigger one.
- **Don't** put a real name, a real song, a real playlist or anyone's artwork in there, and don't bring the photographs back.

### Between the sections (nothing)
- **What there was:** a family of concentric hairline curves centred on the pool, one per section, and a wave that travelled over them. The rings were the page's structure: reading down the page was travelling outward from the speaker.
- **Why it is gone:** a page whose sections are separated by curves reads as a diagram of itself. The curves were decoration pretending to be structure, and every version of them — circles, arcs, ovals, the wave — was harder to read than the content they sat behind: the first one closed into a round shape around the pool, the arcs became a page of scribbles, and the one that carried the position was brighter than its neighbours. The dot that replaced them was the same idea in miniature, a mark laid over the content, and it went too.
- **What is left:** the content and the hairlines between its rows, and the player bar naming the section being read. Nothing else is drawn between the sections, and nothing says where you are except that bar.
- **Don't** bring any of it back: no ring, no arc, no dot, no curve drawn over the content.

## Do's and Don'ts

### Do:
- **Do** keep the pool the only continuously moving thing on a page; everything else moves only in answer to the visitor.
- **Do** separate content with frost hairlines at 10% and let each section own its space.
- **Do** use ease-out cubic-bezier(0.23, 1, 0.32, 1) for every transition: 420ms for the title roll, 320–420ms for the ember under the key, 800ms for its specular line.
- **Do** set every number in tabular figures.
- **Do** keep reading copy in body colour and metadata in mute, with headlines in frost.
- **Do** render the liquid's light computationally so it reads as reflection, at dpr 1 for the full-screen shader.
- **Do** let a section arrive over its entry phase and stay lit while it is on screen, and let the two pinned sections light up as they come in: a fade-out that takes the content down to a tenth on the way out empties the page exactly where the eye expects to find the next section.

### Don't:
- **Don't** introduce any hue besides Ember on the progress fill; colour otherwise comes only from reflected light.
- **Don't** put a star anywhere, and don't colour the logo.
- **Don't** put reading content in cards or behind glass; the product's own window is the only framed object.
- **Don't** use gradients as decoration; they exist only where they render light: the liquid, the glass, the ember, the silver wordmark.
- **Don't** add a second glowing object, or glass beyond the player, the logo plate and the download keys.
- **Don't** use condensed widths or giant poster type beyond the hero wordmark.
- **Don't** dim, hide or replace what is on screen: no text below its reading opacity, no number that vanishes under a meter, no scroll range that leaves the page empty.
- **Don't** separate the sections with drawn curves, and don't bring the rings back: the content's own hairlines divide the page, and the player bar says where you are. **Don't** replace them with a dot either.
- **Don't** let a decoration repaint the page while it is read: no scaled SVG stroke, no giant path re-stroked over the whole document, nothing that leaves a frame unpainted.

<!-- OPEN ITEMS (not part of the system):
Direction: .impeccable/surfaces/index-html.md, seed:493bf2d1c9f053b5 -->

## Player drop

The player bar's art is a drop of the same liquid: an 84px WebGL canvas (shown at 42px) rendering a bead with a few lattice spikes, lit by the pool's key and rim lights and driven by the same energy, so the bar keeps the beat after the pool scrolls away. Reduced motion renders one frame.

## Download target

Every download key links to `https://github.com/baironvillar/Starless/releases/latest`, the release GitHub marks Latest (0.5.5 when this was written). The page no longer prints the version: the line under the download key and the player bar say "In beta" instead, so nothing on the page goes stale when a release ships. The size next to the key still follows the release.
