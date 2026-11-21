<!--
  El pull request de la release: la rama `release/<versión>` hacia `develop`.
  El título es la versión y nada más: `0.6.0`.
-->

## Version

<!-- La versión que sale, por ejemplo `0.6.0`. La misma que el título. -->

## What changed in this release

<!--
  La sección de CHANGELOG.md de esta versión, copiada acá.

  Es el cuerpo de la release de GitHub y las notas del manifest: están
  escritas una sola vez, en CHANGELOG.md, y todo lo demás las lee de ahí.
-->

## Checklist

- [ ] The branch is `release/<version>`, cut from `develop`
- [ ] This PR was opened by `bun run release <level>`, and the four manifests agree (`bun run version`)
- [ ] CHANGELOG.md has the section `## [<version>]`
- [ ] `src/lib/changelog.ts` has the entry for this version, in both languages
- [ ] The `date` of the entry in `src/lib/changelog.ts` is today. star writes the date in `CHANGELOG.md`, not in the app's copy, and the app keeps saying the version is not out until it is there
- [ ] The title of this pull request is the version and nothing else; it is merged with `bun run release finish`, not with GitHub's button
- [ ] Everything that should go out in this release is already merged into `develop`
