import { motion } from "motion/react";
import { useState } from "react";
import type { StringKey } from "../lib/i18n";
import {
  type AlbumCard,
  type ArtistCard,
  albumYear,
  type Playlist,
  type SearchResults,
  type Track,
} from "../lib/spotify";
import { ArtistProfile } from "./ArtistProfile";
import { cardImage, MediaCard } from "./MediaCard";
import { NumberedTrackList } from "./NumberedTrackList";
import { TrackList } from "./TrackList";

const SPRING = { type: "spring" as const, stiffness: 420, damping: 32 };

/** The order Spotify puts them in, and the order the user reads best in. */
const TABS = ["all", "songs", "albums", "playlists", "artists"] as const;
type Tab = (typeof TABS)[number];

/** How many cards a shelf shows before the full grid is one scroll away. */
const SHELF_LIMIT = 6;

/** A card on a shelf is a fixed width: a grid cell would stretch it. */
const SHELF_CARD = "w-[168px] shrink-0 snap-start";

type SearchScreenProps = {
  t: Record<StringKey, string>;
  /** The query these results answer. Used to know when a new search arrived. */
  query: string;
  results: SearchResults;
  nowPlayingId: string | null;
  loadingId: string | null;
  failedId: string | null;
  /** Plays one song and makes these songs the queue that follows. */
  onPlay: (tracks: Track[], track: Track) => void;
  onPlayAlbum: (album: AlbumCard) => void;
  onOpenPlaylist: (playlist: Playlist) => void;
  /** The album whose play is in flight, so its card can show a spinner. */
  albumBusy: string | null;
};

/**
 * Search results, in the shape people already know.
 *
 * One tab per kind of thing, because a search for "frank ocean" answers several
 * different questions at once and a single list can only answer one of them. Songs
 * are numbered and alphabetical because they are things you scan down a list;
 * albums, playlists and artists are cards because they are things you recognise
 * before you read them.
 *
 * The tab stays where the user left it across a new search. Someone who has
 * narrowed to "Artists" is looking at artists; sending them back to "All" on every
 * keystroke discards that without being asked.
 */
export function SearchScreen({
  t,
  query,
  results,
  nowPlayingId,
  loadingId,
  failedId,
  onPlay,
  onPlayAlbum,
  onOpenPlaylist,
  albumBusy,
}: SearchScreenProps) {
  const [tab, setTab] = useState<Tab>("all");
  const [openArtist, setOpenArtist] = useState<ArtistCard | null>(null);

  // A new search invalidates the profile that was open on top of it. Adjusted
  // during render rather than in an effect, which is the case React documents it
  // for: the old artist must never paint under the new results, not even for a
  // frame. The tab is deliberately *not* reset — narrowing to "Artists" and then
  // searching again should stay in Artists.
  const [profileQuery, setProfileQuery] = useState(query);
  if (profileQuery !== query) {
    setProfileQuery(query);
    setOpenArtist(null);
  }

  /**
   * Alphabetical, because this tab is a lookup.
   *
   * Search relevance is the wrong order once the user has chosen "Songs": it
   * clusters by popularity the account happened to know about, and puts a
   * near-miss above an exact title match. A list sorted by title answers "which
   * song is called X" the same way every time. `localeCompare` with a numeric
   * option so "Track 2" lands before "Track 10".
   */
  const songs = [...results.tracks].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
  );

  if (openArtist) {
    return (
      <ArtistProfile
        t={t}
        artist={openArtist}
        nowPlayingId={nowPlayingId}
        loadingId={loadingId}
        failedId={failedId}
        onPlay={onPlay}
        onPlayAlbum={onPlayAlbum}
        onBack={() => setOpenArtist(null)}
      />
    );
  }

  const nothing =
    results.tracks.length === 0 &&
    results.albums.length === 0 &&
    results.artists.length === 0 &&
    results.playlists.length === 0;

  return (
    <div>
      {/* The tabs. Pill-shaped like every other selector in the app, so this reads
          as navigation rather than as a filter borrowed from somewhere else. */}
      <div
        role="tablist"
        aria-label={t.searchResultsTitle}
        className="mb-5 flex flex-wrap items-center gap-1.5"
      >
        {TABS.map((key) => {
          const count = countFor(key, results);
          const active = tab === key;
          return (
            <motion.button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(key)}
              whileTap={{ scale: 0.96 }}
              transition={SPRING}
              className={`rounded-pill px-4 py-2 text-[13px] font-semibold transition-colors duration-200 ${
                active ? "bg-white/12 text-ink" : "text-ink-muted hover:bg-white/6 hover:text-ink"
              }`}
            >
              {t[`searchTab_${key}` as StringKey]}
              {count > 0 && (
                <span className="tabular ml-1.5 text-[11.5px] text-ink-faint">{count}</span>
              )}
            </motion.button>
          );
        })}
      </div>

      {nothing ? (
        <EmptyNote>{t.searchNoResults}</EmptyNote>
      ) : tab === "all" ? (
        <div className="space-y-8">
          {results.artists.length > 0 && (
            <Shelf title={t.searchTab_artists}>
              {results.artists.map((artist) => (
                <MediaCard
                  key={artist.id}
                  round
                  title={artist.name}
                  imageUrl={cardImage(artist.images)}
                  onOpen={() => setOpenArtist(artist)}
                  playLabel={t.play}
                  className={SHELF_CARD}
                />
              ))}
            </Shelf>
          )}

          {results.tracks.length > 0 && (
            <section>
              <h2 className="mb-3 text-[19px] font-semibold tracking-tight">{t.searchTab_songs}</h2>
              <TrackList
                tracks={results.tracks}
                t={t}
                nowPlayingId={nowPlayingId}
                loadingId={loadingId}
                failedId={failedId}
                onPlay={(track) => onPlay(results.tracks, track)}
              />
            </section>
          )}

          {results.albums.length > 0 && (
            <Shelf title={t.searchTab_albums}>
              {results.albums.slice(0, SHELF_LIMIT).map((album) => (
                <AlbumCardTile
                  key={album.id}
                  album={album}
                  onPlayAlbum={onPlayAlbum}
                  playLabel={t.play}
                  busy={albumBusy === album.id}
                  className={SHELF_CARD}
                />
              ))}
            </Shelf>
          )}

          {results.playlists.length > 0 && (
            <Shelf title={t.searchTab_playlists}>
              {results.playlists.slice(0, SHELF_LIMIT).map((playlist) => (
                <PlaylistCardTile
                  key={playlist.id}
                  playlist={playlist}
                  onOpen={onOpenPlaylist}
                  playLabel={t.play}
                  className={SHELF_CARD}
                />
              ))}
            </Shelf>
          )}
        </div>
      ) : tab === "songs" ? (
        <NumberedTrackList
          tracks={songs}
          t={t}
          nowPlayingId={nowPlayingId}
          loadingId={loadingId}
          failedId={failedId}
          onPlay={(track) => onPlay(results.tracks, track)}
          empty={t.searchNoResults}
        />
      ) : tab === "albums" ? (
        results.albums.length > 0 ? (
          <Grid>
            {results.albums.map((album) => (
              <AlbumCardTile
                key={album.id}
                album={album}
                onPlayAlbum={onPlayAlbum}
                playLabel={t.play}
                busy={albumBusy === album.id}
              />
            ))}
          </Grid>
        ) : (
          <EmptyNote>{t.searchNoResults}</EmptyNote>
        )
      ) : tab === "playlists" ? (
        results.playlists.length > 0 ? (
          <Grid>
            {results.playlists.map((playlist) => (
              <PlaylistCardTile
                key={playlist.id}
                playlist={playlist}
                onOpen={onOpenPlaylist}
                playLabel={t.play}
              />
            ))}
          </Grid>
        ) : (
          <EmptyNote>{t.searchNoResults}</EmptyNote>
        )
      ) : results.artists.length > 0 ? (
        <Shelf title={t.searchTab_artists}>
          {results.artists.map((artist) => (
            <MediaCard
              key={artist.id}
              round
              title={artist.name}
              imageUrl={cardImage(artist.images)}
              onOpen={() => setOpenArtist(artist)}
              playLabel={t.play}
              className={SHELF_CARD}
            />
          ))}
        </Shelf>
      ) : (
        <EmptyNote>{t.searchNoResults}</EmptyNote>
      )}
    </div>
  );
}

function countFor(tab: Tab, results: SearchResults): number {
  if (tab === "songs") return results.tracks.length;
  if (tab === "albums") return results.albums.length;
  if (tab === "playlists") return results.playlists.length;
  if (tab === "artists") return results.artists.length;
  // "All" counts what it holds, which is the songs — the reason most people open
  // it. Counting all of them would put "46" on a tab that shows a dozen rows.
  return results.tracks.length;
}

/**
 * An album card: cover, then the year and the artist.
 *
 * The year sits under the title rather than beside it because it is the thing
 * you check when two records share a name, and a line of "2016 · Frank Ocean"
 * reads as one caption instead of two competing facts.
 */
function AlbumCardTile({
  album,
  onPlayAlbum,
  playLabel,
  busy = false,
  className,
}: {
  album: AlbumCard;
  onPlayAlbum: (album: AlbumCard) => void;
  playLabel: string;
  busy?: boolean;
  className?: string;
}) {
  const artist = album.artists.map((a) => a.name).join(", ");
  const year = albumYear(album);

  return (
    <MediaCard
      title={album.name}
      eyebrow={year ?? undefined}
      subtitle={artist || undefined}
      imageUrl={cardImage(album.images)}
      onPlay={() => onPlayAlbum(album)}
      playLabel={playLabel}
      busy={busy}
      className={className}
    />
  );
}

/**
 * A playlist card opens it. It does not offer a play button, and that is the
 * honest shape rather than a missing feature: Spotify answers 403 for the
 * contents of a playlist the account neither owns nor collaborates on, which is
 * most of what a search returns. Opening it says what happened; a play button
 * would just fail with no explanation.
 */
function PlaylistCardTile({
  playlist,
  onOpen,
  playLabel,
  className,
}: {
  playlist: Playlist;
  onOpen: (playlist: Playlist) => void;
  playLabel: string;
  className?: string;
}) {
  return (
    <MediaCard
      title={playlist.name}
      subtitle={playlist.owner?.display_name ?? undefined}
      imageUrl={cardImage(playlist.images)}
      onOpen={() => onOpen(playlist)}
      playLabel={playLabel}
      className={className}
    />
  );
}

function Shelf({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-[19px] font-semibold tracking-tight">{title}</h2>
      {/* A shelf scrolls sideways rather than wrapping: these are faces and covers,
          and a grid that broke them across two lines reads as two different lists.
          The scrollbar is hidden but the scroll is not — the cards visibly run
          off the edge, which is the affordance. */}
      <div className="-mx-1 flex snap-x snap-mandatory gap-5 overflow-x-auto px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {children}
      </div>
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(158px,1fr))] gap-5">{children}</div>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-card border border-white/8 bg-white/4 px-5 py-8 text-center text-[13px] text-ink-faint">
      {children}
    </p>
  );
}
