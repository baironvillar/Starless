# La costura

Cada fila es un tipo de cambio y lo que tiene que acompañarlo. La última columna
no es una consecuencia teórica: es lo que se rompió, o lo que se habría roto, en
este repo.

## La tabla

| Si tocas | Tienes que | Si te lo saltas |
|---|---|---|
| Un comando Tauri nuevo | registrarlo en `generate_handler!` de `lib.rs` **y** su wrapper en `spotify.ts` | el webview invoca un comando que no existe; o el comando existe y nadie lo llama |
| Un comando que hace I/O | `async`, o el macro `spclient_command!` | un comando sin `async` corre en el hilo principal: treinta segundos de ventana congelada |
| Un código de error nuevo en Rust | una frase en `errors` (`i18n.ts`), **en los dos idiomas**: el tipo no compila si falta la inglesa | el usuario lee `bad_id` en vez de una frase |
| Texto de usuario | `i18n.ts`, **los dos idiomas a la vez** | un usuario en inglés lee español (regla 5) |
| Una lista de canciones | `trackRowKeys(tracks)` como `key` | filas perdedoras quedan montadas y pintan la lista **anterior** bajo un encabezado nuevo |
| Un fallo de pista en Rust | `Session::is_invalid()` **antes** de declarar la pista muerta | `track_unavailable` cuando lo que pasó es que se cayó la conexión. El log miente |
| Una herramienta de desarrollo | `#[cfg(debug_assertions)]` en Rust, `import.meta.env.DEV` en TS | llega a la release. La regla dice que la puerta que importa es la que *compila* |
| Un `map_err` de red | mirar `ErrorKind` antes de colapsar | `network_failed` para todo: se pierde la distinción entre "Spotify me frenó" y "se me cayó la red" |
| Un campo en un modelo | los dos lados del puente, o ninguno | un campo que el backend manda siempre en `None` y el frontend compara: una promesa que no se cumple (ver `Image`) |
| Un archivo de `index.css` | **sólo** la propiedad estándar, nunca `-webkit-` al lado | se ve perfecto en `bun run dev` y roto en la build. Visto a nivel de regla en `AGENTS.md` |
| Una dependencia | usarla en el código, o sacarla de `package.json` | `bun install` se lleva 3 paquetes que nadie importa |
| Un archivo de panic / marker | los **tres** lugares de nombre juntos (`AGENTS.md`, trampa del panic) | los reportes salen sin el panic, que es justo la falla que el reporte existe para contar |
| Un elemento de biblioteca que no es una playlist | `isDjCard` (`spotify.ts`) y el mismo predicado en **cada** lugar donde el elemento aparece | el DJ se abre como una playlist y muestra una pantalla vacía: su contenido no está en la lista |
| El panel "A continuación" | que la cuenta salga de la **cola** (`queueAt`), no de lo que se ve en pantalla | una app recién abierta muestra ocho canciones bajo un encabezado de cola que nadie pidió |
| Una canción agregada a la cola | `queueWithAdded` (`src/lib/queue.ts`), que la pone **después de la que está sonando** y **reemplaza** la copia que ya estaba | la canción agregada es la cola entera, o queda al final de una cola larga, o aparece dos veces en el panel |
| Un dato que sólo la build sabe (el canal) | la env en el paso de CI **y** el `define` de `vite.config.ts` **y** la declaración en `vite-env.d.ts` | el frontend no compila, o la app se dice "release" en una build de `develop` |

## Por qué la tabla es la parte importante

Un cambio dentro de una capa es fácil de revisar: lees la función nueva y sabes
si está bien. Un cambio entre capas no se puede revisar leyendo: **el síntoma
aparece en un archivo que no tocaste**. Por eso la lista de archivos del paso 1
existe — es la defensa contra la clase de defecto que este repo no detecta solo.

Y hay una razón mecánica por la que ni el compilador ni los tests te salvan:
**todo en el crate de Rust es `pub`**, así que `cargo check` y
`cargo check --release` pasan con cero warnings aunque hayas dejado un comando
que nadie llama. La única forma de encontrar esa clase de muerto es buscar el
lado de adentro en el lado de afuera.

## La receta de un comando nuevo

Copiar el patrón de `spclient_command!` en `lib.rs`, que ya resuelve las tres
cosas que se olvidan:

```rust
spclient_command!(mi_comando, spclient::mi_comando, MiTipo, arg: String);
```

- `async fn` con `spawn_blocking` adentro — el comando no bloquea el hilo principal
- toma `session_state` y **clona** la sesión: `State` no puede moverse al hilo
  bloqueante, la sesión sí
- traduce el error del runtime a `command_failed`, que es un código que la
  pantalla ya sabe mostrar

Del lado de TypeScript, el wrapper vive en `spotify.ts` y devuelve `invoke<MiTipo>("mi_comando", { arg })`. Si es una lectura de la biblioteca, además:

- el query key va en el objeto `keys`, no en una cadena suelta
- `staleTime` explícito. **El default de `prefetchQuery` es 0**, así que un
  prefetch sin `staleTime` no calienta nada: escribe la respuesta y la marca
  stale en el mismo paso
- `enabled:` cuando el id puede ser `null`, para que un estado de navegación no
  se convierta en una petición

## La receta de una pantalla nueva

1. Decidí de qué módulo vive el estado. Si es un estado de playback, va con el
   resto del playback. Un hook nuevo en `src/lib/` es el patrón que ya usa
   `useSearch`.
2. El componente recibe `t` — no lee `strings` por su cuenta. Las props que son
   texto de pantalla van por prop para que el componente no sepa qué idioma hay.
3. Para una lista, `trackRowKeys` y nada de `track.id` pelado.
4. Registrala en i18n ES y EN, y en el changelog (`lib/changelog.ts`) si es algo
   que el usuario va a notar.

## Cómo se agrega una regla nueva

Si un cambio tuyo rompió algo y la regla te habría detenido, esa regla entra acá
**y** en la lista de trampas de `AGENTS.md`. Las trampas de `AGENTS.md` son
cortas y llevan el "por qué"; esta tabla es operativa y completa. Una es el
porqué, la otra es el checklist. Si sólo va en una de las dos, se pierde.