# Escribir playlists

Cómo se crea una playlist por la sesión de librespot, y cómo se averiguó. Lo
mismo para renombrarla y para meterle canciones, que son el mismo endpoint con
la revisión cambiada.

Este documento describe el protocolo y deja constancia de cómo se llegó a él.
Los dos pedidos se verificaron en vivo contra el servicio, con el token del
cliente de escritorio: los dos contestan `200`. Lo que **no** se probó desde
Starless es la corrida completa con su propio token, porque el id que generaba
era inválido —ver más abajo— y ya está arreglado. Que quede escrito es lo que
permite medir lo que sigue en vez de volver a adivinar.

## El resumen

Crear una playlist **no es un endpoint propio**, y son **dos pedidos en un orden
que importa**.

Primero se le escribe **a la playlist que todavía no existe**, contra una revisión
que dice que no tiene ninguna:

| | |
| --- | --- |
| Endpoint | `POST /playlist/v2/playlist/<id>/changes` |
| Mensaje | `spotify.playlist4.proto.ListChanges` |
| `base_revision` | `00 00 00 00` + `"root"` — cero, que se lee como `0,root` |
| Operación | `Op.kind = UPDATE_LIST_ATTRIBUTES` (`6`) |
| Mensaje | `ListAttributes { name }` dentro de un `ListAttributesPartialState` |

Ese pedido **crea** la playlist, con nombre incluido. Después, y sólo después:

| | |
| --- | --- |
| Endpoint | `POST /playlist/v2/user/<usuario>/rootlist/changes` |
| `base_revision` | la revisión del rootlist, como en cualquier edición |
| Operación | `Op.kind = ADD` (`2`) con un `Item` que trae la `uri` |
| Para qué | **no crearla**: sólo ponerla en la biblioteca |

El id lo genera el cliente, no el servidor. Por eso un
`GET /playlist-permission/v1/playlist/<id>` da `404` un instante antes de que
exista: el id ya venía puesto en el pedido.

**El orden es la parte que costó.** Al revés —primero el `ADD` al rootlist,
después el nombre— no funciona, y devuelve `400 invalid argument` sobre un
cuerpo que el servicio acepta byte por byte cuando la playlist ya existe. Mandarle
al `ADD` la uri de una playlist que todavía no está es lo que se rechaza; no hay
ningún campo del mensaje que esté mal.

Todo eso ya está en `playlist4_external.proto`, que librespot compila. **No hace
falta ni un proto nuevo.** Es el mismo `playlist4` de toda la vida con el que se
editan las playlists; la creación no es un caso especial.

## Los detalles: nombre, descripción y portada

Las escrituras del diálogo de detalles son **el mismo endpoint y el mismo
mensaje**, con la revisión cambiada:

| | Crear | Editar los detalles | Agregar una canción |
| --- | --- | --- | --- |
| `base_revision` | `0,root` | la de la playlist | la de la playlist |
| `Op.kind` | `UPDATE_LIST_ATTRIBUTES` | `UPDATE_LIST_ATTRIBUTES` | `ADD` |
| Contenido | `ListAttributes { name }` | `ListAttributes { name, description, picture }` | `Add { add_last: true, items: [...] }` |

**La revisión se lee en el momento de escribir, y no antes.** El servicio
contesta `409 Aborted` a un cambio cosido contra una revisión vieja, así que una
revisión cacheada es una revisión que puede estar equivocada. Por eso
`spclient` la pide en el mismo viaje que la escritura, y no la guarda.

**Los atributos se escriben como un estado parcial.** `ListAttributesPartialState`
lleva los valores que se cambian en `values` y, por aparte, la lista de los que
se vacían en `no_value`. Mandar el nombre y nada más deja la descripción y la
portada donde estaban: para vaciar hay que nombrar el campo en `no_value` —y
para quitar la portada, `no_value` lleva `LIST_PICTURE` y `values` va vacío.

### La portada es otro pedido, y son dos

La portada **no viaja en el mensaje de los atributos**: lo que viaja es el id de
la imagen, y ese id sale de dos pedidos anteriores:

1. **La subida.** `POST https://image-upload.spotify.com/v4/playlist` con el
   JPEG en el cuerpo, `Content-Type: image/jpeg` y el **token de la cuenta**
   (`login5().auth_token()`), no el `client-token` —con el del cliente la puerta
   contesta `401`. Contesta `{"uploadToken": "…"}`. El host no es el del spclient,
   así que el pedido se arma a mano.
2. **El registro.** `POST /playlist/v2/playlist/<id>/register-image` con el
   `RegisterPlaylistImageRequest { upload_token }` de `playlist4_external.proto`.
   Contesta el `RegisterPlaylistImageResponse { picture }`, y esos bytes son
   exactamente lo que va en `ListAttributes.picture`.

**El `picture` son los bytes del id de la imagen**, no una URL: el id crudo de
`i.scdn.co/image/<id>`. La dirección de la imagen se arma con eso, y no es un
detalle: una URL en ese campo es una URL que el servicio no sabe leer.

**La imagen la sube el usuario, para la playlist del usuario.** No sale nada de
la máquina por su cuenta: hay un clic, un archivo que él eligió y una playlist
que es suya.

## La visibilidad: pública o privada

La privacidad de una playlist **no está en los atributos de la playlist**.
`ListAttributes` no tiene ningún campo para eso —tiene `name`, `description`,
`picture`, `collaborative` y poco más—, y `get_playlist` tampoco lo trae: por
eso el encabezado de la pantalla no podía decir "privada" y decía la mitad de
la verdad.

**Está en el ítem de la biblioteca.** La playlist es una fila del rootlist, y
cada fila trae sus propios `ItemAttributes`, donde el campo 10 es `public`: el
mismo que el cliente de escritorio manda en `true` cuando la playlist entra en
la biblioteca. O sea que la visibilidad se lee del rootlist:

| | |
| --- | --- |
| Dónde | `ItemAttributes.public` del ítem del rootlist |
| Si el campo no vino | pública — es lo que Spotify hace por omisión |

Y se escribe en el rootlist, con un op de atributos de ítem:

| | |
| --- | --- |
| Endpoint | `POST /playlist/v2/user/<usuario>/rootlist/changes` |
| `base_revision` | la revisión del rootlist |
| Operación | `Op.kind = UPDATE_ITEM_ATTRIBUTES` (`5`) |
| Contenido | `UpdateItemAttributes { new_attributes: { values: { public: false } }, item: { uri } }` |

**El ítem va con su uri.** El proto deja las dos formas —`index` y `item`— y la
que se midió es la segunda: el `200` vino con el atributo cambiado. Un `200`
que no cambia nada es la forma más silenciosa de no escribir.

Medido contra el servicio con la cuenta del usuario. La sonda es
`STARLESS_SP_PRIVATE=1`, y además pide `STARLESS_SP_PRIVATE_ID=<id>` para
saber a qué playlist puede tocar —la que se le nombre— y la deja como la
encontró:

```
[0] spotify:playlist:3cmFu… · public=Some(true) · timestamp=Some(…)
la forma `item` → 200 · 113 bytes
después de la forma `item`, public=Some(false)
```

El `ADD` del rootlist —el que mete una playlist nueva en la biblioteca— lleva
`public` en `true`, que es lo que manda el cliente de escritorio. **Esa forma
no está medida**: el `ADD` con `public` en `false` puede que no cree una
playlist privada. Lo que sí está medido es que después se puede cambiar, así
que crear pública y corregir después es un estado que la app sabe deshacer.

## Qué ya estaba público

Conviene decirlo antes que nada, porque cambia cuánto aporta esto:

- El **endpoint** `POST /playlist/v2/user/<usuario>/rootlist/changes` y la forma
  general `{"deltas":[{"ops":[{"kind":…}]}]}` están documentados desde hace años
  en la [nota de Spotify Folder Tools](https://skylerasher.com/spotify-folder-tools/)
  y en [`mirrorfm/spotify-private-api`](https://github.com/mirrorfm/spotify-private-api),
  que lo lista como *"Change playlists order"*.
- Los mensajes `ListChanges`, `Delta`, `Op`, `Op.Kind`, `Add`, `Item`,
  `ChangeInfo` y `UpdateListAttributes` están en el volcado de protos de
  librespot desde siempre.

Lo que **no** aparece en ninguna parte es lo que se averiguó acá:

1. Que una playlist se crea escribiéndole **a ella**, con la revisión `0,root`, y
   que el `ADD` al rootlist no la crea: la agrega a la biblioteca. Todo lo
   publicado usa `kind = 4` (`MOV`), que mueve una que ya existe, y por eso el
   orden —y el hecho de que importe— no está en ninguna parte.
2. Que **el id lo genera el cliente** y que **el servicio lo valida**. Ver abajo:
   no es cualquier cadena de 22 caracteres.
3. Que el cliente de escritorio manda **protobuf** en estas llamadas, no JSON.
   El `content-type` dice `application/x-www-form-urlencoded` y **miente**: el
   cuerpo es un `ListChanges` serializado.

## El id: 22 dígitos de base62 que no pasan de 2^127

Esta parte costó más que el protocolo, y es la razón de que la primera
implementación pareciera imposible.

El cuerpo del pedido **no dice qué id tiene la playlist**: el id va en la URL. O
sea que un id mal formado produce un `400 invalid argument` sobre un cuerpo
byte a byte idéntico al que el servicio acepta. No hay nada en el mensaje que
delate el problema.

Midiendo:

| id | bits que ocupa |
| --- | --- |
| `0wZQmwut8WFchl01nectwn` (escritorio) | 125 |
| `1BZzZO1UGeXUK0aOZQITtn` (escritorio) | 126 |
| el que generaba Starless | 129 a 131 |

Decodificado como número en base62 con el alfabeto que usa librespot (`0-9a-zA-Z`),
los ids del escritorio quedan holgadamente por debajo de 2^127 y los de Starless
por encima de 2^128. La causa era escribir los dígitos **del menos significativo al
más**: el `push` va sacando el dígito menor, así que el mayor queda al final y el
string resultante vale otra cosa. Con el orden correcto y 127 bits, el mismo pedido
contesta `200`.

**La respuesta ya estaba en la dependencia.** `SpotifyId::from_raw(&bytes).to_base62()`
de `librespot-core` la hace bien —su `to_base62` termina en un `dst.reverse()`— y es
lo que usa Starless ahora. Escribirla a mano fue el error entero.

Un id tiene 22 dígitos de base62, que guardan hasta ~2^131, así que el largo no
basta: el servicio acepta un rango y rechaza el resto en silencio. **127 bits es
un techo seguro**, con todos los casos que funcionaron muy por debajo.

## Cómo se llegó

Sin descompilador. Dos fuentes, ninguna un IDA.

**1. El volcado de protos ya estaba en el binario.** `Spotify.dll` del cliente
de escritorio de Windows (1.304.258.0) tiene embebidos unos mil archivos
`.proto` **completos como texto plano**, con nombres de campo, tipos y números de
campo. Se leen con un `IndexOf` sobre el archivo. Ahí se vio que
`playlist4.proto` tiene `CreateListReply` pero **ningún mensaje que cree
playlists**, lo que tuvo un rato confirmado.

**2. Faltaba ver qué manda el cliente de verdad.** Para eso, captura de tráfico:

```powershell
pip install mitmproxy
mitmdump --listen-host 127.0.0.1 --listen-port 8080 -w flows.mitm
```

Y Spotify lanzado por proxy. En Windows, si es una app empaquetada
(`%LOCALAPPDATA%\Packages\...`) el `.exe` no se puede ejecutar directo —da
*Access denied*— y hay que activarla con argumentos por la interfaz COM
`IApplicationActivationManager`, que sí los acepta:

```powershell
$exe = "$env:LOCALAPPDATA\...\Spotify.exe"   # no se puede ejecutar
# en cambio:
$aumid = "SpotifyAB.SpotifyMusic_<hash>!Spotify"
# IApplicationActivationManager::ActivateApplication($aumid,
#     '--proxy-server=127.0.0.1:8080 --ignore-certificate-errors')
```

**`--ignore-certificate-errors` alcanza y sobra:** `libcef.dll` lo soporta y hace
que el cliente acepte el certificado de mitmproxy, así que **no hay que instalar
ninguna CA** ni tocar el almacén de certificados. El proxy sólo escucha en
loopback y sólo lo usa esa instancia de Spotify.

Después se crea una playlist desde la app y se leen los flujos.

> La captura contiene el access token de la sesión, en la URL del websocket al
> dealer. Es borrable y no debería compartirse sin limpiar.

## El formato exacto

**Primero**, `POST /playlist/v2/playlist/<id>/changes` — el que crea (63 bytes):

```
ListChanges {
  1 = base_revision            bytes = 00 00 00 00 "root"
  2 = deltas                   repeated Delta
  3 = want_resulting_revisions bool = true
  4 = want_sync_result         bool = true
  6 = nonces                   bool = true

  Delta {
    2 = ops                    repeated Op
    4 = info                   ChangeInfo { 1 = user, 2 = timestamp }
  }

  Op {
    1 = kind = UPDATE_LIST_ATTRIBUTES      (Op.Kind::UPDATE_LIST_ATTRIBUTES = 6)
    6 = update_list_attributes = UpdateListAttributes {
          1 = new_attributes = ListAttributesPartialState {
                1 = values = ListAttributes { 1 = name = "El nombre" }
              }
        }
  }
}
```

**Después**, `POST /playlist/v2/user/<usuario>/rootlist/changes` — el que la pone
en la biblioteca (115 bytes):

```
ListChanges {
  1 = base_revision            bytes   ← del GET /playlist/v2/user/<usuario>/rootlist
  2 = deltas                   repeated Delta
  3 = want_resulting_revisions bool = true
  4 = want_sync_result         bool = true
  6 = nonces                   bool = true

  Delta {
    2 = ops                    repeated Op
    4 = info                   ChangeInfo { 1 = user, 2 = timestamp }
  }

  Op {
    1 = kind = ADD                    (Op.Kind::ADD = 2)
    2 = add = Add {
          1 = from_index = 0
          2 = items = [ Item {
                1 = uri = "spotify:playlist:<id nuevo>"
                2 = attributes = ItemAttributes {
                      2   = timestamp     (ms)
                      10  = public = true
                    }
              } ]
        }
  }
}
```

La forma de una revisión no es un invento: son cuatro bytes de cuenta en big-endian
seguidos del hash, o la palabra `root` cuando la lista no tiene ninguno. El
rootlist se vio con `00 00 00 D6` + veinte bytes —`D6` = 214 revisiones— y la
playlist nueva con `00 00 00 00` + `"root"`. En la URL las dos aparecen como
`<número>,<hash>`: `.../rootlist/diff?revision=214,c48634e42ecf6d…`.

Detalles que salen del cuerpo real y no se deducen del proto:

- `ItemAttributes.public = true`. El cliente de escritorio pone la playlist
  **pública** por defecto. Que ese atributo se pueda cambiar después está
  medido —ver «La visibilidad: pública o privada»—, pero mandar `false` en el
  `ADD` no: esa forma no se probó.

## La envolvente: lo que se descartó

Esta sección es la que costó más y terminó sin hallazgos. Queda escrita porque
es lo que **no** es la causa, y volver a hacerlo sería la forma más fácil de
volver a hacerlo.

Starless sí llegó a mandar los dos pedidos y el servicio contestó `400 invalid
argument` en los dos. El primer reflejo, cambiar un campo del cuerpo, era el
equivocado. Se descartó lo siguiente, en este orden:

**El cuerpo.** Decodificados los dos con el mismo parser y comparados campo por
campo, el de Starless y el del cliente de escritorio tienen **el mismo árbol, los
mismos números de campo, los mismos tipos y los mismos largos**. Lo único que
difiere es el id de la playlist y las marcas de tiempo. Probar `public: false` y
después `public: true` dio el mismo `400`.

**La envolvente.** Hay dos diferencias que se ven sin desensamblar nada, y se
probaron las cuatro combinaciones en una sola corrida: la query que le agrega
`spclient` a cada URL —`?product=0&country=<país>&salt=<n>`, porque
`RequestOptions::default()` trae `metrics: true, salt: true`— y las cabeceras que
el escritorio manda y librespot no, entre ellas `spotify-playlist-sync-reason:
CAk=`. **Las cuatro dieron `400`.**

**La identidad.** Repetidos los dos pedidos con el token y el `client-token` del
escritorio, tomados de la captura: el `GET` al rootlist `200` —o sea que el token
servía— y los `POST` `400`. Con el cuerpo literal y un id nuevo, `200`. O sea:
**la identidad tampoco era la causa**, y el mismo cliente que no puede crear una
playlist desde Starless la crea sin problema con esos mismos bytes.

**La versión de HTTP.** `spclient` ya habla HTTP/2 con ventana adaptativa
(`http_client.rs:170`), y ese camino también dio `400`.

Lo que queda, y era: **el id que viajaba en la URL**, que no aparece en el cuerpo
y por eso todas las comparaciones byte a byte salían idénticas.

Un detalle que descentraba la depuración todo el tiempo: `http_client::request` de
librespot **descarta el cuerpo de toda respuesta que no sea 2xx**
(`http_client.rs:214`), un nivel más abajo que cualquier tipo con nombre. Por eso
el `400` llegaba sin cuerpo y sin explicación. Y el texto `"Client specified an
invalid argument"` que salía al lado **no es de Spotify**: es el
`ErrorKind::InvalidArgument` de librespot (`error.rs:38`), que es como el autor
nombró el código 400. Ninguna de las dos señales era un mensaje del servicio.

## Lo que falta

Honesto, porque buena parte de esto no se comprobó:

- **El `ADD` con `public = false` no se probó.** La receta verificada crea la
  playlist **pública**, porque eso es lo que manda el escritorio. Cambiar la
  visibilidad después sí está medido —ver «La visibilidad: pública o
  privada»—, pero la forma del `ADD` con `public` en `false` no: puede que el
  servicio no acepte una playlist que nace privada.
- **El caso real, que es crear una playlist *con canciones*, ya está
  implementado.** El `Op{kind: ADD}` de pistas dentro de la playlist es
  `Add{items: [Item{uri: "spotify:track:…"}]}` sobre
  `POST /playlist/v2/playlist/<id>/changes` —el mismo endpoint del primer paso,
  pero con una revisión que ya no es cero—, y es lo que escribe «Agregar a la
  playlist» del menú de una canción. Editar los detalles es el mismo
  `UPDATE_LIST_ATTRIBUTES` de la creación, contra la revisión que la playlist
  tiene ahora. Ver «Los detalles: nombre, descripción y portada».
- **La Web API documentada sigue siendo otra cosa.** `POST /me/playlists` es el
  camino oficial y pide scopes `playlist-modify-*`. Nada de esto lo reemplaza ni
  lo contradice: es el mismo `playlist4` privado, que es el único que una sesión
  de streaming puede usar. Pero quien necesite interoperabilidad con otras apps
  tiene que usar la Web API.

## Para librespot

Si esto termina en un issue o un PR, lo que aporta es:

1. **El orden.** Una playlist se crea escribiéndole a ella, contra la revisión
   `0,root` (`UpdateListAttributes` con el nombre), y **después** se agrega al
   rootlist con `Op{kind: ADD}` y el id generado por el cliente. Al revés da
   `400 invalid argument` sin que haya ningún campo del mensaje que esté mal.
2. **Que el id lo valida el servicio.** 22 dígitos de base62 no alcanzan: hay que
   escribirlos del más significativo al menos y quedar por debajo de 2^127. Es la
   parte que no aparece en ninguna forma y que hace que un cliente que parece
   correcto reciba `400` sin explicación. La respuesta ya está en la biblioteca:
   `SpotifyId::from_raw(&bytes).to_base62()` la hace bien y no hay que escribirla.
3. Lo que **le sobra a `spclient::request` para escribir**: la query
   `?product=0&country=<país>&salt=<n>` que le agrega a cada URL, ningún
   `content-type` —el que manda el escritorio es
   `application/x-www-form-urlencoded`, no `application/x-protobuf`— y ningún
   `spotify-playlist-sync-reason`.
4. `http_client::request` tira el cuerpo de toda respuesta no-2xx en
   `http_client.rs:214`, antes de que exista el `Err`. Depurar un `400` de
   escritura sin eso es adivinar, y el texto que acompaña al error
   (`ErrorKind::InvalidArgument`) no viene del servidor: es el nombre que librespot
   le puso al código 400.
5. Los nombres de archivo del volcado de protos, por si alguien quiere refrescar
   `playlist4_external.proto`: `playlist4.proto` (el paquete nuevo, que librespot
   no trae), `spotify.playlist_esperanto.proto`, `your_library.proto`. El
   volcado completo se lee del binario del cliente de escritorio, que lo lleva en
   claro.

### Lo que ya está en marcha

Conviene no llegar como si nada de esto fuera nuevo:

- **[PR #1831](https://github.com/librespot-org/librespot/pull/1831)**, abierto el
  17 de octubre de 2026 y todavía sin comentarios, agrega
  `SpClient::post_playlist_changes`: mandar un `ListChanges` a
  `playlist/v2/playlist/{id}/changes`. **Confirma el endpoint y el mensaje** de
  esta receta, y de paso que escribir por la sesión es posible. No cubre ni el
  `ADD` al rootlist —la parte que pone la playlist en la biblioteca— ni el id
  que genera el cliente, que es justo donde estuvo toda la dificultad.
- **[PR #1801](https://github.com/librespot-org/librespot/pull/1801)** agrega
  `get_playlist_range` sobre el mismo endpoint, del mismo autor.
- El autor de ambos, `crmne`, mantiene
  [Spotifast](https://github.com/crmne/spotifast), que **lee** por la sesión
  pero **crea playlists por la Web API**. Que el cliente de referencia elija la
  Web API para lo que esta receta hace por la sesión es el dato más útil de
  todos: la sesión puede escribir, y no lo hacía porque no lo sabía.

## Para el PR #1831

**Esto es lo que se manda.** Es un comentario, no un PR: no se toca código, no
se pide ninguna función. Redactado en inglés, que es como se escriben ahí.
**No está publicado** —en esta máquina no hay `gh` ni token de GitHub—, así que
lo pegas tú.

El PR agrega `post_playlist_changes`: escribir filas —agregar, sacar, mover— dentro
de una playlist que ya existe. No crea playlists ni toca la biblioteca. El
comentario abre diciendo que la creación por sesión sí funciona y que no está
escrita en ninguna parte, y después da el único detalle que le corresponde a este
PR: **ese método también crea**, y su doc comment dice lo contrario.

> Worth putting here since it appears not to be written down anywhere: **playlists
> can be created over the session** — no Web API needed. I only got there by trial
> and error against a Premium account, and the two `400`s that cost the most were
> completely silent, which is most of why I am leaving this here.
>
> One detail of "as Spotify's own clients do" that would fit the doc comment:
> **this method creates as well as edits.** With a client-generated id and
> `base_revision` set to zero (`00 00 00 00 "root"`), the first write brings the
> playlist into being — `UPDATE_LIST_ATTRIBUTES` against that revision is a create,
> not a rename. Confirmed over the session token and over the desktop's own;
> `application/x-protobuf` works for the body even though the desktop sends
> `application/x-www-form-urlencoded`.
>
> Worth knowing before anyone builds on the first part: it is only half. Placing
> the new playlist in the library is a separate `ADD` against
> `POST /playlist/v2/user/{user}/rootlist/changes`, and there is no `SpClient`
> method for that endpoint yet — so a playlist created this way exists but does not
> show up under the user's library until that second call goes out.

Si lo copian tal cual, lo que entra al repo son tres líneas de comentario:

```diff
     /// changed since answers with an `Aborted` error (HTTP 409) rather than
     /// apply them to other rows. The answer is a `SelectedListContent` with
     /// the new revision.
+    ///
+    /// It creates as well: with a client-generated id and `base_revision` zero,
+    /// the first write brings the playlist into being.
```

**Lo que deliberadamente no va en este comentario**, porque no es de este PR:

- **El techo del id.** El método toma un `&SpotifyId`, que ya sale bien. La trampa
  es para quien escriba el id a mano: 22 dígitos de base62 que no pasen de `2^127`,
  y un id fuera de rango contesta `400` con un cuerpo idéntico al de uno válido.

Eso va al issue, que quedó para más adelante.

## Para el issue

**No se manda ahora.** Queda redactado para cuando haga falta: si alguien más
llega con el mismo problema, o si el comentario del PR no encuentra lugar y el
hallazgo merece quedar en algún lado del historial.

> **Title:** Creating a playlist over the session needs two writes, in order
>
> `SpClient::post_playlist_changes` (#1831) makes playlists writable over the
> session. Two things around it are not written down anywhere, and I measured both
> against a Premium account:
>
> **1. Creating one takes two writes, and the order matters.** A playlist is
> created by writing *to it*:
>
> ```
> POST /playlist/v2/playlist/<client-generated-id>/changes
>   base_revision = 00 00 00 00 "root"      // zero revisions
>   Op { kind: UPDATE_LIST_ATTRIBUTES (6), update_list_attributes: { name } }
> -> 200
> ```
>
> and only afterwards is it placed in the library:
>
> ```
> POST /playlist/v2/user/<user>/rootlist/changes
>   base_revision = <revision from GET /playlist/v2/user/<user>/rootlist>
>   Op { kind: ADD (2), add: { from_index: 0, items: [Item{ uri: "spotify:playlist:<id>", attributes: { timestamp, public } }] } }
> -> 200
> ```
>
> Doing these in the other order answers `400 invalid argument` — with a **byte for
> byte identical body**, which is what makes it expensive to find: every diff of
> the request against a working one comes out clean.
>
> **2. The service validates the client-generated id, and the ceiling is silent.**
> See above; short version, under `2^127`, and `SpotifyId::to_base62` already gets
> it right.
>
> Two smaller things, both harmless for reading, which is probably why they went
> unnoticed:
>
> - `RequestOptions::default()` sets `metrics: true, salt: true`, so every write
>   carries `?product=0&country=…&salt=…`. The desktop client sends the bare path.
> - `http_client::request` drops the body of every non-2xx answer at
>   `http_client.rs:214`, before the `Err` exists. Debugging a write means guessing
>   with nothing to read. (And `ErrorKind::InvalidArgument`, which shows up
>   alongside the 400, is this crate's name for the status code — not a message
>   from the server.)