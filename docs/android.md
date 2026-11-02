# Android

Cómo llevar Starless a un teléfono Android, qué del código actual se rompe en
el camino, y qué hay que medir antes de prometerlo.

**Nada de esto está medido en un teléfono todavía.** Lo que sigue se sacó de
leer el código de este repositorio y el de sus dependencias —las versiones
exactas del `Cargo.lock`—, no de correrlo. Cada afirmación lleva el archivo y la
línea de donde sale, para que se pueda comprobar sin creerle a este documento.
Lo que se mida se escribe acá con su fecha y su resultado, como en
`docs/jam.md`, y lo que se descarte se queda escrito con el porqué.

En corto:

| | |
| --- | --- |
| Dónde vive | en este repositorio: Tauri 2 compila el mismo backend y el mismo frontend para Android |
| Estado | investigación, sin versión (`ROADMAP.md`, «Sin fecha — Investigar primero») |
| Lo que ya está listo | `crate-type` con `cdylib` y `staticlib`, `#[cfg_attr(mobile, tauri::mobile_entry_point)]` en `run()`, el `host` de Vite para `TAURI_DEV_HOST`, y los stubs fuera de Windows de `media_keys.rs` y `startup.rs` |
| Lo que no compila | cuatro cosas: la bandeja, `bring_to_front`, el plugin de instancia única y OpenSSL (ver [Lo que no compila](#lo-que-no-compila)) |
| Lo que compila y no anda | cinco cosas, y tres de ellas impiden escuchar una sola canción (ver [Lo que compila y no anda](#lo-que-compila-y-no-anda)) |
| Lo que decide si se sigue | login, una canción y una frase del DJ sonando en un teléfono real |
| iOS | después, y sólo por instalación lateral: la App Store no acepta un cliente no oficial |

## Por qué en el mismo repositorio

Lo que tiene valor en Starless es lo compartido: la capa sobre librespot,
`spclient`, el DJ, la radio, el crossfade, y las trampas de `AGENTS.md` que ya
se pagaron. Un repositorio aparte obligaría a portar a mano cada arreglo de la
sesión o del player, y uno de los dos terminaría atrasado sin que nadie lo note.

Lo que cambia entre plataformas se separa **por compilación**, no por carpeta ni
por rama: es la regla que ya tienen las herramientas de desarrollo. La puerta
que importa es la que compila. En Rust eso es `#[cfg(desktop)]` /
`#[cfg(mobile)]` —los dos los define `tauri-build`— y `#[cfg(windows)]` para lo
que es de Windows y no del escritorio en general.

## Lo que no compila

Cuatro cosas cortan `cargo build --target aarch64-linux-android`. Las tres
primeras son del crate; la cuarta es del árbol de dependencias.

### 1. La bandeja: `tray.rs` y sus llamadores

`tray.rs:22-23` importa `tauri::menu` y `tauri::tray`. En Tauri 2.12.4 los dos
módulos están cerrados a escritorio: `menu` con `#[cfg(desktop)]` y `tray` con
`#[cfg(all(desktop, feature = "tray-icon"))]` (`tauri/src/lib.rs:110-123`).
Prender la feature `tray-icon` en `Cargo.toml` no alcanza: en Android el módulo
no existe.

Los llamadores que hay que cubrir, todos en `lib.rs`:

| Línea | Qué | Qué hace en Android |
| --- | --- | --- |
| `1943-1952` | `on_window_event` → `tray::exists` | no hay botón de cerrar; el bloque entero es de escritorio |
| `2018-2024` | `tray::install` y `startup::launched_minimized` | no hay bandeja ni arranque con el sistema |
| `1713` | `media_session` → `tray::set_playing` | la tarjeta de medios sigue; la línea de la bandeja no |
| `1718-1721` | el comando `tray_labels` y el tipo `tray::TrayLabels` | el comando queda en `generate_handler!` (no admite entradas condicionales) |

La forma es la que ya usan `media_keys.rs:187` y `startup.rs:65`: un `mod imp`
real y un stub con la misma firma. Así `lib.rs` no cambia, y `tray_labels`
recibe el mismo tipo en las dos plataformas.

### 2. `bring_to_front` (`lib.rs:796-802`)

Llama a `unminimize()`, y en Tauri 2.12.4 ese método vive en un
`impl` con `#[cfg(desktop)]` (`tauri/src/webview/webview_window.rs:2031-2103`).
`show()` y `set_focus()` sí existen en móvil (`webview_window.rs:2316` en
adelante). Tiene dos llamadores: la segunda instancia (`lib.rs:1933`) y el
callback del login (`lib.rs:819`). En Android el sistema es el que trae la app
al frente cuando el navegador la devuelve, así que la función es un no-op ahí.

### 3. `tauri-plugin-single-instance` (`lib.rs:1931`)

El crate 2.5.4 empieza con `#![cfg(not(any(target_os = "android", target_os = "ios")))]`
(`src/lib.rs:16`): en Android compila **vacío**, y `init` no existe. La
dependencia puede quedarse; la llamada va detrás de `#[cfg(desktop)]`. Android ya
garantiza un proceso por paquete, así que lo que el plugin protege —dos sesiones
de la misma cuenta en la misma máquina, la trampa de `AGENTS.md`— no puede pasar
dentro del teléfono. Entre dos máquinas sí: ver
[El id del dispositivo](#el-id-del-dispositivo).

### 4. OpenSSL

El árbol entero habla TLS con `native-tls`, y `native-tls` en Android es
OpenSSL:

- `reqwest = { version = "0.12", features = ["blocking", "json"] }`
  (`Cargo.toml`) trae las features por defecto, que son `default-tls` =
  `native-tls`.
- `librespot-core 0.8.0` tiene `default = ["native-tls"]`
  (`librespot-core/Cargo.toml:31`), y `librespot-oauth` y `tokio-tungstenite`
  lo siguen.

En Windows `native-tls` es schannel y en macOS es Security.framework; en
Android cae en `openssl-sys`, que busca una OpenSSL compilada para
`aarch64-linux-android` y no la encuentra. Dos salidas, a decidir con la prueba
de concepto:

| Opción | Costo |
| --- | --- |
| `openssl` con la feature `vendored` sólo para Android | compila OpenSSL desde el código fuente con el NDK: necesita `perl` y suma minutos a cada build limpia |
| librespot con `default-features = false` y `rustls-tls-webpki-roots`, y `reqwest` con `rustls-tls` | sin C de por medio; pero cambia la pila TLS **también en Windows** si no se separa por target |

Separarlo por target es posible: con el resolver de la edición 2024 las
features de una dependencia de `[target.'cfg(...)'.dependencies]` sólo se
activan cuando se compila para ese target. Eso exige declarar las librespot sin
features por defecto en la sección común y agregar `native-tls` en la de
escritorio y `rustls-tls-webpki-roots` en la de Android. Las raíces van
`webpki` y no `native-roots`: `rustls-native-certs` busca el almacén del
sistema por las rutas de OpenSSL, y no es un camino probado en Android; las
raíces de `webpki` van compiladas en el binario y no dependen del teléfono.

## Lo que compila y no anda

Estas cinco pasan `cargo build` y fallan en el teléfono. Las tres primeras
impiden escuchar una canción; ninguna da un error que diga lo que pasó.

### 1. El navegador del login no se abre

`auth.rs:274-275` arma el `OAuthClientBuilder` con `.open_in_browser()`. En
`librespot-oauth 0.8.0` eso termina en `open::that_in_background(auth_url)`
(`src/lib.rs:251`), y el crate `open 5.4.4` trata a Android como un Unix más
(`src/lib.rs:120`): prueba `xdg-open`, `gio`, `gnome-open` y `kde-open`
(`src/unix.rs:34-48`). En Android no existe ninguno. Como es *in background*, el
fallo se pierde en un hilo: la URL sólo se imprime por stdout (`println!`,
`src/lib.rs:253`), y en Android stdout no va a ningún lado.

Y el login no termina nunca: `get_authcode_listener` hace
`listener.incoming().next()` sin timeout (`src/lib.rs:182-185`), así que
`begin_login` queda bloqueado en un `spawn_blocking` para siempre, con el puerto
8989 tomado. Un segundo intento falla al hacer `bind`
(`AuthCodeListenerBind`).

`librespot-oauth` no deja sacar la URL sin abrirla: `set_auth_url` es privado y
`should_open_url` sólo decide si llama a `open`. Las salidas son armar el PKCE
en `auth.rs` —`oauth2` ya está en el árbol por `librespot-oauth`— y abrir la URL
con `tauri-plugin-opener`, que en Android lanza un `Intent`; o hacerle un parche
a `librespot-oauth` que exponga la URL. La primera no toca dependencias.

**Lo que queda por medir:** que el callback a `http://127.0.0.1:8989/login`
llegue. El navegador corre en otro proceso del mismo teléfono, así que el
loopback es el mismo; lo que no se sabe es si Android deja vivo el proceso de
Starless —y su `TcpListener`— mientras la persona escribe la contraseña. El
redirect **no se puede cambiar**: es el registrado para el client id compartido
(`auth.rs:44-52`).

### 2. No hay dónde guardar nada

Todos los archivos de la app salen del crate `dirs 6.0.0`:

| Qué | Dónde | Función |
| --- | --- | --- |
| las credenciales de librespot | `auth.rs:93-97` | `dirs::data_dir()` |
| los ajustes | `settings.rs:28` | `dirs::data_local_dir()` |
| el log | `logging.rs:34` | `dirs::data_local_dir()` |
| el historial | `history.rs:38` | `dirs::data_local_dir()` |
| los marcadores de crash y el panic | `report.rs:61` | `dirs::data_local_dir()` |
| la imagen de fondo | `background.rs:23-25` | la carpeta de `settings.rs:28`, o sea `dirs::data_local_dir()` |

`dirs` no tiene implementación para Android: cae en la de Linux (`src/lib.rs:33-43`
excluye sólo Windows, macOS, iOS y wasm), que responde
`$XDG_DATA_HOME` o `$HOME/.local/share` (`src/lin.rs:11-12`). Y `home_dir` no
tiene respaldo en Android: sin `$HOME` devuelve `None`
(`dirs-sys 0.5.0`, `src/lib.rs:39-42`). Las dos respuestas posibles son malas:
`None`, o una ruta fuera del sandbox de la app en la que no se puede escribir.

Lo que pasa con cada una:

- **Las credenciales:** `cache_dir()` devuelve `no_data_dir` y
  `open_cache()` falla. **No se puede iniciar sesión.**
- **Los ajustes, el log y el historial:** devuelven `None` y la app sigue sin
  ellos, en silencio. Nada se recuerda entre aperturas.
- **La imagen de fondo:** `background_image` contesta un cuerpo vacío, que es su
  respuesta normal cuando no hay imagen, y `set_background_image` devuelve
  `command_failed` (`background.rs:74`): un código que no dice que falta la
  carpeta.
- **El crash:** sin carpeta no hay marcador, así que el crash tampoco se ve.

La ruta correcta en Android es la del sandbox, y Tauri la da:
`app.path().app_data_dir()` y `app.path().app_local_data_dir()`. El costo es
que esas funciones piden un `AppHandle` y las de hoy no reciben ninguno. La
forma más chica es resolver la base **una vez** en `setup`, guardarla en un
`OnceLock<PathBuf>`, y que las cinco funciones la lean de ahí; en escritorio la
base sigue saliendo de `dirs`, para no mover los archivos de nadie.

Ojo con la separación que `AGENTS.md` defiende: `forget_credentials`
(`auth.rs:326-329`) hace `remove_dir_all` sobre la carpeta de las credenciales,
así que las credenciales y los ajustes **no pueden** quedar en la misma carpeta
en Android tampoco. Sin medir si `app_data_dir` y `app_local_data_dir` dan la
misma ruta en Android; por las dudas, las credenciales van en una subcarpeta
propia y nada más vive adentro de ella.

### 3. Toda canción falla, y el error dice que la canción no existe

`SessionConfig::default()` pone `tmp_dir: std::env::temp_dir()`
(`librespot-core 0.8.0`, `src/config.rs:49`), y `auth.rs:161-166` no lo cambia.
La documentación de `std::env::temp_dir` lo dice: en Android no hay una carpeta
temporal global y devuelve `/data/local/tmp`, donde una app no puede escribir.
`librespot-audio` descarga cada pista en un
`NamedTempFile::new_in(session.config().tmp_dir)` (`src/fetch/mod.rs:526`), así
que **cada carga falla**.

Y falla con la forma que `AGENTS.md` ya describe: la pista vuelve como no
disponible, `Session::is_invalid()` dice que la sesión está viva, y la app
informa `track_unavailable`. El arreglo es una línea en `session_config`:
`config.tmp_dir` apuntando a `app.path().app_cache_dir()`. Va por el mismo
`OnceLock` del punto anterior.

### 4. Cada apertura parece un crash

El marcador de sesión se borra en `RunEvent::Exit` (`lib.rs:2204-2208`). En
Android el sistema mata el proceso cuando quiere —al deslizar la app de las
recientes, por memoria— y `Exit` no llega. El marcador sobrevive, y la apertura
siguiente ofrece mandar un reporte por un crash que no existió: la misma
mentira que `AGENTS.md` cuenta de las dos copias abiertas.

Y al revés: el hook de panic sólo escribe el archivo cuando el hilo se llama
`"main"` (`report.rs:213`). En Android el hilo del event loop lo crea la JVM y
se adjunta a Rust por JNI, así que su nombre no es `"main"`. **Sin medir**, pero
si es así, un crash de verdad no deja reporte.

En Android la pregunta "¿terminó bien?" no se responde con un marcador de
salida. Hasta que haya otra forma, el reporte de crash va apagado en móvil.

### 5. El updater dice "estás al día"

El plugin del updater compila en móvil, pero no instala: `install_inner`
devuelve `Error::UnsupportedOs` (`tauri-plugin-updater 2.14.0`,
`src/updater.rs:944-947`). Antes de llegar ahí, `check()` lee el `latest.json`
de la release, que sólo trae la plataforma de Windows; sin la de Android no hay
actualización que ofrecer, y la app hace lo que `AGENTS.md` ya advierte: un
fallo al comprobar se ve igual que "no hay".

En Android el updater no se registra: el plugin va detrás de `#[cfg(desktop)]`,
`check_prerelease_manifest` y `check_public_manifest` (`lib.rs:432` y `513`)
contestan un error en móvil, y el frontend no llama a `checkForUpdate`
(`App.tsx:1890`, `SettingsPanel.tsx:407`) ni muestra `UpdateAlert`
(`App.tsx:3038`).

**Y la vuelta a la línea pública no existe en Android.** El instalador del
sistema rechaza un `versionCode` menor que el instalado, así que "Volver a la
0.5.1" no se puede hacer sin desinstalar, y desinstalar borra los datos de la
app, credenciales incluidas.

## La identidad: lo que Spotify ve distinto

librespot no se presenta igual en Android, y eso cambia las condiciones en las
que se midió **todo** lo de `docs/jam.md`, `docs/escribir-playlists.md` y las
trampas del DJ y la radio. Todo eso se midió desde Windows.

| Dónde | Windows | Android |
| --- | --- | --- |
| client id del `clienttoken` (`librespot-core/src/spclient.rs:187-190`) | el de la sesión (el de nCspot) | `ANDROID_CLIENT_ID` de librespot, con un desafío hashcash (`src/config.rs:38`, `spclient.rs:181-185`) |
| datos de plataforma del `clienttoken` (`spclient.rs:232-238`) | `desktop_windows` | `android`: "Pixel", "GF5KQ", "Google", API 31 |
| client id de `login5` (`src/login5.rs:76-83`) | el de la sesión, siempre | el de la sesión sólo para `StoredCredential`; para el resto, `ANDROID_CLIENT_ID` |
| plataforma del handshake (`src/connection/handshake.rs:122-127`) | Windows | **Linux ARM**: librespot se hace pasar por Linux porque con Android todos los access points contestan `TryAnotherAP` |
| sistema del login (`src/connection/mod.rs:118-119`) | `OS_WINDOWS` | `OS_ANDROID` |

El comentario de `auth.rs:135-160` explica por qué el client id de `login5`
tiene que ser el del token. En Android esa regla se cumple sola para la sesión
restaurada (`StoredCredential`), que es la que usa `spclient`.

**Lo que hay que volver a medir desde el teléfono**, porque el `client-token`
ya no es el mismo: la biblioteca (`spclient`), la voz del DJ
(`client-tts/v1/fulfill`), el DJ (`lexicon-session-provider`), la radio
(`context-resolve/v1/autoplay`), el jam (`social-connect`) y las escrituras de
playlists. Las sondas existen y ya son de debug (`STARLESS_SP_*`); lo que
cambia es que en Android no hay variables de entorno a mano (ver
[Desarrollo](#desarrollo)).

### El id del dispositivo

`auth.rs:164` fija `config.device_id = "Starless"` para que Spotify no liste un
dispositivo nuevo en cada apertura. Con el teléfono y la computadora en la misma
cuenta, **los dos dicen ser el mismo dispositivo**. Sin medir qué hace Spotify
con eso; lo prudente es un id por plataforma (`"Starless"` y
`"Starless Android"`). El jam lo usa en la ruta de los comandos
(`spclient.rs:2464`), así que el cambio llega hasta ahí.

## El audio

En papel, el camino es el mismo: librespot → el `Sink` de `voice.rs` → `rodio
0.21` → `cpal 0.16`, que en Android habla AAudio. La regla 1 de `AGENTS.md` —el
audio no pasa por la webview— se cumple igual en el teléfono.

Lo que dice el código de `cpal 0.16.0` (`src/host/aaudio/`):

- **El dispositivo por defecto siempre existe:** `default_output_device()`
  devuelve `Some(Device(None))` (`mod.rs:86-88`). El `None` de
  `voice.rs:254` no se da.
- **La configuración pide JNI.** `default_supported_configs` calcula el buffer
  mínimo con `AudioTrack.getMinBufferSize` por JNI, a través de
  `ndk_context::android_context()` (`android_media.rs:18`). Si el contexto no
  está inicializado cuando `voice.rs:269` pide la configuración, es un panic en
  el hilo del audio. **Sin medir** si Tauri lo inicializa antes de `setup`.
- **44,1 kHz está en la lista** (`mod.rs:36`), así que `voice.rs:281` debería
  conseguir la frecuencia de librespot sin remuestrear.

Lo que no se sabe y hay que medir:

- **El cambio de ruta.** En Android, conectar o desconectar auriculares
  Bluetooth puede desconectar el stream de AAudio. `cpal` lo reporta por el
  callback de error; `rodio` lo loguea y el stream queda muerto. El watchdog de
  `playback.rs:378` ve que la posición no avanza y abre un player nuevo, pero
  `voice.rs:321` publica la salida **una sola vez** (`OUTPUT.set` sobre el
  `OnceLock` de `voice.rs:51`): el sink nuevo no reemplaza el mixer que usa la voz del DJ. Es
  así también en Windows; en Android se vuelve el caso común.
- **El segundo plano.** Android suspende un proceso en segundo plano salvo que
  tenga un servicio en primer plano de tipo `mediaPlayback`, con su
  notificación. Sin eso, la música se corta a los pocos minutos de bloquear la
  pantalla. Tauri no trae ese servicio: va en Kotlin, como un plugin.
- **Las teclas y la tarjeta de medios.** En Windows son `media_keys.rs`; en
  Android son una `MediaSession`. El comando `media_session` (`lib.rs:1707-1715`)
  ya manda todo lo que la tarjeta necesita (`NowPlaying`), así que el plugin de
  Kotlin es otro `imp` de `media_keys.rs`, no un comando nuevo.

## El frontend

El frontend compila igual; lo que no anda es la forma de usarlo.

| Qué | Dónde | Qué pasa en Android |
| --- | --- | --- |
| botones de minimizar, maximizar y cerrar | `WindowControls.tsx:66-77`, y el estado de maximizado en `32-45` (`isMaximized` y `onResized`) | no hay ventana que manejar; se ocultan |
| zonas de arrastre | 8 `data-tauri-drag-region` | no hacen nada; no estorban |
| controles que aparecen al pasar el mouse | 11 `group-hover:opacity` / `group-hover:visible` en `HomeScreen`, `NumberedTrackList` (3), `PlaylistDetailsDialog`, `PlaylistTrackList` (3), `QueuePanel`, `TrackList` y `TrackMenu` | **no hay hover**: el menú de una canción y los botones de la fila no se pueden alcanzar |
| `CursorGlow` | `CursorGlow.tsx` | sigue al mouse; en táctil no tiene a quién seguir |
| "Iniciar con Windows" y "seguir en la bandeja" | `SettingsPanel.tsx:1168` (la lectura) y `1201-1209` (las filas) | se ocultan; sus textos en `i18n.ts:348-352` y `802-806` se quedan para escritorio |
| la alerta y el botón de actualizar | `App.tsx:1844`, `App.tsx:2974`, `SettingsPanel.tsx:363` | se ocultan (ver el punto 5 de arriba) |
| `usePlayerKeys` | `lib/usePlayerKeys.ts` | se queda: un teclado Bluetooth existe |
| abrir el issue de un reporte | `CrashPrompt.tsx`, `FeedbackPanel.tsx` | `plugin-opener` funciona en Android |

La plataforma se decide **al arrancar y no por ancho**: una ventana de
escritorio angosta no es un teléfono. `@tauri-apps/plugin-os` da la respuesta,
pero es una dependencia más; un `define` de Vite, como `__STARLESS_CHANNEL__`
(`vite.config.ts`), lo resuelve sin dependencia, porque la plataforma es un hecho
del build igual que el canal.

El layout de escritorio —1180×760, con mínimo de 768×600
(`tauri.conf.json`)— no entra en un teléfono. El diseño del layout móvil se
decide en `DESIGN.md`, no acá.

## La configuración

- **`capabilities/default.json`** pide `updater:default` y los permisos de
  ventana. Si el updater no se registra en Android, el permiso apunta a un
  plugin que no existe y la build falla. Las capabilities de Tauri aceptan
  `"platforms"`: una de escritorio con el updater y la ventana, y una común con
  `core:default` y `opener:default`.
- **El `identifier` es el nombre del paquete de Android, y es para siempre.**
  Hoy es `app.starless.desktop` (`tauri.conf.json`). Es un nombre de paquete
  válido, pero dice "desktop". Un `tauri.android.conf.json` lo puede
  sobrescribir sólo para Android; lo que no se puede es cambiarlo después de
  publicar el primer APK: otro nombre es otra app, y quien la tenga instalada no
  recibe la actualización.
- **La versión no cambia de lugar.** Tauri deriva el `versionCode` de Android de
  la versión de `tauri.conf.json`, así que `scripts/version.ts` sigue siendo la
  única fuente y no hay un cuarto manifiesto.
- **Los íconos.** `scripts/logo.ts` escribe `icons/` e `icons-dev/`. Android
  los quiere como mipmaps dentro de `gen/android/app/src/main/res/`, y la
  distinción entre el ícono de desarrollo y el de la release (`AGENTS.md`)
  también vale en el teléfono: dos copias en el mismo teléfono con el mismo
  ícono son el mismo problema que en Windows.
- **`gen/android/` se commitea.** Lo genera `tauri android init`; hoy
  `src-tauri/.gitignore` sólo ignora `/gen/schemas`, que es lo correcto.

## Desarrollo

- **El comando.** `bun run tauri android dev`. Tauri le pasa la IP de la
  máquina a Vite por `TAURI_DEV_HOST`, y `vite.config.ts` ya la lee (`host` y el
  `hmr` en el puerto 1421). El teléfono carga el frontend por la red local, así
  que la trampa del Vite viejo en el puerto 1420 (`AGENTS.md`) aplica igual.
- **Las sondas.** Todas se prenden con variables de entorno
  (`STARLESS_SP_*`, `STARLESS_KILL_SESSION`, `STARLESS_STALL_TEST`), y una app
  de Android no recibe el entorno de quien la lanza. Para medir desde el
  teléfono hace falta otra puerta: una propiedad de sistema que se lee con
  `getprop` (`adb shell setprop debug.starless.probe ...`), también detrás de
  `#[cfg(debug_assertions)]`.
- **El log.** `logging.rs` escribe a un archivo y a stderr; en Android stderr no
  llega a `logcat`. Hasta que haya un logger de Android, el log sólo existe en
  el archivo, y eso depende del punto 2 de arriba.
- **Requisitos:** Android SDK, NDK, JDK 17, y los targets de Rust
  (`rustup target add aarch64-linux-android armv7-linux-androideabi
  i686-linux-android x86_64-linux-android`). El emulador sirve para que
  compile; el login y el audio se miden en un teléfono.

## La distribución

Google Play casi seguro rechaza un cliente no oficial, así que el APK se
publica en las releases de GitHub, junto al `.msi`. El workflow de release corre
en `windows-latest`; el APK necesita un job propio en Linux, con el SDK, el NDK y
el keystore como secreto del repositorio.

**El keystore de firma es para siempre.** Si se pierde, ningún teléfono acepta
la versión siguiente como actualización de la anterior. Se guarda y se
documenta con el mismo cuidado que la `pubkey` del updater.

## El orden

La prueba de concepto es una sola rama, `feat/android-proof-of-concept`, y
termina cuando suena una canción en un teléfono:

1. Lo que no compila: la bandeja y `bring_to_front` detrás de `cfg`, el plugin
   de instancia única y el updater sólo en escritorio, la capability partida, y
   la pila TLS.
2. Las rutas: la base de las carpetas en un `OnceLock` resuelto en `setup`, y
   `tmp_dir` en `session_config`.
3. El login: el PKCE con la URL abierta por `tauri-plugin-opener`.
4. Medir: login, una canción, una frase del DJ, y las sondas de `spclient` con
   la identidad de Android.

Lo que queda para después de la prueba, y sólo si pasa: el servicio en primer
plano y la `MediaSession` en Kotlin, el reporte de crash en móvil, el layout,
la CI del APK, y la decisión en `PRODUCT.md` y `DESIGN.md`.
