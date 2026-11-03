import { TriangleAlert } from "lucide-react";
import type { StringKey } from "../lib/i18n";
import { coverImage, isDjCard, type Playlist } from "../lib/spotify";
import { DjArtwork } from "./DjArtwork";
import { LikedCover } from "./LikedCover";

type MobileLibraryProps = {
  t: Record<StringKey, string>;
  playlists: Playlist[];
  likedCount: number | null;
  error: boolean;
  onSelect: (id: string) => void;
};

/**
 * The library as the phone's Biblioteca tab: one list, the cover and the whole
 * name.
 *
 * The desktop's rail cannot be squeezed into a phone —at 72px it is a column of
 * covers with no names, and at 280px it is most of the screen— so the tab is a
 * screen of its own. The rows are the rail's rows, a size up for a finger, and
 * the names wrap instead of being cut: the shelf on Home cut them ("Canciones
 * qu…"), and a list is where the whole name fits.
 */
export function MobileLibrary({ t, playlists, likedCount, error, onSelect }: MobileLibraryProps) {
  return (
    <div>
      <h1 className="mb-4 text-[30px] leading-tight font-semibold tracking-tight">
        {t.libraryTitle}
      </h1>

      <div className="flex flex-col">
        <Row
          onClick={() => onSelect("liked")}
          art={<LikedCover />}
          name={t.likedSongs}
          detail={likedCount !== null ? `${likedCount} ${t.songs}` : t.loading}
        />

        {error && playlists.length === 0 && (
          <div className="mt-2 flex gap-3 rounded-card border border-white/8 bg-white/4 px-4 py-3">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn-ink" strokeWidth={2} />
            <div>
              <p className="text-[13px] font-semibold">{t.libraryUnavailableTitle}</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
                {t.libraryUnavailableBody}
              </p>
            </div>
          </div>
        )}

        {playlists.map((playlist) => {
          const cover = coverImage(playlist.images);
          return (
            <Row
              key={playlist.id}
              onClick={() => onSelect(playlist.id)}
              art={
                isDjCard(playlist) ? (
                  <DjArtwork />
                ) : cover ? (
                  <img src={cover.url} alt="" loading="lazy" className="size-full object-cover" />
                ) : (
                  <span className="block size-full bg-white/8" aria-hidden />
                )
              }
              name={playlist.name}
              detail={isDjCard(playlist) ? null : `${playlist.tracks?.total ?? 0} ${t.songs}`}
            />
          );
        })}
      </div>
    </div>
  );
}

function Row({
  onClick,
  art,
  name,
  detail,
}: {
  onClick: () => void;
  art: React.ReactNode;
  name: string;
  detail: string | null;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-[14px] px-1 py-2 text-left transition-transform duration-150 active:scale-[0.98] active:bg-white/6"
    >
      <span className="relative size-14 shrink-0 overflow-hidden rounded-[10px]">{art}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] leading-snug font-semibold">{name}</span>
        {detail && (
          <span className="tabular mt-0.5 block text-[12.5px] text-ink-muted">{detail}</span>
        )}
      </span>
    </button>
  );
}
