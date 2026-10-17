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

La privada queda en `.secrets/starless-updater.key`, que está en `.gitignore` y
no debe salir de tu disco salvo dentro del secreto `TAURI_SIGNING_PRIVATE_KEY`
de tu CI.

**No la regeneres.** Una llave nueva invalida la confianza de todas las
instalaciones que ya tienen la pública vieja, y esas copias dejan de poder
actualizarse.

## En cada release

```bash
bun run version:bump patch          # 0.3.0 -> 0.3.1 en los tres manifiestos
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content .secrets/starless-updater.key -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "tu contraseña"
bun run app:build
$env:STARLESS_REPO = "bairovillar/Starless"
bun run updater:manifest
```

El último comando escribe `latest.json` y te dice exactamente qué archivos
subir. Adjunta a la release, en este orden:

1. `latest.json`
2. Los `.zip` y los `.sig` de `src-tauri/target/release/bundle/nsis/`
3. Los `.zip` y los `.sig` de `.../bundle/msi/`
4. Los instaladores normales (`.exe` y `.msi`), para quien prefiera descargarlos

`latest.json` contiene las URLs exactas a esos mismos archivos, así que el orden
de subida importa: sube los artefactos **antes** de publicar el manifest, o la
release puede quedar unos segundos diciendo que hay una versión que
todavía no se puede descargar.

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

**Las instalaciones de 0.3.0 no se van a actualizar solas.** El actualizador tiene
que existir dentro de la versión instalada. Quien ya tiene 0.3.0 tendrá que bajar
0.4.0 a mano una vez; desde 0.4.0 en adelante sí. No hay forma de evitarlo: es la
misma regla para toda app que agrega actualizaciones después de salir.

**El endpoint ya apunta al repositorio real.** En `src-tauri/tauri.conf.json`:

```json
"endpoints": ["https://github.com/bairovillar/Starless/releases/latest/download/latest.json"]
```

Si bifurcaste el repo, cámbialo por el tuyo: mientras apunte a otro lado, el
comprobador siempre dirá que estás al día. Una URL que no existe también viene
con «no hay nada nuevo», y ese fallo silencioso es justo el que hace que un
actualizador roto parezca uno que funciona.

Lo mismo con `STARLESS_REPO`: el manifest se construye con las URLs del repo que
le pases, así que un fork que olvide cambiarlo publica un `latest.json` que
apunta a releases ajenas.

**La `pubkey` es un marcador** hasta que corras `bun run updater:pubkey`. Con el
marcador, `tauri build` falla — a propósito. Un actualizador sin llave pública es
un actualizador que no verifica nada, y prefiere no compilar antes que compilar
inseguro.