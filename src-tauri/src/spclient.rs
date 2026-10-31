//! La biblioteca y la cuenta, por la sesión que ya existe.
//!
//! ## Por qué este módulo existe
//!
//! Starless llegaba a `api.spotify.com` con un client id propio, y una app en
//! modo desarrollo sólo sirve a los usuarios de su lista: cinco, desde febrero de
//! 2026. Para todos los demás, `/me` respondía 403 y la app abría con una
//! biblioteca vacía sin decir por qué. No es una cuota que se pague — el modo de
//! cuota extendida exige una organización registrada con 250.000 usuarios
//! activos mensuales, que no es una puerta que este proyecto pueda abrir.
//!
//! La sesión de librespot ya le habla a Spotify por dentro: es la que trae el
//! audio. Por ese mismo canal responde la biblioteca, y no hay client id, ni
//! lista de usuarios, ni revisión, ni el requisito de Premium del dueño — que es
//! de las apps de desarrollador, no de esta sesión.
//!
//! ## Cómo se lee
//!
//! `get_rootlist` no devuelve JSON: devuelve un `playlist4_external` serializado,
//! el mismo formato que usa la sesión para describirse las playlists a sí misma.
//! Sus `items` son las URIs y sus `meta_items` traen nombre, longitud, dueño y
//! capacidades. Es el mismo mensaje que devuelve `get_playlist` con el contenido
//! de dentro, así que una sola estructura sirve para las dos cosas.
//!
//! ## Lo que todavía no está hecho
//!
//! Esto arranca como una sonda: una pregunta, ejecutada al arrancar, que
//! responde en el log. Que responda es lo único que decide si el resto de este
//! módulo existe.

use std::collections::HashMap;
use std::future::Future;
use std::sync::mpsc;
use std::time::Duration;

use futures_util::{stream, StreamExt, TryStreamExt};
use librespot_core::error::ErrorKind;
use librespot_core::{FileId, Session, SpotifyId, SpotifyUri};
use librespot_metadata::{Lyrics as MetaLyrics, Metadata, Track as MetaTrack};
use librespot_protocol::autoplay_context_request::AutoplayContextRequest;
use librespot_protocol::context::Context;
use librespot_protocol::extended_metadata::{BatchedEntityRequest, EntityRequest, ExtensionQuery};
use librespot_protocol::extension_kind::ExtensionKind;
use librespot_protocol::metadata::Track as TrackMessage;
use librespot_protocol::playlist4_external::{
    Add, ChangeInfo, Delta, Item, ItemAttributes, ItemAttributesPartialState, ListAttributeKind,
    ListAttributes, ListAttributesPartialState, ListChanges, Op, RegisterPlaylistImageRequest,
    RegisterPlaylistImageResponse, SelectedListContent, UpdateItemAttributes, UpdateListAttributes,
    op,
};
use protobuf::{EnumOrUnknown, Message, MessageField};

use crate::models::{
    Account, Album, Artist, DjMix, DjNarration, DjPage, Image, JamSession, LyricLine, Lyrics,
    Playlist, PlaylistDetails, Track, TrackTotal,
};
use crate::voice::VoiceParams;

/// Cuánto espera una llamada antes de rendirse.
///
/// Sin esto, una llamada que no contesta deja el proceso colgado sin decir por
/// qué — que es la diferencia entre "Spotify no devolvió nada" y "la app se
/// quedó esperando", dos fallos que en el log se ven idénticos.
const CALL_TIMEOUT: Duration = Duration::from_secs(20);

/// Cuántas playlists pide por llamada.
///
/// El rootlist pagina, y este es el techo de una página: la biblioteca de una
/// cuenta que usa Starless todos los días entra entera. Si alguna vez no entra,
/// la respuesta trae los índices de página siguiente y esta constante es lo
/// único que hay que subir.
const ROOTLIST_PAGE: usize = 200;

/// Corre una llamada async contra la sesión y devuelve su resultado en el hilo
/// que la pidió.
///
/// `spclient` es async y el resto de Starless vive en hilos bloqueantes. El
/// puente es el runtime de librespot más un canal: la llamada se va, y este
/// hilo espera con un timeout. El receptor se suelta al vencer, porque una
/// llamada colgada no puede dejar la app sin ventana.
fn call<T: Send + 'static>(
    session: &Session,
    call: impl Future<Output = Result<T, String>> + Send + 'static,
) -> Result<T, String> {
    let (tx, rx) = mpsc::channel();
    // `spawn` exige `'static`: nada de esto puede capturar una referencia al
    // hilo que la llamó.
    session.spawn(async move {
        let _ = tx.send(call.await);
    });

    match rx.recv_timeout(CALL_TIMEOUT) {
        Ok(result) => result,
        Err(e) => {
            log::error!("spclient: sin respuesta en {CALL_TIMEOUT:?}: {e}");
            Err("network_failed".to_string())
        }
    }
}

/// El id desnudo de una URI de playlist.
///
/// `spotify:playlist:1I0vuVi1…` y `1I0vuVi1…` son la misma playlist, y el
/// frontend guarda lo segundo. Cortar el prefijo es más barato que construir un
/// `SpotifyUri` para pedirle de vuelta el id.
fn bare_id(uri: &str) -> String {
    uri.rsplit(':').next().unwrap_or(uri).to_string()
}

/// El código de error que le corresponde a un fallo de librespot.
///
/// **Esto estaba faltando, y no era cosmético.** El frontend reintenta ante
/// `rate_limited` y `service_unavailable` — `main.tsx` los cuenta entre las
/// razones para volver a intentarlo — y ninguno de los dos códigos llegaba
/// nunca: cada `map_err` colapsaba cualquier error a `network_failed`. Una
/// política de reintentos que espera un código que nadie emite no es una política
/// de reintentos: es texto que promete que la app reintenta.
///
/// librespot sí distingue los dos casos. `ResourceExhausted` es el servicio
/// pidiendo que uno baje el ritmo; `Unavailable` es "no hay nadie del otro lado".
/// Los dos tienen su frase en `spotify.ts` y los dos se reintentan.
///
/// Lo que este helper **no** hace es decidir de quién es la culpa.
/// `Unavailable` también lo produce un `ConnectionRefused` local —la red de la
/// casa se cayó—, así que el mensaje del frente dice que no se pudo llegar, no
/// que Spotify esté de pie. Decirle a alguien cuya red se fue abajo que Spotify
/// tiene problemas lo manda a buscar un problema que no tiene.
fn net_code(error: &librespot_core::error::Error) -> String {
    match error.kind {
        ErrorKind::ResourceExhausted => "rate_limited",
        ErrorKind::Unavailable => "service_unavailable",
        _ => "network_failed",
    }
    .to_string()
}

/// Cuántas pistas se piden por viaje de metadata.
///
/// El servicio acepta un lote entero; el número es una decisión propia y no un
/// límite del otro lado. Se corta en cincuenta porque una playlist de doscientas
/// pistas en un solo pedido es un pedido que se cae entero y tira doscientas
/// filas, mientras que cinco pedidos de cuarenta muestran las primeras páginas
/// y las siguientes llegan igual.
const DETAILS_BATCH: usize = 50;

/// Cuántas tandas de [`details`] pueden estar en el aire a la vez.
const DETAILS_IN_FLIGHT: usize = 8;

/// La URL de una portada, sin pedirla.
///
/// `get_image` arma la URL, la descarga y devuelve los bytes de la imagen — y
/// un `<img>` de la webview se baja lo mismo por su cuenta. La plantilla vive en
/// los atributos de la sesión, así que la URL se arma acá y no viaja nadie.
fn image_url(session: &Session, file_id: &FileId) -> Option<String> {
    let template = session.get_user_attribute("image-url")?;
    file_id
        .to_base16()
        .ok()
        .map(|hex| template.replace("{file_id}", &hex))
}

/// Lee un varint de protobuf y devuelve su valor y dónde termina.
///
/// A mano porque acá no hay un `.proto` que lo describa: el mensaje de la portada
/// no viene generado en `librespot-protocol`, y sin él no hay un tipo del que
/// llamar. Es el mismo camino que el resto del módulo —decodificar a mano lo que
/// Spotify no publica— y la alternativa sería no tener la foto.
fn read_varint(bytes: &[u8], from: usize) -> Option<(u64, usize)> {
    let mut value: u64 = 0;
    let mut shift = 0;
    let mut at = from;
    while at < bytes.len() {
        let byte = bytes[at];
        value |= u64::from(byte & 0x7f) << shift;
        at += 1;
        if byte & 0x80 == 0 {
            return Some((value, at));
        }
        shift += 7;
        // Diez bytes es el tope del formato; seguir leyendo sería un bucle
        // infinito sobre bytes que no son un mensaje.
        if shift > 63 {
            return None;
        }
    }
    None
}

/// Saca las direcciones de un protobuf sin esquema.
///
/// No adivina la forma del mensaje: camina el formato y junta todo lo que sea un
/// texto UTF-8 que empiece por `http`. Para un mensaje que es, esencialmente, "la
/// foto de esta cosa", eso no puede confundir nada con otra cosa.
///
/// Los grupos —tipos 3 y 4— no se usan en proto3 y cortan el recorrido: entrar a
/// algo que no se entiende es peor que devolver menos.
fn harvest_urls(bytes: &[u8], out: &mut Vec<String>, depth: usize) {
    if depth > 8 {
        return;
    }
    let mut at = 0;
    while at < bytes.len() {
        let Some((key, next)) = read_varint(bytes, at) else {
            return;
        };
        at = next;
        match (key & 7) as u8 {
            // varint
            0 => match read_varint(bytes, at) {
                Some((_, next)) => at = next,
                None => return,
            },
            // 64 bits
            1 => at += 8,
            // 32 bits
            5 => at += 4,
            // longitud variable: el único caso que puede traer algo
            2 => {
                let Some((len, next)) = read_varint(bytes, at) else {
                    return;
                };
                at = next;
                let end = match at.checked_add(len as usize) {
                    Some(end) if end <= bytes.len() => end,
                    // Una longitud que no cabe es un mensaje que no es lo que
                    // decimos que es. Seguir leyendo de acá en adelante es ruido.
                    _ => return,
                };
                let slice = &bytes[at..end];
                // "¿Es esto una URL?" se responde con los primeros bytes, no
                // decodificando el mensaje entero: un mensaje que lo envuelve
                // tiene datos binarios adentro y `from_utf8` fallaría sobre él,
                // y con él se caería la URL que sí estaba adentro. Acá se pregunta
                // por el prefijo y se entra igual.
                if slice.starts_with(b"http") {
                    if let Ok(text) = std::str::from_utf8(slice) {
                        out.push(text.to_owned());
                    }
                } else {
                    harvest_urls(slice, out, depth + 1);
                }
                at = end;
            }
            _ => return,
        }
    }
}

/// La foto que Spotify ya le calculó a cada playlist.
///
/// Ni el rootlist con `picture` ni el endpoint de una playlist la traen: para las
/// playlists del usuario ese campo directamente no viaja. La tiene
/// `VISUAL_IDENTITY_TRAIT`, que es la extensión con la que Spotify describe hoy
/// cómo se ve una cosa — la misma idea que una portada— y que devuelve las
/// direcciones de la imagen ya hecha, mosaico incluido.
///
/// Va **batched junto con el resto de la biblioteca**: una sola llamada para todas
/// las playlists, no una por playlist.
fn playlist_covers(session: &Session, ids: &[String]) -> HashMap<String, Vec<String>> {
    let mut covers: HashMap<String, Vec<String>> = HashMap::new();
    if ids.is_empty() {
        return covers;
    }

    for chunk in ids.chunks(DETAILS_BATCH) {
        let request = BatchedEntityRequest {
            entity_request: chunk
                .iter()
                .map(|id| EntityRequest {
                    entity_uri: format!("spotify:playlist:{id}"),
                    query: vec![ExtensionQuery {
                        extension_kind: EnumOrUnknown::new(ExtensionKind::VISUAL_IDENTITY_TRAIT),
                        ..Default::default()
                    }],
                    ..Default::default()
                })
                .collect(),
            ..Default::default()
        };

        let owned = session.clone();
        let Ok(response) = call(session, async move {
            owned
                .spclient()
                .get_extended_metadata(request)
                .await
                .map_err(|e| {
                    log::error!("spclient: las portadas de las playlists fallaron: {e}");
                    net_code(&e)
                })
        }) else {
            // La biblioteca entera se muestra igual sin las fotos. Perder las
            // fotos no puede ser lo mismo que perder la biblioteca.
            continue;
        };

        for array in response.extended_metadata {
            for entry in array.extension_data {
                let (Some(payload), Ok(id)) = (
                    entry.extension_data.as_ref(),
                    SpotifyId::from_base62(&bare_id(&entry.entity_uri)),
                ) else {
                    continue;
                };
                let mut urls = Vec::new();
                harvest_urls(&payload.value, &mut urls, 0);
                if !urls.is_empty() {
                    log::info!(
                        "spclient: la portada de {} vino en {} direcciones",
                        bare_id(&entry.entity_uri),
                        urls.len()
                    );
                    covers.insert(id.to_base62().unwrap_or_default(), urls);
                }
            }
        }
    }

    covers
}

/// El mismo tipo que devuelve la Web API, para que el frontend no cambie.
///
/// La popularity viene a cero desde febrero de 2026 en las apps nuevas; acá se
/// informa lo que venga, que es lo que hay.
/// La canción del metadata, en la forma que el frontend la ve.
///
/// **Pública porque el camino de vuelta del jam la necesita**: cuando el otro
/// lado manda una canción para la cola, hay que resolverla y mandarle al
/// webview una canción entera, no una URI.
pub(crate) fn convert(track: &MetaTrack, session: &Session) -> Track {
    let album = &track.album;
    let cover = album
        .covers
        .iter()
        .find_map(|image| image_url(session, &image.id));

    Track {
        id: track.id.to_id().unwrap_or_default(),
        name: track.name.clone(),
        duration_ms: Some(track.duration.max(0) as u32),
        artists: track
            .artists
            .iter()
            .map(|artist| Artist {
                id: artist.id.to_id().unwrap_or_default(),
                name: artist.name.clone(),
            })
            .collect(),
        album: Some(Album {
            id: album.id.to_id().unwrap_or_default(),
            name: album.name.clone(),
            images: cover
                .into_iter()
                .map(|url| Image { url })
                .collect(),
        }),
        popularity: Some(track.popularity.max(0) as u32),
        // La metadata extendida de una pista no sabe en qué lista se encontró ni
        // cuándo entró: eso viene en la fila, y lo agrega [`hydrate`].
        added_at: None,
    }
}

/// Todas las pistas de un context, en el orden en que vinieron.
///
/// Un context trae una o más páginas y cada una trae pistas con su URI. No se
/// sigue `next_page_url` todavía: si un context viene truncado, eso se ve en el
/// log de la sonda y se mide antes de escribir el código que lo recorre.
fn context_uris(context: &Context) -> Vec<String> {
    for page in &context.pages {
        if page.next_page_url.as_deref().is_some_and(|url| !url.is_empty()) {
            log::warn!("spclient: el context trae página siguiente y no se está seguindo");
        }
    }
    context
        .pages
        .iter()
        .flat_map(|page| page.tracks.iter())
        .filter_map(|track| track.uri.clone())
        .map(|uri| bare_id(&uri))
        .collect()
}

/// Nombre, artistas, duración y portada de varias pistas.
///
/// **El emparejamiento es por URI, no por orden.** El servicio puede responder en
/// otro orden del que se pidió —o no responder con una pista que sí pidió— y
/// emparejar por posición asigna la portada de una canción a otra sin que nada
/// falle. Cada entrada trae su `entity_uri` justamente para eso.
///
/// **Las tandas van a la vez, no una detrás de otra.** Una playlist de mil
/// canciones son veinte tandas, y en fila eran veinte viajes al servidor antes
/// de dibujar una sola fila. El orden no importa —el resultado es un mapa por
/// URI— y el tope es para no abrir veinte pedidos contra el mismo servicio.
async fn details(owned: Session, uris: Vec<String>) -> Result<HashMap<String, Track>, String> {
    // Tandas propias y no prestadas: con un préstamo la promesa no es `Send`.
    let batches = stream::iter(uris.chunks(DETAILS_BATCH).map(<[String]>::to_vec))
        .map(|chunk| details_batch(owned.clone(), chunk))
        .buffer_unordered(DETAILS_IN_FLIGHT);
    batches
        .try_fold(HashMap::new(), |mut out, batch| async move {
            out.extend(batch);
            Ok(out)
        })
        .await
}

/// Una tanda de [`details`]: hasta [`DETAILS_BATCH`] pistas en un pedido.
async fn details_batch(owned: Session, chunk: Vec<String>) -> Result<Vec<(String, Track)>, String> {
    let mut out = Vec::new();
    let request = BatchedEntityRequest {
        entity_request: chunk
            .iter()
            .map(|uri| EntityRequest {
                entity_uri: format!("spotify:track:{uri}"),
                query: vec![ExtensionQuery {
                    extension_kind: EnumOrUnknown::new(ExtensionKind::TRACK_V4),
                    ..Default::default()
                }],
                ..Default::default()
            })
            .collect(),
        ..Default::default()
    };

    let response = owned
        .spclient()
        .get_extended_metadata(request)
        .await
        .map_err(|e| {
            log::error!("spclient: la metadata en lote falló: {e}");
            net_code(&e)
        })?;

    for array in response.extended_metadata {
        for entry in array.extension_data {
            let Some(payload) = entry.extension_data.as_ref() else {
                continue;
            };
            let Ok(message) = TrackMessage::parse_from_bytes(&payload.value) else {
                continue;
            };
            let Ok(uri) = SpotifyUri::from_uri(&entry.entity_uri) else {
                continue;
            };
            // One bad track must not cost the other forty-nine: a row without
            // a title still plays, a missing row does not exist.
            if let Ok(track) = MetaTrack::parse(&message, &uri) {
                out.push((bare_id(&entry.entity_uri), convert(&track, &owned)));
            }
        }
    }

    Ok(out)
}

/// Resuelve una lista de filas a lo que la lista muestra.
///
/// **La fecha de agregado viaja pegada a la URI, no aparte.** Un `Vec<String>` de
/// URIs y un `Vec<i64>` de fechas al lado son dos listas que el servicio puede
/// desalinear sin que nada falle, y el síntoma es una columna de fechas correcta
/// pegada a las canciones equivocadas. Como par, la fecha sobrevive el reordenado
/// que hace esta función y sobrevive que una fila se caiga por metadata ilegible.
fn hydrate(
    session: &Session,
    rows: Vec<(String, Option<i64>)>,
) -> Result<Vec<Track>, String> {
    if rows.is_empty() {
        return Ok(Vec::new());
    }
    let owned = session.clone();
    // Copia aparte porque la promesa vive en otro hilo y después se usa la
    // lista: sin esto, el `move` se la lleva.
    let wanted: Vec<String> = rows.iter().map(|(uri, _)| uri.clone()).collect();
    let known = call(session, async move { details(owned, wanted).await })?;

    // En el orden que vinieron las pistas, no en el orden en que llegaron los
    // metadatos: una lista de reproducción tiene un orden y la pantalla lo
    // muestra.
    Ok(rows
        .into_iter()
        .filter_map(|(uri, added_at)| {
            known.get(&uri).cloned().map(|mut track| {
                track.added_at = added_at;
                track
            })
        })
        .collect())
}

/// Resuelve las filas de una estación a lo que la lista muestra.
///
/// **La metadata en lote es una sola llamada para todas**, como en las
/// playlists. Si no resuelve ni una, queda la puerta del player: una llamada
/// por pista, más lenta pero es la que sabe responder por estas.
///
/// Las estaciones —el DJ y la radio— comparten este camino porque las dos
/// traen filas con la misma forma: una URI y nada más.
fn hydrate_rows(session: &Session, rows: Vec<(String, Option<i64>)>) -> Result<Vec<Track>, String> {
    let mut tracks = hydrate(session, rows.clone())?;
    if tracks.is_empty() {
        log::warn!("spclient: la metadata en lote no resolvió la estación; se pide pista por pista");
        tracks = details_one_by_one(session, &rows)?;
    }
    if tracks.is_empty() {
        log::error!("spclient: las pistas de la estación no resolvieron");
        return Err("bad_response".to_string());
    }
    Ok(tracks)
}

/// Las pistas de un context por su URI especial.
///
/// `spotify:user:<id>:collection` son las canciones guardadas y
/// `spotify:search:<consulta>` la búsqueda. Los dos son URIs que el servicio
/// entiende por su forma, así que no hacen falta client id ni scopes: son la
/// misma llamada que pide una playlist, con otra URI.
///
/// **Sin fecha de agregado, y no por descuido.** Un context trae `Item`s sin
/// `attributes`, así que `timestamp` no existe para él: no hay dato que mandar, y
/// mandarle un cero dibujaría el 1 de enero de 1970 en una columna de fechas. La
/// columna dice lo que sabe —canciones guardadas no llevan fecha— y la lista de
/// reproducción, que sí la trae, sí la muestra.
fn context_tracks(session: &Session, uri: String) -> Result<Vec<Track>, String> {
    let owned = session.clone();
    let uris = call(session, async move {
        owned
            .spclient()
            .get_context(&uri)
            .await
            .map(|context| context_uris(&context))
            .map_err(|e| {
                log::error!("spclient: get_context falló: {e}");
                net_code(&e)
            })
    })?;

    hydrate(session, uris.into_iter().map(|uri| (uri, None)).collect())
}

// ---------------------------------------------------------------------------
// La cuenta
// ---------------------------------------------------------------------------

/// El perfil, tal como lo devuelve `spclient`.
///
/// Es JSON, así que entra directo por serde. `email` no viene: el servicio no lo
/// manda, y mandarlo exigiría un scope que la app no necesita para nada.
#[derive(serde::Deserialize)]
struct Profile {
    name: Option<String>,
    image_url: Option<String>,
}

/// La cuenta de quien tiene la sesión abierta.
///
/// **El Premium no se pregunta: se deduce.** `/me` contestaba con un campo
/// `product` que Starless leía para avisarle a un usuario free que no iba a
/// oír nada — y esa comprobación ya la hizo otra cosa: librespot se niega a
/// seguir con una cuenta que no sea premium y cierra el proceso. Que haya una
/// sesión viva ya *es* la respuesta, y preguntar de nuevo sería una viaje al
/// servidor para descubrir algo que el proceso entero apoya.
pub fn account(session: &Session) -> Result<Account, String> {
    let username = session.username().to_string();
    // The future outlives this function — it runs on librespot's runtime — so it
    // holds its own copy of the session instead of a reference to this borrow.
    let owned = session.clone();
    let body = call(session, async move {
        owned
            .spclient()
            .get_user_profile(&username, None, None)
            .await
            .map_err(|e| {
                log::error!("spclient: get_user_profile falló: {e}");
                net_code(&e)
            })
    })?;

    let profile: Profile = serde_json::from_slice(&body).map_err(|e| {
        log::error!("spclient: el perfil vino con otra forma: {e}");
        "bad_response".to_string()
    })?;

    Ok(Account {
        id: session.username().to_string(),
        display_name: profile.name,
        product: Some("premium".to_string()),
        images: profile
            .image_url
            .map(|url| Image { url })
            .into_iter()
            .collect(),
    })
}

// ---------------------------------------------------------------------------
// La biblioteca
// ---------------------------------------------------------------------------

/// Todas las playlists de la cuenta: las suyas y las que sigues.
///
/// Las dos listas vienen en el mismo mensaje —las URIs en `items`, la metadata
/// en `meta_items`— y van en el mismo orden, así que se leen de a pares. El
/// índice se usa igual como red: si someday SpotifyMANDARA más URIs que
/// metadata, una biblioteca con más nombres que playlists es una biblioteca
/// rota, y es mejor notarlo que mostrar la mitad.
pub fn playlists(session: &Session) -> Result<Vec<Playlist>, String> {
    let owned = session.clone();
    let body = call(session, async move {
        owned
            .spclient()
            .get_rootlist(0, Some(ROOTLIST_PAGE))
            .await
            .map_err(|e| {
                log::error!("spclient: get_rootlist falló: {e}");
                net_code(&e)
            })
    })?;

    let message = SelectedListContent::parse_from_bytes(&body).map_err(|e| {
        log::error!("spclient: el rootlist vino con otra forma: {e}");
        "bad_response".to_string()
    })?;

    let contents = message.contents.get_or_default();
    // Un rootlist sin playlists es una biblioteca que no llegó, no una
    // biblioteca vacía — y devolverla vacía dibujaría una app sin biblioteca y
    // sin error, que es el síntoma exacto que este módulo vino a matar.
    if contents.items.is_empty() {
        log::error!("spclient: el rootlist vino sin playlists");
        return Err("bad_response".to_string());
    }

    let mut library: Vec<Playlist> = contents
        .items
        .iter()
        .zip(contents.meta_items.iter())
        .map(|(item, meta)| {
            let attributes = meta.attributes.as_ref();
            Playlist {
                id: bare_id(item.uri()),
                // Una playlist sin nombre es una fila en blanco en la barra
                // lateral. Spotify no manda playlists sin nombre, así que un
                // nombre ausente acá es una forma nueva de la respuesta, no una
                // playlist válida — y el id dice cuál es para poder buscarla.
                name: attributes
                    .filter(|a| !a.name().is_empty())
                    .map(|a| a.name().to_owned())
                    .unwrap_or_else(|| {
                        log::error!("spclient: una playlist del rootlist vino sin nombre");
                        "Sin nombre".to_string()
                    }),
                images: attributes
                    .map(|a| {
                        a.picture_size
                            .iter()
                            .filter(|size| !size.url().is_empty())
                            .map(|size| Image {
                                url: size.url().to_owned(),
                            })
                            .collect()
                    })
                    .unwrap_or_default(),
                owner: (!meta.owner_username().is_empty()).then(|| {
                    crate::models::Owner {
                        display_name: Some(meta.owner_username().to_owned()),
                    }
                }),
                // A negative length would be a playlist that lost items between
                // the two halves of the answer; shown as a count it becomes a
                // row of absurd numbers.
                tracks: Some(TrackTotal {
                    total: meta.length().max(0) as u32,
                }),
                collaborative: attributes.is_some_and(|a| a.collaborative()),
                // La descripción del dueño viaja en los mismos atributos que el
                // nombre, y una vacía es una vacía: el `Option` con filtro
                // distingue "no escribió nada" de "escribió un espacio".
                description: attributes
                    .map(|a| a.description())
                    .filter(|text| !text.is_empty())
                    .map(|text| text.to_owned()),
                // El id de la imagen propia del dueño. Sin él no hay portada
                // propia: la que se ve la armó Spotify con las primeras
                // canciones, y esa no se quita.
                custom_cover: attributes.is_some_and(|a| !a.picture().is_empty()),
                // La visibilidad es un atributo del ítem de la biblioteca, no de
                // la playlist: `public` es el campo 10 de `ItemAttributes`, el
                // mismo que el cliente de escritorio manda en `true` cuando la
                // playlist entra en la biblioteca. Un ítem sin el atributo es
                // una playlist pública, que es lo que Spotify hace por
                // omisión.
                is_public: item
                    .attributes
                    .as_ref()
                    .and_then(|attributes| attributes.public)
                    .unwrap_or(true),
            }
        })
        .collect();

    // La foto de Spotify va aparte y sólo para las que no traen una. Las de
    // Spotify tienen un archivo propio y salen del rootlist; las del usuario no,
    // y son justamente las que se veían en gris.
    let without_cover: Vec<String> = library
        .iter()
        .filter(|playlist| playlist.images.is_empty())
        .map(|playlist| playlist.id.clone())
        .collect();

    if !without_cover.is_empty() {
        for (id, urls) in playlist_covers(session, &without_cover) {
            if let Some(playlist) = library.iter_mut().find(|p| p.id == id) {
                playlist.images = urls
                    .into_iter()
                    .map(|url| Image { url })
                    .collect();
            }
        }
    }

    Ok(library)
}

/// Una playlist por id, con lo que hay adentro.
///
/// La misma llamada que arma [`playlists`] con una sola de las entradas: acá se
/// pide por id y trae las pistas.
///
/// **Cada fila trae su fecha de agregado, y es la única lectura de la app que la
/// trae.** Vive en `ItemAttributes.timestamp` —milisegundos desde la época Unix, la
/// misma unidad que ya usa [`now_millis`] para los cambios—, y viaja con la URI
/// hasta [`hydrate`] para terminar en el `added_at` de la pista.
///
/// Se descarta el `0` que devuelve el getter cuando el campo no vino: es la misma
/// razón por la que un total negativo se guarda como cero en [`playlists`], y acá
/// la consecuencia sería una columna llena del 1 de enero de 1970.
pub fn playlist_tracks(session: &Session, playlist_id: &str) -> Result<Vec<Track>, String> {
    let id = SpotifyId::from_base62(playlist_id).map_err(|e| {
        log::error!("spclient: id de playlist inválido ({playlist_id}): {e}");
        "bad_response".to_string()
    })?;

    let owned = session.clone();
    let uris = call(session, async move {
        owned
            .spclient()
            .get_playlist(&id)
            .await
            .map_err(|e| {
                log::error!("spclient: get_playlist falló: {e}");
                net_code(&e)
            })
    })?;

    let message = SelectedListContent::parse_from_bytes(&uris).map_err(|e| {
        log::error!("spclient: la playlist vino con otra forma: {e}");
        "bad_response".to_string()
    })?;

    let contents = message.contents.get_or_default();
    let rows: Vec<(String, Option<i64>)> = contents
        .items
        .iter()
        .map(|item| {
            let added_at = item
                .attributes
                .as_ref()
                .map(|attributes| attributes.timestamp())
                .filter(|timestamp| *timestamp > 0);
            (bare_id(item.uri()), added_at)
        })
        .collect();

    hydrate(session, rows)
}

/// El DJ: la lista que Spotify fabricó para la cuenta.
///
/// **Una playlist y una "jellyfish card" no son lo mismo, aunque las dos
/// digan `spotify:playlist:`.** La del DJ tiene dueño `spotify`, largo 0, y
/// `get_playlist` sobre ella no devuelve ni un item: su contenido lo
/// materializa otro servicio y llega por otra puerta.
///
/// La puerta es `/lexicon-session-provider/context-resolve/v2/session` —el
/// path que la propia metadata del context señala detrás de un `hm://` que no
/// se puede pedir— y lo que contesta es un Context en JSON: páginas de pistas,
/// cada una con su uri y su metadata.
///
/// **Lo que vuelve no es la voz del DJ.** La narración —"Up next", lo que dice
/// antes de la primera canción— viaja como metadata de la primera fila: el
/// texto (`narration.intro.ssml`) y los parámetros de la mezcla, pero no el
/// audio que la produce. La fila misma, en cambio, es la canción que el DJ
/// introduce: su uri es una canción del catálogo, con su nombre y su
/// duración. Lo que se puede reproducir es el mix; lo que se puede mostrar es
/// la frase.
///
/// **Y no es una lista: es una sesión.** La primera página trae las canciones
/// del tramo y un `next_page_url`; el servicio tiene más. Por eso esto devuelve
/// también **por dónde sigue**: una estación que se acaba en la primera página no
/// es el DJ, es una lista de diez con el nombre de DJ.
///
/// **La forma del path es lo que hace que el DJ no se repita, y costó
/// encontrarlo.** Hay dos puertas que parecen la misma y no lo son:
///
/// - `/lexicon-session-provider/context-resolve/v2/session?contextUri=…` —con lo
///   que se empieza— devuelve la línea de tiempo **desde el principio**, y por
///   eso siempre arranca por la misma canción. Medido: dos pedidos seguidos con
///   tres segundos de diferencia devolvieron las mismas primeras cuatro, y una
///   hora después seguían siendo las mismas. La lista crece —125, 130— porque
///   la línea de tiempo crece, pero la cabeza no se mueve.
/// - `/lexicon-session-provider/context-resolve/v2/session/0000…?contextUri=…`
///   —con los ceros en el path— devuelve el tramo **de ahora**, y avanza: dos
///   pedidos seguidos con cinco segundos de diferencia devolvieron canciones
///   completamente distintas.
///
/// La segunda es la que el servicio usa como "la siguiente": el `next_page_url`
/// que devuelve ya viene con esa forma, y es con esa forma con la que la
/// estación avanza.
///
/// La app usaba la primera: el DJ sonaba siempre igual y era un bug, no una
/// rareza del servicio.
pub fn dj_mix(session: &Session, playlist_id: &str) -> Result<DjPage, String> {
    let context_uri = format!("spotify:playlist:{playlist_id}");
    // El comodín del segmento dice "el de ahora" y el `requestId` distingue
    // este pedido de todos los demás: es la forma que el propio servicio usa
    // para el cursor, con la parte que cambia puesta.
    let path = format!(
        "/lexicon-session-provider/context-resolve/v2/session/00000000000000000000000000000000\
?contextUri={context_uri}&previousSegmentId=XX-Segment-XXXXX&requestId={}",
        request_id()
    );
    station_page(session, &path)
}

/// La radio: las canciones parecidas a las que se estaban escuchando.
///
/// **Esta es la puerta del autoplay de Spotify, no una imitación.** El
/// protocolo es `AutoplayContextRequest` —el contexto que se escuchaba y las
/// canciones recientes— y el cliente oficial de Windows lo manda exactamente
/// así: `POST /context-resolve/v1/autoplay`, con el cuerpo en protobuf.
///
/// **Lo que se midió, y por qué importa:**
///
/// - Con el contexto de una **playlist** trae cincuenta canciones parecidas —
///   no la playlist repetida— y un cursor a `radio-apollo`, que es donde sigue
///   la estación. La página siguiente trae las siguientes cincuenta.
/// - Con el contexto de una **canción** trae lo mismo: las parecidas a esa
///   canción. Es la radio de esa canción, y es la puerta que usa el autoplay.
///
/// **La semilla no aparece en la respuesta.** Ni la canción que sembró la
/// radio ni las que van en `recent_track_uri`: el servicio ya sabe cuáles
/// son y no las repite. Por eso el caller no tiene que filtrar nada.
///
/// **La puerta del DJ no sirve para esto.** `/lexicon-session-provider/
/// context-resolve/v2/session` con `contextUri=spotify:track:…` contesta `500`,
/// y también con un disco, con un artista y con una playlist común: es el
/// servicio de las "jellyfish cards" del DJ, y sólo entiende su propio
/// contexto.
pub fn autoplay(
    session: &Session,
    context_uri: &str,
    recent: &[String],
) -> Result<DjPage, String> {
    let owned = session.clone();
    let uri = context_uri.to_owned();
    let recent = recent.to_vec();
    let context = call(session, async move {
        let request = AutoplayContextRequest {
            context_uri: Some(uri),
            recent_track_uri: recent,
            is_video: Some(false),
            special_fields: Default::default(),
        };
        owned
            .spclient()
            .get_autoplay_context(&request)
            .await
            .map_err(|e| {
                log::error!("spclient: el autoplay falló: {e}");
                net_code(&e)
            })
    })?;

    // Las páginas del Context: sus pistas y el cursor por donde sigue. La
    // primera página trae las cincuenta; el cursor es la dirección de la
    // siguiente.
    let mut rows: Vec<(String, Option<i64>)> = Vec::new();
    let mut next: Option<String> = None;
    for page in &context.pages {
        for track in &page.tracks {
            let Some(uri) = track.uri.as_deref() else {
                continue;
            };
            let id = bare_id(uri);
            if id.is_empty() {
                continue;
            }
            rows.push((id, None));
        }
        if next.is_none() {
            next = page.next_page_url.as_deref().map(host_path);
        }
    }
    if rows.is_empty() {
        log::error!("spclient: el autoplay vino sin pistas");
        return Err("bad_response".to_string());
    }

    let tracks = hydrate_rows(session, rows)?;

    log::info!(
        "spclient: el autoplay de {context_uri} trajo {} canciones; {}",
        tracks.len(),
        if next.is_some() { "sigue" } else { "es la última" }
    );

    Ok(DjPage {
        mix: DjMix {
            tracks,
            lines: HashMap::new(),
        },
        next,
        voices: HashMap::new(),
    })
}

/// Un `requestId` nuevo para cada pedido.
///
/// **Es lo que hace que dos pedidos no sean el mismo pedido.** El servicio lo usa
/// para correlacionar la respuesta con el pedido, y con un id nuevo devuelve un
/// tramo distinto: medido, el mismo pedido con dos ids distintos dio canciones
/// distintas y con el mismo id dio las mismas. No hace falta que sea
/// criptográfico —sólo que sea distinto en cada pedido—, así que se arma con el
/// reloj y un contador.
fn request_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);

    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos() as u64)
        .unwrap_or(0);
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{nanos:016x}{seq:016x}")
}

/// El audio de la voz del DJ.
///
/// **La puerta:** `POST /client-tts/v1/fulfill`, en el spclient. Lo que se
/// midió de ella:
///
/// - Pide el **token de la cuenta**: con el client token solo contesta `401`.
/// - Exige el cuerpo en protobuf **binario**: en texto contesta `400`.
/// - Contesta con el **audio**: un MP3 de 320 kbps, 44,1 kHz y mono.
///
/// **No es una URL.** El proto declara `GetTtsUrl → TtsResponse { url }`, y esa
/// es la forma vieja: la puerta que anda contesta con el audio en el cuerpo.
///
/// **El host va escrito, y no sale del access point.** El spclient de
/// librespot resuelve un punto regional —`guc3-spclient.spotify.com`— y esa
/// puerta contesta `303`; el host canónico es el que responde.
///
/// Y el `User-Agent` es el del cliente de Windows, que es el que se midió.
pub fn dj_voice(session: &Session, params: &VoiceParams) -> Result<Vec<u8>, String> {
    let owned = session.clone();
    let body = params.request_body();

    call(session, async move {
        let token = owned
            .login5()
            .auth_token()
            .await
            .map_err(|e| {
                log::error!("spclient: el token de la cuenta no salió: {e}");
                "connection_lost".to_string()
            })?;

        let response = reqwest::Client::new()
            .post("https://spclient.wg.spotify.com/client-tts/v1/fulfill")
            .header(
                "User-Agent",
                "Spotify/124200290 Windows/0 (librespot)",
            )
            .bearer_auth(token.access_token)
            .header("Content-Type", "application/x-protobuf")
            .body(body)
            .send()
            .await
            .map_err(|e| {
                log::error!("spclient: la voz del DJ no se pudo pedir: {e}");
                "network_failed".to_string()
            })?;

        let status = response.status();
        let bytes = response.bytes().await.map_err(|e| {
            log::error!("spclient: la voz del DJ no se pudo leer: {e}");
            "network_failed".to_string()
        })?;

        if !status.is_success() {
            log::error!("spclient: la voz del DJ contestó {status}");
            return Err("bad_response".to_string());
        }

        log::info!("spclient: la voz del DJ vino en {} bytes", bytes.len());
        Ok(bytes.to_vec())
    })
}

/// La página siguiente de una estación.
///
/// **La misma página sirve para el DJ y para la radio**, y por eso se llama
/// así: los dos son estaciones que el servicio va llenando, y los dos contestan
/// con la misma forma —las canciones en `tracks` y el cursor en
/// `next_page_url`—, aunque la radio venga de otro servicio.
///
/// El path es el que el servicio dio, ya traducido: el `hm://` es el nombre
/// interno del servicio y en el host de Spotify se pide el path.
pub fn station_page(session: &Session, path: &str) -> Result<DjPage, String> {
    let owned = session.clone();
    let endpoint = path.to_owned();
    let body = call(session, async move {
        owned
            .spclient()
            .request(&reqwest::Method::GET, &endpoint, None, None)
            .await
            .map_err(|e| {
                log::error!("spclient: la página de la estación falló: {e}");
                net_code(&e)
            })
    })?;

    let json: serde_json::Value = serde_json::from_slice(&body).map_err(|e| {
        log::error!("spclient: la estación vino con otra forma: {e}");
        "bad_response".to_string()
    })?;

    let (rows, lines, next, voices) = station_rows(&json);
    if rows.is_empty() {
        log::error!("spclient: la página de la estación vino sin pistas");
        return Err("bad_response".to_string());
    }

    let tracks = hydrate_rows(session, rows)?;

    // Cuántas trayó la página y si por dónde sigue: sin esto no se puede
    // distinguir "el DJ terminó" de "esta página vino corta", y las dos se
    // ven igual desde afuera.
    log::info!(
        "spclient: la página del DJ trajo {} canciones y {} frases; {}",
        tracks.len(),
        lines.len(),
        if next.is_some() {
            "sigue"
        } else {
            "es la última"
        }
    );

    Ok(DjPage {
        mix: DjMix {
            tracks,
            lines,
        },
        next,
        voices,
    })
}

/// Las pistas de una página de estación, sus frases, y por dónde sigue.
///
/// **La primera página y las siguientes no tienen la misma forma.** La primera
/// viene como `pages[].tracks`, con su `next_page_url` adentro de la página;
/// las siguientes traen las canciones en la raíz, con el `next_page_url` al
/// lado. Es el mismo servicio con dos envelopes, y leer sólo uno de los dos
/// convierte una estación en una lista.
///
/// Por eso esto mira en los dos lados y junta lo que encuentre, en el orden en
/// que lo encuentra.
fn station_rows(
    json: &serde_json::Value,
) -> (
    Vec<(String, Option<i64>)>,
    HashMap<String, DjNarration>,
    Option<String>,
    HashMap<String, VoiceParams>,
) {
    let mut rows: Vec<(String, Option<i64>)> = Vec::new();
    let mut lines: HashMap<String, DjNarration> = HashMap::new();
    let mut next: Option<String> = None;
    let mut voices: HashMap<String, VoiceParams> = HashMap::new();

    fn take(
        tracks: &serde_json::Value,
        rows: &mut Vec<(String, Option<i64>)>,
        lines: &mut HashMap<String, DjNarration>,
        voices: &mut HashMap<String, VoiceParams>,
    ) {
        let Some(list) = tracks.as_array() else {
            return;
        };
        for track in list {
            let Some(uri) = track.get("uri").and_then(|value| value.as_str()) else {
                continue;
            };
            let id = bare_id(uri);
            if id.is_empty() {
                continue;
            }
            // La frase viene pegada a la fila, como metadata: el DJ abre el
            // tramo con una y lo cierra con otra.
            if let Some(narration) = narration_of(track) {
                lines.entry(id.clone()).or_insert(narration);
                // Y los parámetros de la voz son los de la misma frase: lo que
                // el panel muestra y lo que el DJ dice no pueden ser dos
                // frases distintas. Van por canción, y no uno para la página:
                // una página tiene cinco canciones y dos frases, y cada
                // frase va con la canción que le corresponde —la de apertura
                // con la primera, la de cierre con la última—, así que la
                // frase se dice cuando esa canción va a sonar.
                if let Some(params) = voice_of(track) {
                    voices.entry(id.clone()).or_insert(params);
                }
            }
            rows.push((id, None));
        }
    }

    if let Some(pages) = json.get("pages").and_then(|value| value.as_array()) {
        for page in pages {
            if let Some(tracks) = page.get("tracks") {
                take(tracks, &mut rows, &mut lines, &mut voices);
            }
            if next.is_none() {
                next = page
                    .get("next_page_url")
                    .and_then(|value| value.as_str())
                    .map(host_path);
            }
        }
    }

    if let Some(tracks) = json.get("tracks") {
        take(tracks, &mut rows, &mut lines, &mut voices);
    }
    if next.is_none() {
        next = json
            .get("next_page_url")
            .and_then(|value| value.as_str())
            .map(host_path);
    }

    (rows, lines, next, voices)
}

/// Los parámetros de la voz de una fila del DJ.
///
/// **Las dos frases se dicen, cada una con su canción.** El servicio cuelga
/// dos frases de cada tramo: una en la primera canción y otra en la última. La
/// de apertura anuncia el tramo y la de cierre anuncia su última canción, y
/// las dos se dicen **antes** de su canción: es lo mismo que hace la de
/// apertura, y es lo que dicen los textos.
///
/// La de apertura va primero y la de cierre después, y no por gusto: una fila
/// con las dos frases es una fila que tiene que abrir su tramo.
///
/// Los parámetros son los de la misma fila que la frase: lo que el panel
/// muestra y lo que el DJ dice no pueden ser dos frases distintas.
fn voice_of(track: &serde_json::Value) -> Option<VoiceParams> {
    let metadata = track.get("metadata")?.as_object()?;
    VoiceParams::from_metadata(metadata, "narration.intro.")
        .or_else(|| VoiceParams::from_metadata(metadata, "narration.outro."))
}

/// El `hm://` del servicio, traducido al path que se pide en el host.
///
/// `hm://lexicon-session-provider/context-resolve/v2/session/…` es el nombre
/// interno del servicio. En el host de Spotify lo que existe es
/// `/lexicon-session-provider/context-resolve/v2/session/…`, con el query
/// intacto: ahí van el `previousSegmentId` y el `requestId` que el servicio
/// usa para saber qué segmento se está pidiendo.
fn host_path(url: &str) -> String {
    match url.strip_prefix("hm://") {
        Some(rest) => format!("/{rest}"),
        None => url.to_owned(),
    }
}

/// La narración de una fila del DJ, si la trae.
///
/// El SSML viene con las etiquetas y las referencias: `<speak xml:lang="es-MX">Para
/// comenzar, elegí temas como este de <entity type="artist" uri="…">bôa</entity>…</speak>`.
/// Lo que se muestra es la frase con el nombre adentro: la `entity` es una
/// referencia, no una palabra.
///
/// **El DJ abre y cierra.** La primera fila del tramo trae `narration.intro` y
/// la última trae `narration.outro`: la de apertura es la que se muestra, y la
/// de cierre está de repuesto para una fila que no tenga otra.
fn narration_of(track: &serde_json::Value) -> Option<DjNarration> {
    let metadata = track.get("metadata")?;

    for kind in ["narration.intro", "narration.outro"] {
        let Some(line) = metadata
            .get(format!("{kind}.ssml"))
            .and_then(|value| value.as_str())
        else {
            continue;
        };
        let speaker = metadata
            .get(format!("{kind}.artist"))
            .and_then(|value| value.as_str())
            .unwrap_or("DJ")
            .to_owned();

        return Some(DjNarration {
            speaker,
            line: plain_speech(line),
        });
    }

    None
}

/// El texto de una narración, sin el SSML.
///
/// Se quitan las etiquetas y se desenvuelven las entidades de XML. El orden
/// importa: primero las etiquetas, después las entidades, porque al revés un
/// `&lt;` volvería a ser una etiqueta y la frase se comería la mitad.
fn plain_speech(ssml: &str) -> String {
    let mut text = String::with_capacity(ssml.len());
    let mut inside_tag = false;

    for character in ssml.chars() {
        match character {
            '<' => inside_tag = true,
            '>' => inside_tag = false,
            _ if !inside_tag => text.push(character),
            _ => {}
        }
    }

    text.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .trim()
        .to_owned()
}

/// Las pistas de una en una, por la misma puerta que usa el player.
///
/// La metadata en lote es la que se usa para las playlists, y es una sola
/// llamada para todas. Cuando no resuelve nada, esta es la que queda: una
/// llamada por pista, con el mismo camino que el player va a usar después, que
/// es la única forma de que lo que se muestra sea lo que se puede escuchar.
fn details_one_by_one(
    session: &Session,
    rows: &[(String, Option<i64>)],
) -> Result<Vec<Track>, String> {
    let mut out = Vec::new();

    for (uri, _) in rows {
        let Ok(parsed) = SpotifyUri::from_uri(&format!("spotify:track:{uri}")) else {
            continue;
        };
        // La llamada vive en otro hilo: la referencia al nombre no puede
        // viajar con ella.
        let uri = uri.clone();
        let owned = session.clone();
        let track = call(session, async move {
            MetaTrack::get(&owned, &parsed)
                .await
                .map_err(|e| {
                    log::error!("spclient: la metadata de {uri} falló: {e}");
                    "bad_response".to_string()
                })
        })?;
        out.push(convert(&track, session));
    }

    Ok(out)
}

/// Las canciones guardadas.
///
/// Era la última lectura que quedaba atada a la Web API, y por eso una app
///limita a cinco personas mostraba su biblioteca completa menos justamente lo
/// que la persona fue a buscar. Sale del mismo context que una playlist.
pub fn liked_tracks(session: &Session) -> Result<Vec<Track>, String> {
    context_tracks(
        session,
        format!("spotify:user:{}:collection", session.username()),
    )
}

/// Las palabras de una canción.
///
/// Una llamada a `/color-lyrics/v2/track/{id}` por la misma sesión que ya
/// reproduce: ni client id propio, ni scope nuevo, ni una segunda identidad. El
/// proveedor es quien los escribió y `syncType` dice si las líneas traen reloj.
///
/// **Una canción sin letra no es un fallo.** Spotify contesta 404 y eso es una
/// respuesta con significado, no una red rota: distinguir las dos es lo que le
/// permite a la pantalla decir "esta canción no tiene letra" en vez de "no se pudo
/// leer" —y una de esas dos cosas es un dato sobre la canción y la otra es un
/// problema con esta máquina.
///
/// **Un cero no es un tiempo.** Una letra sin sincronizar llega con
/// `startTimeMs: "0"` en todas sus líneas. Leer eso como un momento dejaría la
/// primera línea encendida durante toda la canción, así que esas líneas vuelven con
/// `start_ms: None` y la pantalla las muestra sin seguirlas.
pub fn lyrics(session: &Session, track_id: &str) -> Result<Lyrics, String> {
    let id = SpotifyId::from_base62(track_id).map_err(|_| "bad_track_id".to_string())?;
    // The future has to be `'static`, so the id for the log line travels as its
    // own copy rather than as the borrow the caller handed in.
    let label = track_id.to_owned();

    let owned = session.clone();
    let body = call(session, async move {
        owned.spclient().get_lyrics(&id).await.map_err(|e| {
            if e.kind == ErrorKind::NotFound {
                return "no_lyrics".to_string();
            }
            log::error!("spclient: las letras de {label} no llegaron: {e}");
            net_code(&e)
        })
    })?;

    let parsed = MetaLyrics::try_from(&body).map_err(|e| {
        log::error!("spclient: las letras de {track_id} vinieron con otra forma: {e}");
        "bad_response".to_string()
    })?;

    let synced = parsed.lyrics.sync_type == librespot_metadata::lyrics::SyncType::LineSynced;

    let lines: Vec<LyricLine> = parsed
        .lyrics
        .lines
        .into_iter()
        .map(|line| LyricLine {
            text: line.words,
            // Unsynced lyrics send "0" for every line. `None` is what says
            // "this page has no clock", and it is the difference between a
            // follow-along view and one that sits on line one all song.
            start_ms: if synced {
                line.start_time_ms.parse().ok()
            } else {
                None
            },
        })
        .collect();

    Ok(Lyrics { synced, lines })
}

/// La búsqueda, por ahora de canciones.
///
/// El cliente de Spotify abre la búsqueda por esta misma URI y devuelve un
/// context. El menú bajo el campo ya sólo muestra canciones, así que una lista
/// sola es lo que la pantalla pide hoy; álbumes, artistas y playlists quedan
/// para cuando la app los necesite de verdad, porque tampoco está escrito qué
/// context devuelve cada tipo.
pub fn search_tracks(session: &Session, query: &str) -> Result<Vec<Track>, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    // El servicio separa con `+`, no con `%20`, ni con espacios.
    let encoded = trimmed.replace(' ', "+");
    context_tracks(session, format!("spotify:search:{encoded}"))
}

// ---------------------------------------------------------------------------
// Escribir
// ---------------------------------------------------------------------------

/// El reloj del cliente en milisegundos, que es lo que viaja en `timestamp`.
///
/// Se lee una vez y se usa en los dos lugares que lo piden. Dos valores distintos
/// para un mismo cambio es una forma de que el servicio lo rechace por un motivo
/// que nadie va a poder leer en el log después.
pub(super) fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

/// El id de una playlist nueva, generado del lado del cliente.
///
/// Spotify no lo asigna: el `ADD` lo manda adentro del pedido, y por eso un
/// `GET` de permisos sobre esa playlist contesta `404` un instante antes de que
/// exista. Es base62 de 22 caracteres, como cualquier id de Spotify.
///
/// La entropía sale de dos `RandomState` —que el sistema siembra al arrancar el
/// proceso— mezclados con el reloj y el pid. El reloj solo no alcanza: dos
/// playlists creadas en el mismo milisegundo por dos Starless abiertos se
/// pisarían, y una colisión no avisa. Es el `ADD` de otra persona lo que
/// escribiría encima.
fn new_playlist_id() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};

    let clock = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();

    let mut first = RandomState::new().build_hasher();
    first.write_u128(clock);
    first.write_u32(std::process::id());
    let high = first.finish();

    let mut second = RandomState::new().build_hasher();
    second.write_u64(high);
    second.write_u128(clock.rotate_left(29));
    let low = second.finish();

    // 16 bytes big-endian, con el bit más alto apagado. El servicio acepta ids de
    // 22 dígitos de base62 mientras no pasen de 2^127 —los que mandarón ocuparon
    // 125 y 126 bits— y rechaza el resto con un `400 invalid argument` que no
    // dice nada. Más chico es siempre seguro; el costo de quedarse sin id es
    // escribir encima de la playlist de otro sin avisar.
    let mut raw = [0u8; 16];
    raw[..8].copy_from_slice(&high.to_be_bytes());
    raw[8..].copy_from_slice(&low.to_be_bytes());
    raw[0] &= 0x7f;

    // El base62 canónico lo pone `SpotifyId`, que ya viene con la dependencia y
    // que resuelve esto mejor que a mano: su `to_base62` termina en un
    // `dst.reverse()` que pone los dígitos del más significativo al menos.
    // Escribirlos al revés —lo natural con un `push`, que saca el dígito menor—
    // deja el id valiendo 130 bits en vez de 127 y el servicio lo rechaza con un
    // `400` mudo. Es el bug que hizo que esto pareciera imposible: el id viaja
    // en la URL y no en el cuerpo, así que comparar los cuerpos byte por byte
    // nunca lo podía mostrar.
    //
    // Un `unwrap_or_default` no es una preocupación: acá no puede fallar —dieciséis
    // bytes entran siempre y un `u128` no desbota 22 dígitos— y si algún día
    // llegara a fallar, `create_playlist` rechaza el id vacío antes de mandar
    // algo, que es la única forma de que el error se vea.
    SpotifyId::from_raw(&raw)
        .and_then(|id| id.to_base62())
        .unwrap_or_default()
}

/// La revisión de una lista que todavía no existe.
///
/// No es un valor inventado: es lo que el cliente oficial manda en el primer
/// pedido contra una playlist recién creada, y se lee como texto —cuatro ceros y
/// la palabra `root`—, que es lo que significa "sin revisiones todavía". Es la
/// razón de que crear una playlist no sea un endpoint propio: el `changes` de una
/// lista inexistente es un `changes` como cualquier otro, sólo que cosido contra
/// el principio.
const UNBORN_REVISION: &[u8] = b"\0\0\0\0root";

/// Crea una playlist en la biblioteca y le pone el nombre. Devuelve su id.
///
/// **El orden importa, y por eso está escrito al revés de como se lee.** La
/// playlist no nace cuando entra al rootlist: nace cuando se le escribe *contra
/// ella*, con una revisión que dice que no tiene ninguna. El `ADD` al rootlist va
/// después y sólo la pone en la biblioteca.
///
/// Al revés no funciona, y no por una razón que se pueda deducir del proto: se le
/// manda al servicio una uri de una playlist que no existe y contesta
/// `400 invalid argument` a un cuerpo byte a byte igual al que él acepta. La
/// diferencia entre el cuerpo bueno y el malo no estaba en el cuerpo: estaba en
/// qué se le pedía.
///
/// Las dos llamadas van contra la misma revisión de la lista de biblioteca, y
/// eso también es lo que hace el cliente oficial: el `ADD` se cose contra la
/// revisión que ya tenía, que puede no ser la última. Es concurrencia optimista
/// a la inversa —el servidor fusiona en vez de rechazar— y no hay que leerla
/// antes para poder escribir.
///
/// `docs/escribir-playlists.md` tiene el procedimiento completo y de dónde salió.
pub fn create_playlist(session: &Session, name: &str) -> Result<String, String> {
    let wanted = name.trim();
    if wanted.is_empty() {
        return Err("empty_name".to_string());
    }

    let account_name = session.username().to_owned();
    let timestamp = now_millis();
    let playlist_id = new_playlist_id();

    // No puede pasar, pero un id vacío acá sería un `400` sin explicar nada, y
    // esa es la forma de fallo que costó horas encontrar. Si el id viene vacío,
    // el problema está en el generador y tiene que decirse acá y no en el log
    // del servidor.
    if playlist_id.is_empty() {
        log::error!("spclient: no se pudo generar un id de playlist");
        return Err("bad_id".to_string());
    }

    let uri = format!("spotify:playlist:{playlist_id}");

    // 1. Escribirle a la playlist que no existe todavía. Este pedido la crea.
    let born = create_list_change(&account_name, timestamp, wanted);

    send_changes(
        session,
        &format!("/playlist/v2/playlist/{playlist_id}/changes"),
        &born,
        "create_failed",
    )?;

    // 2. Recién ahora que existe, ponerla en la biblioteca.
    let attach = add_list_change(
        rootlist_revision(session)?,
        &account_name,
        timestamp,
        &uri,
    );

    send_changes(
        session,
        &format!("/playlist/v2/user/{account_name}/rootlist/changes"),
        &attach,
        "attach_failed",
    )?;

    log::info!("spclient: creada la playlist {playlist_id}");
    Ok(playlist_id)
}

/// Agrega una canción a una playlist que ya existe.
///
/// **Es el mismo endpoint que crea la playlist, con otra operación.** La
/// creación escribe un `UPDATE_LIST_ATTRIBUTES` contra la revisión `0,root` de
/// una lista que todavía no existe; esto escribe un `ADD` contra la revisión
/// **actual** de una lista que ya existe. La diferencia entre los dos pedidos es
/// el `base_revision` y el `Op`, y nada más.
///
/// **La revisión se lee en este momento, y no antes.** El servicio contesta
/// `409 Aborted` a un cambio cosido contra una revisión vieja, así que una
/// revisión cacheada es una revisión que puede estar equivocada. Y no se
/// cachea por una razón que ya está escrita en [`rootlist_revision`]: cachear
/// la revisión es un estado que hay que invalidar en cada frontera de
/// autenticación, y un error ahí no se ve hasta que alguien pierde una
/// canción. Cuesta una lectura de unos milisegundos en una acción que se hace
/// unas pocas veces al mes, y a cambio la lectura se corrige sola.
///
/// **La canción va al final.** `Add` trae un `add_last` que dice exactamente
/// eso, y es donde el usuario la esperaría: la lista que estaba, más la
/// canción nueva, y no la canción nueva arriba de una lista que alguien viene
/// usando.
///
/// `docs/escribir-playlists.md` tiene el procedimiento completo y de dónde salió.
pub fn add_to_playlist(session: &Session, playlist_id: &str, track_id: &str) -> Result<(), String> {
    // Los dos ids van en la URL y en el cuerpo, así que los dos tienen que ser
    // de verdad: un id inventado es un `400` que no dice nada.
    SpotifyId::from_base62(playlist_id).map_err(|e| {
        log::error!("spclient: id de playlist inválido ({playlist_id}): {e}");
        "bad_id".to_string()
    })?;
    SpotifyId::from_base62(track_id).map_err(|_| "bad_track_id".to_string())?;

    let account_name = session.username().to_owned();
    let timestamp = now_millis();
    let uri = format!("spotify:track:{track_id}");

    let revision = playlist_revision(session, playlist_id)?;
    let changes = add_track_change(&revision, &account_name, timestamp, &uri);

    send_changes(
        session,
        &format!("/playlist/v2/playlist/{playlist_id}/changes"),
        &changes,
        "add_failed",
    )?;

    log::info!("spclient: {track_id} agregada a {playlist_id}");
    Ok(())
}

/// Cambia los detalles de una playlist que ya existe: el nombre, la descripción
/// y la portada.
///
/// **Es el mismo mensaje que la crea, con otra revisión.** La creación escribe
/// un `UPDATE_LIST_ATTRIBUTES` contra la revisión `0,root` de una lista que
/// todavía no existe; esto escribe ese mismo `UPDATE_LIST_ATTRIBUTES` contra la
/// revisión que la playlist tiene ahora. Lo que cambia no es el mensaje sino
/// contra qué se cose — y eso es exactamente lo que el comentario de
/// [`create_list_change`] ya decía: *"el mismo mensaje que usaría un
/// renombrado"*.
///
/// **El nombre va recortado y no puede quedar vacío.** Un nombre vacío es una
/// playlist sin nombre, y `create_playlist` ya lo rechaza por la misma razón.
///
/// `docs/escribir-playlists.md` tiene el procedimiento completo y de dónde salió.
pub fn update_playlist_details(
    session: &Session,
    playlist_id: &str,
    details: &PlaylistDetails,
    picture: Option<Vec<u8>>,
) -> Result<(), String> {
    if details.name.is_some() && details.name.as_deref().unwrap_or_default().trim().is_empty() {
        return Err("empty_name".to_string());
    }

    SpotifyId::from_base62(playlist_id).map_err(|e| {
        log::error!("spclient: id de playlist inválido ({playlist_id}): {e}");
        "bad_id".to_string()
    })?;

    let account_name = session.username().to_owned();
    let timestamp = now_millis();

    let revision = playlist_revision(session, playlist_id)?;
    let changes = details_change(&revision, &account_name, timestamp, details, picture);

    send_changes(
        session,
        &format!("/playlist/v2/playlist/{playlist_id}/changes"),
        &changes,
        "details_failed",
    )?;

    log::info!("spclient: los detalles de {playlist_id} quedaron escritos");

    // La visibilidad es otro mensaje y otro endpoint, y va después de los
    // detalles: si los detalles no se pudieron escribir, la playlist sigue como
    // estaba y no tiene sentido cambiarle la visibilidad a una cosa que
    // Después se va a volver a abrir.
    if let Some(is_public) = details.is_public {
        set_playlist_visibility(session, playlist_id, is_public)?;
    }

    Ok(())
}

/// Cambia si una playlist es pública o privada.
///
/// **La visibilidad es un atributo del ítem de la biblioteca, no de la playlist.**
/// `public` es el campo 10 de `ItemAttributes`, y el ítem es una fila del
/// rootlist — la lista de la biblioteca. Por eso esto se escribe contra la
/// revisión de la biblioteca y en el endpoint del rootlist, y no contra la
/// revisión de la playlist: son dos listas distintas y dos revisiones
/// distintas.
///
/// La receta está medida: un `UPDATE_ITEM_ATTRIBUTES` con el ítem y su uri, y
/// el `200` vino con el atributo cambiado. `docs/escribir-playlists.md` tiene
/// el procedimiento y el detalle de lo que se probó.
pub fn set_playlist_visibility(
    session: &Session,
    playlist_id: &str,
    is_public: bool,
) -> Result<(), String> {
    SpotifyId::from_base62(playlist_id).map_err(|e| {
        log::error!("spclient: id de playlist inválido ({playlist_id}): {e}");
        "bad_id".to_string()
    })?;

    let account_name = session.username().to_owned();
    let timestamp = now_millis();
    let uri = format!("spotify:playlist:{playlist_id}");

    let changes = visibility_change(
        &rootlist_revision(session)?,
        &account_name,
        timestamp,
        &uri,
        is_public,
    );

    send_changes(
        session,
        &format!("/playlist/v2/user/{account_name}/rootlist/changes"),
        &changes,
        "visibility_failed",
    )?;

    log::info!(
        "spclient: la visibilidad de {playlist_id} quedó escrita (pública={is_public})"
    );
    Ok(())
}

/// Sube una imagen y la deja registrada como la portada de una playlist.
///
/// **Son dos pedidos, y el segundo es el que devuelve la imagen.** El primero
/// manda el JPEG a `image-upload.spotify.com` y contesta un `uploadToken`; el
/// segundo le pasa ese token al servicio de playlists y contesta el `picture`:
/// el id de la imagen, que es lo que va en los atributos de la playlist.
///
/// **El token es el de la cuenta, no el del cliente.** Con el `client-token` la
/// puerta contesta `401`: lo que se sube es de la cuenta y se guarda en la
/// cuenta, y el servicio lo sabe por el token que lo identifica.
///
/// **El host no es el del spclient.** `image-upload.spotify.com` no es el
/// access point de la sesión, así que el pedido se arma a mano en vez de pasar
/// por `spclient().request()`, que le pone su base y sus cabeceras.
///
/// **La imagen la sube el usuario y para la playlist del usuario.** No sale
/// nada de la máquina por su cuenta: hay un clic, un archivo que él eligió y una
/// playlist que es suya.
pub fn upload_playlist_cover(
    session: &Session,
    playlist_id: &str,
    jpeg: &[u8],
) -> Result<Vec<u8>, String> {
    SpotifyId::from_base62(playlist_id).map_err(|e| {
        log::error!("spclient: id de playlist inválido ({playlist_id}): {e}");
        "bad_id".to_string()
    })?;

    if jpeg.is_empty() {
        return Err("upload_failed".to_string());
    }

    let owned = session.clone();
    let token = call(session, async move {
        owned
            .login5()
            .auth_token()
            .await
            .map_err(|e| {
                log::error!("spclient: no se pudo pedir el token de la cuenta: {e}");
                "network_failed".to_string()
            })
    })?;
    log::info!("spclient: el token de la cuenta salió");

    let authorization = format!("{} {}", token.token_type, token.access_token);
    let body = jpeg.to_vec();
    // La subida no usa la sesión: el host es otro y el token ya está en la
    // cabecera.
    let uploaded = call(session, async move {
        // **El cliente lleva su propio tope.** `reqwest::Client::new()` no
        // tiene ninguno: sin esto, una conexión que se queda colgada espera
        // para siempre, y `call` —que sí tiene tope— sólo suelta al que
        // llama, dejando el pedido colgado adentro del runtime.
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(|e| {
                log::error!("spclient: no se pudo crear el cliente HTTP: {e}");
                "upload_failed".to_string()
            })?;

        let answer = client
            .post("https://image-upload.spotify.com/v4/playlist")
            .header(reqwest::header::AUTHORIZATION, authorization)
            .header(reqwest::header::CONTENT_TYPE, "image/jpeg")
            .body(body)
            .send()
            .await
            .map_err(|e| {
                log::error!("spclient: la subida de la imagen falló: {e}");
                "network_failed".to_string()
            })?;

        let status = answer.status();
        let bytes = answer.bytes().await.map_err(|e| {
            log::error!("spclient: la respuesta de la subida no se pudo leer: {e}");
            "network_failed".to_string()
        })?;

        if !status.is_success() {
            log::error!(
                "spclient: el servicio rechazó la imagen: {status} — {}",
                String::from_utf8_lossy(&bytes)
            );
            return Err("upload_failed".to_string());
        }
        Ok(bytes.to_vec())
    })?;
    log::info!("spclient: la imagen subió a image-upload ({} bytes)", uploaded.len());

    // `{"uploadToken": "..."}`
    let upload_token = serde_json::from_slice::<serde_json::Value>(&uploaded)
        .ok()
        .and_then(|value| {
            value
                .get("uploadToken")
                .and_then(|token| token.as_str())
                .map(|token| token.to_owned())
        })
        .ok_or_else(|| {
            log::error!("spclient: la subida no devolvió un token");
            "bad_response".to_string()
        })?;

    // El registro: el token de la imagen se cambia por el id de la imagen.
    let request = RegisterPlaylistImageRequest {
        upload_token: Some(upload_token),
        ..Default::default()
    };
    let body = request.write_to_bytes().map_err(|e| {
        log::error!("spclient: el registro de la imagen no se pudo serializar: {e}");
        "bad_response".to_string()
    })?;

    let owned = session.clone();
    let path = format!("/playlist/v2/playlist/{playlist_id}/register-image");
    log::info!("spclient: registrando la imagen contra {playlist_id}");
    let response = call(session, async move {
        owned
            .spclient()
            .request(&reqwest::Method::POST, &path, Some(spclient_headers()), Some(&body))
            .await
            .map_err(|e| {
                log::error!("spclient: el registro de la imagen falló: {e}");
                "upload_failed".to_string()
            })
    })?;

    let reply = RegisterPlaylistImageResponse::parse_from_bytes(&response).map_err(|e| {
        log::error!("spclient: la respuesta del registro no se pudo leer: {e}");
        "bad_response".to_string()
    })?;

    let picture = reply.picture().to_vec();
    if picture.is_empty() {
        log::error!("spclient: el registro no devolvió ninguna imagen");
        return Err("upload_failed".to_string());
    }

    log::info!("spclient: la imagen quedó registrada para {playlist_id}");
    Ok(picture)
}

/// La revisión de una playlist, leída de la biblioteca.
///
/// **La biblioteca, y no un pedido a la playlist.** La biblioteca ya pide la
/// revisión de cada playlist —`MetaItem.revision`, y `get_rootlist` la pide
/// explícitamente con `decorate=revision`— así que el dato ya está en la
/// respuesta que la app lee para dibujar la repisa y lo estaba tirando. No hace
/// falta un pedido por playlist: uno por biblioteca, y la revisión de todas.
///
/// La biblioteca pagina, y esta es la misma página que usa [`playlists`]. Una
/// biblioteca más larga que eso no entra, y la playlist que no está en la
/// página no tiene revisión que leer: eso es un `playlist_not_found` y no una
/// falla de red.
fn playlist_revision(session: &Session, playlist_id: &str) -> Result<Vec<u8>, String> {
    let owned = session.clone();
    let body = call(session, async move {
        owned
            .spclient()
            .get_rootlist(0, Some(ROOTLIST_PAGE))
            .await
            .map_err(|e| {
                log::error!("spclient: no se pudo leer la biblioteca para escribir: {e}");
                net_code(&e)
            })
    })?;

    let message = SelectedListContent::parse_from_bytes(&body).map_err(|e| {
        log::error!("spclient: el rootlist vino con otra forma: {e}");
        "bad_response".to_string()
    })?;

    let contents = message.contents.get_or_default();
    contents
        .items
        .iter()
        .zip(contents.meta_items.iter())
        .find(|(item, _)| bare_id(item.uri()) == playlist_id)
        .and_then(|(_, meta)| meta.revision.clone())
        .ok_or_else(|| {
            log::error!("spclient: la playlist {playlist_id} no vino en la biblioteca");
            "playlist_not_found".to_string()
        })
}

/// El `ListChanges` que mete una canción en una playlist.
///
/// Un `ADD` contra la revisión que se acaba de leer, con `add_last` para que
/// quede al final. El `timestamp` es la hora en que se agregó —el mismo campo
/// del que la columna "Fecha de adición" de la pantalla de playlist lee— y el
/// `added_by` es la cuenta que la agregó.
fn add_track_change(
    base_revision: &[u8],
    account: &str,
    timestamp: i64,
    track_uri: &str,
) -> ListChanges {
    ListChanges {
        base_revision: Some(base_revision.to_vec()),
        deltas: vec![delta(
            vec![Op {
                kind: Some(EnumOrUnknown::new(op::Kind::ADD)),
                add: MessageField::some(Add {
                    add_last: Some(true),
                    items: vec![Item {
                        uri: Some(track_uri.to_owned()),
                        attributes: MessageField::some(ItemAttributes {
                            added_by: Some(account.to_owned()),
                            timestamp: Some(timestamp),
                            ..Default::default()
                        }),
                        ..Default::default()
                    }],
                    ..Default::default()
                }),
                ..Default::default()
            }],
            account,
            timestamp,
        )],
        want_resulting_revisions: Some(true),
        want_sync_result: Some(true),
        nonces: vec![1],
        ..Default::default()
    }
}

/// El `ListChanges` que mete una playlist en la biblioteca.
///
/// **No la crea.** Es el segundo paso y va contra el rootlist; el primero es
/// escribirle a la playlist todavía sin existir. Mandar este pedido solo, o
/// mandarlo primero, es un `400 invalid argument` a un cuerpo que el servicio
/// acepta byte por byte cuando la playlist existe.
fn add_list_change(
    base_revision: Vec<u8>,
    account: &str,
    timestamp: i64,
    playlist_uri: &str,
) -> ListChanges {
    ListChanges {
        base_revision: Some(base_revision),
        deltas: vec![delta(
            vec![Op {
                kind: Some(EnumOrUnknown::new(op::Kind::ADD)),
                add: MessageField::some(Add {
                    from_index: Some(0),
                    items: vec![Item {
                        uri: Some(playlist_uri.to_owned()),
                        attributes: MessageField::some(ItemAttributes {
                            timestamp: Some(timestamp),
                            // `true`, como lo manda el cliente oficial. Lo que
                            // **sí** está medido hoy es que este atributo se
                            // puede cambiar después —es el `public` de
                            // `ItemAttributes`, y un
                            // `UPDATE_ITEM_ATTRIBUTES` contra el rootlist lo
                            // cambia—, así que una playlist creada pública se
                            // puede volver privada desde la app. Lo que **no**
                            // está medido es esta forma: un `ADD` con `false`
                            // adentro. Por eso va `true`: crear la playlist
                            // pública y corregirla después es un estado que la
                            // app sabe deshacer, y crearla en un estado que
                            // nadie verificó no lo es.
                            public: Some(true),
                            ..Default::default()
                        }),
                        ..Default::default()
                    }],
                    ..Default::default()
                }),
                ..Default::default()
            }],
            account,
            timestamp,
        )],
        want_resulting_revisions: Some(true),
        want_sync_result: Some(true),
        // Un `1`, como el que manda el cliente oficial. Es un nonce que el
        // servicio usa para correlacionar la respuesta con el pedido, no una
        // marca de tiempo: mandar acá el reloj del cliente convertía un campo
        // que dice "soy yo" en uno que dice "fui yo a las 14:03".
        nonces: vec![1],
        ..Default::default()
    }
}

/// El `ListChanges` que **cambia la visibilidad** de una playlist: pública o
/// privada.
///
/// **Es un op de atributos de ítem, no de lista, y va contra el rootlist.** La
/// playlist es una fila de la biblioteca —un ítem del rootlist— y su
/// visibilidad es un atributo de esa fila: `ItemAttributes.public`. La playlist
/// en sí no tiene dónde guardarlo: `ListAttributes` no tiene un campo de
/// visibilidad, y por eso esto no puede ser un `UPDATE_LIST_ATTRIBUTES`.
///
/// **El ítem va con su uri.** El proto deja las dos formas —`index` y `item`— y
/// la que se midió es la segunda: el `200` vino con el atributo cambiado. Un
/// `200` que no cambia nada es la forma más silenciosa de no escribir, así que
/// la forma que se usa es la que se comprobó, y no la que se suponía.
fn visibility_change(
    base_revision: &[u8],
    account: &str,
    timestamp: i64,
    playlist_uri: &str,
    is_public: bool,
) -> ListChanges {
    ListChanges {
        base_revision: Some(base_revision.to_vec()),
        deltas: vec![delta(
            vec![Op {
                kind: Some(EnumOrUnknown::new(op::Kind::UPDATE_ITEM_ATTRIBUTES)),
                update_item_attributes: MessageField::some(UpdateItemAttributes {
                    new_attributes: MessageField::some(ItemAttributesPartialState {
                        values: MessageField::some(ItemAttributes {
                            public: Some(is_public),
                            ..Default::default()
                        }),
                        ..Default::default()
                    }),
                    item: MessageField::some(Item {
                        uri: Some(playlist_uri.to_owned()),
                        ..Default::default()
                    }),
                    ..Default::default()
                }),
                ..Default::default()
            }],
            account,
            timestamp,
        )],
        want_resulting_revisions: Some(true),
        want_sync_result: Some(true),
        nonces: vec![1],
        ..Default::default()
    }
}

/// El `ListChanges` que **crea** una playlist: atributos contra una lista que
/// todavía no tiene ninguna.
///
/// Es un `UPDATE_LIST_ATTRIBUTES`, el mismo mensaje que usan el renombrado y
/// la portada. Lo que lo crea no es el mensaje sino la revisión contra la que
/// se cose: cero. Por eso el nombre va en el primer pedido y no en un segundo
/// —no hay segundo pedido, porque para cuando se manda el primero la playlist
/// ya existe.
fn create_list_change(account: &str, timestamp: i64, name: &str) -> ListChanges {
    details_change(
        UNBORN_REVISION,
        account,
        timestamp,
        &PlaylistDetails {
            name: Some(name.to_owned()),
            ..Default::default()
        },
        None,
    )
}

/// El `ListChanges` que **cambia los detalles** de una playlist: el nombre, la
/// descripción y la portada.
///
/// **Un solo op con todo lo que cambió.** Los atributos de una playlist se
/// escriben como un estado parcial: `values` lleva lo que se pone y `no_value`
/// lo que se vacía, y lo que no está en ninguno de los dos se queda como
/// estaba. Por eso un op con el nombre, la descripción y la portada juntos es
/// un cambio, no tres — y por eso el op del renombrado no tocó la descripción
/// de las playlists que ya la traían.
///
/// **La portada va como los bytes del id de la imagen**, no como una URL: es
/// lo que contesta el registro de la imagen, y es lo que el servicio guarda.
///
/// **Quitar la portada es otro op, y dice "vacía el id de la imagen".** Es un op
/// con `values` vacío y `no_value` con `LIST_PICTURE`: la playlist vuelve a la
/// portada que arma Spotify con las primeras canciones.
fn details_change(
    base_revision: &[u8],
    account: &str,
    timestamp: i64,
    details: &PlaylistDetails,
    picture: Option<Vec<u8>>,
) -> ListChanges {
    let mut values = ListAttributes::default();
    if let Some(name) = details.name.as_deref() {
        values.name = Some(name.trim().to_owned());
    }
    if let Some(description) = details.description.as_deref() {
        values.description = Some(description.to_owned());
    }
    if let Some(picture) = picture.as_ref() {
        values.picture = Some(picture.clone());
    }

    let mut ops = Vec::new();
    if values.name.is_some() || values.description.is_some() || values.picture.is_some() {
        ops.push(Op {
            kind: Some(EnumOrUnknown::new(op::Kind::UPDATE_LIST_ATTRIBUTES)),
            update_list_attributes: MessageField::some(UpdateListAttributes {
                new_attributes: MessageField::some(ListAttributesPartialState {
                    values: MessageField::some(values),
                    ..Default::default()
                }),
                ..Default::default()
            }),
            ..Default::default()
        });
    }
    if details.remove_picture {
        ops.push(Op {
            kind: Some(EnumOrUnknown::new(op::Kind::UPDATE_LIST_ATTRIBUTES)),
            update_list_attributes: MessageField::some(UpdateListAttributes {
                new_attributes: MessageField::some(ListAttributesPartialState {
                    values: MessageField::some(ListAttributes::default()),
                    no_value: vec![EnumOrUnknown::new(ListAttributeKind::LIST_PICTURE)],
                    ..Default::default()
                }),
                ..Default::default()
            }),
            ..Default::default()
        });
    }

    ListChanges {
        base_revision: Some(base_revision.to_vec()),
        deltas: vec![delta(ops, account, timestamp)],
        want_resulting_revisions: Some(true),
        want_sync_result: Some(true),
        nonces: vec![1],
        ..Default::default()
    }
}

/// Un `Delta` con las operaciones y la misma `ChangeInfo` que el resto.
///
/// La creación, el renombrado y la subida de una portada son tres deltas
/// distintos con la misma forma alrededor, y sin este helper el mensaje se
/// repite tres veces con un `?` de diferencia en algún lado.
///
/// **Varias operaciones en un delta son una cosa, no dos.** El delta es lo que
/// se cose contra la revisión: mandar los cambios en un solo delta es una
/// escritura y una revisión; mandarlos en deltas separados son dos y la
/// segunda puede chocar con la primera.
pub(super) fn delta(ops: Vec<Op>, user: &str, timestamp: i64) -> Delta {
    Delta {
        ops,
        info: MessageField::some(ChangeInfo {
            user: Some(user.to_owned()),
            timestamp: Some(timestamp),
            ..Default::default()
        }),
        ..Default::default()
    }
}

/// Las cabeceras que el router de Spotify espera ver en un pedido de playlist.
///
/// **La cabecera que miente.** `application/x-www-form-urlencoded` sobre un
/// cuerpo que no es formulario — y esa mentira es parte de lo que el router
/// espera ver. Un `400 invalid argument` a un cuerpo idéntico byte por byte al
/// que él mismo acepta es la forma que tiene el router de decir que la
/// cabecera no fue la que quería.
fn spclient_headers() -> reqwest::header::HeaderMap {
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        reqwest::header::CONTENT_TYPE,
        reqwest::header::HeaderValue::from_static("application/x-www-form-urlencoded"),
    );
    headers
}

/// Manda un `ListChanges`.
///
/// El error distingue **qué** pasó, no sólo **que** pasó: una playlist creada que
/// quedó sin nombre es media operación hecha, y llamarla `network_failed` hace
/// que el mensaje al frente diga que no pasó nada.
fn send_changes(
    session: &Session,
    endpoint: &str,
    changes: &ListChanges,
    failure: &str,
) -> Result<(), String> {
    let body = changes.write_to_bytes().map_err(|e| {
        log::error!("spclient: el cambio no se pudo serializar: {e}");
        failure.to_string()
    })?;

    // `SpClient::request` manda `CONTENT_LENGTH`, la autorización y el client
    // token, y **ningún `Content-Type`**. Para una lectura no importa; para esto
    // sí: la primera vez que esto se corrió, sin cabecera, el servicio contestó
    // `400 invalid argument` a un cuerpo idéntico byte por byte al que él mismo
    // acepta. La cabecera que manda el cliente oficial es
    // `x-www-form-urlencoded` sobre un cuerpo que no es formulario — y esa
    // mentira es parte de lo que el router de Spotify espera ver.
    let headers = spclient_headers();

    let printable = hex_without_account(&body, &session.username());
    let owned = session.clone();
    let path = endpoint.to_owned();
    let tag = failure.to_owned();
    call(session, async move {
        owned
            .spclient()
            .request(&reqwest::Method::POST, &path, Some(headers), Some(&body))
            .await
            .map(|answer| log::info!("spclient: `{tag}` en `{path}` → {} bytes", answer.len()))
            .map_err(|e| {
                log::error!("spclient: `{tag}` en `{path}` falló: {e}");
                log::error!("spclient: cuerpo enviado — {printable}");
                tag
            })
    })
}

/// El cuerpo en hexadecimal, con el nombre de cuenta tapado.
///
/// Un `400` sin el cuerpo es un `400` que obliga a adivinar, y adivinar es lo
/// que convirtió la primera vez en media hora de "probemos un cambio". El nombre
/// de cuenta viaja dentro del `ChangeInfo` y no tiene por qué quedar en texto
/// plano en un archivo que cualquiera abre: se sustituye por la misma cantidad de
/// guiones, así que el hexadecimal sigue siendo comparable con el de otra corrida.
fn hex_without_account(body: &[u8], account: &str) -> String {
    let needle = account.as_bytes();
    let hex: String = body.iter().map(|b| format!("{b:02x}")).collect();

    if needle.is_empty() {
        return hex;
    }
    hex.replace(&needle.iter().map(|b| format!("{b:02x}")).collect::<String>(), &"-".repeat(needle.len() * 2))
}

/// La sesión compartida, tal como la cuenta la está viendo.
///
/// **El jam no es una playlist: es una sesión, y el servicio no se llama jam.**
/// Se llama `social-connect` —"Social Listening" para Spotify— y sus rutas no
/// lo dicen: `social-connect/v2/sessions/current_or_new`, `…/join/<token>`.
///
/// **Abrir una sesión es un `GET`, y la crea.** El camino se llama
/// `current_or_new` porque es literal: si no hay sesión, la abre —con su token
/// de join y su dueño—, y `activate=true` además la activa. Un `POST` sobre el
/// mismo camino contesta `405`: el verbo es el otro.
///
/// Medido contra el servicio con una sesión de streaming el 30 de octubre de
/// 2026; el protocolo entero está en `docs/jam.md`.
pub fn jam_session(session: &Session, activate: bool) -> Result<JamSession, String> {
    let owned = session.clone();
    let route = if activate {
        "/social-connect/v2/sessions/current_or_new?activate=true"
    } else {
        "/social-connect/v2/sessions/current_or_new?activate=false"
    };

    let body = call(session, async move {
        owned
            .spclient()
            .request(&reqwest::Method::GET, route, None, None)
            .await
            .map_err(|e| {
                log::error!("spclient: la puerta del jam no abrió: {e}");
                net_code(&e)
            })
    })?;

    serde_json::from_slice(&body).map_err(|e| {
        log::error!("spclient: la sesión del jam vino con otra forma: {e}");
        "bad_response".to_string()
    })
}

/// El jam que hay en la cuenta, si hay uno.
///
/// **La primera puerta no crea nada, y por eso va primera.**
///
/// `current_or_new` crea una sesión si no había ninguna, y el panel no puede
/// dejar un jam abierto en la cuenta de alguien que sólo miró. La puerta que
/// sí dice si hay jam sin crearlo es `current?alt=protobuf`: contesta `404`
/// cuando no hay ninguno y `200` con la sesión cuando lo hay.
///
/// **La segunda puerta es la de los datos**, en JSON, que es donde están el
/// código para compartir el jam y los participantes.
///
/// **Una sesión que no está activa no es un jam.** El servicio crea una sesión
/// inactiva cuando no había ninguna, y esa no se muestra: el jam es el que está
/// `active`.
pub fn jam_current(session: &Session) -> Result<Option<JamSession>, String> {
    let owned = session.clone();
    let hay = call(session, async move {
        match owned
            .spclient()
            .request(
                &reqwest::Method::GET,
                "/social-connect/v2/sessions/current?alt=protobuf",
                None,
                None,
            )
            .await
        {
            Ok(_) => Ok(true),
            // Un `404` es la respuesta normal cuando no hay jam: no es un error.
            Err(error) if error.kind == ErrorKind::NotFound => Ok(false),
            Err(error) => {
                log::error!("spclient: no se pudo preguntar si hay jam: {error}");
                Err(error.to_string())
            }
        }
    })?;

    if !hay {
        return Ok(None);
    }

    let jam = jam_session(session, false)?;
    Ok(if jam.active { Some(jam) } else { None })
}

/// Entrar a una sesión con su código.
///
/// **Es un `POST` con cuerpo.** El `GET` al mismo camino contesta `405` —la
/// ruta existe, el verbo no es ese— y sin cuerpo contesta `411`. Un `{}` al
/// final alcanza: el token de la URL es lo que identifica la sesión, no el
/// cuerpo.
pub fn jam_join(session: &Session, token: &str) -> Result<JamSession, String> {
    let owned = session.clone();
    let route = format!("/social-connect/v2/sessions/join/{token}");

    let body = call(session, async move {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            reqwest::header::CONTENT_TYPE,
            reqwest::header::HeaderValue::from_static("application/json"),
        );

        owned
            .spclient()
            .request(
                &reqwest::Method::POST,
                &route,
                Some(headers),
                Some(b"{}"),
            )
            .await
            .map_err(|e| {
                log::error!("spclient: no se pudo entrar al jam: {e}");
                net_code(&e)
            })
    })?;

    serde_json::from_slice(&body).map_err(|e| {
        log::error!("spclient: la sesión del jam vino con otra forma: {e}");
        "bad_response".to_string()
    })
}

/// Salir de la sesión.
///
/// **Es un `POST` a `…/sessions/<id>/leave`, y no un `DELETE` a `…/sessions/<id>`.**
/// Los dos caminos existen y los dos contestan `200`, pero hacen cosas
/// distintas: el `DELETE` **borra la sesión** —es la puerta del anfitrión, y
/// un invitado no la puede usar—, y el `POST` **se va de ella**.
///
/// La diferencia se midió el 30 de octubre de 2026: un `DELETE` de un
/// invitado contesta `405` o `403`, y el `POST` de un invitado contesta `200` y
/// lo saca de la sesión dejando la sesión viva. Para el anfitrión el `POST`
/// también termina la sesión: después de él, la sesión ya no existe.
///
/// Los otros verbos sobre el mismo camino contestan `405` —la ruta existe, y
/// no para eso— y el `GET` también.
pub fn jam_leave(session: &Session, session_id: &str) -> Result<(), String> {
    let owned = session.clone();
    let route = format!("/social-connect/v2/sessions/{session_id}/leave");

    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        reqwest::header::CONTENT_TYPE,
        reqwest::header::HeaderValue::from_static("application/json"),
    );

    call(session, async move {
        owned
            .spclient()
            .request(
                &reqwest::Method::POST,
                &route,
                Some(headers),
                Some(b"{}"),
            )
            .await
            .map(|_| ())
            .map_err(|e| {
                log::error!("spclient: no se pudo salir del jam: {e}");
                net_code(&e)
            })
    })
}

/// Cerrar la sesión: borrarla.
///
/// **Es un `DELETE` a `…/sessions/<id>`, y es la puerta del anfitrión.** Un
/// invitado no puede borrarla —el servicio contesta `405`—, y para él la
/// puerta es [`jam_leave`].
///
/// Un `404` acá significa que la sesión ya no está, que es lo que se quería:
/// el error se cuenta como un aviso, no como un fallo, y el que decide si eso
/// es un problema es el comando que la llamó.
pub fn jam_end(session: &Session, session_id: &str) -> Result<(), String> {
    let owned = session.clone();
    let route = format!("/social-connect/v2/sessions/{session_id}");
    let id = session_id.to_owned();

    call(session, async move {
        match owned
            .spclient()
            .request(&reqwest::Method::DELETE, &route, None, None)
            .await
        {
            Ok(_) => Ok(()),
            Err(e) => {
                log::warn!("spclient: la sesión {id} no se pudo borrar: {e}");
                Err(net_code(&e))
            }
        }
    })
}

/// La cola compartida del jam: las canciones que el servicio tiene escrita.
///
/// **La cola es una lista, y la lista se lee con el servicio de listas.** La
/// URI es `spotify:list:jam-list:<id de la sesión>` —el id de la sesión, no
/// el token— y la puerta es
/// `playlist/spotify.list.v1.ListReadService/GetLists`, que habla protobuf.
///
/// **Lo que vuelve son las URIs de las canciones, en el orden de la cola.** El
/// nombre y la foto no vienen en la lista: se resuelven después, contra la
/// metadata de la sesión, que ya sabe leer canciones.
///
/// Medido el 30 de octubre de 2026; el protocolo entero está en
/// `docs/jam.md`.
pub fn jam_queue(session: &Session, session_id: &str) -> Result<Vec<Track>, String> {
    let uri = format!("spotify:list:jam-list:{session_id}");
    let body = jamlist::request(&uri);

    let owned = session.clone();
    let answer = call(session, async move {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            reqwest::header::CONTENT_TYPE,
            reqwest::header::HeaderValue::from_static("application/x-protobuf"),
        );

        owned
            .spclient()
            .request(
                &reqwest::Method::POST,
                "/playlist/spotify.list.v1.ListReadService/GetLists",
                Some(headers),
                Some(&body),
            )
            .await
            .map_err(|e| {
                log::error!("spclient: la cola del jam no se pudo leer: {e}");
                net_code(&e)
            })
    })?;

    let uris = match jamlist::tracks(&answer) {
        Some(uris) => uris,
        // **La cola que todavía no está no es un error.**
        //
        // El servicio contesta `Not Found` cuando el jam no tiene cola —la
        // lista la siembra después de que alguien se une—, y eso se ve igual
        // que una lista vacía en la pantalla. Lo que no puede ser es un error:
        // el panel dice "la cola está vacía" y el log no grita cada tres
        // segundos.
        None if jamlist::not_found(&answer) => {
            log::info!("spclient: la cola del jam todavía no está");
            Vec::new()
        }
        None => {
            log::error!("spclient: la cola del jam vino con otra forma");
            return Err("bad_response".to_string());
        }
    };

    // **La cola del jam la llena el servicio, y son cientos de canciones.**
    // Resolver el nombre de cada una es un viaje por la red cada vez que se
    // pregunta, así que se leen las primeras: el panel muestra ocho, y la
    // primera es la que está sonando.
    let uris: Vec<String> = uris.into_iter().take(JAM_QUEUE_ITEMS).collect();

    // **Las que ya se resolvieron no se vuelven a resolver.**
    //
    // El panel pregunta la cola cada tres segundos, y cada canción necesita su
    // metadata: doce búsquedas por vuelta, cuatrocientas por minuto —y el
    // servicio corta la tanda con un `429`—. El nombre de una canción no
    // cambia, así que la metadata se pide una vez y se guarda.
    //
    // **El orden se respeta igual.** La primera canción de la cola es la que
    // está sonando, y el caché no puede cambiar eso: por eso las posiciones
    // se guardan y se llenan después.
    let mut out: Vec<Option<Track>> = {
        let guard = jam_track_cache()
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        uris.iter().map(|raw| guard.get(raw).cloned()).collect()
    };

    for (index, raw) in uris.iter().enumerate() {
        if out[index].is_some() {
            continue;
        }
        let Ok(parsed) = SpotifyUri::from_uri(raw) else {
            continue;
        };
        let key = raw.clone();
        let value = raw.clone();
        let owned = session.clone();
        let track = call(session, async move {
            MetaTrack::get(&owned, &parsed)
                .await
                .map_err(|e| {
                    log::error!("spclient: la metadata de {value} falló: {e}");
                    "bad_response".to_string()
                })
        })?;
        let track = convert(&track, session);
        let mut guard = jam_track_cache()
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        guard.insert(key, track.clone());
        out[index] = Some(track);
    }

    Ok(out.into_iter().flatten().collect())
}

/// Las canciones de la cola del jam que ya tienen nombre.
///
/// **El caché de la cola.** La cola se lee cada tres segundos y resolver el
/// nombre de cada canción es un viaje por la red: sin esto, el panel del jam
/// hace cientos de búsquedas por minuto y el servicio corta la tanda con un
/// `429` —que después la app reporta como un error del jam, y no lo es—.
fn jam_track_cache() -> &'static std::sync::Mutex<HashMap<String, Track>> {
    static CACHE: std::sync::OnceLock<std::sync::Mutex<HashMap<String, Track>>> =
        std::sync::OnceLock::new();
    CACHE.get_or_init(|| std::sync::Mutex::new(HashMap::new()))
}

/// La cola compartida del jam, con el `uid` de cada canción.
///
/// **La URI sola no alcanza para agregar una canción**: el comando del player
/// lleva un `ContextTrack { uri, uid, gid, metadata }`, y sin el `uid` el
/// servicio resuelve otra pista —la que está sonando—. El `uid` de cada
/// canción está en el id del item de la lista.
pub fn jam_queue_items(
    session: &Session,
    session_id: &str,
) -> Result<Vec<(String, String)>, String> {
    let uri = format!("spotify:list:jam-list:{session_id}");
    let body = jamlist::request(&uri);

    let owned = session.clone();
    let answer = call(session, async move {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            reqwest::header::CONTENT_TYPE,
            reqwest::header::HeaderValue::from_static("application/x-protobuf"),
        );

        owned
            .spclient()
            .request(
                &reqwest::Method::POST,
                "/playlist/spotify.list.v1.ListReadService/GetLists",
                Some(headers),
                Some(&body),
            )
            .await
            .map_err(|e| {
                log::error!("spclient: la cola del jam no se pudo leer: {e}");
                net_code(&e)
            })
    })?;

    match jamlist::tracks_with_ids(&answer) {
        Some(items) => Ok(items),
        None if jamlist::not_found(&answer) => Ok(Vec::new()),
        None => {
            log::error!("spclient: la cola del jam vino con otra forma");
            Err("bad_response".to_string())
        }
    }
}

/// Agregar una canción a la cola compartida del jam.
///
/// La puerta es `POST /social-connect/v2/sessions/<id>/commands/from/<device>`
/// y el cuerpo es el **comando del player**. Lo que cambia todo es una cosa:
/// el comando **no es un objeto con `type`**, es un objeto con `endpoint`.
///
/// ```json
/// {"command": {"endpoint": "add_to_queue", "track": {"uri": "spotify:track:…"},
///              "options": {"override_restrictions": false,
///                          "only_for_local_device": false,
///                          "system_initiated": false},
///              "logging_params": {"command_initiated_time": 1759…,
///                                 "command_received_time": 1759…,
///                                 "page_instance_ids": [], "interaction_ids": [],
///                                 "device_identifier": "Starless",
///                                 "command_id": "<hex>"}},
///  "connection_type": "wlan", "intent_id": "<hex>"}
/// ```
///
/// **La forma se midió el 30 de octubre de 2026.** Con `type` el servicio
/// contesta `400 INVALID_PLAYER_COMMAND "Could not parse command"`; con
/// `endpoint` contesta `200` y `{"status":"RECOVERED"}`. El `options` y el
/// `logging_params` no son obligatorios —con `{"endpoint":"add_to_queue",
/// "track":{"uri":"…"}}` a secas también entra—, pero se mandan igual porque
/// es lo que manda el cliente de escritorio.
///
/// El servicio contesta con un estado y no con un error: `RECOVERED` es que el
/// comando entró, y `DEVICE_NOT_FOUND` —lo que contesta `pause` cuando no hay
/// un dispositivo al que mandárselo— es que no había a quién.
pub fn jam_add_to_queue(session: &Session, session_id: &str, track_id: &str) -> Result<(), String> {
    jam_add_to_queue_with_uid(session, session_id, track_id, None)
}

/// Agregar una canción a la cola compartida, con el `uid` de la pista.
///
/// **El `uid` es lo que hace que la canción sea la correcta.**
///
/// El comando del player lleva la pista como un `ContextTrack`
/// (`{ uri, uid, gid, metadata }`). Mandando sólo la URI, el servicio acepta el
/// comando y **lo aplica a la pista que está sonando**: al otro lado del jam le
/// entra la canción de siempre, y la lista compartida no cambia. Es lo que se
/// midió el 31 de octubre de 2026 — el comando contestaba `SUCCESS` y la lista
/// seguía igual—.
///
/// Con el `uid` —el id que la pista tiene dentro del contexto— la lista
/// compartida toma la canción que se mandó.
pub fn jam_add_to_queue_with_uid(
    session: &Session,
    session_id: &str,
    track_id: &str,
    uid: Option<&str>,
) -> Result<(), String> {
    // **La URI se arma acá y no en el frontend.** El id de una pista es base62,
    // y hay un solo lugar en la app que sabe eso: el mismo que arma la URI
    // para reproducir. Si el frontend mandara la URI, serían dos lugares
    // sabiendo la misma regla, y uno de los dos va a estar mal un día.
    SpotifyId::from_base62(track_id).map_err(|_| "bad_track_id".to_string())?;
    let uri = format!("spotify:track:{track_id}");

    let device = session.device_id().to_owned();
    let route = format!("/social-connect/v2/sessions/{session_id}/commands/from/{device}");
    let body = jam_command_body_with_track(
        "add_to_queue",
        Some((uri.as_str(), uid)),
        &device,
    );

    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        reqwest::header::CONTENT_TYPE,
        reqwest::header::HeaderValue::from_static("application/json"),
    );

    let owned = session.clone();
    let answer = call(session, async move {
        owned
            .spclient()
            .request(
                &reqwest::Method::POST,
                &route,
                Some(headers),
                Some(body.as_bytes()),
            )
            .await
            .map_err(|e| {
                log::error!("spclient: no se pudo mandar el comando al jam: {e}");
                net_code(&e)
            })
    })?;

    let status = serde_json::from_slice::<serde_json::Value>(&answer)
        .ok()
        .and_then(|v| v.get("status").and_then(|s| s.as_str()).map(str::to_owned));

    match status.as_deref() {
        // **El servicio contesta dos palabras y la app conocía una.**
        //
        // `RECOVERED` es lo que contesta cuando el comando entra; `SUCCESS` es
        // lo que contesta cuando el comando **se aplicó**. Medido el 31 de
        // octubre de 2026: el mismo `add_to_queue` respondía `RECOVERED` con la
        // sesión recién abierta y `SUCCESS` con la sesión ya andando — y la
        // app, que sólo aceptaba la primera, contestaba "jam_command_rejected"
        // con el comando **aplicado**. Un error que dice que falló lo que
        // funcionó: el que empujaba una canción al jam veía un error y la
        // canción entraba igual.
        //
        // Los dos son aciertos. `DEVICE_NOT_FOUND` —lo que contesta `pause`
        // cuando no hay a quién mandárselo— sí es un error de verdad.
        Some("RECOVERED") | Some("SUCCESS") => Ok(()),
        Some(other) => {
            log::warn!("spclient: el jam contestó {other} al comando de agregar");
            Err("jam_command_rejected".to_string())
        }
        None => {
            log::error!("spclient: el jam contestó sin estado al comando de agregar");
            Err("bad_response".to_string())
        }
    }
}

/// El cuerpo de un comando del player, que es lo que la puerta del jam
/// entiende.
///
/// **La forma simple, sin `uid`.** Sólo la usan los tests: la app manda el
/// `ContextTrack` completo, con su `uid`, porque sin él el servicio mete la
/// pista que está sonando en vez de la que se le pidió.
#[cfg(test)]
fn jam_command_body(endpoint: &str, uri: Option<&str>, device: &str) -> String {
    jam_command_body_with_track(endpoint, uri.map(|uri| (uri, None)), device)
}

/// El mismo comando, pero con la pista completa.
///
/// **La pista del comando es un `ContextTrack` y no una URI suelta**:
/// `ContextTrack { uri, uid, gid, metadata }`. Medido el 31 de octubre de 2026:
/// mandando sólo la URI, el servicio acepta el comando —`SUCCESS`— y lo aplica
/// **a la pista que está sonando**, no a la que se mandó: al otro lado del jam
/// le entra la canción de siempre. Con el `uid` de la pista, la lista compartida
/// la toma.
fn jam_command_body_with_track(
    endpoint: &str,
    track: Option<(&str, Option<&str>)>,
    device: &str,
) -> String {
    let now = now_millis();

    let mut command = serde_json::Map::new();
    command.insert(
        "endpoint".into(),
        serde_json::Value::String(endpoint.to_owned()),
    );

    if let Some((uri, uid)) = track {
        let mut pista = serde_json::Map::new();
        pista.insert("uri".into(), serde_json::Value::String(uri.to_owned()));
        if let Some(uid) = uid {
            pista.insert("uid".into(), serde_json::Value::String(uid.to_owned()));
        }
        command.insert("track".into(), serde_json::Value::Object(pista));
    }

    command.insert(
        "options".into(),
        serde_json::json!({
            "override_restrictions": false,
            "only_for_local_device": false,
            "system_initiated": false,
        }),
    );

    command.insert(
        "logging_params".into(),
        serde_json::json!({
            "command_initiated_time": now,
            "command_received_time": now,
            "page_instance_ids": [],
            "interaction_ids": [],
            "device_identifier": device,
            "command_id": jam_hex_id(),
        }),
    );

    serde_json::json!({
        "command": serde_json::Value::Object(command),
        "connection_type": "wlan",
        "intent_id": jam_hex_id(),
    })
    .to_string()
}

/// Un identificador hexadecimal de 32 caracteres, que es lo que el servicio
/// espera en el `intent_id` y en el `command_id`.
///
/// No hay `rand` en las dependencias y no hace falta: estos identificadores
/// sólo tienen que ser distintos entre sí. El reloj y un contador cumplen.
fn jam_hex_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);

    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{:016x}{:016x}", now_millis() as u64, n)
}

/// Cuántas canciones de la cola compartida se resuelven en nombres.
///
/// **La cola del jam viene sembrada con cientos de canciones**, y cada una
/// resuelta es un viaje al servicio de metadata. El panel muestra ocho y la
// primera es la que está sonando: con esto alcanza y sobra.
const JAM_QUEUE_ITEMS: usize = 12;

/// La revisión contra la que hay que escribir sobre el rootlist.
///
/// Si no viene, el `ADD` se mandaría sin base y el servicio lo trata como una
/// escritura ciega contra un estado que puede no ser el de ahora. Es un dato que
/// la biblioteca ya trae en cada lectura: no pedirlo de más sería una decisión
/// difícil de explicar después.
///
/// **Se relee, y es un viaje de más a propósito.** El cliente de escritorio usa
/// la revisión que ya tiene cacheada y se ahorra este `GET`; nosotros no, porque
/// cachearla es un estado que hay que invalidar en cada frontera de autenticación
/// y un error ahí no se ve hasta que alguien pierde una playlist. Cuesta una
/// lectura de unos milisegundos en una acción que se hace unas pocas veces al
/// mes, y a cambio el `GET` se corrige solo. Optimizarlo después, con el motivo
/// anotado, es una decisión mejor que heredarlo sin entenderlo.
///
/// La revisión puede no ser la última y da lo mismo: el servicio fusiona en vez
/// de rechazar, que es lo que hace el escritorio cuando escribe contra la que
/// tenía.
fn rootlist_revision(session: &Session) -> Result<Vec<u8>, String> {
    let owned = session.clone();
    let body = call(session, async move {
        owned
            .spclient()
            .get_rootlist(0, Some(ROOTLIST_PAGE))
            .await
            .map_err(|e| {
                log::error!("spclient: no se pudo leer la biblioteca para escribir: {e}");
                net_code(&e)
            })
    })?;

    SelectedListContent::parse_from_bytes(&body)
        .map_err(|e| {
            log::error!("spclient: el rootlist vino con otra forma: {e}");
            "bad_response".to_string()
        })?
        .revision
        .ok_or_else(|| {
            log::error!("spclient: el rootlist vino sin revisión");
            "bad_response".to_string()
        })
}

#[cfg(debug_assertions)]
mod probe;

/// El jam con los dos lados en esta máquina: el arnés que camina el ciclo
/// entero con dos cuentas y dice qué paso funciona.
#[cfg(debug_assertions)]
mod jampair;

/// La cola compartida del jam: el servicio de listas y su protobuf.
mod jamlist;

/// El estado del player, publicado al servicio.
///
/// **Sin esto el jam no tiene anfitrión**: la cola compartida es el contexto
/// que publica el player del anfitrión, y Starless no publicaba ninguno.
pub mod state;

#[cfg(debug_assertions)]
pub use jampair::{
    requested as jam_pair_requested, run as run_jam_pair_probe, watch as run_jam_watch_probe,
    watch_requested as jam_watch_requested,
};

#[cfg(debug_assertions)]
pub use probe::{
    create_requested, dj_requested, home_requested, jam_requested, jam_state_requested,
    pictures_requested, private_requested, radio_requested, requested, run_create_probe,
    run_dj_probe, run_home_probe, run_jam_probe, run_jam_state_probe, run_picture_probe,
    run_private_probe, run_probe, run_radio_probe, run_shape_probe, run_voice_probe,
    shapes_requested, voice_requested,
};

#[cfg(test)]
mod tests {
    use super::jam_command_body;
    use super::new_playlist_id;
    use librespot_core::SpotifyId;

    /// El comando del jam tiene que llevar `endpoint`, no `type`.
    ///
    /// **Es la diferencia entre que el comando entre y que no.** El servicio
    /// responde `400 INVALID_PLAYER_COMMAND "Could not parse command"` a un
    /// comando con `type`, y `200` a un comando con `endpoint`: el `type` no
    /// es lo que el servicio lee, y un cuerpo con `type` parece correcto
    /// justamente por eso.
    ///
    /// El `logging_params` y el `options` no hacen falta para que el comando
    /// entre, pero se mandan porque es lo que manda el cliente de escritorio.
    #[test]
    fn the_jam_command_carries_the_endpoint_and_not_the_type() {
        let body = jam_command_body("add_to_queue", Some("spotify:track:3b5E38f6Dbx28IVof4oeAA"), "Starless");
        let json: serde_json::Value = serde_json::from_str(&body).expect("el comando es JSON");

        let command = &json["command"];
        assert_eq!(command["endpoint"], "add_to_queue");
        assert!(
            command.get("type").is_none(),
            "el comando no lleva `type`: {body}"
        );
        assert_eq!(
            command["track"]["uri"],
            "spotify:track:3b5E38f6Dbx28IVof4oeAA"
        );

        // El sobre: la conexión y la intención.
        assert_eq!(json["connection_type"], "wlan");
        assert_eq!(json["intent_id"].as_str().map(str::len), Some(32));
        assert_eq!(
            command["logging_params"]["command_id"]
                .as_str()
                .map(str::len),
            Some(32)
        );
    }

    /// Y dos comandos seguidos no pueden llevar el mismo `intent_id`.
    ///
    /// El servicio usa el `intent_id` para saber si un comando es nuevo o un
    /// reintento del mismo. Dos comandos con el mismo id son el mismo
    /// comando, y el segundo se ignora: la canción no entraría a la cola y
    /// no habría ningún error que lo dijera.
    #[test]
    fn two_jam_commands_do_not_share_the_intent_id() {
        let first = jam_command_body("add_to_queue", None, "Starless");
        let second = jam_command_body("add_to_queue", None, "Starless");

        let one: serde_json::Value = serde_json::from_str(&first).expect("el comando es JSON");
        let two: serde_json::Value = serde_json::from_str(&second).expect("el comando es JSON");

        assert_ne!(one["intent_id"], two["intent_id"]);
    }

    /// El id tiene que ser un `SpotifyId` de verdad.
    ///
    /// `from_base62` valida las tres cosas a la vez que el servicio exige:
    /// que sean 22 caracteres, que todos estén en el alfabeto canónico y que
    /// el número que representan entre en un `u128`. Es exactamente la pregunta
    /// que el servicio responde con un `400` mudo cuando falla.
    #[test]
    fn a_new_playlist_id_is_a_canonical_base62_spotify_id() {
        for _ in 0..2_000 {
            let id = new_playlist_id();
            assert_eq!(id.chars().count(), 22, "id largo raro: {id}");
            assert!(
                SpotifyId::from_base62(&id).is_ok(),
                "no es un id canónico de Spotify: {id}"
            );
        }
    }

    /// Y tiene que quedar por debajo de 2^127.
    ///
    /// La primera versión de esto escribía los dígitos del menos significativo al
    /// más —lo natural con un `push`— y producía ids de 130 bits. El servicio los
    /// rechaza igual que un cuerpo mal formado, sin decir cuál de las dos cosas
    /// fue: el id viaja en la URL y no en el cuerpo, así que comparar los
    /// cuerpos byte por byte no lo puede mostrar. Lo único que lo delata es
    /// medir el número.
    #[test]
    fn a_new_playlist_id_stays_under_two_pow_127() {
        for _ in 0..2_000 {
            let id = new_playlist_id();
            let value = SpotifyId::from_base62(&id).expect("id válido").id;
            assert!(
                value < (1u128 << 127),
                "id fuera del techo que acepta el servicio: {id} = {} bits",
                128 - value.leading_zeros()
            );
        }
    }

    /// Una colisión no avisa: el `ADD` de otra persona escribiría encima.
    #[test]
    fn a_new_playlist_id_is_not_the_same_twice() {
        let mut ids = std::collections::HashSet::new();
        for _ in 0..500 {
            ids.insert(new_playlist_id());
        }
        assert_eq!(ids.len(), 500, "se repitió un id");
    }
}

/// La sesión del jam, tal como la contesta el servicio.
///
/// **Copia literal de una respuesta real**, del 30 de octubre de 2026. El
/// servicio mezcla convenciones de nombres —casi todo en `snake_case` y un
/// campo en `camelCase`—, y ese `maxMemberCount` es el que hace que el modelo
/// lleve un `rename`: sin él, la sesión no se puede leer y el jam no arranca.
#[cfg(test)]
mod jam_tests {
    use crate::models::JamSession;

    const SESSION: &str = r#"{
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
    }"#;

    /// La sesión se tiene que leer entera, con su código y su gente.
    #[test]
    fn the_jam_session_reads_the_service_json() {
        let session: JamSession = serde_json::from_str(SESSION).expect("la sesión no se leyó");

        assert_eq!(session.session_id, "caed1c83acdc65bd86ff4c4d37a2d459");
        assert_eq!(
            session.join_session_token.as_deref(),
            Some("6aUOeCRYpNipAG6Lf3wNiF")
        );
        assert_eq!(
            session.join_session_uri.as_deref(),
            Some("spotify:socialsession:6aUOeCRYpNipAG6Lf3wNiF")
        );
        assert!(session.active);
        assert!(session.is_session_owner);
        // **El `camelCase` del servicio.** Sin el `rename`, este número es
        // `None` y el panel mostraría un jam sin cupos.
        assert_eq!(session.max_member_count, Some(32));

        assert_eq!(session.session_members.len(), 1);
        let member = &session.session_members[0];
        assert_eq!(member.display_name.as_deref(), Some("Opioide"));
        assert_eq!(member.username.as_deref(), Some("t_jitzol"));
        assert!(member.is_controlling);
        assert!(member.is_listening);
    }
}
