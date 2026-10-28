<!--
  El pull request de la release: la rama `release/<versión>` hacia `develop`.
  El título es la versión y nada más: `0.5.6`.
-->

## Version

<!-- La versión que sale, por ejemplo `0.5.6`. La misma que el título. -->

## What changed in this release

<!--
  La sección de CHANGELOG.md de esta versión, copiada acá.

  Es el cuerpo de la release de GitHub y las notas del manifest: están
  escritas una sola vez, en CHANGELOG.md, y todo lo demás las lee de ahí.
-->

## Checklist

- [ ] The branch is `release/<version>`, cut from `develop`
- [ ] `bun run version:bump patch|minor|major` was run and the three manifests agree (`bun run version`)
- [ ] CHANGELOG.md has the section `## [<version>]`
- [ ] `src/lib/changelog.ts` has the entry for this version, in both languages
- [ ] The title of this pull request is the version and nothing else
- [ ] Everything that should go out in this release is already merged into `develop`
