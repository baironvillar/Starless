import { Check, Loader2, Plus, X } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { StringKey } from "../lib/i18n";
import type { Playlist } from "../lib/spotify";

const SPRING = { type: "spring" as const, stiffness: 420, damping: 34 };

type AddToPlaylistMenuProps = {
  t: Record<StringKey, string>;
  playlists: Playlist[];
  /** Title of the track being added, so the menu can say what it is acting on. */
  trackName: string;
  onAdd: (playlistId: string) => Promise<void>;
  onCreate: (name: string) => Promise<void>;
  onClose: () => void;
};

/**
 * "Add to playlist", as a small anchored sheet rather than a modal.
 *
 * Modal for this would be absurd: the list is a dozen names, the action takes one
 * click, and a modal would hide the track list the user is working in — the exact
 * thing they need to see when they change their mind halfway down the menu.
 *
 * Creating a playlist is folded in rather than sent elsewhere, because "I want it
 * in a new one" is a normal outcome of this action, not an excursion into a
 * different screen.
 */
export function AddToPlaylistMenu({
  t,
  playlists,
  trackName,
  onAdd,
  onCreate,
  onClose,
}: AddToPlaylistMenuProps) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /**
   * Focus the field once the sheet is up.
   *
   * Done here rather than with `autoFocus` because the menu is triggered by a
   * click somewhere else on screen, and `autoFocus` decides when to steal focus
   * at parse time — including on the render where it is merely mounted in an
   * `AnimatePresence` exit. Focusing after mount means the keystrokes go where
   * the user is looking, which is the whole reason a search field is in here.
   */
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  /**
   * Filter as the user types.
   *
   * Worth the line of code because a long library is exactly when reaching for
   * the search field matters, and a menu that cannot be searched is the reason
   * people open a new tab and do it there instead.
   */
  const matches = playlists.filter((playlist) =>
    playlist.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const exact = query.trim().length > 0 && playlists.some((p) => p.name === query.trim());

  const run = async (task: () => Promise<void>, successKey: string) => {
    setBusy(true);
    setError(null);
    try {
      await task();
      // Leave the menu up long enough for the confirmation to land. Closing it
      // immediately is what makes a bulk action feel like it did nothing.
      setDone(successKey);
      setTimeout(onClose, 700);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.98 }}
      transition={SPRING}
      role="dialog"
      aria-label={t.addToPlaylist}
      // Anchored under the row that opened it. `bottom-full` keeps it on screen at
      // the end of a long list instead of dropping off the bottom of the window.
      className="glass-overlay pointer-events-auto absolute bottom-full left-5 z-50 mb-2 w-[280px] overflow-hidden rounded-card"
      onClick={(e) => e.stopPropagation()}
    >
      <header className="flex items-center justify-between gap-2 border-b border-white/8 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-semibold">{t.addToPlaylist}</p>
          <p className="truncate text-[12px] text-ink-muted">{trackName}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t.close}
          className="grid size-7 shrink-0 place-items-center rounded-pill text-ink-muted transition-colors duration-200 hover:bg-white/10 hover:text-ink"
        >
          <X className="size-4" strokeWidth={2} />
        </button>
      </header>

      <div className="px-2 py-2">
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.playlistSearch}
          className="w-full rounded-[12px] bg-white/6 px-3 py-2 text-[13px] outline-none ring-accent/40 transition focus:ring-2"
        />
      </div>

      <ul className="max-h-[240px] overflow-y-auto px-2 pb-2">
        {matches.map((playlist) => {
          const confirmed = done === playlist.id;
          return (
            <li key={playlist.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => onAdd(playlist.id), playlist.id)}
                className="flex w-full items-center gap-2.5 rounded-[12px] px-2 py-2 text-left transition-colors duration-200 hover:bg-white/6 disabled:opacity-50"
              >
                {playlistCover(playlist)}
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                  {playlist.name}
                </span>
                {confirmed && <Check className="size-4 shrink-0 text-ok" strokeWidth={2.5} />}
              </button>
            </li>
          );
        })}

        {matches.length === 0 && !exact && (
          <li className="px-2 py-3 text-[12.5px] text-ink-faint">{t.noPlaylistsMatch}</li>
        )}

        {query.trim().length > 0 && !exact && (
          <li>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => onCreate(query.trim()), "created")}
              className="flex w-full items-center gap-2.5 rounded-[12px] px-2 py-2 text-left transition-colors duration-200 hover:bg-white/6 disabled:opacity-50"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-accent/15 text-accent">
                <Plus className="size-4" strokeWidth={2} />
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                {t.createPlaylistNamed.replace("{name}", query.trim())}
              </span>
            </button>
          </li>
        )}
      </ul>

      {error && <p className="px-4 pb-3 text-[12px] text-warn">{error}</p>}

      {busy && (
        <div className="flex items-center gap-2 border-t border-white/8 px-4 py-2.5 text-[12px] text-ink-muted">
          <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
          {t.saving}
        </div>
      )}
    </motion.div>
  );
}

/** Real playlist art, or an empty frame — same rule as every other cover here. */
function playlistCover(playlist: Playlist) {
  const images = playlist.images;
  const image = images && images.length > 0 ? images[0] : null;
  if (!image?.url) {
    return <span className="size-8 shrink-0 rounded-[9px] bg-white/8" aria-hidden />;
  }
  return (
    <span className="size-8 shrink-0 overflow-hidden rounded-[9px]">
      <img src={image.url} alt="" loading="lazy" className="size-full object-cover" />
    </span>
  );
}
