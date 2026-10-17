# Changelog

El formato sigue [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) y
Starless usa [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and Starless adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> [!NOTE]
> **0.1.0 y 0.2.0 se reconstruyeron a partir de las fechas de los archivos**, no
> de un registro: Starless se construyó de una sola sentada y hasta ahora no
> tenía control de versiones. Son exactos sobre *qué existía*; *qué versión lo
> introdujo* es una inferencia. Desde este commit, `git log` reemplaza esa
> inferencia por un dato.
>
> **0.1.0 and 0.2.0 were reconstructed from file timestamps**, not from a
> record. They are exact about what existed; which version introduced it is an
> inference. From this commit onward, `git log` replaces the inference with a fact.
>
> La app muestra estos mismos changelogs dentro de Ajustes → Diagnóstico, en el
> idioma que el usuario eligió. The app shows these same notes inside
> Settings → Diagnostics, in whichever language the user picked.

---

## [No publicado] — 0.3.0

### Added / Añadido

- Búsqueda con sugerencias que se abren bajo el campo, sin quitar lo que estabas leyendo.
- Pestañas en los resultados: Todo, Canciones, Álbumes, Playlists y Artistas.
- Perfil de artista con su discografía y sus canciones.
- Reproducir un álbum entero desde su tarjeta, con cola propia.
- Agregar una canción a una playlist, y crear la playlist desde ahí mismo.
- Registro a archivo local, con rotación, y autodiagnóstico con `STARLESS_DIAGNOSTIC=1`.
- Actualizaciones automáticas: Starless comprueba si hay una versión nueva al abrir y tú decides cuándo instalarla.
- Estos changelogs, en Diagnóstico.

### Fixed / Corregido

- No sonaba nada: Spotify rechaza el client token de las apps nuevas. Ahora la sesión de reproducción y la Web API usan identidades distintas.
- Las playlists devolvían 403 tras la migración de Spotify de febrero de 2026. El endpoint se llama `/items` ahora, no `/tracks`.
- Todas las playlists decían «0 canciones» porque Spotify eliminó el total. El conteo ahora es exacto: se cuenta lo que se cargó.
- Una canción retirada vaciaba la biblioteca entera.
- La app se caía al escribir en el buscador: la política de reintento recibía un error que no era el tipo que esperaba.
- Cerrar sesión dejaba cacheado un «no has iniciado sesión» que sobrevivía al reinicio.
- Abrir una playlist hacía un handshake TLS completo cada vez: ahora el cliente HTTP se comparte.

### Changed / Cambiado

- Escribir ya no borra la pantalla principal. Enter es lo que decide.
- Una canción que no se puede reproducir se salta, hasta cinco seguidas antes de rendirse.
- Las consultas que Spotify responde con 503 se reintentan una vez: es su borde, no la petición.

---

## [0.2.0] — reconstruido / reconstructed

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

## [0.1.0] — reconstruido / reconstructed

### Added / Añadido

- La app de escritorio: ventana, proceso de Rust y estructura de comandos.
- El sistema visual: vidrio translúcido, paleta y tipografías definidas en DESIGN.md.
- Interfaz bilingüe, español e inglés, con selector.
- La versión en un solo lugar, con un script que la propaga a los tres manifiestos y falla en CI si discrepan.

---

[No publicado]: https://github.com/baironvillar/Starless/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/baironvillar/Starless/releases/tag/v0.2.0
[0.1.0]: https://github.com/baironvillar/Starless/releases/tag/v0.1.0
