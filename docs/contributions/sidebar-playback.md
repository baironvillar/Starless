# Play playlists directly from the sidebar

Suggested PR title: `feat(library): play playlists directly from the sidebar`

Target: `develop`. Branch: `feat/sidebar-playback`.

A playlist with songs now offers a play button on hover or keyboard focus in
all three sidebar layouts. The button is a sibling of navigation, so playing
does not open another screen. Empty playlists offer no play action; the DJ's
existing card action stays separate.

`App.tsx` fetches the complete playlist through the existing React Query cache
and passes it to the existing ordered/shuffled playback paths with the clicked
playlist's context. Duplicate songs remain in the queue. The shared playback
intent prevents a slow sidebar response from replacing a newer choice or
starting music after sign-out. Loading and request errors are visible in the
sidebar. Neither the Rust player nor the audio path changes.

`playlistTracksQuery` in `spotify.ts` keeps opening, prefetching and playing on
the same query key and freshness window. `SidebarPlayButton` is shared by the
sidebar's row and grid wrappers. Labels reuse the bilingual play text.

## Manual review

Frontend checks: TypeScript, Biome on changed files and version consistency pass;
all 64 baseline Bun tests pass. Native playback and screenshots are reviewed in
the combined local test branch.

1. From Home or playlist A, hover playlist B and click its play button. B should
   start while the screen stays put. Next must follow B, not A.
2. Repeat with shuffle enabled, list/grid layouts and the collapsed rail.
3. Reach the play control with Tab and activate it with Enter.
4. Click the artwork/name instead; it should navigate without starting music.
5. With a slow request, choose another playlist or song; the older request must
   not win later. Sign-out must also invalidate it.
6. Test an empty playlist, a library request failure and the DJ card.
7. Check Spanish/English, light/dark themes and before/after screenshots.
