# El relay de reportes

Un servicio chiquito —un Cloudflare Worker— que recibe los reportes de crash y
el feedback que Starless manda, y los convierte en issues de este repositorio.

**Por qué existe.** Para crear un issue hace falta un token de GitHub. Si el
token va dentro de la app, cualquiera lo puede sacar del instalador. Si no va,
la app solo puede abrir GitHub en el navegador, y eso le pide a la persona una
cuenta de GitHub que casi nadie tiene. El relay guarda el token **del lado del
servidor**: la app solo sabe la dirección del relay, que no es un secreto.

**Qué hace en el camino:**

- Limita cuántos reportes puede mandar una misma dirección por hora (10 por
  defecto), porque cualquiera puede hacerle un POST a una URL pública.
- Agrupa los crashes repetidos: si el mismo crash —mismo lugar del código,
  mismo mensaje— ya tiene un issue abierto, el reporte nuevo se agrega como
  comentario en vez de abrir otro issue. Si el issue estaba cerrado, abre uno
  nuevo: el mismo crash después de un arreglo es una regresión.
- Pone las etiquetas: `crash`, o `feedback` con `bug` o `idea`.

**Qué guarda.** Nada de los reportes: los reportes van directo a GitHub. Solo
guarda contadores de la última hora y qué issue corresponde a cada crash, los
dos con vencimiento.

---

## Ponerlo en marcha (una sola vez)

Lo hace el dueño del repositorio, porque el token crea issues en su repo.
Toma unos 15 minutos. Hace falta [Bun](https://bun.sh) instalado y este
repositorio clonado.

### 1. Crear la cuenta de Cloudflare

Entra a <https://dash.cloudflare.com/sign-up> y crea una cuenta. El plan
gratuito alcanza de sobra: 100 000 pedidos por día, y esto recibe unos pocos.

### 2. Crear el token de GitHub

1. Entra a <https://github.com/settings/personal-access-tokens/new>
   (**Fine-grained token**, no el clásico).
2. **Token name:** `starless-relay`.
3. **Expiration:** la más larga que te deje. Anota la fecha: cuando venza, los
   reportes empiezan a fallar y hay que repetir este paso y el 5.
4. **Repository access:** *Only select repositories* → `baironvillar/Starless`.
5. **Permissions → Repository permissions → Issues:** *Read and write*. Nada
   más: ningún otro permiso.
6. **Generate token** y copia el valor (empieza con `github_pat_`). GitHub no lo
   vuelve a mostrar.

> El token no se pega en ningún archivo ni se manda por chat. Va directo a
> Cloudflare en el paso 5.

### 3. Entrar a Cloudflare desde la terminal

En la carpeta del repositorio:

```bash
bunx wrangler login
```

Se abre el navegador para autorizar. Acepta.

### 4. Crear el almacenamiento

```bash
bunx wrangler kv namespace create REPORTS --config relay/wrangler.toml
```

Imprime algo como `id = "3f2a..."`. Copia ese id y pégalo en
`relay/wrangler.toml`, en lugar de `REPLACE_WITH_THE_KV_NAMESPACE_ID`.

### 5. Guardar el token en Cloudflare

```bash
bunx wrangler secret put GITHUB_TOKEN --config relay/wrangler.toml
```

Te pide el valor: pega el token del paso 2 y Enter.

### 6. Publicar el relay

```bash
bun run relay:deploy
```

Al terminar imprime la dirección, algo como
`https://starless-relay.<tu-cuenta>.workers.dev`. Cópiala.

### 7. Probarlo

```bash
curl -X POST https://starless-relay.<tu-cuenta>.workers.dev/report \
  -H "Content-Type: application/json" \
  -d '{"kind":"other","title":"Prueba del relay","body":"Funciona.","version":"0.0.0"}'
```

Tiene que contestar `{"url":"https://github.com/.../issues/N", ...}` y aparecer
el issue en el repo. Ciérralo, es solo la prueba.

### 8. Decirle a la app dónde está

En GitHub: **Settings → Secrets and variables → Actions → Variables → New
repository variable**.

- **Name:** `STARLESS_REPORT_RELAY`
- **Value:** la dirección del paso 6, sin `/report` al final.

Es una *variable* y no un *secret*: la dirección no es secreta. Desde la
próxima versión que se publique, el botón de reportar manda por el relay.

### 9. Las etiquetas

Que existan en el repo `crash`, `feedback`, `bug` e `idea` (**Issues → Labels**).
Si falta alguna el relay crea el issue igual, sin etiquetas, pero filtrarlos
sirve para leer el tracker.

### 10. Commitear el id del paso 4

El id del almacenamiento no es secreto. Commitéalo en una rama, como cualquier
cambio (`chore/relay-kv-id`), para que el próximo despliegue use el mismo.

### 11. Probarlo con la app

La dirección del relay se compila dentro de la app, no se lee de un archivo en
tiempo de ejecución: `option_env!("STARLESS_REPORT_RELAY")` la deja en el
binario. Para una build de desarrollo con el relay adentro:

```bash
STARLESS_REPORT_RELAY=https://starless-relay.<tu-cuenta>.workers.dev bun run app
```

Con esa variable, el botón de reportar manda al relay en vez de abrir el
navegador. **Sin ella el botón abre el navegador**, que es lo que hace toda
build que no tenga la variable puesta —incluidas las locales, siempre.

Un reporte de prueba tiene que aparecer como issue en el repo en pocos
segundos. Si no aparece, `bunx wrangler tail --config relay/wrangler.toml`
muestra los pedidos en vivo y dice por qué los rechazó.

---

## Mantenimiento

| Qué pasa | Qué hacer |
|---|---|
| El token vence o se filtra | Paso 2 con un token nuevo, revoca el viejo, y paso 5. No hace falta publicar una versión nueva de la app |
| Llega spam | Baja `RATE_LIMIT` en `wrangler.toml` y `bun run relay:deploy` |
| Cambia algo en `relay/src` | `bun run relay:test` y después `bun run relay:deploy` |
| Ver qué está pasando | `bunx wrangler tail --config relay/wrangler.toml` muestra los pedidos en vivo |

Los tests del relay los corre la CI (`bun run relay:test`) en cada push a
`develop` y en cada pull request: el Worker es el código que archiva los
reportes, y un bug ahí pierde un crash entero —y la app contesta a eso
abriendo el navegador, así que el fallo se ve como una app más lenta y no como
un relay roto—.

Si el relay se cae, la app no pierde el reporte: abre GitHub en el navegador
con todo precargado, como antes.

## El contrato

`POST /report` con un JSON:

| Campo | Qué es |
|---|---|
| `kind` | `crash`, `bug`, `idea` u `other` |
| `title` | Hasta 200 caracteres |
| `body` | El reporte ya limpio de datos personales, hasta 62 000 caracteres |
| `version` | La versión de la app |
| `signature` | Solo en un crash con panic: 16 caracteres hex, el mismo para el mismo crash |

Contesta `201` con `{ url, number, duplicate: false }` para un issue nuevo, y
`200` con `duplicate: true` cuando se sumó a uno que ya existía. `429` es el
límite por hora, `400` un reporte que no se acepta y `502` un fallo de GitHub.
