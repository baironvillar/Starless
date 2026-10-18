import { Heart, PanelLeftClose, PanelLeftOpen, TriangleAlert } from "lucide-react";
import { motion } from "motion/react";
import type { StringKey } from "../lib/i18n";
import { type Account, largestImage, type Playlist } from "../lib/spotify";

/** Two widths, and the space each one claims from the content area. */
const RAIL_PX = 72;
const PANEL_PX = 240;

const SPRING = { type: "spring" as const, stiffness: 380, damping: 34 };

type LibrarySidebarProps = {
  t: Record<StringKey, string>;
  account: Account | null;
  playlists: Playlist[];
  likedCount: number | null;
  /**
   * Set when the library came back as nothing at all.
   *
   * A list that failed to load and a list that is genuinely empty look exactly
   * the same on screen, and the second reading is the one nobody can act on: the
   * app looks fine and the account looks empty. This is the prop that keeps the
   * difference visible.
   */
  error?: boolean;
  activeId: string;
  /** The riel: covers only, no names. */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSelect: (id: string) => void;
  /** Called on approach, so the list is already loaded by the time it is opened. */
  onPrefetch?: (playlistId: string) => void;
};

/**
 * The library, floating at the left edge, in one of two widths.
 *
 * **The riel is the default, and it is why this is a column at every width at all.**
 * A library that is 240px of names is a library that spends a quarter of a laptop
 * screen on the fact that the playlist is called something, when every playlist
 * already has artwork that says it. Collapsed to 72px the same list is a strip of
 * covers, the name is still in the header over the list it opens, and 168px goes
 * back to the thing that needed the room. Expanded is one click away and stays
 * there for whoever reads names.
 *
 * **A docked column at every width, never a sheet.** The sheet it used to become
 * below `lg` covered the content it was supposed to be beside, and put the only
 * button that closes it underneath itself. 72px is narrow enough to fit where a
 * 288px panel could not, which is the whole reason this layout works at the app's
 * own minimum width.
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
  error,
  activeId,
  collapsed,
  onToggleCollapsed,
  onSelect,
  onPrefetch,
}: LibrarySidebarProps) {
  const avatar = account ? largestImage(account.images) : null;

  /**
   * The mark that says where you are.
   *
   * A bar rather than a tint on the row, because in the riel the tint has no
   * room to be seen: the tile is 36px of artwork and the background behind it is
   * already the glass. The bar reads at that size, and it is a state mark, which
   * is one of the few things allowed to be the accent colour.
   */
  const mark = (selected: boolean) =>
    selected ? (
      <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-pill bg-accent" aria-hidden />
    ) : null;

  return (
    <motion.aside
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0, width: collapsed ? RAIL_PX : PANEL_PX }}
      exit={{ opacity: 0, x: -16 }}
      transition={SPRING}
      aria-label={t.navLibrary}
      // The width is animated, and it is the one layout animation in the app that
      // resizes a glass surface — which costs a blur re-sample per frame for about
      // a quarter of a second. It is worth it: the alternative is a panel that
      // teleports to half its width while the content beside it slides over 300ms,
      // and the two moving at different speeds reads as a mistake.
      className="glass pointer-events-auto absolute top-[104px] bottom-[144px] left-5 z-20 flex flex-col overflow-hidden rounded-card"
    >
      {/* The title is alone in here on purpose. Sign-out used to sit next to it,
          and creating a playlist used to sit next to that: the first is a settings
          action rather than a library one, and the second is gone with the rest of
          what this channel can no longer do. */}
      <header
        className={`flex shrink-0 items-center gap-2 pb-3 ${
          collapsed ? "justify-center px-2 pt-3" : "px-4 pt-4"
        }`}
      >
        {!collapsed && (
          <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight">
            {t.navLibrary}
          </h2>
        )}
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? t.expandLibrary : t.collapseLibrary}
          title={collapsed ? t.expandLibrary : t.collapseLibrary}
          className="grid size-8 shrink-0 place-items-center rounded-pill text-ink-muted transition-colors duration-200 hover:bg-white/8 hover:text-ink"
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4" strokeWidth={2} />
          ) : (
            <PanelLeftClose className="size-4" strokeWidth={2} />
          )}
        </button>
      </header>

      {account && (
        <div
          className={`flex shrink-0 items-center ${
            collapsed ? "justify-center px-2 pb-3" : "gap-3 px-4 pb-4"
          }`}
        >
          {avatar ? (
            <img src={avatar.url} alt="" className="size-9 shrink-0 rounded-pill object-cover" />
          ) : (
            <span className="size-9 shrink-0 rounded-pill bg-accent/20" aria-hidden />
          )}
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold">
                {account.display_name || account.id}
              </p>
              <p className="truncate text-[12px] text-ink-muted">
                {account.product === "premium" ? t.planPremium : t.planFree}
              </p>
            </div>
          )}
        </div>
      )}

      <nav
        className={`flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pb-3 ${
          collapsed ? "items-center px-2" : "px-2"
        }`}
      >
        <button
          type="button"
          onClick={() => onSelect("liked")}
          title={t.likedSongs}
          aria-label={t.likedSongs}
          className={`relative flex w-full shrink-0 items-center rounded-[14px] text-left transition-colors duration-200 ${
            collapsed ? "justify-center py-1" : "gap-3 px-2 py-2"
          } ${activeId === "liked" ? "bg-white/12" : "hover:bg-white/6"}`}
        >
          {mark(activeId === "liked")}
          <span className="grid size-9 shrink-0 place-items-center rounded-[9px] bg-accent text-ground">
            <Heart className="size-4 fill-current" strokeWidth={2} />
          </span>
          {!collapsed && (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold">{t.likedSongs}</span>
              <span className="tabular block truncate text-[12px] text-ink-muted">
                {likedCount !== null ? `${likedCount} ${t.songs}` : t.loading}
              </span>
            </span>
          )}
        </button>

        {/*
        Said once, in place of the list, and only when the list is missing
        entirely. If some playlists arrived and one failed, the ones that arrived
        are still worth showing and the count on the row above already moved —
        this is for "nothing came back", which is the failure that used to look
        like an account with no music.

        In the riel there is nowhere to put a sentence, so it is one warn-coloured
        tile with the explanation in its tooltip: the signal survives, the text
        waits for someone to expand the library.
        */}
        {error &&
          playlists.length === 0 &&
          (collapsed ? (
            <span
              role="img"
              className="grid size-9 shrink-0 place-items-center rounded-[9px] bg-warn/12 text-warn"
              title={`${t.libraryUnavailableTitle} — ${t.libraryUnavailableBody}`}
              aria-label={t.libraryUnavailableTitle}
            >
              <TriangleAlert className="size-4" strokeWidth={2} />
            </span>
          ) : (
            <div className="mt-1 rounded-card border border-white/8 bg-white/4 px-3 py-3">
              <p className="text-[12.5px] font-semibold">{t.libraryUnavailableTitle}</p>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
                {t.libraryUnavailableBody}
              </p>
            </div>
          ))}

        {!collapsed && playlists.length > 0 && (
          <h3 className="px-2 pt-3 pb-1.5 text-[12px] font-semibold tracking-wide uppercase text-ink-faint">
            {t.yourPlaylists}
          </h3>
        )}

        {playlists.map((playlist) => {
          const cover = largestImage(playlist.images);
          const selected = activeId === playlist.id;
          return (
            <button
              key={playlist.id}
              type="button"
              onClick={() => onSelect(playlist.id)}
              onPointerEnter={() => onPrefetch?.(playlist.id)}
              onFocus={() => onPrefetch?.(playlist.id)}
              title={playlist.name}
              className={`relative flex w-full shrink-0 items-center rounded-[14px] text-left transition-colors duration-200 ${
                collapsed ? "justify-center py-1" : "gap-3 px-2 py-2"
              } ${selected ? "bg-white/12" : "hover:bg-white/6"}`}
            >
              {mark(selected)}
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
              {!collapsed && (
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{playlist.name}</span>
                  {/* No song count here on purpose. `/me/playlists` stopped returning
                      one in the February 2026 migration, so the number would either
                      be a guess or "0" — and a confident wrong count next to a name is
                      worse than none. The header over the list shows the real count of
                      what is actually loaded. */}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </motion.aside>
  );
}
