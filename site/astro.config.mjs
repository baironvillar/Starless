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

// GitHub Pages serves a project site under the repository's name.
export default defineConfig({
  site: "https://baironvillar.github.io",
  base: "/Starless",
  fonts: [
    font("Syne", "--font-syne", ["600 800"], "sans-serif"),
    font("DM Sans", "--font-dm-sans", ["400 600"], "sans-serif"),
    font("DM Mono", "--font-dm-mono", [400, 500], "monospace"),
  ],
});
