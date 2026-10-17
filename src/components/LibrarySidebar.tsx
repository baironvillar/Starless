import { Heart, Plus } from "lucide-react";
import { motion } from "motion/react";
import type { StringKey } from "../lib/i18n";
import { type Account, largestImage, type Playlist } from "../lib/spotify";

type LibrarySidebarProps = {
  t: Record<StringKey, string>;
  account: Account | null;
  playlists: Playlist[];
  likedCount: number | null;
  activeId: string;
  onSelect: (id: string) => void;
  /** Called on approach, so the list is already loaded by the time it is opened. */
  onPrefetch?: (playlistId: string) => void;
};

/**
 * The library, floating at the left edge.
 *
 * Liked Songs is a tile rather than a row because it is not one playlist among
 * others — it is the one thing in the library that cannot be deleted, unfollowed
 * or reordered, and it is where the accent colour earns its place.
 */
export function LibrarySidebar({
  t,
  account,
  playlists,
  likedCount,
  activeId,
  onSelect,
  onPrefetch,
}: LibrarySidebarProps) {
  return (
    <motion.aside
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -16 }}
      transition={{ type: "spring", stiffness: 380, damping: 34 }}
      aria-label={t.navLibrary}
      className="glass pointer-events-auto absolute top-[104px] bottom-[144px] left-5 z-20 hidden w-[288px] flex-col overflow-hidden rounded-card lg:flex"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 px-4 pt-4 pb-3">
        <h2 className="truncate text-[15px] font-semibold tracking-tight">{t.navLibrary}</h2>
        {/* Sign-out used to sit next to the title. It is a settings action, not a
            library one, and the queue of things a music player shows in its
            library is long enough without the one button that ends the session. */}
        <motion.button
          type="button"
          whileTap={{ scale: 0.9 }}
          transition={{ type: "spring", stiffness: 420, damping: 32 }}
          aria-label={t.createPlaylist}
          title={t.createPlaylist}
          className="grid size-8 shrink-0 place-items-center rounded-pill text-ink-muted transition-colors duration-200 hover:bg-white/10 hover:text-ink"
        >
          <Plus className="size-[17px]" strokeWidth={2} />
        </motion.button>
      </header>

      {account && (
        <div className="flex shrink-0 items-center gap-3 px-4 pb-4">
          {largestImage(account.images) ? (
            <img
              src={largestImage(account.images)?.url}
              alt=""
              className="size-10 shrink-0 rounded-pill object-cover"
            />
          ) : (
            <span className="size-10 shrink-0 rounded-pill bg-accent/20" aria-hidden />
          )}
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold">
              {account.display_name || account.id}
            </p>
            <p className="truncate text-[12px] text-ink-muted">
              {account.product === "premium" ? t.planPremium : t.planFree}
            </p>
          </div>
        </div>
      )}

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <button
          type="button"
          onClick={() => onSelect("liked")}
          className={`mb-1 flex w-full items-center gap-3 rounded-[14px] px-2 py-2 text-left transition-colors duration-200 ${
            activeId === "liked" ? "bg-white/12" : "hover:bg-white/6"
          }`}
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-[9px] bg-accent text-ground">
            <Heart className="size-4 fill-current" strokeWidth={2} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold">{t.likedSongs}</span>
            <span className="tabular block truncate text-[12px] text-ink-muted">
              {likedCount !== null ? `${likedCount} ${t.songs}` : t.loading}
            </span>
          </span>
        </button>

        {playlists.length > 0 && (
          <h3 className="px-2 pt-3 pb-1.5 text-[12px] font-semibold tracking-wide uppercase text-ink-faint">
            {t.yourPlaylists}
          </h3>
        )}

        {playlists.map((playlist) => {
          const cover = largestImage(playlist.images);
          return (
            <button
              key={playlist.id}
              type="button"
              onClick={() => onSelect(playlist.id)}
              onPointerEnter={() => onPrefetch?.(playlist.id)}
              onFocus={() => onPrefetch?.(playlist.id)}
              className={`flex w-full items-center gap-3 rounded-[14px] px-2 py-2 text-left transition-colors duration-200 ${
                activeId === playlist.id ? "bg-white/12" : "hover:bg-white/6"
              }`}
            >
              {cover ? (
                <img
                  src={cover.url}
                  alt=""
                  loading="lazy"
                  className="size-9 shrink-0 rounded-[9px] object-cover"
                />
              ) : (
                <span className="size-9 shrink-0 rounded-[9px] bg-white/8" aria-hidden />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{playlist.name}</span>
                {/* No song count here on purpose. `/me/playlists` stopped returning
                    one in the February 2026 migration, so the number would either
                    be a guess or "0" — and a confident wrong count next to a name is
                    worse than none. The header over the list shows the real count of
                    what is actually loaded. */}
              </span>
            </button>
          );
        })}
      </nav>
    </motion.aside>
  );
}
