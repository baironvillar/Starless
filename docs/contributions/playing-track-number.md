# Playing track number

Suggested PR title: `fix(player): hide the track number behind the playing indicator`

Target: `develop`.

The playlist's number stayed visible underneath the absolute-positioned equalizer.
Hide it while the row is playing, matching the existing numbered list. The number
keeps its layout space so titles stay aligned in list and compact views.

## Validation

- `bun run lint`: passes, with 15 existing warnings in the landing's Astro files.
- `bun run typecheck`: passes.
- `bun run version`: passes (0.7.0-beta.4).
- Native playback and before/after screenshots: pending.

## Manual review

1. Open a playlist in list view and play a song. Only the equalizer should occupy
   its number slot, both with and without the pointer over the row.
2. Switch to compact view; confirm the same behavior and unchanged title alignment.
3. Play another song. The previous row's number should return.
4. Check loading, failed tracks, light/dark themes, and duplicate song entries.
5. Compare with album/search numbered lists and the phone's numberless rows.

This change does not alter playback state or list keys.
