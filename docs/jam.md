# El jam

Cómo se llega a la sesión compartida —el "jam" de Spotify— por la sesión de
librespot, y qué se averiguó hasta ahora.

El jam **no es una playlist**. Es una sesión con participantes, un anfitrión, un
invitado que se une por un código y una cola que todos tocan. La diferencia no
es de vocabulario: una playlist se escribe con `playlist4`, el jam se escribe
con otro servicio y con otro protocolo, y sus rutas no tienen nada que ver con
las que usa el resto de la app.

El nombre del servicio es **`social-connect`** —"Social Listening" para
Spotify—, y el cliente de escritorio le habla con rutas de la forma
`servicio/vN/método`, la misma convención de `client-tts/v1/fulfill` y de
`storage-resolve/v2/files/audio/`.

**La puerta existe y una sesión de streaming la puede usar.** Eso se midió
contra el servicio, con la cuenta real, el 30 de octubre de 2026.

En corto:

| | |
| --- | --- |
| Servicio | `social-connect`, en `spclient.wg.spotify.com` |
| Abrir o leer la sesión | `GET /social-connect/v2/sessions/current_or_new?activate=false` |
| Activarla | el mismo `GET`, con `activate=true` |
| Unirse | `POST /social-connect/v2/sessions/join/<token>`, con cuerpo |
| Cerrarla | `DELETE /social-connect/v2/sessions/<session_id>` |
| La cola | `spotify:list:jam-list:<session_id>`, por `playlist/spotify.list.v1.ListReadService/GetLists` — `POST`, protobuf |
| Forma de la respuesta | JSON, con `session_id`, `join_session_token` y los participantes |
| Lo que falta | escribir en la cola, la puerta del invitado, y el pubsub |

## Lo que está medido

Todo lo que sigue se midió con la sonda de `src-tauri/src/spclient/probe.rs`
(`STARLESS_SP_JAM=1`), contra `spclient.wg.spotify.com`, con el token de la
cuenta y el `client-token` de la sesión.

| Ruta | Verbo | Status | Qué es |
| --- | --- | --- | --- |
| `/social-connect/v2/sessions/current_or_new?activate=false` | `GET` | `200` | la sesión; **la crea si no había** |
| `/social-connect/v2/sessions/current_or_new?activate=true` | `GET` | `200` | la misma, con `"active": true` |
| `/social-connect/v2/sessions/join/<token>` | `POST` con cuerpo | `200` | unirse a la sesión; devuelve la sesión |
| `/social-connect/v2/sessions/<id>` | `DELETE` | `200` | **cerrar** la sesión |
| `/playlist/spotify.list.v1.ListReadService/GetLists` | `POST` (protobuf) | `200` | **la cola del jam**, con 250 pistas |
| `/playlist/spotify.list.v1.ListReadService/GetLists` | `POST` (con el token) | `200` + `Forbidden` | la URI con el token no es la cola |
| `/social-connect/v2/sessions/join/<token>` | `GET` | `405` | la ruta existe; el verbo no es ese |
| `/social-connect/v2/sessions/<id>` | `GET` | `405` | la ruta existe; el verbo no es ese |
| `/social-connect/v2/sessions/<id>` | `POST` / `PUT` / `PATCH` | `405` |idem: no es el verbo para modificarla |
| `/playlist/spotify.list.v1.ListReadService/GetLists` | `GET` | `405` | el servicio de listas existe; es `POST` |
| `/social-connect/v2/sessions/current` | `GET` | `404` | **no existe**, aunque el cliente la use |
| `/social-connect/v2/sessions/current?alt=protobuf` | `GET` | `404` | ídem |
| `/social-connect/v2/sessions/` | `GET` | `404` | no existe |
| `/social-connect/v3/sessions/` | `GET` | `404` | no existe |
| `/social-connect/v2/sessions/current/queue_only_mode/` | `GET` | `404` | no existe en este host |
| `/social-connect/v2/sessions/current/volume_control/` | `GET` | `404` | no existe en este host |
| `/social-connect/v2/session_update` | `POST` | `404` | no existe en este host |
| `/playlist/v2/playlist/<id>` | `GET` | `400` | la cola **no** es una playlist |

Dos cosas de esa tabla que no son obvias:

- **Un `405` es un dato, y vale más que un `404`.** `405` significa "esta
  dirección existe y no con ese verbo": es la diferencia entre un camino
  inventado y uno real. Por eso se midieron las tres puertas que contestaron
  `405` con todos los verbos, y por eso la sonda insiste con `GET`, `POST`,
  `PUT` y `PATCH`.
- **Un `411 Length Required` también es un dato.** Es lo que contesta el
  front door cuando a un `POST` le falta el `Content-Length`. Aparece *antes*
  del router: por eso `POST` sin cuerpo da `411` y `POST` con cuerpo da `404` o
  `405`. Los dos status son de capas distintas y hay que leerlos juntos.

### La respuesta, entera

La sesión que devuelve el servicio es **JSON**, no protobuf — la ruta lo pide
con `alt=protobuf` para el otro caso— y esa es la forma del jam:

```json
{
  "active": true,
  "hostActiveDeviceId": "",
  "initialSessionType": "IN_PERSON",
  "is_controlling": true,
  "is_listening": true,
  "is_paused": false,
  "is_session_owner": true,
  "join_session_token": "6aUOeCRYpNipAG6Lf3wNiF",
  "join_session_uri": "spotify:socialsession:6aUOeCRYpNipAG6Lf3wNiF",
  "join_session_url": "hm://social-connect/v2/sessions/join/6aUOeCRYpNipAG6Lf3wNiF",
  "maxMemberCount": 32,
  "queue_only_mode": false,
  "requires_jam_lens": true,
  "session_config": {},
  "session_id": "caed1c83acdc65bd86ff4c4d37a2d459",
  "session_members": [
    {
      "display_name": "Opioide",
      "id": "2b34c88216d383942379dc6089dac2ac",
      "image_url": "https://i.scdn.co/image/ab67757000003b82d0c213d58940ded905973ac3",
      "is_controlling": true,
      "is_current_user": true,
      "is_listening": true,
      "joined_timestamp": "1793335874962",
      "large_image_url": "https://i.scdn.co/image/ab6775700000ee85d0c213d58940ded905973ac3",
      "playbackControl": "LISTEN_AND_CONTROL",
      "username": "t_jitzol"
    }
  ],
  "session_owner_id": "2b34c88216d383942379dc6089dac2ac",
  "timestamp": "1793335876374",
  "user_capabilities": {
    "invite": true,
    "manage_participant_settings": true,
    "remove_participants": true
  },
  "wifi_broadcast": false
}
```

**El servicio mezcla convenciones de nombres**, y es una pista de por dónde
salió cada campo: casi todo es `snake_case` —`session_id`, `session_members`,
`join_session_token`, `user_capabilities`—, pero cuatro vienen en `camelCase`:
`hostActiveDeviceId`, `initialSessionType`, `maxMemberCount` y
`playbackControl`. En protobuf JSON todo saldría en camelCase, así que los
campos en `snake_case` vienen de otra capa: el servicio serializa a mano.

### La forma de las cuatro puertas

| | |
| --- | --- |
| Abrir o leer la sesión | `GET /social-connect/v2/sessions/current_or_new?activate=false` |
| Activarla | el mismo `GET`, con `activate=true` |
| Unirse | `POST /social-connect/v2/sessions/join/<token>` **con cuerpo** |
| Cerrarla | `DELETE /social-connect/v2/sessions/<session_id>` |

Lo que de entrada suena raro es que **abrir una sesión sea un `GET`**, y que
esa misma lectura **la cree** si no había: `current_or_new` es "la actual o una
nueva". Es la forma que usa el cliente de escritorio
(`social-connect/v2/sessions/current_or_new?activate=`) y se midió.

**El verbo de la puerta de join es `POST` y exige cuerpo**: sin cuerpo
contesta `411`, y con un `{}` —que no dice nada— contesta `200` y devuelve la
sesión. Un cuerpo vacío alcanza, y eso dice algo: el token de la URL es lo que
identifica la sesión, no el cuerpo.

**La puerta de join es la misma que trae el servicio en su respuesta**, con el
prefijo `hm://` —que es el nombre interno, como el `hm://lexicon-session-provider/`
del DJ— y sin él:

```
join_session_url: hm://social-connect/v2/sessions/join/<token>
                 →  /social-connect/v2/sessions/join/<token>
```

Y el token tiene su propia URI: **`spotify:socialsession:<token>`**. Es un tipo
de objeto nuevo, como lo es `spotify:list:jam-list:` para la cola.

## La cola

La cola es una lista, y su URI es **`spotify:list:jam-list:<session_id>`** —con
el id de la sesión, no con el token—. Se lee por el servicio de listas, que es
otro servicio y habla **protobuf**:

```
POST /playlist/spotify.list.v1.ListReadService/GetLists
content-type: application/x-protobuf
```

El cuerpo se arma a mano, porque **el proto de este servicio no está en
librespot**: vive en el cliente de escritorio, en
`spotify/list/v1/list_read_service.proto`, que el `Spotify.dll` trae embebido y
que se puede volver a volcar con `scripts/proto-dump.ts`:

```proto
message GetListsRequest {
  repeated spotify.list.v1.GetListRequest requests = 1;
  optional spotify.list.v1.model.RequestInfo info = 2;
  optional spotify.list.v1.model.MultiListRequestOptions multi_list_request_options = 3;
}

message GetListRequest {
  optional spotify.list.v1.model.ListIdentifier identifier = 1;
  optional spotify.list.v1.model.RequestOptions options = 2;
}

message ListIdentifier {
  optional string uri = 1;
  optional bytes revision = 2;
}

message RequestOptions {
  optional spotify.list.v1.model.RequestedFields requested_fields = 4;
  // …pagination, sorting, lens_options, sync_reason, parameters
}

message RequestedFields {
  optional bool all = 1;
  optional spotify.list.v1.model.ListResponse list_response = 2;
}
```

Que es, en el mismo orden:

```text
GetListsRequest { requests: 1 }
  GetListRequest { identifier: 1, options: 2 }
    ListIdentifier { uri: 1 }
    RequestOptions { requested_fields: 4 }
      RequestedFields { all: 1 }
```

**`requested_fields` no es opcional**: un pedido sin él contesta `200` con un
cuerpo que dice, en inglés, *"RequestedFields must not be empty. Specify which
fields you need"*. Y el servicio contesta `application/x-protobuf` aunque le
mandes JSON: el cuerpo que se manda tiene que ser protobuf de verdad.

Lo que vuelve es un `GetListsResponse` con la lista:

- `meta_items` con la clave **`jam-session-id`**, y su valor es el id de la
  sesión. Es el ancla: dice a qué jam pertenece la lista.
- `items`: **250 pistas**, cada una con su id —`spotify:track:…`— y sus
  atributos (`track`, `autoplay`, `is_autoplay`, `decision_id`).
- `attributes` con la `list-uri` de la lista de la que salió la cola: en la
  medición, `spotify:list:popular-release-segments-main-roles:artist_2N4rDzKt2aZK1ksES0YKBP`.

O sea que **una cola recién creada no está vacía**: viene sembrada con las
canciones populares del artista que se estaba escuchando. No son pistas que
alguien haya agregado: son la semilla, y por eso traen `autoplay` e
`is_autoplay`. Eso también dice que la cola del jam y la lista de la que sale
son dos cosas: la cola es del jam, y la semilla viene de otra lista.

La respuesta entera queda en `%LOCALAPPDATA%\Starless\jam-list-sesion.bin`,
porque son 43 KB de protobuf y el log la muestra recortada.

## Cómo se llegó

Sin descompilador, y sin adivinar una sola ruta.

**1. Los strings del cliente de escritorio.** El `Spotify.dll` de Windows
—`C:\Program Files\WindowsApps\SpotifyAB.SpotifyMusic_*`— trae las rutas del
servicio enteras, porque son strings como cualquier otro. Se leen con un
`IndexOf` sobre el archivo, como se hizo con los protos:

```powershell
$dll = 'C:\Program Files\WindowsApps\SpotifyAB.SpotifyMusic_1.306.1921.0_x64__zpdnekdrzrea0\Spotify.dll'
$bytes = [System.IO.File]::ReadAllBytes($dll)
$text = [System.Text.Encoding]::Latin1.GetString($bytes)
$all = [regex]::Matches($text, '[\x20-\x7E]{4,}') | ForEach-Object { $_.Value }
$all | Where-Object { $_ -match 'social-connect' } | Select-Object -Unique
```

**2. El proto, del mismo binario.** El `Spotify.dll` no trae los `.proto` como
texto —sí trae sus **descriptores compilados**, que es lo mismo con otra
forma—, y el descriptor de `social_connect_v2.proto` se puede volver a escribir
como `.proto`. Para eso está `scripts/proto-dump.ts`:

```
bun scripts/proto-dump.ts "C:\Program Files\WindowsApps\...\Spotify.dll" social_connect_v2.proto
```

El volcado sale entero:

```proto
syntax = "proto3";

package socialconnect;

enum SessionUpdateReason {
  UNKNOWN_UPDATE_TYPE = 0;
  NEW_SESSION = 1;
  USER_JOINED = 2;
  USER_LEFT = 3;
  SESSION_DELETED = 4;
  YOU_LEFT = 5;
  YOU_WERE_KICKED = 6;
  YOU_JOINED = 7;
  USER_KICKED = 10;
  VOLUME_CONTROL_PERMISSIONS_CHANGED = 11;
  QUEUE_ONLY_MODE_CONTROL_CHANGED = 12;
  WIFI_BROADCAST_CHANGED = 13;
  ACTIVE_DEVICE_CHANGED = 14;
  SESSION_MEMBER_UPDATED = 16;
  SESSION_ACTIVATED = 17;
  SESSION_MEMBER_PAUSE_CHANGED = 18;
  JAM_CAPPING_STATE_CHANGED = 19;
  YOU_WERE_REMOVED_UNSUPPORTED_CONTENT = 20;
}

enum PlaybackControl {
  UNKNOWN = 0;
  CONTROL = 1;
  LISTEN_AND_CONTROL = 2;
}

message Session {
  optional int64 timestamp = 1;
  optional string session_id = 2;
  repeated socialconnect.SessionMember session_members = 6;
  optional bool is_session_owner = 9;
  optional bool active = 17;
  optional bool redirect_commands = 25;
  optional bool requires_jam_lens = 31;
}

message SessionMember {
  optional string id = 2;
  optional string username = 3;
  optional string display_name = 4;
  optional string image_url = 5;
  optional socialconnect.PlaybackControl playback_control = 9;
  optional bool is_current_user = 10;
  optional bool listen_mode = 11;
}

message SessionUpdate {
  optional socialconnect.Session session = 1;
  optional socialconnect.SessionUpdateReason reason = 2;
}
```

`SessionUpdate` es lo que llega por pubsub: **el mismo mensaje de sesión, con
un motivo**. El motivo es lo que dice qué pasó —se unió alguien, se fue
alguien, te expulsaron, cambiaron los permisos— y es la razón de que el enum
sea tan largo.

**El proto y el JSON no coinciden en los nombres.** El proto llama
`listen_mode` a lo que el JSON llama `is_listening`, y llama
`playback_control` a lo que el JSON llama `playbackControl`: el proto es el
contrato viejo y el JSON el vigente, o son dos capas distintas. Para trabajar
con el JSON no hace falta el proto; para el pubsub, sí.

## Lo que el cliente de escritorio dice del jam

Los strings del `Spotify.dll` cuentan cómo funciona, aunque no digan cómo
llamarlo:

- **`/current` es la puerta de entrada.** El cliente pide la sesión actual al
  arrancar, se vuelve a pedir después de conectarse al pubsub, y si la
  respuesta dice que no hay ninguna, limpia lo que tenga de sesión local. Eso
  es exactamente un `GET` contra la sesión actual —que en este host es
  `current_or_new`.
- **Hay un pubsub.** "Jam pubsub connected with id '%s'", "Jam pubsub
  disconnected", "Refreshing Jam session from /current after pubsub
  connection": los cambios de la sesión llegan por pubsub y, cuando se corta, se
  vuelve a preguntar por `/current`.
- **Los tokens de join son dos.** "Jam Readable Join Token" y "Jam Writable
  Join Token": el que entra puede mirar, o puede además tocar la cola. La
  sesión que devuelve el servicio trae **un** token, así que el segundo llega
  por otra puerta —la del convite, que no se encontró.
- **La cola es una lista.** `spotify:list:jam-list:` — y no `spotify:playlist:`,
  que es la de las playlists de verdad. Es otro tipo de objeto.
- **El jam es un "lens".** `requires_jam_lens` viene en la sesión, y
  `JAM_LENS_MANAGER` es un componente del cliente: el jam se dibuja con el
  sistema de "lenses" de Spotify.
- **Hay un tope.** `JAM_CAPPING_STATE_CHANGED` es un motivo de actualización, y
  `disable_jam_mode_when_in_jam` / `disable_smart_shuffle_when_in_jam` son
  banderas del producto: el modo jam se desactiva solo en ciertas condiciones.

## Lo que no está

Estas tres cosas son las que definen el tamaño del trabajo.

**1. `pubsub` no existe en librespot.** El `dealer` de librespot-core 0.8 no
tiene pubsub —`librespot-connect` sólo menciona un
`explicit_content_pubsub`, que es otra cosa—. Y el jam **depende** del
pubsub: sin él, un cambio en la sesión —alguien que se suma, un permiso que
cambia— no llega hasta que alguien pregunta. La puerta de la sesión existe
igual, así que el sistema puede **preguntar** en vez de **recibir**: el costo es
un polling, y la pregunta abierta es qué tan seguido.

**2. La puerta del jam no existe en librespot 0.8.** No hay un solo `jam` en
todo el crate: ni en `librespot-protocol` —que trae 2.068 protos—, ni en
`librespot-core`. El proto de este documento está en el cliente de escritorio,
no en la dependencia, así que hay que **compilarlo aparte** si se quiere usar
el mensaje tipado: o se copia el `.proto` al crate, o se trabaja con el JSON
que el servicio devuelve.

**3. La cola tiene su puerta, y es otra.** La cola del jam es una lista
(`spotify:list:jam-list:`), y su servicio es
`playlist/spotify.list.v1.ListReadService/GetLists` —también del cliente de
escritorio—. Se midió que **existe, que es `POST` y que habla protobuf**; el
`GET` contesta `405`, y el JSON se lo come y contesta el mensaje de que faltan
los campos pedidos. Lo que falta es **escribir**: leer la cola se sabe, y
agregar una canción es un `PATCH` —el cliente tiene un `jam.patch_track`— que
todavía no se encontró.

## La sonda

La sonda vive en `src-tauri/src/spclient/probe.rs`, detrás de `#[cfg(debug_assertions)]`
como todas las demás, y pregunta lo que faltaba: **si una sesión de streaming
puede usar esa puerta**.

| Ambiente | Qué hace |
| --- | --- |
| `STARLESS_SP_JAM=1` | mide las rutas: status y cuerpo de cada una |
| `STARLESS_SP_JAM_CREATE=1` | además activa la sesión |

**La sonda no usa el cliente de librespot.** `HttpClient::request` tira el
cuerpo de toda respuesta que no sea 2xx, un nivel más abajo que cualquier tipo
con nombre: un `404` y un `400` llegarían sin cuerpo y sin explicación, que es
justo lo que hay que ver. La sonda habla con `reqwest` —el cliente async, que
dentro de `call` no levanta un runtime propio— y trae el status y el cuerpo
de todo.

**La sonda cierra lo que abre.** `current_or_new` crea una sesión aunque sólo
se quiera leer, así que al final la sonda la borra con
`DELETE /social-connect/v2/sessions/<id>`, que es la puerta que contestó `200`.
Una sesión de jam viva se le ve a la persona que la está probando —aparece en
el cliente de Spotify y en la lista de sesiones— y eso es ruido, no un
resultado.

## Lo que falta

Honesto, porque buena parte de esto no se comprobó:

- **La puerta de join de un invitado.** La que se midió es la del token de la
  sesión del anfitrión. El servicio nombra dos tokens distintos —de lectura y
  de escritura— y la sesión que devuelve trae uno solo: falta la puerta del
  convite, y con ella la forma de compartir el jam.
- **Escribir en la cola.** Se sabe leerla —con su URI, su servicio y su
  cuerpo— y falta la puerta de escritura: el `jam.patch_track` del cliente
  sugiere un *patch* sobre la pista.
- **Cómo se modifica una sesión.** `GET`, `POST`, `PUT` y `PATCH` sobre
  `/social-connect/v2/sessions/<id>` contestan `405`: el verbo es otro, y
  probablemente sea un `POST` con el cuerpo del proto. Los permisos
  (`queue_only_mode`, `volume_control`) no están en este host.
- **Si el pubsub se puede implementar.** Si no, el sistema pregunta en vez de
  recibir, y hay que decidir cada cuánto.

## Para librespot

Si esto termina en un issue o un PR, lo que aporta es:

1. **El nombre del servicio**: `social-connect`, y no `jam`. Las rutas no lo
   dicen.
2. **Que la puerta existe y que una sesión de streaming la puede usar**, con su
   forma y con su proto, y que el proto `social_connect_v2.proto` no viene en
   el crate —que trae 2.068 protos y ninguno es de jam—.
3. **Que el jam no es una playlist**: es otro servicio, y la cola es una lista
   de otro tipo (`spotify:list:jam-list:`), servida por
   `playlist/spotify.list.v1.ListReadService/GetLists`.
4. Que el servicio devuelve JSON por defecto, y que `alt=protobuf` es la
   excepción.
5. Que **abrir una sesión es un `GET`** que la crea si no había, que unirse es
   un `POST` con cuerpo, y que cerrarla es un `DELETE` —y que las tres cosas
   las acepta la sesión de streaming, sin nada más.
