# Los idiomas de la landing / The landing's languages

La landing (`site/`) se lee en inglés y en español, con un botón «EN / ES» que
cambia todo el texto en el momento. Este documento dice dónde vive cada texto,
cómo se agrega uno y por qué está armado así.

The landing (`site/`) reads in English and in Spanish, with an "EN / ES" switch
that changes all of its text in place. This document says where each text lives,
how to add one and why it is built this way.

> La app no usa esto. Su texto vive en `src/lib/i18n.ts` y la regla 5 de
> `AGENTS.md` sigue igual. / The app does not use this: its text lives in
> `src/lib/i18n.ts`, and rule 5 of `AGENTS.md` is unchanged.

## Dónde vive / Where it lives

```
site/src/i18n/
  en.json     every English string, by key
  es.json     the same keys, in Spanish
  index.ts    the i18next instance, and `t` for the build (English)
```

Las claves están agrupadas en tres espacios / The keys are grouped in three spaces:

| Space | What it holds |
|---|---|
| `page.*` | The page itself: the hero, the sections, the install notes, the player bar, the `aria-label`s |
| `screen.*` | The drawing of the app in `Screen.astro` |
| `track.*` | The section names the player bar shows while you scroll (`data-track`) |

The keys are the first words of the English text, in kebab-case
(`page.windows-will-warn-you`). They came out of the migration that way, and a new
key follows the same form. A key never changes when the English changes slightly:
it names the string, it does not have to quote it.

## Cómo funciona / How it works

1. **The build writes English.** Each text in the markup carries its key, and the
   build fills it with `t`:

   ```astro
   <h3 data-i18n="page.you-need-premium" set:html={t("page.you-need-premium")}></h3>
   <nav aria-label={t("page.sections")} data-i18n-label="page.sections">
   <section data-track={t("track.the-dj")} data-i18n-track="track.the-dj">
   ```

   A visitor without JavaScript, a search engine and a link preview all read a
   whole English page.

2. **The browser gets the same instance.** A module `<script>` at the end of
   `index.astro` (bundled by Astro, unlike the inline script) loads i18next with
   both languages, puts it on `window.starlessI18n`, and sends `starless:i18n`.

3. **The switch asks i18next.** The inline script's `apply(lang)` takes
   `getFixedT(lang)` and rewrites every `[data-i18n]`, `[data-i18n-label]` and
   `[data-i18n-track]`. A click or a saved Spanish preference that comes before
   i18next is ready waits for the event (`whenI18n`).

The choice is remembered in `localStorage` (`starless-lang`), as before.

## Agregar un texto / Adding a text

1. Add the key to **both** `en.json` and `es.json`. A key in one file only falls
   back to English, so a missing Spanish string shows up as English and not as
   an error.
2. In the markup, put the key in `data-i18n` and the English in with
   `set:html={t("...")}`. For an `aria-label`, use `aria-label={t("...")}` and
   `data-i18n-label`. For a section name, use `data-track={t("...")}` and
   `data-i18n-track`.
3. Write both languages so that each reads naturally, not as a translation
   (the same rule as the app's text).
4. **A text with a number in it** uses i18next's `{{count}}` and carries the
   number in `data-i18n-count`, so the switch can pass it back:

   ```astro
   <span data-i18n="screen.songs-count" data-i18n-count="12"
         set:html={t("screen.songs-count", { count: 12 })}></span>
   ```

   The drawing of the app counts songs and playlists this way. Before, it said
   "12 canciones" in Spanish on the English page.

**Markup is allowed.** The install steps carry `<b>`, so nothing is escaped:
`interpolation.escapeValue` is off and the page writes with `set:html` and
`innerHTML`. Every string is ours. Text from anywhere else never goes in these
files.

## Por qué así / Why this way

- **Before, Spanish rode in attributes** (`data-es`, `data-es-label`,
  `data-track-es`) beside the English in the markup. There were 109 of them across
  two files, and there was no single place to read, review or extend the Spanish.
  The JSON files are that place.
- **Both languages ship in the page.** The switch is instant, works offline and
  sends no request for text, so the page keeps its promise of not calling home.
- **The cost is i18next in the browser**, a few kilobytes, loaded from the site
  itself and not from a CDN.
- **The migration was mechanical.** A script moved each `data-es` string and its
  English into the JSON files and replaced the element's content with the key. No
  text changed, and the check was that every element still has text in both
  languages.
