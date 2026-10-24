# Verificar

Las puertas, en orden. Cada una atrapa algo distinto, y ninguna reemplaza a la
anterior. Lo que sigue es el orden en el que corren bien: lo rápido primero.

## Antes de abrir el PR

```bash
bun run lint        # Biome. 46 archivos.
bun run typecheck   # tsc --noEmit
bun run version     # los tres manifiestos tienen que coincidir
cd src-tauri && cargo check && cargo test --lib
```

Y si tocaste UI: **`bun run app`**, capturas antes y después. El diseño se juzca a
ojo, no leyendo el diff.

## Qué atrapa cada puerta

| Puerta | Atrapa | No atrapa |
|---|---|---|
| `biome check` | import sin ordenar, formato, código muerto obvio | nada de lógica. Es estilo |
| `tsc --noEmit` | un símbolo que no existe, una prop que cambió de forma | un componente que nadie renderiza |
| `bun run version` | `tauri.conf.json` desfasado del `Cargo.toml` | — |
| `cargo check` | que no compile | **nada muerto**: todo es `pub`, así que un comando sin llamadores no avisa |
| `cargo test --lib` | la limpieza del reporte de crash, el id de playlist | casi nada del frontend: el crate no sabe qué es una pantalla |
| `bun run build` | que el bundle se arme | si el CSS emitido quedó bien, que es otra cosa |

## Las dos que no están en la lista

**El CSS emitido, si tocaste `index.css`.** La regla más cara de este repo:
`bun run dev` sirve el CSS sin minificar y ahí `-webkit-backdrop-filter` al lado
de `backdrop-filter` se ve bien. En la build, Tailwind v4 minifica con Lightning
CSS y **colapsa las dos al valor prefijado**, dejando sólo la mitad que WebView2
ignora. El bug vivió semanas sin que nadie tocara el CSS.

Se comprueba sobre el CSS emitido, nunca sobre el fuente:

```bash
bun run build
# y en dist/assets/*.css, buscar una regla con backdrop-filter estándar
# que NO tenga su -webkit- al lado. Tiene que dar cero.
```

**Buscar al revés.** Antes de llamar "muerto" a un export o a un símbolo, hay que
buscar su consumidor **del otro lado del puente**. Un comando Tauri sólo se
considera muerto si ni `lib.rs` ni `spotify.ts` lo llaman. Y al revés: un
comando registrado al que nadie llama desde el frontend no es una función
pública útil, es código muerto con handler incluido.

## Lo que ninguna puerta de este repo puede chequear

**Que la app suene y se vea.** `bun run dev` es Vite solo: no hay backend, no hay
audio, y varias cosas callan en silencio sin que ningún error aparezca. Para
audio y sesión hace falta `bun run app`.

Por eso la regla del backend es la frontera de confianza: el webview nunca ve una
credencial, pregunta si hay sesión y recibe un booleano y un nombre. Un bug que
necesita un token en el frontend no es un bug de implementación, es un bug de
diseño, y ninguna puerta lo va a avisar.