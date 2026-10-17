import { invoke } from "@tauri-apps/api/core";
import { check, type Update } from "@tauri-apps/plugin-updater";

/**
 * Whether a newer Starless exists, and the job of installing it.
 *
 * Two decisions live here, and both are about not surprising someone who is
 * listening to music.
 *
 * **Check quietly, install on request.** The check happens once at startup and
 * costs one small request; nothing is downloaded, nothing is written, and the app
 * never restarts itself. Downloading a few megabytes at launch is what turns an
 * updater into the reason an app takes longer to open.
 *
 * **Ask before applying.** Starless plays audio. An update that installs itself
 * mid-track cuts the song, and an app that cuts your music to install a patch is
 * an app you turn off. So the button is in Settings and the click is the user's.
 *
 * A failure to check is not an error worth showing. It means GitHub was
 * unreachable, which is a fact about the network and not about the installation —
 * the app is still the version it was, and saying so out loud on every launch
 * would only train people to ignore the one time a real update exists.
 */
export type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "current" }
  | { status: "available"; update: Update }
  | { status: "downloading"; received: number; total: number }
  | { status: "ready"; update: Update }
  | { status: "error" };

let current: UpdateState = { status: "idle" };
const listeners = new Set<(state: UpdateState) => void>();

function publish(state: UpdateState) {
  current = state;
  for (const listener of listeners) listener(state);
}

export function subscribeUpdate(listener: (state: UpdateState) => void): () => void {
  listeners.add(listener);
  listener(current);
  return () => listeners.delete(listener);
}

export function updateState(): UpdateState {
  return current;
}

/**
 * Ask GitHub whether there is something newer.
 *
 * Safe to call more than once: a check already in flight is not started again.
 */
export async function checkForUpdate(): Promise<void> {
  if (current.status === "checking") return;
  publish({ status: "checking" });

  try {
    const update = await check();
    if (update) {
      publish({ status: "available", update });
      return;
    }
    publish({ status: "current" });
  } catch (e) {
    // Offline, a blocked request, an endpoint that is not configured yet. None of
    // those mean anything about the copy of Starless the user is running.
    console.warn("Starless: no se pudo comprobar si hay actualizaciones", e);
    publish({ status: "idle" });
  }
}

/**
 * Download it, then apply it.
 *
 * On Windows this hands the installer to the system and the app exits inside
 * `downloadAndInstall`, so nothing after this line runs — including the cleanup
 * that a caller might reasonably expect.
 */
export async function installUpdate(update: Update): Promise<void> {
  let received = 0;
  let total = 0;

  // Said before the download, not after, because after is too late: the process
  // is gone by then. Without this the session's marker survives the update and
  // the next launch opens with a crash report about an update that worked
  // perfectly. Best effort on purpose — if the backend cannot answer, the update
  // matters more than the report.
  await invoke("announce_clean_exit").catch(() => {});

  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? 0;
        received = 0;
        publish({ status: "downloading", received, total });
        break;
      case "Progress":
        received += event.data.chunkLength;
        publish({ status: "downloading", received, total });
        break;
      case "Finished":
        publish({ status: "ready", update });
        break;
    }
  });

  publish({ status: "ready", update });
  // Tauri exits the process once the installer takes over. This call exists only
  // so a running dev build does not sit there with a dead button.
  await update.close();
}
