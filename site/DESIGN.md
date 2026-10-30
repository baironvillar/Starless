---
name: Starless landing
description: The ferrofluid speaker. A black pool that keeps the beat, and a still page around it.
colors:
  ground: "#08080a"
  graphite: "#1c1d21"
  chrome: "#c8ccd4"
  frost: "#f4f5f7"
  body: "#cfd2d8"
  mute: "#9a9ea8"
  hairline: "rgb(244 245 247 / 0.1)"
  track: "#2f3036"
typography:
  display:
    fontFamily: "Funnel Display, Funnel Sans, sans-serif"
    fontSize: "clamp(56px, 6.6vw, 96px)"
    fontWeight: 600
    lineHeight: 0.92
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Funnel Display, Funnel Sans, sans-serif"
    fontSize: "clamp(36px, 4.6vw, 72px)"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Funnel Display, Funnel Sans, sans-serif"
    fontSize: "clamp(24px, 2.4vw, 34px)"
    fontWeight: 500
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  title-small:
    fontFamily: "Funnel Display, Funnel Sans, sans-serif"
    fontSize: "21px"
    fontWeight: 500
    letterSpacing: "-0.02em"
  lead:
    fontFamily: "Funnel Sans, system-ui, sans-serif"
    fontSize: "clamp(17px, 1.4vw, 20px)"
    fontWeight: 400
    lineHeight: 1.55
  body:
    fontFamily: "Funnel Sans, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Funnel Sans, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    fontFeature: "tnum"
  action:
    fontFamily: "Funnel Sans, system-ui, sans-serif"
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
    backgroundColor: "{colors.chrome}"
    textColor: "{colors.ground}"
    typography: "{typography.action}"
    rounded: "{rounded.capsule}"
    padding: "15px 24px"
  download-key-compact:
    backgroundColor: "{colors.chrome}"
    textColor: "{colors.ground}"
    rounded: "{rounded.capsule}"
    padding: "12px 18px"
  player-bar:
    backgroundColor: "{colors.graphite}"
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

## Overview

**Creative North Star: "The Ferrofluid Speaker"**

The page is a still room with one thing moving in it: a pool of black ferrofluid, rendered live, that raises its spikes on a 112 BPM kick and on the speed of the visitor's hand. Everything else stays monochrome and moves only with the hand: the page is a playlist, and scrolling is what changes the track. Sections crossfade like songs, hairlines draw themselves in, the app's window changes screen while it holds still, the DJ says its line a word at a time, the feature list lights the row in the middle of the screen, and each thing Starless doesn't do is crossed out. All of it is scroll-driven CSS; without scroll timelines, or with reduced motion, the page is still and complete. The music is made visible; the interface stays out of its way.

Order comes from rings, not boxes. Concentric hairline circles centred on the pool pass through the top edge of every section, so reading down the page is travelling outward from the speaker; each section change sends a wave from one ring to the next. Content sits on the ground between hairlines, never in cards, never behind glass.

Colour is withheld on purpose. Near-black ground, graphite for the one floating surface, cool frost for type, and polished chrome for the single action. The only hue on the page is what reflected light lends the liquid and the chrome. The user rejected a colourful, retro, giant-condensed world before this one; this system is the answer to that rejection.

**Key Characteristics:**
- One moving object (the pool); everything else still.
- Concentric rings as the page's structure; one ring per section.
- Achromatic palette; hue only as reflected light.
- One chrome object, the download key, rendered as a real reflection.
- Hairline rules instead of containers.
- A fixed player bar that treats each section as a track.

## Colors

An achromatic, faintly cool ramp from black to frost; no accent hue exists.

### Primary
- **Polished Chrome** (chrome): the download key and nothing else. Its flat value is only the fallback; the shipped face is painted per pixel as a reflection (bright ceiling over the label, a crisp dark horizon below it, a grey room underneath, a softbox strip on the straight face only).

### Neutral
- **Speaker Black** (ground): the page, the room around the pool, and the shader's floor colour. Also the text colour on chrome.
- **Graphite** (graphite): the fixed player bar, the only floating surface.
- **Frost** (frost): headings, the active player title, the progress fill, focus outline, selection.
- **Bone Text** (body): reading copy in paragraphs, ledes and lists; one step under frost so headings lead.
- **Mute** (mute): metadata, nav links at rest, version numbers, fine print, captions.
- **Hairline** (hairline): frost at 10% for every rule and every ring. A stronger frost at 45% marks the single lead block in "Antes de instalar"; the travelling ring wave is frost at 50%.
- **Groove** (track): the empty progress track under the player title.

### Named Rules
**The Reflected Light Rule.** No hue is ever applied as a fill, accent, or text colour. Colour appears only where the shader or the key computes reflected light (the cool rim on the liquid, the cool edge of the chrome).

**The One Chrome Rule.** Chrome belongs to the download action alone. A second chrome object on a page dilutes the only thing the eye should reach for after the pool.

## Typography

**Display Font:** Funnel Display (with Funnel Sans, sans-serif)
**Body Font:** Funnel Sans (with system-ui, sans-serif)

**Character:** A normal-width grotesk pairing, tight at display sizes and open in reading. No condensed widths and no oversized poster type outside the one name in the hero.

### Hierarchy
- **Display** (600, clamp 56–96px, 0.92, -0.04em): the product name in the hero only.
- **Headline** (500, clamp 36–72px, 1, -0.02em): one per section, a short declarative sentence ending in a full stop.
- **Title** (500, clamp 24–34px, 1.1): promise names; smaller steps at 26px (the lead note), 21px (feature rows) and 19px (facts).
- **Lead** (400, clamp 17–20px, 1.55): the hero offer, max 26rem; section ledes at 18px / 1.6, max 34rem.
- **Body** (400, 16–17px, 1.55–1.65): reading copy in body colour.
- **Label** (400, 13–14px, tabular numbers): metadata, versions, durations, fine print, nav, in mute.
- **Action** (600, 15px; 14px in the player): the key's label and the player title.

### Named Rules
**The Tabular Numbers Rule.** Every version, count and duration sets in tabular figures so columns of numbers align and do not jitter.

**The Normal Width Rule.** Headlines stay at Funnel Display's normal width and weights 500/600. Condensed or giant display type is a rejected direction.

## Layout

A centred container of 1200px inside a fluid gutter (clamp 20–56px). The hero fills the viewport: the pool's canvas spans it full-bleed with the pool centred at 66% across and 50% down, and the words (max 34rem) sit left, vertically centred. Sections stack with tall vertical padding (clamp 96–160px) so each one owns a ring's band. Inside sections, structure is a two-column grid (1fr : 1.2fr for promises; 1fr : 1fr for the install notes) or a numbered list of rows (number, title, line, version), separated only by hairlines. Blocks start 48–56px under their headline.

The ring layer is a document-sized SVG behind the content, centred on the pool. Ring radii are measured, not fixed: each one equals the distance from the pool's centre to a section's top, with the last at the footer, and they are re-laid on resize and font load.

At 860px and below the pool moves above the words (centred at 50% across, 34% down, radius 42% of the shorter side) and the words drop to the bottom of the hero. Two-column grids collapse to one; feature rows fold their description under the title; the nav keeps only its last link; the player key drops its label to an icon. The footer leaves 150px at the bottom so the fixed player never covers content.

## Elevation & Depth

Flat ground; depth is rendered, not stacked. The pool's depth comes from the oblique raymarch and its own lighting, the key's from its per-pixel reflection. The page itself is one plane of hairlines on black. There is exactly one lifted surface: the fixed player bar.

### Shadow Vocabulary
- **Player lift** (`box-shadow: 0 20px 50px rgb(0 0 0 / 0.55), 0 0 0 1px rgb(244 245 247 / 0.1)`): the player bar only, a deep soft drop plus a hairline edge so graphite separates from black.

### Named Rules
**The Single Lift Rule.** Only the fixed player floats. Nothing else gets a drop shadow, a glass blur, or a raised tone.

## Shapes

Circles and capsules echo the speaker: the pool, the rings, the player's round bead, the capsule key (999px). The player bar has gently rounded corners (18px). Everything in the reading flow is square-cornered and unbordered, separated by full-width hairlines top and bottom. Rings use non-scaling 1px strokes so they stay hairlines at every radius.

## Components

### Buttons
- **Download key:** a chrome capsule (999px), Speaker Black label at 600 with a 17px stroked download arrow, padding 15px 24px; the compact player variant is 12px 18px at 14px, and icon-only (12px 14px) at 860px and below.
- **Face:** painted into a canvas behind the label at device pixel ratio up to 2, as a reflection of the pool's room; the flat chrome colour shows only before paint or without canvas.
- **Hover / Focus:** the softbox strip slides across the face over 320ms (ease-out cubic) and the pool's energy surges; pressing scales to 0.97 over 160ms. Focus is a 2px frost outline offset 3px.

### Navigation
- **Style:** a top line of 14px mute links, 26px apart, with the version label at left in tabular numbers. Hover shifts to frost over 200ms. On phones only the last link remains.

### Feature rows
- **Style:** an ordered list of four-column rows (number, title, line, version) at 20px vertical padding between hairlines. Hover lifts the row to frost at 4% over 200ms. An upcoming item carries "Próxima" in frost in place of a version.

### Player bar (signature)
- **Structure:** fixed 16px above the bottom, centred, max 760px, graphite, 18px corners, under the Player lift. A 42px round bead at left, the current track title (15px, 600) over a mute subline, a 2px progress groove, and the compact download key at right.
- **Behaviour:** the title is the section in view, named as a track; changes roll the old title up and the new one in from below over 420ms. The progress fill follows scroll position. The bead pulses with the kick and scroll speed.

### Ferrofluid pool (signature)
- **Render:** a full-screen WebGL fragment shader at one pixel per CSS pixel. An oblique view (foreshortened ground, height lifting on screen) marched in 64 steps plus 6 bisections, early-out to the dish's footprint; outside the dish only the floor is shaded.
- **Form:** a low dome carrying a hexagonal lattice of cones whose footprints overlap so neighbours meet in saddles; the spikes fade before the rim so the edge reads as a meniscus.
- **Light:** black liquid that shows only what it faces: a tight key specular, a broad sheen and fresnel masked to the flanks, two softbox strips (tall and wide), and a cool rim; the floor carries four expanding rings and a contact shadow.
- **Energy:** 0.42 base plus a kick at 112 BPM that decays fast, plus scroll velocity, plus a surge while a download key is hovered or focused. Rendering pauses when the hero leaves the viewport.
- **Reduced motion:** a single frame at fixed energy; no wave, no title roll.

### Rings (signature)
- **Style:** hairline circles centred on the pool, one per section top and one at the footer. A frost wave at 50% scales from the previous ring to the new one and fades over 1400ms on each track change.

## Do's and Don'ts

### Do:
- **Do** keep the pool the only continuously moving thing on a page; everything else moves only in answer to the visitor.
- **Do** separate content with frost hairlines at 10% and let new sections sit on a new ring.
- **Do** use ease-out cubic-bezier(0.23, 1, 0.32, 1) for every transition: 420ms for the title roll, 1400ms for the ring wave, 320ms for the key's slide.
- **Do** set every number in tabular figures.
- **Do** keep reading copy in body colour and metadata in mute, with headlines in frost.
- **Do** render light (liquid, chrome) computationally so it reads as reflection, at dpr 1 for the full-screen shader.

### Don't:
- **Don't** introduce any hue as a fill, accent or text colour; colour comes only from reflected light.
- **Don't** put content in cards or behind glass; the product's own window is the only framed object.
- **Don't** use gradients as decoration; gradients exist only where they render the liquid's or the chrome's light.
- **Don't** add a second chrome object or a second floating surface besides the player bar.
- **Don't** use condensed widths or giant poster type beyond the hero name.

<!-- OPEN ITEMS (not part of the system):
- The app section holds a labelled sample window, waiting for the user's real screenshot; its placeholder greys are not tokens.
- Fonts load from Google Fonts in the mockup; the Astro build will self-host Funnel Display and Funnel Sans.
Direction: .impeccable/surfaces/index-html.md, seed:493bf2d1c9f053b5 -->

## Player drop

The player bar's art is a drop of the same liquid: an 84px WebGL canvas (shown at 42px) rendering a bead with a few lattice spikes, lit by the pool's key and rim lights and driven by the same energy, so the bar keeps the beat after the pool scrolls away. Reduced motion renders one frame.

## Download target

Every download key links to `https://github.com/baironvillar/Starless/releases/latest`, the release GitHub marks Latest (0.5.5 when this was written). The version text on the page must follow it.
