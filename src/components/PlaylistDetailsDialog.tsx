import { useQueryClient } from "@tanstack/react-query";
import { Check, ImagePlus, Pencil, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { StringKey } from "../lib/i18n";
import { SPRING } from "../lib/motion";
import { keys, type Playlist, savePlaylistDetails } from "../lib/spotify";

type PlaylistDetailsDialogProps = {
  t: Record<StringKey, string>;
  open: boolean;
  playlist: Playlist;
  /**
   * Whether the playlist is the account's own.
   *
   * **The privacy row only appears for your own playlists.** The visibility is
   * an attribute of the row the library has for that playlist, and a row
   * belonging to somebody else is not yours to change — a switch that is
   * always there and always refused is a control that lies.
   */
  mine: boolean;
  onClose: () => void;
};

/**
 * The failures this dialog can show, and the sentence for each one.
 *
 * **Three failures, three sentences.** The picture did not go up, the write
 * did not come back in time and the service refused the change are three
 * different problems; one sentence for the three sends the user looking in
 * the wrong place.
 */
const FAILURES: Record<string, StringKey> = {
  upload_failed: "playlistUploadFailed",
  timeout: "playlistDetailsTimeout",
  visibility_failed: "playlistVisibilityFailed",
  details_failed: "playlistDetailsFailed",
};

/**
 * El lado cuadrado de una imagen, como JPEG.
 *
 * **Spotify quiere un JPEG, y cuadrado.** El servicio toma la imagen como le
 * llega, así que el cuadrado es nuestro: la foto se dibuja al centro de un
 * lienzo que la recorta, como se recortan las portadas.
 *
 * **640 píxeles, y la calidad se baja si hace falta.** El servicio acepta
 * portadas de ese tamaño, y una más grande es una subida más grande para
 * nada. El tamaño se mira después: un archivo demasiado grande es la única
 * cosa que el servicio rechaza, y el rechazo llega sin decir por qué.
 */
async function squareJpeg(file: File): Promise<{ bytes: Uint8Array; preview: string }> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 640;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no_canvas");
  context.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  bitmap.close();

  // La calidad baja hasta que el archivo entra. El límite del servicio son
  // 256 KB; el margen es para no quedar pegado al borde.
  for (const quality of [0.85, 0.7, 0.55, 0.4]) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    if (!blob) throw new Error("no_jpeg");
    if (blob.size <= 200_000) {
      const buffer = await blob.arrayBuffer();
      return {
        bytes: new Uint8Array(buffer),
        preview: canvas.toDataURL("image/jpeg", quality),
      };
    }
  }

  throw new Error("image_too_big");
}

/**
 * Los detalles de una playlist: el nombre, la descripción y la portada.
 *
 * **La portada se elige con el mouse por encima, y es la única parte de esta
 * pantalla que no es un campo.** El resto son campos: se escriben y se
 * guardan. La portada es una imagen —un archivo del disco del usuario— y la
 * única manera de elegirla es mirar la que está y decidir otra.
 *
 * **El archivo no sale de la máquina hasta que se guarda.** La imagen se
 * recorta y se convierte en un lienzo en memoria, y se manda al backend
 * cuando el usuario aprieta Guardar. Subirla antes sería dejar a la mitad una
 * imagen que vive en el servidor de Spotify y que la playlist no muestra
 * todavía.
 *
 * **Un solo guardado.** El nombre, la descripción y la portada van en el mismo
 * cambio, contra la misma revisión: se guardan las tres o no se guarda
 * ninguna. Un diálogo que guarda de a uno es un diálogo que deja la playlist
 * a medio camino.
 */
export function PlaylistDetailsDialog({
  t,
  open,
  playlist,
  mine,
  onClose,
}: PlaylistDetailsDialogProps) {
  const [name, setName] = useState(playlist.name);
  const [description, setDescription] = useState(playlist.description ?? "");
  const [cover, setCover] = useState<{ bytes: Uint8Array; preview: string } | null>(null);
  const [removeCover, setRemoveCover] = useState(false);
  const [isPrivate, setIsPrivate] = useState(!playlist.is_public);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const file = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  // Cada vez que se abre, los campos tienen lo que la playlist tiene ahora.
  // Un formulario con el nombre viejo de hace un minuto es un formulario que
  // ofrece devolverle a la playlist un nombre que ya no tiene.
  //
  // **Y sólo cuando se abre.** La biblioteca se relee seguido, y cada lectura
  // le da a la playlist un objeto nuevo: un formulario que se reinicia con
  // cada objeto nuevo borra lo que la persona estaba escribiendo — y la
  // lectura que dispara eso es la que pasa justo después de guardar.
  const opened = useRef(false);
  useEffect(() => {
    if (!open) {
      opened.current = false;
      return;
    }
    if (opened.current) return;
    opened.current = true;
    setName(playlist.name);
    setDescription(playlist.description ?? "");
    setCover(null);
    setRemoveCover(false);
    setIsPrivate(!playlist.is_public);
    setBusy(false);
    setFailure(null);
  }, [open, playlist]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onClose]);

  const trimmed = name.trim();
  const canSave = trimmed.length > 0 && !busy;

  const pick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    // El valor se vacía para que elegir el mismo archivo otra vez dispare el
    // cambio: sin esto, la segunda vez no pasa nada.
    event.target.value = "";
    if (!picked) return;
    try {
      const made = await squareJpeg(picked);
      setCover(made);
      setRemoveCover(false);
      setFailure(null);
    } catch {
      setFailure("upload_failed");
    }
  };

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setFailure(null);
    try {
      await savePlaylistDetails(
        playlist.id,
        {
          name: trimmed,
          description,
          remove_picture: removeCover,
          // **La visibilidad viaja sólo cuando cambió.** Es otro mensaje y otra
          // lista —la biblioteca, no la playlist—, y escribirla sin necesidad
          // sería un pedido por algo que ya está como tiene que estar.
          is_public: isPrivate === !playlist.is_public ? undefined : !isPrivate,
        },
        removeCover ? undefined : cover?.bytes,
      );
      // El nombre y la descripción viven en la biblioteca, y la portada se
      // resuelve de ahí: lo que hay que releer es esa lista.
      void queryClient.invalidateQueries({ queryKey: keys.playlists });
      void queryClient.invalidateQueries({ queryKey: keys.playlistTracks(playlist.id) });
      // El diálogo se cierra, pero su estado sigue vivo: el componente no se
      // desmonta, se esconde. Sin soltar `busy` acá, la segunda vez que se
      // abre el mismo diálogo aparece en "Guardando…" con todo apagado — y un
      // formulario que no se puede usar después de un guardado es un
      // formulario que se rompió.
      setBusy(false);
      onClose();
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      setFailure(FAILURES[code] !== undefined ? code : "details_failed");
      setBusy(false);
    }
  };

  const current = playlist.images[0]?.url;
  const preview = cover?.preview ?? current;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 px-6"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget && !busy) onClose();
          }}
        >
          <motion.form
            role="dialog"
            aria-modal="true"
            aria-label={t.playlistDetails}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={SPRING}
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
            className="glass flex w-full max-w-[460px] flex-col gap-4 rounded-[18px] p-5"
          >
            <div className="flex items-center gap-3">
              <h2 className="min-w-0 flex-1 text-[15px] font-semibold tracking-tight">
                {t.playlistDetails}
              </h2>
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                aria-label={t.playlistDetailsCancel}
                title={t.playlistDetailsCancel}
                className="grid size-8 shrink-0 place-items-center rounded-pill text-ink-muted transition-colors duration-200 hover:bg-white/8 hover:text-ink disabled:opacity-35"
              >
                <X className="size-4" strokeWidth={2} />
              </button>
            </div>

            {/*
              La portada y los campos, lado a lado.

              **La portada se cambia pasando el mouse por encima.** Es la única
              parte de esta pantalla que no es un campo de texto, y esconderla
              detrás de un botón sería una forma de esconder que la app puede
              cambiar. El lápiz y el texto aparecen encima, y el clic abre el
              explorador de archivos.
            */}
            <div className="flex items-start gap-4">
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => file.current?.click()}
                  disabled={busy}
                  aria-label={t.playlistChoosePhoto}
                  title={t.playlistChoosePhoto}
                  className="group relative block size-[132px] overflow-hidden rounded-[10px] bg-white/6 transition disabled:opacity-50"
                >
                  {preview ? (
                    <img src={preview} alt="" className="size-full object-cover" />
                  ) : (
                    <span className="grid size-full place-items-center text-ink-faint">
                      <ImagePlus className="size-6" strokeWidth={1.8} />
                    </span>
                  )}
                  <span className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/55 text-ink opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                    <Pencil className="size-5" strokeWidth={2} />
                    <span className="text-[11px] font-medium">{t.playlistChoosePhoto}</span>
                  </span>
                </button>
                <input
                  ref={file}
                  type="file"
                  accept="image/*"
                  onChange={(event) => void pick(event)}
                  className="hidden"
                />
              </div>

              <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t.playlistDetailsName}
                  aria-label={t.playlistDetailsName}
                  disabled={busy}
                  maxLength={100}
                  aria-invalid={trimmed.length === 0 && name.length > 0}
                  className="w-full rounded-[10px] bg-white/6 px-3 py-2.5 text-[13px] outline-none ring-accent/60 transition focus:ring-2 disabled:opacity-50"
                />
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder={t.playlistDetailsDescription}
                  aria-label={t.playlistDetailsDescription}
                  disabled={busy}
                  rows={3}
                  maxLength={300}
                  className="w-full resize-none rounded-[10px] bg-white/6 px-3 py-2.5 text-[13px] leading-relaxed outline-none ring-accent/60 transition focus:ring-2 disabled:opacity-50"
                />

                {/*
                  La privacidad, y sólo para las playlists de la cuenta.

                  **El interruptor dice cómo está, no qué hacer.** La fila se
                  llama "Hacerla privada" y el interruptor está prendido cuando
                  la playlist ya es privada: una fila que sólo dijera "Privada"
                  y un interruptor que sólo dijera "Pública" se contradicen en
                  pantalla, y el que miente es el que no dice en qué estado
                  está.
                */}
                {mine && (
                  <div className="flex items-center justify-between gap-3 pt-0.5">
                    <span className="text-[12.5px] text-ink-muted">{t.playlistMakePrivate}</span>
                    <Switch
                      on={isPrivate}
                      disabled={busy}
                      label={t.playlistMakePrivate}
                      onChange={setIsPrivate}
                    />
                  </div>
                )}
              </div>
            </div>

            {/*
              La portada que puso el dueño se puede sacar, pero sólo si la hay.

              **El botón aparece sólo cuando hay algo que sacar.** La que se ve
              cuando no hay portada propia la armó Spotify con las primeras
              canciones, y esa no se quita: no es del usuario.
            */}
            {playlist.custom_cover && !cover && (
              <button
                type="button"
                onClick={() => setRemoveCover((value) => !value)}
                disabled={busy}
                className={`self-start rounded-pill px-3 py-1.5 text-[12px] font-medium transition-colors duration-200 disabled:opacity-35 ${
                  removeCover
                    ? "bg-accent/20 text-accent"
                    : "text-ink-muted hover:bg-white/8 hover:text-ink"
                }`}
              >
                {t.playlistRestoreCover}
              </button>
            )}

            {failure !== null && (
              <p role="alert" className="text-[12px] text-warn">
                {t[FAILURES[failure] ?? "playlistDetailsFailed"]}
              </p>
            )}

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-pill px-3.5 py-2 text-[12.5px] font-medium text-ink-muted transition-colors duration-200 hover:bg-white/8 hover:text-ink disabled:opacity-35"
              >
                {t.playlistDetailsCancel}
              </button>
              <button
                type="submit"
                disabled={!canSave}
                className="rounded-pill bg-accent px-4 py-2 text-[12.5px] font-semibold text-ink transition-opacity duration-200 disabled:opacity-35"
              >
                {busy ? t.playlistDetailsSaving : t.playlistDetailsSave}
              </button>
            </div>
          </motion.form>
        </div>
      )}
    </AnimatePresence>,
    // **Through a portal, because `fixed` means nothing in here.** The rail is
    // `glass`, and a `backdrop-filter` on an ancestor turns every `fixed`
    // descendant into an `absolute` one — the dialog would be laid out against
    // a 240px column instead of the window.
    document.body,
  );
}

/**
 * The privacy switch.
 *
 * **The same switch the settings panel draws.** A second look for the same
 * control would be two answers to "what does on look like", and the one that
 * answers differently is the one that looks broken.
 */
function Switch({
  on,
  disabled,
  label,
  onChange,
}: {
  on: boolean;
  disabled: boolean;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <motion.button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      whileTap={{ scale: 0.94 }}
      transition={SPRING}
      className={`relative h-6 w-11 shrink-0 rounded-pill transition-colors duration-200 disabled:opacity-40 ${
        on ? "bg-accent" : "bg-white/14"
      }`}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 520, damping: 34 }}
        className={`absolute top-1 size-4 rounded-pill bg-white shadow-sm ${on ? "right-1" : "left-1"}`}
      />
      {on && (
        <Check className="pointer-events-none absolute top-1/2 left-1.5 size-3 -translate-y-1/2 text-on-accent" />
      )}
    </motion.button>
  );
}
