import { readFileSync } from "node:fs";
// @ts-expect-error type error without @types/node package
import process from "node:process";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

// Mirrors src-tauri/tauri.conf.json; `bun run version` keeps the two in step.
// Used only as the fallback when the frontend runs outside the Tauri shell.
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],

  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    /**
     * Where the build came from: "develop" or "release".
     *
     * The same decision that gives a develop build its inverted icon is the one
     * that says so here, and it is decided when the build is made — not when the
     * app asks the network. A build that has to be asked whether it is a
     * prerelease is a build that cannot answer when the network is down.
     *
     * **The mode is the default and the env is the override.** A dev server is
     * a develop build by definition; a production build is a release one. The
     * env exists because CI decides the channel from the tag —and there the
     * mode says "production" while the channel is "develop". Reading the mode
     * instead of the env everywhere else means nobody has to remember to set
     * a variable to get the right answer, and the shell that runs the build
     * does not have to understand `VAR=valor comando`: `cmd.exe` does not, and
     * the build is what decides whether the app calls itself a prerelease.
     */
    __STARLESS_CHANNEL__: JSON.stringify(
      process.env.STARLESS_CHANNEL ?? (mode === "development" ? "develop" : "release"),
    ),
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
