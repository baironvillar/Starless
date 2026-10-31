import { Lock, Play as PlayIcon, Radio } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import type { StringKey } from "../lib/i18n";
import { SPRING } from "../lib/motion";
import { type Artist, type HomeStats, isDjCard, type Play, type Playlist } from "../lib/spotify";
import { DjArtwork } from "./DjArtwork";
import { LikedCover } from "./LikedCover";
import { cardImage, MediaCard } from "./MediaCard";

type HomeScreenProps = {
  t: Record<StringKey, string>;
  /** Already in the order the rail chose — see `App.tsx`, which sorts once. */
  playlists: Playlist[];
  loading: boolean;
  /** The one message that says why an empty grid is empty and not just empty. */
  error: string | null;
  onOpenPlaylist: (playlist: Playlist) => void;
  /** The saved songs, which are not a playlist and open by their own door. */
  onOpenLiked: () => void;
  /** `${n} canciones`, already formatted — the card's second line. */
  playlistCount: (playlist: Playlist) => string;
  onPrefetch?: (playlist: Playlist) => void;
  /**
   * The account's DJ, which is not a playlist and does not open like one.
   *
   * Clicking it starts it, the way the client it mirrors does: the DJ is a
   * session that plays, not a page that lists.
   */
  onPlayDj: (playlist: Playlist) => void;
  /** The DJ is on its way. */
  djBusy: boolean;
  /** The DJ could not be read, and the card says so. */
  djUnavailable: boolean;
  /** The local listening history (`history.rs`), or null while it loads. */
  stats: HomeStats | null;
  userName: string | null;
  /** Play a song from the history, as a station: it keeps going with similar ones. */
  onPlayTrack: (play: Play) => void;
  onOpenArtist: (artist: Artist) => void;
};

/** How many playlists "Tus playlists" shows before "Ver todas". */
const PLAYLIST_ROW = 6;

/** The grey ramp of the logo's bars, light to dark: the week's chart reuses it. */
const RAMP = ["#DAD7DD", "#C4C1C8", "#A8A5AD", "#8C8992", "#706E77", "#55535C", "#3A3941"];

function greeting(t: Record<StringKey, string>, hour: number): string {
  if (hour >= 6 && hour < 12) return t.greetingMorning;
  if (hour >= 12 && hour < 20) return t.greetingAfternoon;
  return t.greetingNight;
}

function minutesLabel(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
}

const artistNames = (play: Play) => play.artists.map((artist) => artist.name).join(", ");

/**
 * The screen you land on: a place to decide what to listen to next.
 *
 * **It is organised from the most likely click down.** A greeting and six quick
 * tiles (the saved songs, the DJ, and the lists heard most recently), then what
 * was playing, then the most played, then the week, then the library. The full
 * grid of playlists used to be the whole screen; it is the last section now and
 * shows one row until it is asked for more.
 *
 * **The history sections come from this machine, not from Spotify.** The
 * recommendation engine and "recently played" were reachable only through the
 * Web API that stopped serving apps like this one. `history.rs` keeps what was
 * heard on this computer and nowhere else, which is why the section says so
 * under its title: PRODUCT.md promises zero telemetry, and a history that never
 * leaves the disk keeps the promise. Before anything was heard, those sections
 * are one card that says how they fill in.
 *
 * **There are no category tabs** (Música, Podcasts…): nothing this app reads can
 * fill them, and a tab that always says "nothing here" is worse than no tab.
 */
export function HomeScreen({
  t,
  playlists,
  loading,
  error,
  onOpenPlaylist,
  onOpenLiked,
  playlistCount,
  onPrefetch,
  onPlayDj,
  djBusy,
  djUnavailable,
  stats,
  userName,
  onPlayTrack,
  onOpenArtist,
}: HomeScreenProps) {
  const [tab, setTab] = useState<"songs" | "artists">("songs");
  const [showAll, setShowAll] = useState(false);

  /**
   * Split by who made it, because that is the one distinction the data supports.
   * Spotify stamps its own playlists with itself as the owner, which is how the DJ
   * ends up on the "made for you" shelf. Filtered, never sorted: the rail's order holds.
   */
  const madeForYou = playlists.filter((playlist) => playlist.owner?.display_name === "spotify");
  const yours = playlists.filter((playlist) => playlist.owner?.display_name !== "spotify");
  const byId = new Map(playlists.map((playlist) => [playlist.id, playlist]));
  const dj = madeForYou.find(isDjCard) ?? null;

  if (loading && playlists.length === 0) {
    return (
      <p className="rounded-card border border-white/8 bg-white/4 px-5 py-6 text-center text-[13px] text-ink-faint">
        {t.loading}
      </p>
    );
  }

  const hello = greeting(t, new Date().getHours());
  const title = userName ? `${hello}, ${userName}` : hello;

  // Quick tiles: the saved songs, the DJ, then the lists heard last, then the rail's order.
  const quickIds: string[] = [];
  for (const play of stats?.recent ?? []) {
    const id = play.context?.id;
    if (id && id !== "liked" && byId.has(id) && !quickIds.includes(id)) quickIds.push(id);
  }
  for (const playlist of yours) {
    if (!quickIds.includes(playlist.id)) quickIds.push(playlist.id);
  }
  const quick = quickIds
    .slice(0, dj ? 4 : 5)
    .map((id) => byId.get(id))
    .filter((playlist): playlist is Playlist => Boolean(playlist));

  const hasHistory = Boolean(stats?.has_history);
  const shownPlaylists = showAll ? yours : yours.slice(0, PLAYLIST_ROW);
  const weekTotal = (stats?.week_minutes ?? []).reduce((sum, minutes) => sum + minutes, 0);
  const weekMax = Math.max(1, ...(stats?.week_minutes ?? [0]));
  const topArtist = stats?.top_artists[0] ?? null;
  const favourite = stats?.top_tracks[0]?.play ?? null;
  const streak = stats?.streak_days ?? 0;

  return (
    <div className="flex flex-col gap-11 pb-4">
      {error && playlists.length === 0 && (
        <div className="rounded-card border border-white/8 bg-white/4 px-5 py-4">
          <p className="text-[13px] font-semibold">{t.libraryUnavailableTitle}</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">{error}</p>
        </div>
      )}

      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={SPRING}
        aria-label={t.quickAccess}
      >
        <h1 className="mb-5 px-1 font-display text-[34px] leading-tight font-semibold tracking-tight">
          {title}
        </h1>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <QuickTile title={t.likedSongs} onOpen={onOpenLiked}>
            <LikedCover />
          </QuickTile>
          {dj && (
            <QuickTile
              title={dj.name}
              onOpen={() => onPlayDj(dj)}
              subtitle={djUnavailable ? t.djUnavailable : djBusy ? t.loading : null}
            >
              <DjArtwork />
            </QuickTile>
          )}
          {quick.map((playlist) => {
            const image = cardImage(playlist.images);
            return (
              <QuickTile
                key={playlist.id}
                title={playlist.name}
                onOpen={() => onOpenPlaylist(playlist)}
                onPrefetch={onPrefetch ? () => onPrefetch(playlist) : undefined}
              >
                {image ? (
                  <img src={image} alt="" className="size-full object-cover" loading="lazy" />
                ) : (
                  <span className="block size-full bg-white/8" />
                )}
              </QuickTile>
            );
          })}
        </div>
      </motion.section>

      {stats && !hasHistory && (
        <section className="rounded-card border border-dashed border-white/14 bg-white/3 px-7 py-7">
          <h2 className="font-display text-[22px] font-semibold tracking-tight">
            {t.historyStartsTitle}
          </h2>
          <p className="mt-2 max-w-[60ch] text-[14px] leading-relaxed text-ink-muted">
            {t.historyStartsBody}
          </p>
          <p className="mt-3 flex items-center gap-1.5 text-[12.5px] text-ink-faint">
            <Lock className="size-3.5" strokeWidth={2} />
            {t.historySettingHint}
          </p>
        </section>
      )}

      {hasHistory && stats && stats.recent.length > 0 && (
        <section aria-label={t.keepListening}>
          <h2 className="mb-3 px-1 font-display text-[22px] font-semibold tracking-tight">
            {t.keepListening}
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {stats.recent.map((play) => {
              const source = play.context?.id;
              const playlist = source && source !== "liked" ? byId.get(source) : undefined;
              const subtitle = `${play.name} · ${artistNames(play)}`;
              if (source === "liked") {
                return (
                  <MediaCard
                    key={`liked-${play.track_id}`}
                    title={t.likedSongs}
                    subtitle={subtitle}
                    art={<LikedCover />}
                    playLabel={t.openPlaylist}
                    onOpen={onOpenLiked}
                  />
                );
              }
              if (playlist) {
                return (
                  <MediaCard
                    key={playlist.id}
                    title={playlist.name}
                    subtitle={subtitle}
                    imageUrl={cardImage(playlist.images)}
                    playLabel={t.openPlaylist}
                    onOpen={() => onOpenPlaylist(playlist)}
                    onPrefetch={onPrefetch ? () => onPrefetch(playlist) : undefined}
                  />
                );
              }
              return (
                <MediaCard
                  key={`track-${play.track_id}`}
                  title={play.name}
                  subtitle={artistNames(play)}
                  imageUrl={play.image}
                  playLabel={t.play}
                  onPlay={() => onPlayTrack(play)}
                  onOpen={() => onPlayTrack(play)}
                />
              );
            })}
          </div>
        </section>
      )}

      {hasHistory && stats && (
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <section aria-label={t.mostPlayed} className="min-w-0">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3 px-1">
              <div>
                <h2 className="font-display text-[22px] font-semibold tracking-tight">
                  {t.mostPlayed}
                </h2>
                <p className="mt-1 flex items-center gap-1.5 text-[12.5px] text-ink-faint">
                  <Lock className="size-3.5" strokeWidth={2} />
                  {t.mostPlayedNote}
                </p>
              </div>
              <div
                role="tablist"
                aria-label={t.mostPlayed}
                className="flex gap-1 rounded-pill bg-white/6 p-1"
              >
                {(["songs", "artists"] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={tab === key}
                    onClick={() => setTab(key)}
                    className={`h-8 rounded-pill px-4 text-[12.5px] font-semibold transition-colors duration-200 ${
                      tab === key ? "bg-white/14 text-ink" : "text-ink-muted hover:text-ink"
                    }`}
                  >
                    {key === "songs" ? t.tabSongs : t.tabArtists}
                  </button>
                ))}
              </div>
            </div>
            <ol className="overflow-hidden rounded-card border border-white/8 bg-white/4">
              {tab === "songs"
                ? stats.top_tracks.map(({ play, plays }, index) => (
                    <li key={play.track_id} className={index > 0 ? "border-t border-white/8" : ""}>
                      <button
                        type="button"
                        onClick={() => onPlayTrack(play)}
                        className="group grid w-full grid-cols-[28px_40px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 text-left transition-colors duration-200 hover:bg-white/6"
                      >
                        <span className="tabular text-right text-[13px] text-ink-faint">
                          {index + 1}
                        </span>
                        <span className="relative size-10 overflow-hidden rounded-[8px] bg-white/8">
                          {play.image && (
                            <img
                              src={play.image}
                              alt=""
                              className="size-full object-cover"
                              loading="lazy"
                            />
                          )}
                          <span className="absolute inset-0 grid place-items-center bg-black/45 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                            <PlayIcon className="size-4 fill-current" strokeWidth={0} />
                          </span>
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[13.5px] font-semibold">
                            {play.name}
                          </span>
                          <span className="block truncate text-[12.5px] text-ink-muted">
                            {artistNames(play)}
                          </span>
                        </span>
                        <span className="tabular text-[12px] text-ink-faint">
                          {plays} {t.playsShort}
                        </span>
                      </button>
                    </li>
                  ))
                : stats.top_artists.map((artist, index) => (
                    <li key={artist.id} className={index > 0 ? "border-t border-white/8" : ""}>
                      <button
                        type="button"
                        onClick={() => onOpenArtist({ id: artist.id, name: artist.name })}
                        className="grid w-full grid-cols-[28px_40px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 text-left transition-colors duration-200 hover:bg-white/6"
                      >
                        <span className="tabular text-right text-[13px] text-ink-faint">
                          {index + 1}
                        </span>
                        <span className="size-10 overflow-hidden rounded-pill bg-white/8">
                          {artist.image && (
                            <img
                              src={artist.image}
                              alt=""
                              className="size-full object-cover"
                              loading="lazy"
                            />
                          )}
                        </span>
                        <span className="truncate text-[13.5px] font-semibold">{artist.name}</span>
                        <span className="tabular text-[12px] text-ink-faint">
                          {artist.plays} {t.playsShort}
                        </span>
                      </button>
                    </li>
                  ))}
            </ol>
          </section>

          <section
            aria-label={t.yourWeek}
            className="flex flex-col gap-5 rounded-card border border-white/8 bg-white/4 p-6"
          >
            <h2 className="font-display text-[20px] font-semibold tracking-tight">{t.yourWeek}</h2>
            <div>
              <p className="tabular text-[40px] leading-none font-medium tracking-tight">
                {minutesLabel(weekTotal)}
              </p>
              <p className="mt-1.5 text-[12.5px] text-ink-muted">{t.weekListened}</p>
            </div>
            <div className="grid h-24 grid-cols-7 items-end gap-2" aria-hidden="true">
              {stats.week_minutes.map((minutes, index) => (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: seven fixed days, Monday first.
                  key={index}
                  className="flex h-full flex-col items-center justify-end gap-1.5"
                >
                  <span
                    className="w-full max-w-[18px] rounded-pill"
                    style={{
                      height: `${Math.max(4, Math.round((minutes / weekMax) * 72))}px`,
                      background: index === stats.today_index ? "var(--color-accent)" : RAMP[index],
                      opacity: index > stats.today_index ? 0.25 : 1,
                    }}
                  />
                  <span className="tabular text-[11px] text-ink-faint">
                    {t.weekdaysShort[index]}
                  </span>
                </div>
              ))}
            </div>
            <dl className="grid grid-cols-2 gap-4">
              <div>
                <dt className="text-[12px] text-ink-muted">{t.artistOfMonth}</dt>
                <dd className="mt-1 truncate text-[14px] font-semibold">
                  {topArtist?.name ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-[12px] text-ink-muted">{t.streak}</dt>
                <dd className="tabular mt-1 text-[14px] font-semibold">
                  {streak} {streak === 1 ? t.day : t.days}
                </dd>
              </div>
            </dl>
            {favourite && (
              <button
                type="button"
                onClick={() => onPlayTrack(favourite)}
                className="flex h-11 items-center justify-center gap-2 rounded-pill bg-accent px-5 text-[14px] font-semibold text-on-accent transition-transform duration-150 active:scale-[0.97]"
              >
                <Radio className="size-4 shrink-0" strokeWidth={2} />
                <span className="truncate">
                  {t.radioOf} {favourite.name}
                </span>
              </button>
            )}
          </section>
        </div>
      )}

      {yours.length > 0 && (
        <section aria-label={t.yourPlaylists}>
          <div className="mb-3 flex items-baseline justify-between gap-3 px-1">
            <h2 className="font-display text-[22px] font-semibold tracking-tight">
              {t.yourPlaylists}
            </h2>
            {yours.length > PLAYLIST_ROW && (
              <button
                type="button"
                onClick={() => setShowAll((open) => !open)}
                className="text-[13px] font-semibold text-ink-muted transition-colors duration-200 hover:text-ink"
              >
                {showAll ? t.seeLess : `${t.seeAll} (${yours.length})`}
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {shownPlaylists.map((playlist) => (
              <MediaCard
                key={playlist.id}
                title={playlist.name}
                subtitle={playlistCount(playlist)}
                imageUrl={cardImage(playlist.images)}
                playLabel={t.openPlaylist}
                onOpen={() => onOpenPlaylist(playlist)}
                onPrefetch={onPrefetch ? () => onPrefetch(playlist) : undefined}
              />
            ))}
          </div>
        </section>
      )}

      {/*
        Only drawn when it has something besides the DJ, which already has its
        quick tile. An empty shelf with a heading is a promise the app cannot keep.
      */}
      {madeForYou.some((playlist) => !isDjCard(playlist)) && (
        <section aria-label={t.madeForYou}>
          <h2 className="mb-3 px-1 font-display text-[22px] font-semibold tracking-tight">
            {t.madeForYou}
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {madeForYou
              .filter((playlist) => !isDjCard(playlist))
              .map((playlist) => (
                <MediaCard
                  key={playlist.id}
                  title={playlist.name}
                  subtitle={playlistCount(playlist)}
                  imageUrl={cardImage(playlist.images)}
                  playLabel={t.openPlaylist}
                  onOpen={() => onOpenPlaylist(playlist)}
                  onPrefetch={onPrefetch ? () => onPrefetch(playlist) : undefined}
                />
              ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** One of the six tiles under the greeting: a square of art and a name. */
function QuickTile({
  title,
  subtitle = null,
  onOpen,
  onPrefetch,
  children,
}: {
  title: string;
  subtitle?: string | null;
  onOpen: () => void;
  onPrefetch?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      onPointerEnter={onPrefetch}
      onFocus={onPrefetch}
      className="flex h-16 items-center gap-3.5 overflow-hidden rounded-[14px] bg-white/6 pr-4 text-left transition-colors duration-200 hover:bg-white/10"
    >
      <span className="relative size-16 shrink-0 overflow-hidden">{children}</span>
      <span className="min-w-0">
        <span className="block truncate text-[14px] font-semibold">{title}</span>
        {subtitle && <span className="block truncate text-[12px] text-ink-muted">{subtitle}</span>}
      </span>
    </button>
  );
}
