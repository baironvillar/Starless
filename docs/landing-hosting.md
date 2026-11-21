# Dónde vive la landing / Where the landing lives

La landing (`site/`) se publica en **Cloudflare**, como un Worker que sirve los
archivos estáticos de `astro build`. Sale de `main`: la landing ofrece la
release pública, y `main` es lo que ya salió.

The landing (`site/`) is published on **Cloudflare**, as a Worker that serves
the static files `astro build` writes. It ships from `main`.

## Antes / Before

Hasta noviembre de 2026 se publicaba en dos lugares: en Vercel, en la raíz de
su dominio, y en GitHub Pages, bajo `/StarMusic`.
`astro.config.mjs` elegía el prefijo leyendo `VERCEL`. Con la mudanza del repo a
`Starless-org` las dos se dejaron: Pages ya no estaba activado en el repo, y
Vercel se reemplazó por Cloudflare, donde ya vive el relay.

## Cómo se publica

| | |
| --- | --- |
| Dirección | `https://star-music.bairovillar.workers.dev` |
| `base` | `/` |
| Quién publica | `.github/workflows/landing.yml`, en cada push a `main` que toque `site/` |
| Configuración | `site/wrangler.jsonc` |

El marcado lee el prefijo de `import.meta.env.BASE_URL`. **Un enlace interno
nuevo va con `BASE_URL`, nunca con `/` escrito a mano**: si algún día la página
vuelve a vivir bajo un prefijo, con el prefijo equivocado carga sin ícono, sin
el logo de vidrio y sin fuentes, y no dice por qué.

## Lo que necesita el workflow

Dos secretos del repo, que se cargan una vez:

- **`CLOUDFLARE_ACCOUNT_ID`**: el id de la cuenta (`bunx wrangler whoami`).
- **`CLOUDFLARE_API_TOKEN`**: un token de la plantilla *Edit Cloudflare
  Workers*, creado en <https://dash.cloudflare.com/profile/api-tokens>. Sólo
  puede editar Workers; no es la sesión de nadie.

Sin ellos el workflow falla en el paso de Cloudflare y la landing sigue con la
versión anterior.

A mano, desde `site/`: `bun run build && bunx wrangler deploy`.

## Un dominio propio

Cuando la landing tenga dominio: se agrega como *Custom Domain* del Worker
`star-music` en Cloudflare, y se cambia `site` en `astro.config.mjs`, que es la
dirección absoluta a la que apunta la tarjeta para compartir.
