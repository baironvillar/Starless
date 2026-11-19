import { describe, expect, test } from "bun:test";
import { organisedPlaylists } from "./libraryOrganisation";
import type { Playlist } from "./spotify";

const playlist = (id: string): Playlist => ({
  id,
  name: id,
  images: [],
  owner: null,
  tracks: { total: 2 },
  collaborative: false,
  description: null,
  has_custom_picture: false,
  is_public: false,
});

describe("local library organisation", () => {
  test("pinning preserves the selected sort inside both groups without mutating the cache", () => {
    const original = ["a", "b", "c", "d"].map(playlist);
    const result = organisedPlaylists(original, {
      b: { pinned: true, archived: false },
      d: { pinned: true, archived: false },
    });
    expect(result.map((item) => item.id)).toEqual(["b", "d", "a", "c"]);
    expect(original.map((item) => item.id)).toEqual(["a", "b", "c", "d"]);
  });

  test("archive hides a pinned list and restore preserves its pinned position", () => {
    const original = ["a", "b"].map(playlist);
    expect(
      organisedPlaylists(original, { b: { pinned: true, archived: true } }).map((item) => item.id),
    ).toEqual(["a"]);
    expect(
      organisedPlaylists(original, { b: { pinned: true, archived: false } }).map((item) => item.id),
    ).toEqual(["b", "a"]);
  });

  test("preferences for absent playlists never introduce stale entries", () => {
    const original = [playlist("a")];
    expect(organisedPlaylists(original, { removed: { pinned: true, archived: false } })).toEqual(
      original,
    );
    expect(organisedPlaylists([], { removed: { pinned: true, archived: true } })).toEqual([]);
  });
});
