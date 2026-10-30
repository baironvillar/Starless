<div align="center">

# Starless

**Cliente de escritorio no oficial para Spotify Premium.**
**Unofficial desktop client for Spotify Premium.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Windows](https://img.shields.io/badge/Windows-first-0078D4?logo=windows&logoColor=white)
![Tauri](https://img.shields.io/badge/Tauri-2-FFC131?logo=tauri&logoColor=black)
![CI](https://github.com/baironvillar/Starless/actions/workflows/ci.yml/badge.svg)

Hecho con Tauri y React. El audio no pasa por la ventana.
Built with Tauri and React. The audio never goes through the window.

</div>

---

## Español

> [!IMPORTANT]
> **Starless no está afiliado, asociado, autorizado ni respaldado por Spotify AB.**
> Es un cliente de terceros. No usa el logotipo ni la marca de Spotify, y no
> implica ningún tipo de aprobación. **Requiere Spotify Premium**: sin Premium
> Spotify no entrega audio, y esta app no puede cambiar eso.

### Qué es

Un reproductor de escritorio para Spotify Premium que abre rápido y se
aparta. El cliente oficial funciona, pero tarda en arrancar y pesa; Starless
existe por esa diferencia concreta, no por ofrecer otra forma de escuchar
música.

El audio decodificado va de librespot al driver del sistema por WASAPI en
Windows. **Nunca pasa por la ventana.** Por eso el reproductor es usable antes
de que la sesión termine de negociar con Spotify, y por eso la memoria se
mantiene baja mientras suena.

### Qué hace

- **Inicia sesión con Spotify por OAuth.** La app nunca ve tu contraseña.
- **Tu biblioteca:** canciones que te gustan y tus playlists, con el conteo
  exacto.
- **Búsqueda** con sugerencias bajo el campo y una pantalla de resultados
  separada, con pestañas de Todo, Canciones, Álbumes, Playlists y Artistas.
- **Perfil de artista** con discografía y canciones.
- **Reproducir un álbum entero** desde su tarjeta, con cola propia.
- **Barra de reproducción siempre visible:** portada, anterior, pausa,
  siguiente, aleatorio y repetir. No hay que navegar a otro lado para controlar
  la música.
- **Cola de reproducción**, con lo que suena y lo que sigue.
- **Agregar a una playlist** y crear una playlist desde ahí mismo.
- **Interfaz bilingüe**, español e inglés, con selector.
- **Cero telemetría.** Starless no reporta datos de uso a nadie, tampoco a su
  autor.
- **Actualizaciones automáticas:** comprueba si hay versión nueva al abrir y
  tú decides cuándo instalarla. Una app que corta la música para instalar un
  parche es una app que la gente apaga.
- **Diagnóstico:** registro a archivo local con rotación y un autodiagnóstico
  con `STARLESS_DIAGNOSTIC=1`.
- **Reportes de crash.** Si la app se muere sin cerrarse, al volver a abrirla
  Starless lo detecta y te ofrece mandar el registro. Tú decides: nada sale de
  tu máquina hasta que aprietas el botón, y lo que se manda ya viene sin tu
  nombre de cuenta, sin tu usuario de Windows y sin identificadores de
  canción.
- **Sin barra de título.** La ventana no dibuja la del sistema. Sus controles
  — minimizar, maximizar, cerrar — viven al final de la barra de arriba, y esa
  barra es lo que mueve la ventana.
- **Feedback desde adentro.** Ajustes → Diagnóstico tiene un botón para contar
  qué anda lento, qué no encuentras o qué te molesta. El log va **apagado por
  defecto** y se activa con un clic, porque "la búsqueda va lenta" y "mandame el
  registro de tu máquina" no son el mismo pedido.

Una canción que no se puede reproducir se salta, hasta cinco seguidas antes de
renderse: una región bloqueada o un CDN muerto no deberían terminar la sesión.

### Instalar

Windows primero. Los instaladores van adjuntos a las
[ releases](https://github.com/baironvillar/Starless/releases):

- `starless_*-setup.exe` — instalador NSIS, instala para el usuario actual.
- `*-setup.msi` — instalador MSI.

> [!WARNING]
> **Los instaladores no están firmados.** Windows SmartScreen y el Gatekeeper de
> macOS van a avisar. SmartScreen dice quién construyó el archivo y puedes
> seguir; el Gatekeeper de macOS requiere un clic extra en *Abrir*. La firma
> criptográfica sí está, pero protege **la URL de actualización**, no al
> instalador — es otro riesgo, y ese está cerrado.

### Compilar desde el código

Necesitas:

- **[Bun](https://bun.sh)** 1.x — el package manager y el runner de scripts.
- **[Rust](https://rustup.rs)**, edición 2024 (1.85 o superior).
- **Visual Studio Build Tools** con *Desarrollo para el escritorio en C++*, en
  Windows. Sin esto no compila el crate de audio.
- WebView2 — ya viene en Windows 10 y 11 actuales.

En Linux, las dependencias de Tauri más `libasound2-dev` para el backend ALSA:

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev \
  libasound2-dev
```

Después:

```bash
git clone https://github.com/baironvillar/Starless.git
cd Starless
bun install
```

### El paso que casi nadie espera

`bun run app:build` **falla a propósito** la primera vez, y no es un bug:

```
Error: updater `pubkey` is not a valid public key
```

La configuración trae `"pubkey": "PENDIENTE: bun run updater:pubkey"`. Un
actualizador sin llave pública no verifica nada, y el build prefiere no
compilar antes que compilar inseguro. Genera tu par de llaves una vez:

```bash
bun run updater:key        # te pide una contraseña
bun run updater:pubkey     # copia la pública a src-tauri/tauri.conf.json
```

Tu llave privada queda en `.secrets/`, que está en `.gitignore`. Si publicas
versiones, esa llave es la que firma cada actualización: **guárdala fuera del
repositorio** y no la regeneres, porque una llave nueva deja sin poder
actualizarse a todas las instalaciones que ya tienen la pública vieja.

Después de eso, `bun run app` levanta la app en modo desarrollo.

### Comandos

| Comando | Qué hace |
|---|---|
| `bun run app` | Levanta la app completa con Tauri (lo normal para desarrollar) |
| `bun run dev` | Sólo el frontend en Vite, sin Tauri. No hay audio |
| `bun run app:build` | Instala y compila los instaladores |
| `bun run lint` | Biome: lint y formato en modo lectura |
| `bun run lint:fix` | Lo mismo, escribiendo las correcciones |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run version` | La versión y si los tres manifiestos coinciden |
| `bun run version:bump patch` | Sube la versión en los tres manifiestos |
| `bun run design:detect` | Detector de diseño de Impeccable sobre `src/` |

La versión vive en un solo lugar, `src-tauri/tauri.conf.json`. El script la
propaga a `Cargo.toml` y `package.json` y falla si discrepan, así que un PR que
cambie la versión en un solo archivo se ve en el CI.

### Estructura

```
src/                    Frontend React 19 + Vite + TypeScript
  components/           Superficies de UI
  lib/                  Biblioteca, i18n, actualizador, changelog
src-tauri/              Backend Rust
  src/                  sesión, reproducción, auth, biblioteca, registro
.agent/                  Configuración de agentes (Claude Code y OpenCode)
docs/updates.md         Cómo se publica una actualización
PRODUCT.md              Qué es el producto y sus restricciones
DESIGN.md               El sistema visual: vidrio flotante, paleta, motion
```

`PRODUCT.md` y `DESIGN.md` no son documentación decorativa: son las
restricciones que el código tiene que respetar, y dicen cosas como por qué el
audio no puede pasar por la webview o por qué el blur tiene tope de 24px.

### Actualizaciones

Una copia instalada de Starless comprueba GitHub Releases por una versión
nueva, 2,5 segundos después de abrir, y **no descarga nada** hasta que lo pides
en Ajustes. El manifest vive en la release y GitHub redirige la URL a la más
reciente, así que no hay servidor propio que mantener.

El detalle completo, incluida la firma y por qué no es opcional, está en
[`docs/updates.md`](docs/updates.md).

Publicar es `bun run version:bump patch` en una rama `release/<versión>`, un PR
a `develop`, y empujar el tag sobre el commit mergeado. La CI compila en Windows, firma, arma el `latest.json` y deja la
release en borrador; sólo falta darle a *Publish release*.

### Advertencias honestas

- **El backend es inverso.** Spotify no publica especificación de su protocolo.
  Asume que habrá un corte de varios días por causas que no están en este
  proyecto. Todo lo que habla con librespot está detrás de una capa fina, para
  que una ruptura se arregle en un lugar.
- **Sin telemetría es una restricción, no un ajuste.** Agregar analítica después
  significa retirar una promesa ya hecha.
- **Windows primero.** macOS y Linux siguen el camino; falta probarlos en serio.
- **La firma de código de los instaladores está pendiente.** SmartScreen va a
  avisar hasta que se resuelva.
- **Medido, en una sola máquina.** Windows 11, build de release de la 0.5.5
  con lo de `develop`, 30 de octubre de 2026, tres arranques. La ventana aparece en unos 40 ms, la
  sesión queda conectada en 1 a 1,7 s y la biblioteca llega en 2 a 3,5 s: el
  "menos de un segundo" de `PRODUCT.md` se cumple para la ventana, no para la
  biblioteca. En memoria privada son unos 290 MB en reposo y 325 MB con música,
  y de eso `starless.exe` —el audio, la sesión— es 12 a 14 MB: **el resto es
  WebView2**, la ventana. Son números de una máquina, no un benchmark.

### Documentación

- [`PRODUCT.md`](PRODUCT.md) — producto, usuarios, restricciones
- [`DESIGN.md`](DESIGN.md) — el sistema visual y su presupuesto de rendimiento
- [`docs/updates.md`](docs/updates.md) — publicación y actualizaciones
- [`CHANGELOG.md`](CHANGELOG.md) — qué cambió en cada versión
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — cómo contribuir, y el flujo de ramas
- [`SECURITY.md`](SECURITY.md) — cómo reportar un problema de seguridad

### Licencia

[MIT](LICENSE) © 2026 Bairon Villar.

---

## English

> [!IMPORTANT]
> **Starless is not affiliated with, associated with, authorized by, or endorsed
> by Spotify AB.** It is a third-party client. It uses no Spotify logo or
> wordmark and implies no endorsement. **It requires Spotify Premium**: without
> Premium, Spotify delivers no audio, and this app cannot change that.

### What it is

A desktop player for Spotify Premium that opens fast and then gets out of the
way. The official client works, but it is slow to start and heavy; Starless
exists for that one difference, not to offer another way to listen to music.

Decoded audio goes from librespot to the system driver over WASAPI on Windows.
**It never passes through the window.** That is why the player is usable before
the session finishes negotiating with Spotify, and why memory stays low while
music plays.

### What it does

- **Spotify sign-in through OAuth.** The app never sees your password.
- **Your library:** Liked Songs and your playlists, with an exact count.
- **Search** with suggestions under the field and a separate results screen,
  with tabs for All, Songs, Albums, Playlists and Artists.
- **Artist profiles** with their discography and their songs.
- **Playing a whole album** from its card, with its own queue.
- **A player bar that is always there:** cover, previous, pause, next, shuffle
  and repeat. You never navigate somewhere else to control playback.
- **A play queue**, with what is playing and what is next.
- **Adding to a playlist**, and creating a playlist from there.
- **A bilingual interface**, Spanish and English, with a selector.
- **Zero telemetry.** Starless reports usage data to nobody, including its
  author.
- **Automatic updates:** it checks for a new version when it opens, and you
  decide when to install it. An app that cuts the music to install a patch is
  an app people turn off.
- **Diagnostics:** a local log file with rotation, plus a self-test behind
  `STARLESS_DIAGNOSTIC=1`.
- **Crash reports.** If the app dies without shutting down, Starless notices when
  you reopen it and offers to send the log. You decide: nothing leaves your
  machine until you press the button, and what does leave has already had your
  account name, your Windows user name and any track identifiers taken out.
- **No title bar.** The window does not draw the system's. Its own controls —
  minimise, maximise, close — live at the end of the top bar, and that bar is
  what moves the window.
- **Feedback from inside the app.** Settings → Diagnostics has a button to say
  what runs slow, what you could not find, or what keeps getting in the way. The
  log is **off by default** and takes one click to attach, because "the search is
  slow" and "send me a copy of your machine's log" are not the same request.

A song that will not play is skipped, up to five in a row before giving up: one
region-blocked track or dead CDN should not end the session.

### Install

Windows first. Installers are attached to the
[releases](https://github.com/baironvillar/Starless/releases):

- `starless_*-setup.exe` — NSIS installer, installs for the current user.
- `*-setup.msi` — MSI installer.

> [!WARNING]
> **The installers are unsigned.** Windows SmartScreen and the macOS Gatekeeper
> will warn. SmartScreen tells you who built the file and you can proceed; the
> macOS Gatekeeper needs one extra click on *Open*. The update manifest *is*
> cryptographically signed, but that signature protects **the update URL**,
> not the installer — a different threat, and that one is closed.

### Building from source

You need:

- **[Bun](https://bun.sh)** 1.x — the package manager and script runner.
- **[Rust](https://rustup.rs)**, edition 2024 (1.85 or newer).
- **Visual Studio Build Tools** with *Desktop development with C++* on Windows.
  Without it the audio crate does not compile.
- WebView2 — already present on current Windows 10 and 11.

On Linux, Tauri's dependencies plus `libasound2-dev` for the ALSA backend:

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev \
  libasound2-dev
```

Then:

```bash
git clone https://github.com/baironvillar/Starless.git
cd Starless
bun install
```

### The step nobody expects

`bun run app:build` **fails on purpose** the first time, and it is not a bug:

```
Error: updater `pubkey` is not a valid public key
```

The config ships `"pubkey": "PENDIENTE: bun run updater:pubkey"`. An updater
with no public key verifies nothing, and the build would rather not compile than
compile insecure. Generate your keypair once:

```bash
bun run updater:key        # asks you for a password
bun run updater:pubkey     # copies the public half into src-tauri/tauri.conf.json
```

Your private key lands in `.secrets/`, which is git-ignored. If you ship
releases, that key is what signs every update: **keep it outside the
repository** and never regenerate it, because a new key leaves every install
that already trusts the old public half unable to update.

After that, `bun run app` starts the app in development mode.

### Commands

| Command | What it does |
|---|---|
| `bun run app` | Runs the full app under Tauri (the normal way to develop) |
| `bun run dev` | Frontend only under Vite, no Tauri. No audio |
| `bun run app:build` | Builds and bundles the installers |
| `bun run lint` | Biome: lint and format, read-only |
| `bun run lint:fix` | Same, writing the fixes |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run version` | The version, and whether all three manifests agree |
| `bun run version:bump patch` | Bumps the version in all three manifests |
| `bun run design:detect` | Impeccable design detector over `src/` |

The version lives in one place, `src-tauri/tauri.conf.json`. The script
propagates it to `Cargo.toml` and `package.json` and fails when they disagree,
so a PR that bumps one file and forgets the others shows up in CI.

### Layout

```
src/                    React 19 + Vite + TypeScript frontend
  components/           UI surfaces
  lib/                  Library, i18n, updater, changelog
src-tauri/              Rust backend
  src/                  session, playback, auth, library, logging
.agent/                  Agent config shared by Claude Code and OpenCode
.github/workflows/       A tag builds, signs and publishes the release
docs/updates.md         How a release ships
PRODUCT.md              What the product is and what constrains it
DESIGN.md               The visual system: floating glass, palette, motion
```

`PRODUCT.md` and `DESIGN.md` are not decorative documentation: they are the
constraints the code has to respect, and they say things like why audio must
not travel through the webview, or why the blur radius caps at 24px.

### Updates

An installed copy of Starless checks GitHub Releases for a new version 2.5
seconds after opening, and **downloads nothing** until you ask in Settings. The
manifest lives on the release and GitHub redirects that URL to the newest one,
so there is no server of our own to maintain.

The full detail, including the signature and why it is not optional, is in
[`docs/updates.md`](docs/updates.md).

Publishing is `bun run version:bump patch` on a `release/<version>` branch, a
PR into `develop`, and pushing the tag on the merged commit. CI builds on Windows, signs, writes `latest.json` and
leaves the release as a draft; all that is left is clicking *Publish release*.

### Honest warnings

- **The backend is reverse-engineered.** Spotify publishes no protocol
  specification. Assume a multi-day outage will eventually happen for reasons
  outside this project. Everything that talks to librespot sits behind a thin
  layer, so a breakage is patched in one place.
- **No telemetry is a constraint, not a setting.** Adding analytics later means
  retracting a promise already made.
- **Windows first.** macOS and Linux follow; neither has been properly tested
  yet.
- **Installer code signing is still pending.** SmartScreen will warn until that
  is resolved.
- **Measured, on one machine.** Windows 11, a 0.5.5 release build from
  `develop`, 30 October 2026, three launches. The window shows in about 40 ms, the session is
  connected in 1 to 1.7 s and the library arrives in 2 to 3.5 s: the "under a
  second" in `PRODUCT.md` holds for the window, not for the library. Private
  memory is about 290 MB at rest and 325 MB while playing, and `starless.exe`
  —the audio, the session— is 12 to 14 MB of it: **the rest is WebView2**, the
  window. These are one machine's numbers, not a benchmark.

### Documentation

- [`PRODUCT.md`](PRODUCT.md) — product, users, constraints
- [`DESIGN.md`](DESIGN.md) — the visual system and its performance budget
- [`docs/updates.md`](docs/updates.md) — releases and updates
- [`CHANGELOG.md`](CHANGELOG.md) — what changed in each version
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — how to contribute, and the branch workflow
- [`SECURITY.md`](SECURITY.md) — how to report a security problem

### License

[MIT](LICENSE) © 2026 Bairon Villar.
