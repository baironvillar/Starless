---
name: starless
description: Use when adding a feature, changing behaviour, fixing a bug, or removing code in the Starless repository — anything that touches src/** or src-tauri/**. Encodes the order of operations and the cross-layer checklist that keeps a change from breaking something that already works. Covers adding a Tauri command, a React Query hook, a screen, a setting, a Rust model field, or an error code; reading the library; playing audio; editing playlists; and cleaning up dead code. Not for visual design — use impeccable for that.
version: 1.0.0
user-invocable: true
argument-hint: "[agregar | cambiar | corregir | limpiar] <qué>"
---

Las reglas de este repo están en `AGENTS.md` y ahí se quedan: qué se rompe, por
qué, y qué trampas ya pagamos una vez. Este skill no las repite. Respondería la
otra pregunta, que es la que se responde mal: **en qué orden se hace un cambio,
y qué se actualiza del otro lado cuando se toca algo de acá.**

La mayoría de las roturas de este repo no están dentro de una función. Están
**entre** dos capas, donde nadie está mirando: un campo que el backend nunca
manda y el frontend igual compara; un código de error que Rust emite y nadie
traduce; un comando registrado que ya no lo llama nadie. Dos auditorías
independientes sobre este repo encontraron, las dos, que esa es la clase de
defecto dominante.

## Antes de tocar nada

En este orden, y en ninguno se saltea el primero:

1. **`AGENTS.md` completo.** Es el mapa y la lista de trampas. Tiene reglas que
   no son preferencias.
2. **`PRODUCT.md` y `DESIGN.md`** si el cambio se ve o se escucha. `DESIGN.md` es
   la fuente de la verdad del color y del vidrio: si tocas `index.css`,
   el valor nuevo va en `@theme` y no en una constante duplicada.
3. **La trampa específica del área que vas a tocar.** `AGENTS.md` las lista todas
   con el "por qué" de cada una; buscala por palabra clave, no las leas de memoria.
4. **Si tocas creación de playlists, `docs/escribir-playlists.md` primero.** Es
   el único lugar con la receta y con la lista de lo ya descartado.

## El recorrido de un cambio

**1. Encontrá la costura.** Antes de editar, listá los archivos de *ambos* lados
que el cambio obliga a tocar. La pregunta no es "¿dónde va este código?" sino
**"¿qué se rompe del otro lado si escribo sólo esto?"**. Escribí la lista. Si la
lista tiene un solo elemento del mismo lado, sospechá: casi siempre falta otro.

**2. Pasá la tabla de la costura** ([reference/capas.md](reference/capas.md)).
Cada fila es un tipo de cambio y lo que tiene que acompañarlo. La columna de la
derecha dice qué se rompe si se lo saltea — para que la regla se lea por lo que
evita y no por lo que exige.

**3. Escribí el comentario que explica el porqué.** La convención del repo: el
código dice qué hace, el comentario dice por qué esa forma y no la evidente, y
qué se rompió antes. Hay comentarios que existen porque algo falló en vivo; no
son redundantes y no se borran por "limpiar".

**4. Verificá** ([reference/verificar.md](reference/verificar.md)). Las puertas
que tienen que pasar, en orden, y qué atrapa cada una. Si tocaste UI, capturas
antes y después: el diseño se juzga a ojo, no leyendo el diff.

## Señales de que algo se rompió

Si ves cualquiera de estas, algo se te quedó del otro lado:

- Un `tsc` limpio y un comando que nadie llama: eso es código muerto, y
  `cargo check` **no lo avisa** porque todo en el crate es `pub`.
- Un `expect` o un `unwrap()` nuevo sobre I/O o sobre dato del usuario.
- Una pantalla que dice un código (`bad_id`, `no_session`) en vez de una frase.
- Un `map_err` que colapsa todo a `network_failed`: borra la distinción entre
  "Spotify me frenó" y "se me cayó la red".
- Un `.tsx` con un string de usuario que no está en `i18n.ts`, o en un solo idioma.
- Una lista de canciones con `track.id` como `key`.
- Un archivo editado con un script de shell en vez del editor. PowerShell 5.1
  `Set-Content -Encoding UTF8` **escribe un BOM** y `Get-Content` sin `-Encoding`
  **destruye los acentos**: un em-dash `—` vuelve `â€"`. Después no se ve en el
  diff de texto, se ve en `bun run lint` como si nada, y en pantalla como
  caracteres rotos. Para renombrar en varios archivos, `edit` archivo por
  archivo.

## Dudas ya conocidas

Las trampas que siguen en pie, con su evidencia, están en
[reference/deudas.md](reference/deudas.md). No las redescubiertas: están
escritas porque son reales y ya se midieron.