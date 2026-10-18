# Changelog

El formato sigue [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) y
Starless usa [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and Starless adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> [!NOTE]
> **0.3.0 es el primer build que alguien pudo descargar.** 0.1.0 y 0.2.0 solo
> existieron en la máquina donde se construyó.
>
> **0.3.0 is the first build anyone could download.** 0.1.0 and 0.2.0 existed only
> on the machine where Starless was built.
>
> **0.1.0 y 0.2.0 se reconstruyeron a partir de las fechas de los archivos**, no
> de un registro: Starless se construyó de una sola sentada y hasta 0.3.0 no tenía
> control de versiones. Son exactos sobre *qué existía*; *qué versión lo introdujo*
> es una inferencia. Desde 0.3.0 hay repositorio y etiqueta, así que `git log`
> reemplaza esa inferencia por un dato.
>
> **0.1.0 and 0.2.0 were reconstructed from file timestamps**, not from a record.
> They are exact about what existed; which version introduced it is an inference.
> From 0.3.0 there is a repository and a tag, so `git log` replaces the inference
> with a fact.
>
> La app muestra estos mismos changelogs dentro de Ajustes → Diagnóstico, en el
> idioma que el usuario eligió. The app shows these same notes inside
> Settings → Diagnostics, in whichever language the user picked.

---

## [0.4.0] — En desarrollo

### New / Nuevo

- Cuando hay una versión nueva, Starless lo dice: una alerta flotante que aparece una vez y se desvanece sola, el botón de Ajustes queda marcado en verde, y dentro de Ajustes el botón de actualizar se pone en verde con la versión disponible. Nada se descarga y nada se instala solo — instalar sigue siendo un clic tuyo, en Ajustes, porque Starless está sonando.
- Un fallo al comprobar no marca nada. Si GitHub no se puede alcanzar, eso dice algo de la red y nada de tu instalación, así que el botón se queda como estaba.

### Fixed / Corregido

- Para casi todo el mundo, la biblioteca salía vacía y no decía por qué. Spotify dejó de entregar datos a las apps nuevas salvo a cinco cuentas en una lista. Starless ahora lee la biblioteca, las playlists, las guardadas y la búsqueda por la misma sesión con la que reproduce, y si algo falla al leerla la app lo dice en vez de mostrar un vacío.
- Dos Starless abiertas a la vez ya no pueden pasar. Antes competían por las claves de audio y la que perdía le pasaba sus bytes a la otra: seis canciones quemadas en catorce segundos, todas reportadas como canciones que Spotify no entregaba. Ahora la segunda copia sube la ventana de la que ya está y se cierra.
- Se cayó la conexión con Spotify y Starless lo dice. Antes saltaba canción tras canción diciendo que esa canción no se pudo reproducir —la pista estaba bien, lo que faltaba era la conexión—, y como la sesión de reproducción no vuelve sola, terminabas viendo seis errores en catorce segundos. Ahora dice qué pasó y para. Hay que cerrar y abrir la app.
- Las portadas de tus playlists vuelven. Spotify no las manda al leer la biblioteca, pero sí las tiene en otro lado, y ahora Starless las busca ahí: son las imágenes de Spotify, no un mosaico dibujado por la app.
- El botón de Inicio vuelve al inicio de verdad. Antes sólo cambiaba una pestaña y dejaba la playlist abierta en pantalla.
- Hay una pantalla principal. Antes "Inicio" era la lista de canciones que te gustan con otro nombre: una lista de cosas que ya elegiste, que es mala forma de decidir qué escuchar después. Ahora es una repisa con tus playlists y, aparte, lo que Spotify te fabricó —hoy, DJ—. **No hay fila de filtros ni recomendaciones**: esas salen del motor de recomendaciones de Spotify, que estaba detrás de la Web API que ya no funciona, y se probaron catorce URIs contra la sesión disponible sin que ninguna respondiera.
- Arreglada la cola después de buscar. Elegir una canción del desplegable, o hacer clic dentro de la playlist que ya estaba abierta, dejaban la cola de la lista anterior —buscabas una canción y después seguían las que te gustan—. Ahora cada lista define la cola que la sigue.
- **Letra de las canciones.** Botón en la barra de abajo, al lado de lo que está sonando. Sigue la posición del audio línea por línea cuando el proveedor manda los tiempos, y avisa que no puede seguirlas cuando no los manda —en vez de quedarse clavada en la primera toda la canción—. Viene por la misma sesión que ya reproducía: ni un permiso nuevo, ni un client id propio. Este apartado es un pedido de un `kaliuchisfangirl` que lo quería ya, y con razón: no había forma de ver la letra sin salir de la app.
- El botón de aleatorio ahora se ve. Antes sorteaba una canción distinta en cada salto pero el panel de cola seguía mostrando el mismo orden de siempre: lo que estaba al lado contradecía lo que sonaba. Ahora al prenderlo se decide un orden nuevo, se ve en el panel y se mantiene; apagarlo no lo deshace.

### Changed / Cambiado

- Entrar es una sola aprobación. Antes se pedía permiso dos veces —una para reproducir y otra para leer la biblioteca— y la segunda era la que empezaba a devolver errores.
- La pantalla de resultados es una lista de canciones en orden alfabético.
- Reproducir desde la pantalla de inicio ahora arma una cola nueva cada vez. Una playlist es una afirmación sobre el orden, así que abrirla y reproducir respeta ese orden; desde cualquier otro lugar no, y hasta ahora siempre salía la misma cola y terminabas escuchando siempre las mismas canciones seguidas. Las playlists siguen sonando en el orden en que están.

### Removed / Eliminado

- Las pestañas de álbumes, artistas y playlists en los resultados, la discografía del artista, y agregar a o crear playlists. La ruta que las alimentaba ya no existe y no hay otra que devuelva la verdad.

---

## [0.3.2] — 2026-10-17

### Fixed / Corregido

- Al abrir otra playlist, la lista arrancaba a la altura donde habías dejado la anterior. Ahora cada lista arranca en su propio arriba.
- Las filas de una lista aparecían con huecos entre medio durante unos segundos: la cascada de entrada no tenía tope, así que en una playlist de 198 canciones la última fila esperaba casi seis segundos en ser visible. Ahora la cascada se detiene en la primera docena.
- Abrir una playlist mostraba filas de la anterior. Una playlist puede tener la misma canción dos veces, y con esa fila compartida entre dos canciones React dejaba las filas viejas montadas: seguían pintando la lista previa debajo del nombre y el conteo de la nueva. Cuatro canciones repetidas en «Mi playlist n.º 4» eran cuatro filas de más en cada lista que abrieras después.
- Pasar el cursor por las playlists volvía a descargar todas sus páginas, una y otra vez: el precargado se guardaba ya vencido, así que el `staleTime` de cinco minutos del hook no llegaba nunca a aplicarse. Una playlist larga se descargó seis veces completas en diez segundos.
- Después de una actualización, la app siguiente abría pidiendo el reporte de un crash que nunca hubo. El actualizador entrega el instalador a Windows y el proceso se va antes de que se pueda cerrar la sesión a tiempo, así que el marcador de sesión sobrevive.
- Una sesión que moría a los pocos segundos ya no cuenta como caída. Un cierre abrupto se distingue de un crash por lo único que los separa: cuánto vivió.
- El español estaba escrito en voseo rioplatense. Ahora es neutro.

---

## [0.3.1] — 2026-10-17

Cerrar sesión, abrir, reportar. / Sign in, open, report.

### Added / Añadido

- El feedback se puede escribir también desde la pantalla de inicio de sesión. A quien la app no le funciona ya no tiene que iniciar sesión para contarlo: esa pantalla era, irónicamente, justo donde no había dónde escribir.
- Una pestaña de Personalización en Ajustes, con el primer ajuste propio: qué tan opacos son los menús. Se recuerda entre arranques, y una muestra al lado del deslizador deja ver el resultado mientras lo mueves.

### Fixed / Corregido

- Cada arranque mostraba la pantalla de inicio de sesión un instante antes de la app, aunque la sesión estuviera guardada. Ahora se espera en silencio y solo pregunta cuando de verdad no hay sesión.
- Enviar un reporte caía en una página de error de GitHub: la URL era demasiado larga. Ahora entra, y el recorte se lleva el final del log —que es donde está la falla— en vez de la cabecera.
- El botón de enviar estaba apagado y sin decir por qué cuando el mensaje estaba vacío. Un clic que no hace nada es indistinguible de un clic roto.
- La sesión se caía sola una hora después de entrar. Si Spotify respondía a una renovación con un solo token de acceso, Starless guardaba el token de refresco vacío encima del que sí servía; en el vencimiento siguiente ya no había con qué renovar y sólo quedaba volver a iniciar sesión.

### Changed / Cambiado

- El formulario de feedback y el aviso de caída ya no se apilan sobre otro panel de vidrio, que `DESIGN.md` prohíbe: ahora llevan un velo plano detrás.
- La build compilada salía con el vidrio **sin difuminado**. El minificador de Tailwind se comía el `backdrop-filter` estándar y dejaba solo el prefijo `-webkit-`, que WebView2 ignora: al 55% se leían las canciones de atrás a través del panel, mientras `bun run dev` se veía perfecto porque ahí el CSS no pasa por el minificador. Ahora el vidrio sale difuminado como corresponde, y qué tan opaco es lo eliges en Ajustes → Personalización.
- El ajuste de opacidad también alcanza a la cola y a los ajustes, no sólo a los menús flotantes.

---

## [0.3.0] — 2026-10-17

La primera versión pública. / The first public release.

### Added / Añadido

- Búsqueda con sugerencias que se abren bajo el campo, sin quitar lo que estabas leyendo.
- Pestañas en los resultados: Todo, Canciones, Álbumes, Playlists y Artistas.
- Perfil de artista con su discografía y sus canciones.
- Reproducir un álbum entero desde su tarjeta, con cola propia.
- Agregar una canción a una playlist, y crear la playlist desde ahí mismo.
- Registro a archivo local, con rotación, y autodiagnóstico con `STARLESS_DIAGNOSTIC=1`.
- Actualizaciones automáticas: Starless comprueba si hay una versión nueva al abrir y tú decides cuándo instalarla.
- Estos changelogs, en Diagnóstico.
- Detección de caídas: si la app no se cerró bien, Starless lo nota y te ofrece enviar el reporte, con el log ya recortado y sin datos personales. No sale un solo byte de tu máquina hasta que lo mandas.
- Feedback dentro de la app, en Ajustes → Diagnóstico. El log va adjunto solo si lo pides.
- El volumen se recuerda entre arranques.
- Un ícono nuevo: una estrella que se apaga.
- La ventana ya no usa la barra de título del sistema. Minimizar, maximizar y cerrar viven a la derecha del buscador.

### Fixed / Corregido

- No sonaba nada: Spotify rechaza el client token de las apps nuevas. Ahora la sesión de reproducción y la Web API usan identidades distintas.
- Las playlists devolvían 403 tras la migración de Spotify de febrero de 2026. El endpoint se llama `/items` ahora, no `/tracks`.
- Todas las playlists decían «0 canciones» porque Spotify eliminó el total. El conteo ahora es exacto: se cuenta lo que se cargó.
- Una canción retirada vaciaba la biblioteca entera.
- La app se caía al escribir en el buscador: la política de reintento recibía un error que no era el tipo que esperaba.
- Cerrar sesión dejaba cacheado un «no has iniciado sesión» que sobrevivía al reinicio.
- Abrir una playlist hacía un handshake TLS completo cada vez: ahora el cliente HTTP se comparte.
- La biblioteca se vaciaba sola alrededor de una hora después de iniciar sesión: el refresco del token corría en el hilo asíncrono, entraba en panic y se llevaba por delante todas las llamadas a la Web API sin dejar una línea en el log.
- Un cliente HTTP que fallaba al construirse quedaba cacheado como fallo, así que un mal arranque llenaba la biblioteca de vacío hasta reiniciar la app.
- Enviar un reporte congelaba la ventana mientras hacía la petición.

### Changed / Cambiado

- Escribir ya no borra la pantalla principal. Enter es lo que decide.
- Una canción que no se puede reproducir se salta, hasta cinco seguidas antes de rendirse.
- Las consultas que Spotify responde con 503 se reintentan una vez: es su borde, no la petición.
- El botón de la cola vive solo en la barra de reproducción; también estaba arriba.
- Cerrar sesión se mudó de Biblioteca a Ajustes → Cuenta, y ahora funciona: el botón que estaba ahí no hacía nada.
- El selector de idioma salió de la barra superior y vive en Ajustes → General.
- El botón de inicio muestra una casa en vez de un disco.

---

## 0.2.0 — reconstruido / reconstructed

Nunca se publicó. / Never published.

### Added / Añadido

- Inicio de sesión con Spotify por OAuth. La app nunca ve tu contraseña.
- Audio de verdad: el PCM va de librespot al driver de Windows por WASAPI, sin pasar por la ventana.
- Tu biblioteca: canciones que te gustan y tus playlists, con el conteo exacto.
- Barra de reproducción con datos reales: portada, aleatorio, anterior, pausa, siguiente y repetir.
- Cola de reproducción, con lo que suena y lo que sigue.
- Agregar una canción a una playlist, y crear la playlist desde ahí.
- Registro a archivo local y autodiagnóstico con `STARLESS_DIAGNOSTIC=1`.

### Fixed / Corregido

- No se podía reproducir nada: Spotify rechaza el client token de las apps nuevas, así que la sesión de reproducción y la Web API usan identidades distintas.
- Las playlists devolvían 403 tras la migración de Spotify de febrero de 2026. El endpoint se llama `/items` ahora, no `/tracks`.
- Todas las playlists decían «0 canciones» porque Spotify eliminó el total. Ahora se pagina hasta el final y el conteo es exacto.
- Una canción retirada vaciaba la biblioteca entera.
- Abrir una playlist hacía un handshake TLS completo cada vez: ahora el cliente HTTP se comparte.

### Changed / Cambiado

- Premium se pide y se explica temprano, porque sin Premium Spotify no entrega audio.
- Una canción que no se puede reproducir se salta, hasta cinco seguidas antes de rendirse.

---

## 0.1.0 — reconstruido / reconstructed

Nunca se publicó. / Never published.

### Added / Añadido

- La app de escritorio: ventana, proceso de Rust y estructura de comandos.
- El sistema visual: vidrio translúcido, paleta y tipografías definidas en DESIGN.md.
- Interfaz bilingüe, español e inglés, con selector.
- La versión en un solo lugar, con un script que la propaga a los tres manifiestos y falla en CI si discrepan.

---

[0.3.1]: https://github.com/baironvillar/Starless/releases/tag/v0.3.1
[0.3.0]: https://github.com/baironvillar/Starless/releases/tag/v0.3.0