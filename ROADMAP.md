# Roadmap

Ordenado por releases, no por fechas. **Una fecha sin decidir es una promesa que
no se puede cumplir**, así que nada acá lleva fecha; lo que lleva es un orden y una
razón. La fuente de cada punto son las preguntas que ya están abiertas y escritas
en [`PRODUCT.md`](PRODUCT.md) y [`DESIGN.md`](DESIGN.md).

> Ordenado por releases, not by dates. **A date nobody has decided on is a promise
> nobody can keep**, so nothing here carries one. What it carries is an order and a
> reason.

---

## Cómo se numeran las versiones

Una release no se numera por lo que costó, sino por lo que cambió. El número es
una promesa sobre el tamaño del cambio, y esa promesa tiene que ser cierta.

| Clase | Forma | Qué significa |
|---|---|---|
| Un parche | `0.3.3` → `0.3.4` | **Sólo correcciones.** Nada nuevo, nada que haya que aprender, nada que se comporte distinto de lo que ya se sabía. |
| Una mejora | `0.3.4` → `0.4.0` | **Algo que antes no existía.** Una sección, un ajuste, un canal de pruebas. |
| Un cambio grande | `0.9.7` → `1.0.0` | **El que corta con lo anterior.** Menos versiones, otra promesa de la app. |

Tres reglas que acompañan al número:

1. **Las notas se escriben antes que el tag**, en `CHANGELOG.md` y en
   `src/lib/changelog.ts`, siempre en los dos idiomas. Son lo primero que va a
   leer la persona a la que algo le salió mal, y por eso es el peor lugar para
   dejarle un idioma que no eligió.
2. **Una entrada de changelog que describe algo que no llegó al binario es peor
   que no tener changelog.** Si no se puede escribir la línea, no se sube el
   tag.
3. **El tag manda sobre el changelog, nunca al revés.** El workflow se niega a
   publicar si `v0.4.0` y `tauri.conf.json` no dicen lo mismo.

`bun run version:bump patch|minor|major` mueve el número en los tres manifiestos.
No decide *cuál* de los tres corresponde: eso lo decide qué cambió.

---

## 0.3.x — Lo que ya salió

History, not a plan. Está acá para que nadie vuelva a planearlo.

- **La biblioteca se vaciaba a la hora.** `token::ensure_fresh` —un viaje HTTP
  bloqueante— se llamaba en el comando `async`, antes del `spawn_blocking`.
  Construir un cliente bloqueante de reqwest dentro de un runtime async hace
  panic, el comando moría antes de pedir nada, y el log no mostraba ninguna
  línea `webapi:`. Sólo pasaba cuando el token ya estaba por vencer. **Una línea
  de código.**
- **Un mal arranque dejaba la biblioteca vacía hasta reiniciar.** `OnceLock`
  cacheaba el fallo de construcción del cliente HTTP como si fuera un cliente.
- **El token largo se perdía solo.** Si Spotify respondía a una renovación con
  un solo token de acceso, el token de refresco se guardaba vacío encima del que
  sí servía, y al vencimiento siguiente no había con qué volver a entrar.
- **El vidrio no salía difuminado en la build compilada.** El minificador de
  Tailwind colapsaba `backdrop-filter` y `-webkit-backdrop-filter` y se quedaba
  con la prefijada, que es la que WebView2 ignora. `bun run dev` lo escondía
  porque ahí el CSS no pasa por el minificador.
- **Personalización.** Opacidad de los menús, aprendida entre arranques, con
  muestra en vivo.
- **Reportes.** El log deja de cortarse por el medio, el aviso de caída se abre
  sin Equis ni Enter, y el feedback se puede escribir sin haber iniciado sesión.

---

## 0.4.0 — Una segunda app que no toca la primera

La primera release que **no agrega una pantalla**. Sube el número menor igual,
porque agrega algo que antes no existía: la posibilidad de romper una build sin
que a nadie le avise de una actualización.

- **Rama `develop`.** El trabajo que todavía no está listo vive ahí; `main` es lo
  que recibe un tag. Las dos se compilan igual, con los mismos chequeos.
- **El workflow publica prerelease cuando el tag no viene de `main`.** Es lo que
  convierte la rama en algo más que una carpeta: GitHub no redirige
  `releases/latest` hacia una prerelease, así que la app instalada no se entera
  nunca. El tag sigue siendo el disparador; de qué rama salió decide si la
  release es pública.
- **Instaladores de `develop`** marcados como prerelease, firmados con la misma
  clave, para probar sobre Windows de verdad y no sólo con `bun run app`.

Lo que **no** hace: no cambia una sola línea del audio, ni de la sesión, ni de la
biblioteca. Si una build de `develop` rompe algo, ese algo se arregla en
`develop` y `main` no se entera hasta que el arreglo esté de vuelta acá.

---

## 0.5.0 — Salir del círculo de Windows

- **Firma de código en los instaladores.** Es la deuda más visible del producto:
  hoy SmartScreen y Gatekeeper avisan, y `PRODUCT.md` lo asume como responsable.
  Cuesta dinero y tiempo; hasta que se pague, la primera ejecución tiene que
  seguir explicándolo en vez de dejar que la app lo descubra sola.
- **macOS.** El backend ya es multiplataforma por construcción (rodio → cpal, y
  cpal ya habla CoreAudio); lo que falta es probarlo de verdad, un `.app` firmado
  y los permisos de audio.
- **Linux.** `libasound2-dev` al compilar, y AppImage o `.deb`. Sin soporte de
  Wayland todavía.

---

## 0.6.0 — Accesibilidad, que es la deuda que más pesa

`PRODUCT.md` lo dice sin llamarlo por su nombre: **no está acordado ningún nivel de
conformidad**, y hay preguntas abiertas sobre contraste, teclado y etiquetado para
lectores de pantalla. Es el bloque más grande de trabajo del roadmap, y también el
menos controversial: no hay ni una decisión que tomar, sólo que hacer.

- Auditoría real: foco visible, navegación por teclado completa en transporte y
  navegación, `aria-label` en todo lo que hoy se comunica sólo por color.
- Objetivos de contraste fijados y verificados contra `#0A0A12` y contra el
  vidrio, no contra capturas.
- Idioma del sistema para lectores de pantalla, no sólo el nuestro.

---

## 1.0.0 — La app al 100% de su primera etapa

Un número mayor promete que algo corta con lo anterior. Acá lo que marca es otra
cosa, y conviene decirlo: es la primera versión donde **todo lo que `PRODUCT.md`
promete está medido**, y las promesas dejan de ser objetivos de diseño.

- **Arranque por debajo de un segundo, medido**, con el número en el README en
  lugar de una promesa.
- **Memoria medida** mientras reproduce.
- **Firma de código en los instaladores.** SmartScreen deja de avisar.
- **Un nivel de accesibilidad declarado**, no un conjunto de preguntas abiertas.
- **Windows firmado y estable, con macOS y Linux como plataformas de primera
  clase** y no como «siguen a Windows».

Es el número que significa que la primera etapa está completa. Lo que venga
después es otra etapa, y este documento se escribe de nuevo entonces.

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
  cómo se le ofrece eso al usuario. La opacidad de los menús ya es un primer
  paso, y no resuelve esta.
- **Dominio y logo final.** Sin decidir.
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