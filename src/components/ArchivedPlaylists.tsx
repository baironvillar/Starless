import { Archive, ArchiveRestore, Pin } from "lucide-react";
import { useState } from "react";
import type { StringKey } from "../lib/i18n";
import { useLibraryOrganisation } from "../lib/libraryOrganisation";
import { explain, usePlaylists } from "../lib/spotify";

/** Reachable even when every playlist is archived; absent when there are none. */
export function ArchivedPlaylists({ t }: { t: Record<StringKey, string> }) {
  const [open, setOpen] = useState(false);
  const organisation = useLibraryOrganisation();
  const playlists = usePlaylists().data ?? [];
  const archived = playlists.filter((playlist) => organisation.preferences[playlist.id]?.archived);
  if (archived.length === 0) {
    return organisation.error ? (
      <p role="alert" className="px-3 py-2 text-[12px] text-warn-ink">
        {explain(organisation.error)}
      </p>
    ) : null;
  }
  return (
    <div className="my-2 text-[12px]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-pill px-3 py-2 text-ink-muted hover:bg-white/8 hover:text-ink"
      >
        <Archive className="size-4" aria-hidden />
        {t.archivedPlaylists} ({archived.length})
      </button>
      {organisation.error && (
        <p role="alert" className="px-3 py-2 text-warn-ink">
          {explain(organisation.error)}
        </p>
      )}
      {open && (
        <div className="surface-card mt-2 rounded-card border border-white/8 p-3">
          <p className="mb-2 text-ink-muted">{t.archiveLocalHint}</p>
          {archived.length === 0 && <p className="text-ink-faint">{t.noArchivedPlaylists}</p>}
          {archived.map((playlist) => (
            <div key={playlist.id} className="flex items-center gap-2 py-2">
              {organisation.preference(playlist.id).pinned && (
                <Pin className="size-3 shrink-0" aria-label={t.pinnedPlaylist} />
              )}
              <span className="min-w-0 flex-1 break-words">{playlist.name}</span>
              <button
                type="button"
                disabled={!organisation.ready || organisation.busy}
                aria-label={`${t.restorePlaylist} — ${playlist.name}`}
                title={t.restorePlaylist}
                className="grid size-8 shrink-0 place-items-center rounded-pill hover:bg-white/8 disabled:opacity-40"
                onClick={() =>
                  organisation.change({
                    id: playlist.id,
                    preference: { ...organisation.preference(playlist.id), archived: false },
                  })
                }
              >
                <ArchiveRestore className="size-4" aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
