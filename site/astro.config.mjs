import { defineConfig, fontProviders } from "astro/config";

// The fonts are downloaded at build time and served from the site itself: a
// page that promises nobody hears what you listen to can't announce every
// visit to a font CDN.
const font = (name, cssVariable, weights, fallback) => ({
  provider: fontProviders.google(),
  name,
  cssVariable,
  weights,
  styles: ["normal"],
  fallbacks: [fallback],
});

// The page lives at the root of its own host: a Cloudflare Worker that serves
// `dist/` as static assets (`wrangler.jsonc`). It used to be published under
// GitHub Pages' `/StarMusic` prefix and on Vercel at the root, and this file
// picked one by reading `VERCEL`; with one host there is nothing to pick. The
// markup still reads the prefix from `import.meta.env.BASE_URL`, so a move to a
// path again is a change here and nowhere else. `site` is the absolute address
// the share card points at: change it when the landing gets its own domain.
const site = "https://star-music.bairovillar.workers.dev";

export default defineConfig({
  site,
  base: "/",
  fonts: [
    font("Syne", "--font-syne", ["600 800"], "sans-serif"),
    font("DM Sans", "--font-dm-sans", ["400 600"], "sans-serif"),
    font("DM Mono", "--font-dm-mono", [400, 500], "monospace"),
  ],
});
