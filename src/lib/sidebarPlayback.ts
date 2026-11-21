import type { PlaybackStatus, RadioContext } from "./spotify";

export type SidebarTransport = { id: string; playing: boolean; loading: boolean };
export type SidebarRequest = { request: number; intent: number };

/** Fetching is not a playback decision: a failed read must leave the DJ alive. */
export function createSidebarRequests(readIntent: () => number) {
  let latest = 0;
  return {
    begin: (): SidebarRequest => ({ request: ++latest, intent: readIntent() }),
    current: (ticket: SidebarRequest) =>
      ticket.request === latest && ticket.intent === readIntent(),
    async load<T>(ticket: SidebarRequest, fetch: () => Promise<T>, play: (data: T) => void) {
      const data = await fetch();
      if (ticket.request === latest && ticket.intent === readIntent()) play(data);
    },
  };
}

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
