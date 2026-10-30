import { describe, expect, test } from "bun:test";
import { placeOfSong, queueWithAdded, rowPlace, upNextTracks } from "./queue";
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
    const queued = queueWithAdded(null, track("z"), list);
    expect(queued.map((item) => item.id)).toEqual(["z", "a", "b", "c"]);
  });

  test("the list on screen is not lost: there is something after the song", () => {
    const queued = queueWithAdded(null, track("z"), list);
    const next = upNextTracks(0, queued, queued);
    expect(next.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  test("a song added to a queue that is already playing goes to the end of it", () => {
    const queued = queueWithAdded(list, track("z"), list);
    expect(queued.map((item) => item.id)).toEqual(["a", "b", "c", "z"]);
  });

  test("the same song twice is two songs", () => {
    const queued = queueWithAdded(null, track("a"), list);
    expect(queued.map((item) => item.id)).toEqual(["a", "a", "b", "c"]);
  });
});

describe("upNextTracks", () => {
  test("before anything plays there is no next, and no queue was asked for", () => {
    expect(upNextTracks(-1, list, null)).toEqual([]);
  });

  test("a queue the user asked for is shown whole", () => {
    const queued = queueWithAdded(null, track("z"), list);
    expect(upNextTracks(-1, queued, queued).map((item) => item.id)).toEqual(["z", "a", "b", "c"]);
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
    const queued = queueWithAdded(null, track("a"), list);
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
