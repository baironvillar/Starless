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

use librespot_core::{FileId, Session, SpotifyId, SpotifyUri};
use librespot_metadata::{Metadata, Track as MetaTrack};
use librespot_protocol::context::Context;
use librespot_protocol::extended_metadata::{BatchedEntityRequest, EntityRequest, ExtensionQuery};
use librespot_protocol::extension_kind::ExtensionKind;
use librespot_protocol::metadata::Track as TrackMessage;
use librespot_protocol::playlist4_external::SelectedListContent;
use protobuf::{EnumOrUnknown, Message};

use crate::webapi::{Account, Album, Artist, Image, Playlist, Track, TrackTotal};

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

    Ok(contents
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
                    crate::webapi::Owner {
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
        .collect())
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