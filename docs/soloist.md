# Soloist: la salida de emergencia para las cuentas sin claves

Plan, no implementación. Escrito el 7 de noviembre de 2026, después de la issue
#104. Lo que dice "medido" se midió; lo que dice "hay que medir" todavía no.

## Por qué existe

Hay cuentas Premium a las que Spotify les niega las claves de audio por el canal
que usa librespot (`error audio key 0 1`). Se midió con `STARLESS_SP_KEYS=1`:
**0 de 20** claves, en los cuatro formatos de cinco canciones (ver la trampa en
`AGENTS.md`). Para esas cuentas Starless no suena, y no hay arreglo del lado de
librespot (librespot #1649).

**Spotify Soloist** es el reproductor sin ventana que Spotify publica para
desarrolladores (agosto de 2026): un ejecutable nativo que aparece como un
dispositivo de Spotify Connect y que sí recibe las claves, porque es de Spotify.
Spotifast lo integró en la 0.15.0 (31 de octubre) como respaldo para el mismo
error, y un tester midió unos **50 MB** de memoria, contra unos 800 MB del
cliente oficial.

**Es una salida de emergencia, no un modo.** Quien recibe las claves sigue
exactamente como hoy y nunca ve nada de esto. Sólo se le ofrece a la cuenta a la
que Spotify le niega las claves.

## Lo que Soloist da y lo que no (de la documentación oficial)

- **Descarga:** `https://soloist-builds.spotifycdn.com/soloist_release_windows_x86_64.zip`
  (también Linux x86_64/arm64/arm32 y macOS Apple Silicon; **no hay Windows ARM
  ni Mac Intel**). No hay manifest de versiones: la versión se lee con
  `soloist.exe --version`. **No se redistribuye**: la app lo baja de Spotify
  cuando la persona lo pide, nunca va en el instalador.
- **Caduca a los 90 días** de su fecha de build. Una build vencida sale con
  **código 10**.
- **Arranque:** `soloist.exe -n <nombre> -k <api-key> -D <data-dir> -C <cache-dir> -w 127.0.0.1:0`.
  Con puerto `0` el sistema elige uno libre y Soloist lo escribe en `ws.addr` y
  `ws.port` dentro del data-dir.
- **Clave:** cada persona genera la suya en `developer.spotify.com/dashboard/soloist`,
  con una cuenta Premium. Se pasa en **cada** arranque. La documentación pide no
  compartirla ni embeberla.
- **Emparejado:** sin navegador ni contraseña. Con Soloist corriendo, se elige el
  dispositivo **desde una app oficial de Spotify en la misma red** (el celular o
  el reproductor web). La sesión queda guardada en el data-dir y sobrevive a los
  reinicios. **Spotifast intentó emparejarlo con el token de OAuth de librespot y
  Spotify lo rechazó**: el paso manual no se puede saltar hoy.
- **Control:** una API WebSocket local en JSON. Comandos: `play` (con `uri`
  opcional: canción, disco o playlist), `pause`, `skip_next`, `skip_prev`,
  `seek`, `set_volume`, `set_shuffle`, `set_repeat_*`, `add_to_queue` (sólo
  canciones), `activate`, `deactivate`, `get_state`, `get_queue`,
  `get_auth_state`. Eventos: `auth_state`, `playback_state`, `track_changed`,
  `playback_changed`, `volume_changed`, `position_sync`, `queue_changed`,
  `error`. **No hay evento de fin de canción ni de emparejado**, y **`play` no
  acepta una lista** de canciones.
- **Seguridad del WebSocket:** sin autenticación, sin TLS y **sin validar
  `Origin`**. Cualquier proceso local, o una página web que llegue a
  `localhost`, puede controlarlo. Se mitiga con loopback y puerto aleatorio; no
  se elimina.
- **Códigos de salida:** `0` bien, `1` error general (incluido "otro proceso usa
  el data-dir"), `10` build vencida.

## Lo que la persona ve

El objetivo es que sea **un solo lugar, tres pasos, cada uno con su tilde**, y
que la app haga todo lo que puede hacer sola. La forma sale de lo que les costó
a los testers de Spotifast (issue #1050): nada les decía que Soloist era la
salida, había dos dispositivos con casi el mismo nombre, el emparejado dependía
de la red sin avisar, y la configuración estaba repartida en tres lugares.

### 1. El aviso, al iniciar sesión

Apenas conecta la sesión, el backend pide **una** clave de audio (la de la
primera canción guardada, como hace la sonda). Si Spotify la niega con la sesión
sana, la app lo sabe **antes** de que la persona apriete play:

> **Spotify no entrega el audio de esta cuenta a Starless.**
> No es tu suscripción ni la app: Spotify bloquea a algunas cuentas Premium en
> reproductores no oficiales. Puedes seguir escuchando con Spotify Soloist, el
> reproductor liviano de Spotify, que Starless maneja por ti.
> **[Configurar Soloist]** · Ahora no

Con "Ahora no" la biblioteca se puede seguir mirando, y el mismo aviso vuelve,
en corto, la primera vez que se aprieta play. La comprobación se repite en cada
arranque: si Spotify vuelve a dar las claves, el aviso desaparece solo.

### 2. La hoja de configuración

Una sola hoja, en el estilo de Ajustes, con tres pasos numerados. Cada paso se
marca solo cuando está listo, y el siguiente se enciende.

1. **Descargar Soloist.** Un botón. La app baja el zip desde Spotify, comprueba
   la firma de Authenticode (firmado por Spotify AB), lo descomprime y muestra
   la versión y "vence en 89 días". Debajo, en chico, el enlace a la página de
   descargas y a las licencias de Spotify.
2. **Tu clave personal.** Un botón **"Abrir la página de la clave"** que abre
   `developer.spotify.com/dashboard/soloist` en el navegador, una captura
   anotada de dónde está el botón de copiar, y un campo para pegarla. Al pegar,
   la app **arranca Soloist con esa clave y la valida en el momento**: o
   "Clave aceptada", o "Spotify rechazó esa clave", nunca un fallo más tarde.
3. **Emparejar una vez.** La app muestra el nombre exacto del dispositivo, en
   grande: **"Starless en <nombre de la PC>"**, un código QR que abre Spotify en
   el celular, y una ilustración de la lista de dispositivos con ese nombre
   resaltado. Texto: "Abre Spotify en tu celular, conectado al mismo Wi-Fi,
   reproduce cualquier cosa y elige *Starless en …*". El paso se marca cuando
   Soloist avisa `auth_state.logged_in`. Si en un minuto no llegó nada, la hoja
   nombra la causa probable: otra red, un Wi-Fi de invitados o de oficina, o una
   red que aísla los dispositivos.

Al terminar: **"Listo. Starless reproduce con Spotify Soloist."** y la música
arranca con lo que la persona había elegido.

### 3. Después

- En Ajustes, una sola línea de estado: "Reproduciendo con Spotify Soloist
  1.3.x · la build vence en 74 días". Con un botón para volver a emparejar y otro
  para quitarlo.
- La renovación es **sola**: cuando faltan 14 días, la app baja la build nueva,
  la verifica y la cambia en el próximo arranque. Sólo le pregunta a la persona
  si falla.
- Lo que no aplica con Soloist se ve apagado y dice por qué: calidad de audio,
  normalización, crossfade y dispositivo de salida.

## Cómo se arma por dentro

### La costura: un motor de reproducción con dos implementaciones

Hoy los comandos `play_track`, `toggle_playback`, `seek_playback`, `set_volume`
y `player_status`, y el evento `player://status`, hablan con librespot en
`playback.rs`. **Esa es la costura**: el frontend no sabe quién reproduce. Un
`enum Engine { Librespot, Soloist }` detrás de esos mismos comandos, y un
`soloist.rs` nuevo que traduce:

| Starless | Soloist |
|---|---|
| `play_track(id)` | `play` con `spotify:track:<id>` |
| `toggle_playback` | `pause` / `play` sin `uri` |
| `seek_playback(ms)` | `seek` |
| `set_volume(v)` | `set_volume` (de 0–65535 a 0–100) |
| `PlaybackStatus` | de `playback_state`, `position_sync` y `track_changed` |

**La cola sigue siendo de Starless.** Soloist no acepta una lista, así que se le
manda canción por canción, y la siguiente se le adelanta con `add_to_queue`
apenas empieza la actual, para que el paso entre una y otra no tenga silencio.
El "terminó" se deduce de `track_changed` a la canción adelantada, o de
`playback_changed` a `idle`. **Hay que medir** qué hace Soloist al terminar una
canción sin nada en cola: si arranca su propio autoplay, Starless lo tiene que
pisar con lo que dice su cola.

### El proceso

- Vive en `%LOCALAPPDATA%\Starless\soloist\` (binario, `data\` y `cache\`), que
  sobrevive al cierre de sesión. **Cerrar sesión borra `data\`** —la sesión de
  Soloist es de la cuenta— pero no el binario.
- Lo arranca el backend con el login, y lo cierra al salir. Si sale con `10`, se
  descarga la build nueva. Si sale con `1` por el data-dir ocupado, es otra copia
  de Starless (instalada y de desarrollo): se dice eso, no "Soloist falló".
- **Con Soloist activo, no se crea el player de librespot.** Soloist abre su
  propio stream WASAPI, y dos clientes del mismo dispositivo se pelean (ver la
  trampa del player en `AGENTS.md`).
- Si Starless anuncia un dispositivo de Connect propio, **deja de anunciarlo
  mientras se empareja**: dos nombres parecidos en la lista fue el primer error
  de los testers de Spotifast.

### La clave

- Se guarda en el **Administrador de credenciales de Windows**, no en un archivo
  de ajustes.
- **Entra al backend una sola vez y nunca vuelve al webview**: la persona la
  pega, el comando la recibe, la valida y la guarda. Después el frontend sólo
  pregunta "¿hay clave?" y recibe un booleano. Es la misma frontera de confianza
  que con la sesión.

## Lo que se pierde con Soloist, dicho de frente

- **La voz del DJ**: sale por el sink propio de Starless (`voice.rs`), que con
  Soloist no existe. Opciones: abrir un stream propio sólo mientras Soloist está
  en pausa, o apagar la voz y dejar el DJ como lista. **Hay que decidir.**
- **El crossfade, la normalización y la calidad**: Soloist no tiene opciones
  para eso.
- **Lo que necesita el audio**: cualquier cosa que lea las muestras (`beat.rs`)
  no las ve, porque el audio vive en otro proceso.
- **El arranque y la memoria**: son dos procesos. Sigue siendo mucho menos que
  el cliente oficial, pero no es la promesa entera, y la landing no puede decir
  lo contrario para estas cuentas.

## Lo que hay que decidir antes de escribir código

1. ~~**La regla 7.**~~ **Decidido el 7 de noviembre de 2026: se acepta como
   excepción**, y la regla en `AGENTS.md` ya la escribe con sus tres límites:
   la clave se pide sólo a la cuenta a la que Spotify le niega las claves, es de
   la persona (la app no trae ni comparte una), y nunca vuelve al webview.
2. **La voz del DJ con Soloist**: stream propio en las pausas, o sin voz.
3. **Si la comprobación del login pide una clave real.** Es un pedido más a
   Spotify por arranque, desde la cuenta de la persona. Es lo mismo que hace un
   play, pero hecho sin un clic.

## Lo que hay que medir, en orden

Cada uno con una sonda, como el resto del repo, antes de construir la UI:

1. **Que el zip de Windows baje, esté firmado por Spotify AB y arranque** con
   una clave real, y que `--version` diga la fecha de build.
2. **El emparejado** de la cuenta de la issue #104 desde el celular, y que la
   sesión sobreviva a un reinicio de Soloist.
3. **La API**: `play` de una canción, `add_to_queue` de la siguiente, qué llega
   al terminar, y qué hace Soloist con la cola vacía.
4. **La clave inválida**: cómo falla Soloist con una clave rechazada (código de
   salida, mensaje), para que la hoja lo diga en el momento.
5. **Si Starless anuncia un dispositivo de Connect hoy**, y cómo se apaga
   durante el emparejado.
6. **La memoria y el arranque** de Starless más Soloist, para poder decirlo con
   números.

## Fuentes

- Documentación de Soloist: `developer.spotify.com/documentation/soloist` (overview,
  authentication, command line, WebSocket API, downloads and updates).
- Spotifast 0.15.0 y sus issues #283, #884 y #1050, y el fork de krolebord
  (`krolebord/spotifast-soloist`, MIT). Se tomaron **ideas** del flujo, no
  código.
- librespot #1649.
