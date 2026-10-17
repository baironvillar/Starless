# AGENTS.md

Contexto para cualquier agente que toque este repositorio. Starless es un cliente
de escritorio no oficial de Spotify Premium: Tauri 2 en Rust con un frontend React.

Lee [`PRODUCT.md`](PRODUCT.md) y [`DESIGN.md`](DESIGN.md) antes de cambiar
comportamiento o UI. Este archivo es el mapa y las trampas; aquellos dos son la
razón de las reglas.

## Comandos

```bash
bun install
bun run app          # la app completa con Tauri — el modo normal de trabajar
bun run dev          # sólo el frontend en Vite, sin Tauri. No hay audio
bun run lint         # Biome
bun run typecheck    # tsc --noEmit
bun run version      # los tres manifiestos tienen que coincidir
bun run logo         # regenera el ícono y public/starless.svg

cd src-tauri
cargo check
cargo test --lib     # sobre todo el limpiado del reporte de crash
```

`bun run app:build` **falla a propósito** hasta que exista una `pubkey` de firma.
No es un bug: ver [README](README.md#el-paso-que-casi-nadie-espera).

## Mapa

```
src/                      React 19 + Vite + TypeScript
  App.tsx                 estado de reproducción, búsqueda y navegación
  components/             superficies de UI; SettingsPanel es la referencia visual
  lib/i18n.ts             todo el texto de usuario, ES y EN juntos
  lib/spotify.ts          los hooks de React Query sobre la Web API
  lib/updater.ts          la comprobación de actualizaciones
  lib/changelog.ts        los changelogs que la app muestra en Diagnóstico
src-tauri/src/
  lib.rs                  comandos Tauri, el registro, el ciclo de vida
  auth.rs                 OAuth y la sesión de librespot
  webapi.rs               la Spotify Web API
  playback.rs             el player de librespot y el volumen
  report.rs               detección de crash, limpiado y envío
  settings.rs             lo que sobrevive a un reinicio
  logging.rs              el log local con rotación
.agent/                   configuración de agentes (Claude Code y OpenCode)
docs/updates.md           cómo se publica una versión
```

## Reglas que no se rompen

1. **El audio no pasa por la webview.** El PCM va de librespot al driver del
   sistema. Moverlo a una API del webview rompe las dos promesas que justifican
   la app: arranque y memoria.
2. **Cero telemetría.** Sólo sale algo de la máquina con un clic, y sólo tras un
   crash o un feedback. El log es opt-in; nunca por defecto.
3. **Nada de telemetría, ni de nombre de Spotify.** En ninguna parte: código,
   docs, íconos, issues.
4. **Premium o nada.** Es una restricción de librespot, no una decisión.
5. **Todo texto pasa por `lib/i18n.ts`**, en los dos idiomas a la vez, escritos
   para que ambos lean natural y no como traducción.
6. **La versión vive en `src-tauri/tauri.conf.json`.** `scripts/version.ts` la
   propaga a los otros dos manifiestos y falla si discrepan. No la edites a mano.

## Convenciones

- **Comentarios explican el porqué, no el qué.** El código dice qué hace; el
  comentario dice por qué esa forma y no la evidente, y qué se rompió antes.
  Hay varios que existen porque algo falló en vivo — no los borres como
  redundantes.
- **Biome formatea todo.** Sin excepciones ni disables sin motivo escrito.
- **El backend es la frontera de confianza.** El webview nunca ve una credencial:
  pregunta si hay sesión y recibe un booleano y un nombre. Si un bug necesita un
  token en el frontend, el bug es el diseño.
- **librespot está detrás de una capa fina.** Spotify no publica protocolo, así
  que se rompe; toda llamada pasa por un módulo y no se habla con librespot
  directo desde otro lado.

## Trampas que ya pagaron una vez

- **`%APPDATA%\Starless` se borra al cerrar sesión.** `auth::forget_credentials`
  hace `remove_dir_all` sobre todo el directorio. Un ajuste guardado ahí se pierde
  en cada cierre de sesión. Lo que debe sobrevivir un reinicio va a
  `%LOCALAPPDATA%\Starless` — que es también donde vive el log, por el mismo
  motivo.
- **El endpoint del actualizador devuelve 404 hasta que haya una release.** El
  comprobador siempre dice "estás al día". Un fallo silencioso es exactamente lo
  que hace que un actualizador roto parezca uno que funciona.
- **GitHub devuelve 422 si le pasás una etiqueta que el repositorio no tiene**, y
  eso perdería el reporte entero. `report.rs` reintenta sin etiqueta por eso.
- **El limpiado de logs reconoce formas, no personas.** Los patrones adivinan cómo
  se ve un nombre; el nombre de cuenta se quita por valor exacto, porque la
  sesión dice cuál es. Un test lo cubre (`the_account_name_is_removed_even_in_free_text`).
- **La barra de arriba es zona de arrastre.** Con `decorations: false` no hay
  título del sistema, así que la ventana se mueve desde ahí y los controles
  llevan `data-tauri-drag-region="false"`.
- **`.agent/` es la copia canónica** de la configuración de agentes; `.claude/` y
  `.opencode/` tienen un shim de cinco líneas que apunta ahí. Editar el skill
  significa editar `.agent/`.

## Antes de abrir un PR

`bun run lint`, `bun run typecheck`, `bun run version`, `cargo check` y
`cargo test --lib`. Si tocás UI, antes y después en captura: el diseño se juzga a
ojo, no leyendo el diff.