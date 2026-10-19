# Actualizaciones

Cómo llega una versión nueva a alguien que ya tiene Starless instalado.

## La idea

GitHub Releases es el servidor. No hay ninguno propio, ni base de datos, ni
servicio que alguien tenga que pagar o mantener. El manifest `latest.json` que
Tauri consulta está adjunto a la última release, y GitHub redirige esa URL a la
release más reciente.

```
App instalada  ──GET──▶  github.com/OWNER/REPO/releases/latest/download/latest.json
                                    │
                          dice qué versión hay y de dónde bajarla
                                    │
                          descarga el .zip, verifica la firma
                                    │
                          el instalador reemplaza la app
```

## Una vez, en esta máquina

```bash
bun run updater:key        # genera el par de llaves; te pide una contraseña
bun run updater:pubkey     # copia la pública a src-tauri/tauri.conf.json
```

La privada queda en `.secrets/starless-updater.key`, que está en `.gitignore`.

**No la regeneres.** Una llave nueva invalida la confianza de todas las
instalaciones que ya tienen la pública vieja, y esas copias dejan de poder
actualizarse. La pública va embebida en cada instalador que sale, así que no es
algo que se pueda cambiar después.

## Una vez, en GitHub

La firma la hace la CI, y para eso la clave tiene que estar en
**Settings → Secrets and variables → Actions** como secreto del repositorio:

| Secreto | Qué es |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | el contenido de `.secrets/starless-updater.key`, entero |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | la contraseña que elegiste al generarla |

Que la clave viva en los servidores de GitHub es una decisión, y para un proyecto
sin telemetría conviene tenerla presente: la clave puede firmar una release, no
leer la biblioteca ni ver un log. Si algún día preferís que no salga de tu disco,
la alternativa es un runner propio —la release se compila igual, sólo que en tu
máquina en vez de en la de GitHub.

## En cada release

```bash
bun run version:bump patch          # 0.3.0 -> 0.3.1 en los tres manifiestos
git commit -am "0.3.1"              # el asunto es la versión y nada más
git tag v0.3.1 && git push --follow-tags
```

El asunto del commit que lleva el tag es **la versión y nada más**. No es
estética: GitHub titula la corrida de un tag con el asunto del commit etiquetado
y no con el nombre del workflow, así que ese texto es el nombre que queda
escrito al lado de la release. Si el merge a `main` no es fast-forward, el mismo
asunto: `git merge --no-ff develop -m "0.3.1"`. El hook de `.githooks/` y el
workflow lo cobran; ver [`CONTRIBUTING.md`](../CONTRIBUTING.md#los-mensajes-de-commit--commit-messages).

Eso es todo. El workflow de `.github/workflows/release.yml` se dispara con el tag
y hace el resto: corre `lint`, `typecheck`, `bun run version` y `cargo test
--lib`; compila en un runner de Windows; firma los artefactos; genera
`latest.json`; crea la release y adjunta los instaladores, los `.sig` y el
manifest.

Dos cosas las hace él y hay que saber que están:

- **Verifica que el tag coincida con la versión** de `src-tauri/tauri.conf.json`.
  Un tag que no coincide produce un `latest.json` que promete un archivo que la app
  instalada nunca va a pedir, y el comprobador queda mudo para siempre.
- **Deja la release en borrador.** Es a propósito: la dirección que consulta la app
  instalada es `releases/latest/download/latest.json`, y GitHub no redirecciona a
  los borradores. Publicarla a mano es el paso que hace pública la release recién
  cuando los archivos ya están arriba, en vez de unos segundos antes.
- **Cobra que el commit etiquetado siga la convención de mensajes**, antes de
  instalar nada. Es el paso más barato de todos y el que decide si el nombre de la
  corrida queda legible o si es una frase entera.

Cuando termine, la release aparece como borrador en la pestaña *Releases*. Revisala
y le das a **Publish release**. Recién ahí la app instalada la ve.

Qué número corresponde a cada tipo de release está escrito en
[`ROADMAP.md`](../ROADMAP.md#cómo-se-numeran-las-versiones). En corto: los parches
sólo corrigen, las mejoras agregan algo que antes no existía, y el número mayor
significa que corta con lo anterior.

## La rama `develop`

`main` es la app que recibe un tag. `develop` es donde vive el trabajo que todavía
no está listo, y también se publica — con una diferencia: si el tag **no** viene de
`main`, el workflow marca la release como prerelease.

Eso no es un detalle cosmético. La app instalada consulta
`releases/latest/download/latest.json`, y GitHub no redirige `releases/latest`
hacia una prerelease: es la razón por la que una build de `develop` puede romper lo
que quiera sin que nadie reciba un aviso de actualización. La pregunta está
invertida a propósito —"¿este commit llegó a `main`?"— para que un tag desde
cualquier otro lado caiga en prerelease y no en una release pública por descuido.

El flujo diario es el mismo en las dos ramas; lo único que cambia es de dónde sale
el tag.

### Para probarlo antes de que exista una release

El endpoint devuelve 404 hasta que haya una release, así que el comprobador
siempre dice "estás al día" hasta la primera. Para una build de prueba sin firmar:

```bash
bun run tauri build --no-bundle
```

No genera `latest.json` ni toca nada de la release: sirve para ver la app
funcionando antes de que exista la versión pública.

## Por qué la firma no es opcional

SmartScreen se queja igual con o sin firma: ese aviso dice quién construyó el
archivo, y ya se aceptó. La firma del actualizador dice otra cosa — **quién está
respondiendo la URL de actualización**.

Sin ella, cualquiera que intercepte esa petición (una red hostil, una respuesta
DNS, un espejo comprometido) elige el próximo binario que se instala en la
máquina de cada usuario de Starless. No es el mismo riesgo que el de SmartScreen,
y este se cierra gratis.

## Lo que decide la app, no el plugin

- **Comprueba al arrancar**, una sola vez, 2.5 s después de abrirse. No descarga
  nada.
- **No instala sola.** El botón está en Ajustes → General. Starless está sonando;
  una app que corta la música para instalar un parche es una app que la gente
  apaga.
- **Un fallo al comprobar no se muestra.** Significa que GitHub no respondió, lo
  cual es un hecho de la red y no de la instalación.

## Lo que todavía no funciona, y por qué

**0.3.0 es el primer binario que se publica, y ya viene con el actualizador
dentro.** La `pubkey` va embebida en el ejecutable, así que una copia instalada
recibirá sola la primera versión que salga después. Lo que no se puede afirmar
todavía es que funcione: se prueba recién cuando exista una 0.4.0 publicada, que
es la primera vez que una copia instalada tiene algo a qué actualizarse. Hasta
entonces, quien baje 0.3.0 y no la vuelva a abrir no se entera de que hay una
versión nueva — y eso es exactamente lo que hace el comprobador cuando GitHub no
responde.

**El endpoint ya apunta al repositorio real.** En `src-tauri/tauri.conf.json`:

```json
"endpoints": ["https://github.com/baironvillar/Starless/releases/latest/download/latest.json"]
```

Si bifurcaste el repo, cámbialo por el tuyo: mientras apunte a otro lado, el
comprobador siempre dirá que estás al día. Una URL que no existe también viene
con «no hay nada nuevo», y ese fallo silencioso es justo el que hace que un
actualizador roto parezca uno que funciona.

Lo mismo con `STARLESS_REPO`: el manifest se construye con las URLs del repo que
le pases, así que un fork que olvide cambiarlo publica un `latest.json` que
apunta a releases ajenas. **En la CI esto ya no se puede equivocar**: el action
arma el `latest.json` con el repositorio desde el que corre, así que el
`STARLESS_REPO` manual dejó de tener sentido y sólo queda como herramienta para
generar el manifest localmente.

**La `pubkey` es un marcador** hasta que corras `bun run updater:pubkey`. Con el
marcador, `tauri build` falla — a propósito. Un actualizador sin llave pública es
un actualizador que no verifica nada, y prefiere no compilar antes que compilar
inseguro.