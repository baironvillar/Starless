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

## Una vez, en esta máquina y en GitHub

La llave del updater ya existe. Para revisar que esté todo en su lugar:

```bash
bunx star init updater
```

Mira la llave pública de `src-tauri/tauri.conf.json`, el secreto
`TAURI_SIGNING_PRIVATE_KEY` en GitHub (sólo su nombre: el valor no se puede
leer) y el respaldo en `~/.star/keys/app.starless.desktop/`, fuera del repo.
La llave de siempre también está en `.secrets/starless-updater.key`, que está
en `.gitignore`. Guárdala además en un gestor de contraseñas.

**No la regeneres.** Una llave nueva invalida la confianza de todas las
instalaciones que ya tienen la pública vieja, y esas copias dejan de poder
actualizarse. La pública va embebida en cada instalador que sale. `star init
updater` se niega a generar una llave para una app que ya tiene una.

| Secreto | Qué es |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | la llave privada, entera |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | la contraseña con la que se generó |

Que la llave viva en los servidores de GitHub es una decisión, y para un
proyecto sin telemetría conviene tenerla presente: la llave puede firmar una
release, no leer la biblioteca ni ver un log.

## En cada release

La release la hace [star](https://github.com/baironvillar/star), en dos pasos.
Nadie commitea directo en `develop` ni en `main` (ver
[`CONTRIBUTING.md`](../CONTRIBUTING.md#branches-and-pull-requests)), y la
versión tampoco: sale de una rama `release/<versión>` y llega a `develop` por
un PR.

1. **Escribe las notas** en `CHANGELOG.md`, bajo `## [Sin publicar]`, y la
   entrada en `src/lib/changelog.ts` (la que la app muestra en Diagnóstico), en
   los dos idiomas. No hace falta commitear el changelog: viaja en el commit de
   la versión.
2. **Prepara la versión**, desde `develop` al día:

   ```bash
   git switch develop && git pull
   bun run release minor
   ```

   star revisa que todo esté en orden (en `develop`, al día con `origin`, sin
   cambios fuera del changelog, los cuatro manifiestos de acuerdo, tag y rama
   libres, notas escritas) y corre la puerta de `"star": { "gate" }` en
   `package.json`: lint, tipos, tests y `cargo test --lib`. Muestra el cambio,
   convierte `## [Sin publicar]` en la sección de la versión y pregunta. Con
   un sí crea `release/0.7.0`, commitea `0.7.0`, empuja y abre el PR.
3. **Termina la versión** cuando el CI del PR pase:

   ```bash
   bun run release finish
   ```

   Mergea el PR con squash usando `0.7.0` como asunto (sin el `(#42)` que
   GitHub agregaría), actualiza `develop` y empuja el tag `v0.7.0`. El tag
   dispara el workflow.
4. **Publica la release** cuando el workflow termine: queda en borrador en la
   pestaña *Releases*. Recién al publicarla la app instalada la ve.

El asunto del commit que lleva el tag es **la versión y nada más**: GitHub
titula la corrida de un tag con el asunto del commit etiquetado.

**Una beta** es lo mismo con un sufijo: `bun run release minor --beta` saca la
`0.7.0-beta.1` y `bun run release beta` la siguiente. Ver "Las betas", más
abajo.

### Lo que hace el workflow

`.github/workflows/release.yml` llama a dos workflows de star:

- **`verify.yml`**, en Windows y con Rust: el commit se llama como la versión,
  el tag coincide con los cuatro manifiestos, hay notas en el CHANGELOG y pasa
  la puerta. Un tag que no coincide produce un `latest.json` que promete un
  archivo que la app instalada nunca va a pedir.
- **`tauri-release.yml`**: crea la release en borrador con las notas del
  CHANGELOG (con `generateReleaseNotes` apagado: GitHub escribiría una lista de
  commits y un "nuevo contribuidor" que es el dueño de la app), compila y firma
  con `tauri-action` en Windows, y al final revisa con `star release check` que
  `latest.json` tenga `windows-x86_64`, apunte a un archivo de la release, con
  la firma de su `.sig` y las notas del CHANGELOG. La release queda en
  borrador, así que ese paso es el último que puede frenarla.

Lo propio de Starless entra por los parámetros: el canal, el relay y el commit
de la build (`build-env`), el ícono de desarrollo en las betas (`args`) y el
nombre limpio del instalador (`asset-name-pattern`). El bundler de Tauri
localiza el MSI (`Starless_0.5.4_x64_en-US.msi`), y el idioma se saca del
nombre al subirlo.

### Si el tag quedó mal

**El tag queda donde se hizo, y `develop` sigue avanzando.** A la 0.5.4 le pasó:
el tag se hizo el 24 de octubre y el arreglo del actualizador entró esa noche,
así que la build del tag no lo tenía.

Mientras la release sea un **borrador**, mover el tag es seguro: borra el
borrador en GitHub y mueve el tag. La corrida nueva crea otro borrador con los
archivos nuevos.

```bash
git tag -f v0.7.0 && git push --force origin v0.7.0
```

Con la release **publicada** no se mueve el tag: la app instalada ya tiene la
versión. Se saca una versión nueva.

## La forma de una release

Una release son tres archivos y un párrafo:

| Archivo | Qué es |
| --- | --- |
| `Starless_<version>_x64.msi` | el instalador |
| `Starless_<version>_x64.msi.sig` | su firma |
| `latest.json` | el manifest que lee la app instalada |

y el cuerpo de la release —y las notas del manifest— son la sección del
changelog de esa versión. Para revisar una release, publicada o no:

```bash
bunx star release check v0.7.0 --platforms windows
```

Las releases viejas (hasta la 0.6.0) se armaron con un flujo anterior y sus
notas llevan el título de la sección adentro; `star release check` lo marca.
No hace falta arreglarlas: la app sólo lee `latest.json` de la última.

### Por qué un instalador y no dos

Hasta la 0.5.3 la release llevaba los dos: el `.exe` de NSIS y el `.msi`. Eran
dos formas de instalar lo mismo, y la página de la release tenía cinco archivos
para descargar. Ahora hay un instalador, el `.msi`.

El `.msi` es el que se queda porque es el que ya usaba el manifest: la clave
`windows-x86_64` del manifest apunta al `.msi`, y el plugin busca primero la
clave del tipo de instalador (`windows-x86_64-msi`) y después esa. Una copia
instalada con el `.msi` se actualiza con el `.msi`; una instalada con el `.exe`
—que es lo que hay entre la 0.3.0 y la 0.5.3— ya no encuentra la clave del
`.exe` y cae en la genérica, que es el `.msi` también.

**Si instalaste con el `.exe`, instala el `.msi` una vez.** Quedan dos copias
en la máquina hasta que desinstales la vieja; a partir de ahí, las
actualizaciones son del `.msi`.

**El `.msi` instala para toda la máquina; el `.exe`, para el usuario.** Es la
diferencia entre el `InstallScope="perMachine"` de WiX y el modo `currentUser`
del instalador de NSIS. Quiere decir que Windows pide permiso de administrador
al instalar y al actualizar, y que hace falta uno para desinstalar. No es un
cambio de una versión: es la diferencia entre las dos herramientas, y por eso
la 0.5.4 lo dice en sus notas.

### Por qué renombrar no rompe nada

La firma cubre el contenido del archivo, no su nombre, y el plugin la verifica
sin comparar el nombre del comentario con el del archivo. `tauri-action` v1
escribe en `latest.json` la dirección con el nombre ya cambiado
(`…/releases/download/v0.7.0/Starless_0.7.0_x64.msi`); las releases hechas
antes apuntaban al **id** del asset, que tampoco cambia al renombrar.

Qué número corresponde a cada tipo de release está escrito en
[`ROADMAP.md`](../ROADMAP.md#cómo-se-numeran-las-versiones). En corto: los parches
sólo corrigen, las mejoras agregan algo que antes no existía, y el número mayor
significa que corta con lo anterior.

## Las betas

Una versión con sufijo (`0.7.0-beta.1`) sale como **prerelease**. La app
instalada consulta `releases/latest/download/latest.json`, y GitHub no
redirige `releases/latest` hacia una prerelease: una beta puede romper lo que
quiera sin que nadie reciba un aviso de actualización. Quien la quiera probar
la instala a mano.

Antes la pregunta era "¿el tag llegó a `main`?". star etiqueta en `develop`, y
`develop` llega a `main` después, así que con esa regla toda versión habría
salido como prerelease. Ahora lo dice el número, y se lee en él.

Una beta lleva el canal `develop` (`STARLESS_CHANNEL`, lo que la app muestra en
Ajustes) y el ícono de desarrollo. Una versión sin sufijo lleva `release` y el
ícono de siempre.

```bash
bun run release minor --beta   # 0.6.0 -> 0.7.0-beta.1
bun run release beta           # 0.7.0-beta.1 -> 0.7.0-beta.2
bun run release minor          # 0.7.0-beta.2 -> 0.7.0
```

Una beta **copia** las notas de `## [Sin publicar]` sin sacarlas de ahí: la
`0.7.0` sale con todo lo que juntaron sus betas.

### Publicar una beta como si fuera una release

La release queda en borrador y se publica a mano. Si se publica **tal como la
dejó la CI** —con la marca de prerelease—, todo anda como corresponde: la app
instalada no la ve nunca en "hay una versión nueva", y la puerta hacia la línea
pública la ofrece sólo cuando la línea pública tiene otra build.

**Y para que la prerelease se instale de verdad, el `Update` tiene que quedar
registrado donde el plugin lo va a buscar.** El canal de `develop` no lo
resuelve el plugin: lo resuelve el backend (`check_prerelease_manifest`), que
devuelve un `rid`. Ese `rid` es un puntero a un recurso que vive en Rust, y
**el webview tiene su propia tabla de recursos** —la del app manager es otra—.
El plugin busca el `Update` en la del webview; registrarlo en la del app deja
un puntero a la nada, y la instalación falla al instante, sin descargar un
byte y sin decir por qué.

Si se publica **sacándole la marca**, la build sigue siendo de `develop`: el
canal va compilado dentro del binario y no cambia por cambiar la marca de
GitHub. Esa build, instalada, busca la puerta de vuelta a la línea pública y
**se encuentra a sí misma**: el botón ofrece "instalar la 0.5.4 pública" y el
instalador es el mismo binario. El bucle no termina nunca. La salida es sacar
la versión sin sufijo.

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

**Sin `pubkey`, `tauri build` falla** — a propósito. En un fork, `bunx star init
updater` genera la llave y escribe la pública. Un actualizador sin llave pública es
un actualizador que no verifica nada, y prefiere no compilar antes que compilar
inseguro.