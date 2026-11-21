import { ListPlus } from "lucide-react";
import { useRef, useState } from "react";
import type { StringKey } from "../lib/i18n";
import type { Track } from "../lib/spotify";
import { MenuPanel } from "./MenuPanel";
import { PlaylistPicker } from "./PlaylistPicker";

type AddToPlaylistButtonProps = {
  t: Record<StringKey, string>;
  /** The song that is sounding. */
  track: Track;
  /** Opens the new-playlist dialog with this song pending. */
  onNewPlaylist: (track: Track) => void;
};

/**
 * "Add what is playing to…", beside the song's name in the player bar.
 *
 * **It reuses the track row's picker and nothing else of its menu.** The row's
 * three dots carry go-to-artist, queue and copy-link, none of which the bar
 * needs; the picker is the part that writes, and it already knows the account's
 * playlists, the new-playlist door and the confirmation. `withLiked` adds the
 * one door a row has no need of, because a row lives inside a list that is
 * already Liked Songs or is not.
 *
 * **The panel is a leaf**, like every `MenuPanel`: it floats over the bar but
 * its React parent is the bar, whose clicks (the phone's mini opens the full
 * player on tap) must not hear a press that belongs to the menu.
 */
export function AddToPlaylistButton({ t, track, onNewPlaylist }: AddToPlaylistButtonProps) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        ref={anchor}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        aria-label={t.addToPlaylist}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t.addToPlaylist}
        className={`grid size-8 shrink-0 place-items-center rounded-pill text-ink-muted transition-colors duration-150 hover:bg-white/10 hover:text-ink ${
          open ? "bg-white/10 text-ink" : ""
        }`}
      >
        <ListPlus className="size-[17px]" strokeWidth={2} />
      </button>

      <MenuPanel
        open={open}
        onClose={() => setOpen(false)}
        anchor={anchor}
        label={t.addToPlaylist}
        width={264}
      >
        <PlaylistPicker
          t={t}
          track={track}
          withLiked
          onDone={() => setOpen(false)}
          onNewPlaylist={(picked) => {
            setOpen(false);
            onNewPlaylist(picked);
          }}
        />
      </MenuPanel>
    </>
  );
}
