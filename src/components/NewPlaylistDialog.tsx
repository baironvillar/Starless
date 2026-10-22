import { Plus, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { StringKey } from "../lib/i18n";

import { SPRING } from "../lib/motion";

type NewPlaylistDialogProps = {
  t: Record<StringKey, string>;
  open: boolean;
  onClose: () => void;
  /** Runs while the dialog stays open. Rejects with a Rust error code. */
  onCreate: (name: string) => Promise<void>;
};

/**
 * Name a new playlist, and nothing else.
 *
 * **One field, because one field is what the call needs.** The backend takes a
 * name and returns an id; a description, a cover picker or a privacy toggle
 * would all be invented settings that the request does not have a place for. The
 * playlist is created private because that is the only sane default for a list
 * somebody made for themselves — the alternative is a public list by accident,
 * which is the one failure here that cannot be undone by the user.
 *
 * **Three failures, three messages.** `create_failed` means nothing was made;
 * `attach_failed` means the playlist exists and is named, but never reached the
 * library; `add_failed` means it exists and is in the library, but the song
 * did not go in. Saying the second one failed would be a lie the user cannot
 * check, and retrying it would make two playlists instead of fixing one.
 *
 * **And the two that left something behind do not offer a retry.** The button
 * that creates would create a *second* playlist, and the first one — the one
 * that exists and is named — is the one the user will never see. So the
 * dialog closes instead of offering to do it again.
 *
 * Centred with layout and not with a transform: a `-translate-x-1/2` above a
 * `backdrop-filter` is the one live transform that made a glass surface stop
 * looking like glass in the packaged build, and this is glass.
 */
export function NewPlaylistDialog({ t, open, onClose, onCreate }: NewPlaylistDialogProps) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // Reopening with the old name still in it is the state nobody expects: the
  // dialog is where you are *because* you did not have a name yet.
  useEffect(() => {
    if (!open) return;
    setName("");
    setFailure(null);
    const id = setTimeout(() => input.current?.focus(), 40);
    return () => clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onClose]);

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setFailure(null);
    try {
      await onCreate(trimmed);
      onClose();
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      // An unnamed failure would render as an empty red box, which is the one
      // error state nobody acts on.
      setFailure(code === "attach_failed" ? "attach" : code === "add_failed" ? "add" : "create");
    } finally {
      setBusy(false);
    }
  }

  const message =
    failure === "attach"
      ? t.newPlaylistFailedAttach
      : failure === "add"
        ? t.newPlaylistFailedAdd
        : t.newPlaylistFailedCreate;

  /**
   * Whether something was left behind.
   *
   * The playlist exists in these two cases, so the button that creates another
   * one is worse than useless here: it would leave two playlists and the user
   * would only ever see one.
   */
  const leftBehind = failure === "attach" || failure === "add";

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
            aria-label={t.newPlaylist}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={SPRING}
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
            className="glass flex w-full max-w-[380px] flex-col gap-4 rounded-[18px] p-5"
          >
            <div className="flex items-start gap-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-accent/15 text-accent">
                <Plus className="size-4" strokeWidth={2.2} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-[15px] font-semibold tracking-tight">{t.newPlaylist}</h2>
                <p className="mt-0.5 text-[12px] text-ink-muted">
                  {busy ? t.newPlaylistBusy : t.newPlaylistName}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                aria-label={t.newPlaylistCancel}
                title={t.newPlaylistCancel}
                className="grid size-8 shrink-0 place-items-center rounded-pill text-ink-muted transition-colors duration-200 hover:bg-white/8 hover:text-ink disabled:opacity-35"
              >
                <X className="size-4" strokeWidth={2} />
              </button>
            </div>

            <input
              ref={input}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t.newPlaylistName}
              disabled={busy}
              maxLength={100}
              aria-invalid={trimmed.length === 0 && name.length > 0}
              className="w-full rounded-[10px] bg-white/6 px-3 py-2.5 text-[13px] outline-none ring-accent/60 transition focus:ring-2 disabled:opacity-50"
            />

            {failure !== null && (
              <p role="alert" className="text-[12px] text-warn">
                {message}
              </p>
            )}

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-pill px-3.5 py-2 text-[12.5px] font-medium text-ink-muted transition-colors duration-200 hover:bg-white/8 hover:text-ink disabled:opacity-35"
              >
                {leftBehind ? t.close : t.newPlaylistCancel}
              </button>
              {!leftBehind && (
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="rounded-pill bg-accent px-4 py-2 text-[12.5px] font-semibold text-ink transition-opacity duration-200 disabled:opacity-35"
                >
                  {t.newPlaylistCreate}
                </button>
              )}
            </div>
          </motion.form>
        </div>
      )}
    </AnimatePresence>,
    // **Through a portal, because `fixed` means nothing in here.** The rail is
    // `glass`, and a `backdrop-filter` on an ancestor turns every `fixed`
    // descendant into an `absolute` one — the dialog would be laid out against a
    // 240px column instead of the window. This is the same reason the sort menu
    // goes to `document.body`, and it is invisible until somebody opens the thing
    // on a wide screen and sees it pinned to the left edge.
    document.body,
  );
}
