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

## 0.3.x – 0.5.x — Lo que ya salió

Historia, no plan. Está acá para que nadie vuelva a planearlo. El detalle de cada
versión está en [`CHANGELOG.md`](CHANGELOG.md).

- **0.3.x — Que la biblioteca no se vaciara sola.** El token, el cliente HTTP y el
  vidrio difuminado en la build compilada. Personalización de la opacidad de los
  menús y reportes de crash que no se cortan.
- **0.4.0 — Una segunda app que no toca la primera.** La rama `develop`, las
  prereleases y los instaladores de prueba firmados con la misma clave.
- **0.5.0 — El DJ, la pantalla de playlists y escribir en la biblioteca.** El DJ
  suena y habla con su voz, las playlists se ven como en el cliente oficial y se
  puede agregar una canción a una playlist o crear una nueva. La app se reconecta
  sola cuando se cae la sesión o se traba el dispositivo de audio.
- **0.5.1 – 0.5.3 — El canal de prerelease.** La app sabe si es una prerelease,
  la encuentra, la instala y puede volver a la línea pública.
- **0.5.4 — Editar una playlist.** Portada, nombre, descripción y «Hacerla
  privada». La biblioteca carga en vez de esperar 5,5 segundos.
- **0.5.5 — La música no se corta.** Al terminar una lista sigue la radio, y
  elegir una canción de la búsqueda arranca su radio. Las canciones se encadenan
  solas cuando una termina, con la transición a tu medida.

**Lo que estaba prometido para la 0.5.0 y no salió:** la firma de código, macOS
y Linux. No se cayeron del plan: se movieron a la 0.8.0, porque antes de llevar
la app a otras plataformas tiene que ser estable en la que ya está.

---

## 0.6.0 — El jam, y lo que ya funcionaba mejor

La primera versión cuyo objetivo es **que lo que ya existe funcione mejor**, no
agregar pantallas. Es una mejora y no un parche porque trae cosas que antes no
existían —el jam, un ajuste que se recuerda, los errores en los dos idiomas—, y
una de ellas es una sección nueva.

La 0.5.6 nunca se publicó: no hubo tag ni release, y su contenido quedó en esta
versión. Quien actualiza desde la 0.5.5 ve todo eso junto con lo de acá.

### Lo que ya está

- **El jam.** El botón está arriba a la derecha, junto a los amigos, y abre el panel
  de actividad de escucha: se puede **empezar un jam**, copiar el **código para
  compartir**, ver quién está adentro, entrar a uno con un código y terminarlo. El
  jam es una sesión y no una playlist: tiene dueño, invitados y un código, y no
  vive en la biblioteca. Las tres puertas —abrir, entrar, cerrar— se midieron
  contra el servicio con una sesión de verdad; el protocolo está en
  [`docs/jam.md`](docs/jam.md).
- **El orden y la vista de las listas se recuerdan.** El orden, su dirección y la
  vista Compacta o Lista van a `%LOCALAPPDATA%\Starless`, como el resto de los
  ajustes que sobreviven a un cierre de sesión (ver la trampa de `%APPDATA%` en
  `AGENTS.md`).
- **Mensajes de error en los dos idiomas.** Las frases de los códigos de error
  pasaron de `lib/spotify.ts` a `lib/i18n.ts`, con el inglés escrito para leer
  natural, y `explain()` contesta en el idioma de la app.
- **60 fps, medidos.** Con la música sonando todo iba a 30 fps, y en una lista
  larga cualquier cambio congelaba la ventana entre 300 y 700 milisegundos. El
  ecualizador de la fila que suena animaba `height` y las barras `width` y `left`;
  ahora animan escala y desplazamiento. Y la app ya no dibuja mil filas para
  mostrar unas pocas: `useRowWindow` dibuja las que están cerca de la pantalla.
  Medido con un contador de cuadros dentro de la app en marcha: 60 fps con la
  música sonando, ordenando una lista, moviendo el volumen y abriendo la cola.
  **Lo que no se midió es si el vidrio es el que cuesta**: esa pregunta sigue
  abierta en la sección de abajo.

### Lo que falta

- **Arranque y memoria medidos.** `PRODUCT.md` promete arrancar en menos de un
  segundo y gastar poca memoria, y hoy son objetivos, no números. Se mide en una
  máquina de referencia, con la build de release y no con `bun run app`, y el
  número va al README. El log ya dice cuánto tarda cada lectura (desde la 0.5.4);
  falta el arranque completo y la memoria mientras reproduce. **Sin un número
  medido antes, no se puede decir que algo de esta versión lo mejoró.**
- **Ventanas angostas.** La ventana se puede achicar hasta 900 px y a ese ancho
  no hay una respuesta decidida para la barra lateral: si flota siempre o se
  colapsa a íconos. Era una pregunta abierta; esta versión la responde.

Fuera de la app, la página de inicio pasó a ser un sitio propio en `site/`, con su
propio `package.json` y su propio workflow, y se publica desde `main`. No entra
en el binario ni en las notas de la app.

---

## 0.7.0 — Accesibilidad, que es la deuda que más pesa

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

## 0.8.0 — Salir del círculo de Windows

Estaba en la 0.5.0 y se movió acá: una app inestable en tres plataformas es tres
veces el trabajo de una inestable en una.

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

## 1.0.0 — La app al 100% de su primera etapa

Un número mayor promete que algo corta con lo anterior. Acá lo que marca es otra
cosa, y conviene decirlo: es la primera versión donde **todo lo que `PRODUCT.md`
promete está medido**, y las promesas dejan de ser objetivos de diseño.

- **Arranque por debajo de un segundo y memoria acotada**, con los números de la
  0.6.0 vigilados en cada release y no medidos una sola vez.
- **Firma de código en los instaladores.** SmartScreen deja de avisar.
- **Un nivel de accesibilidad declarado**, no un conjunto de preguntas abiertas.
- **Windows firmado y estable, con macOS y Linux como plataformas de primera
  clase** y no como «siguen a Windows».

Es el número que significa que la primera etapa está completa. Lo que venga
después es otra etapa, y este documento se escribe de nuevo entonces.

---

## Sin fecha — Investigar primero

Cosas que se quieren pero que **no se pueden prometer hasta medir si la puerta
existe**. Es el mismo camino que tuvo la voz del DJ: primero una sonda que prueba
que el servicio responde, y recién después una versión con número.

### Que la escucha en Starless cuente en Spotify

**El problema.** Spotify cuenta los minutos escuchados por semana, las
reproducciones de cada canción, «Reproducido recientemente» y el resumen del año
(Wrapped). Lo que se escucha en Starless no aparece en ninguno de los cuatro: para
la cuenta es como si no se hubiera escuchado nada.

**Por qué pasa.** Spotify no cuenta lo que suena: cuenta lo que los clientes le
**reportan**. Los clientes oficiales mandan, por cada canción, eventos de
reproducción —cuándo empezó, cuántos milisegundos sonó de verdad, si se adelantó o
se saltó, y por qué terminó— a un servicio de eventos interno. librespot reproduce
el audio pero no manda esos eventos, así que la escucha nunca llega a la cuenta.

**Lo que hay que investigar, en este orden:**

1. **La puerta.** Qué endpoint recibe los eventos y con qué identidad: si acepta
   el token de la sesión de librespot (como `client-tts` para la voz del DJ) o
   pide algo más. Se busca en el binario del cliente oficial, igual que se
   encontró `client-tts/v1/fulfill`.
2. **El formato.** Qué mensajes hacen falta para que una reproducción cuente:
   probablemente un protobuf por canción con el id, el contexto (playlist, radio,
   DJ), el tiempo realmente reproducido y el motivo de inicio y de fin. Hay que
   saber cuáles son obligatorios y cuáles opcionales.
3. **La prueba.** Una sonda en debug (`STARLESS_SP_PLAYS=1`, como las otras) que
   reporta una canción escuchada entera y comprueba que aparece en «Reproducido
   recientemente» de la cuenta. Si no aparece, la investigación no terminó.

**Cómo se reporta, si la puerta existe:**

- **Sólo lo que de verdad sonó.** El tiempo sale de la posición real del player
  (`playback.rs`), no del reloj: una pausa no suma, un salto no suma, una canción
  con el volumen en cero o con el dispositivo trabado (el watchdog lo detecta) no
  suma. Esto no es para inflar números: es para que la escucha real cuente igual
  que en la app oficial.
- **Sale desde Rust, nunca desde el webview.** Es la misma regla que el audio y
  las credenciales: el backend es la frontera de confianza.
- **Con permiso.** No es telemetría de Starless —los datos van a la cuenta de la
  persona, en el servicio que ella ya usa—, pero sí es algo que sale de la máquina
  por cada canción, y la regla de cero telemetría existe para que nada salga sin
  que la persona lo sepa. Por eso la primera vez la app **pregunta** si quiere que
  su escucha cuente en Spotify, con un sí y un no del mismo tamaño, y la respuesta
  queda como un ajuste que se puede cambiar en Ajustes. Hasta que la persona
  responde, no se reporta nada.
- **Si falla, no rompe nada.** Un reporte que no sale se descarta y queda una
  línea en el log; nunca corta la música ni muestra un error en pantalla.

**El riesgo.** Es una puerta interna de Spotify, sin documentación, y puede
cambiar sin aviso, como todo lo que usa librespot. Y si el servicio pide una
identidad que la sesión no tiene, la respuesta es que no se puede, y este punto
se cierra en vez de buscar otra identidad (ver la regla 7 de `AGENTS.md`).

### Las preguntas abiertas de verdad

Estas están escritas como preguntas en `PRODUCT.md` y `DESIGN.md` y siguen sin
respuesta. No están en ninguna versión porque no se han decidido.

- **¿Starless se registra como un dispositivo Spotify Connect?** La dependencia
  `librespot-connect` ya está en `Cargo.toml`, pero registrarla cambia lo que
  aparece en la app del usuario en el teléfono, y eso no es una decisión técnica.
- **¿El vidrio es el único tratamiento de superficie, o hay un modo sólido como
  fallback de rendimiento?** El presupuesto de `DESIGN.md` dice qué cortar si baja
  de 60fps, pero no dice cómo se le ofrece eso al usuario. La medición de la 0.6.0
  es la que va a decir si hace falta.
- **Dominio y logo final.** Sin decidir.
- **Presupuesto y momento de la firma de código.** Decide cuándo puede salir la
  0.8.0.

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
- **Inflar reproducciones.** Si la escucha llega a contar en Spotify, cuenta lo
  que de verdad sonó y nada más: ni canciones en silencio, ni en bucle sin nadie
  escuchando, ni reportes de algo que no se reprodujo. Va contra los términos de
  Spotify, pone en riesgo la cuenta de la persona, y una app que le miente a un
  servicio no puede pedir que se le crea cuando dice que no le miente a nadie más.
