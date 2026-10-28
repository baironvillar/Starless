import { Check, Link2, ListPlus, MoreHorizontal, Pencil } from "lucide-react";
import { useRef, useState } from "react";
import { copyText } from "../lib/clipboard";
import type { StringKey } from "../lib/i18n";
import type { Playlist, Track } from "../lib/spotify";
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
}: PlaylistMenuProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const [queued, setQueued] = useState(false);

  const anchor = useRef<HTMLButtonElement>(null);

  const empty = tracks.length === 0;

  const close = () => {
    setOpen(false);
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
      <button
        ref={anchor}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
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

      <MenuPanel open={open} onClose={close} anchor={anchor} label={t.playlistMenu} width={236}>
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
              <Check className="size-4 text-accent" strokeWidth={2.5} />
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
