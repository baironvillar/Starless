# Deudas conocidas

Defectos reales que **siguen en pie** en este repo, con la evidencia. No están
acá para descubrirse de nuevo: cada uno se midió o se reprodujo.

Si arreglás una, borrala de acá en el mismo commit. Una lista de deudas que
nunca se vacía deja de informar.

## 1. Dos códigos de error no tienen frase

Rust emite `no_session` (`lib.rs`, macro `spclient_command!`) y `bad_id`
(`spclient.rs`, `create_playlist`). Ninguno de los dos está en `API_ERRORS`
(`spotify.ts`), así que `explain()` los devuelve tal cual y **el usuario ve el
código crudo en la pantalla**: `no_session`, `bad_id`.

No es teórico: son las dos rutas que se ejecutan cuando el lector aprieta algo y
no hay sesión, o cuando Spotify manda un id que no pasó la validación.

## 2. `API_ERRORS` está entera en español y fuera de `i18n.ts`

Veinte mensajes de error, hardcodeados, en un solo idioma, en un archivo que la
regla 5 excluye explícitamente. Un usuario en inglés lee todos sus errores en
español.

Es deuda de traducción, no de arquitectura: no se arregla en un commit de cinco
minutos. Cuando se toque `API_ERRORS`, el movimiento natural es llevarla a
`i18n.ts` con sus dos idiomas de una vez.

## 3. Las sondas de ingeniería inversa

~1180 líneas en `src-tauri/src/spclient/probe.rs`, todas detrás de
`#[cfg(debug_assertions)]`, en `mod probe`. Funcionan y no llegan a release.

Son instrumentos de una sola vez: sus hallazgos ya están cocidos en el código de
producción, y quien los escriba de nuevo no los va a volver a escribir. Quedan
como arqueología del protocolo y como forma de volver a mirar una forma de
respuesta. Borrarlas es un `git rm` limpio si se decide que no vale el peso.

## 4. La comprobación de actualizaciones no distingue tres estados

`updater.ts` publica `"idle"` tanto cuando **nunca se comprobó** como cuando
**la comprobación falló**. Son dos cosas distintas y el usuario las ve iguales.
`PrereleaseState` lo hace bien (tiene su propio `"error"`); el estado general
no.

AGENTS.md ya avisa que un fallo silencioso es lo que hace que un actualizador
roto parezca uno que funciona. Falta el cierre.

## 5. `Track::popularity` viaja y nadie lo lee

Spotify lo manda en cero para las apps creadas después de febrero de 2026, así
que el campo no distingue nada. No es un bug: es un dato que viaja con una nota
al lado. Si algún día hay un orden por popularidad, el campo ya está.

## 6. El lock se toma después del `.await`, no antes

`begin_login` y `sign_out` (`lib.rs`) toman el lock **después** de su único
`.await` y lo sostienen a lo largo de `previous.shutdown()`, que es un desarme de
red. No hay deadlock — no hay toma reentrante sobre el mismo mutex — pero el
guard se mantiene durante una llamada lenta.

**No lo "arregles" moviéndolo**: AGENTS.md marca el orden al revés como
deliberado, y mover el lock adentro de un `.await` es exactamente el bug de
`MutexGuard` no-`Send` que rompe un comando async.

## 7. La voz del DJ: la puerta apareció (resuelto en 0.5.0)

La narración —el SSML, el artista, los parámetros de mezcla— llega pegada a la
fila del DJ, y **el audio no viaja en ella**. El servicio que lo produce
**existe y está descrito**: librespot 0.8 trae `spotify.narration.proto`
(`tts-resolve.proto` y `client-tts.proto`), que nadie compila y nadie usa:
`ClientTtsService.GetTtsUrl(TtsRequest) → TtsResponse { url }`. El request
lleva el SSML, la voz (`TtsVoice`, cuarenta opciones), el proveedor
(`TtsProvider`: `CLOUD_TTS`, `READSPEAKER`, `POLLY`, `WELL_SAID`,
`SONANTIC_FAST`), el idioma, el formato (`WAV`, `PCM`, `OPUS`, `VORBIS`, `MP3`)
y la frecuencia.

**Y la fila del DJ trae todos esos parámetros, medidos**: `tts_provider =
"SONANTIC_FAST"`, `voice = "VOICE35"`, `sample_rate = "44100"`, `loudness =
"-16.0"`, `true_peak = "-3.0"` y el SSML. El idioma sale del propio SSML
(`xml:lang="es-MX"`).

### La puerta, y cómo se encontró

**`POST /client-tts/v1/fulfill` en `spclient.wg.spotify.com`.** Lo que se midió
de ella:

- **Pide el token de la cuenta**, no el client token: con el client token solo
  contesta `401`; con el token de la cuenta, `200`.
- **Exige el cuerpo en protobuf binario**: el mismo pedido en formato texto
  contesta `400`.
- **Contesta con el audio, no con una URL**: un MP3 de 320 kbps, 44,1 kHz y mono.
  El `TtsResponse { url }` del proto es la forma vieja.
- **El host va escrito.** El access point regional que resuelve librespot
  (`guc3-spclient.spotify.com`) contesta `303`; el host canónico responde
  `200`. `reqwest` sigue las redirecciones y descarga el audio.
- **`tts.spotify.com` NO es el host.** Existe en DNS —el DNS de Spotify no es
  un wildcard, `xyzq7noexiste1234.spotify.com` no resuelve— y contesta `404` a
  todo, `/client-tts/v1/fulfill` incluido.
- **El client token sirve, pero no acota.** Con el platform data de Windows
  (el `desktop_windows` del `ConnectivitySdkData`: `os_version`, `os_build`,
  `platform_id`, `unknown_value_6`, `image_file_machine`, `pe_machine`,
  `unknown_value_10`) el `clienttoken.spotify.com/v1/clienttoken` concede el
  token. Sin ese platform data contesta `400` con el cuerpo vacío, que es lo
  que hace parecer que "no hay token". Los `domains` que trae el granted token
  son `spotify.com` y `spotify.net`.
- **`apresolve.spotify.com` no conoce más hosts.** De veinte tipos de access
  point, sólo existen `accesspoint`, `dealer` y `spclient`.

### El `401` que engañó a los 121 paths

Un path contesta `401` **sin** credenciales y `404` **con** ellas. El `401` es
del balanceador, no del servicio: el routing nunca llegó a mirarlo. Y en el
spclient, el `401` es **por namespace**: sin credenciales, todo
`/client-tts/v1/**` contesta `401` y todo lo demás `404`. Con credenciales, un
método que no existe también contesta `404`.

Por eso los 121 paths medidos dieron `404` en todas partes: **el método estaba
mal, no el host**. Cuando se mide un path nuevo, el control que lo prueba es un
path inventado en el mismo namespace: si el inventado también contesta `401`,
el `401` no dice nada del método.

### De dónde salió el path: el binario del cliente

El instalador de Windows no se deja abrir —`extract` sale con código 33 y borra
el MSI que lanza por `msiexec`—, pero el **`.deb` de Linux** sí:
`spotify-client_1.2.95.453` trae `usr/share/spotify/spotify`, 59 MB, que es el
mismo core C++ que usa el de Windows. Tiene **una sola** string de TTS con
forma de path: `client-tts/v1/fulfill`. Encaja con la convención
`servicio/vN/método` del resto del cliente (`storage-resolve/v2/files/audio/`,
`image-resolve/v1/resolve/map`).

El `dj.spotify.com` es el **web player móvil** con la página "DJ | Spotify", y
**no tiene una sola string de TTS** en 3,4 MB de bundles: la voz del DJ es de
las apps nativas, no del navegador.

### Cómo suena

**La voz se mezcla en la misma salida que la música, y no en otra.** El `Sink`
de rodio de librespot no deja ver el `Mixer` del stream, y sin ese mixer la voz
tendría que abrir un segundo stream en el mismo dispositivo —y en Windows dos
clientes del mismo WASAPI se pelean, y el que pierde le pasa sus bytes al
otro—. Por eso `voice.rs` trae su propio `Sink`: es el mismo `SinkBuilder` —un
puntero a función— pero con un sink que publica el mixer. La música y la voz
salen por el mismo stream.

**La voz va primero, la música después.** Cuando el DJ habla, la música se
calla —`playback::stop`— y la canción arranca recién cuando el backend avisa
que el DJ terminó (`dj://voice`). El `stop` del player deja el sink
vaciándose —lo que ya estaba metido sigue sonando un momento—, así que la voz
**espera a que el sink quede vacío** antes de entrar: si no, la frase se pisa
con la cola de la canción anterior. El aviso va **siempre**, se haya oído la
voz o no: dejar al frontend esperando sería dejar al DJ mudo.

**Y tiene el volumen del usuario.** La fuente lee la **misma** atenuación que
la música —el mismo `Arc<AtomicU64>`—, muestra por muestra: mutear la calla
en el medio de la frase, no sólo al principio de ella. Una bandera compartida
la corta, y `play_track` la corta en el backend, así que todos los caminos de
reproducción hacen lo mismo.

**Y por qué la voz del sistema no era un atajo**: el log dice qué dispositivo
usa el player —"Using audio device: Auriculares (H848 USB Gaming Headset)"— y
SAPI y `speechSynthesis` salen por el dispositivo **por defecto** del sistema,
que no es ése. Con auriculares puestos, la música suena en los auriculares y la
voz impostora en los speakers: dos dispositivos, dos sonidos, y la voz encima de
la música. La única voz que sale por el mismo dispositivo que la música es la
que reproduce el player, o sea la de Sonantic.

La sonda es `STARLESS_SP_VOICE=1`: pide el audio, lo decodifica y lo pone en el
mixer, sin que nadie haga clic.

## 8. El DJ abre y cierra cada tramo, y las dos frases se dicen

La sesión del DJ trae `narration.intro` y `narration.outro`: el DJ abre cada
tramo con una frase y lo cierra con otra. Medido: una página trae 5 canciones
y 2 frases, la de apertura en la primera y la de cierre en la última.

**Las dos se dicen, cada una antes de su canción.** La de apertura anuncia el
tramo ("vamos ahora a entrar en un mood relajado") y la de cierre anuncia su
última canción ("con esa melodía de Coldplay cerramos este segmento"): el
verbo de las dos está en presente, y eso dice que las dos se dicen antes de
que suene la canción. La de cierre no es un resumen de un tramo ya terminado:
es la presentación de la última canción.

**El texto y la voz son la misma frase.** `narration_of` prueba la apertura y
después el cierre; `voice_of` hace lo mismo, y por eso lo que el panel
muestra arriba de la cola es lo que el DJ dice. Una fila con las dos frases
es una fila que tiene que abrir su tramo: la apertura va primero.

Entre dos tramos se oye la de cierre, la última canción, y la de apertura de
la siguiente: una canción de por medio. Esa es la forma del DJ, no un bug.

**Y la frase se pide cuando la canción va a sonar, no cuando llega la
página.** La página llega dos canciones antes de que la cola se vacíe, y
pedir la frase ahí sería hablar encima de la canción que está sonando: el
backend la guarda por canción (`DjState`) y el frontend la pide con `dj_speak`
en el momento en que esa canción va a arrancar. La voz se dice **una sola
vez**: el backend se la lleva cuando la pide.

**Y el audio se pide por adelantado.** Fabricarlo tarda un par de segundos —el
servicio que lo hace es otro—, así que la página siguiente (que llega cinco
canciones antes de que la cola se vacíe) lo pide sola y lo deja listo.

Lo que falta del cliente de Spotify es el botón de "elige tú": el servicio
anuncia `dj.interactivity_enabled: true` y manda `narration.jump.*` con la
frase del salto, pero **no se ha encontrado la puerta que pide el salto**. Sin
esa puerta no hay forma de que el usuario le pida algo distinto al DJ, y no se
puede inventar: un botón que no hace algo real es peor que no tenerlo.

## 9. La estación del DJ: falta la mitad del ciclo

**Lo que ya está probado, sonando.** Con la sesión de `t_jitzol` y la app real: al
clickear la card arranca la primera canción, el panel de cola muestra la frase del
DJ arriba —la de la canción que está sonando— y la cola queda con lo que el DJ
eligió.

El tramo de ahora trae **5 canciones por página**, y la página es un set
completo: la primera canción trae la frase de apertura y la última la de cierre
(medido: 5 canciones · 2 frases, apertura en la primera, "cerrando este segmento"
en la última). La siguiente página abre otro set con su propia apertura. El tamaño
de la página lo pone el servicio y cambia: 5 en el tramo de ahora, 13 en una
sonda, 30 y 150 en la línea de tiempo —la otra puerta, ver AGENTS.md—.

**Lo que falta** es el final del ciclo y un momento que no se puede ver sin
esperar:

- Que la estación **termine** cuando el servicio dice `stop` (`end_of_context_action`),
  que es una lista vacía y la cola sigue con lo que tiene.

Lo de "que la frase cambie de canción a canción" ya está: la frase es de la
canción, y el backend la pide por canción cuando esa canción va a sonar (deuda
8). Lo que falta es verlo en la app con el set sonando de punta a punta, y eso
se lee en el log: `dj: la voz del DJ terminó de hablar` aparece una vez por
frase, y la canción que arranca después es la que la frase presenta.

Las dos cosas necesitan alguien escuchando, o el log: `dj_mix` y `dj_more` dejan
una línea por llamada —"dj: arrancó una sesión con N canciones" y "dj: la estación
pidió la página siguiente y recibió M"—, así que el tamaño de cada página y cuántas
veces pidió la estación se leen sin esperar a que suene nada.

## 10. El salto de la cola: el lugar, no la canción

La cola se recorre por **número**, y a propósito. El DJ ofrece la misma canción
dos veces —en su sesión una canción puede volver— y `findIndex` por id devuelve
la **primera copia**, la que ya sonó: desde ahí, "el siguiente" es una canción
del pasado y la app salta para atrás. En el log se veía la secuencia
`1Hu8EMK → 3AuZYC → 1Hu8EMK → 2XuHpC` con cuatro clics: el `findIndex` iba a
la primera copia de cada una.

**Lo que se arregló (0.5.4).** El lugar de la canción que termina se resuelve
**en el momento del final**: primero el número recordado, y sólo si ya no tiene
esa canción, por id. Antes, cambiar de playlist mientras sonaba dejaba el
número sin sentido —la lista a la vista *es* la cola, y al cambiar de lista la
canción ya no estaba en ella—, y al terminar la app repetía la misma canción: en
el segundo final se paraba y no pasaba a la siguiente.

Y el guard del avance automático **no se guarda por id de canción**: se suelta
cuando el backend dice que esa canción vuelve a sonar, que es el único momento
que dice "es otra vuelta de la misma canción". Con el id como clave, un final
más de la misma canción —el DJ la ofrece dos veces, y una cola armada a mano
también— se tomaba por el primero y la música se paraba en medio de la cola.

**Lo que sigue en pie.** `findIndex` por id sigue devolviendo la primera copia,
así que los caminos que buscan por id en vez de recibir el número de la fila
siguen con ese riesgo: `onPlay` lo hace cuando la fila no le pasa su índice.

**Y cada pedido de reproducir lleva un número** (`intent` en `App.tsx`). El
`dj_speak` es una promesa: la respuesta llega después, y para entonces el
usuario puede haber apretado siguiente. Una respuesta vieja aceptada pone una
canción encima de la que ya está sonando —en el log, dos `play` con **19 ms**
de diferencia—. Por lo mismo, el avance automático sólo responde al final **de
la canción que se está esperando** (`asked`): un final viejo, el de la canción
que el usuario acaba de saltear, también pondría una encima.

**Al tocar el orden de la cola: el índice va en un estado y en una referencia.**
El estado lo dibuja el panel; la referencia la leen las decisiones, porque dos
clics seguidos tienen que caer en dos canciones distintas y el estado del
segundo clic todavía es el del primero.
