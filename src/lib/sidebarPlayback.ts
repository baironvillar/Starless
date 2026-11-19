import type { PlaybackStatus, RadioContext } from "./spotify";

export type SidebarTransport = { id: string; playing: boolean; loading: boolean };

/** Membership is not enough: two playlists can contain the same song. */
export function sidebarTransport(
  queue: { source: string; context: RadioContext | null } | null,
  status: Pick<PlaybackStatus, "trackId" | "playing" | "loading" | "finished"> | null,
  loadedTrackId: string | null,
): SidebarTransport | null {
  if (
    queue?.source !== "list" ||
    queue.context?.kind !== "playlist" ||
    !status?.trackId ||
    status.trackId !== loadedTrackId ||
    status.finished
  )
    return null;
  return { id: queue.context.id, playing: status.playing, loading: status.loading };
}
