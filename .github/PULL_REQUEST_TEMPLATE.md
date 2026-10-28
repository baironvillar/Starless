<!--
  Un cambio: un tema, un pull request. El título, esta descripción y los
  comentarios de review van en inglés — con *Squash and merge* el título queda
  como el commit en `develop`.

  Llená lo que aplique y borrá lo que no.
-->

## Title

<!--
  `type(scope): what it does` — en inglés, en minúscula, sin punto final.

  tipo:   feat | fix | refactor | perf | docs | test | build | ci | chore | style | revert
  scope:  player | library | queue | lyrics | search | updater | report | auth | settings | design | i18n | release

  Ejemplos:
    feat(lyrics): show the line that is being sung in the middle
    fix(player): keep the queue going when a song ends
    docs(contributing): say which branch a change goes to
-->

## What

<!-- Una o dos frases. Si esto necesita la palabra "and", son dos pull requests. -->

## Why

<!-- El problema que resuelve. "Closes #123" si cierra un issue. -->

## How I checked it

<!-- Qué corriste: `bun run lint`, `bun run typecheck`, `bun run version`, la app. -->

## Screenshots

<!-- Obligatorio si toca la UI: el diseño se juzga a ojo, no leyendo el diff.
     Poné la de "después" primero: es la que importa. -->

## Checklist

- [ ] The branch was cut from `develop` and is named `type/short-description`
- [ ] This pull request targets `develop`
- [ ] The title, the commits and this description are in English
- [ ] The user-facing text is in `lib/i18n.ts`, in both languages
- [ ] It does not touch the audio, the startup or the memory use
- [ ] It adds no telemetry and no external service that reports usage data
- [ ] It does not use the name, the brand or the logo of Spotify
- [ ] It does not move the audio to a webview API
