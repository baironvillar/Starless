import {
  ArrowDown,
  ArrowUp,
  Check,
  Heart,
  List,
  Menu,
  Pause,
  Play,
  Search,
  Shuffle,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { StringKey } from "../lib/i18n";
import { SPRING } from "../lib/motion";
import {
  type Account,
  type Album,
  type Artist,
  coverImage,
  formatRuntime,
  PLAYLIST_ORDERS,
  type Playlist,
  type PlaylistOrder,
  type Track,
  type TrackListPrefs,
  trackArtists,
} from "../lib/spotify";
import { MenuPanel } from "./MenuPanel";
import { PlaylistDetailsDialog } from "./PlaylistDetailsDialog";
import { PlaylistMenu } from "./PlaylistMenu";
import { PlaylistTrackList, type TrackListView } from "./PlaylistTrackList";
import { TrackMenu } from "./TrackMenu";

type PlaylistScreenProps = {
  t: Record<StringKey, string>;
  lang: string;
  /**
   * `null` is Liked Songs, the same sentinel `usePlaylistTracks` takes.
   *
   * **Same screen, because it is the same list.** Liked Songs used to be the
   * bare `TrackList`, with a row twice as tall as a playlist's and none of the
   * album, the date or the runtime — the one list every account has was the one
   * drawn worst. What it does not have is what a playlist is and it is not: a
   * visibility, a name to edit, a link to copy. So the header keeps the owner,
   * the count and the runtime, and the label and the three dots stay out.
   */
  playlist: Playlist | null;
  account: Account | null;
  tracks: Track[];
  loading: boolean;
  error: string | null;
  empty: string | null;
  nowPlayingId?: string | null;
  loadingId?: string | null;
  failedId?: string | null;
  /**
   * Play `track` and make `list` the queue behind it.
   *
   * The list is passed in rather than read from a prop, because the screen can
   * filter and reorder what it shows — and what it shows has to be what plays. A
   * playlist sorted by title that still played in the order it was saved is a
   * screen lying about its own contents.
   */
  onPlay: (list: Track[], track: Track) => void;
  /** The same decision made at random, and then kept. */
  onShuffle: (list: Track[], track: Track) => void;
  /**
   * The one shuffle mode, read and written exactly as the transport reads it.
   *
   * **Where a play starts is not this screen's to decide.** It is the caller's,
   * because it depends on the mode and the mode belongs to the transport: the
   * player bar's shuffle and this screen's are the same switch, and a second copy
   * of it here is a second answer to "is this on".
   */
  shuffle: boolean;
  onToggleShuffle: () => void;
  /**
   * A song from this playlist is sounding, so the big button shows a pause.
   *
   * Only the *icon* is decided here. What the button does about it is
   * `onPlayPause`'s, because there are three cases and only one of them is
   * "pause".
   */
  playing: boolean;
  /**
   * The big button in all three of its states, decided by the caller: pause what
   * is sounding, resume what is paused, or start the list that was passed in.
   *
   * Resume had to be one of them. A button that shows a triangle after a pause
   * and then jumps to the first song instead of picking the song back up is
   * three wrong presses before the user works out that this app restarts things
   * for no reason.
   */
  onPlayPause: (list: Track[]) => void;
  /** The row's extras: the artist's name opens their page. */
  onOpenArtist?: (artist: Artist) => void;
  /** The row's extras: the album's name opens its page. */
  onOpenAlbum?: (album: Album) => void;
  /** The row's extras: append to the queue without disturbing what is playing. */
  onAddToQueue: (track: Track) => void;
  /** The row's extras: open the new-playlist dialog with this song pending. */
  onNewPlaylist: (track: Track) => void;
  /**
   * The playlist's own three dots: the whole list goes into the queue.
   *
   * **Not the same thing as `onAddToQueue`.** That one adds a song; this one
   * adds the playlist, and the playlist is the whole list and not what the
   * filter left on screen. The filter is a way of reading the playlist, not
   * another playlist.
   */
  onAddListToQueue: (tracks: Track[]) => void;
  /**
   * The order, its direction and the view, held by `App` so they outlive this
   * screen and a restart: they are how the person reads every playlist.
   */
  prefs: TrackListPrefs;
  onPrefsChange: (prefs: TrackListPrefs) => void;
};

const ORDER_LABEL: Record<PlaylistOrder, StringKey> = {
  custom: "orderCustom",
  title: "orderTitle",
  added: "orderAdded",
  artist: "orderArtist",
  album: "orderAlbum",
};

/**
 * Which way an order starts when it is picked.
 *
 * "Recently added" means newest first, and an A→Z that started at Z would read
 * as a bug. Picking the same order again is what flips it.
 */
const STARTS_DESCENDING: Record<PlaylistOrder, boolean> = {
  custom: false,
  title: false,
  added: true,
  artist: false,
  album: false,
};

const VIEWS: TrackListView[] = ["compact", "list"];

const VIEW_LABEL: Record<TrackListView, StringKey> = {
  compact: "viewCompact",
  list: "viewList",
};

const VIEW_ICON: Record<TrackListView, typeof List> = {
  compact: Menu,
  list: List,
};

/** Same collator as the library rail, for the same reason: accents and numbers. */
const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Wide enough for "Orden personalizado" in Spanish, the longer of the two. */
const MENU_PX = 220;

/**
 * One playlist, the way the client everybody already knows draws one.
 *
 * **It owns its own heading, and `App` stops drawing one while it is on screen.**
 * The generic header says "the name and how many songs", which is two thirds of
 * what belongs here — and having both meant the playlist's name appeared twice,
 * once at 30px and once at 44px, a few hundred milliseconds apart. Same reasoning
 * `LyricsPanel` already uses for the same reason.
 *
 * **The artwork is a mosaic when the playlist has no cover of its own**, built
 * from the first four songs. That is not decoration copied from a screenshot: it
 * is what is actually available. `picture_size` in the rootlist is empty for most
 * of a personal library — which is why `spclient::playlists` goes looking for
 * covers separately — and a playlist of 99 songs has 99 real covers sitting right
 * there in the rows below.
 *
 * **The toolbar carries three controls and not six.** Play and shuffle are two
 * of them, and the third is the playlist's own three dots. The rest of the row
 * in the client this mirrors — download, invite collaborators, add songs, mix —
 * are either writes against a revision this app does not hold, or audio, and
 * audio does not cross into the webview under any circumstances. A greyed-out
 * row of buttons that do nothing is worse than a row of three that do, so the
 * row gets those three and the rest stays a separate piece of work instead of
 * turning into decoration.
 */
export function PlaylistScreen({
  t,
  lang,
  playlist,
  account,
  tracks,
  loading,
  error,
  empty,
  nowPlayingId,
  loadingId,
  failedId,
  onPlay,
  onShuffle,
  shuffle,
  onToggleShuffle,
  playing,
  onPlayPause,
  onOpenArtist,
  onOpenAlbum,
  onAddToQueue,
  onNewPlaylist,
  onAddListToQueue,
  prefs,
  onPrefsChange,
}: PlaylistScreenProps) {
  const [query, setQuery] = useState("");
  const { order, descending, view } = prefs;

  // The same order again flips it; a new one starts the way it reads naturally.
  const pickOrder = (next: PlaylistOrder) =>
    onPrefsChange({
      ...prefs,
      order: next,
      descending: next === order ? !descending : STARTS_DESCENDING[next],
    });
  const setView = (next: TrackListView) => onPrefsChange({ ...prefs, view: next });
  // El diálogo de los detalles vive acá y no en el menú: el menú se cierra al
  // abrirlo, y un diálogo que se cierra con el menú que lo abrió no se abre
  // nunca.
  const [detailsOpen, setDetailsOpen] = useState(false);

  /**
   * What is on screen, and what playing from here will play.
   *
   * `custom` is the playlist's own order and is never re-sorted: the order a
   * playlist was saved in is the thing the person saved it for, and "Custom
   * order" sitting at the top of the menu with a check next to it is what tells
   * the user this screen knows the difference between a reorder and an edit.
   */
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = needle
      ? tracks.filter(
          (track) =>
            track.name.toLowerCase().includes(needle) ||
            trackArtists(track).toLowerCase().includes(needle) ||
            (track.album?.name.toLowerCase().includes(needle) ?? false),
        )
      : tracks;

    if (order === "custom") return descending ? [...matched].reverse() : matched;

    // Copies rather than rearranging: `tracks` is React Query's cached value, and
    // sorting it in place reorders it under every other screen that reads it.
    const sorted = [...matched];
    if (order === "added") {
      // A row with no date goes last in both directions: "—" is not the oldest
      // song in the list, it is a song whose date we do not know.
      sorted.sort((a, b) => {
        if (a.added_at === null || b.added_at === null) {
          return (a.added_at === null ? 1 : 0) - (b.added_at === null ? 1 : 0);
        }
        return descending ? b.added_at - a.added_at : a.added_at - b.added_at;
      });
      return sorted;
    }
    if (order === "title") {
      sorted.sort((a, b) => byName.compare(a.name, b.name));
    } else if (order === "artist") {
      sorted.sort(
        (a, b) =>
          byName.compare(trackArtists(a), trackArtists(b)) || byName.compare(a.name, b.name),
      );
    } else {
      sorted.sort(
        (a, b) =>
          byName.compare(a.album?.name ?? "", b.album?.name ?? "") ||
          byName.compare(a.name, b.name),
      );
    }
    return descending ? sorted.reverse() : sorted;
  }, [tracks, query, order, descending]);

  // Liked Songs has no owner field and is always the account's own.
  const owner = playlist ? (playlist.owner?.display_name ?? null) : (account?.id ?? null);

  /**
   * Is this playlist one of yours, and what should its header say?
   *
   * **Checked against the account's id *and* its display name, because the owner
   * field carries the login.** `spclient::playlists` fills `owner` from
   * `MetaItem.owner_username`, which for your own playlists is `t_ijitzol` and not
   * `Opioide`. Comparing one against the other said "not yours" about every
   * playlist you ever made, and the header rendered your login next to your own
   * face while the library rail two centimetres away said your name. The two
   * spellings are the same person, and only one of them is the one you would
   * want to read.
   *
   * So: when it is yours, the header says your display name and shows your
   * picture — the same two things the rail shows, because it is the same person.
   * When it belongs to somebody else, their name stands and no photograph is
   * invented for them, because `account.images` is *your* face and putting it
   * next to a stranger's name is the kind of small wrongness that costs more
   * than a letter in a circle ever saves.
   *
   * A playlist Spotify made still says "spotify", which is also what `HomeScreen`
   * splits the shelf on, so the two screens keep agreeing about who made what.
   */
  const mine =
    owner !== null && account !== null && (owner === account.id || owner === account.display_name);
  const ownerName = mine ? (account?.display_name ?? account?.id ?? owner) : owner;
  const ownerAvatar = mine ? coverImage(account?.images) : null;

  const first = visible[0];

  /**
   * Clicking a row while shuffle is on plays that song and shuffles the rest.
   *
   * The mode is a promise about what comes *after* the song you picked, not only
   * about the big button — so a click here honours it too. Otherwise the mode
   * stops meaning anything the moment somebody uses the list instead of the
   * header, which is the one thing a lit-up shuffle button must never be.
   */
  const playVisible = (track: Track) => {
    if (shuffle) onShuffle(visible, track);
    else onPlay(visible, track);
  };

  return (
    <div className="pb-4">
      <motion.header
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={SPRING}
        className="flex flex-col gap-6 pb-6 sm:flex-row sm:items-end sm:gap-7"
      >
        {playlist ? <PlaylistArtwork playlist={playlist} tracks={tracks} /> : <LikedArtwork />}

        <div className="min-w-0 flex-1">
          {/*
            Shown only when the data says so.

            **La visibilidad sí se puede leer, y no desde la playlist.** La
            playlist en sí no la trae: ni `get_playlist` ni los atributos del
            rootlist llevan ese dato —llevan `collaborative` y nada más—. Lo
            que lo trae es la fila que la biblioteca tiene para ella, que es el
            mismo `public` que "Hacerla privada" pone en `false`. Por eso la
            etiqueta sale de `is_public` y no de un nombre inventado.

            Y sólo se muestra para las playlists de la cuenta: la del DJ viene
            con `public` en `false` porque no es una playlist de nadie, y
            llamarle "privada" sería mentira.
          */}
          {playlist && (playlist.collaborative || (mine && !playlist.is_public)) && (
            <p className="mb-2 text-[13px] font-medium text-ink-muted">
              {playlist.collaborative ? t.playlistCollaborative : t.playlistPrivate}
            </p>
          )}

          <h1 className="line-clamp-2 text-[30px] leading-[1.12] font-semibold tracking-tight sm:text-[38px] lg:text-[44px]">
            {playlist?.name ?? t.likedSongs}
          </h1>

          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-muted">
            {ownerAvatar ? (
              <img
                src={ownerAvatar.url}
                alt=""
                className="size-6 shrink-0 rounded-pill object-cover"
              />
            ) : ownerName ? (
              <span
                className="grid size-6 shrink-0 place-items-center rounded-pill bg-white/12 text-[11px] font-semibold text-ink"
                aria-hidden
              >
                {ownerName.slice(0, 1).toUpperCase()}
              </span>
            ) : null}

            {ownerName && <span className="font-semibold text-ink">{ownerName}</span>}
            {ownerName && !loading && <span aria-hidden>•</span>}

            {/*
              "Cargando…" instead of a count, and not only because the count would
              be zero.

              A header that says "0 canciones" over a playlist the user can see the
              name of is a claim about something we have not read yet — and the
              same shape of bug this repo has already paid for once, where an
              advertised total that no longer travelled produced a confident "0"
              under a list full of songs. "Cargando…" is the true sentence while
              the answer is on its way.
            */}
            {loading ? (
              <span>{t.loading}</span>
            ) : (
              <span className="tabular">
                {tracks.length} {t.songs}
                {tracks.length > 0 && <>, {formatRuntime(tracks, lang)}</>}
              </span>
            )}
          </div>
        </div>
      </motion.header>

      <div className="mb-4 flex flex-wrap items-center gap-5">
        {/*
          One button with three meanings, and the roundness is what makes it one
          target: it is a Play, a Resume or a Pause depending on what the player
          is already doing with this playlist, and swapping between two buttons
          that trade places under the hand is worse than one button that changes
          its mind.

          All three are the caller's business — see `onPlayPause`. This screen
          knows what it is showing; the player knows what is playing.
        */}
        <motion.button
          type="button"
          onClick={() => {
            if (first) onPlayPause(visible);
          }}
          disabled={!first}
          aria-label={playing ? t.pause : t.playAll}
          title={playing ? t.pause : t.playAll}
          whileTap={{ scale: 0.94 }}
          transition={SPRING}
          className="grid size-14 shrink-0 place-items-center rounded-pill bg-accent text-on-accent transition-opacity duration-200 disabled:opacity-40"
        >
          {playing ? (
            <Pause className="size-6 fill-current" strokeWidth={0} />
          ) : (
            <Play className="size-6 translate-x-[1px] fill-current" strokeWidth={0} />
          )}
        </motion.button>

        {/*
          Shuffle sets the mode and starts nothing.

          **This button does not play.** It used to: pressing it started the first
          song of the playlist with a shuffled queue behind it, which is two
          decisions where the user asked for one — and it put a lit-up shuffle
          next to a play that had already happened. Turning the mode on and then
          pressing play is the whole contract, and it is why the button here and
          the one in the player bar are the same switch.

          Disabled only while the playlist itself is empty, never while a filter
          is hiding everything: a search that matches no song must not take the
          switch away with it, because the one thing a user does after a search
          finds nothing is turn the mode back off. Switching the mode mid-song is
          a normal thing to do and stays available.
        */}
        <motion.button
          type="button"
          onClick={onToggleShuffle}
          disabled={tracks.length === 0}
          aria-label={shuffle ? t.shuffleOff : t.shuffleOn}
          title={shuffle ? t.shuffleOff : t.shuffleOn}
          aria-pressed={shuffle}
          whileTap={{ scale: 0.94 }}
          transition={SPRING}
          className={`grid size-9 place-items-center rounded-pill transition-colors duration-200 disabled:opacity-40 ${
            shuffle ? "text-accent" : "text-ink-muted hover:text-ink"
          }`}
        >
          <Shuffle className="size-5" strokeWidth={2} />
        </motion.button>

        {/*
          The three dots of the playlist, right after the other two controls.

          **Es un control más, no un botón más en la fila.** Lo que hace —mandar
          la lista a la cola, copiarla a otra playlist, renombrarla, copiar el
          enlace— es cosa de la playlist entera, y por eso vive en un menú y no
          en cuatro iconos sueltos al lado del botón grande. Lo que el cliente
          de escritorio pone en esa fila y no cabe acá —descargar, invitar
          colaboradores, las carpetas— son escrituras que esta sesión no
          tiene, y una fila de botones que no hacen nada es peor que una fila
          de tres que sí.
        */}
        {playlist && (
          <PlaylistMenu
            t={t}
            playlist={playlist}
            tracks={tracks}
            mine={mine}
            onAddToQueue={onAddListToQueue}
            onEditDetails={() => setDetailsOpen(true)}
          />
        )}

        <div className="ml-auto flex items-center gap-2">
          <SearchField t={t} value={query} onChange={setQuery} onClose={() => setQuery("")} />
          <OrderMenu
            t={t}
            order={order}
            descending={descending}
            onOrderChange={pickOrder}
            view={view}
            onViewChange={setView}
          />
        </div>
      </div>

      <PlaylistTrackList
        tracks={visible}
        view={view}
        t={t}
        lang={lang}
        nowPlayingId={nowPlayingId}
        loadingId={loadingId}
        failedId={failedId}
        onPlay={playVisible}
        onOpenArtist={onOpenArtist}
        onOpenAlbum={onOpenAlbum}
        // Built here rather than passed in, so the three dots are the ones this
        // screen's own handlers run. A menu forwarded as a node from three files
        // away is a menu whose "add to queue" somebody has to remember to keep
        // pointed at the right queue.
        trackMenu={(track) => (
          <TrackMenu
            t={t}
            track={track}
            onOpenArtist={onOpenArtist}
            onOpenAlbum={onOpenAlbum}
            onAddToQueue={onAddToQueue}
            onNewPlaylist={onNewPlaylist}
          />
        )}
        loading={loading}
        error={error}
        empty={empty}
        noMatches={query.trim() ? t.playlistNoMatches : null}
      />

      {/*
        El diálogo de los detalles, que el menú de los tres puntos abre.

        **Está acá y no adentro del menú.** El menú se cierra al abrirlo —el
        clic que lo abre es el que lo cierra— y un diálogo que vive dentro del
        menú se va con él. Vive en un portal, así que el `fixed` del fondo es
        el de la ventana y no el de una columna de 240 píxeles.
      */}
      {playlist && (
        <PlaylistDetailsDialog
          t={t}
          open={detailsOpen}
          playlist={playlist}
          mine={mine}
          onClose={() => setDetailsOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * Liked Songs' face: the accent square with the heart, at the playlist's size.
 *
 * The same square the rail already draws for it. Spotify sends no cover for
 * Liked Songs, and a mosaic of its first four songs would make it look like one
 * more playlist — which is the one thing the rail took care that it is not.
 */
function LikedArtwork() {
  return (
    <span className="grid size-[180px] shrink-0 place-items-center rounded-[14px] bg-accent text-on-accent shadow-lg lg:size-[232px]">
      <Heart className="size-16 fill-current lg:size-20" strokeWidth={2} />
    </span>
  );
}

/**
 * The playlist's face: one cover if it has one, a four-tile mosaic if it does not.
 *
 * **A mosaic of real covers, never a generated pattern.** The temptation with a
 * missing cover is to invent a coloured tile from the name, which looks like a
 * screenshot and is a picture of nothing. Four songs that are in the list right
 * below it are not invented.
 */
function PlaylistArtwork({ playlist, tracks }: { playlist: Playlist; tracks: Track[] }) {
  const own = coverImage(playlist.images);
  /**
   * Always four cells, filled or not.
   *
   * The mosaic is 2×2 whatever the playlist has, and a grid that grows to fit
   * its contents leaves a hole where the fourth square would be. Keyed by track
   * id and never by the slot, for the reason every list in this repo is.
   */
  const cells = [0, 1, 2, 3].map((slot) => tracks[slot] ?? null);

  return (
    <span className="relative block size-[180px] shrink-0 overflow-hidden rounded-[14px] bg-white/8 shadow-lg lg:size-[232px]">
      {own ? (
        <img src={own.url} alt="" className="size-full object-cover" />
      ) : (
        <span className="grid size-full grid-cols-2 grid-rows-2">
          {cells.map((track, slot) => {
            const url = track ? coverImage(track.album?.images)?.url : null;
            return (
              <span key={track?.id ?? `empty-${slot}`} className="overflow-hidden bg-white/8">
                {url && <img src={url} alt="" className="size-full object-cover" />}
              </span>
            );
          })}
        </span>
      )}
    </span>
  );
}

type SearchFieldProps = {
  t: Record<StringKey, string>;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
};

/**
 * Searching inside one playlist, behind a magnifier.
 *
 * **Open and empty are two states, and the earlier version faked the first with
 * a space.** The magnifier called `onChange(" ")`, which opened the field and
 * typed a space into it — and a leading space survives `.trim()` on nothing
 * downstream, so the playlist came back filtered by an invisible character. It
 * now opens on its own state and the input starts empty.
 *
 * The filter never touches the query cache and never re-fetches: the list is
 * already loaded in full, so filtering it is a substring test over an array that
 * is in memory. That is the whole reason this can exist as a control at all.
 */
function SearchField({ t, value, onChange, onClose }: SearchFieldProps) {
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  return (
    <div className="flex items-center gap-2">
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="field"
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 200 }}
            exit={{ opacity: 0, width: 0 }}
            transition={SPRING}
            className="overflow-hidden"
          >
            <div className="flex h-8 items-center gap-2 rounded-pill bg-white/8 px-3">
              <Search className="size-3.5 shrink-0 text-ink-faint" strokeWidth={2} />
              <input
                ref={input}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setOpen(false);
                    onClose();
                  }
                }}
                placeholder={t.playlistSearch}
                aria-label={t.playlistSearch}
                className="w-full bg-transparent text-[13px] outline-none placeholder:text-ink-faint"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        type="button"
        onClick={() => {
          if (open) {
            setOpen(false);
            onClose();
          } else {
            setOpen(true);
          }
        }}
        aria-label={open ? t.clearSearch : t.playlistSearch}
        title={open ? t.clearSearch : t.playlistSearch}
        className="grid size-8 shrink-0 place-items-center rounded-pill text-ink-muted transition-colors duration-200 hover:bg-white/8 hover:text-ink"
      >
        {open ? (
          <X className="size-4" strokeWidth={2} />
        ) : (
          <Search className="size-4" strokeWidth={2} />
        )}
      </button>
    </div>
  );
}

type OrderMenuProps = {
  t: Record<StringKey, string>;
  order: PlaylistOrder;
  descending: boolean;
  onOrderChange: (order: PlaylistOrder) => void;
  view: TrackListView;
  onViewChange: (view: TrackListView) => void;
};

/**
 * Which order the list on screen is in, which way, and how tall its rows are.
 *
 * **It reorders the screen and nothing else.** The client this mirrors rewrites
 * the playlist, and that is a write against a revision Starless does not hold —
 * so this sorts what is in front of the user and says so, and the order on screen
 * is the order that plays. Nothing is saved.
 *
 * **The arrow is the direction, and it only sits on the order in use.** Picking
 * the same order again flips it, which is why the menu stays open on a click:
 * flipping and then choosing the view are two clicks in one visit, and a menu
 * that closed after each one would have to be opened three times.
 *
 * The floating part is [`MenuPanel`](../components/MenuPanel), shared with the
 * song menu: two menus that each own their own copy of "where do I draw myself and
 * how do I close" is how two menus end up disagreeing about Escape.
 */
function OrderMenu({ t, order, descending, onOrderChange, view, onViewChange }: OrderMenuProps) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const ViewIcon = VIEW_ICON[view];
  const Direction = descending ? ArrowDown : ArrowUp;

  return (
    <>
      <button
        ref={anchor}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={t[ORDER_LABEL[order]]}
        className="flex h-8 shrink-0 items-center gap-2 rounded-pill px-3 text-[12.5px] font-medium text-ink-muted transition-colors duration-200 hover:bg-white/8 hover:text-ink"
      >
        <span className="max-w-[160px] truncate">{t[ORDER_LABEL[order]]}</span>
        <ViewIcon className="size-4 shrink-0" strokeWidth={2} aria-hidden />
      </button>

      <MenuPanel
        open={open}
        onClose={() => setOpen(false)}
        anchor={anchor}
        label={t.playlistOrder}
        width={MENU_PX}
      >
        <MenuHeading>{t.sortBy}</MenuHeading>
        {PLAYLIST_ORDERS.map((option) => {
          const current = option === order;
          return (
            <button
              key={option}
              type="button"
              role="option"
              aria-selected={current}
              aria-label={
                current
                  ? `${t[ORDER_LABEL[option]]}, ${descending ? t.sortDescending : t.sortAscending}`
                  : undefined
              }
              onClick={() => onOrderChange(option)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors duration-150 ${
                current ? "font-medium text-accent" : "hover:bg-white/6"
              }`}
            >
              <span className="min-w-0 flex-1">{t[ORDER_LABEL[option]]}</span>
              {current && <Direction className="size-3.5 shrink-0" strokeWidth={2.5} />}
            </button>
          );
        })}

        <div className="my-1 border-t border-white/8" />

        <MenuHeading>{t.viewAs}</MenuHeading>
        {VIEWS.map((option) => {
          const current = option === view;
          const Icon = VIEW_ICON[option];
          return (
            <button
              key={option}
              type="button"
              role="option"
              aria-selected={current}
              onClick={() => onViewChange(option)}
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors duration-150 ${
                current ? "font-medium text-accent" : "hover:bg-white/6"
              }`}
            >
              <Icon className="size-4 shrink-0" strokeWidth={2} aria-hidden />
              <span className="min-w-0 flex-1">{t[VIEW_LABEL[option]]}</span>
              <Check
                className={`size-3.5 shrink-0 transition-opacity duration-150 ${
                  current ? "opacity-100" : "opacity-0"
                }`}
                strokeWidth={2.5}
              />
            </button>
          );
        })}
      </MenuPanel>
    </>
  );
}

function MenuHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-ink-faint uppercase">
      {children}
    </p>
  );
}
