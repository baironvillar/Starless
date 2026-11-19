import type { Playlist } from "./spotify";

export type PlaylistPreference = { pinned: boolean; archived: boolean; position?: number | null };
export type LibraryOrganisation = Record<string, PlaylistPreference>;

export function pinnedIds(preferences: LibraryOrganisation): string[] {
  return Object.keys(preferences)
    .filter((id) => preferences[id].pinned)
    .sort(
      (a, b) =>
        (preferences[a].position ?? Number.MAX_SAFE_INTEGER) -
          (preferences[b].position ?? Number.MAX_SAFE_INTEGER) || (a < b ? -1 : a > b ? 1 : 0),
    );
}

/** Older preferences had no position: migrate them independently of the shelf sort. */
export function normaliseOrganisation(preferences: LibraryOrganisation): LibraryOrganisation {
  const updated = { ...preferences };
  pinnedIds(preferences).forEach((id, position) => {
    updated[id] = { ...preferences[id], position };
  });
  return updated;
}

/** Only the unpinned group follows the selected library sort. */
export function organisedPlaylists(playlists: Playlist[], preferences: LibraryOrganisation) {
  const visible = playlists.filter((playlist) => !preferences[playlist.id]?.archived);
  const ranks = new Map(pinnedIds(preferences).map((id, index) => [id, index]));
  return [
    ...visible
      .filter((playlist) => preferences[playlist.id]?.pinned)
      .sort((a, b) => (ranks.get(a.id) ?? 0) - (ranks.get(b.id) ?? 0)),
    ...visible.filter((playlist) => !preferences[playlist.id]?.pinned),
  ];
}
