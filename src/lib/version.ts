import { getVersion } from "@tauri-apps/api/app";

/**
 * The shipped version.
 *
 * Inside Tauri this reads the value Tauri compiled into the binary from
 * `tauri.conf.json`, so it always reflects what the user actually installed —
 * not what the frontend bundle happens to claim. Outside Tauri (plain `vite
 * dev`, or a browser) it falls back to the build-time constant.
 */
export async function appVersion(): Promise<string> {
  try {
    return await getVersion();
  } catch {
    return __APP_VERSION__;
  }
}
