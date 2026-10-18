import { motion } from "motion/react";
import type { StringKey } from "../lib/i18n";
import type { Playlist } from "../lib/spotify";
import { cardImage, MediaCard } from "./MediaCard";

const SPRING = { type: "spring" as const, stiffness: 420, damping: 32 };

type HomeScreenProps = {
  t: Record<StringKey, string>;
  playlists: Playlist[];
  loading: boolean;
  /** The one message that says why an empty grid is empty and not just empty. */
  error: string | null;
  onOpenPlaylist: (playlist: Playlist) => void;
  /** `${n} canciones`, already formatted — the card's second line. */
  playlistCount: (playlist: Playlist) => string;
  onPrefetch?: (playlist: Playlist) => void;
};

/**
 * The screen you land on, which is not a list of songs.
 *
 * "Inicio" used to mean the saved songs with a different label on the tab. That is
 * a list of things you already chose, which makes a poor first impression and a
 * poor place to decide what to listen to next. This is the shelf instead.
 *
 * **There is no filter row.** The client this mirrors has one — Todas, Música,
 * Podcasts, Audiolibros — and two of those four cannot be filled from anything
 * this app reads: there is no podcast or audiobook data anywhere in the answer, so
 * those tabs would open onto an empty grid under a heading that promises content.
 * A tab that always says "nothing here" is worse than no tab, because the user has
 * to click it to find out. Two tabs that show the same six playlists would be the
 * same lie with extra steps.
 *
 * **There is no recommendations row either, and that is not an oversight.** "Daily
 * Mix", "Discover Weekly" and "Recommended Stations" come out of Spotify's
 * recommendation engine, which was reachable only through the Web API that stopped
 * serving anyone outside a five-person list. Every one of those was probed against
 * the session that *is* available — `spotify:user:{id}:daylims`,
 * `:discover-weekly`, `:release-radar`, `spotify:daily`, `spotify:artist:{id}:radio`
 * and eleven more — and every one came back 400 or 404 while the control URI
 * answered. So the shelf below the grid is everything Spotify made for this
 * account that this app can actually reach, which today means the likes and the
 * daily mixes: real, and all of it.
 */
export function HomeScreen({
  t,
  playlists,
  loading,
  error,
  onOpenPlaylist,
  playlistCount,
  onPrefetch,
}: HomeScreenProps) {
  /**
   * Split by who made it, because that is the one distinction the data supports.
   *
   * Spotify stamps its own playlists with itself as the owner, which is how DJ ends
   * up on this shelf rather than among the user's. Everything the account made
   * itself goes in the grid above.
   */
  const madeForYou = playlists.filter((playlist) => playlist.owner?.display_name === "spotify");
  const yours = playlists.filter((playlist) => playlist.owner?.display_name !== "spotify");

  if (loading && playlists.length === 0) {
    return (
      <p className="rounded-card border border-white/8 bg-white/4 px-5 py-6 text-center text-[13px] text-ink-faint">
        {t.loading}
      </p>
    );
  }

  return (
    <div className="pb-4">
      {error && playlists.length === 0 && (
        <div className="rounded-card border border-white/8 bg-white/4 px-5 py-4">
          <p className="text-[13px] font-semibold">{t.libraryUnavailableTitle}</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">{error}</p>
        </div>
      )}

      {playlists.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={SPRING}
          aria-label={t.yourPlaylists}
        >
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {yours.map((playlist) => (
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
        </motion.section>
      )}

      {/*
        Only drawn when it has something in it. An empty shelf with a heading is a
        promise the app cannot keep, and this is the section that would be lying —
        it is where "Made for you" would go, and "made for you" is a claim about
        Spotify's recommendation engine, which is not behind this session.
      */}
      {madeForYou.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...SPRING, delay: 0.04 }}
          className="mt-9"
          aria-label={t.madeForYou}
        >
          <h2 className="mb-3 px-1 text-[20px] font-semibold tracking-tight">{t.madeForYou}</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {madeForYou.map((playlist) => (
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
        </motion.section>
      )}
    </div>
  );
}
