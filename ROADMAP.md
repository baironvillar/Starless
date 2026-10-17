# Roadmap

Ordenado por releases, no por fechas. **Una fecha sin decidir es una promesa que
no se puede cumplir**, así que nada acá lleva fecha; lo que lleva es un orden y una
razón. La fuente de cada punto son las preguntas que ya están abiertas y escritas
en [`PRODUCT.md`](PRODUCT.md) y [`DESIGN.md`](DESIGN.md).

> Ordenado por releases, not by dates. **A date nobody has decided on is a promise
> nobody can keep**, so nothing here carries one. What it carries is an order and a
> reason.

---

## 0.4.0 — La app deja de romperse y deja de olvidarse

Lo que ya está a medio hacer y hoy está roto o directamente incómodo.

- **Recordar el volumen.** `playback.rs` abría el player en `MAX_VOLUME` en cada
  arranque. Ahora persiste en `settings.json`. Hecho.
- **Detectar un crash y poder reportarlo con el log.** Marcador de sesión +
  hook de panic + log recortado y sin datos personales, con un botón que abre el
  issue. Hecho.
- **El auth gate que se quedaba esperando.** El sintoma era conocido: la sesión
  entra, `login completo: session=true web_token=true`, y no llega ni una sola
  llamada a la Web API. **Tenía causa raíz y era una línea de código.**
  `token::ensure_fresh` — que refresca el token, o sea un viaje HTTP bloqueante —
  se llamaba en el comando `async`, antes del `spawn_blocking`. Construir un
  cliente bloqueante de reqwest dentro de un runtime async hace panic
  (*"Cannot drop a runtime in a context where blocking is not allowed"*), el
  comando moría antes de hacer la petición, y el log no mostraba ninguna línea
  `webapi:`. Solo pasaba cuando el token guardado ya tenía que renovarse: por eso
  la app cargaba perfecto durante una hora y después se vaciaba sin explicación.
  Arreglado moviendo el refresco adentro del closure bloqueante.
- **Los errores de `reqwest` sin explicar.** `Failed to communicate successful
  startup: Ok(())` en ráfagas de tres, sin relación aparente con nada. Son el
  cliente bloqueante de reqwest levantando su runtime interno; el error era ruido
  pero el cliente **quedaba cacheado como fallo**, así que un solo mal arranque
  dejaba la biblioteca vacía hasta reiniciar la app. Ahora un fallo al construir
  el cliente no se recuerda, y tanto esa falla como un request que no llegó a
  Spotify quedan anotados en el log.

---

## 0.5.0 — Salir del círculo de Windows

- **Firma de código en los instaladores.** Es la deuda más visible del producto:
  hoy SmartScreen y Gatekeeper avisan, y `PRODUCT.md` lo asume como responsable.
  Cuesta dinero y tiempo; hasta que se pague, la primera ejecución tiene que
  seguir explicándolo en vez de dejar que la app lo descubra sola.
- **macOS.** El backend ya es multiplataforma por construcción (rodio → cpal, y
  cpal ya habla CoreAudio); lo que falta es probarlo de verdad, un `.app` firmado
  y los permisos de audio.
- **Linux.** `libasound2-dev` al compilar, y AppImage o `.deb`. Sin fecha todavía
  y sin soporte de Wayland.

## 0.6.0 — Accesibilidad, que es la deuda que más pesa

`PRODUCT.md` lo dice sin llamarlo por su nombre: **no está acordado ningún nivel de
conformidad**, y hay preguntas abiertas sobre contraste, teclado y etiquetado para
lectores de pantalla. Es el bloque más grande de trabajo del roadmap, y también el
menos controversial: no hay ni una decisión que tomar, sólo que hacer.

- Auditoría real: foco visible, navegación por teclado completa en transporte y
  navegación, `aria-label` en todo lo que hoy se comunica sólo por color.
- Objetivos de contraste fijados y verificados contra `#0A0A12` y contra el vidrio,
  no contra capturas.
- Idioma del sistema para lectores de pantalla, no sólo el nuestro.

---

## Sin fecha — Las preguntas abiertas de verdad

Estas están escritas como preguntas en `PRODUCT.md` y `DESIGN.md` y siguen sin
respuesta. No están en ningún release porque no se han decidido.

- **¿Starless se registra como un dispositivo Spotify Connect?** La dependencia
  `librespot-connect` ya está en `Cargo.toml`, pero registrarla cambia lo que
  aparece en la app del usuario en el teléfono, y eso no es una decisión técnica.
- **¿La nav rail flota siempre o se colapsa a íconos en ventanas angostas?** La
  `minWidth` es 900 y hoy no hay respuesta a 900.
- **¿El vidrio es el único tratamiento de superficie, o hay un modo sólido como
  fallback de rendimiento?** El presupuesto de `DESIGN.md` dice qué cortar si baja
  de 60fps (la animación del bloom primero, el blur a 16px después), pero no dice
  cómo se le ofrece eso al usuario.
- **Cuánto tarda de verdad en arrancar, y cuánto memoria usa.** `PRODUCT.md` los
  tiene como **objetivos de diseño, no como mediciones**. Nadie los ha medido. La
  sección de honestidad del README lo reconoce, y no debería seguir siendo
  necesario reconocerlo.
- **Dominio y logo final.** Sin decidir, y sin fecha.
- **Presupuesto y momento de la firma de código.**

---

## Lo que no va a pasar

Escrito para que no haya que volver a discutirlo.

- **Analytics de uso.** Cero telemetría es una restricción de producto, no una
  opción. El reporte de crash es la excepción acotada: sólo ocurre tras un crash,
  sólo con un botón, y sólo con el log ya limpiado.
- **Quitar el feed algorítmico.** El feed se queda. `PRODUCT.md` lo dice
  explícitamente y es una de las tres afirmaciones que un cliente vecino no
  podría copiar sin mentir.
- **Mover el audio a una API del webview.** Rompe las dos promesas que justifican
  la app: arranque y memoria.
- **Inter.** El detector lo marca como `overused-font` y tiene razón. Se queda
  Manrope.
- **Gradiente violeta sobre fondo oscuro.** Es el sello más reconocible de UI
  generada, y una paleta que lo lleva no puede fingir que tiene voz propia.