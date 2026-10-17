# Seguridad / Security

## Reportar un problema

No abras un issue público. Usá **Security Advisories**:

**https://github.com/baironvillar/Starless/security/advisories/new**

Do not open a public issue. Use **Security Advisories** instead.

Si el metodo te pide la llave de verificacion, guardala; nunca la pongas en el
reporte, ni en un issue, ni en una captura.

## Qué es un problema de seguridad aquí

**La firma de las actualizaciones.** Starless consulta GitHub Releases por una
versión nueva y el manifest viene firmado. Sin esa verificación, cualquiera que
pueda interceptar esa petición — una red hostil, una respuesta de DNS, un espejo
comprometido — elige el próximo binario que se instala en la máquina de cada
usuario. Ese es el riesgo más serio del proyecto.

**El manejo de credenciales.** Starless inicia sesión con Spotify por OAuth y
la app nunca ve tu contraseña, pero sí maneja un token de sesión y lo cachea.
Un token que se filtra por el log, por un archivo de sesión, o por un canal que
no debería convertirlo en una sesión reproducible, es un problema.

**Lo que se escribe en disco.** La cache de credenciales de librespot y el log
local con rotación. Qué queda en ellos y con qué permisos.

## Qué no es un problema de seguridad

- **El protocolo de Spotify es inverso.** Spotify no publica especificación, y
  sus cambios rompen el cliente periódicamente. Eso es una limitación de la que
  ya se habla en `PRODUCT.md`, no una vulnerabilidad reportable.
- **El instalador no está firmado.** SmartScreen y Gatekeeper avisan, y eso se
  dice explícitamente en el README. Es una limitación conocida y asumida.
- **Tus propias credenciales** en tu propia máquina.

## La llave de firma

La llave privada del actualizador vive en `.secrets/starless-updater.key`. Ese
directorio está en `.gitignore`, y el CI tiene un job que falla si alguna vez se
versiona una llave.

**No la regeneres.** Una llave nueva invalida la confianza de todas las
instalaciones que ya tienen la pública vieja, y esas copias dejan de poder
actualizarse sin que nadie entienda por qué.

Si crees que la llave se filtró, dilo por el canal privado y hay que rotar el
plan entero, no sólo la llave.

## Tiempos de respuesta

Sin promesa de plazo, pero con intención:

- **Confirmación** de que recibí el reporte, en pocos días.
- **Una valoración** honesta de la gravedad, aunque sea "no es exploitable" o
  "no lo sé todavía".
- **Un aviso** cuando haya una versión que lo arregle.

Lo que no prometo es un programa de recompensas para researchers. Starless es
un proyecto de una persona.
