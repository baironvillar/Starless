import type { Track } from "./spotify";

/**
 * The queue after an edit, and where the song that is playing ended up.
 *
 * **The two travel together.** Taking a song out of the queue moves everything
 * that was behind it, so the place of the song that is playing is part of the
 * edit and not something the caller has to guess afterwards.
 */
export type QueueEdit = {
  /** The queue, in the order it will be played. */
  tracks: Track[];
  /** Where the song that is playing is now, or -1 when nothing is playing. */
  at: number;
};

/**
 * The queue without the songs that are being added, and where the song that is
 * playing stays.
 *
 * **The copy that is already there is taken out.** A song that is put in the
 * queue is one song: putting it in twice would put it in the queue twice, and
 * the panel would show it twice —one row the user did not ask for, and one that
 * is the same song. The user asked for it to be *next*, and "next" is a place,
 * not a second copy of the song.
 *
 * **Only the first copy goes.** A list can hold the same song twice, and the
 * second copy was not put there by this click.
 *
 * **The song that is playing is not taken out.** It is the cursor: without it
 * there is no place to insert anything, and a queue that lost the song it was
 * playing would be playing something else.
 */
function withoutThese(base: Track[], songs: Track[], at: number): { tracks: Track[]; at: number } {
  const ids = new Set(songs.map((song) => song.id));
  const tracks: Track[] = [];
  const gone = new Set<string>();
  let removedBefore = 0;
  for (let index = 0; index < base.length; index++) {
    const item = base[index];
    if (index === at) {
      tracks.push(item);
      continue;
    }
    if (ids.has(item.id) && !gone.has(item.id)) {
      gone.add(item.id);
      if (index < at) removedBefore += 1;
      continue;
    }
    tracks.push(item);
  }
  return { tracks, at: at < 0 ? -1 : at - removedBefore };
}

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
 * **The song goes in the place right after the one that is playing.** Not at the
 * end of the queue: "next" means next, and a song the user is waiting for sits
 * at the end of a long queue for the whole of it. With nothing playing that
 * place is the head of the queue.
 *
 * **And it replaces the copy that was already there.** The song the user put in
 * the queue is one of the songs on screen —they picked it from there—, so
 * putting it in the next place *and* leaving it where it was would put the same
 * song in the queue twice, and the panel would show it twice.
 *
 * **A song that is already playing is not added.** It is the song the user is
 * listening to; there is nothing to queue behind it.
 */
export function queueWithAdded(
  current: Track[] | null,
  track: Track,
  visible: Track[],
  at: number,
): QueueEdit {
  // **Sin cola, la base es la lista de la pantalla.** Agregar una canción no
  // convierte la pantalla en cola: la canción va primero y la lista la sigue.
  const base = current ?? visible;
  if (at >= 0 && base[at]?.id === track.id) return { tracks: base, at };
  const { tracks: rest, at: cursor } = withoutThese(base, [track], at);
  const where = cursor < 0 ? 0 : cursor + 1;
  return { tracks: [...rest.slice(0, where), track, ...rest.slice(where)], at: cursor };
}

/**
 * The queue after a list of songs is put in it.
 *
 * **A list is not the screen.** Adding a playlist to the queue does not also
 * add whatever the screen happens to be showing: the playlist is what the user
 * put in the queue, and the screen is not.
 *
 * **The songs go in the place right after the one that is playing**, in the
 * order the list has them.
 *
 * **And the copies that are already there are replaced.** A playlist that has a
 * song the queue already has does not put that song in the queue twice: the
 * user added it once, and the panel showing it twice is the app inventing a
 * row.
 *
 * **The song that is playing is not added.** It is already sounding, and a
 * queue that says it is going to play it again is a queue that lies.
 */
export function queueWithListAdded(current: Track[] | null, songs: Track[], at: number): QueueEdit {
  if (!current) return { tracks: songs, at: -1 };
  const playingId = at >= 0 ? current[at]?.id : null;
  const adding = playingId ? songs.filter((song) => song.id !== playingId) : songs;
  const { tracks: rest, at: cursor } = withoutThese(current, adding, at);
  const where = cursor < 0 ? 0 : cursor + 1;
  return { tracks: [...rest.slice(0, where), ...adding, ...rest.slice(where)], at: cursor };
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
