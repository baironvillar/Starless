# AGENTS.md

Contexto para cualquier agente que toque este repositorio. Starless es un cliente
de escritorio no oficial de Spotify Premium: Tauri 2 en Rust con un frontend React.

Lee [`PRODUCT.md`](PRODUCT.md) y [`DESIGN.md`](DESIGN.md) antes de cambiar
comportamiento o UI. Este archivo es el mapa y las trampas; aquellos dos son la
razón de las reglas.

**Para agregar una funcionalidad o cambiar comportamiento, cargá el skill
[`starless`](.agent/skills/starless/SKILL.md).** Este archivo dice *qué* no se
rompe; el skill dice *en qué orden* se hace el cambio y *qué se actualiza del
otro lado de la costura*. Casi todos los bugs de este repo viven entre dos
capas, y ninguno de ellos se ve leyendo el archivo que se editó.

## Comandos

```bash
bun install
bun run app          # la app completa con Tauri — el modo normal de trabajar
bun run dev          # sólo el frontend en Vite, sin Tauri. No hay audio
bun run lint         # Biome
bun run typecheck    # tsc --noEmit
bun run version      # los tres manifiestos tienen que coincidir
bun run logo         # regenera el ícono y public/starless.svg
bun run logo:invert  # el mismo ícono con los colores invertidos, a icons-dev/
bun run hooks:install  # una vez por clon: git config core.hooksPath .githooks

cd src-tauri
cargo check
cargo test --lib     # sobre todo el limpiado del reporte de crash
```

`bun run app:build` **falla a propósito** hasta que exista una `pubkey` de firma.
No es un bug: ver [README](README.md#el-paso-que-casi-nadie-espera).

**No se hace una build sin preguntar.** Una build —`bunx vite build`, `bun run
app:build`, `cargo build`, o empujar un tag que dispara el workflow de release—
tarda minutos y compila la máquina entera. Antes de correr una hay que
preguntarle a quien está del otro lado, y hacerlo aunque parezca que el
resultado va a ser el mismo. Los chequeos baratos (`bun run lint`, `bun run
typecheck`, `bun run version`) no cuentan: corren en segundos y son la puerta de
calidad de cada cambio. La `pubkey` que hace falta para `app:build` es la
prueba de que esto se cumple: una build de release **no se puede** hacer sin esa
clave, y esa clave hay que pedirla.

**`bun run app` lleva `--config src-tauri/tauri.dev.conf.json`**, que sólo cambia
`bundle.icon` para usar `icons-dev/`. El ícono de desarrollo es el mismo dibujo con
los dos colores al revés —fondo lima, estrella oscura— y existe por una razón
concreta: dos copias con el mismo nombre en la misma máquina son la forma más
rápida de depurar el proceso equivocado. `scripts/logo.ts` escribe los invertidos
**en otra carpeta**, nunca encima de `icons/`: pisar los de la release dejaría la
siguiente versión instalada con el ícono de desarrollo, y eso no se ve hasta que
alguien la instala.

## Mapa

```
src/                      React 19 + Vite + TypeScript
  App.tsx                 estado de reproducción, búsqueda y navegación
  components/             superficies de UI; SettingsPanel es la referencia visual
  lib/i18n.ts             todo el texto de usuario, ES y EN juntos
  lib/spotify.ts          los hooks de React Query sobre los comandos de Rust
  lib/updater.ts          la comprobación de actualizaciones
  lib/changelog.ts        los changelogs que la app muestra en Diagnóstico
src-tauri/src/
  lib.rs                  comandos Tauri, el registro, el ciclo de vida
  auth.rs                 OAuth y la sesión de librespot
  spclient.rs             la biblioteca, leída por la sesión (ver Regla 7)
  models.rs               las formas que el frontend ve
  playback.rs             el player de librespot y el volumen
  voice.rs                la voz del DJ: el sink propio y el audio de la narración
  report.rs               detección de crash, limpiado y envío
  settings.rs             lo que sobrevive a un reinicio
  logging.rs              el log local con rotación
.agent/                   configuración de agentes (Claude Code y OpenCode)
docs/updates.md           cómo se publica una versión
docs/escribir-playlists.md el protocolo para crear una playlist, y cómo se supo
```

**Antes de tocar la creación de playlists, lee `docs/escribir-playlists.md`.** Es
el único lugar donde está la receta, y el lugar donde está la lista de lo que ya
se descartó —cuerpo, query, cabeceras, identidad, HTTP/2— para no volver a
recorrerlo. Dos hechos que no están en ningún proto ni en ninguna issue y que
salen de una captura:

- Crear una playlist son **dos escrituras en un orden que importa**: primero
  `POST /playlist/v2/playlist/<id>/changes` con la revisión `0,root` —que crea la
  playlist y le pone el nombre—, y después el `ADD` al rootlist, que no la crea:
  la mete en la biblioteca. Al revés da `400 invalid argument` sobre un cuerpo
  byte a byte idéntico al que el servicio acepta.
- El id lo genera el cliente y **el servicio lo valida**: 22 dígitos de base62
  que no pasen de `2^127`. Se hace con `SpotifyId::from_raw(..).to_base62()`, que
  ya está en la dependencia y lo resuelve bien. Escribirlo a mano al revés fue lo
  que hizo que esto pareciera imposible durante horas.

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
7. **La biblioteca se lee por la sesión, no por la Web API.** Spotify no publica
   protocolo para la Web API, y desde febrero de 2026 una app registrada que la
   use queda limitada a **cinco personas en una lista**: las demás reciben `403`
   en `/me` y ven una biblioteca vacía sin explicación. `spclient` lee todo por la
   sesión de librespot, que ya está autenticada para reproducir. **No vuelvas a
   agregar un client id propio, un refresh token ni una segunda pantalla de
   permisos**: no hay una segunda identidad que pedir, y la única que hay no puede
   leer la biblioteca. Lo que se quita de la app al migrar se quita de verdad —
   `webapi.rs` y `token.rs` no existen, y no hay donde volver.

8. **El asunto de un commit es `tipo(scope):` en inglés; el de una versión es la
   versión sola.** `fix(player): keep stale rows from painting the previous
   playlist`, y `0.4.0` a secas para el commit que sube la versión y para el
   merge a `main`. Los tipos y el alcance están en
   [`CONTRIBUTING.md`](CONTRIBUTING.md#los-mensajes-de-commit--commit-messages); el
   cuerpo es libre y es donde va el porqué, y también va en inglés.
   La regla vive en `.githooks/commit-msg`, la instala `bun run hooks:install` y
   el CI la cobra igual: `--no-verify` la esquiva en esta máquina y no después.
   **El motivo no es la estética:** GitHub titula la corrida de un tag con el
   asunto del commit etiquetado y no con el nombre del workflow, así que un
   asunto de tres líneas es el nombre que queda al lado de cada release.
9. **Never commit or push to `develop` or `main`. Every change comes from its own
   branch, cut from `develop`, and goes back to `develop` through a pull
   request.** The branch is `type/short-description` in English, lowercase and
   kebab-case — `fix/configuration-button`, `feat/playlist-cover-upload` — or
   `release/<version>` for a version bump. `main` only receives `develop`.
   Before the first edit, check the branch with `git branch --show-current`: if
   it is `develop` or `main`, create the branch first. Branch names, commit
   messages, PR titles and descriptions are all written in English; only
   user-facing text lives in two languages, in `lib/i18n.ts`. The full workflow
   is in [`CONTRIBUTING.md`](CONTRIBUTING.md#branches-and-pull-requests);
   `.githooks/pre-push` and the `Branch name` CI job enforce it.

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
- **La puerta de una herramienta de desarrollo es `import.meta.env.DEV`, no la
  rama.** `develop` se mergea a `main` y se publica, así que "sólo en develop" es
  "también en la próxima release". Del lado de Rust el comando se queda en la lista
  de handlers —`generate_handler!` no admite entradas condicionales— pero su
  cuerpo se compila entero adentro de `#[cfg(debug_assertions)]`; en release
  contesta un error. Las dos puertas existen a propósito: la que importa es la que
  compila.

## Trampas que ya pagaron una vez

- **Una pantalla en negro con la sesión conectada no es un bug de la app.** El
  backend sano se ve en el log: la sesión autentica y, después, **no llega ni un
  pedido del frontend** —la biblioteca se lee sola, apenas la puerta se abre—. Si
  el log muestra la sesión conectada y nada más, lo que no arrancó es el
  JavaScript del webview, y la causa de casi siempre es **un Vite viejo quedándose
  con el puerto 1420**: `vite.config.ts` usa `strictPort`, así que el Vite que
  levanta `tauri dev` no entra si hay otro escuchando, y la app termina cargando
  la página del que estaba antes —con el grafo de módulos de hace dos días—. Se
  arregla matando todos los Vite y arrancando de nuevo. La prueba de un vistazo:
  si el log tiene los `la portada de … vino en N direcciones`, el frontend llegó
  a pedir la biblioteca; si no, nunca arrancó.
- **`%APPDATA%\Starless` se borra al cerrar sesión.** `auth::forget_credentials`
  hace `remove_dir_all` sobre todo el directorio. Un ajuste guardado ahí se pierde
  en cada cierre de sesión. Lo que debe sobrevivir un reinicio va a
  `%LOCALAPPDATA%\Starless` — que es también donde vive el log, por el mismo
  motivo.
- **Un fallo al comprobar actualizaciones no se distingue de "no hay".** Cuando
  `latest.json` no se puede bajar —404, red caída, firma inválida— el comprobador
  dice "estás al día". Un fallo silencioso es exactamente lo que hace que un
  actualizador roto parezca uno que funciona. El endpoint **ya no devuelve 404**:
  `releases/latest/download/latest.json` responde 200 apenas hay una release
  *publicada* —un borrador no se sirve—, y tanto el manifest como el `.msi` se
  bajan sin autenticación. Antes de culpar a la cadena, comprobá esa URL.
- **La lista de releases es un índice, y un índice va con retraso.** GitHub publica
  una release en dos pasos: la release existe, y la lista que la apunta se
  actualiza —que no es lo mismo ni al mismo tiempo—. La lista puede ir minutos
  atrás, y el botón de "Buscar prerelease" la usaba: se apretó un minuto después
  de publicar la 0.5.1, la lista todavía describía el mundo anterior, y la app
  dijo que no había prerelease mientras GitHub mostraba una. **Las etiquetas no
  son ese índice**: son las refs, y existen desde que se empuja el tag. El
  camino ahora va por `GET /tags` y pregunta cada etiqueta por su nombre
  (`GET /releases/tags/<tag>`), que es una lectura directa y no una búsqueda.
  Preguntar por nombre cuesta un request por etiqueta; preguntar por la lista
  cuesta uno y a veces miente.
- **Un `Update` del plugin es un handle a un recurso que vive en Rust.** El
  `Update` de JavaScript lleva un `rid`, y el `rid` lo devuelve el backend: sin
  él no hay nada que descargar. Armar un `Update` en el frontend con el JSON del
  manifest no baja la barra de la firma —esa sigue verificándose en Rust contra
  la llave embebida— pero deja un botón de instalar que no instala. Por eso el
  manifest de la prerelease lo apunta `check_prerelease_manifest` en Rust: el
  mismo updater, la misma llave, y lo que vuelve ya es instalable.
- **El manifest de la release no se puede bajar desde el webview, y la API de
  GitHub rechaza la petición si no lleva `User-Agent`.** Son dos motivos
  distintos y los dos dicen lo mismo: la app no encuentra la prerelease y culpa
  a GitHub.
  El primero: `github.com/.../releases/download/<tag>/latest.json` responde 302
  a `release-assets.githubusercontent.com`, y **esa respuesta no trae
  `Access-Control-Allow-Origin`**: el `fetch` del webview moría en CORS antes de
  un byte. La API sí lo trae, y por eso el descubrimiento sí se podía hacer
  desde el navegador — lo que no se podía era bajar el manifest.
  El segundo: `api.github.com` responde **403** a una petición sin
  `User-Agent`, y `reqwest` **no manda ese encabezado solo**: manda exactamente
  los que se le piden. Comprobado contra el socket crudo, sin nada de por medio:
  la misma URL con `curl` responde 200 porque `curl` sí manda el suyo. Un
  cliente sin ese encabezado pregunta algo que se rechaza en la puerta, y el
  cuerpo de la respuesta dice "forbidden" sin explicar por qué.
  Por eso el canal de develop se resuelve **entero en Rust**: las etiquetas, la
  release y el manifest. En Rust no hay CORS y el `User-Agent` se pone.
- **Un force-push rompe el job de mensajes de commit, y no por el mensaje.** El
  job armaba su rango con `github.event.before`, y después de un force-push ese
  commit ya no está en el clon: la rama se reescribió y nadie lo apunta. El job
  lo detectaba y caía en la rama de la punta, pero enseguida después armaba el
  rango otra vez, con la base rota, y `git rev-list` **aborta**. En un runner
  un `abort` es un paso rojo. La base se cambia ahora por la punta cuando no
  está en el clon.
- **La línea pública es una puerta de verdad, y hacen falta dos permisos.** El
  plugin del updater sólo ofrece una versión más vieja si
  `plugins.updater.allowDowngrades` está en `true`, y el instalador sólo la
  instala si `bundle.windows.allowDowngrades` también lo está —que en Tauri
  viene en `true` por default—. Con las dos cosas, "Volver a la 0.5.1" instala
  la 0.5.1; con una sola, el botón promete una cosa y hace otra. Y ni la
  pastilla del botón de Ajustes ni la alerta del arranque lo anuncian: un
  «0.5.1» mientras corres 0.5.3 es una vuelta atrás, no una actualización.
- **El mismo número no es la misma build, y el plugin no lo distingue.** La 0.5.3
  pública y la 0.5.3 de `develop` son dos programas distintos con el mismo
  número, y eso pasa cada vez que una versión sale de `develop` y después se
  publica: el que quedó con la prerelease tiene el número de la pública y nunca
  vio la pública. El plugin, con `allowDowngrades`, compara `update.version !=
  current`: con los números iguales no contesta nada, y la app —que sólo sabe
  comparar números— le dice a esa persona que está al día y le cierra la puerta
  de vuelta a la línea pública. **La comparación la tiene que hacer el frontend,
  que sí sabe en qué línea está**, y por eso el manifest público se pide
  **entero en Rust** con la comparación apagada (`check_public_manifest`), igual
  que el de `develop`. El botón se llama "Instalar la {versión} pública" y no
  "Actualizar": no es una versión más nueva, es otra build.
- **GitHub devuelve 422 si le pasás una etiqueta que el repositorio no tiene**, y
  eso perdería el reporte entero. `report.rs` reintenta sin etiqueta por eso.
- **Dos copias abiertas a la vez se hacen ver como un crash.** El marcador es un
  archivo, no un proceso: la instalada y la de `cargo run` comparten
  `%LOCALAPPDATA%\Starless\session.marker`, así que la segunda que arranca mueve el
  marcador vivo a `last-crash.marker` y declara que la primera murió. Al prólogo
  aparecer, el aviso ofrece mandar el registro a un issue de GitHub — por un crash
  que no existió.
  Y lo peor no es el aviso: dos sesiones de la misma cuenta se pelean las claves de
  audio, y la que pierde le pasa sus bytes a la otra. En vivo, el 17 de octubre:
  `An existing connection was forcibly closed by the remote host` y de ahí a seis
  pistas quemadas en catorce segundos, todas reportadas como canciones que Spotify
  no entregaba. `tauri-plugin-single-instance` lo cierra, y está registrado
  **primero** en el builder, antes que todo lo que puede fallar en `setup`. Si lo
  sacás alguna vez, vuelven juntos el aviso de crash falso y la corrupción de audio.
- **Una pista que no suena no siempre es una pista que no existe.** librespot no
  reconecta solo: su keep-alive marca la sesión inválida y para, con un
  `TODO: Optionally reconnect` donde iría el reconectar. Después de eso toda pista
  falla, y falla de la peor manera: se le pide la clave de descifrado, expira, y en
  vez de negarse **reproduce el archivo sin descifrar** —porque "no todos los
  archivos están cifrados" (`librespot-playback/src/player.rs`). Al decoder le llega
  texto cifrado, lo llama basura, y la pista vuelve como no disponible. Por eso
  `Unavailable` consulta `Session::is_invalid()` antes de declarar nada: sin conexión
  el código es `connection_lost`, se corta la cola y se dice la verdad. **Un
  `track_unavailable` con la sesión inválida es un bug de diagnóstico, no una
  canción rota.**
  La sesión invalidada **no se revive**: `session.shutdown()` la marca para siempre
  y no hay vuelta atrás. La que sobrevive es la credencial, que está en disco. Por
  eso la reconexión de `playback.rs` **arma una sesión nueva** —awaiting
  `Session::connect`, que recién devuelve cuando el transporte está arriba— y le
  pasa el player que ya está corriendo con `Player::set_session`. **No se crea un
  player nuevo**: el player es el dueño del dispositivo de salida, y en Windows dos
  clientes del mismo dispositivo WASAPI se pelean. Y el frontend **no salta de
  canción** ante un error de conexión (`SESSION_ERRORS` en `spotify.ts`): saltar
  quema la cola y pisa el único mensaje que decía la verdad.
- **Una sesión muerta con la cola vacía no falla ninguna pista, y entonces nadie
  pide la sesión de vuelta.** La reconexión de `playback.rs` existe para el caso
  de una pista que *falló* sobre una conexión muerta: el evento `Unavailable` la
  dispara. Pero una sesión que se muere con la cola vacía **nunca produce una
  pista fallada** —la que ya estaba en el buffer termina y no hay nadie que
  pida la siguiente—, así que el evento nunca llega, la reconexión nunca corre,
  y la conexión se queda muerta con una ventana que se ve perfecta. En vivo: la
  sesión cayó a las 19:12, la app siguió con la sesión muerta tres horas, y el
  DJ —que habla por su propio camino, por HTTP— seguía hablando mientras la
  música no volvía. **Un clic es el mismo pedido que hace un fallo**, y es el
  único que puede hacer la persona: `play_track` reconecta y vuelve a poner la
  pista que se pidió. El clic **no se pierde** si llega mientras la reconexión
  está en curso: gana el último pedido (`requested` en el estado). Y el botón de
  reproducir participa: `Player::play` **sólo hace algo desde `Paused` o
  `Loading`**; desde `Stopped` o `EndOfTrack` librespot contesta con un error y
  silencio. Y el player queda en `Stopped` después de que el DJ hable, y en
  `EndOfTrack` después de que una canción termine. Por eso el botón **carga la
  pista de nuevo** en vez de pedirle que siga, y no dice "sonando" cuando no
  suena nada. Para verlo sin esperar a que Spotify tire la conexión:
  `STARLESS_KILL_SESSION=1` la corta a propósito ocho segundos después de abrir
  la app (sólo en debug, como las sondas). Con la sesión muerta, un clic tiene
  que levantar la sesión nueva y poner la canción.
- **Dos `Cache` de librespot sobre el mismo directorio no se pisan**, pero el
  archivo de credenciales se escribe entero (`File::create`): la sesión que se
  acaba de conectar es la única que escribe, y la muerta no vuelve a escribir.
  `credentials.json` es de lectura y escritura sin candado, y eso ya era así antes.
- **El archivo del panic tenía dos nombres.** El panic se renombra a
  `last-panic.crash.txt`, pero `read_panic` y `acknowledge` lo derivaban de
  `crash_marker_path()`, que da `last-crash.crash.txt` — un archivo que **nada
  escribe nunca**. Todos los reportes de crash salían sin el panic, que es
  justamente la falla que el reporte existe para contar. Las dos puntas usan
  `reported_panic_path()`; el test `the_panic_file_has_one_name` lo fija.
  **Si tocas un nombre de archivo acá, toca los tres lugares juntos.**
- **Nada que use `reqwest::blocking` puede correr en un comando `async`.** Un
  cliente bloqueante levanta su propio runtime, y construirlo —o soltar el que se
  creó— dentro de un worker async hace panic. Lo único que hoy habla HTTP con
  `reqwest` es `report.rs`, y vive adentro de `spawn_blocking`. El mismo error pero
  con `token::ensure_fresh` adelante vaciaba la biblioteca una vez por hora: el
  refresh se llamaba **antes** del `spawn_blocking` y sólo fallaba cuando el token
  ya estaba por expirar, o sea sin explicación y sólo de tarde en tarde.
- **`configured` no dice si se puede entrar.** Ese campo pasó de "hay un client id
  compilado" —siempre verdadero— a "hay credenciales guardadas en disco". En una
  máquina que nunca se logueó es **falso**, que es su respuesta normal. El botón
  de conectar llegó a quedar atado a él y quedó apagado para siempre en la única
  pantalla que importa; si lo vuelves a atar, la app deja de poder loguearse en
  cualquier parte donde falte registrarse.
- **Un comando sin `async` corre en el hilo principal.** Por eso `submit_*` son
  `async`: treinta segundos de timeout con la ventana congelada.
- **Nunca escribas `-webkit-backdrop-filter` al lado de `backdrop-filter`.** Es la
  peor trampa del repo porque **se ve bien en `bun run dev` y está roto en la build
  compilada**: Vite sirve el CSS sin minificar, así que ahí las dos propiedades
  llegan y el vidrio se ve perfecto. Pero Tailwind v4 minifica con Lightning CSS, y
  cuando la estándar y la prefijada llevan el mismo valor las colapsa y se queda
  **sólo con la prefijada** — que es justo la mitad que WebView2 ignora. El
  resultado era vidrio sin difuminado: al 55% se leían las canciones de atrás a
  través del panel de Ajustes. El bug vivió semanas sin que nadie tocara el CSS.
  La regla: escribe **sólo** la propiedad estándar y deja que Lightning CSS agregue
  el prefijo él mismo. Si tocas `src/index.css`, comprueba el CSS emitido en
  `dist/assets/*.css`, no el fuente.
- **`track.id` no es una key de React.** Una playlist puede tener la misma canción
  dos veces — en esta cuenta, `Mi playlist n.º 4` contesta 50 items con 46 ids
  distintos — y con dos filas compartiendo key React **no avisa y deja los fibers
  perdedores montados**. No se rompía el render: las filas viejas seguían
  pintando la lista anterior. Abrir LoL después de n.º 4 mostraba cuatro filas de
  n.º 4 arriba de las canciones de LoL, bajo un encabezado que decía "LoL" y un
  conteo que era de LoL. El array estaba bien todo el tiempo; las filas mentían.
  Por eso `trackRowKeys` cuenta ocurrencias: toda key es única y queda estable
  mientras el orden no cambie. **Si tocas una lista de canciones, usa
  `trackRowKeys`, nunca `track.id` pelado.**
- **El limpiado de logs reconoce formas, no personas.** Los patrones adivinan cómo
  se ve un nombre; el nombre de cuenta se quita por valor exacto, porque la
  sesión dice cuál es. Un test lo cubre (`the_account_name_is_removed_even_in_free_text`).
- **`BODY_LIMIT` son bytes, y un byte parte un carácter.** `truncate` cortaba el
  cuerpo en `text[..60_000]` y el log de esta app está lleno de acentos, así que
  el corte caía dentro de un carácter y entraba en panic — y en release eso es
  muerte del proceso, porque el panic del hilo principal se lleva la app
  entera. Alcanzable haciendo clic en "enviar" el reporte de un crash: la
  app se mataba en el camino, con el texto del usuario encima. El test que
  cubría el límite usaba `"linea de relleno"`, **ASCII puro**, y por eso no lo
  veía; ahora hay `cutting_the_body_never_splits_a_character`, con texto acentuado.
- **El release usa `panic = "unwind"`, y no es un descuido.** El hilo de audio de
  librespot abre el dispositivo de salida con un `unwrap()` pelado, así que un
  dispositivo que no está se lleva ese hilo. Con `abort` eso no era "el hilo
  del audio": era la muerte del proceso, y la app entera se caía con el
  headset desenchufado. Con `unwind` el hilo muere, `is_invalid()` lo dice, y la
  app cuenta la verdad: "no se pudo abrir el dispositivo de audio de Windows" —
  un camino que **ya estaba escrito** y que en release era código muerto. Por
  el mismo motivo, el hook de panic **sólo escribe el archivo de crash cuando
  el panic es del hilo principal**: un panic en un hilo de trabajo no se lleva
  la app, y un reporte de crash por eso sería mentira.
- **Un player que no contesta no es un player muerto, y `is_invalid` no lo ve.**
  El sink de rodio de librespot espera al dispositivo de salida **dentro** de
  `write`, en un bucle sin fin: `while self.rodio_sink.len() > 26 { sleep(10ms) }`.
  Si el dispositivo deja de tomar el audio, el hilo del player se queda ahí
  para siempre. No está muerto —`is_invalid` dice vivo, porque el hilo
  corre— pero nunca vuelve al bucle que lee comandos: la app manda un `load`,
  el comando espera en el canal, y no pasa nada. Sin `PlayRequestIdChanged`, sin
  `Loading`, sin `EndOfTrack`, sin posición. La ventana se ve perfecta y la app
  está sorda. **Pasó en vivo el 20 de octubre**: una pista se cortó sola y los
  `play` siguientes no produjeron ningún evento en treinta minutos.
  Por eso `playback.rs` tiene un watchdog que pregunta si la posición sigue
  avanzando, y por eso la recuperación **abandona** el player viejo
  (`std::mem::forget`, nunca `drop`: `Player::drop` hace `join` del hilo y ese
  hilo no vuelve) antes de abrir otro. Para probarlo sin esperar a que un
  dispositivo real se trabe: `STARLESS_STALL_TEST=1` fuerza una recuperación
  veinte segundos después de abrir la app (sólo en debug, como las sondas).
  **Si tocas el player, mira ese watchdog.**
- **`Image` no tiene `width`, y no porque se le olvidó.** El canal que lee la
  biblioteca es `PictureSize`, en `playlist4_external.proto`, y **no tiene campos
  de dimensión**: trae `target_name` y `url`. El modelo declaraba `width: Option`,
  los cuatro sitios de construcción lo llenaban con `None`, y `largestImage`
  ordenaba por ancho — o sea comparaba `0 > 0` y devolvía la primera imagen,
  exactamente lo que su propio comentario decía que no pasaba. El comentario
  tenía razón sobre el riesgo y mentía sobre el código. Para volver a elegir la
  portada grande hay que leer algo que hoy no viaja.
- **El DJ no es una playlist: es una card, y su contenido está en otra puerta.**
  Llega en la biblioteca con dueño `spotify` y **cero canciones** —cero no es un
  conteo, es la señal de que las canciones no están ahí—. `get_playlist` sobre esa
  id devuelve una cáscara vacía: 0 items y 0 meta_items. El mix vive en
  `/lexicon-session-provider/context-resolve/v2/session?contextUri=spotify:playlist:<id>`;
  el `hm://lexicon-session-provider/...` que aparece en la metadata es **el nombre
  interno del servicio**, y lo que va en el host de Spotify es el path sin el
  `hm://`. Sin el prefijo `lexicon-session-provider` da 404, y las siete URIs de
  context adivinadas dieron 400. La sonda es `STARLESS_SP_DJ=1`.
  Tres cosas de esa respuesta que no se ven mirando la lista:
  - **La primera fila es la canción que el DJ introduce, no la narración.** Su id
    resuelve a la canción real —`MetaTrack::get` sobre `42qNWdLKCI41S4uzfamhFM`
    devuelve "Duvet" de bôa— y la narración va **pegada a esa fila** como metadata
    (`narration.intro.*`). Tomar la primera fila como "la narración" es tomarla dos
    veces.
  - **La voz del DJ: la puerta está, y devuelve el audio.** Llega el SSML y los
    parámetros de la mezcla (`tts_provider`, `voice`, `loudness`), no el audio.
    Pero librespot 0.8 trae `spotify.narration.proto` —`tts-resolve.proto` y
    `client-tts.proto`— que **nadie compila y nadie usa**:
    `ClientTtsService.GetTtsUrl(TtsRequest) → TtsResponse{url}`. Y la fila del
    DJ trae **todos** los parámetros que ese request pide, medidos:
    `tts_provider = "SONANTIC_FAST"`, `voice = "VOICE35"`, `sample_rate =
    "44100"`, `loudness = "-16.0"`, `true_peak = "-3.0"` y el SSML; el idioma
    sale del propio SSML (`xml:lang="es-MX"`).
    La puerta es **`POST /client-tts/v1/fulfill` en `spclient.wg.spotify.com`**,
    y lo que se midió de ella:
    - **Pide el token de la cuenta**, no el client token: con el client token
      solo contesta `401`. Con el token de la cuenta contesta `200`.
    - **Exige el cuerpo en protobuf binario**: el mismo pedido en formato texto
      contesta `400`.
    - **Contesta con el audio, no con una URL**: un MP3 de 320 kbps, 44,1 kHz y
      mono. El `TtsResponse{url}` del proto es la forma vieja.
    - **El host va escrito.** El access point regional que resuelve librespot
      (`guc3-spclient.spotify.com`) contesta `303`; el host canónico responde
      `200`. Con `reqwest`, que sigue las redirecciones, se descarga el audio.
    - **`tts.spotify.com` NO es el host.** Existe en DNS —el DNS de Spotify no
      es un wildcard, un nombre inventado no resuelve— y contesta `404` a
      todo, `/client-tts/v1/fulfill` incluido. Se lo descartó midiéndolo.
    - **Un `401` prueba el namespace, no el método.** Sin credenciales, todo
      `/client-tts/v1/**` contesta `401` y todo lo demás `404`. Con
      credenciales, un método que no existe también contesta `404`. Por eso
      los 121 paths medidos antes dieron `404` en todas partes: el método
      estaba mal, no el host.
    **De dónde salió el path:** del binario nativo del cliente de Spotify.
    El `.deb` de Linux (`spotify-client_1.2.95.453`) trae
    `usr/share/spotify/spotify`, 59 MB, que es el mismo core C++ que usa el
    de Windows, y tiene **una sola** string de TTS con forma de path:
    `client-tts/v1/fulfill`. Encaja con la convención `servicio/vN/método` del
    resto del cliente (`storage-resolve/v2/files/audio/`,
    `image-resolve/v1/resolve/map`). El instalador de Windows no se deja
    abrir —`extract` sale con código 33 y borra el MSI que lanza por
    `msiexec`—, y el `dj.spotify.com` es el web player móvil, sin una sola
    string de TTS en 3,4 MB de bundles: la voz del DJ es de las apps nativas.
    La sonda es `STARLESS_SP_VOICE=1`.
  - **La voz se mezcla en la misma salida que la música, y no en otra.**
    El `Sink` de rodio de librespot no deja ver el `Mixer` del stream, y sin
    ese mixer la voz tendría que abrir un segundo stream en el mismo
    dispositivo —y en Windows dos clientes del mismo WASAPI se pelean, y el
    que pierde le pasa sus bytes al otro—. Por eso `voice.rs` trae su propio
    `Sink`: es el mismo `SinkBuilder` —un puntero a función— pero con un sink
    que publica el mixer. La música y la voz salen por el mismo stream.
    **El sink es el que abre el dispositivo de salida**, así que si no se
    puede abrir, el hilo de audio muere y `is_invalid` lo dice: el camino que
    ya existía para nombrar el problema sigue siendo el mismo.
  - **La voz va primero, la música después, y se cortan entre ellas.**
    Cuando el DJ habla, la música se calla: `playback::stop` la corta y el
    frontend arranca la canción cuando el backend avisa que el DJ terminó
    (`dj://voice`). **El `stop` del player deja el sink vaciándose** —lo que ya
    estaba metido sigue sonando un momento—, así que `voice.rs` espera a que
    el sink quede vacío antes de entrar: si no, la frase se pisa con la cola
    de la canción anterior. El aviso va **siempre**, se haya oído la voz o no:
    dejar al frontend esperando sería dejar al DJ mudo.
  - **La voz tiene el volumen del usuario, y se puede cortar.**
    La fuente lee la **misma** atenuación que la música —el mismo
    `Arc<AtomicU64>`—, muestra por muestra: mutear la calla en el medio de la
    frase, no al principio de ella. Y la fuente devuelve `None` cuando una
    bandera compartida está puesta: eso es lo que corta la voz, sea mientras se
    pide el audio o mientras ya está sonando. `play_track` la corta en el
    backend, así que todos los caminos de reproducción la cortan igual.
    **Y el hilo que pide el audio mira la bandera antes de cortar la música:**
    si el usuario ya apretó play —y la música que él puso está sonando—, el
    hilo se va sin tocar el player. Cortarlo ahí sería dejar al DJ mudo y sin
    música.
  - **La frase es de la canción, y se dice antes que ella.**
    Esto se midió: una página del DJ trae **cinco canciones y dos frases**, y
    las frases están en la **primera** y en la **última** —"Vamos ahora a
    entrar en un mood relajado…" y "Así termina este segmento, al ritmo de The
    Weeknd"—. O sea: **la primera abre el tramo y la última lo cierra**, y las
    dos se dicen **antes** de esa canción.
    Por eso la voz **no se pide cuando llega la página**: la página llega dos
    canciones antes de que la cola se vacíe, y pedirla ahí sería hablar
    encima de la canción que está sonando. `dj_mix` y `dj_more` la **guardan
    por canción** en el `DjState`, y el frontend la pide con `dj_speak` en el
    momento en que esa canción va a sonar. La voz se pide por canción y no una
    por página porque una página tiene dos frases y sólo una de las dos es la
    que hay que decir en ese momento.
    Y la frase se dice **una sola vez**: el backend se la lleva cuando la pide.
  - **Las dos frases se dicen, cada una con su canción.**
    El DJ abre el tramo y lo cierra: la frase de apertura cuelga de la primera
    canción de la página y la de cierre de la última, y **las dos se dicen
    antes de su canción**. No es una diferencia de momento sino de frase: la de
    apertura anuncia el tramo —"vamos ahora a entrar en un mood relajado"— y
    la de cierre anuncia su última canción —"con esa melodía de Coldplay
    cerramos este segmento"—, y el verbo de las dos está en presente.
    El texto y la voz son la misma cosa: `narration_of` prueba la de apertura y
    después la de cierre, y `voice_of` hace exactamente lo mismo, así que lo
    que el panel muestra arriba de la cola es lo que el DJ dice. **Una fila con
    las dos frases es una fila que tiene que abrir su tramo**: por eso la
    apertura va primero.
    Y el corte entre dos tramos se oye con una canción de por medio —la de
    cierre, la última del tramo, y la de apertura, la primera del siguiente—:
    esa es la forma del DJ, y no un bug.
  - **El lugar en la cola es un índice, no el id de una canción.**
    El DJ **ofrece la misma canción dos veces** —en su sesión una canción
    puede volver— y decidir "cuál sigue" buscando la que suena por su id
    encuentra **la primera copia**: la que ya sonó. Desde ahí, el siguiente es
    una canción del pasado, y la app salta para atrás. Por eso `App.tsx`
    guarda `queueAt`: el **número** de la canción en la cola. Vive en un estado
    —el panel lo dibuja— y en una referencia —las decisiones la leen en el
    momento, porque dos clics seguidos tienen que caer en dos canciones
    distintas—.
  - **Cada pedido de reproducir lleva un número, y una respuesta tardía no
    toca nada.**
    El `dj_speak` es una promesa: se pide la frase y la respuesta llega
    después. Para entonces el usuario puede haber apretado siguiente, y una
    respuesta vieja —si se aceptara— pondría una canción encima de la que ya
    está sonando. En el log se veía: dos `play` con **19 ms** de diferencia.
    `intent` es ese número: cada pedido lo toma y cada continuación lo
    comprueba antes de hacer algo. Lo mismo con el final de una canción: el
    avance automático sólo responde al final **de la canción que se está
    esperando** (`asked`), porque un final viejo —el de la canción que el
    usuario acaba de saltear— también pondría una encima.
  - **La barra no se bloquea mientras habla el DJ.**
    La barra se apaga cuando no hay nada: `idle` era "no hay canción". Pero con
    el DJ hablando hay algo —la música viene, y la voz es lo más fuerte de la
    sala—, así que el control de volumen y el transporte **no se bloquean**:
    un control que existe y no se puede usar no es un control. Y el botón de
    reproducir, con el DJ hablando, es "**empieza la música**": la frase es de
    la canción que viene, así que cortar la voz y poner esa canción es lo que
    el botón dice. El mismo "siguiente" hace lo mismo.
  - **La barra no sabe el volumen hasta que se lo preguntan.**
    `player://status` se emite cuando el player **hace algo**, y lo primero
    que hace puede ser nunca: el DJ habla por el mixer y el player ni se
    entera. Un frontend que sólo escucha arranca sin estado, y "sin estado"
    se lee como volumen cero —la barra decía "silenciado" con el control en
    el mínimo mientras el DJ hablaba a volumen normal, y sólo la primera vez,
    porque después la música ya había arrancado y el estado existía—.
    Por eso el player **avisa el estado al crearse** y el frontend **lo
    pregunta al montar** (`player_status`), y la respuesta sólo se aplica si
    no llegó ningún evento: una pregunta que tarda no puede pisar una verdad
    más nueva con una más vieja.
  - **El DJ se dibuja en la barra, abajo a la izquierda, y no en otro lugar.**
    El ícono del DJ ocupa el mismo lugar que la portada de la canción —lo que
    suena es lo que se ve— y la frase va en la línea de abajo, con el nombre
    del DJ arriba. Es la barra y no una tarjeta nueva: la app tiene cuatro
    capas flotantes y esa sería una quinta.
  - **La barra se queda callada cuando no suena nada, y lo que llega sube.**
    El rótulo "Nada sonando / Elige una canción de tu biblioteca" se fue: era
    un mensaje sobre un estado que el usuario ve sin que se lo digan —la barra
    vacía, la cola vacía, el contenido vacío— y ocupaba el lugar exacto de la
    portada. Y después se fue **la barra misma**: una barra sin nada que decir
    es un rectángulo de vidrio con un play apagado y dos ceros. Ahora la barra
    **aparece con la música** —fade y 16 px hacia arriba—, y antes de la
    primera canción no hay barra: la ventana es la biblioteca. La regla es
    `present = dj || track || error`, y la calcula `App.tsx` —la app, que es
    la que posee el layout— y la barra la recibe: dos preguntas sobre lo
    mismo tienen una sola respuesta. **El volumen tampoco está antes de que
    suene algo** —es el precio de esta decisión, y es el precio que el
    usuario pidió—.
    Y **la ventana le hace lugar**: el borde inferior del contenido, del riel
    y de la cola no es siempre el mismo. Con la barra en pantalla se detienen
    en 144px, donde la barra arranca; sin ella bajan al inset de 20px de la
    ventana, porque ese espacio es del contenido y una banda de suelo vacío
    abajo de la biblioteca es un agujero, no aire. La barra que llega y el
    contenido que se mueve son un solo movimiento: los dos 300ms.
    Y lo que **sí** llega emerge desde abajo. El bloque de "lo que suena" es un
    `motion.div` con `key={sounding}` dentro de un `AnimatePresence mode="wait"`,
    y entra con `y: 24 → 0`: la canción no aparece en la barra, sube desde el
    borde. **El `key` es lo que hace el cambio** —sin él, motion sólo
    interpolaría el mismo bloque y la canción nueva se pintaría encima de la
    vieja. El `sounding` es `"dj"` mientras habla el DJ y el id de la pista
    cuando suena música, así que el DJ y la canción nunca comparten bloque.
    Y **la salida es la entrada al revés**: una barra que sube con un fundido y
    después se apaga de golpe son dos gestos distintos, y la ventana —que está
    bajando para devolverle el lugar— queda moviéndose por una barra que ya no
    está. La clase `invisible` **espera a que termine el fundido** y no un
    fotograma antes: `visibility: hidden` surte efecto en el mismo fotograma en
    que se aplica, así que una barra que se esconde y se desvanece en el mismo
    aliento no se desvanece: desaparece. Y `pointer-events` se apaga en el
    momento en que la barra empieza a irse, que es lo que la deja de tapar el
    contenido aunque el fundido no haya terminado.
    Por la misma razón, **todo lo que esté anclado al borde inferior de la
    ventana sigue a la barra**: el aviso de "reporte enviado" estaba en
    `bottom-[136px]`, que daba por hecho una barra que siempre estaba, y con la
    barra ausente flotaba a 136 px del piso sobre nada. Ahora toma el mismo
    `bottom-[136px]` o el inset de 20px según esté la barra.
  - **"Reproducido recientemente" no está, y no es un apartado olvidado.**
    El backend no puede reportar qué se escuchó antes, y un encabezado sobre
    una lista vacía es una promesa que la app no puede cumplir: peor que no
    ofrecerlo. El espacio queda libre para lo que sí se puede contar. Cuando
    el backend sepa lo que se escuchó, vuelve —y si vuelve, vuelve con datos.
  - **Una release pública puede llevar dentro una build de `develop`, y la app
    entonces se ofrece a sí misma.** El canal va compilado dentro del binario:
    `STARLESS_CHANNEL` lo decide el workflow según si el commit del tag llegó a
    `main`, y **cambiar la marca de prerelease en GitHub no lo cambia**. La
    release queda en borrador y se publica a mano, así que esa mano puede
    sacarle la marca: la build sigue siendo de `develop` y ahora está en el
    lugar de la línea pública. La app instalada se cree en la línea de
    desarrollo, busca la puerta de vuelta a la línea pública y **se encuentra a
    sí misma**: el botón ofrece "instalar la 0.5.4 pública" y el instalador es
    el mismo binario. El bucle no termina nunca. Medido el 28/10 con la 0.5.4:
    su tag (`3a66d42`) no llegó a `main`, y su binario dice "prerelease" con la
    release marcada como pública. `bun run releases:check` lo dice, porque la
    pregunta "¿el tag llegó a `main`?" es la del paso `canal` del workflow.
    La salida es publicar desde `main`.
  - **La frase del DJ es una sorpresa, y la lista es el spoiler.**
    Con el DJ sonando, el panel de cola **no muestra "A continuación"**: la
    lista de lo que viene es justamente lo que spoils la sorpresa, y la frase
    tiene que ser de surprise. No es sólo durante la frase: es **toda** la
    sesión, porque una estación no tiene "próximo" —el DJ sigue eligiendo, así
    que lo que viene todavía no está decidido, y una lista que lo muestra
    está contando algo que el DJ no dijo—. "Ahora suena" lo ocupa el DJ
    mientras habla —su dibujo, su nombre y lo que dice— y la canción cuando
    arranca. Spotify, para el DJ, no tiene apartado "a continuación".
  - **El botón del DJ es el anillo, en un solo color.**
    La card del DJ es arte y puede ser el azul y el verde del servicio; la
    barra es cromo, y el cromo va en tinta. El botón usa **la misma forma**
    —el anillo de la medusa— en `currentColor`: un cian en la barra sería lo
    más ruidoso de la pantalla. Y el botón hace **lo mismo que la card**: el
    cursor es del backend, así que el DJ pasa a la tanda siguiente en vez de
    arrancar de cero. Aparece **sólo con la sesión del DJ encima** —la barra es
    cromo y no anuncia atajos que no aplican—, y la card de la repisa es cómo
    la sesión arranca.
  - **El DJ abre y cierra cada tramo.** La primera canción del tramo trae
    `narration.intro.*` y la última trae `narration.outro.*`: la de apertura es la
    que se muestra, y la de cierre es la que queda si no hay otra.
  Y una cosa que decide si esto es el DJ o una lista con su nombre:
  - **La primera página y las siguientes no tienen la misma forma.** La primera
    viene como `pages[].tracks`, con su `next_page_url` **adentro** de la página;
    las siguientes traen las canciones **en la raíz**, con el `next_page_url` al
    lado. Es el mismo servicio con dos envelopes, y leer sólo uno de los dos
    convierte una estación en una lista de diez. La primera página trae las canciones
    de varios tramos y el `next_page_url` traducido da la segunda. **Cuántas trae lo
    pone el servicio y cambia**: trece en una sonda, treinta en la app. Por eso el
    tamaño de la página se mira en el log y no en una constante.
  - **El `hm://` se traduce, pero el query no se toca.** En el host de Spotify se
    pide `/lexicon-session-provider/context-resolve/v2/session/0000…?contextUri=…&previousSegmentId=…&requestId=…`:
    los ceros del id y el `previousSegmentId` y el `requestId` son lo que le dice
    al servicio qué segmento se está pidiendo. Sacarles o inventar otros da otra
    cosa o un 404.
  - **El path con los ceros es el que hace que el DJ no se repita, y la forma
    sin ceros es la que lo hace repetir.** Hay dos puertas que parecen la misma:
    `/…/v2/session?contextUri=…` —sin ceros— devuelve la línea de tiempo **desde
    el principio**, y por eso arranca siempre por la misma canción; y
    `/…/v2/session/00000000000000000000000000000000?contextUri=…` —con los
    ceros— devuelve el tramo **de ahora**, y avanza. Medido: cinco pedidos
    seguidos con la forma sin ceros dieron las mismas cuatro primeras
    canciones, y una hora después seguían siendo las mismas (la lista crecía de
    125 a 130, pero la cabeza no se movía); dos pedidos con la forma con ceros,
    con cinco segundos de diferencia, dieron canciones completamente distintas.
    La segunda es la que el servicio usa como "la siguiente": el `next_page_url`
    que devuelve ya viene con esa forma. **La app usaba la primera**: el DJ
    sonaba siempre igual y era un bug, no una rareza del servicio.
  - **El `requestId` es lo que hace que dos pedidos no sean el mismo pedido.**
    El mismo pedido con dos ids distintos dio canciones distintas; con el mismo
    id, las mismas. Se arma con el reloj y un contador (`request_id()`): no
    tiene que ser criptográfico, sólo distinto en cada pedido.
  El predicado de "esto es una card" —dueño `spotify` y cero canciones— vive en
  `src/lib/spotify.ts` (`isDjCard`) y tiene que valer en **los dos** lugares donde
  el DJ aparece: la repisa de Inicio y la barra lateral. Abriéndolo desde la barra
  se veía una pantalla vacía. Y el cursor de la sesión —por dónde sigue— vive en
  el backend (`DjState`), no en el webview: es la dirección interna del servicio.
  - **La card del DJ no tiene portada, y no es que le falte.** La biblioteca no
    manda imagen para las playlists de Spotify, y el relleno por id tampoco la
    encuentra: antes se veía un cuadro vacío, indistinguible de una portada rota.
    La card **se dibuja** (`src/components/DjArtwork.tsx`), con los colores que el
    servicio manda para ella —`narration.jellyfish.top.color` `#19E68C`,
    `.mid.color` `#1ED7BC`, `.bottom.color` `#1E95D7`, y el azul del fondo—, que son
    los del cliente de Spotify. Lo que **no** está es la animación: el Lottie de la
    medusa no existe acá, y la app no finge que existe. Para eso la `MediaCard`
    tiene un hueco propio (`art`): una card puede tener un dibujo en vez de una
    foto, y el dibujo va en el mismo lugar que la foto, debajo del botón.
  - **El tamaño de las páginas del DJ se mira en el log, no en una sonda.**
    `dj_mix` y `dj_more` dejan una línea cada vez —"dj: arrancó una sesión con N
    canciones" y "dj: la estación pidió la página siguiente y recibió M"—, así que
    no hace falta una sonda para saber cuántas trajo cada página ni cuántas veces
    pidió la estación.
- **La puerta del DJ no es la puerta de la radio, y la de la radio estaba
  escondida en la dependencia.** `/lexicon-session-provider/context-resolve/v2/session`
  con `contextUri=spotify:track:…` contesta `500` — y también con un disco, con
  un artista y con una playlist común. Medido: los cuatro contextos dieron `500`
  y el control, la playlist del DJ con la misma forma, contestó bien: es el
  servicio de las "jellyfish cards" y sólo entiende su propio contexto. La radio
  tiene **otra** puerta, y no hubo que inventarla: **`POST /context-resolve/v1/
  autoplay`**, con el cuerpo en protobuf y el proto `AutoplayContextRequest` —
  `context_uri` y `recent_track_uri`—, que está extraído del cliente oficial de
  Windows y ya viene compilado en librespot 0.8
  (`librespot_protocol::autoplay_context_request`). **La metodología de Spotify
  es esa**: el contexto que se escuchaba y las canciones recientes.
  Lo que contesta: **cincuenta canciones parecidas** —no la playlist repetida— y
  un cursor a `radio-apollo`, que es donde sigue la estación
  (`hm://radio-apollo/v5/tracks/spotify:station:playlist:<id>?salt=…&autoplay=true&…`).
  La segunda página trae las canciones **en la raíz** y el `next_page_url` al
  lado, como las del DJ. Y **la semilla no vuelve en la respuesta**: ni la
  canción que sembró la radio ni las recientes, así que no hay que filtrar nada.
  La otra candidate, `/inspiredby-mix/v2/seed_to_playlist/spotify:track:<id>`,
  devuelve una playlist editorial y no la radio: no sirve. La sonda es
  `STARLESS_SP_RADIO=1`.
- **La cola no existe hasta que el usuario la crea.** El panel de cola y la
  estación del DJ son dos preguntas distintas, y el panel las confundía: el "A
  continuación" caía a `visibleTracks` —lo que se ve en pantalla— cuando todavía
  no había sonado nada, así que una app recién abierta mostraba ocho canciones
  bajo un encabezado de cola, y nadie las había pedido. Ahora `upNext` es `[]`
  mientras `queueAt < 0`: hasta que suena algo, el panel dice que no hay nada en
  cola. Y **agregar una canción a la cola ya no convierte la pantalla en cola**:
  `onAddToQueue` agregaba a `visibleTracks`, o sea a lo que se estaba viendo,
  así que una canción agregada a una biblioteca de ocho dejaba ocho canciones
  en la cola —siete de las cuales nadie pidió—. Ahora, si no hay cola, la
  canción agregada *es* la cola.
  Y **la cuenta de la estación es su propia cuenta**: `stationLeft` mide lo que
  le queda de su página al DJ, no lo que el panel muestra. El panel no tiene "A
  continuación" mientras no suena nada, así que pedirle la cuenta a la estación
  hacía que el DJ pidiera una página de más en la ventana en la que todavía no
  se está reproduciendo.
- **El canal de la build es un hecho del build, no una consulta a la red.**
  `STARLESS_CHANNEL` (develop|release) → `__STARLESS_CHANNEL__` (Vite define) →
  `isPrerelease()`. Es la misma pregunta que decide el ícono invertido —¿el tag
  viene de `main`?— así que los dos no pueden contradecirse: una build de
  `develop` trae el ícono de desarrollo y la pastilla "pre-release" al lado de la
  versión en Ajustes; una de `main` no trae ninguna de las dos. Preguntarle a
  GitHub sería peor: la respuesta dependería de que la máquina tenga conexión,
  y el canal no cambia con la red.
- **`API_ERRORS` está en español y fuera de `i18n.ts`.** Veinte mensajes de error
  de usuario en un solo idioma, en el archivo que la regla 5 excluye. Los dos
  códigos que Rust emite y que no estaban en el mapa —`no_session` y `bad_id`—
  se agregaron con el trabajo de playlists, así que ya no se muestran crudos;
  lo que queda es que `explain()` no sabe el idioma. Es deuda conocida, está
  anotada en el skill; cuando la toques, el movimiento natural es llevarla a
  `i18n.ts` con sus dos idiomas.
- **Un panel flotante no es de la fila que tapa, aunque el portal lo haga hijo
  de ella.** `MenuPanel` se dibuja con `createPortal` al `body`, pero en el
  árbol de **React** sigue siendo hijo de la fila de la canción, y los eventos
  de React viajan ese árbol: un clic en "Agregar a la playlist" llegaba al
  `onClick` de la fila y **reproducía la canción**. Un panel tiene que ser una
  hoja —`onClick` con `stopPropagation` en su raíz— y ese es el precio de
  flotar sobre algo clickeable.
  Y al revés: el submenú es un **hermano** del panel que lo abrió, no un hijo,
  así que "¿esta pulsación está dentro de un panel?" no se responde con
  `contains` sino con **`event.composedPath()`**, que dice qué elementos cruzó
  la pulsación. La primera versión usaba un conjunto de nodos que cada panel
  anunciaba con un efecto, y fallaba en silencio: el panel no está en el
  documento hasta que ha sido medido, así que el efecto corría antes de que
  hubiera algo que anunciar y no volvía a correr — y **toda pulsación cerraba
  el menú**, incluso el clic en el buscador de "Buscar una playlist".
- **La barra de arriba es zona de arrastre.** Con `decorations: false` no hay
  título del sistema, así que la ventana se mueve desde ahí y los controles
  llevan `data-tauri-drag-region="false"`.
- **`.agent/` es la copia canónica** de la configuración de agentes. Los shims de
  `.claude/` y `.opencode/` que apuntaban ahí se borraron; para recuperar el
  skill en esas herramientas, `git revert 96cf93c`.

## Antes de abrir un PR

`bun run lint`, `bun run typecheck`, `bun run version`, `cargo check` y
`cargo test --lib`. Si tocas UI, antes y después en captura: el diseño se juzga a
ojo, no leyendo el diff.

El detalle de cada puerta —qué atrapa y qué **no** atrapa— está en
[`reference/verificar.md`](.agent/skills/starless/reference/verificar.md). Lo
importante: `cargo check` **no detecta código muerto**, porque todo en el crate
es `pub`, así que un comando sin llamadores pasa los dos perfiles sin un solo
warning. Para eso hay que buscar el lado de adentro en el lado de afuera.