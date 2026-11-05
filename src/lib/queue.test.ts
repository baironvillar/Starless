import { describe, expect, test } from "bun:test";
import { placeOfSong, queueWithAdded, queueWithListAdded, rowPlace, upNextTracks } from "./queue";
import type { Track } from "./spotify";

const track = (id: string): Track => ({
  id,
  name: id,
  duration_ms: 1000,
  artists: [{ id: `artist-${id}`, name: "Alguien" }],
  album: null,
  popularity: null,
  added_at: null,
});

const list = ["a", "b", "c"].map(track);

describe("queueWithAdded", () => {
  test("a song added to an empty queue leaves the list on screen behind it", () => {
    const edit = queueWithAdded(null, track("z"), list, -1);
    expect(edit.tracks.map((item) => item.id)).toEqual(["z", "a", "b", "c"]);
    expect(edit.at).toBe(-1);
  });

  test("the list on screen is not lost: there is something after the song", () => {
    const edit = queueWithAdded(null, track("z"), list, -1);
    const next = upNextTracks(0, edit.tracks, edit.tracks);
    expect(next.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  test("a song that is already on screen is moved to the front, not copied", () => {
    const edit = queueWithAdded(null, list[1], list, -1);
    expect(edit.tracks.map((item) => item.id)).toEqual(["b", "a", "c"]);
  });

  test("the moved song is one song, and the panel does not show it twice", () => {
    const edit = queueWithAdded(null, list[1], list, -1);
    expect(edit.tracks.filter((item) => item.id === "b")).toHaveLength(1);
  });

  test("only the first copy of a song that is on screen twice moves", () => {
    const twice = [list[0], list[1], list[1], list[2]];
    const edit = queueWithAdded(null, list[1], twice, -1);
    expect(edit.tracks.map((item) => item.id)).toEqual(["b", "a", "b", "c"]);
  });

  test("a song goes right after the one that is playing, not at the end", () => {
    const queue = [track("a"), track("b"), track("c"), track("d")];
    const edit = queueWithAdded(queue, track("z"), queue, 0);
    expect(edit.tracks.map((item) => item.id)).toEqual(["a", "z", "b", "c", "d"]);
  });

  test("a song that was already in the queue is replaced, and left in second place", () => {
    const queue = [track("a"), track("b"), track("c"), track("d"), track("e")];
    const edit = queueWithAdded(queue, track("e"), queue, 0);
    expect(edit.tracks.map((item) => item.id)).toEqual(["a", "e", "b", "c", "d"]);
    expect(edit.tracks.filter((item) => item.id === "e")).toHaveLength(1);
  });

  test("the song that is playing stays where it is", () => {
    const queue = [track("a"), track("b"), track("c")];
    const edit = queueWithAdded(queue, track("z"), queue, 0);
    expect(edit.at).toBe(0);
    expect(edit.tracks[edit.at].id).toBe("a");
  });

  test("a copy taken from before the song that is playing moves it one place back", () => {
    const queue = [track("a"), track("b"), track("c"), track("d")];
    const edit = queueWithAdded(queue, track("b"), queue, 2);
    expect(edit.tracks.map((item) => item.id)).toEqual(["a", "c", "b", "d"]);
    expect(edit.at).toBe(1);
    expect(edit.tracks[edit.at].id).toBe("c");
  });

  test("the song that is playing is not taken out of the queue", () => {
    const queue = [track("a"), track("b"), track("c")];
    const edit = queueWithAdded(queue, track("a"), queue, 0);
    expect(edit.tracks.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(edit.at).toBe(0);
  });

  test("a song added twice is one song", () => {
    const once = queueWithAdded(null, track("a"), list, -1);
    const twice = queueWithAdded(once.tracks, track("a"), list, once.at);
    expect(twice.tracks.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });
});

describe("queueWithListAdded", () => {
  test("a list added with nothing playing is the queue", () => {
    const edit = queueWithListAdded(null, list, -1);
    expect(edit.tracks.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(edit.at).toBe(-1);
  });

  test("a list goes right after the one that is playing", () => {
    const queue = [track("a"), track("b"), track("c")];
    const edit = queueWithListAdded(queue, [track("x"), track("y")], 0);
    expect(edit.tracks.map((item) => item.id)).toEqual(["a", "x", "y", "b", "c"]);
  });

  test("a song the queue already has is not put in the queue twice", () => {
    const queue = [track("a"), track("b"), track("c"), track("d")];
    const edit = queueWithListAdded(queue, [track("c"), track("e")], 0);
    expect(edit.tracks.map((item) => item.id)).toEqual(["a", "c", "e", "b", "d"]);
    expect(edit.tracks.filter((item) => item.id === "c")).toHaveLength(1);
  });

  test("the song that is playing is not put in the queue again", () => {
    const queue = [track("a"), track("b"), track("c")];
    const edit = queueWithListAdded(queue, [track("a"), track("d")], 0);
    expect(edit.tracks.map((item) => item.id)).toEqual(["a", "d", "b", "c"]);
  });
});

describe("upNextTracks", () => {
  test("before anything plays there is no next, and no queue was asked for", () => {
    expect(upNextTracks(-1, list, null)).toEqual([]);
  });

  test("a queue the user asked for is shown whole", () => {
    const edit = queueWithAdded(null, track("z"), list, -1);
    expect(upNextTracks(-1, edit.tracks, edit.tracks).map((item) => item.id)).toEqual([
      "z",
      "a",
      "b",
      "c",
    ]);
  });

  test("what plays next is what comes after the song that is playing", () => {
    expect(upNextTracks(1, list, null).map((item) => item.id)).toEqual(["c"]);
  });
});

describe("rowPlace", () => {
  test("the first row of the panel is the head of the queue when nothing plays", () => {
    expect(rowPlace(-1, 0)).toBe(0);
    expect(rowPlace(-1, 3)).toBe(3);
  });

  test("the panel starts one row below the song that is playing", () => {
    expect(rowPlace(2, 0)).toBe(3);
  });

  test("the same song twice in the queue: the row is the place, not the song", () => {
    const queued = [track("a"), track("a"), track("b")];
    // The second "a" is row 1 of the panel and place 1 of the queue.
    expect(rowPlace(-1, 1)).toBe(1);
    expect(queued[1].id).toBe("a");
  });
});

describe("placeOfSong", () => {
  test("the remembered place wins when it still holds the song", () => {
    expect(placeOfSong(2, list, "c")).toBe(2);
  });

  test("a song that moved is looked up again", () => {
    expect(placeOfSong(2, list, "a")).toBe(0);
  });

  test("a song that is not in the list has no place", () => {
    expect(placeOfSong(2, list, "z")).toBe(-1);
  });
});
