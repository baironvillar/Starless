# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Starless ships as a Windows desktop app via Tauri. The interface is a local webview, not a website served over the network, and `web` is the closest value this schema offers. The design language is not per-OS and does not adapt, so the platform is not `adaptive`. macOS and Linux follow Windows; see Constraints.

## Stack

Tauri 2.12 (Rust) with librespot 0.8 as the backend, React 19 + Vite 8 + TypeScript 6 frontend, Bun as package manager, Biome for lint and format, Tailwind v4, Motion, TanStack Router and Query, Zustand for the player store.

Vite over Next.js is a settled decision, not an oversight. Tauri serves a local asset protocol with no server behind it, so SSR, React Server Components, edge middleware and API routes have nothing to render, and the `output: 'export'` fallback would remove routing and image optimization in exchange for nothing.

## Users

Primary: people who already pay for Spotify Premium and are frustrated with the official desktop client — it feels slow to start and heavy on resources. They arrive from a recommendation or their own search, already holding a Premium account.

They are not looking for a different music service. They want the same one that opens faster. They install once, log in, and use Starless as a daily driver.

## Product Purpose

Starless is an unofficial desktop client for Spotify Premium. It exists because the official client is slow and heavy, and because a desktop music player should open instantly and then get out of the way.

Success means: cold start under one second, a small memory footprint while playing, and an interface that feels designed rather than assembled. A user who installs Starless and keeps using it daily has succeeded. A user who tries it once and returns to the official app has not.

## Positioning

Three claims a neighbouring client could not truthfully copy:

1. **Cold start under a second, with a small memory footprint.** Decoded audio goes straight to the system driver (rodio/cpal → WASAPI on Windows) and never passes through the webview, so the window is interactive before the session finishes negotiating with Spotify.
2. **An interface built for motion rather than adapted to it.** Transitions, crossfades and layout changes are designed as a system, not retrofitted screen by screen.
3. **Zero telemetry.** Starless reports usage data to nobody, including its author.

Explicitly not claimed: Starless does not remove the algorithmic feed and does not replace cards with something else. The home feed stays.

## Operating Context

Desktop, Windows first, window around 1180×760 with a 900×600 minimum. The user is almost always doing something else at the same time — Starless is a companion to another task, not the task. It should be startable, usable and dismissable without demanding attention.

Because it is a desktop window rather than a site, window-level affordances matter: media keys, quick search, and a player bar that is always present so the user never has to navigate somewhere to control playback.

## Capabilities and Constraints

Durable constraints that future work must preserve:

- **Spotify Premium is required.** librespot states this is permanent; free accounts will not be supported. Every surface that can set that expectation should.
- **The backend is reverse-engineered.** Spotify publishes no protocol specification. Assume a multi-day outage will eventually happen for reasons outside this project. All librespot calls sit behind a thin abstraction so a breakage is patched in one place rather than rippling through the app.
- **Installers are unsigned for now.** Windows SmartScreen and macOS Gatekeeper will warn. The first-run experience must prepare the user for that instead of surprising them. Signing is a later, budgeted decision.
- **Windows first.** macOS and Linux follow. Linux needs `libasound2-dev` at build time for the ALSA path.
- **Audio never travels through the webview.** Decoded PCM goes straight to the system driver. Any change that moves audio onto a webview API would break both the speed claim and the memory claim.

Undecided:

- Whether Starless registers as a Spotify Connect device.
- Code-signing budget and timing.
- Domain and final logo.

## Brand Commitments

- Name: **Starless**.
- Starless is an unofficial third-party client. It must not use Spotify's name in branding, must not use the Spotify logo or wordmark, and must not imply endorsement or affiliation. The README carries the disclaimer.
- Nothing is yet committed about visual identity, palette or typography. Those are open until design work begins.

## Evidence on Hand

None. There are no testimonials, usage numbers, benchmarks, screenshots or press. Future work must not fabricate any of them.

The performance claims above are design targets, not measurements. Do not present them as verified results until they have actually been measured.

## Product Principles

1. **Fast is a feature, not an optimization.** Under a second to interactive is a requirement. Any change that adds work to startup must justify itself against that number.
2. **Designed, not assembled.** Type, spacing, color and motion are one system. Consistency is cheaper than novelty on every individual screen.
3. **Say no by default.** Zero telemetry is a product constraint, not a setting. Adding analytics later means retracting a stated promise.
4. **Surface the constraint, never hide it.** Premium-only and unsigned-installer are facts the user meets in the first minute. State them plainly instead of letting the user discover them.
5. **Bilingual from the first commit.** Spanish and English ship together. Copy is written so both read naturally, rather than writing one and translating the other.

## Accessibility & Inclusion

Not established with the user. Open questions: contrast targets, full keyboard operability of navigation and transport controls, and screen-reader labelling for player controls, search and dialogs. Do not assume a conformance level has been agreed.