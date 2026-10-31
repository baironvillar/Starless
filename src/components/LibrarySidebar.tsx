import { PanelLeftClose, PanelLeftOpen, Plus, TriangleAlert } from "lucide-react";
import { motion } from "motion/react";
import type { StringKey } from "../lib/i18n";
import {
  type Account,
  coverImage,
  isDjCard,
  type LibrarySort,
  type LibraryView,
  type Playlist,
} from "../lib/spotify";
import { DjArtwork } from "./DjArtwork";
import { LibrarySortMenu, LibraryViewToggle } from "./LibraryControls";
import { LikedCover } from "./LikedCover";
import { PlaylistTile } from "./PlaylistTile";

/** Two widths, and the space each one claims from the content area. */
const RAIL_PX = 72;
const PANEL_PX = 240;

import { SPRING_SHEET } from "../lib/motion";

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
  /**
   * Whether the player bar is on screen.
   *
   * **The riel stops where the bar begins.** The bar floats over the bottom
   * of the window and spans the whole width, so a riel that kept going down
   * would end up behind it. When the bar is not there, the riel goes down to
   * the window's own inset: that space is the library's, not empty ground.
   */
  barPresent: boolean;
  /** Absent on a narrow window, where the riel is the only shape there is room for. */
  onToggleCollapsed?: () => void;
  /** The order the list below is in. The list arrives sorted, not sorted here. */
  sort: LibrarySort;
  onSortChange: (sort: LibrarySort) => void;
  /** How the shelf draws the same library. Set here, shown one screen over. */
  view: LibraryView;
  onViewChange: (view: LibraryView) => void;
  onSelect: (id: string) => void;
  /** Called on approach, so the list is already loaded by the time it is opened. */
  onPrefetch?: (playlistId: string) => void;
  /**
   * Opens the new-playlist dialog.
   *
   * **The dialog lives in App, not here, and this is why.** The track menu's
   * "New playlist" opens the same one, and a dialog with two owners is a
   * dialog that ends up open twice. The riel asks for it; App owns it.
   */
  onNewPlaylist: () => void;
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
 * Liked Songs follows the shape the rail is in — a tile in the grid, a row in the
 * list — because it is not one playlist among others: it is the one thing in the
 * library that cannot be deleted, unfollowed or reordered, and it is where the
 * accent colour earns its place. A row among rows would have said "one more thing
 * in the list", which is the one reading it must never have.
 *
 * **The rail's own list is the one thing that is not about the rail.** The order and
 * the shape live here because this is where the library is browsed; both apply to the
 * shelf in Inicio too, which keeps drawing the same library as cards and never in a
 * different order.
 */
export function LibrarySidebar({
  t,
  account,
  playlists,
  likedCount,
  error,
  activeId,
  collapsed,
  barPresent,
  onToggleCollapsed,
  sort,
  onSortChange,
  view,
  onViewChange,
  onSelect,
  onPrefetch,
  onNewPlaylist,
}: LibrarySidebarProps) {
  const avatar = account ? coverImage(account.images) : null;

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
      transition={SPRING_SHEET}
      aria-label={t.navLibrary}
      // The width is animated, and it is the one layout animation in the app that
      // resizes a glass surface — which costs a blur re-sample per frame for about
      // a quarter of a second. It is worth it: the alternative is a panel that
      // teleports to half its width while the content beside it slides over 300ms,
      // and the two moving at different speeds reads as a mistake.
      className={`glass pointer-events-auto absolute top-[104px] ${barPresent ? "bottom-[144px]" : "bottom-5"} left-5 z-20 flex flex-col overflow-hidden rounded-card transition-[bottom] duration-300 ease-[var(--ease-glass)]`}
    >
      {/* The title is alone in here on purpose. Sign-out used to sit next to it,
          and creating a playlist used to sit next to that: the first is a settings
          action rather than a library one, and the second is gone with the rest of
          what this channel can no longer do. The two controls below it are the ones
          that are about the library itself. */}
      <header
        className={`flex shrink-0 flex-col gap-2 pb-3 ${
          collapsed ? "items-center px-2 pt-3" : "px-4 pt-4"
        }`}
      >
        <div className={`flex items-center gap-2 ${collapsed ? "w-full justify-center" : ""}`}>
          {!collapsed && (
            <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight">
              {t.navLibrary}
            </h2>
          )}
          {onToggleCollapsed && (
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
          )}
        </div>

        {/*
          Both library controls, together, under the title rather than beside it.

          Beside it they do not fit: the two of them plus the collapse button leave
          about sixty pixels for "Tu biblioteca", which truncates the name of the very
          panel they belong to. Under it they read as what they are — the two ways of
          looking at the list right below them — and the title keeps its width.

          Right-aligned so the cluster sits under the collapse button instead of
          floating in the middle of an otherwise empty row.

          **Both are hidden in the riel.** 72px is the collapse button and nothing
          else, and the order menu is a list of words. The rail is a strip of covers;
          these are questions you ask with a name in them, and the rail is one click
          away from being wide enough to answer.
        */}
        {!collapsed && (
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={onNewPlaylist}
              aria-label={t.newPlaylist}
              title={t.newPlaylist}
              className="mr-auto grid size-8 shrink-0 place-items-center rounded-pill text-ink-muted transition-colors duration-200 hover:bg-white/8 hover:text-ink"
            >
              <Plus className="size-4" strokeWidth={2} />
            </button>
            <LibrarySortMenu t={t} sort={sort} onSortChange={onSortChange} />
            <LibraryViewToggle t={t} view={view} onViewChange={onViewChange} />
          </div>
        )}
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

      {/*
        `pr-3` and not `px-2`: Chromium draws the scrollbar inside the padding box,
        so padding on the right is the gap between the last row and the thumb. With
        the same 8px on both sides the thumb sat on the artwork's edge and read as
        part of the row rather than as something beside it.
      */}
      <nav
        className={`flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pb-3 ${
          collapsed ? "items-center px-2" : "px-2 pr-3"
        }`}
      >
        {/*
        Liked Songs, in whichever shape the rail is in.

        It is a tile in the grid and a row in the list, and the reason it changes
        with them is that it is not one playlist among others: it is the one thing in
        the library that cannot be deleted, unfollowed or reordered, and it is where
        the accent colour earns its place. A row among rows would have said "one more
        thing in the list", which is the one reading it must never have.

        **In the grid it is the first tile of the grid**, not a tile of its own above
        a heading. Separated it read as a different kind of thing in a different part
        of the panel — which is true, but it is not a truth this layout has room to
        say twice. One grid: liked first, then the playlists in the order the rail
        holds them.

        The square is `LikedCover`, the same drawing at every size: the heart
        grows with the tile, because a 16px heart in a 106px tile is a stamp on a
        blank card.
      */}
        {!collapsed && view === "grid" ? (
          <div className="grid grid-cols-2 gap-0.5 px-1 pb-1">
            <PlaylistTile
              title={t.likedSongs}
              artwork={<LikedCover />}
              active={activeId === "liked"}
              onOpen={() => onSelect("liked")}
            />
            {playlists.map((playlist) => (
              <PlaylistTile
                key={playlist.id}
                title={playlist.name}
                imageUrl={coverImage(playlist.images)?.url ?? null}
                // The DJ is drawn, not photographed: the service sends no cover for
                // its card, and the rail would otherwise show an empty square.
                artwork={isDjCard(playlist) ? <DjArtwork /> : undefined}
                active={activeId === playlist.id}
                onOpen={() => onSelect(playlist.id)}
                /*
                Nothing to warm up for a card: the DJ's songs are not in the
                playlist, so asking for them early would ask for nothing.
                */
                onPrefetch={
                  onPrefetch && !isDjCard(playlist) ? () => onPrefetch(playlist.id) : undefined
                }
              />
            ))}
          </div>
        ) : (
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
            <span className="size-9 shrink-0 overflow-hidden rounded-[9px]">
              <LikedCover />
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
        )}

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

        {/*
          The heading belongs to the list only. In the grid there is no section to
          label — it is one grid that starts with Liked Songs, and putting
          "TUS PLAYLISTS" on top of it would be a lie about the tile right under it.
        */}
        {!collapsed && view === "list" && playlists.length > 0 && (
          <h3 className="px-2 pt-3 pb-1.5 text-[12px] font-semibold tracking-wide uppercase text-ink-faint">
            {t.yourPlaylists}
          </h3>
        )}

        {/*
          The rows of the list view. The grid is up above, inside the liked tile's
          branch, because the grid is one grid: liked first and then the playlists.
          This is why that branch has to be one and not a row plus a grid — two grids
          in one rail is the separation that was wrong in the first place.

          The riel is one column of the same list, which is why it needs no control:
          at 72px there is no room to tell a row from a tile.
        */}
        {(collapsed || view === "list") &&
          playlists.map((playlist) => {
            const cover = coverImage(playlist.images);
            const selected = activeId === playlist.id;
            /* Nothing to warm up for a card: the DJ's songs are not in the
                playlist, so asking for them early would ask for nothing. */
            const warm = isDjCard(playlist) ? undefined : () => onPrefetch?.(playlist.id);
            return (
              <button
                key={playlist.id}
                type="button"
                onClick={() => onSelect(playlist.id)}
                onPointerEnter={() => warm?.()}
                onFocus={() => warm?.()}
                title={playlist.name}
                className={`relative flex w-full shrink-0 items-center rounded-[14px] text-left transition-colors duration-200 ${
                  collapsed ? "justify-center py-1" : "gap-3 px-2 py-2"
                } ${selected ? "bg-white/12" : "hover:bg-white/6"}`}
              >
                {mark(selected)}
                {isDjCard(playlist) ? (
                  // The DJ has no cover: the service draws its card and sends no
                  // picture for it. An empty square in the rail is a cover that
                  // failed to load, and this one did not fail — it was never there.
                  <span className="relative size-9 shrink-0 overflow-hidden rounded-[9px]">
                    <DjArtwork />
                  </span>
                ) : cover ? (
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
                    {/* No song count here on purpose. The rail is for finding the
                        playlist by name, and a number is one more line to read past
                        between two covers. The shelf over there is where the count
                        belongs. */}
                  </span>
                )}
              </button>
            );
          })}
      </nav>
    </motion.aside>
  );
}
