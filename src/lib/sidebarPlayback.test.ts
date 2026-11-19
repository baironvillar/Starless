import { expect, test } from "bun:test";
import { sidebarTransport } from "./sidebarPlayback";

const queue = { source: "list", context: { kind: "playlist" as const, id: "playlist-a" } };
const status = { trackId: "shared-track", playing: true, loading: false, finished: false };

test("transport belongs to the queue's playlist even when another playlist contains the same song", () => {
  expect(sidebarTransport(queue, status, "shared-track")).toEqual({
    id: "playlist-a",
    playing: true,
    loading: false,
  });
});
test("paused playback keeps the same playlist eligible for resume", () => {
  expect(sidebarTransport(queue, { ...status, playing: false }, "shared-track")).toEqual({
    id: "playlist-a",
    playing: false,
    loading: false,
  });
});
test("a finished track, a station or a stale status cannot claim the playlist transport", () => {
  expect(sidebarTransport(queue, { ...status, finished: true }, "shared-track")).toBeNull();
  expect(sidebarTransport({ ...queue, source: "radio" }, status, "shared-track")).toBeNull();
  expect(sidebarTransport(queue, status, "new-track")).toBeNull();
  expect(sidebarTransport(null, status, "shared-track")).toBeNull();
});
test("loading remains visible so transport cannot be toggled before audio is ready", () => {
  expect(
    sidebarTransport(queue, { ...status, playing: false, loading: true }, "shared-track")?.loading,
  ).toBe(true);
});
