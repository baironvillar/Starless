import {
  Check,
  ChevronRight,
  Disc3,
  Link2,
  ListMusic,
  ListPlus,
  MoreHorizontal,
  User,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { StringKey } from "../lib/i18n";
import type { Album, Artist, Track } from "../lib/spotify";
import { MenuItem, MenuPanel } from "./MenuPanel";
import { PlaylistPicker } from "./PlaylistPicker";

type TrackMenuProps = {
  t: Record<StringKey, string>;
  track: Track;
  onOpenArtist?: (artist: Artist) => void;
  onOpenAlbum?: (album: Album) => void;
  onAddToQueue: (track: Track) => void;
  /** Opens the new-playlist dialog with this song pending. */
  onNewPlaylist: (track: Track) => void;
};

/** How long the copied confirmation stays up before the label goes back. */
const COPIED_MS = 1600;

/**
 * How long the submenu waits before it closes itself.
 *
 * **The gap is the reason.** The submenu opens eight pixels away from the row
 * that opened it, and the pointer crosses those eight pixels on its way
 * there. A menu that closed the instant the pointer left the row would close
 * before it arrived, so it waits — and the wait is short enough that moving
 * away means moving away.
 */
const SUBMENU_CLOSE_MS = 260;

/**
 * Copy to the clipboard, and say whether it worked.
 *
 * **The async path first, the old one as the fallback.** WebView2 refuses
 * `navigator.clipboard` outside a secure context, and the textarea dance is the
 * only thing left when it does. It is deprecated everywhere else and still the
 * thing that works here, which is a fact about this runtime rather than a
 * preference.
 *
 * Returns a boolean instead of throwing because the caller has to *show* the
 * difference: a copy that silently failed leaves the user pasting whatever was
 * on the clipboard before and wondering what happened.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      // Off-screen rather than `display: none`: a hidden element cannot be
      // selected, and nothing gets copied.
      area.style.position = "fixed";
      area.style.top = "-1000px";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const done = document.execCommand("copy");
      document.body.removeChild(area);
      return done;
    } catch {
      return false;
    }
  }
}

/**
 * The three dots on a song.
 *
 * **Every row does something, and every row that could work is here.** The
 * client this mirrors offers twelve: add to playlist, remove from this
 * playlist, remove from liked songs, add to queue, exclude from taste profile,
 * start a jam, sleep timer, go to song radio, go to artist, go to album, view
 * credits, share. The radio, the jam and the credits have no read behind this
 * session at all, and "remove from this playlist" is a write against a
 * revision the backend does not keep.
 *
 * A menu of twelve entries where three work is worse than a menu of three. The
 * greyed-out rows read as broken, and the first time somebody clicks one and
 * nothing happens is the first time they stop trusting the whole control.
 *
 * **"Add to playlist" opens a submenu and the submenu does the work.** The
 * list of playlists is a second surface, measured against the row that asked
 * for it, and it is where the song goes. The row opens it on the way in —
 * a hover *is* the submenu — and the click opens it too, because the keyboard
 * has no hover.
 *
 * **Go to artist carries the artist's name**, not "go to artist" alone: a menu
 * that says the same four words for every row is a menu you have to read before
 * you can tell which row you are looking at. The first artist is the one
 * Spotify sorts them into, and a song with no artist at all gets no row — there
 * is nothing to go to.
 */
export function TrackMenu({
  t,
  track,
  onOpenArtist,
  onOpenAlbum,
  onAddToQueue,
  onNewPlaylist,
}: TrackMenuProps) {
  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const anchor = useRef<HTMLButtonElement>(null);
  const pickerAnchor = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<number | null>(null);

  const artist = track.artists[0];
  const album = track.album;

  const cancelClose = () => {
    if (closeTimer.current === null) return;
    window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };

  const openPicker = () => {
    cancelClose();
    setPickerOpen(true);
  };

  const closePickerSoon = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setPickerOpen(false);
    }, SUBMENU_CLOSE_MS);
  };

  // A menu that closes on the way out takes its timer with it.
  useEffect(() => {
    return () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    };
  }, []);

  const close = () => {
    cancelClose();
    setOpen(false);
    setPickerOpen(false);
    // The confirmation belongs to the menu; leaving it lit would light up the
    // next song's dot too.
    setCopied("idle");
  };

  const onCopy = async () => {
    const ok = await copyText(`https://open.spotify.com/track/${track.id}`);
    setCopied(ok ? "done" : "failed");
    if (!ok) return;
    setTimeout(close, COPIED_MS);
  };

  return (
    <>
      {/*
        Revealed on approach, like every other control in a row. A row that
        permanently showed three dots gave every song a permanent question mark,
        and the list went from something you read to something you operated.
      */}
      <button
        ref={anchor}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((value) => !value);
        }}
        aria-label={t.trackMenuFor.replace("{name}", track.name)}
        title={t.trackMenu}
        className={`grid size-7 shrink-0 place-items-center rounded-pill text-ink-muted transition-all duration-150 hover:bg-white/10 hover:text-ink focus-visible:opacity-100 ${
          open ? "bg-white/10 text-ink opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
      >
        <MoreHorizontal className="size-4" strokeWidth={2} />
      </button>

      <MenuPanel open={open} onClose={close} anchor={anchor} label={t.trackMenu} width={236}>
        {artist && onOpenArtist && (
          <MenuItem
            label={t.goToArtist.replace("{name}", artist.name)}
            icon={<User className="size-4" strokeWidth={2} />}
            onSelect={() => {
              close();
              onOpenArtist(artist);
            }}
          />
        )}

        {album && onOpenAlbum && (
          <MenuItem
            label={t.goToAlbum.replace("{name}", album.name)}
            icon={<Disc3 className="size-4" strokeWidth={2} />}
            onSelect={() => {
              close();
              onOpenAlbum(album);
            }}
          />
        )}

        <MenuItem
          label={t.addToQueue}
          icon={<ListPlus className="size-4" strokeWidth={2} />}
          onSelect={() => {
            close();
            onAddToQueue(track);
          }}
        />

        {/*
          The one row that opens another menu.

          **The submenu is a second portal and it is measured against this
          row.** The row is its anchor, so the submenu opens next to the thing
          that was clicked instead of in the middle of the screen, and the press
          inside the submenu does not close the menu that opened it: the
          outside-press check reads the path of the event, and the submenu is
          in it.

          **It opens on the way in, not on the click.** The row is the only one
          in the menu that changes shape under the pointer, and the chevron is
          what says so. The click still opens it, because the keyboard has no
          hover and a row that only answered the mouse would be a row the
          keyboard could not reach.
        */}
        <MenuItem
          ref={pickerAnchor}
          label={t.addToPlaylist}
          icon={<ListMusic className="size-4" strokeWidth={2} />}
          trailing={<ChevronRight className="size-4 shrink-0 text-ink-faint" strokeWidth={2} />}
          onHover={openPicker}
          onUnhover={closePickerSoon}
          onSelect={openPicker}
        />

        {pickerOpen && (
          <MenuPanel
            open
            onClose={() => setPickerOpen(false)}
            anchor={pickerAnchor}
            label={t.addToPlaylist}
            width={264}
            placement="right"
            onHover={cancelClose}
            onUnhover={closePickerSoon}
          >
            <PlaylistPicker
              t={t}
              track={track}
              onDone={close}
              onNewPlaylist={(picked) => {
                // The whole menu goes, not only the submenu: the dialog is a
                // surface of its own and a menu left open over it would cover
                // it — the menu is the higher layer.
                close();
                onNewPlaylist(picked);
              }}
            />
          </MenuPanel>
        )}

        {/*
          The one item that points outside the app, and it is a link the user
          asked for rather than Starless naming itself after anybody: PRODUCT.md
          forbids the Spotify name in *branding*, and a string this user copied
          on purpose is neither the app's name nor a claim of affiliation. It is
          the same link every client offers, and refusing to be able to share a
          song is a real gap.
        */}
        <MenuItem
          label={copied === "failed" ? t.copyFailed : t.copyLink}
          icon={
            copied === "done" ? (
              <Check className="size-4 text-accent" strokeWidth={2.5} />
            ) : (
              <Link2 className="size-4" strokeWidth={2} />
            )
          }
          onSelect={() => void onCopy()}
        />
      </MenuPanel>
    </>
  );
}
