import i18next from "i18next";
import en from "./en.json";
import es from "./es.json";

/**
 * The landing's two languages, from one place.
 *
 * **One instance, used twice.** The build renders the page in English with `t`,
 * so a visitor without JavaScript and every link preview read a whole page. The
 * browser gets the same instance (the module `<script>` in `index.astro`) and the
 * language switch asks it for the other language. Both languages ship in the page:
 * the switch is instant and works offline, and no request goes out to fetch text.
 *
 * **Every string is ours, and some carry markup** (`<b>` in the install steps), so
 * nothing is escaped: the page writes them with `set:html` and `innerHTML`.
 *
 * `initAsync: false` because the resources are already in memory: without it the
 * first `t` during the build could run before `init` resolves.
 */
export const i18n = i18next.createInstance();

void i18n.init({
  lng: "en",
  fallbackLng: "en",
  resources: { en: { translation: en }, es: { translation: es } },
  interpolation: { escapeValue: false },
  initAsync: false,
});

/** English, for the markup the build writes. */
export const t = i18n.getFixedT("en");
