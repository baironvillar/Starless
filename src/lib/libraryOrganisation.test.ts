import { describe, expect, test } from "bun:test";
import { organisedPlaylists } from "./libraryOrganisation";
import type { Playlist } from "./spotify";
import { libraryOrganisation, setPinnedOrder, setPlaylistPreference } from "./spotify";

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
  test("the browser fallback persists changes without crossing account boundaries", async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
    try {
      const preference = { pinned: true, archived: true };
      await setPlaylistPreference("first", "shared", preference);
      expect(await libraryOrganisation("first")).toEqual({
        shared: { ...preference, position: 0 },
      });
      expect(await libraryOrganisation("second")).toEqual({});
      await setPlaylistPreference("first", "shared", { ...preference, archived: false });
      expect((await libraryOrganisation("first")).shared).toEqual({
        pinned: true,
        archived: false,
        position: 0,
      });
      await setPlaylistPreference("first", "another", { pinned: true, archived: false });
      await setPinnedOrder("first", ["another", "shared"]);
      const reloaded = await libraryOrganisation("first");
      expect(reloaded.another.position).toBe(0);
      expect(reloaded.shared.position).toBe(1);
      expect(await libraryOrganisation("second")).toEqual({});
      await expect(setPinnedOrder("first", ["another", "another"])).rejects.toThrow();
      expect(await libraryOrganisation("first")).toEqual(reloaded);
    } finally {
      if (original) Object.defineProperty(globalThis, "localStorage", original);
      else Reflect.deleteProperty(globalThis, "localStorage");
    }
  });
  test("pins keep their saved order when the rest of the library changes sort", () => {
    const original = ["a", "b", "c", "d"].map(playlist);
    const result = organisedPlaylists(original, {
      b: { pinned: true, archived: false, position: 1 },
      d: { pinned: true, archived: false, position: 0 },
    });
    expect(result.map((item) => item.id)).toEqual(["d", "b", "a", "c"]);
    expect(
      organisedPlaylists([...original].reverse(), {
        b: { pinned: true, archived: false, position: 1 },
        d: { pinned: true, archived: false, position: 0 },
      }).map((item) => item.id),
    ).toEqual(["d", "b", "c", "a"]);
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

  test("legacy pins without positions stay stable across shelf sorts", () => {
    const preferences = {
      b: { pinned: true, archived: false },
      a: { pinned: true, archived: false },
    };
    expect(
      organisedPlaylists([playlist("b"), playlist("a")], preferences).map((item) => item.id),
    ).toEqual(["a", "b"]);
    expect(
      organisedPlaylists([playlist("a"), playlist("b")], preferences).map((item) => item.id),
    ).toEqual(["a", "b"]);
  });

  test("preferences for absent playlists never introduce stale entries", () => {
    const original = [playlist("a")];
    expect(organisedPlaylists(original, { removed: { pinned: true, archived: false } })).toEqual(
      original,
    );
    expect(organisedPlaylists([], { removed: { pinned: true, archived: true } })).toEqual([]);
  });
});
