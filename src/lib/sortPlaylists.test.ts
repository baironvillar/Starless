import { describe, expect, test } from "bun:test";
import { type Playlist, sortPlaylists } from "./spotify";

const playlist = (id: string, name: string) => ({ id, name }) as Playlist;

describe("sortPlaylists by recently played", () => {
  const shelf = [
    playlist("a", "Zeta"),
    playlist("b", "Alfa"),
    playlist("c", "Beta"),
    playlist("d", "Delta"),
  ];

  test("the latest heard first, then the never heard by name", () => {
    const order = sortPlaylists(shelf, "recent", { a: 100, c: 300 }).map((p) => p.id);
    expect(order).toEqual(["c", "a", "b", "d"]);
  });

  test("with no history at all it is the A–Z, not the order things arrived in", () => {
    const order = sortPlaylists(shelf, "recent", {}).map((p) => p.name);
    expect(order).toEqual(["Alfa", "Beta", "Delta", "Zeta"]);
  });

  test("it copies instead of rearranging the cached array", () => {
    const before = shelf.map((p) => p.id);
    sortPlaylists(shelf, "recent", { d: 1 });
    expect(shelf.map((p) => p.id)).toEqual(before);
  });
});
