# Contribuir / Contributing

Gracias por mirar. Starless es chico y está bien definido; los cambios que más
ayudan son los que respetan las restricciones que ya están escritas.

Thank you for looking. Starless is small and tightly specified; the changes
that help most are the ones that respect the constraints already written down.

## Antes de empezar

Lee estos dos archivos. No son documentación decorativa: son las restricciones
que el código tiene que respetar.

Read these two files first. They are not decorative documentation: they are the
constraints the code has to respect.

- **[`PRODUCT.md`](PRODUCT.md)** — qué es el producto, quién lo usa, y qué no
  se negocia: Premium obligatorio, cero telemetría, el audio no pasa por la
  webview.
- **[`DESIGN.md`](DESIGN.md)** — el sistema visual y su presupuesto de
  rendimiento. Si tocas una superficie de UI, este archivo dice cómo se hace y
  qué no se puede romper.

## Requisitos / Requirements

- [Bun](https://bun.sh) 1.x
- [Rust](https://rustup.rs) edición 2024
- Windows: Visual Studio Build Tools con *Desktop development with C++*
- Linux: `libwebkit2gtk-4.1-dev`, `libasound2-dev` y el resto de
  [dependencias de Tauri](https://tauri.app/start/prerequisites/)

## Puesta en marcha / Getting started

```bash
git clone https://github.com/baironvillar/Starless.git
cd Starless
bun install
bun run updater:key        # sólo para compilar: ver README
bun run updater:pubkey
bun run app
```

## Antes de abrir un PR

```bash
bun run lint          # Biome
bun run typecheck     # tsc --noEmit
bun run version       # los tres manifiestos tienen que coincidir

cd src-tauri
cargo check           # el backend
cargo test --lib      # sobre todo el scrubber del reporte de crash
```

`cargo test` no es opcional de vez en cuando: los tests de `report.rs` son lo
único que separa "el log se limpia" de "el log publica el nombre de cuenta de
alguien", y eso se rompe sin que se note.

## Branches and pull requests

**ES** — Nadie commitea directo en `develop` ni en `main`. Todo cambio sale de
una rama nueva creada desde `develop`, con nombre en inglés (`tipo/descripcion`),
y vuelve a `develop` por un pull request. `main` sólo recibe `develop`. Las
reglas completas, en inglés, están abajo.

**EN** — The workflow is a simplified Git Flow: two long-lived branches and one
short-lived branch per change.

| branch | what it is | who writes to it |
| --- | --- | --- |
| `main` | the public line; every commit on it is a published version | only a PR from `develop` |
| `develop` | integration; the base of every branch and the target of every PR | only PRs, never a direct push |
| `type/short-description` | one change: a fix, a feature, a doc | you |
| `release/<version>` | the commit that bumps the version | whoever publishes |

### The rules

1. **Never commit or push directly to `develop` or `main`.** Not even a
   one-line fix or a typo.
2. **Every change starts from an up-to-date `develop`** in a new branch.
3. **One branch, one topic.** If the PR description needs the word "and", it is
   two branches.
4. **Every change goes back to `develop` through a pull request**, with CI
   green before merging.
5. **`main` only receives `develop`**, through a PR, when a version is
   published.
6. **Everything is written in English:** branch names, commit subjects and
   bodies, PR titles and descriptions, and review comments. The only exception
   is user-facing text, which lives in `lib/i18n.ts` in both languages.
7. **A merged branch is deleted.** GitHub can do it automatically
   (*Settings → General → Automatically delete head branches*).

### Branch names

```
type/short-description
```

- `type` is the same list the commit messages use: `feat`, `fix`, `refactor`,
  `perf`, `docs`, `test`, `build`, `ci`, `chore`, `style`, `revert`, plus
  `hotfix` for an urgent fix to a published version.
- `short-description` is English, lowercase, kebab-case, a few words that say
  *what* is touched: `fix/configuration-button`, not `fix/bug` or
  `fix/arreglo-boton`.
- The whole name is at most 60 characters.
- A version bump is `release/<version>`: `release/0.5.5`.

| you found… | the branch is |
| --- | --- |
| a bug in the settings button | `fix/configuration-button` |
| a new feature: upload a playlist cover | `feat/playlist-cover-upload` |
| outdated docs | `docs/update-release-steps` |
| a slow library load | `perf/library-first-paint` |
| a dependency to bump | `build/bump-tauri-2-9` |
| a crash in the published version | `hotfix/updater-crash-on-start` |

### The day-to-day flow

Example: there is a bug in the settings button.

```bash
# 1. Start from the latest develop
git switch develop
git pull origin develop

# 2. Create the branch
git switch -c fix/configuration-button

# 3. Work and commit (subjects follow the convention below, in English)
git commit -m "fix(settings): keep the button enabled after saving"

# 4. Before opening the PR, bring in what landed on develop meanwhile
git fetch origin
git rebase origin/develop

# 5. Push the branch and open a PR into develop
git push -u origin fix/configuration-button
gh pr create --base develop --title "fix(settings): keep the button enabled after saving"
```

6. **Merge with *Squash and merge*.** The PR title becomes the only commit on
   `develop`, so the title follows the commit convention too. *Create a merge
   commit* would leave a `Merge pull request #12 from …` subject on `develop`,
   which the commit-message job rejects.
7. Delete the branch (GitHub does it if the setting above is on) and update
   your local copy:

```bash
git switch develop
git pull origin develop
git branch -d fix/configuration-button
```

If you rebased a branch that was already pushed, update it with
`git push --force-with-lease`, never with a bare `--force`. That is only ever
done on your own branch, never on `develop` or `main`.

### Urgent fixes (`hotfix/`)

A `hotfix/` branch also starts from `develop` and goes back to `develop` through
a PR; the only difference is that a patch release follows right after (see
[publishing a version](#publishing-a-version)). Branching from `main` would
leave a fix on `main` that `develop` does not have, and the next release would
quietly undo it.

### Publishing a version

The version bump goes through a branch and a PR like any other change:

```bash
git switch develop && git pull origin develop
git switch -c release/0.5.5
bun run version:bump patch          # the three manifests, together
git commit -am "0.5.5"              # the subject is the version and nothing else
git push -u origin release/0.5.5
gh pr create --base develop --title "0.5.5"
```

GitHub adds the PR number to a squash commit title (`0.5.5 (#42)`). For a
`fix(...)` subject that is harmless, but the version commit has to say the
version and nothing else, so delete the ` (#42)` in the merge dialog before
confirming. After the merge, the tag goes on the commit that landed on
`develop`:

```bash
git switch develop && git pull origin develop
git tag v0.5.5
git push origin v0.5.5              # this starts the release workflow
```

To make it public, open a PR from `develop` into `main` titled with the bare
version and merge it with *Create a merge commit*, editing the merge commit
title to `0.5.5`. That PR is never squashed: `main` has to contain the same
commits as `develop`, or the release workflow cannot prove a tag reached the
public line.

```bash
gh pr create --base main --head develop --title "0.5.5"
```

### What enforces this

- **The `pre-push` hook** (`.githooks/pre-push`) refuses a push to `develop`
  or `main` and a branch name that does not follow the convention. It turns on
  with the same `bun run hooks:install` as the commit-message hook.
- **The `Branch name` CI job** runs the same file on every pull request, and
  also checks that a PR into `main` comes from `develop`.
- **Branch protection on GitHub** is what makes the rule impossible to skip,
  since a hook lives in a clone and `--no-verify` bypasses it. A repository
  admin sets it once, in *Settings → Branches → Add branch ruleset*, for
  `develop` and `main`:
  - Require a pull request before merging.
  - Require status checks to pass: `Lint, typecheck, build`,
    `Version consistency`, `Commit messages`, `Branch name`.
  - Block force pushes and deletions.
  - On `develop`, allow only *Squash merge*; on `main`, only *Merge commit*.

English is the one rule a script cannot fully check: `fix/arreglo-boton` has a
valid shape. That part is on the reviewer.

## Los mensajes de commit / Commit messages

**ES** — El asunto de un commit tiene una de dos formas:

```
tipo(scope): el asunto, en inglés, en minúscula, sin punto final
0.4.0        la versión sola
```

Es [Conventional Commits](https://www.conventionalcommits.org/) con la segunda
forma agregada. El alcance es opcional y es la superficie que toca: `player`,
`library`, `queue`, `lyrics`, `search`, `updater`, `report`, `auth`, `settings`,
`design`, `i18n`, `release`.

| tipo | para qué |
| --- | --- |
| `feat` | algo que antes no existía |
| `fix` | un comportamiento roto que ahora funciona |
| `refactor` | cambia la forma, no lo que hace |
| `perf` | más rápido, o con menos memoria |
| `docs` | documentación |
| `test` | tests |
| `build` | dependencias, empaquetado |
| `ci` | los workflows de `.github/` |
| `chore` | mantenimiento que no es ninguno de los anteriores |
| `style` | formato, sin cambio de comportamiento |
| `revert` | deshacer algo |

El **cuerpo** es libre y es donde va el porqué. Sólo el asunto tiene forma, pero
todo el mensaje —asunto y cuerpo— se escribe en inglés (ver
[Branches and pull requests](#branches-and-pull-requests)). Los commits viejos
con el cuerpo en español se quedan como están: la historia no se reescribe.

La segunda forma es la que se usa en el commit que sube la versión y en el merge
a `main`, y no es capricho: **GitHub titula la corrida de un tag con el asunto
del commit etiquetado**, no con el nombre del workflow. Un tag sobre un commit
cuyo asunto es `Las letras, y que nada se ponga encima de la música` deja ese
texto al lado de la release para siempre, en la pestaña de Actions y en el
historial. Con el asunto `0.4.0` al lado de la 0.4.0 se lee como se espera.

El commit de la versión sale de una rama `release/0.4.0` y llega a `develop`
por un PR titulado `0.4.0`; el PR de `develop` a `main` lleva el mismo título y
el merge commit, también. Los pasos están en
[Publishing a version](#publishing-a-version).

La regla está escrita una sola vez, en `.githooks/commit-msg`, y corre en los tres
sitios donde puede correr: el hook local, un job de CI y un paso del workflow de
release. Se instala una vez por clon:

```bash
bun run hooks:install
```

**EN** — The subject of a commit is either `tipo(scope):` in English, lowercase
and with no trailing period, or a bare version number, which is the form the
version bump and the merge into `main` use. The body is free-form and it is
where the *why* goes; subject and body are both written in English. The same rule runs in three places — the local hook, a CI
job and a step in the release workflow — and `bun run hooks:install` turns the
hook on for a clone.

## El botón de reportar un crash

Un build normal **no** lleva token: el botón arma el reporte y abre GitHub en el
navegador con todo pre-cargado, y apretas "Create". Para que el botón cree el
issue solo hay que hornear un token de GitHub con permiso `Issues: Write` sobre
este repositorio y nada más:

```bash
# PowerShell, sólo para el build que se va a publicar
$env:STARLESS_REPORT_TOKEN = "github_pat_..."
bun run app:build
```

Nunca commitees ese token. No está en ningún archivo: se lee con `option_env!` en
tiempo de compilación, así que si no lo pasás, simplemente no existe esa
funcionalidad y el build funciona igual.

Un token embebido en un binario público lo puede extraer cualquiera. Por eso el
alcance tiene que ser el mínimo: **un repositorio, `Issues: Write`, nada más**.
Con eso lo peor que puede pasar es que alguien abra issues de spam, que es
justo lo que `SECURITY.md` dice al respecto.

## Reglas que no son negociables

**La versión vive en un solo lugar.** `src-tauri/tauri.conf.json` es la fuente.
`scripts/version.ts` la propaga a `Cargo.toml` y `package.json`, y falla si
discrepan. Si tocas la versión, usa `bun run version:bump patch`; si tocas un
solo manifiesto a mano, el CI lo va a marcar.

**Toda cadena pasa por el mapa de traducción.** Español e inglés se escriben
juntos, y se redactan para que los dos lean de forma natural en vez de traducir uno del
otro. Nunca inline en un componente.

**El audio no pasa por la ventana.** El PCM va de librespot al driver del
sistema. Mover el audio a una API del webview rompe la promesa de arranque y la
de memoria, que son las dos razones por las que existe esta app.

**Sin telemetría.** No es un ajuste: agregar analítica significa retirar una
promesa ya hecha.

**Sin el logotipo ni la marca de Spotify.** En ninguna parte, ni en el código,
ni en la documentación, ni en un issue.

## Cuando el trabajo es de diseño

El proyecto usa [Impeccable](https://github.com/) para las superficies de UI.
La configuración vive en [`.agent/`](.agent/README.md), compartida entre Claude
Code y OpenCode: el skill real está en `.agent/skills/impeccable/`, y cada
herramienta tiene un shim de cinco líneas en su propia carpeta porque cada una
busca skills sólo donde tiene que buscarlas.

```bash
bun run design:detect   # el detector sobre src/
```

Si instalaste el skill y no te aparece, corré `/impeccable doctor`: reporta y
repara el desincronizado entre los artefactos del proyecto y lo que esta versión
del skill espera.

## Pull requests

- Un tema por PR, desde su propia rama y hacia `develop` (ver
  [Branches and pull requests](#branches-and-pull-requests)).
- En inglés: el título, la descripción y los comentarios de review.
- El título del PR sigue la convención de los commits, porque con *Squash and
  merge* es el asunto del commit que queda en `develop`.
- Si tocas UI, incluye una captura antes y después. El diseño se juzga a ojo, no
  leyendo el diff.
- El CI corre lint, typecheck, build, el chequeo de versión, los mensajes de
  commit y el nombre de la rama. Todos tienen que pasar.
