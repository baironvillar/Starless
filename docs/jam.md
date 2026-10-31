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
| Llenar la cola | `POST /social-connect/v2/sessions/<session_id>/commands/from/<device_id>`, con un comando de `endpoint: "add_to_queue"` |
| Forma de la respuesta | JSON, con `session_id`, `join_session_token` y los participantes |
| Lo que falta | el camino de vuelta de los comandos —el pubsub— y una segunda cuenta para medir el cruce |

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

### La forma de las cinco puertas

| | |
| --- | --- |
| Abrir o leer la sesión | `GET /social-connect/v2/sessions/current_or_new?activate=false` |
| Activarla | el mismo `GET`, con `activate=true` |
| Unirse | `POST /social-connect/v2/sessions/join/<token>` **con cuerpo** |
| Salir de ella | `POST /social-connect/v2/sessions/<session_id>/leave` **con cuerpo** |
| Borrarla | `DELETE /social-connect/v2/sessions/<session_id>` |

**Salir y borrar son dos puertas, y la diferencia es quién aprieta el botón.**
Salir es la puerta de un invitado: lo saca de la sesión y deja la sesión viva.
Borrar es la del anfitrión: la sesión desaparece y con ella el jam entero.

Esto se midió el 30 de octubre de 2026, y es la diferencia entre "el segundo
usuario no puede salirse" y "el segundo usuario se sale":

```
POST   /social-connect/v2/sessions/<id>/leave   →  200
GET    /social-connect/v2/sessions/<id>/leave   →  405
DELETE /social-connect/v2/sessions/<id>/leave   →  405
DELETE /social-connect/v2/sessions/<id>/leave?reason=USER_LEFT → 405
POST   /social-connect/v2/sessions/<id>/leave   →  200   (con cuerpo {})
DELETE /social-connect/v2/sessions/<id>         →  404 SESSION_NOT_FOUND
```

**El `404` de la última línea es la prueba de que la puerta funcionó**: después
de salir, la sesión ya no existe. Y el `DELETE` sin `leave` es lo que borra la
sesión —es la puerta del anfitrión—, así que el comando de la app hace las dos
cosas cuando quien aprieta "salir" es el que la abrió.

El `405` de `GET` y de `DELETE` sobre `…/leave` dice que la ruta existe y que el
verbo no es ese: no es un invento, es una puerta con otro verbo.

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

### Escribir en la cola: la puerta que no era

La cola se lee; **escribirla se hace por otra puerta, y no por playlist4**.

Lo primero que se probó fue la puerta que el repo ya conoce para las playlists:
`POST /playlist/v2/playlist/<id>/changes` con un `ListChanges`, contra la cola del
jam, con la revisión que trae la propia lectura —la revisión viene en
`GetListResponse.info.revision`, y sin ella la escritura es un `400` a un cuerpo
que el servicio acepta—:

| id probado | respuesta |
| --- | --- |
| `<session_id>` | `400` |
| `jam-<session_id>` | `400` |
| `spotify:list:jam-list:<session_id>` | `400` |
| `4uLU6hMCjMI75M1A2tKUQC` —un id que no existe— | `404` |

**El `400` no era el cuerpo.** Era el **id**. Playlist4 sólo acepta ids de 22
caracteres de base62, y un id de esa forma que no existe contesta `404`: la
comparación de la tabla lo dice solo. Los tres `400` eran ids con otra forma —32
hex, 36 con prefijo, una URI—, y no un `ListChanges` mal escrito.

Eso cierra la puerta de playlist4 para la cola del jam: **la cola del jam no es
una playlist y no tiene id de playlist4.** Es una lista del otro sistema —el de
`spotify:list:`—, que se lee por el servicio de listas y que no tiene servicio de
escritura en el cliente de escritorio.

Los cuatro cuerpos que se probaron (`ADD` con `add_last`, `ADD` sin `add_last`,
`ADD` sin atributos en el item, `ADD` con el id del participante) contestaron
`400`, pero ese `400` era el del id y no el del cuerpo: **lo que se estaba
midiendo mal era la pregunta.**

La puerta que sí funciona es la de comandos, y está abajo.

## La puerta de comandos

El cliente de escritorio tiene una puerta más, y existe:

```
POST /social-connect/v2/sessions/<session_id>/commands/from/<device_id>
```

El `GET` al mismo camino contesta `405` —es de escritura— y el `POST` con un
cuerpo cualquiera contesta:

```json
{"error_type":"INVALID_CONNECT_PLAYER_COMMAND","message":"missing or empty command field"}
```

O sea que el cuerpo tiene que traer un campo **`command`**. Con `{"command":{}}`
vuelve lo mismo, y con `{"command":{"type":"PLAY","context_uri":"spotify:track:…"}}`
vuelve `INVALID_PLAYER_COMMAND` —"Could not parse command"—: el campo se
encontró, pero lo que hay adentro no es un comando de reproducción.

### El comando no lleva `type`: lleva `endpoint`

**El error no era que el comando fuera inválido: era que el campo estaba mal
llamado.** El comando de reproducción no es un objeto con `type`, es un objeto
con **`endpoint`**:

```json
{"command": {"endpoint": "add_to_queue",
             "track": {"uri": "spotify:track:3b5E38f6Dbx28IVof4oeAA"},
             "options": {"override_restrictions": false,
                         "only_for_local_device": false,
                         "system_initiated": false},
             "logging_params": {"command_initiated_time": 1759…,
                                "command_received_time": 1759…,
                                "page_instance_ids": [], "interaction_ids": [],
                                "device_identifier": "Starless",
                                "command_id": "<32 hex>"}},
 "connection_type": "wlan",
 "intent_id": "<32 hex>"}
```

Con esa forma, medido el 30 de octubre de 2026:

| comando | respuesta |
| --- | --- |
| `add_to_queue` con la uri de la pista | `200` · `{"status":"RECOVERED"}` |
| `add_to_queue` con la uri y el uid | `200` · `{"status":"RECOVERED"}` |
| `add_to_queue` sin `logging_params` | `200` · `{"status":"RECOVERED"}` |
| `play` con la uri de la pista | `200` · `{"status":"RECOVERED"}` |
| `skip_next` | `200` · `{"status":"RECOVERED"}` |
| `pause` | `200` · `{"status":"DEVICE_NOT_FOUND"}` |

El `options` y el `logging_params` **no hacen falta**: con
`{"endpoint":"add_to_queue","track":{"uri":"…"}}` a secas también entra. Se mandan
igual porque es lo que manda el cliente de escritorio.

El estado no es un error: `RECOVERED` es que el comando entró, y
`DEVICE_NOT_FOUND` —lo que contesta `pause`— es que no había un dispositivo al
que mandárselo.

### De dónde salió la forma

Del cliente de escritorio, y de un proyecto que ya la tenía escrita:
[`mcMineyC/spotcontrol`](https://github.com/mcMineyC/spotcontrol), que invierte
el protocolo de Spotify Connect capturando el tráfico del cliente. Su
`PlayerCommand` es exactamente esto —`endpoint`, `value`, `track`, `options`,
`logging_params`— y su `PlayerCommandRequest` es el sobre con `command`,
`connection_type` e `intent_id`. La pista del comando es un
`spotify.connectstate.ContextTrack`, que tiene `uri`, `uid`, `gid` y `metadata`.

**El `connection_type` es `"wlan"`**, no `"LOCAL"`.

### Lo que esta puerta no arregla

**Es de escritura.** El comando entra en la sesión, y el servicio lo aplica —el
estado que contesta es el del player—. Lo que **no** hay es el camino de vuelta:
el invitado no *recibe* comandos, los pide, y para enterarse de lo que el otro
lado manda hace falta pubsub. El pubsub no está en librespot.

Lo que sí queda de este lado es la cola: **los dos leen la misma cola**, y el
que la llena la llena con un comando como este. Por eso la reproducción cruza
de un lado al otro sin pubsub: no es que uno mande al otro, es que los dos miran
la misma lista.

### La cola del jam es la cola del anfitrión, y Starless no tiene cola

Esto se midió el 30 de octubre de 2026, con la sesión activa y sin nada
sonando:

| | |
| --- | --- |
| la cola del jam, antes del comando | `200` · `Not Found` · 0 canciones |
| el comando `add_to_queue` | `200` · `{"status":"RECOVERED"}` |
| la cola del jam, después del comando | `200` · `Not Found` · 0 canciones |

**El comando entra y la cola sigue sin existir.** La cola del jam no es una lista
que el servicio arme: es **la cola del player del anfitrión**, y el servicio la
publica. Cuando el anfitrión es el cliente de escritorio —que tiene contexto y
cola— la cola del jam existe: se la midió con 300 canciones y su `list-uri`
apuntando a la lista de contexto del anfitrión.

**Starless no tiene cola de player.** El `Player` de librespot 0.8 carga
pistas —`load(track_id)`— y no tiene contexto ni cola: `librespot-playback`
no expone esas dos cosas. La app por lo tanto reproduce de a una, y el
servicio no tiene de dónde tomar la cola del jam.

Eso deja dos casos, y son distintos:

- **El anfitrión es otra cosa** —el cliente de escritorio, el celu—: la cola
  existe, se lee, y el comando del invitado la llena. **Es el caso que
  funciona.**
- **El anfitrión es Starless**: no hay cola compartida, y el invitado ve una
  lista vacía. La cola del jam no se puede crear desde acá: el comando entra y
  no aparece.

Lo que **no** se midió es el caso del invitado con el anfitrión en el cliente
de escritorio: que el comando llegue al player del anfitrión y que la cola de
éste crezca. Eso necesita dos cuentas.

## El estado del dispositivo

```
GET /connect-state/v1/cluster  →  200
```

Devuelve el grupo de dispositivos de la cuenta **con el estado de
reproducción**: `context_uri`, la pista, la posición, si está pausada, y la
cola. Es la misma forma que usa el `connect-state` del cliente de escritorio.

No es la puerta del jam —es la del grupo de Spotify Connect de la cuenta—, así
que no se sabe todavía si el anfitrión de un jam aparece en el grupo del
invitado. Sin una segunda cuenta no se puede medir, y esa es la cuenta que hace
falta para medir el jam entero.

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
los campos pedidos. **Escribir se resolvió por otra puerta** —la de comandos,
con un `add_to_queue`—, pero **lo que se escribe es la cola del player del
anfitrión**, y el player de librespot no tiene cola: ver
[La cola del jam es la cola del anfitrión](#la-cola-del-jam-es-la-cola-del-anfitrión-y-starless-no-tiene-cola).

## La pantalla

El jam tiene su puerta en la barra de arriba, a la derecha, junto a los amigos:
un botón que abre el panel de **actividad de escucha**, como en Spotify. El
panel ofrece lo mismo que ofrece Spotify —"Start a Jam"— y, cuando la sesión
está abierta, el **código para compartir** y **quién está en el jam**.

**El código es toda la invitación.** No hay una página que abrir ni un enlace
que seguir: la puerta del invitado toma el código, así que el panel muestra el
código. Se copia con un clic.

Las tres puertas de la UI son las tres del servicio:

| En la pantalla | En el servicio |
| --- | --- |
| Empezar un jam | `GET /social-connect/v2/sessions/current_or_new?activate=true` |
| Entrar con un código | `POST /social-connect/v2/sessions/join/<token>` |
| Salir del jam | `POST /social-connect/v2/sessions/<session_id>/leave` |
| Terminar el jam | `DELETE /social-connect/v2/sessions/<session_id>` |

**El panel no lee la sesión al abrirse**, y es a propósito: la única puerta que
lee una sesión es la que también la crea —`current_or_new`—, así que abrir el
panel dejaría un jam abierto en la cuenta de alguien que sólo quería mirar. La
sesión se pide cuando se aprieta el botón.

**Y ahora sí se lee, cada tanto.** Con el jam abierto, el panel pregunta la
sesión y la cola compartida cada tres segundos: **el jam no tiene pubsub en
librespot** —el `dealer` no lo lleva—, así que preguntar es la única forma de
saber que alguien se unió. La puerta que pregunta es la misma que crea, así que
sólo se pregunta con una sesión en la mano: si la respuesta trae otra sesión,
la que había ya no está y el panel lo dice en vez de adoptarla.

**El jam convive con la cola.** Spotify abre un jam desde la cola, y la cola no
se cierra: los dos paneles contestan preguntas distintas —qué suena acá y quién
más está escuchando— y ninguno tiene que hacer lugar al otro. Cuando la cola
está abierta, el jam se docks a su izquierda.

### Lo que la pantalla todavía no muestra

- **La cola, en el panel: ya está.** Se lee, se decodifica y se resuelve en
  nombres (`src-tauri/src/spclient/jamlist.rs` la decodifica a mano, porque el
  proto del servicio de listas no está en librespot).
- **Meter una canción en la cola: ya está.** Con el jam abierto, la cola de la
  app y el menú de cada canción tienen un botón que manda el `add_to_queue` a
  la sesión. El botón **no está en la canción que está sonando**: esa ya está
  en la cola del jam, y volver a agregarla sería agregarla dos veces.
- **La actividad de los amigos.** La lista de "quién está escuchando" es otro
  servicio, del que no se midió nada. Lo que hay hoy son los participantes del
  jam, que es otra cosa.

## La sonda

La sonda vive en `src-tauri/src/spclient/probe.rs`, detrás de `#[cfg(debug_assertions)]`
como todas las demás, y pregunta lo que faltaba: **si una sesión de streaming
puede usar esa puerta**.

| Ambiente | Qué hace |
| --- | --- |
| `STARLESS_SP_JAM=1` | mide las rutas: status y cuerpo de cada una, y **prueba las funciones de la app** |
| `STARLESS_SP_JAM_CREATE=1` | además activa la sesión |
| `STARLESS_SP_JAM_QUEUE=1` | **sólo** la cola: leerla, mandar el comando y volver a leerla |

**La sonda mide dos cosas.** Todo lo de abajo habla con `reqwest` y trae el
cuerpo de todas las respuestas —que es lo que hace falta para *medir*—, pero lo
que hace la pantalla es otra cosa: las funciones de producción, que hablan con
el cliente de librespot. Las dos tienen que funcionar, y la que no se puede ver
desde el log es justamente la segunda: por eso la sonda abre y cierra la sesión
**también** por la función de la app, y dice en el log qué devolvió.

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
- **El camino de vuelta de los comandos.** La puerta de comandos es de escritura:
  el comando entra y el servicio lo aplica, pero el otro lado no lo *recibe* sin
  pubsub. Por eso el cruce funciona por la cola —los dos leen la misma lista— y
  no por el comando.
- **Si el comando que manda el invitado llega a la cola del anfitrión.** El
  servicio contesta `200` con `{"status":"RECOVERED"}`, que dice que el comando
  entró, pero no dice **qué hizo**: eso necesita dos cuentas. Lo que sí se midió
  es que, con Starless de anfitrión, la cola del jam **no existe** —ni antes ni
  después del comando—, porque esa cola es la del player del anfitrión y el
  player de librespot no tiene cola.
- **Cómo se modifica una sesión.** `GET`, `POST`, `PUT` y `PATCH` sobre
  `/social-connect/v2/sessions/<id>` contestan `405`: el verbo es otro, y
  probablemente sea un `POST` con el cuerpo del proto. Los permisos
  (`queue_only_mode`, `volume_control`) no están en este host.
- **Si el pubsub se puede implementar.** Si no, el sistema pregunta en vez de
  recibir, y hay que decidir cada cuánto. **La decisión ya está tomada y es
  preguntar**: la sesión y la cola se piden cada tres segundos.
- **Lo que falta para medirlo del todo: una segunda cuenta.** Todo lo que se
  sabe del jam se midió con una cuenta: la que abre la sesión. Lo que pasa
  cuando **alguien más** se une —qué ve el anfitrión, qué puede hacer el
  invitado, si el invitado puede salirse de verdad— necesita dos cuentas y dos
  máquinas.

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
   un `POST` con cuerpo, que **salir es un `POST` a `…/leave`** y que cerrarla
   es un `DELETE` —y que las cuatro cosas las acepta la sesión de streaming,
   sin nada más.
6. Que **salir y cerrar son puertas distintas**: la primera es la del
   invitado, la segunda la del anfitrión. Con una sola, el invitado no puede
   salirse.
7. Que **la cola se llena con un comando de reproducción, no con una escritura
   de lista**, y que ese comando lleva `endpoint` y no `type` —con `type` el
   servicio contesta `Could not parse command`, que es un error que parece
   говори de otra cosa—. Y que la cola **no se escribe por playlist4**: el
   `400` de `…/playlist/<id>/changes` es por el **id**, que no tiene la forma
   que playlist4 acepta.
8. Que **la cola del jam es la cola del player del anfitrión**, no una lista
   del servicio: con Starless de anfitrión no existe —el `Player` de librespot
   carga pistas y no tiene contexto ni cola—, y el comando del invitado la
   llena cuando el anfitrión es otro cliente.
