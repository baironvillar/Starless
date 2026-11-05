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

// Where the page lives decides its address. GitHub Pages serves a project site
// under the repository's name, so every link there starts with `/Starless`;
// Vercel serves it at the root of its own domain. Vercel sets `VERCEL` and
// `VERCEL_PROJECT_PRODUCTION_URL` (a host, no scheme) during its build, and
// the markup reads the prefix from `import.meta.env.BASE_URL`, so this is the
// only place that knows. A build with the Pages prefix on Vercel loads a page
// with no icon, no glass logo and no fonts, and nothing says why.
const vercel = process.env.VERCEL === "1";
const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;

export default defineConfig({
  site: vercel && vercelHost ? `https://${vercelHost}` : "https://baironvillar.github.io",
  base: vercel ? "/" : "/Starless",
  fonts: [
    font("Syne", "--font-syne", ["600 800"], "sans-serif"),
    font("DM Sans", "--font-dm-sans", ["400 600"], "sans-serif"),
    font("DM Mono", "--font-dm-mono", [400, 500], "monospace"),
  ],
});
