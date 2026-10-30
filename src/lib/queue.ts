import type { Track } from "./spotify";

/**
 * The queue after a song is put in it.
 *
 * **A song added to an empty queue does not become the whole queue.**
 *
 * Adding one song to a list of eight that nobody asked to hear is not adding a
 * song: it is turning whatever the screen happens to be showing into a queue,
 * and the panel would then show eight songs the user never put there. So the
 * song goes first and the list follows it — the queue is the list on screen plus
 * what the user put in it, one source, no drift.
 *
 * **This is what the live log showed.** A song was added with nothing playing,
 * the song was played, and at its end the app found nothing after it and started
 * the radio instead: the queue said one thing and the player did another.
 *
 * **A song added to a queue that already exists goes to the end of it.** A queue
 * that is playing has a place for the new song: after what is already there.
 *
 * A duplicate is not deduplicated. A queue is not a set — somebody who adds the
 * same song twice meant to hear it twice, and quietly dropping the second is the
 * app disagreeing with a decision that was made on purpose.
 */
export function queueWithAdded(current: Track[] | null, track: Track, visible: Track[]): Track[] {
  return current ? [...current, track] : [track, ...visible];
}

/**
 * What the panel shows as "next up".
 *
 * **Before anything plays there is no "next".** The panel shows what comes after
 * the song that is playing, and if nothing is playing there is no after: what is
 * on screen is the content of the screen, not a queue. An app freshly opened with
 * eight songs under "next up" is a queue that invented itself, and the user is
 * right to be annoyed: nobody asked for it.
 *
 * **Unless the user asked for one.** A queue that exists because a song was put
 * in it is shown whole: there is something to click, and clicking it is how that
 * queue starts.
 */
export function upNextTracks(queueAt: number, visible: Track[], override: Track[] | null): Track[] {
  if (queueAt < 0) return override ?? [];
  return visible.slice(queueAt + 1);
}

/**
 * Where the row the user clicked is in the queue.
 *
 * **The row's place, not the song's.** The queue can hold the same song twice —
 * one account here has a playlist of fifty items and forty-six different ids —,
 * and looking the song up by its id finds the *first* copy, which is the one
 * that already played. From there "what comes next" is a song from the past, and
 * the panel lies about what is coming.
 *
 * The row's index is relative to the panel, and the panel starts where the
 * queue's current song ends: one row down from what is playing, or at the head
 * when nothing is playing yet.
 */
export function rowPlace(queueAt: number, row: number): number {
  return (queueAt < 0 ? 0 : queueAt + 1) + row;
}

/**
 * Where a song is in the list on screen.
 *
 * **The remembered place goes stale when the list changes.** The user opens
 * another playlist while the song plays: the list is another one now, and the
 * number that said where the song was does not say where it is. The song is the
 * same song, so the place is looked up again — by id, and only when the
 * remembered place does not have it.
 *
 * **A song that is not in the list has no place, and the queue starts over.**
 * The app does not know what should follow a song that has nothing in front of
 * it, and the list on screen is the queue: it starts again from its first song.
 */
export function placeOfSong(remembered: number, visible: Track[], songId: string): number {
  if (remembered >= 0 && visible[remembered]?.id === songId) return remembered;
  return visible.findIndex((item) => item.id === songId);
}
