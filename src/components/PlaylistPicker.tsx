import { useQueryClient } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { StringKey } from "../lib/i18n";
import {
  addToPlaylist,
  coverImage,
  explain,
  keys,
  type Playlist,
  type Track,
  useAccount,
  usePlaylists,
} from "../lib/spotify";

/** How long the confirmation stays up before the menu closes by itself. */
const ADDED_MS = 1800;

type PlaylistPickerProps = {
  t: Record<StringKey, string>;
  /** The song that goes in. */
  track: Track;
  /** The whole menu closes when the pick is done. */
  onDone: () => void;
  /** Opens the new-playlist dialog with this song pending. */
  onNewPlaylist: (track: Track) => void;
};

/**
 * The list of playlists a song can go into.
 *
 * **It opens beside the row that asked for it, and it is a second portal.**
 * That is why the click inside it does not close the menu that opened it: the
 * press that lands here crossed this panel, and the outside-press check reads
 * the path of the event to know it. A submenu that closed its parent on the
 * first click would be a submenu that cannot be used.
 *
 * **Only the account's own playlists.** A playlist somebody else made is not
 * one this app can write to, and offering it would be offering a row that
 * fails. The owner arrives as the login and the account answers with the
 * login and the name, so the comparison is against the two — the same pair the
 * playlist header uses to decide whose photograph to show.
 *
 * **The confirmation stays on screen and the menu closes by itself.** The
 * alternative is to close everything and say nothing, and a write that
 * happened without a word is indistinguishable from a write that did not.
 */
export function PlaylistPicker({ t, track, onDone, onNewPlaylist }: PlaylistPickerProps) {
  const [query, setQuery] = useState("");
  const [added, setAdded] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const playlists = usePlaylists();
  const account = useAccount();
  const queryClient = useQueryClient();

  /**
   * Only the account's own playlists.
   *
   * A playlist somebody else made is not one this app can write to, and
   * offering it would be offering a row that fails. The owner arrives as the
   * login and the account answers with the login and the name, so the
   * comparison is against the two — the same pair the playlist header uses to
   * decide whose photograph to show.
   */
  const mine = useMemo(() => {
    const id = account.data?.id;
    const name = account.data?.display_name;
    return (playlists.data ?? []).filter(
      (playlist) => playlist.owner?.display_name === id || playlist.owner?.display_name === name,
    );
  }, [playlists.data, account.data]);

  /**
   * The filter narrows a list that is already in memory. It is not a search
   * against Spotify, and it says so by being a field with a caret in it.
   */
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return mine;
    return mine.filter((playlist) => playlist.name.toLowerCase().includes(needle));
  }, [mine, query]);

  const add = async (playlist: Playlist) => {
    setBusy(playlist.id);
    setFailure(null);
    setAdded(null);
    try {
      await addToPlaylist(playlist.id, track.id);
      setAdded(playlist.name);
      // The playlist grew, so its count and the shelf both move.
      void queryClient.invalidateQueries({ queryKey: keys.playlists });
      void queryClient.invalidateQueries({ queryKey: keys.playlistTracks(playlist.id) });
      setTimeout(onDone, ADDED_MS);
    } catch (error) {
      // The code arrives from Rust as it is, and `explain` turns it into a
      // sentence about the thing that actually failed.
      setFailure(explain(error));
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col">
      {/*
        The field goes first and it is a real input: the caret has to be
        somewhere, and the list below is long enough that finding one by
        scrolling is worse than typing two letters.
      */}
      <div className="flex items-center gap-2 px-3 pb-1 pt-1">
        <Search className="size-4 shrink-0 text-ink-muted" strokeWidth={2} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t.findPlaylist}
          aria-label={t.findPlaylist}
          className="w-full bg-transparent text-[13px] outline-none placeholder:text-ink-faint"
        />
      </div>

      {/*
        La fila de "Nueva playlist" abre el diálogo con esta canción esperando.

        **El diálogo lleva una canción, no una lista.** Por eso esta fila vive
        acá y no hay una versión de ella para "las canciones de una playlist".
      */}
      <button
        type="button"
        onClick={() => onNewPlaylist(track)}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors duration-150 hover:bg-white/6"
      >
        <span className="grid size-4 shrink-0 place-items-center text-ink-muted">
          <Plus className="size-4" strokeWidth={2} />
        </span>
        <span className="min-w-0 flex-1 truncate">{t.newPlaylist}</span>
      </button>

      <div className="mx-3 my-1 h-px bg-white/8" />

      <div className="max-h-[280px] overflow-y-auto">
        {visible.length === 0 && (
          <p className="px-3 py-2 text-[12px] text-ink-muted">
            {mine.length === 0 ? t.noPlaylistsYet : t.noPlaylistMatches}
          </p>
        )}

        {visible.map((playlist) => {
          const cover = coverImage(playlist.images);
          const working = busy === playlist.id;
          return (
            <button
              key={playlist.id}
              type="button"
              disabled={busy !== null}
              onClick={() => void add(playlist)}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors duration-150 hover:bg-white/6 disabled:opacity-50"
            >
              {cover ? (
                <img
                  src={cover.url}
                  alt=""
                  className="size-5 shrink-0 rounded-[4px] object-cover"
                />
              ) : (
                <span
                  className="grid size-5 shrink-0 place-items-center rounded-[4px] bg-white/10 text-[10px] font-semibold text-ink-muted"
                  aria-hidden
                >
                  {playlist.name.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate">{playlist.name}</span>
              {working && <span className="text-[11px] text-ink-faint">…</span>}
            </button>
          );
        })}
      </div>

      {/*
        The outcome, in the place where the choice was made. A write that
        happened without a word is indistinguishable from a write that did
        not, and the second one is the one the user has to be told about.
      */}
      {(added !== null || failure !== null) && (
        <p
          role="status"
          className={`mx-3 mb-1 mt-0.5 rounded-[8px] px-2 py-1.5 text-[12px] ${
            failure !== null ? "text-warn" : "text-accent"
          }`}
        >
          {failure !== null ? failure : t.addedToPlaylist.replace("{name}", added ?? "")}
        </p>
      )}
    </div>
  );
}
