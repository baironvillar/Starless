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

use librespot_core::error::ErrorKind;
use librespot_core::{FileId, Session, SpotifyId, SpotifyUri};
use librespot_metadata::{Lyrics as MetaLyrics, Metadata, Track as MetaTrack};
use librespot_protocol::context::Context;
use librespot_protocol::extended_metadata::{BatchedEntityRequest, EntityRequest, ExtensionQuery};
use librespot_protocol::extension_kind::ExtensionKind;
use librespot_protocol::metadata::Track as TrackMessage;
use librespot_protocol::playlist4_external::SelectedListContent;
use protobuf::{EnumOrUnknown, Message};

use crate::models::{
    Account, Album, Artist, ArtistCard, ArtistProfile, Image, LyricLine, Lyrics, Playlist, Track,
    TrackTotal,
};

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

/// Cuántas pistas se piden por viaje de metadata.
///
/// El servicio acepta un lote entero; el número es una decisión propia y no un
/// límite del otro lado. Se corta en cincuenta porque una playlist de doscientas
/// pistas en un solo pedido es un pedido que se cae entero y tira doscientas
/// filas, mientras que cinco pedidos de cuarenta muestran las primeras páginas
/// y las siguientes llegan igual.
const DETAILS_BATCH: usize = 50;

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
                    "network_failed".to_string()
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
fn convert(track: &MetaTrack, session: &Session) -> Track {
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
                .map(|url| Image { url, width: None, height: None })
                .collect(),
        }),
        popularity: Some(track.popularity.max(0) as u32),
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
async fn details(owned: Session, uris: Vec<String>) -> Result<HashMap<String, Track>, String> {
    let mut out = HashMap::new();

    for chunk in uris.chunks(DETAILS_BATCH) {
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
                "network_failed".to_string()
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
                    out.insert(bare_id(&entry.entity_uri), convert(&track, &owned));
                }
            }
        }
    }

    Ok(out)
}

/// Resuelve una lista de URIs a filas con todo lo que la lista muestra.
fn hydrate(
    session: &Session,
    uris: Vec<String>,
) -> Result<Vec<Track>, String> {
    if uris.is_empty() {
        return Ok(Vec::new());
    }
    let owned = session.clone();
    // Copia aparte porque la promesa vive en otro hilo y después se usa la
    // lista: sin esto, el `move` se la lleva.
    let wanted = uris.clone();
    let known = call(session, async move { details(owned, wanted).await })?;

    // En el orden que vinieron las pistas, no en el orden en que llegaron los
    // metadatos: una lista de reproducción tiene un orden y la pantalla lo
    // muestra.
    Ok(uris
        .into_iter()
        .filter_map(|uri| known.get(&uri).cloned())
        .collect())
}

/// Las pistas de un context por su URI especial.
///
/// `spotify:user:<id>:collection` son las canciones guardadas y
/// `spotify:search:<consulta>` la búsqueda. Los dos son URIs que el servicio
/// entiende por su forma, así que no hacen falta client id ni scopes: son la
/// misma llamada que pide una playlist, con otra URI.
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
                "network_failed".to_string()
            })
    })?;

    hydrate(session, uris)
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
                "network_failed".to_string()
            })
    })?;

    let profile: Profile = serde_json::from_slice(&body).map_err(|e| {
        log::error!("spclient: el perfil vino con otra forma: {e}");
        "bad_response".to_string()
    })?;

    Ok(Account {
        id: session.username().to_string(),
        display_name: profile.name,
        email: None,
        product: Some("premium".to_string()),
        images: profile
            .image_url
            .map(|url| Image { url, width: None, height: None })
            .into_iter()
            .collect(),
    })
}

// ---------------------------------------------------------------------------
// La biblioteca
// ---------------------------------------------------------------------------

/// Todas las playlists de la cuenta: las suyas y las que seguís.
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
                "network_failed".to_string()
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
                                width: None,
                                height: None,
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
                    .map(|url| Image {
                        url,
                        width: None,
                        height: None,
                    })
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
                "network_failed".to_string()
            })
    })?;

    let message = SelectedListContent::parse_from_bytes(&uris).map_err(|e| {
        log::error!("spclient: la playlist vino con otra forma: {e}");
        "bad_response".to_string()
    })?;

    let contents = message.contents.get_or_default();
    let ids: Vec<String> = contents
        .items
        .iter()
        .map(|item| bare_id(item.uri()))
        .collect();

    hydrate(session, ids)
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
            "network_failed".to_string()
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

    Ok(Lyrics {
        synced,
        language: Some(parsed.lyrics.language).filter(|l| !l.is_empty()),
        lines,
    })
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

/// Las pistas de un álbum.
pub fn album_tracks(session: &Session, album_id: &str) -> Result<Vec<Track>, String> {
    context_tracks(session, format!("spotify:album:{album_id}"))
}

/// La ficha de un artista: quién es y qué canciones tiene.
///
/// **Sin la discografía, y no por falta de ganas.** El context de un artista
/// contesta con sus canciones —diecisiete páginas para uno chico— y con el
/// nombre en los metadatos, pero no hay ningún URI que devuelva sus álbumes:
/// `spotify:artist:{id}:albums` responde 404 y el buscador descarta el tipo. La
/// sección de álbumes queda vacía y la pantalla la esconde.
pub fn artist_profile(session: &Session, artist_id: &str) -> Result<ArtistProfile, String> {
    let owned = session.clone();
    let uri = format!("spotify:artist:{artist_id}");

    // One trip, not two. The context carries the name and the songs together, and
    // asking twice for the same answer is asking a question the app already has
    // the answer to.
    let (name, uris) = call(session, async move {
        owned
            .spclient()
            .get_context(&uri)
            .await
            .map(|context| {
                let name = context
                    .metadata
                    .get("context_description")
                    .cloned()
                    .unwrap_or_default();
                (name, context_uris(&context))
            })
            .map_err(|e| {
                log::error!("spclient: el context del artista falló: {e}");
                "network_failed".to_string()
            })
    })?;

    let tracks = hydrate(session, uris)?;

    // Un nombre inventado sería peor que un id: el id se puede copiar y buscar,
    // un nombre falso no.
    let name = if name.is_empty() {
        log::warn!("spclient: el context del artista vino sin nombre");
        artist_id.to_string()
    } else {
        name
    };

    Ok(ArtistProfile {
        artist: ArtistCard {
            id: artist_id.to_string(),
            name,
            images: Vec::new(),
        },
        albums: Vec::new(),
        tracks,
    })
}

// ---------------------------------------------------------------------------
// La sonda
// ---------------------------------------------------------------------------

/// `true` when the environment asks for the probe. Read once, at startup.
///
/// Separate from `STARLESS_DIAGNOSTIC` on purpose: that one plays a real track
/// for twenty seconds, and a question about the library does not need a song
/// playing on the developer's desk to be answered.
#[cfg(debug_assertions)]
pub fn requested() -> bool {
    std::env::var("STARLESS_SP_PROBE")
        .map(|value| value != "0" && !value.is_empty())
        .unwrap_or(false)
}

/// A second, narrower question: which context URIs exist at all.
#[cfg(debug_assertions)]
pub fn shapes_requested() -> bool {
    std::env::var("STARLESS_SP_SHAPES")
        .map(|value| value != "0" && !value.is_empty())
        .unwrap_or(false)
}

/// A third question, and the only one about an image: why do the account's own
/// playlists come back with no cover at all.
///
/// `get_rootlist` asks for a fixed set of decorations —revision, attributes,
/// length, owner, capabilities, status_code— and `picture` is not one of them.
/// Spotify's own playlists come back with `picture_size` filled anyway, which is
/// what made this look like a parsing bug for a while. A playlist without a cover
/// the owner uploaded has no URL of its own: the service builds one out of the
/// first four tracks, and that picture is exactly what the missing decoration
/// would have asked for.
#[cfg(debug_assertions)]
pub fn pictures_requested() -> bool {
    std::env::var("STARLESS_SP_PICTURE")
        .map(|value| value != "0" && !value.is_empty())
        .unwrap_or(false)
}

/// Corre el rootlist con decoraciones elegidas a mano y dice qué trae cada uno.
///
/// `SpClient::request` es público, así que la llamada se puede armar acá. No se
/// reescribe a ciegas el `get_rootlist` de librespot por esto: primero se mide si
/// la decoración devuelve URLs —que es lo que la pantalla necesita— o bytes
/// crudos, que obligarían a pasar imágenes por base64 a través del webview.
#[cfg(debug_assertions)]
fn rootlist_with(session: &Session, decorate: &str) -> Result<SelectedListContent, String> {
    // Two copies on purpose: one travels inside the future and one stays out here
    // to name the call in the log if the answer comes back in a shape we cannot
    // read. Moving the parameter itself would leave the outer error arm with
    // nothing to print.
    let tag = decorate.to_owned();
    let inside = tag.clone();
    let owned = session.clone();
    let body = call(session, async move {
        let user = owned.username().to_owned();
        let endpoint = format!(
            "/playlist/v2/user/{user}/rootlist?decorate={inside}&from=0&length={ROOTLIST_PAGE}"
        );
        owned
            .spclient()
            .request(&reqwest::Method::GET, &endpoint, None, None)
            .await
            .map_err(|e| {
                log::error!("SP_PICTURE: la llamada con `{inside}` falló: {e}");
                "network_failed".to_string()
            })
    })?;

    SelectedListContent::parse_from_bytes(&body).map_err(|e| {
        log::error!("SP_PICTURE: `{tag}` vino con otra forma: {e}");
        "bad_response".to_string()
    })
}

/// Una línea por playlist con las dos formas que puede traer una portada.
///
/// Se miden las dos porque contestan preguntas distintas: `bytes` dice si el
/// servicio mandó la imagen, `urls` dice si nos dio una dirección para bajarla.
/// Con las dos vacías, laplaylist no tiene ninguna de las dos y hay que buscar la
/// imagen por otro lado —por ejemplo, en la portada del primer disco que hay
/// adentro— en vez de inventar una.
#[cfg(debug_assertions)]
fn report_pictures(tag: &str, message: &SelectedListContent) {
    let contents = message.contents.get_or_default();
    log::info!(
        "SP_PICTURE: [{tag}] {} playlists, {} items",
        contents.meta_items.len(),
        contents.items.len()
    );

    for meta in &contents.meta_items {
        let attributes = meta.attributes.as_ref();
        let name = attributes
            .map(|a| a.name().to_owned())
            .unwrap_or_else(|| "(sin nombre)".to_owned());
        let bytes = attributes.map(|a| a.picture().len()).unwrap_or(0);
        let urls: Vec<String> = attributes
            .map(|a| {
                a.picture_size
                    .iter()
                    .map(|size| {
                        let url = size.url();
                        // La URL entera identifica la imagen y va a la red con el
                        // id de la cuenta abajo; con la firma dentro es una URL
                        // temporal y única, y no sirve para comparar dos llamadas.
                        let base = url.split('?').next().unwrap_or(url);
                        format!("{}/{}", size.target_name(), base)
                    })
                    .collect()
            })
            .unwrap_or_default();

        log::info!(
            "SP_PICTURE: [{tag}] {name:?} → picture={bytes} bytes, {} urls {:?}",
            urls.len(),
            urls
        );
    }
}

/// Lo que quedó después de que la decoración no siriera para nada.
///
/// `get_rootlist` pidió `picture` y volvió exactamente igual: 0 bytes, 0 URLs,
/// las seis playlists idénticas. Así que la respuesta no es una lista sin el
/// campo pedido, es una lista donde ese campo no existe para las playlists del
/// usuario — Spotify construye su portada como mosaico de las primeras cuatro
/// pistas y no lo manda en el rootlist. Quedan dos caminos y se prueban juntos:
/// el endpoint de una playlist, que es otra respuesta, y la metadata extendida
/// de la URI de la playlist, que es donde Spotify guarda los atributos v2.
#[cfg(debug_assertions)]
pub fn run_picture_probe(app: tauri::AppHandle) {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(session) = crate::selftest::wait_for_session(&app) else {
            log::error!("SP_PICTURE: la sesión no llegó a conectar");
            return;
        };

        log::info!("=== DIAGNOSTIC: sonda de portadas ===");

        match rootlist_with(&session, "revision,attributes,length,owner,capabilities,status_code") {
            Ok(message) => report_pictures("sin picture", &message),
            Err(e) => log::error!("SP_PICTURE: la línea base falló con {e}"),
        }

        match rootlist_with(&session, "revision,attributes,length,owner,capabilities,status_code,picture")
        {
            Ok(message) => report_pictures("con picture", &message),
            Err(e) => log::error!("SP_PICTURE: la llamada con `picture` falló con {e}"),
        }

        let Ok(library) = playlists(&session) else {
            log::error!("SP_PICTURE: no se pudo leer la biblioteca para seguir preguntando");
            return;
        };
        // Dos y sobra: la pregunta es "¿esta forma trae la imagen?", no "¿cada
        // playlist tiene imagen?".
        for playlist in library.iter().take(2) {
            probe_one_playlist(&session, &playlist.id, &playlist.name);
        }
    });
}

/// Un playlist por los dos caminos que quedan.
///
/// Los bytes se vuelcan como hexadecimal porque todavía no se sabe qué mensaje
/// son: el tamaño dice si hay algo, y los primeros bytes dicen cuál es. Volcar
/// un PNG o un JPEG entero al log sería una forma lenta de no volver a mirar.
#[cfg(debug_assertions)]
fn probe_one_playlist(session: &Session, playlist_id: &str, name: &str) {
    // Camino 1: el context de la playlist. Es la llamada que ya sabemos que
    // responde y que trae `image_url` para un álbum.
    probe_playlist_context(session, playlist_id, name);

    // Camino 2: metadata extendida, ahora con las extensiones que hablan de
    // imágenes.
    let request = BatchedEntityRequest {
        entity_request: PICTURE_KINDS
            .iter()
            .map(|kind| EntityRequest {
                entity_uri: format!("spotify:playlist:{playlist_id}"),
                query: vec![ExtensionQuery {
                    extension_kind: EnumOrUnknown::new(*kind),
                    ..Default::default()
                }],
                ..Default::default()
            })
            .collect(),
        ..Default::default()
    };

    let owned = session.clone();
    let outcome = call(session, async move {
        owned
            .spclient()
            .get_extended_metadata(request)
            .await
            .map_err(|e| format!("ERROR: {e}"))
    });

    let Ok(response) = outcome else {
        log::error!("SP_PICTURE: {name} → la metadata extendida falló");
        return;
    };

    let mut seen = 0;
    for array in response.extended_metadata {
        // La clase del extension va en el array, no en cada entrada: una
        // respuesta trae un array por clase pedida.
        let kind = array.extension_kind.enum_value_or_default();
        for entry in array.extension_data {
            let Some(payload) = entry.extension_data.as_ref() else {
                continue;
            };
            seen += 1;
            log::info!(
                "SP_PICTURE: {name} → extension {kind:?}, {} bytes, head={}",
                payload.value.len(),
                head_hex(&payload.value)
            );
        }
    }
    if seen == 0 {
        log::error!("SP_PICTURE: {name} → la metadata extendida volvió vacía");
    }
}

/// `get_playlist` con decoraciones elegidas a mano.
///
/// Las extensiones que tienen "imagen" en el nombre, y que no se habían probado.
///
/// El enum tiene 195 variantes y siete hablan de imágenes. Cuatro son de contenido
/// —thumbnail de video, carta con imagen— y tres podrían ser justo lo que se
/// busca: `COVER_IMAGE`, `ARTWORK_TRAIT` y `VISUAL_IDENTITY_TRAIT`, que es la que
/// Spotify usa hoy para las portadas de playlists y álbumes. Se prueban todas
/// juntas porque el costo es una sola llamada por playlist, y adivinar cuál es la
/// correcta sería volver a dejar un supuesto escrito como un hecho.
#[cfg(debug_assertions)]
const PICTURE_KINDS: [ExtensionKind; 7] = [
    ExtensionKind::COVER_IMAGE,
    ExtensionKind::ARTWORK_TRAIT,
    ExtensionKind::VISUAL_IDENTITY_TRAIT,
    ExtensionKind::LINK_CARD_WITH_IMAGE_TRAIT,
    ExtensionKind::IMAGE_CUE,
    ExtensionKind::IMAGE_SPARKLES_HACK,
    ExtensionKind::VIDEO_THUMBNAIL,
];

/// La pista más fuerte: el context de un álbum ya devolvió `image_url`.
///
/// `/context-resolve/v1/{uri}` es la misma llamada que sabemos que funciona —la
/// que trae las pistas de una playlist y las del artista— y para un álbum contesta
/// con un `image_url` en sus metadatos. Si para una playlist contesta lo mismo, la
/// foto original está ahí y no hay que dibujarla: viene hecha.
///
/// Se vuelca **todas** las claves y no las primeras seis, porque en una lista
/// truncada la que interesa puede ser la que quedó fuera, y volver a correr la
/// sonda por eso sería la forma más lenta de no mirar.
#[cfg(debug_assertions)]
fn probe_playlist_context(session: &Session, playlist_id: &str, name: &str) {
    let owned = session.clone();
    let uri = format!("spotify:playlist:{playlist_id}");
    let owned_uri = uri.clone();
    let outcome = call(session, async move {
        owned
            .spclient()
            .get_context(&owned_uri)
            .await
            .map(|context| context.metadata)
            .map_err(|e| format!("ERROR: {e}"))
    });

    match outcome {
        Ok(metadata) => {
            log::info!(
                "SP_PICTURE: context {name} → {} claves: {:?}",
                metadata.len(),
                metadata
            );
        }
        Err(e) => log::error!("SP_PICTURE: context {name} → {e}"),
    }
}

/// Los primeros bytes en hexadecimal, para reconocer un mensaje sin volcarlo.
///
/// Un PNG arranca con `89 50 4e 47` y un JPEG con `ff d8 ff`: si eso aparece, lo
/// que volvió es una imagen y no un protobuf, y la decisión es otra.
#[cfg(debug_assertions)]
fn head_hex(bytes: &[u8]) -> String {
    bytes
        .iter()
        .take(24)
        .map(|b| format!("{b:02x}"))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Resumen de un context, para comparar candidatos sin volcar el contenido.
#[cfg(debug_assertions)]
fn describe(context: &Context) -> String {
    let tracks: usize = context.pages.iter().map(|page| page.tracks.len()).sum();
    let meta: Vec<String> = context
        .metadata
        .iter()
        .take(6)
        .map(|(key, value)| format!("{key}={value}"))
        .collect();
    format!(
        "{} páginas, {} pistas, uri={:?}, metadata=[{}]",
        context.pages.len(),
        tracks,
        context.uri,
        meta.join(", ")
    )
}

/// Prueba una lista de URIs de context y dice qué devolvió cada una.
///
/// Lo que se busca acá no es una respuesta: es no dejar un uri sin probar escrito
/// en un comentario como si fuera una suposición. Cada candidato que vuelve con
/// páginas es un tipo que el servicio reconoce; cada uno que vuelve vacío es un
/// tipo que no existe, y también es un dato.
#[cfg(debug_assertions)]
fn probe_contexts(session: &Session, candidates: &[String]) {
    for candidate in candidates {
        let owned = session.clone();
        let uri = candidate.clone();
        let outcome = call(session, async move {
            owned
                .spclient()
                .get_context(&uri)
                .await
                .map(|context| describe(&context))
                .map_err(|e| format!("ERROR: {e}"))
        });

        match outcome {
            Ok(summary) => log::info!("SP_PROBE: context {candidate} → {summary}"),
            Err(e) => log::error!("SP_PROBE: context {candidate} → {e}"),
        }
    }
}

/// What this session can answer without a client id of Starless's own.
///
/// Development only. The answer decides whether the library moves off the Web
/// API, and it is worth one line in the log more than it is worth a screen.
#[cfg(debug_assertions)]
pub fn run_probe(app: tauri::AppHandle) {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(session) = crate::selftest::wait_for_session(&app) else {
            log::error!("SP_PROBE: la sesión no llegó a conectar");
            return;
        };
        probe(&session);
    });
}

#[cfg(debug_assertions)]
fn probe(session: &Session) {
    log::info!("=== DIAGNOSTIC: sonda de spclient ===");

    match account(session) {
        Ok(account) => log::info!(
            "SP_PROBE: cuenta {:?} con {} imagen",
            account.display_name,
            account.images.len()
        ),
        Err(e) => log::error!("SP_PROBE: la cuenta falló con {e}"),
    }

    let playlists = match playlists(session) {
        Ok(playlists) => {
            for playlist in &playlists {
                log::info!(
                    "SP_PROBE: {} = {:?} ({} canciones, {} portadas, {:?})",
                    playlist.id,
                    playlist.name,
                    playlist.tracks.as_ref().map(|t| t.total).unwrap_or(0),
                    playlist.images.len(),
                    playlist.owner.as_ref().and_then(|o| o.display_name.as_deref())
                );
            }
            playlists
        }
        Err(e) => {
            log::error!("SP_PROBE: la biblioteca falló con {e}");
            Vec::new()
        }
    };

    // The smallest playlist **that has songs**: an editorial playlist comes back
    // with a count of zero, and "it returned nothing" would look like a broken
    // decoder when what it really means is that there was nothing to decode.
    if let Some(smallest) = playlists
        .iter()
        .filter(|p| p.tracks.as_ref().is_some_and(|t| t.total > 0))
        .min_by_key(|p| p.tracks.as_ref().map(|t| t.total).unwrap_or(u32::MAX))
    {
        match playlist_tracks(session, &smallest.id) {
            Ok(tracks) => {
                log::info!("SP_PROBE: {:?} devolvió {} pistas", smallest.name, tracks.len());
                for track in tracks.iter().take(3) {
                    log::info!(
                        "SP_PROBE:   {:?} — {:?} {:?} — álbum {:?} — portada {:?}",
                        track.name,
                        track.duration_ms,
                        track.artists.iter().map(|a| a.name.as_str()).collect::<Vec<_>>(),
                        track.album.as_ref().map(|a| a.name.as_str()),
                        track
                            .album
                            .as_ref()
                            .and_then(|a| a.images.first())
                            .map(|i| &i.url)
                    );
                }
            }
            Err(e) => log::error!("SP_PROBE: el contenido de {:?} falló con {e}", smallest.name),
        }
    }

    match liked_tracks(session) {
        Ok(tracks) => log::info!("SP_PROBE: {} canciones guardadas", tracks.len()),
        Err(e) => log::error!("SP_PROBE: las guardadas fallaron con {e}"),
    }

    match search_tracks(session, "dua lipa") {
        Ok(tracks) => {
            log::info!("SP_PROBE: la búsqueda devolvió {} pistas", tracks.len());
            for track in tracks.iter().take(2) {
                log::info!("SP_PROBE:   {:?} por {:?}", track.name, track.artists);
            }
        }
        Err(e) => log::error!("SP_PROBE: la búsqueda falló con {e}"),
    }

    log::info!("=== DIAGNOSTIC: fin de la sonda de spclient ===");
}

/// Los otros tres tipos de la pantalla de resultados, y la ficha de un artista.
///
/// La pantalla de resultados quiere canciones, álbumes, artistas y playlists.
/// Las canciones salen de `spotify:search:`; qué URI contesta por cada uno de los
/// otros tres no está escrito en ninguna parte, y aqui se mide en vez de
/// suponerse. Los que vuelven con páginas son los que existen.
#[cfg(debug_assertions)]
pub fn run_shape_probe(app: tauri::AppHandle) {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(session) = crate::selftest::wait_for_session(&app) else {
            log::error!("SP_PROBE: la sesión no llegó a conectar");
            return;
        };

        // Un artista y un álbum que existen, tomados de lo que la biblioteca ya
        // trajo: un id inventado se vería igual que uno real hasta que no.
        let mut artist_id = "4Fl8dEtJlmvFkYb4HZr8Fi".to_string();
        let mut album_id = "0VjIjW4GlUZAMYd2vXMi3b".to_string();
        if let Ok(playlists) = playlists(&session)
            && let Some(track) = playlists
                .iter()
                .flat_map(|playlist| playlist_tracks(&session, &playlist.id).unwrap_or_default())
                .next()
        {
            if let Some(first_artist) = track.artists.first() {
                artist_id = first_artist.id.clone();
            }
            if let Some(album) = track.album.as_ref() {
                album_id = album.id.clone();
            }
        }
        log::info!("SP_PROBE: probando con artista {artist_id} y álbum {album_id}");

        // Con `+` y no con espacios: el parser de URIs rechaza el espacio antes
        // de llegar a mirar qué tipo se pidió, así que un candidato con espacios
        // no dice si el tipo existe — dice que la frase está mal escrita.
        probe_contexts(
            &session,
            &[
                format!("spotify:artist:{artist_id}"),
                format!("spotify:artist:{artist_id}:albums"),
                format!("spotify:search:dua+lipa:albums"),
                format!("spotify:search:albums:dua+lipa"),
                format!("spotify:search:dua+lipa:artists"),
                format!("spotify:search:artists:dua+lipa"),
                format!("spotify:search:dua+lipa:playlists"),
                format!("spotify:search:playlists:dua+lipa"),
                format!("spotify:search:album:dua+lipa"),
                format!("spotify:search:artist:dua+lipa"),
                format!("spotify:search:playlist:dua+lipa"),
            ],
        );

        log::info!("=== DIAGNOSTIC: fin de la sonda de formas ===");
    });
}

/// ¿Qué contenido personalized alcanza la sesión?
///
/// La biblioteca ya trae una playlist que Spotify fabricó para la cuenta —DJ—,
/// así que el servicio *sí* personalize por este canal. Lo que no se sabe es
/// cuánto. "Daily Mix", "Discover Weekly", "Release Radar" y las estaciones
/// distintas son del motor de recomendaciones, que vivía en la Web API; pero
/// antes de aceptar que no existe hay que haberlo probado, que es la diferencia
/// entre "no lo encontramos" y "no está".
///
/// Las candidatas usan las formas que Spotify usa para las suyas. Con `+` y sin
/// espacios, por la razón que ya está escrita más arriba: un uri mal escrito
/// contesta que la frase está mal, no que la cosa no exista.
#[cfg(debug_assertions)]
pub fn home_requested() -> bool {
    std::env::var("STARLESS_SP_HOME")
        .map(|value| value != "0" && !value.is_empty())
        .unwrap_or(false)
}

#[cfg(debug_assertions)]
pub fn run_home_probe(app: tauri::AppHandle) {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(session) = crate::selftest::wait_for_session(&app) else {
            log::error!("SP_HOME: la sesión no llegó a conectar");
            return;
        };

        log::info!("=== DIAGNOSTIC: sonda de contenido personalized ===");

        let Ok(account) = account(&session) else {
            log::error!("SP_HOME: sin cuenta, no hay nada personalized que probar");
            return;
        };
        let user = account.id.clone();

        let mut artist_id = "4Fl8dEtJlmvFkYb4HZr8Fi".to_string();
        if let Ok(playlists) = playlists(&session)
            && let Some(track) = playlists
                .iter()
                .flat_map(|playlist| playlist_tracks(&session, &playlist.id).unwrap_or_default())
                .next()
            && let Some(first_artist) = track.artists.first()
        {
            artist_id = first_artist.id.clone();
        }

        probe_contexts(
            &session,
            &[
                // La línea de control: se sabe que responde. Si esta falla, el
                // problema es la sonda y no la pregunta.
                format!("spotify:user:{user}:collection"),
                format!("spotify:user:{user}"),
                format!("spotify:user:{user}:daylims"),
                format!("spotify:user:{user}:daily"),
                format!("spotify:user:{user}:discover-weekly"),
                format!("spotify:user:{user}:discover"),
                format!("spotify:user:{user}:release-radar"),
                format!("spotify:user:{user}:stations"),
                format!("spotify:user:{user}:made-for-{user}"),
                format!("spotify:daily"),
                format!("spotify:discover:weekly"),
                format!("spotify:release-radar"),
                // Una estación por artista es lo más parecido a "Recommended
                // Stations" que se podría construir con lo propio.
                format!("spotify:artist:{artist_id}:radio"),
                format!("spotify:artist:{artist_id}:related"),
                format!("spotify:artist:{artist_id}:station"),
            ],
        );

        log::info!("=== DIAGNOSTIC: fin de la sonda de inicio ===");
    });
}