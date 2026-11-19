# Pin and archive playlists locally

Suggested PR title: `feat(library): pin and archive playlists on this device`

Target: `develop`. Independent of `fix/playing-track-number`.

## Behavior

- The playlist menu can pin/unpin and archive/restore actual playlists, including
  followed playlists. It excludes the DJ card.
- Pinned playlists precede other playlists, preserving the chosen sort inside
  each group. Pins also take priority in Home's quick-access tiles.
- Archived playlists disappear from the rail, Home and the phone's Library.
- Home and the phone's Library always offer Archived playlists with restore
  buttons. Restoring retains the pin.
- Changes are local, scoped by account, and never modify the remote library or
  interrupt the existing play queue. Sign-out retains these local preferences.
- Rust keeps `library-organisation.json` beside settings, outside credentials.
  File operations run off the UI thread, serialize access and replace a sibling
  temporary file. A corrupt file produces an error instead of being overwritten.

## Files across the boundary

- `library_organisation.rs`: persistence and storage regression tests.
- `lib.rs`: asynchronous commands and handler registration.
- `spotify.ts`: command wrappers and the account-scoped query key.
- `libraryOrganisation.ts`: shared query/mutation and stable playlist grouping.
- `App.tsx`: one filtered/sorted library for every regular shelf.
- Playlist menus, pin marks, Home and MobileLibrary: actions and recovery surface.
- `i18n.ts`: Spanish and English together; PRODUCT and DESIGN document the behavior.

## Validation

- `bun run lint`: passes, with 15 existing warnings in the landing's Astro files.
- `bun run version`: passes (0.7.0-beta.4); no version bump.
- `bun run typecheck`: passes.
- `bun test`: 68 passing tests, including four organisation/storage regressions.
- Browser fixture using the real menu, hook and archive component: pinning moved
  Beta before Alfa; archiving hid Beta; reload retained the archive; restoring
  brought Beta back first, still pinned. This exercised the browser fallback,
  not Rust persistence or a real account.
- Rust/Cargo and Microsoft C++ Build Tools were initially missing; installed
  from their official sources with the user's authorization.
- `cargo check --locked`: passes, with existing dependency warnings.
- `cargo test --lib --locked`: 85 pass, 0 fail, 3 ignored, including both new
  persistence tests and the existing crossfade/report regression tests.
- `rustfmt --edition 2024 --check src/library_organisation.rs`: passes.
  Repository-wide `cargo fmt --check` reports existing formatting differences;
  unrelated Rust files were not reformatted.
- Native playback and before/after screenshots remain required before submitting
  a ready-for-review PR.

## Manual review in the app

1. Pin playlists under every sort; compare the rail, grid, Home and phone Library.
2. Archive an active playlist during playback; the queue must keep playing.
3. Archive all playlists, then restore from Home or phone Library.
4. Restart and sign out/in. Pins and archives must survive for that account only.
5. Switch accounts with a shared followed playlist; preferences must stay separate.
6. Test storage failure: show an error and retain the visible state.
7. Check both languages, light/dark themes, keyboard use and narrow desktop windows.
8. Capture before/after screenshots and run the backend tests.
