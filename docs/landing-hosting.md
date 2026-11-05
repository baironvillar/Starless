# Dónde vive la landing / Where the landing lives

La landing (`site/`) se publica en dos lugares a la vez: en **Vercel**, que es la
dirección que se comparte por ahora, y en **GitHub Pages**, que sigue andando
como estaba. Las dos salen de `main`: la landing ofrece la release pública, y
`main` es lo que ya salió.

The landing (`site/`) is published in two places: **Vercel**, the address shared
for now, and **GitHub Pages**, which keeps working as before. Both come from
`main`.

## La diferencia es la dirección

| | GitHub Pages | Vercel |
| --- | --- | --- |
| Dirección | `https://baironvillar.github.io/Starless/` | la del proyecto en Vercel |
| `base` | `/Starless` | `/` |
| Quién publica | `.github/workflows/pages.yml` | la integración de Git de Vercel |

GitHub Pages sirve un sitio de proyecto bajo el nombre del repositorio, así que
todo enlace empieza con `/Starless`. Vercel lo sirve en la raíz de su dominio.
`site/astro.config.mjs` elige según `VERCEL`, que Vercel pone en su build, y el
marcado lee el prefijo de `import.meta.env.BASE_URL`. **Un enlace interno nuevo
va con `BASE_URL`, nunca con `/Starless` ni con `/` escritos a mano**: con el
prefijo equivocado la página carga sin ícono, sin el logo de vidrio y sin
fuentes, y no dice por qué.

## El proyecto en Vercel

Se configura una vez, en el panel de Vercel:

- **Repositorio:** `baironvillar/Starless`.
- **Root Directory:** `site`. Vercel detecta Astro y `bun.lock` solo.
- **Production Branch:** `main`.

Las otras ramas dan *previews*, que no son la dirección pública. Un cambio en
la landing llega a la dirección de Vercel cuando llega a `main`, igual que en
Pages.
