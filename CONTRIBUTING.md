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
  rendimiento. Si tocás una superficie de UI, este archivo dice cómo se hace y
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

## El botón de reportar un crash

Un build normal **no** lleva token: el botón arma el reporte y abre GitHub en el
navegador con todo pre-cargado, y vos apretás "Create". Para que el botón cree el
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
discrepan. Si tocás la versión, usá `bun run version:bump patch`; si tocás un
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

- Un tema por PR.
- En español o inglés, como te quede natural.
- Si tocás UI, incluí una captura antes y después. El diseño se juzga a ojo, no
  leyendo el diff.
- El CI corre lint, typecheck, build y el chequeo de versión. Los cuatro tienen
  que pasar.
