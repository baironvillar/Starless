import { Check, Link2, ListPlus, MoreHorizontal, Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { copyText } from "../lib/clipboard";
import { type MenuPoint, PLAYLIST_MENU, useMenuAt } from "../lib/contextMenu";
import type { StringKey } from "../lib/i18n";
import { type Playlist, type Track, usePlaylistTracks } from "../lib/spotify";
import { MenuItem, MenuPanel } from "./MenuPanel";

type PlaylistMenuProps = {
  t: Record<StringKey, string>;
  playlist: Playlist;
  /**
   * The whole playlist, and not the filtered view.
   *
   * **The filter is a way of reading the playlist, not another playlist.** The
   * write of this menu —mandar las canciones a la cola— is about the
   * playlist, not about what the filter left on screen. Copying "Duvet"
   * because it was the only thing you could see would be a surprise, and the
   * surprise is always against whoever asked for it.
   */
  tracks: Track[];
  /**
   * Whether the account can write to this playlist.
   *
   * **Es la misma pregunta que hace el encabezado.** El dueño de la playlist
   * llega con dos escrituras —el login y el nombre— y la cuenta contesta con
   * las dos, así que la comparación es contra las dos. Una playlist que hizo
   * otra persona no se renombra desde acá: el servicio la rechaza, y una fila
   * que siempre falla es una fila que hay que esconder.
   */
  mine: boolean;
  /** Append the songs to the queue, without touching what is playing. */
  onAddToQueue: (tracks: Track[]) => void;
  /** Open the dialog with the details of the playlist. */
  onEditDetails: () => void;
  /**
   * With `at`, the menu has no dots of its own: it is the shared one a
   * right-click opens on a playlist in the rail or on Home, open while `at` is
   * a point and closed with `onClose`.
   */
  at?: MenuPoint | null;
  onClose?: () => void;
};

/** How long the confirmation stays up before the menu closes by itself. */
const CONFIRM_MS = 1800;

/**
 * The three dots of a playlist.
 *
 * **Only the rows that do something.** The client this mirrors offers twelve:
 * add to queue, start a jam, remove from profile, edit details, delete,
 * download, make private, invite collaborators, exclude from your taste
 * profile, move to folder, add to other playlist, share. Eight of them are
 * writes or readings this session does not have: the jam and the collaborators
 * belong to other people, the download is audio, the visibility is not read,
 * the folders do not exist in this protocol, and deleting a playlist has no way
 * back from here.
 *
 * Un menú de doce filas donde cuatro funcionan es peor que un menú de cuatro:
 * las apagadas se leen como averiadas, y la primera vez que alguien aprieta una
 * y no pasa nada es la primera vez que deja de confiar en todo el control.
 *
 * **Lo que queda son tres, y las tres hacen algo de verdad.** Mandar las
 * canciones a la cola no habla con Spotify. Copiar el enlace tampoco. Editar
 * los detalles usa el mismo mensaje que crea una playlist —el mismo
 * `UPDATE_LIST_ATTRIBUTES`— contra la revisión que la playlist tiene ahora, en
 * vez de la `0,root` de una que todavía no existe.
 */
export function PlaylistMenu({
  t,
  playlist,
  tracks,
  mine,
  onAddToQueue,
  onEditDetails,
  at,
  onClose,
}: PlaylistMenuProps) {
  const headless = at !== undefined;
  const [ownOpen, setOpen] = useState(false);
  const open = headless ? at !== null : ownOpen;
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const [queued, setQueued] = useState(false);
  // Where a right-click on the heading opened it; null when the dots did.
  const [point, setPoint] = useState<MenuPoint | null>(null);

  const anchor = useRef<HTMLButtonElement>(null);
  useMenuAt(anchor, (where) => {
    setPoint(where);
    setOpen(true);
  });

  const empty = tracks.length === 0;

  const close = () => {
    setOpen(false);
    onClose?.();
    // The confirmation belongs to the menu; leaving it lit would light up the
    // next playlist's dots too.
    setCopied("idle");
    setQueued(false);
  };

  const onCopy = async () => {
    const ok = await copyText(`https://open.spotify.com/playlist/${playlist.id}`);
    setCopied(ok ? "done" : "failed");
    if (!ok) return;
    setTimeout(close, CONFIRM_MS);
  };

  /**
   * The whole playlist goes into the queue.
   *
   * **Y no se deduplica.** Una cola no es un conjunto: el que agrega dos veces
   * la misma canción quiso oírla dos veces, y descartarla en silencio es la
   * app contradiciendo una decisión que se tomó a propósito.
   */
  const onQueue = () => {
    if (empty) return;
    onAddToQueue(tracks);
    setQueued(true);
    setTimeout(close, CONFIRM_MS);
  };

  return (
    <>
      {!headless && (
        <button
          ref={anchor}
          type="button"
          // What a right-click on the playlist's heading opens.
          data-playlist-menu=""
          onClick={(e) => {
            e.stopPropagation();
            setPoint(null);
            setOpen((value) => !value);
          }}
          aria-label={t.playlistMenuFor.replace("{name}", playlist.name)}
          title={t.playlistMenu}
          className={`grid size-9 shrink-0 place-items-center rounded-pill transition-colors duration-200 ${
            open ? "bg-white/10 text-ink" : "text-ink-muted hover:text-ink"
          }`}
        >
          <MoreHorizontal className="size-5" strokeWidth={2} />
        </button>
      )}

      <MenuPanel
        open={open}
        onClose={close}
        anchor={anchor}
        point={headless ? at : point}
        label={t.playlistMenu}
        width={236}
      >
        {/*
          **Una playlist sin canciones no tiene nada que mandar a la cola.** La
          fila se esconde en vez de quedar apagada: una fila que no hace nada se
          lee como averiada, y lo que se lee así se deja de usar.
        */}
        {!empty && (
          <MenuItem
            label={
              queued ? t.playlistQueued.replace("{count}", String(tracks.length)) : t.addToQueue
            }
            icon={<ListPlus className="size-4" strokeWidth={2} />}
            onSelect={onQueue}
          />
        )}

        {/*
          Lo único que escribe sobre la playlist misma, y sólo cuando la
          playlist es de la cuenta. El servicio rechaza el cambio sobre una
          playlist de otra persona, y una fila que siempre falla es una fila
          que hay que esconder.
        */}
        {mine && (
          <MenuItem
            label={t.playlistDetails}
            icon={<Pencil className="size-4" strokeWidth={2} />}
            onSelect={() => {
              close();
              onEditDetails();
            }}
          />
        )}

        {/*
          The one item that points outside the app.

          **El enlace es de Spotify y la app no se llama Spotify.** Lo que
          PRODUCT.md prohíbe es el nombre en la *marca*: el ícono, el nombre, y
          la impresión de que esto es Spotify. Un enlace que el usuario copió
          para compartir una playlist no es ninguna de las tres cosas, y es el
          mismo enlace que la canción ya copiaba.
        */}
        <MenuItem
          label={copied === "failed" ? t.copyFailed : t.copyLink}
          icon={
            copied === "done" ? (
              <Check className="size-4 text-accent-ink" strokeWidth={2.5} />
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

/**
 * The menu a right-click opens on a playlist in the rail or on Home.
 *
 * **One menu for every tile, mounted once.** A menu per tile would be a
 * hundred hidden menus for a library of a hundred playlists. This one listens
 * for `PLAYLIST_MENU`, finds the playlist, and loads its songs the moment it
 * opens — the queue row appears when they arrive, since a row that does
 * nothing until then would read as broken.
 *
 * **Without "Edit details".** The dialog lives on the playlist's own screen,
 * so the row stays there, where the right-click on the heading still offers it.
 */
export function PlaylistContextMenu({
  t,
  playlists,
  onAddToQueue,
}: {
  t: Record<StringKey, string>;
  playlists: Playlist[];
  onAddToQueue: (tracks: Track[]) => void;
}) {
  const [target, setTarget] = useState<{ playlist: Playlist; at: MenuPoint } | null>(null);

  useEffect(() => {
    const onMenu = (event: Event) => {
      const { id, x, y } = (event as CustomEvent<{ id: string } & MenuPoint>).detail;
      const playlist = playlists.find((candidate) => candidate.id === id);
      if (playlist) setTarget({ playlist, at: { x, y } });
    };
    window.addEventListener(PLAYLIST_MENU, onMenu);
    return () => window.removeEventListener(PLAYLIST_MENU, onMenu);
  }, [playlists]);

  const tracks = usePlaylistTracks(target?.playlist.id ?? null);
  if (!target) return null;
  return (
    <PlaylistMenu
      // A new right-click is a new menu: the last one's confirmations do not carry over.
      key={`${target.playlist.id}:${target.at.x}:${target.at.y}`}
      t={t}
      playlist={target.playlist}
      tracks={tracks.data ?? []}
      mine={false}
      onAddToQueue={onAddToQueue}
      onEditDetails={() => {}}
      at={target.at}
      onClose={() => setTarget(null)}
    />
  );
}
