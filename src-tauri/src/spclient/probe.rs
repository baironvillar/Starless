//! La sonda: preguntas que sólo se responden escribiendo en el log.
//!
//! Estas funciones vivían dentro de `spclient.rs` y se movieron acá sin cambiar
//! una línea de sus cuerpos. Se fueron porque son la mitad del archivo y la
//! mitad no se compila en una release, y porque lo que cada bloque cuenta —por
//! qué el rootlist no trae portadas, qué formatos existen, dónde estaba la
//! puerta de escritura— ya está escrito en los comentarios que las anteceden.
//! Mover el código es una mudanza de archivo; los comentarios son el registro de
//! las horas que costó llegar a la respuesta, así que van con el código.
//!
//! Todo lo que usan del módulo padre es lectura: `call`, `ROOTLIST_PAGE` y las
//! lecturas de la biblioteca. Nada sale de la cuenta salvo lo que el nombre de
//! la función dice, y la puerta de desarrollo sigue siendo el `mod` de
//! `spclient.rs`, cerrado por `#[cfg(debug_assertions)]`: en release este archivo
//! ni siquiera existe.

use futures_util::StreamExt;
use librespot_core::dealer::protocol::PayloadValue;
use librespot_core::version::{SPOTIFY_MOBILE_VERSION, SPOTIFY_SEMANTIC_VERSION};
use librespot_core::{Session, SpotifyId, SpotifyUri};
use librespot_metadata::{Metadata, Track as MetaTrack};
use tauri::Manager;
use librespot_protocol::autoplay_context_request::AutoplayContextRequest;
use librespot_protocol::clienttoken_http::{
    ClientTokenRequest, ClientTokenRequestType, ClientTokenResponse, ClientTokenResponseType,
};
use librespot_protocol::context::Context;
use librespot_protocol::extended_metadata::{BatchedEntityRequest, EntityRequest, ExtensionQuery};
use librespot_protocol::extension_kind::ExtensionKind;
use librespot_protocol::playlist4_external::{
    Add, Item, ItemAttributes, ItemAttributesPartialState, ListChanges, Op, SelectedListContent,
    UpdateItemAttributes, op,
};
use protobuf::{Enum, EnumOrUnknown, Message, MessageField};

use super::{
    ROOTLIST_PAGE, account, call, delta, dj_mix, host_path, liked_tracks, now_millis, playlist_tracks,
    playlists, search_tracks, station_page,
};

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
fn probe_contexts(session: &Session, tag: &str, candidates: &[String]) {
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
            Ok(summary) => log::info!("{tag}: context {candidate} → {summary}"),
            Err(e) => log::error!("{tag}: context {candidate} → {e}"),
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
            "SP_SHAPES",
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

/// ¿Qué es, en realidad, la playlist que Spotify fabrica para la cuenta?
///
/// La del DJ —"DJ <nombre>"— es la única que hace preguntas nuevas: es la
/// única cuyo dueño es el propio Spotify, y la única cuyo contenido no es una
/// lista de canciones elegida por alguien sino una lista generada. Lo que se
/// quiere saber es qué trae de verdad: cuántas filas tiene el servicio, qué
/// clase de URI es cada una —una intro narrada no es una canción, y una fila
/// que no es una canción no se puede hidratar— y cuántas sobreviven.
///
/// Se pregunta junto con la biblioteca entera, porque el nombre solo no dice
/// nada: hace falta el dueño, el largo que dice el servicio y el largo que se
/// cuenta.
#[cfg(debug_assertions)]
pub fn dj_requested() -> bool {
    std::env::var("STARLESS_SP_DJ")
        .map(|value| value != "0" && !value.is_empty())
        .unwrap_or(false)
}

#[cfg(debug_assertions)]
pub fn run_dj_probe(app: tauri::AppHandle) {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(session) = crate::selftest::wait_for_session(&app) else {
            log::error!("SP_DJ: la sesión no llegó a conectar");
            return;
        };

        log::info!("=== DIAGNOSTIC: sonda de DJ ===");

        let Ok(library) = playlists(&session) else {
            log::error!("SP_DJ: no se pudo leer la biblioteca");
            return;
        };

        for playlist in &library {
            log::info!(
                "SP_DJ: {:?} · id={} · dueño={:?} · largo={:?}",
                playlist.name,
                playlist.id,
                playlist.owner.as_ref().and_then(|owner| owner.display_name.clone()),
                playlist.tracks.as_ref().map(|total| total.total),
            );
        }

        // La de Spotify: la única cuyo dueño no es la cuenta, y la que se
        // llama como el DJ. Se buscan por las dos condiciones porque ninguna
        // de las dos es una certeza: el dueño puede venir con otro nombre y
        // el nombre puede venir con otra forma.
        for playlist in library.iter().filter(|playlist| {
            let owner = playlist
                .owner
                .as_ref()
                .and_then(|owner| owner.display_name.as_deref());
            owner == Some("spotify") || playlist.name.to_lowercase().starts_with("dj")
        }) {
            log::info!("SP_DJ: ---- {:?} ----", playlist.name);

            match raw_playlist(&session, &playlist.id) {
                Ok(message) => {
                    let contents = message.contents.get_or_default();
                    log::info!(
                        "SP_DJ: el servicio dice {} items y {} meta_items",
                        contents.items.len(),
                        contents.meta_items.len()
                    );
                    for meta in &contents.meta_items {
                        let attributes = meta.attributes.as_ref();
                        log::info!(
                            "SP_DJ: meta_item · nombre={:?} · dueño={:?} · largo={}",
                            attributes.map(|a| a.name().to_owned()),
                            meta.owner_username(),
                            meta.length(),
                        );
                    }
                    for item in contents.items.iter().take(25) {
                        log::info!("SP_DJ:   item · {}", item.uri());
                    }
                }
                Err(error) => {
                    log::error!("SP_DJ: {:?} no se pudo pedir: {error}", playlist.name);
                }
            }

            match playlist_tracks(&session, &playlist.id) {
                Ok(tracks) => {
                    log::info!("SP_DJ: {:?} hidrató {} pistas", playlist.name, tracks.len());
                    for track in tracks.iter().take(5) {
                        log::info!("SP_DJ:   pista · {} — {}", track.name, track.id);
                    }
                }
                Err(error) => {
                    log::error!("SP_DJ: {:?} no se pudo hidratar: {error}", playlist.name);
                }
            }
        }

        // Y la otra mitad de la pregunta: si el DJ no fuera una playlist sino
        // un context —una forma que el servicio materializa al vuelo—, la
        // biblioteca sólo tendría su nombre. Se prueban las formas que Spotify
        // usa para las suyas y se anota cuáles contestan.
        let Ok(cuenta) = account(&session) else {
            log::error!("SP_DJ: sin cuenta no hay nada personalized que probar");
            return;
        };
        let user = cuenta.id.clone();
        let mut candidates = vec![
            format!("spotify:user:{user}:dj"),
            format!("spotify:dj:{user}"),
            format!("spotify:user:{user}:personalized:1"),
            format!("spotify:personalized:1"),
            format!("spotify:user:{user}:ai-dj"),
            format!("spotify:user:{user}:dj:1"),
            format!("spotify:user:{user}:collection:dj"),
        ];
        // Y la propia playlist del DJ, leída como context: es la misma pregunta
        // con otra puerta.
        for playlist in library
            .iter()
            .filter(|playlist| playlist.owner.as_ref().and_then(|o| o.display_name.as_deref()) == Some("spotify"))
        {
            candidates.push(format!("spotify:playlist:{}", playlist.id));
        }
        probe_contexts(&session, "SP_DJ", &candidates);

        // Y las dos preguntas que deciden si el DJ tiene contenido o no: qué
        // dice la página del context (su `next_page_url` es por donde se
        // sigue cuando la primera viene vacía) y qué contesta la puerta que la
        // propia metadata señalando.
        for playlist in library.iter().filter(|playlist| {
            playlist
                .owner
                .as_ref()
                .and_then(|owner| owner.display_name.as_deref())
                == Some("spotify")
        }) {
            // La sonda de la voz sola, para no gastar media hora midiendo lo
            // que ya está medido cuando lo que se busca es una puerta.
            if std::env::var("STARLESS_SP_TTS")
                .map(|value| value != "0" && !value.is_empty())
                .unwrap_or(false)
            {
                probe_client_token_domains(&session);
                probe_dj_tts(&session, &playlist.id);
                return;
            }

            probe_dj_context(&session, &playlist.id);
            probe_dj_session(&session, &playlist.id);
            probe_dj_tracks(&session, &playlist.id);
            probe_dj_next_page(&session, &playlist.id);
            probe_dj_station(&session, &playlist.id);
            probe_dj_freshness(&session, &playlist.id);
            let Ok(cuenta) = account(&session) else {
                log::error!("SP_DJ: sin cuenta no se puede probar otro contexto");
                return;
            };
            probe_dj_contexts(&session, &playlist.id, &cuenta.id);
            probe_dj_resume(&session, &playlist.id);
            probe_client_token_domains(&session);
            probe_dj_tts(&session, &playlist.id);
        }

        log::info!("=== DIAGNOSTIC: fin de la sonda de DJ ===");
    });
}

/// ¿La puerta de la radio?
///
/// **Lo que se midió primero y no era la puerta:** sembrar la sesión del DJ con
/// una canción (`context-resolve/v2/session` con `contextUri=spotify:track:…`)
/// contesta `500` — y también con un disco, con un artista y con una playlist
/// común. La puerta del DJ sólo sirve para el DJ: es el servicio de las
/// "jellyfish cards", no el de las radios.
///
/// **Las radios tienen otras dos puertas, y las dos son de Spotify:**
///
/// - `POST /context-resolve/v1/autoplay` — el autoplay: el contexto que se
///   estaba escuchando y las canciones recientes. El proto dice
///   `context_uri` + `recent_track_uri`, y está extraído del cliente oficial.
/// - `GET /inspiredby-mix/v2/seed_to_playlist/spotify:track:<id>` — la radio de
///   una canción: "inspirada en" esa canción.
///
/// Se miden las dos, con la forma exacta que usaría la app, y se anota lo que
/// importa: cuántas canciones traen, si la semilla está entre ellas —si está,
/// la radio repite la canción que la sembró— y si hay cursor para seguir.
#[cfg(debug_assertions)]
pub fn radio_requested() -> bool {
    std::env::var("STARLESS_SP_RADIO")
        .map(|value| value != "0" && !value.is_empty())
        .unwrap_or(false)
}

/// El autoplay: la puerta con el contexto y las canciones recientes.
#[cfg(debug_assertions)]
pub(super) fn probe_autoplay(session: &Session, context_uri: &str, recent: &[String]) {
    let request = AutoplayContextRequest {
        context_uri: Some(context_uri.to_owned()),
        recent_track_uri: recent.to_vec(),
        is_video: Some(false),
        special_fields: Default::default(),
    };
    let owned = session.clone();
    let outcome = call(session, async move {
        owned
            .spclient()
            .get_autoplay_context(&request)
            .await
            .map_err(|e| format!("ERROR: {e}"))
    });

    match outcome {
        Ok(context) => {
            let mut total = 0usize;
            for page in &context.pages {
                log::info!(
                    "SP_RADIO: autoplay de {context_uri} → página con {} canciones · cursor={:?}",
                    page.tracks.len(),
                    page.next_page_url.as_deref().map(|url| &url[..url.len().min(100)])
                );
                for track in page.tracks.iter().take(12) {
                    total += 1;
                    log::info!("SP_RADIO:   autoplay · {:?}", track.uri);
                }
                // **La página siguiente es lo que distingue una estación de una
                // lista de cincuenta.** Sin esto, la música se corta a los fifty.
                if let Some(next) = page.next_page_url.as_deref() {
                    probe_station_next(session, next);
                }
            }
            log::info!("SP_RADIO: el autoplay trajo {total} canciones");
        }
        Err(error) => log::error!("SP_RADIO: autoplay de {context_uri} → {error}"),
    }
}

/// La página siguiente de la estación: el cursor que devolvió el autoplay.
///
/// **El cursor es un `hm://`**: es el nombre interno del servicio, y en el host
/// de Spotify lo que existe es el path. Es la misma traducción que hace el DJ.
#[cfg(debug_assertions)]
fn probe_station_next(session: &Session, next: &str) {
    let path = host_path(next);
    log::info!("SP_RADIO: la página siguiente → {path}");
    let owned = session.clone();
    let endpoint = path.clone();
    let outcome = call(session, async move {
        owned
            .spclient()
            .request(&reqwest::Method::GET, &endpoint, None, None)
            .await
            .map(|body| {
                let text = String::from_utf8_lossy(&body).to_string();
                (body.len(), text)
            })
            .map_err(|e| format!("ERROR: {e}"))
    });

    match outcome {
        Ok((len, text)) => {
            log::info!("SP_RADIO: la página siguiente vino en {len} bytes");
            log::info!(
                "SP_RADIO:   forma → {}",
                text.chars().take(700).collect::<String>()
            );
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                log::info!(
                    "SP_RADIO:   claves → {:?}",
                    json.as_object()
                        .map(|map| map.keys().cloned().collect::<Vec<String>>())
                );
            }
        }
        Err(error) => log::error!("SP_RADIO: la página siguiente no vino: {error}"),
    }
}

/// La radio de una canción: la puerta "inspirada en".
#[cfg(debug_assertions)]
fn probe_song_radio(session: &Session, track_id: &str) {
    let uri = format!("spotify:track:{track_id}");
    let Ok(parsed) = SpotifyUri::from_uri(&uri) else {
        log::error!("SP_RADIO: la uri {uri} no se pudo leer");
        return;
    };
    let owned = session.clone();
    let outcome = call(session, async move {
        owned
            .spclient()
            .get_radio_for_track(&parsed)
            .await
            .map(|body| {
                let text = String::from_utf8_lossy(&body).to_string();
                (body.len(), text)
            })
            .map_err(|e| format!("ERROR: {e}"))
    });

    match outcome {
        Ok((len, text)) => {
            log::info!("SP_RADIO: radio de {uri} → {len} bytes");
            log::info!(
                "SP_RADIO:   forma → {}",
                text.chars().take(900).collect::<String>()
            );
            // Si viene como JSON, las canciones están en un lugar reconocible: se
            // buscan por nombre de campo en vez de suponer la forma.
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                log::info!(
                    "SP_RADIO:   claves → {:?}",
                    json.as_object()
                        .map(|map| map.keys().cloned().collect::<Vec<String>>())
                );
                for key in ["tracks", "items", "page", "pages"] {
                    let Some(list) = json.get(key) else {
                        continue;
                    };
                    let Some(list) = list.as_array() else {
                        continue;
                    };
                    log::info!("SP_RADIO:   '{key}' trae {} filas", list.len());
                    for row in list.iter().take(12) {
                        let uri = row
                            .get("uri")
                            .and_then(|value| value.as_str())
                            .unwrap_or("(sin uri)");
                        log::info!("SP_RADIO:   {key} · {uri}");
                    }
                }
            }
        }
        Err(error) => log::error!("SP_RADIO: radio de {uri} → {error}"),
    }
}

/// La radio medida, de punta a punta.
#[cfg(debug_assertions)]
pub fn run_radio_probe(app: tauri::AppHandle) {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(session) = crate::selftest::wait_for_session(&app) else {
            log::error!("SP_RADIO: la sesión no llegó a conectar");
            return;
        };
        log::info!("=== DIAGNOSTIC: sonda de radio ===");

        let Ok(library) = playlists(&session) else {
            log::error!("SP_RADIO: no se pudo leer la biblioteca");
            return;
        };

        // Una playlist que no sea del DJ: su primera canción sirve de semilla, y
        // la playlist misma es el contexto del autoplay.
        let mut seed: Option<crate::models::Track> = None;
        let mut playlist_id: Option<String> = None;
        let mut dj_id: Option<String> = None;
        for playlist in &library {
            let owner = playlist
                .owner
                .as_ref()
                .and_then(|owner| owner.display_name.as_deref());
            if owner == Some("spotify") {
                dj_id.get_or_insert(playlist.id.clone());
                continue;
            }
            if seed.is_some() {
                continue;
            }
            let Ok(tracks) = playlist_tracks(&session, &playlist.id) else {
                continue;
            };
            if let Some(first) = tracks.first() {
                log::info!(
                    "SP_RADIO: semilla {:?} ({}) de la playlist {:?}",
                    first.name, first.id, playlist.name
                );
                seed = Some(first.clone());
                playlist_id = Some(playlist.id.clone());
            }
        }

        let Some(seed) = seed else {
            log::error!("SP_RADIO: no hay ninguna canción con la que sembrar");
            return;
        };
        let seed_uri = format!("spotify:track:{}", seed.id);

        // **El control:** la puerta del DJ, con la playlist del DJ. Si esto
        // tampoco contesta, el problema no es el contexto sino la puerta.
        if let Some(id) = dj_id.clone() {
            match dj_mix(&session, &id) {
                Ok(page) => log::info!(
                    "SP_RADIO: control · el DJ contesta con {} canciones",
                    page.mix.tracks.len()
                ),
                Err(error) => log::error!("SP_RADIO: control · el DJ no contestó: {error}"),
            }
        } else {
            log::info!("SP_RADIO: control · la cuenta no tiene DJ");
        }

        // Las dos puertas de la radio.
        if let Some(id) = playlist_id.clone() {
            probe_autoplay(
                &session,
                &format!("spotify:playlist:{id}"),
                std::slice::from_ref(&seed_uri),
            );
        }
        probe_autoplay(&session, &seed_uri, std::slice::from_ref(&seed_uri));
        probe_song_radio(&session, &seed.id);

        log::info!("=== DIAGNOSTIC: fin de la sonda de radio ===");
    });
}

/// ¿El primer pedido puede decir "seguí después de este segmento"?
///
/// **Lo que se midió antes:** el primer pedido siempre vuelve al principio de la
/// misma línea de tiempo —la misma primera canción, y la lista crece porque la
/// sesión crece— y el único camino a material nuevo es el cursor. Los otros
/// contextos dan 500.
///
/// Falta una forma: el cursor del servicio es `/session/0000…?previousSegmentId=…`,
/// con un id de segmento **concreto** y un `requestId`. La pregunta es si el
/// *primer* pedido —sin cursor— puede llevar un segmento concreto y pedir "seguí
/// después de este". Si puede, el DJ se puede reiniciar con songs nuevas; si no,
/// sólo hay una forma: seguir la sesión.
///
/// Se comparan las primeras canciones de: el primer pedido de siempre, el
/// primero con el segmento de la página que ya se oyó, y el primero con el
/// segmento que el cursor-annunció.
#[cfg(debug_assertions)]
fn probe_dj_resume(session: &Session, playlist_id: &str) {
    let context_uri = format!("spotify:playlist:{playlist_id}");
    let first_path =
        format!("/lexicon-session-provider/context-resolve/v2/session?contextUri={context_uri}");

    // El primer pedido, para tener un segmento real y un cursor.
    let Some(page) = dj_first_page(session, &first_path) else {
        log::error!("SP_DJ: [resume] el primer pedido no vino");
        return;
    };
    let segment = page.segment.clone();
    log::info!(
        "SP_DJ: [resume] la primera página: {} canciones · segmento={segment} · primeras={:?}",
        page.count,
        page.first
    );
    let cursor_segment = page.next_segment.clone();
    log::info!("SP_DJ: [resume] el cursor apunta a {cursor_segment}");

    let shapes: Vec<(&str, String)> = vec![
        (
            "el primero, con el segmento que ya se oyó",
            format!(
                "/lexicon-session-provider/context-resolve/v2/session/00000000000000000000000000000000?contextUri={context_uri}&previousSegmentId={segment}"
            ),
        ),
        (
            "el primero, con el segmento que sigue",
            format!(
                "/lexicon-session-provider/context-resolve/v2/session/00000000000000000000000000000000?contextUri={context_uri}&previousSegmentId={cursor_segment}"
            ),
        ),
        (
            "el primero, con el cursor entero",
            format!("/lexicon-session-provider/context-resolve/v2/session/00000000000000000000000000000000?contextUri={context_uri}&previousSegmentId={segment}&requestId=cc11dd22ee33ff44005566778899aabb"),
        ),
        (
            "con el comodín y el path de sesión",
            format!("/lexicon-session-provider/context-resolve/v2/session/00000000000000000000000000000000?contextUri={context_uri}&previousSegmentId=XX-Segment-XXXXX"),
        ),
        (
            "con el comodín y el path de sesión, con requestId",
            format!("/lexicon-session-provider/context-resolve/v2/session/00000000000000000000000000000000?contextUri={context_uri}&previousSegmentId=XX-Segment-XXXXX&requestId=dd11ee22ff33aa4400556677889900bb"),
        ),
        (
            "con el path de sesión y nada más",
            format!("/lexicon-session-provider/context-resolve/v2/session/00000000000000000000000000000000?contextUri={context_uri}"),
        ),
    ];

    for (label, path) in shapes {
        let Some(page) = dj_first_page(session, &path) else {
            log::error!("SP_DJ: [resume] {label} no vino");
            continue;
        };
        log::info!(
            "SP_DJ: [resume] {label} · {} canciones · segmento={} · primeras={:?} · el cursor apunta a {}",
            page.count,
            page.segment,
            page.first,
            page.next_segment
        );
        std::thread::sleep(std::time::Duration::from_secs(2));
    }

    // Y la pregunta que decide: ¿la forma con los ceros *avanza* entre pedidos,
    // o devuelve siempre las mismas cinco? Si avanza, un click nuevo sobre el
    // DJ trae canciones nuevas, que es lo que hace el cliente de Spotify.
    for round in 0..2 {
        for (label, path) in [
            (
                "la forma de la app",
                format!("/lexicon-session-provider/context-resolve/v2/session?contextUri={context_uri}"),
            ),
            (
                "la forma con los ceros",
                format!("/lexicon-session-provider/context-resolve/v2/session/00000000000000000000000000000000?contextUri={context_uri}"),
            ),
        ] {
            let Some(page) = dj_first_page(session, &path) else {
                log::error!("SP_DJ: [avanza] {label} no vino");
                continue;
            };
            log::info!(
                "SP_DJ: [avanza] {label} · ronda {round} · {} canciones · primeras={:?}",
                page.count,
                page.first
            );
            std::thread::sleep(std::time::Duration::from_secs(4));
        }
    }
}

/// Lo que dice una respuesta del DJ: de qué segmento es, cuáles son sus
/// primeras canciones, cuántas trae y por dónde sigue.
struct DjPage {
    segment: String,
    first: Vec<String>,
    count: usize,
    next_segment: String,
}

/// El primer pedido de una forma, dicho de la manera más corta.
#[cfg(debug_assertions)]
fn dj_first_page(session: &Session, path: &str) -> Option<DjPage> {
    let owned = session.clone();
    let endpoint = path.to_owned();
    let outcome = call(session, async move {
        owned
            .spclient()
            .request(&reqwest::Method::GET, &endpoint, None, None)
            .await
            .map_err(|e| format!("ERROR: {e}"))
    });
    let body = match outcome {
        Ok(body) => body,
        Err(e) => {
            log::error!("SP_DJ: {path} → {e}");
            return None;
        }
    };
    let Ok(json) = serde_json::from_slice::<serde_json::Value>(&body) else {
        log::error!("SP_DJ: {path} no es JSON");
        return None;
    };

    let mut rows: Vec<&serde_json::Value> = json
        .get("tracks")
        .and_then(|value| value.as_array())
        .map(|list| list.iter().collect())
        .unwrap_or_default();
    if rows.is_empty() {
        if let Some(pages) = json.get("pages").and_then(|value| value.as_array()) {
            for page in pages {
                if let Some(list) = page.get("tracks").and_then(|value| value.as_array()) {
                    rows.extend(list.iter());
                }
            }
        }
    }

    let first: Vec<String> = rows
        .iter()
        .take(3)
        .map(|track| {
            track
                .get("uri")
                .and_then(|value| value.as_str())
                .unwrap_or("?")
                .to_owned()
        })
        .collect();
    let segment = rows
        .first()
        .and_then(|track| track.get("metadata"))
        .and_then(|meta| meta.get("segment"))
        .and_then(|value| value.as_str())
        .unwrap_or("?")
        .to_owned();
    let next = json
        .get("pages")
        .and_then(|value| value.as_array())
        .and_then(|pages| pages.first())
        .and_then(|page| page.get("next_page_url"))
        .and_then(|value| value.as_str())
        .or_else(|| json.get("next_page_url").and_then(|value| value.as_str()))
        .unwrap_or("");
    let next_segment = next
        .split("previousSegmentId=")
        .nth(1)
        .and_then(|rest| rest.split('&').next())
        .unwrap_or("?")
        .to_owned();

    Some(DjPage {
        segment,
        first,
        count: rows.len(),
        next_segment,
    })
}

/// ¿Hay alguna puerta que dé un mix **distinto** al mismo DJ?
///
/// **Lo que se midió primero es que el mismo pedido da el mismo mix.** Cinco
/// pedidos seguidos —la forma de la app, la forma de la app otra vez, con
/// `requestId`, con `previousSegmentId`, y con los dos— devolvieron las mismas
/// cuarenta canciones, el mismo segmento y los mismos cuatro primeros ids. El
/// servicio no varyó: `salt` distinto, mismo set. Así que la pregunta no es
/// "cómo variar el pedido" sino "hay otro pedido que sea otro DJ".
///
/// Se prueban las contextos que la propia metadata del DJ sugiere
/// (`lexicon_set_type: your_dj`, `agentic_product_type: dj`) contra la misma
/// puerta, y la página siguiente de la sesión, que es lo único que se sabe que
/// avanza. Cada respuesta dice cuántas canciones trajo, de qué segmento son y
/// cuáles son las dos primeras: si dos contextos dan sets distintos, la puerta
/// del DJ es una de ellas y la otra es un DJ distinto.
#[cfg(debug_assertions)]
fn probe_dj_contexts(session: &Session, playlist_id: &str, user_id: &str) {
    let candidates = vec![
        format!("spotify:playlist:{playlist_id}"),
        format!("spotify:user:{user_id}:dj"),
        format!("spotify:dj:{user_id}"),
        format!("spotify:user:{user_id}:ai-dj"),
        format!("spotify:user:{user_id}:collection:dj"),
        format!("spotify:playlist:{playlist_id}?nd=1"),
    ];

    for context in candidates {
        let path = format!(
            "/lexicon-session-provider/context-resolve/v2/session?contextUri={context}"
        );
        let owned = session.clone();
        let endpoint = path.clone();
        let outcome = call(session, async move {
            owned
                .spclient()
                .request(&reqwest::Method::GET, &endpoint, None, None)
                .await
                .map_err(|e| format!("ERROR: {e}"))
        });
        let body = match outcome {
            Ok(body) => body,
            Err(e) => {
                log::error!("SP_DJ: [ctx {context}] → {e}");
                continue;
            }
        };
        let Ok(json) = serde_json::from_slice::<serde_json::Value>(&body) else {
            log::error!("SP_DJ: [ctx {context}] la respuesta no es JSON");
            continue;
        };

        let mut rows: Vec<&serde_json::Value> = json
            .get("tracks")
            .and_then(|value| value.as_array())
            .map(|list| list.iter().collect())
            .unwrap_or_default();
        if rows.is_empty() {
            if let Some(pages) = json.get("pages").and_then(|value| value.as_array()) {
                for page in pages {
                    if let Some(list) = page.get("tracks").and_then(|value| value.as_array()) {
                        rows.extend(list.iter());
                    }
                }
            }
        }
        let first: Vec<String> = rows
            .iter()
            .take(2)
            .map(|track| {
                track
                    .get("uri")
                    .and_then(|value| value.as_str())
                    .unwrap_or("?")
                    .to_owned()
            })
            .collect();
        let segment = rows
            .first()
            .and_then(|track| track.get("metadata"))
            .and_then(|meta| meta.get("segment"))
            .and_then(|value| value.as_str())
            .unwrap_or("?")
            .to_owned();
        let set_type = json
            .get("metadata")
            .and_then(|meta| meta.get("lexicon_set_type"))
            .and_then(|value| value.as_str())
            .unwrap_or("?");
        let next = json
            .get("pages")
            .and_then(|value| value.as_array())
            .and_then(|pages| pages.first())
            .and_then(|page| page.get("next_page_url"))
            .and_then(|value| value.as_str())
            .or_else(|| {
                json.get("next_page_url")
                    .and_then(|value| value.as_str())
            })
            .unwrap_or("?")
            .to_owned();

        log::info!(
            "SP_DJ: [ctx {context}] {} canciones · set={set_type} · segmento={segment} · primeras={first:?}",
            rows.len()
        );
        log::info!("SP_DJ: [ctx {context}] siguiente={next}");
        std::thread::sleep(std::time::Duration::from_secs(2));
    }
}

/// ¿El DJ da un mix distinto cada vez que se lo pide?
///
/// **La pregunta es del usuario, y la respuesta no puede ser una opinión.** En el
/// cliente de Spotify, tocar el DJ otra vez suena otra cosa; en esta app, dos
/// clicks seguidos tame la misma primera canción. Eso puede ser del servicio —que
/// su set cambie por hora y no por pedido— o puede ser nuestro: que el pedido no
/// lleve lo que lo hace único.
///
/// La diferencia entre las dos hipótesis se mide con los mismos ids. Se pide el
/// mix varias veces con la forma que usa la app, y una vez por cada forma extra
/// que el propio protocolo sugiere —el `requestId` que el servicio se devuelve a
/// sí mismo, y el `previousSegmentId` de comodín— y se comparan las primeras
/// canciones de cada respuesta y el segmento del que salen.
///
/// El segmento es el dato que decide: si dos respuestas traen el mismo segmento,
/// el servicio está sirviendo la misma tanda; si traen distinto, el set avanza y
/// lo que hay que arreglar es cómo se pide.
#[cfg(debug_assertions)]
fn probe_dj_freshness(session: &Session, playlist_id: &str) {
    let context_uri = format!("spotify:playlist:{playlist_id}");
    let base = format!("/lexicon-session-provider/context-resolve/v2/session?contextUri={context_uri}");

    // Cada forma con un `requestId` distinto: si el servicio usa ese id para
    // decidir qué sesión abrir, un id nuevo tiene que abrir otra.
    let shapes: Vec<(&str, String)> = vec![
        ("la app, primera vez", base.clone()),
        ("la app, otra vez", base.clone()),
        (
            "con requestId",
            format!("{base}&requestId=aa11bb22cc33dd44ee55ff6600778899"),
        ),
        (
            "con previousSegmentId",
            format!("{base}&previousSegmentId=XX-Segment-XXXXX"),
        ),
        (
            "con los dos",
            format!("{base}&requestId=bb11cc22dd33ee44ff550066778899aa&previousSegmentId=XX-Segment-XXXXX"),
        ),
    ];

    for (label, path) in shapes {
        let owned = session.clone();
        let endpoint = path.clone();
        let outcome = call(session, async move {
            owned
                .spclient()
                .request(&reqwest::Method::GET, &endpoint, None, None)
                .await
                .map_err(|e| format!("ERROR: {e}"))
        });
        let body = match outcome {
            Ok(body) => body,
            Err(e) => {
                log::error!("SP_DJ: [{label}] {path} → {e}");
                continue;
            }
        };
        let Ok(json) = serde_json::from_slice::<serde_json::Value>(&body) else {
            log::error!("SP_DJ: [{label}] la respuesta no es JSON");
            continue;
        };

        // Las canciones: en la raíz o dentro de una página. Las dos formas
        // existen, y leer sólo una hace que la página parezca vacía.
        let mut rows: Vec<&serde_json::Value> = json
            .get("tracks")
            .and_then(|value| value.as_array())
            .map(|list| list.iter().collect())
            .unwrap_or_default();
        if rows.is_empty() {
            if let Some(pages) = json.get("pages").and_then(|value| value.as_array()) {
                for page in pages {
                    if let Some(list) = page.get("tracks").and_then(|value| value.as_array()) {
                        rows.extend(list.iter());
                    }
                }
            }
        }

        let first: Vec<String> = rows
            .iter()
            .take(4)
            .map(|track| {
                track
                    .get("uri")
                    .and_then(|value| value.as_str())
                    .unwrap_or("?")
                    .to_owned()
            })
            .collect();
        let segment = rows
            .first()
            .and_then(|track| track.get("metadata"))
            .and_then(|meta| meta.get("segment"))
            .and_then(|value| value.as_str())
            .unwrap_or("?")
            .to_owned();
        let meta = json.get("metadata");
        let current = meta
            .and_then(|meta| meta.get("lexicon_current_time"))
            .and_then(|value| value.as_str())
            .unwrap_or("?");
        let expiration = meta
            .and_then(|meta| meta.get("lexicon_expiration_time"))
            .and_then(|value| value.as_str())
            .unwrap_or("?");
        let next = json
            .get("next_page_url")
            .and_then(|value| value.as_str())
            .unwrap_or("?");

        log::info!(
            "SP_DJ: [{label}] {} canciones · segmento={segment} · now={current} · vence={expiration}",
            rows.len()
        );
        log::info!("SP_DJ: [{label}] primeras={first:?}");
        log::info!("SP_DJ: [{label}] siguiente={next}");

        // Entre pedidos: dos pedidos pegados son dos pedidos al mismo tiempo, y
        // lo que se quiere medir es si el servicio varyó entre ellos.
        std::thread::sleep(std::time::Duration::from_secs(3));
    }
}

/// El context del DJ, con las tres cosas que el resumen no mostraba: la url
/// del context, si está cargando, y la página con su `next_page_url`.
///
/// Una página vacía no es una página sin contenido: es una página que dice
/// por dónde seguir. Por eso esto se pregunta antes de decir que no hay nada.
#[cfg(debug_assertions)]
fn probe_dj_context(session: &Session, playlist_id: &str) {
    let owned = session.clone();
    let uri = format!("spotify:playlist:{playlist_id}");
    let label = uri.clone();
    let outcome = call(session, async move {
        owned
            .spclient()
            .get_context(&uri)
            .await
            .map(|context| {
                let mut lines = vec![
                    format!("url={:?}", context.url),
                    format!("loading={:?}", context.loading),
                ];
                for (index, page) in context.pages.iter().enumerate() {
                    lines.push(format!(
                        "page {index}: page_url={:?} next_page_url={:?} loading={:?} \
                         tracks={} metadata={:?}",
                        page.page_url,
                        page.next_page_url,
                        page.loading,
                        page.tracks.len(),
                        page.metadata,
                    ));
                }
                lines.join(" | ")
            })
            .map_err(|e| format!("ERROR: {e}"))
    });

    match outcome {
        Ok(summary) => log::info!("SP_DJ: context {label} → {summary}"),
        Err(e) => log::error!("SP_DJ: context {label} → {e}"),
    }
}

/// La sesión del DJ, con sus pistas.
///
/// La respuesta es un Context en JSON —el mismo tipo que devuelve
/// `/context-resolve/v1`, con más campos— y cada pista trae su uri y un mapa
/// de metadata con el nombre, los artistas y el álbum.
///
/// Se lee a mano con `serde_json` y no con el tipo del protocolo porque lo que
/// hace falta son dos cosas: cuántas pistas trae y qué uri tienen. Y porque
/// una respuesta que no se puede leer no es una respuesta: si el JSON cambia
/// de forma, el probe dice que no lo pudo leer en vez de mostrar una lista
/// vacía que parece lo mismo que un DJ sin contenido.
#[cfg(debug_assertions)]
fn probe_dj_tracks(session: &Session, playlist_id: &str) {
    let context_uri = format!("spotify:playlist:{playlist_id}");
    let path = format!("/lexicon-session-provider/context-resolve/v2/session?contextUri={context_uri}");

    let owned = session.clone();
    let endpoint = path.clone();
    let outcome = call(session, async move {
        owned
            .spclient()
            .request(&reqwest::Method::GET, &endpoint, None, None)
            .await
            .map_err(|e| format!("ERROR: {e}"))
    });

    let body = match outcome {
        Ok(body) => body,
        Err(e) => {
            log::error!("SP_DJ: {path} → {e}");
            return;
        }
    };

    let Ok(json) = serde_json::from_slice::<serde_json::Value>(&body) else {
        log::error!(
            "SP_DJ: la respuesta no es JSON ({} bytes): {}",
            body.len(),
            String::from_utf8_lossy(&body).chars().take(200).collect::<String>()
        );
        return;
    };

    if let Some(metadata) = json.get("metadata").and_then(|value| value.as_object()) {
        for (key, value) in metadata {
            log::info!("SP_DJ: meta {key} = {value}");
        }
    }

    let pages = json
        .get("pages")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    log::info!("SP_DJ: {} páginas", pages.len());

    for (index, page) in pages.iter().enumerate() {
        let tracks = page
            .get("tracks")
            .and_then(|value| value.as_array())
            .cloned()
            .unwrap_or_default();
        log::info!("SP_DJ: página {index}: {} pistas", tracks.len());
        if let Some(next) = page.get("next_page_url").and_then(|value| value.as_str()) {
            log::info!("SP_DJ: página {index}: next_page_url = {next}");
        }
        for (position, track) in tracks.iter().enumerate() {
            let uri = track.get("uri").and_then(|value| value.as_str()).unwrap_or("?");
            let metadata = track.get("metadata").and_then(|value| value.as_object());
            // El mapa entero, las primeras: son las llaves las que dicen cómo
            // se llama una pista acá, y adivinar el nombre de la llave es
            // adivinar el dato.
            if position < 3 {
                log::info!("SP_DJ:   {uri} · {metadata:?}");
            } else {
                log::info!("SP_DJ:   {uri}");
            }
        }

        // Y la pregunta que decide si el DJ **suena** o sólo se ve: ¿estas
        // pistas resuelven como pistas?
        //
        // La lista se arma con una metadata y el player pide otra, y una
        // pista que aparece en la lista pero no se puede pedir es la peor de
        // las dos: la app la muestra, el usuario la elige, y el player
        // contesta que no. La intro del DJ es el caso dudoso —es una pista
        // generada, no una del catálogo— así que se pregunta antes de
        // prometer nada.
        for track in tracks.iter().take(3) {
            let Some(uri) = track.get("uri").and_then(|value| value.as_str()) else {
                continue;
            };
            let Ok(parsed) = SpotifyUri::from_uri(uri) else {
                log::error!("SP_DJ: {uri} no es una uri que se entienda");
                continue;
            };
            let owned = session.clone();
            let outcome = call(session, async move {
                MetaTrack::get(&owned, &parsed)
                    .await
                    .map(|track| {
                        format!(
                            "{} · {} ms · {} archivos · artistas={:?}",
                            track.name,
                            track.duration,
                            track.files.len(),
                            track.artists,
                        )
                    })
                    .map_err(|e| format!("ERROR: {e}"))
            });
            match outcome {
                Ok(summary) => log::info!("SP_DJ: metadata de {uri} → {summary}"),
                Err(e) => log::error!("SP_DJ: metadata de {uri} → {e}"),
            }
        }
    }
}

/// La puerta que la propia metadata del DJ señalaba.
///
/// `lexicon_context_url=hm://lexicon-session-provider/context-resolve/v2/session?contextUri=…`
///
/// El `hm://` es el nombre interno del servicio, no una URL que se pueda
/// pedir. Lo que se prueba es si el mismo path —con la versión 2 y el
/// `contextUri` como parámetro— contesta en el host de Spotify, que es donde
/// se puede pedir algo sin inventarse un cliente.
///
/// Se prueban las tres formas del path porque la diferencia entre "no existe"
/// y "no lo encontré" es justo lo que esta sonda existe para no confundir.
#[cfg(debug_assertions)]
fn probe_dj_session(session: &Session, playlist_id: &str) {
    let context_uri = format!("spotify:playlist:{playlist_id}");
    let paths = [
        format!("/context-resolve/v2/session?contextUri={context_uri}"),
        format!("/lexicon-session-provider/context-resolve/v2/session?contextUri={context_uri}"),
        format!("/context-resolve/v2/session?contextUri={context_uri}&page=0"),
    ];

    for path in paths {
        let owned = session.clone();
        let endpoint = path.clone();
        let outcome = call(session, async move {
            owned
                .spclient()
                .request(&reqwest::Method::GET, &endpoint, None, None)
                .await
                .map(|body| {
                    let text = String::from_utf8_lossy(&body);
                    format!(
                        "{} bytes · {}",
                        body.len(),
                        text.chars().take(400).collect::<String>()
                    )
                })
                .map_err(|e| format!("ERROR: {e}"))
        });

        match outcome {
            Ok(summary) => log::info!("SP_DJ: GET {path} → {summary}"),
            Err(e) => log::error!("SP_DJ: GET {path} → {e}"),
        }
    }
}

/// La estación, probada con el código que la app usa.
///
/// **La sonda anterior leía el JSON a mano; esto llama a las mismas funciones
/// que la app.** Es la diferencia entre saber que el servicio tiene más
/// páginas y saber que la app las pide, las entiende y las sigue.
///
/// Cada ronda: la primera página, y la siguiente por el cursor que devolvió la
/// anterior. Con eso se ve si la estación sigue y si las frases llegan.
#[cfg(debug_assertions)]
fn probe_dj_station(session: &Session, playlist_id: &str) {
    let Ok(first) = dj_mix(session, playlist_id) else {
        log::error!("SP_DJ: la estación no arrancó");
        return;
    };
    log::info!(
        "SP_DJ: estación · {} canciones · {} frases · sigue={:?}",
        first.mix.tracks.len(),
        first.mix.lines.len(),
        first.next.as_deref().map(|path| &path[..path.len().min(90)])
    );
    for track in first.mix.tracks.iter().take(12) {
        let line = first.mix.lines.get(&track.id);
        log::info!(
            "SP_DJ:   {} — {}{}",
            track.name,
            track_artists(track),
            match line {
                Some(narration) => format!(" · «{}»: {}", narration.speaker, narration.line),
                None => String::new(),
            }
        );
    }

    // **¿Dos clicks dan dos mixes?** Esto es lo que el usuario preguntó, y la
    // respuesta tiene que salir del código de producción y no de una opinión:
    // se llama `dj_mix` dos veces y se comparan las primeras canciones.
    let primeras: Vec<String> = first
        .mix
        .tracks
        .iter()
        .take(3)
        .map(|track| track.id.clone())
        .collect();
    std::thread::sleep(std::time::Duration::from_secs(5));
    match dj_mix(session, playlist_id) {
        Ok(second) => {
            let otras: Vec<String> = second
                .mix
                .tracks
                .iter()
                .take(3)
                .map(|track| track.id.clone())
                .collect();
            log::info!(
                "SP_DJ: dos mixes · primera vez={primeras:?} · segunda vez={otras:?} · {}",
                if primeras == otras {
                    "IGUALES: el DJ se repite"
                } else {
                    "distintos: el DJ no se repite"
                }
            );
        }
        Err(error) => log::error!("SP_DJ: el segundo mix no vino: {error}"),
    }

    let Some(next) = first.next.clone() else {
        log::info!("SP_DJ: la estación no dice por dónde seguir");
        return;
    };

    match station_page(session, &next) {
        Ok(second) => {
            log::info!(
                "SP_DJ: segunda página · {} canciones · {} frases · sigue={:?}",
                second.mix.tracks.len(),
                second.mix.lines.len(),
                second.next.as_deref().map(|path| &path[..path.len().min(90)])
            );
            for track in second.mix.tracks.iter().take(12) {
                let line = second.mix.lines.get(&track.id);
                log::info!(
                    "SP_DJ:   {} — {}{}",
                    track.name,
                    track_artists(track),
                    match line {
                        Some(narration) => format!(" · «{}»: {}", narration.speaker, narration.line),
                        None => String::new(),
                    }
                );
            }
        }
        Err(error) => log::error!("SP_DJ: la segunda página no se pudo pedir: {error}"),
    }
}

/// Los artistas de una pista, como texto: la sonda cuenta, no juzga.
#[cfg(debug_assertions)]
fn track_artists(track: &crate::models::Track) -> String {
    if track.artists.is_empty() {
        return String::new();
    }
    let names: Vec<String> = track.artists.iter().map(|artist| artist.name.clone()).collect();
    format!("({})", names.join(", "))
}

/// La pregunta que decide si el DJ es una lista o una estación: **¿sigue?**
///
/// La primera página trae cinco canciones y un `next_page_url` que es un
/// `hm://`. Si ese `hm://` se puede traducir al path del host y el host
/// contesta con más canciones, el DJ es una estación: no se acaba, y la app
/// tiene que pedir la página siguiente cuando la cola se está por vaciar.
///
/// Si no se puede, el DJ es una lista de cinco y hay que decirlo con todas las
/// letras. Por eso esto camina tres páginas: una dice poco.
///
/// El `hm://` es el nombre interno del servicio, no una URL. Lo que se pide es
/// el path, en el host de Spotify: sin el prefijo `lexicon-session-provider`
/// da 404, y con la página siguiente y su `requestId` en el query, que es
/// donde el servicio espera encontrarlos.
#[cfg(debug_assertions)]
fn probe_dj_next_page(session: &Session, playlist_id: &str) {
    let context_uri = format!("spotify:playlist:{playlist_id}");
    let mut path = format!("/lexicon-session-provider/context-resolve/v2/session?contextUri={context_uri}");

    for round in 0..3 {
        let owned = session.clone();
        let endpoint = path.clone();
        let outcome = call(session, async move {
            owned
                .spclient()
                .request(&reqwest::Method::GET, &endpoint, None, None)
                .await
                .map_err(|e| format!("ERROR: {e}"))
        });

        let body = match outcome {
            Ok(body) => body,
            Err(e) => {
                log::error!("SP_DJ: [{round}] {path} → {e}");
                return;
            }
        };

        let Ok(json) = serde_json::from_slice::<serde_json::Value>(&body) else {
            log::error!(
                "SP_DJ: [{round}] la respuesta no es JSON ({} bytes)",
                body.len()
            );
            return;
        };

        let pages = json
            .get("pages")
            .and_then(|value| value.as_array())
            .cloned()
            .unwrap_or_default();
        log::info!("SP_DJ: [{round}] {path} → {} bytes · {} páginas", body.len(), pages.len());

        // Una respuesta con bytes y sin páginas es una respuesta con otra forma:
        // sin esto, "0 páginas" parece lo mismo que "no hay nada".
        if pages.is_empty() {
            let claves: Vec<String> = json
                .as_object()
                .map(|object| object.keys().cloned().collect())
                .unwrap_or_default();
            log::info!("SP_DJ: [{round}] sin páginas · llaves={claves:?}");
            let texto = String::from_utf8_lossy(&body);
            log::info!(
                "SP_DJ: [{round}] cuerpo (900) → {}",
                texto.chars().take(900).collect::<String>()
            );
        }

        // Lo que decide si esto es una estación: si la página trae canciones y
        // por dónde seguir.
        let mut next: Option<String> = None;
        for (index, page) in pages.iter().enumerate() {
            let tracks = page
                .get("tracks")
                .and_then(|value| value.as_array())
                .cloned()
                .unwrap_or_default();
            log::info!("SP_DJ: [{round}] página {index}: {} pistas", tracks.len());
            for track in tracks.iter().take(6) {
                let uri = track.get("uri").and_then(|value| value.as_str()).unwrap_or("?");
                let has_narration = track
                    .get("metadata")
                    .and_then(|value| value.as_object())
                    .map(|meta| {
                        meta.keys()
                            .filter(|key| key.starts_with("narration"))
                            .cloned()
                            .collect::<Vec<String>>()
                    })
                    .unwrap_or_default();
                log::info!("SP_DJ: [{round}]   {uri} · narración={has_narration:?}");
            }
            if let Some(url) = page.get("next_page_url").and_then(|value| value.as_str()) {
                log::info!("SP_DJ: [{round}] página {index}: next_page_url = {url}");
                if next.is_none() {
                    next = Some(url.to_string());
                }
            }
        }

        // Lo que hace el DJ al terminar: seguir, o parar.
        for key in ["end_of_context_action", "lexicon_expiration_time", "dj.interactivity_enabled"] {
            if let Some(value) = json.get("metadata").and_then(|meta| meta.get(key)) {
                log::info!("SP_DJ: [{round}] meta {key} = {value}");
            }
        }

        let Some(next) = next else {
            log::info!("SP_DJ: [{round}] la página no dice por dónde seguir: acá termina");
            return;
        };

        // La traducción: `hm://lexicon-session-provider/...` es el nombre
        // interno del servicio; en el host de Spotify se pide el path.
        let translated = next
            .strip_prefix("hm://")
            .map(|rest| format!("/{rest}"))
            .unwrap_or_else(|| next.clone());
        log::info!("SP_DJ: [{round}] siguiente en el host: {translated}");
        path = translated;
    }
}

/// Una playlist por id, sin hidratar, para ver qué clase de URI trae.
///
/// La app nunca llama a `get_playlist` de esta forma —la hidrata y la muestra—
/// pero acá la pregunta es qué trae el servicio, antes de que la app le haga
/// nada: una URI que no sea una canción es la diferencia entre "está vacío" y
/// "tiene cosas que la app no sabe mostrar".
#[cfg(debug_assertions)]
fn raw_playlist(session: &Session, playlist_id: &str) -> Result<SelectedListContent, String> {
    let Ok(id) = SpotifyId::from_base62(playlist_id) else {
        return Err("bad_id".to_string());
    };

    let owned = session.clone();
    let body = call(session, async move {
        owned
            .spclient()
            .get_playlist(&id)
            .await
            .map_err(|e| {
                log::error!("SP_DJ: get_playlist falló: {e}");
                "network_failed".to_string()
            })
    })?;

    SelectedListContent::parse_from_bytes(&body).map_err(|e| {
        log::error!("SP_DJ: la playlist vino con otra forma: {e}");
        "bad_response".to_string()
    })
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
            "SP_HOME",
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

/// Una quinta pregunta, y la primera que no es de lectura: ¿por esta sesión
/// existe una puerta para **crear** una playlist?
///
/// Todo lo de arriba lee. `librespot` 0.8 no trae ni un POST sobre bibliotecas:
/// los únicos que manda son el token de cliente, la metadata extendida, el
/// autoplay y el estado de transferencia, y `playlist_update` de `spirc` es una
/// **notificación** de Spotify, no una API. Eso no demuestra que la puerta no
/// exista — sólo que la biblioteca no la usa — y la diferencia entre las dos
/// cosas es exactamente la que justifica una sonda.
///
/// ## Lo que se midió
///
/// El 19 de octubre de 2026, con una cuenta real. Siete rutas por los dos verbos,
/// porque el router distingue y esa distinción es lo único que separa "no hay
/// ruta acá" de "hay ruta pero no puedes escribir por acá" sin escribir nada:
///
/// | ruta | `GET` | `POST` |
/// |---|---|---|
/// | `/playlist/v2/user/<id>/rootlist` | `200` | `405` |
/// | `/playlist/v2/user/<id>/playlist` | `404` | `404` |
/// | `/playlist/v2/user/<id>/playlists` | `404` | `404` |
/// | **`/playlist/v2/playlist`** | **`405`** | **`400`** |
/// | `/user/<id>/playlist` | `404` | `404` |
/// | `/playlist/v2/user/<id>/playlist/<id>/items` | `404` | `404` |
/// | `/playlist/v2/user/<id>/playlist/<id>/description` | `404` | `404` |
///
/// **La puerta es `POST /playlist/v2/playlist`, sin el segmento del usuario**:
/// el id va en el cuerpo. La tabla no es uniforme, y por eso el `404` de al lado
/// se puede leer — un servicio que contestara `404` a todo se vería igual que
/// uno al que no se le preguntó nada.
///
/// De regalón, `/user/<id>/playlist` da `404` en los dos verbos: este access
/// point no sirve las rutas de la Web API. Es la regla 7 medida al revés.
///
/// ## Dónde está la puerta, en realidad
///
/// `POST /playlist/v2/playlist` **no es la puerta**, y esta sonda se equivocó de
/// calle. Contesta `400` con **cero bytes** —se probó por los dos caminos: el
/// cliente de librespot tira el cuerpo de toda respuesta que no sea 2xx
/// (`http_client.rs:214`), y con `reqwest`, que sí lo devuelve, vino
/// `400 · 0 bytes · ""`— y esa mudez era la pista: una ruta que no existe
/// contestaría distinto.
///
/// La respuesta llegó de la única forma que no deja dudas, que es ver qué manda
/// el cliente oficial. Spotify para Windows (`Spotify.dll`, `1.304.258.0`) embebe
/// unos mil `.proto` **completos como texto plano**, con nombres de campo, tipos
/// y números de campo: no hace falta ningún descompilador. Ahí está
/// `spotify.playlist4.proto`, con sus `Delta`, `Diff`, `ListChanges` y `Op` — y
/// con `CreateListReply`, pero **sin** ningún mensaje que se llame "crear".
///
/// ## Cómo se crea una playlist
///
/// Se crea **agregándola a la raíz**, que es un `ADD` sobre el rootlist. El id lo
/// genera el cliente, no el servidor: el `GET` de permisos de la playlist
/// devuelve `404` un instante antes del `POST`, porque todavía no existe y el id
/// ya venía puesto en el pedido. Dos llamadas, en este orden:
///
/// 1. `POST /playlist/v2/user/<id>/rootlist/changes` con un `ListChanges` —el
///    `base_revision` sale del `GET` del rootlist— y un único `Delta` cuyo `Op`
///    lleva `kind = ADD` (`Op.Kind::ADD` es `2`) y un `Item` con
///    `uri = "spotify:playlist:<id nuevo>"`. Esto crea la playlist.
/// 2. `POST /playlist/v2/playlist/<id>/changes` con otro `ListChanges` y un `Op`
///    con `kind = UPDATE_LIST_ATTRIBUTES` (`6`) para ponerle el nombre.
///
/// **No hace falta ningún proto nuevo.** `ListChanges`, `Delta`, `Op`, `Op.Kind`,
/// `Add`, `Item`, `ChangeInfo`, `UpdateListAttributes` y
/// `ListAttributesPartialState` están todos en `playlist4_external.proto`, que
/// librespot ya compila. Es el mismo `playlist4` con el que se editan las
/// playlists de siempre; la creación no es un caso especial, es un `ADD` más.
///
/// Esto **no** choca con la regla 7: es la misma sesión de siempre, el mismo
/// `spclient`, la misma cabecera de autorización. No hay una segunda identidad ni
/// la Web API de por medio —que además este access point no sirve, `/user/<id>/
/// playlist` dio `404` en los dos verbos.
///
/// Lo que sí cambia es lo que se está decidiendo. Hasta acá Starless sólo leía.
/// Escribir en la cuenta de quien la está usando, por un endpoint que Spotify no
/// documenta, es una decisión de producto y no de ingeniería, y por eso la sonda
/// queda como está: la respuesta vive acá y el botón es otra conversación.
///
/// ## Que la sonda no pueda crear nada
///
/// El cuerpo va deliberadamente **imborrable**: ni un `name`, ni un
/// `description`, ni un id. Lo que se manda es un protobuf que no se puede
/// parsear, así que la peor respuesta posible del servicio es "no entendí el
/// cuerpo". Un `POST` vacío habría sido casi igual de inofensivo —una playlist
/// sin nombre no es una playlist— pero "casi" no es una garantía, y una sonda
/// que puede modificar la cuenta de quien la corre no es una sonda.
#[cfg(debug_assertions)]
pub fn create_requested() -> bool {
    std::env::var("STARLESS_SP_CREATE")
        .map(|value| value != "0" && !value.is_empty())
        .unwrap_or(false)
}

/// Barre un conjunto de rutas con los dos verbos y dice qué status volvió con cada una.
///
/// La primera vez que se corrió esto probaba cuatro `POST` y el `404` de la
/// puerta podía significar dos cosas: que la puerta no existe, o que la puerta
/// existe pero se escribe de otra forma. Cambiar un verbo por `GET` no la
/// hubiera desambiguado —un `404` en `GET` tampoco distingue una cosa de la otra—
/// así que la pregunta correcta es por ruta: *¿qué verbsos reconoce el router
/// acá?* Un `GET` que contesta `200` y un `POST` que contesta `405` juntos dicen
/// "esta dirección existe y es de lectura", que es un dato, no una ausencia.
#[cfg(debug_assertions)]
pub fn run_create_probe(app: tauri::AppHandle) {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(session) = crate::selftest::wait_for_session(&app) else {
            log::error!("SP_CREATE: la sesión no llegó a conectar");
            return;
        };

        log::info!("=== DIAGNOSTIC: sonda de escritura sobre bibliotecas ===");

        let Ok(account) = account(&session) else {
            log::error!("SP_CREATE: sin cuenta no hay a quién preguntarle");
            return;
        };
        let user = &account.id;

        // Ni un byte de esto es parseable como un `CreatePlaylist`: es el tag de
        // un campo que declara una longitud y no la manda. El `GET` va sin
        // cuerpo, que es lo único que un `GET` puede llevar.

        // Cada ruta contesta una pregunta distinta. La primera es la línea de
        // control: sabemos que existe y que se lee, así que si algún día esta
        // contesta otra cosa, el resto de la tabla hay que leerlo con desconfianza.
        let candidates = [
            (
                format!("/playlist/v2/user/{user}/rootlist"),
                "control: existe y es de lectura",
            ),
            (
                format!("/playlist/v2/user/{user}/playlist"),
                "crear, en la forma obvia",
            ),
            (
                format!("/playlist/v2/user/{user}/playlists"),
                "la misma, en plural",
            ),
            (
                "/playlist/v2/playlist".to_owned(),
                "sin el segmento del usuario",
            ),
            (
                format!("/user/{user}/playlist"),
                "la forma de la Web API, en este host",
            ),
            (
                format!("/playlist/v2/user/{user}/playlist/starless-sonda/items"),
                "agregar canciones",
            ),
            (
                format!("/playlist/v2/user/{user}/playlist/starless-sonda/description"),
                "cambiar el nombre",
            ),
        ];

        for (endpoint, what) in candidates {
            probe_verbs(&session, &endpoint, what);
        }

        // Una sola vez más, y por otro cliente: leer **por qué** dijo que no. La
        // ruta ya está y ya sabemos que contesta `400`; lo que falta es el motivo,
        // y ése vive en un cuerpo que el cliente de librespot nunca entrega.
        probe_refusal(&session, "/playlist/v2/playlist", "la puerta");

        log::info!("=== DIAGNOSTIC: fin de la sonda de escritura ===");
    });
}

/// Lee el cuerpo de un rechazo usando un cliente que no lo borre.
///
/// `HttpClient::request`, el de librespot, convierte **toda** respuesta que no sea
/// 2xx en un `Err` que sólo lleva el status: el cuerpo se pierde en
/// `http_client.rs:214`, un nivel más abajo que cualquier tipo que se pueda
/// nombrar acá. Por eso leer el motivo obliga a *no usar* ese cliente en vez de
/// agregarle dependencias al crate.
///
/// Y por eso esto va aparte de `probe_verbs`, que sigue apoyándose en librespot:
/// la tabla de statuses salió de ahí y es la calibración de todo lo demás. Si el
/// status que conteste `reqwest` fuera distinto, eso no sería una contradicción
/// sino la medida de cuánto le importaba el cliente — y por eso las dos líneas
/// se leen juntas y no una en lugar de la otra.
///
/// El cliente async, no el bloqueante: esto corre adentro de `call`, o sea sobre
/// el runtime de librespot, donde un `reqwest::blocking` levanta el suyo y hace
/// panic en el medio de un worker async.
#[cfg(debug_assertions)]
fn probe_refusal(session: &Session, path: &str, what: &str) {
    let owned = session.clone();
    let route = path.to_owned();
    let outcome = call(session, async move {
        let base = owned.spclient().base_url().await.map_err(|e| e.to_string())?;
        let token = owned
            .login5()
            .auth_token()
            .await
            .map_err(|e| e.to_string())?;

        // Las mismas cabeceras que `spclient` pone en cada petición, y los mismos
        // parámetros de métricas que le agrega por su cuenta. El `salt` es
        //Cache-busting para GETs y va fijo: que sea el mismo número siempre no
        // cambia lo que el servicio conteste.
        let authorization = format!("{} {}", token.token_type, token.access_token);
        let client_token = owned.spclient().client_token().await.unwrap_or_default();
        let url = format!("{base}{route}?product=0&country={}&salt=1", owned.country());

        let response = reqwest::Client::new()
            .post(url)
            .header(reqwest::header::AUTHORIZATION, authorization)
            .header("client-token", client_token)
            .body(UNREADABLE.to_vec())
            .send()
            .await
            .map_err(|e| format!("la red: {e}"))?;

        let status = response.status().as_u16();
        let bytes = response.bytes().await.map_err(|e| format!("el cuerpo: {e}"))?;

        Ok(format!("{status} · {}", describe_bytes(&bytes)))
    });

    match outcome {
        Ok(summary) => log::info!("SP_CREATE: [{what}] por reqwest → {summary}"),
        Err(e) => log::error!("SP_CREATE: [{what}] la sonda no llegó: {e}"),
    }
}

/// Ni un byte de esto es parseable como un `CreatePlaylist`: es el tag de un campo
/// que declara una longitud y no la manda.
///
/// Vacía de propósito en todo lo que una escritura necesita —ni `name`, ni
/// `description`, ni un id— así que la peor respuesta posible del servicio es
/// "no entendí el cuerpo". Un `POST` sin cuerpo habría sido casi igual de
/// inofensivo, pero "casi" no es una garantía.
#[cfg(debug_assertions)]
const UNREADABLE: &[u8] = &[0x0A, 0x7F];

/// Una ruta, los dos verbos, dos líneas.
///
/// El router es el que decide qué es un `404` y qué es un `405`, así que las dos
/// preguntas tienen que salir de la misma dirección: preguntarle a `/rootlist`
/// por `POST` y a `/playlist` por `GET` serían dos accesos que no se pueden
/// comparar.
#[cfg(debug_assertions)]
fn probe_verbs(session: &Session, path: &str, what: &str) {
    for (label, method, body) in [
        ("GET", &reqwest::Method::GET, None),
        ("POST", &reqwest::Method::POST, Some(UNREADABLE)),
    ] {
        let owned = session.clone();
        let route = path.to_owned();
        let outcome = call(session, async move {
            owned
                .spclient()
                .request(method, &route, None, body)
                .await
                .map(|response| describe_bytes(&response))
                .map_err(|e| format!("ERROR: {e}"))
        });

        match outcome {
            Ok(summary) => log::info!("SP_CREATE: [{what}] {label} {path} → {summary}"),
            Err(e) => log::info!("SP_CREATE: [{what}] {label} {path} → {e}"),
        }
    }
}

/// Los primeros bytes de una respuesta, como texto y cortados.
///
/// Si una respuesta llega vacía, eso mismo es el dato y no hay que disfrazarlo de
/// error: un `200` con cero bytes es tan raro que vale la pena ver la longitud
/// explícita al lado.
#[cfg(debug_assertions)]
fn describe_bytes(body: &[u8]) -> String {
    const SHOWN: usize = 160;
    let text = String::from_utf8_lossy(&body[..body.len().min(SHOWN)]);
    let text: String = text.chars().map(|c| if c.is_control() { '·' } else { c }).collect();

    if body.len() <= SHOWN {
        format!("{} bytes · {text:?}", body.len())
    } else {
        format!("{} bytes · {text:?} …", body.len())
    }
}

// ---------------------------------------------------------------------------
// La voz del DJ: ¿hay una puerta para el audio?
// ---------------------------------------------------------------------------

/// La voz del DJ, medida.
///
/// La deuda 7 daba la voz por inalcanzable porque a la fila del DJ sólo le
/// llegaba el SSML: el texto y los parámetros de la mezcla, nunca el audio. Pero
/// librespot 0.8 trae `spotify.narration.proto` —**sin compilar y sin usar por
/// nadie**— con `ResolveRequest` (el SSML, la voz, el proveedor, el idioma, el
/// formato) y `ResolveResponse` (una URL y su vencimiento). O sea que el
/// servicio que da el audio de la frase **existe y está descrito**; lo que
/// faltaba era la puerta por la que se le pregunta.
///
/// Esta sonda hace tres cosas, en orden, porque cada una acota la siguiente:
///
/// 1. Volca la metadata completa de las filas que traen narración. Si la URL
///    del audio viene ya resuelta, no hay que buscar ninguna puerta.
/// 2. Prueba los paths candidatos con `GET`. Un `404` es "no existe"; cualquier
///    otra cosa es "existe" — y esa diferencia separa un path inventado de uno
///    real.
/// 3. A los que no responden `404` les manda un `POST` con el cuerpo del
///    `ResolveRequest` y mira si vuelve una URL.
#[cfg(debug_assertions)]
fn probe_dj_tts(session: &Session, playlist_id: &str) {
    let Some(params) = dj_narration_params(session, playlist_id) else {
        log::error!("SP_TTS: no hay SSML para pedir");
        return;
    };
    log::info!(
        "SP_TTS: el ssml tiene {} caracteres · idioma {} · voz {} · proveedor {} · formato {} · {} Hz",
        params.ssml.chars().count(),
        params.language,
        params.voice,
        params.provider,
        params.audio_format,
        params.sample_rate
    );

    // La puerta que el router reconoce: el namespace `client-tts/v1` del
    // spclient, que es donde vive el método `fulfill`.
    probe_client_tts(session, &params);

    // Y la otra puerta, la que no es el spclient.
    probe_tts_hosts(session, &params);
}

/// La prueba de que la voz del DJ suena: pedir el audio, decodificarlo y
/// ponerlo en el mixer, sin que nadie haga clic.
///
/// **Llama al comando de verdad**, no a sus piezas: lo que se prueba es el
/// camino que hace el click del frontend, con la misma sesión y el mismo
/// cursor.
///
/// Se espera en un hilo propio y no en el pool de la app porque el comando se
/// espera con `block_on`, y eso no se puede hacer desde adentro de un runtime.
#[cfg(debug_assertions)]
pub fn run_voice_probe(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        if crate::selftest::wait_for_session(&app).is_none() {
            log::error!("SP_VOICE: la sesión no llegó a conectar");
            return;
        }
        log::info!("=== DIAGNOSTIC: sonda de voz ===");

        let mix = tauri::async_runtime::block_on(crate::dj_mix(
            app.clone(),
            tauri::Manager::state::<crate::DjState>(&app),
            "37i9dQZF1EYkqdzj48dyYq".to_owned(),
        ));

        let first = match mix {
            Ok(mix) => {
                log::info!("SP_VOICE: el comando devolvió {} canciones", mix.tracks.len());
                mix.tracks.first().map(|track| track.id.clone())
            }
            Err(error) => {
                log::error!("SP_VOICE: el comando falló: {error}");
                None
            }
        };

        // **Y ahora la voz de esa canción**, que es como lo pide el frontend:
        // la frase es de la canción, y se dice cuando la canción va a sonar.
        if let Some(track_id) = first {
            let said = tauri::async_runtime::block_on(crate::dj_speak(
                app.clone(),
                tauri::Manager::state::<crate::DjState>(&app),
                track_id,
            ));
            match said {
                Ok(Some(id)) => log::info!("SP_VOICE: el comando pidió la voz {id}"),
                Ok(None) => log::error!("SP_VOICE: el DJ no tiene frase para esa canción"),
                Err(error) => log::error!("SP_VOICE: el comando de la voz falló: {error}"),
            }
        }

        if !crate::voice::wait_for_mixer(std::time::Duration::from_secs(10)) {
            log::error!("SP_VOICE: no hay mixer de audio");
            return;
        }
        log::info!("SP_VOICE: el comando ya puso la voz; el mixer está");
    });
}

/// Si hay que probar la voz del DJ sin que nadie haga clic.
#[cfg(debug_assertions)]
pub fn voice_requested() -> bool {
    std::env::var("STARLESS_SP_VOICE")
        .map(|value| value != "0" && !value.is_empty())
        .unwrap_or(false)
}

/// El `TtsRequest` en el formato de texto de protobuf.
///
/// Es lo que acepta el spclient de Spotify con `Content-Type:
/// application/x-protobuf`. Los enums van por número porque el nombre del
/// enum en texto es relativo al paquete y no se sabe de memoria.
///
/// **Lo que se midió con esto:** el servicio contesta `400` con este cuerpo y
/// `200` con el binario. El texto no es una alternativa: es la prueba de que
/// el cuerpo tiene que ir en binario.
#[cfg(debug_assertions)]
fn tts_request_text(params: &crate::voice::VoiceParams) -> Vec<u8> {
    format!(
        "audio_format: {}\nlanguage: \"{}\"\ntts_voice: {}\ntts_provider: {}\nsample_rate_hz: {}\nssml: \"{}\"\n",
        params.audio_format,
        params.language.replace('"', "\\\""),
        params.voice,
        params.provider,
        params.sample_rate,
        params.ssml.replace('\\', "\\\\").replace('"', "\\\""),
    )
    .into_bytes()
}

/// El mismo `TtsRequest` en protobuf binario.
///
/// El cuerpo que se manda en producción: lo arma `voice.rs`, que es donde vive
/// la puerta.
#[cfg(debug_assertions)]
fn tts_request_binary(params: &crate::voice::VoiceParams) -> Vec<u8> {
    params.request_body()
}

/// La URL de una respuesta: el campo 1 de `TtsResponse`.
///
/// Un lector mínimo, porque la respuesta puede ser un `TtsResponse` pelado o
/// un error, y lo que importa es leer el campo 1 si está.
#[cfg(debug_assertions)]
fn pb_read_string(body: &[u8], field: u64) -> Option<String> {
    let mut index = 0;
    while index < body.len() {
        let (tag, next) = pb_read_varint(body, index)?;
        index = next;
        let wire = tag & 0x7;
        let number = tag >> 3;
        match wire {
            0 => {
                let (_, next) = pb_read_varint(body, index)?;
                index = next;
            }
            1 => index += 8,
            2 => {
                let (length, next) = pb_read_varint(body, index)?;
                let start = next;
                let end = start + length as usize;
                if end > body.len() {
                    return None;
                }
                if number == field {
                    return Some(String::from_utf8_lossy(&body[start..end]).to_string());
                }
                index = end;
            }
            5 => index += 4,
            _ => return None,
        }
    }
    None
}

/// Los dominios de un client token: dónde vive la puerta del TTS.
///
/// El servicio del proto se llama `ClientTtsService`, y los servicios
/// "client-\*" de Spotify se autentican con un **client token**, no con el
/// token de la cuenta. El `GrantedTokenResponse` trae la lista de dominios
/// para los que ese token sirve: si el TTS está entre ellos, ahí está el
/// nombre del host, y con él la puerta.
///
/// Se pide el token con dos versiones de cliente —la de escritorio, de la que
/// salen los protos, y la del cliente móvil— y se comparan los dominios que
/// concede cada una.
#[cfg(debug_assertions)]
fn probe_client_token_domains(session: &Session) {
    let versions = [
        ("escritorio", SPOTIFY_SEMANTIC_VERSION),
        ("movil", SPOTIFY_MOBILE_VERSION),
    ];

    for (name, version) in versions {
        let mut request = ClientTokenRequest::new();
        request.request_type = ClientTokenRequestType::REQUEST_CLIENT_DATA_REQUEST.into();

        let client_data = request.mut_client_data();
        client_data.client_version = version.to_owned();
        client_data.client_id = session.client_id();
        let connectivity = client_data.mut_connectivity_sdk_data();
        connectivity.device_id = session.device_id().to_owned();

        // La plataforma, que es lo que el service usa para decidir si le
        // concede el token a un cliente de Windows o si le manda un challenge
        // de hash-cash. Sin esto contesta `400` con el cuerpo vacío.
        let platform = connectivity.platform_specific_data.mut_or_insert_default();
        let windows = platform.mut_desktop_windows();
        windows.os_version = 10;
        windows.os_build = 21370;
        windows.platform_id = 2;
        windows.unknown_value_6 = 9;
        windows.image_file_machine = 34404;
        windows.pe_machine = 34404;
        windows.unknown_value_10 = true;

        let body = match request.write_to_bytes() {
            Ok(body) => body,
            Err(e) => {
                log::error!("SP_TOKEN: [{name}] el request no se armó: {e}");
                continue;
            }
        };

        let outcome = call(session, async move {
            reqwest::Client::new()
                .post("https://clienttoken.spotify.com/v1/clienttoken")
                .header("Accept", "application/x-protobuf")
                .header("User-Agent", "Spotify/124200290 Windows/0 (librespot)")
                .body(body)
                .send()
                .await
                .map_err(|e| format!("ERROR: {e}"))?
                .bytes()
                .await
                .map(|bytes| bytes.to_vec())
                .map_err(|e| format!("ERROR: {e}"))
        });
        let bytes = match outcome {
            Ok(bytes) => bytes,
            Err(e) => {
                log::error!("SP_TOKEN: [{name}] {e}");
                continue;
            }
        };

        let message = match ClientTokenResponse::parse_from_bytes(&bytes) {
            Ok(message) => message,
            Err(e) => {
                log::error!(
                    "SP_TOKEN: [{name}] la respuesta no se entendió: {e} · {}",
                    describe_bytes(&bytes)
                );
                continue;
            }
        };

        match ClientTokenResponseType::from_i32(message.response_type.value()) {
            Some(ClientTokenResponseType::RESPONSE_GRANTED_TOKEN_RESPONSE) => {
                let granted = message.granted_token();
                log::info!(
                    "SP_TOKEN: [{name}] el token vale para {} dominios",
                    granted.domains.len()
                );
                for domain in &granted.domains {
                    log::info!("SP_TOKEN: [{name}] dominio {}", domain.domain);
                }
            }
            Some(ClientTokenResponseType::RESPONSE_CHALLENGES_RESPONSE) => {
                log::info!(
                    "SP_TOKEN: [{name}] el servicio pide un challenge: {}",
                    describe_bytes(&bytes)
                );
            }
            _ => {
                log::info!(
                    "SP_TOKEN: [{name}] respuesta sin granted token: {}",
                    describe_bytes(&bytes)
                );
            }
        }
    }
}

/// Un varint leído de un buffer.
#[cfg(debug_assertions)]
fn pb_read_varint(body: &[u8], from: usize) -> Option<(u64, usize)> {
    let mut value = 0u64;
    let mut shift = 0;
    let mut index = from;
    while index < body.len() {
        let byte = body[index];
        index += 1;
        value |= u64::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 {
            return Some((value, index));
        }
        shift += 7;
        if shift > 63 {
            return None;
        }
    }
    None
}

/// Los parámetros de la narración, tal como los manda el servicio.
///
/// El SSML, el idioma, la voz y el proveedor: exactamente lo que el
/// `TtsRequest` del proto pide. Se leen de la metadata de la primera fila
/// narrada, que es donde el DJ los deja.
#[cfg(debug_assertions)]
fn dj_narration_params(
    session: &Session,
    playlist_id: &str,
) -> Option<crate::voice::VoiceParams> {
    let context_uri = format!("spotify:playlist:{playlist_id}");
    let path = format!(
        "/lexicon-session-provider/context-resolve/v2/session/00000000000000000000000000000000\
?contextUri={context_uri}&previousSegmentId=XX-Segment-XXXXX&requestId=probe-params"
    );

    let owned = session.clone();
    let endpoint = path.clone();
    let body = call(session, async move {
        owned
            .spclient()
            .request(&reqwest::Method::GET, &endpoint, None, None)
            .await
            .map_err(|e| format!("ERROR: {e}"))
    })
    .ok()?;
    let json = serde_json::from_slice::<serde_json::Value>(&body).ok()?;

    let mut rows: Vec<&serde_json::Value> = json
        .get("tracks")
        .and_then(|value| value.as_array())
        .map(|list| list.iter().collect())
        .unwrap_or_default();
    if rows.is_empty() {
        if let Some(pages) = json.get("pages").and_then(|value| value.as_array()) {
            for page in pages {
                if let Some(list) = page.get("tracks").and_then(|value| value.as_array()) {
                    rows.extend(list.iter());
                }
            }
        }
    }

    let mut params = None;

    for track in rows {
        let Some(metadata) = track.get("metadata").and_then(|value| value.as_object()) else {
            continue;
        };
        if params.is_some() {
            break;
        }
        for kind in ["narration.intro.", "narration.outro."] {
            if let Some(found) = crate::voice::VoiceParams::from_metadata(metadata, kind) {
                params = Some(found);
                break;
            }
        }
    }

    params
}

/// La puerta del TTS: todos los paths, con `POST`.
///
/// El router de Spotify contesta `404` a un `GET` sobre un path que sólo
/// acepta `POST`, así que probar con `GET` esconde la mitad de los caminos:
/// un `404` no dice "no existe" sino "no es por `GET`". Por eso la tanda
/// entera va con `POST`.
///
/// En los dos sitios: el spclient de la sesión —que ya lleva el token de la
/// cuenta y el client token en cada request— y `tts.spotify.com`, que existe
/// en DNS (el de Spotify no es un wildcard: un nombre inventado no resuelve)
/// y al que se le mandan las dos credenciales a mano.
#[cfg(debug_assertions)]
fn probe_tts_hosts(session: &Session, params: &crate::voice::VoiceParams) {
    let bearer = match call(session, {
        let owned = session.clone();
        async move {
            owned
                .login5()
                .auth_token()
                .await
                .map(|token| token.access_token)
                .map_err(|e| format!("ERROR: {e}"))
        }
    }) {
        Ok(token) => Some(token),
        Err(e) => {
            log::error!("SP_TTS: el token de la cuenta no salió: {e}");
            None
        }
    };
    let client = match call(session, {
        let owned = session.clone();
        async move {
            owned
                .spclient()
                .client_token()
                .await
                .map_err(|e| format!("ERROR: {e}"))
        }
    }) {
        Ok(token) => Some(token),
        Err(e) => {
            log::error!("SP_TTS: el client token no salió: {e}");
            None
        }
    };
    log::info!(
        "SP_TTS: hay token de cuenta: {} · hay client token: {}",
        bearer.is_some(),
        client.is_some()
    );

    let paths = [
        "/client-tts/v1/tts",
        "/client-tts/v1/resolve",
        "/client-tts/v1/url",
        "/client-tts/v1/tts-url",
        "/client-tts/v1/narration",
        "/client-tts/v1/audio",
        "/client-tts/v1/GetTtsUrl",
        "/narrations/v1/tts",
        "/narrations/v1/resolve",
        "/narrations/v1/GetTtsUrl",
        "/narrations/v1/narration",
        "/narration/v1/tts",
        "/narration/v1/resolve",
        "/tts/v1/resolve",
        "/tts/v1/tts",
        "/tts/v1/url",
        "/commentary/v1/tts",
        "/commentary/v1/resolve",
        "/commentaries/v1/resolve",
        "/automix/v1/tts",
        "/automix/v1/resolve",
        "/dj/v1/tts",
        "/voice/v1/tts",
        "/v1/tts",
        "/v1/resolve",
        "/v1/GetTtsUrl",
        "/GetTtsUrl",
        "/resolve",
        "/tts/resolve",
        "/narrations/tts/v1",
    ];

    let texto = tts_request_text(params);
    let binario = tts_request_binary(params);

    for path in paths {
        // El spclient de la sesión: ya lleva las dos credenciales.
        for (label, body) in [("texto", texto.clone()), ("binario", binario.clone())] {
            let owned = session.clone();
            let route = path.to_owned();
            let outcome = call(session, async move {
                let mut headers = reqwest::header::HeaderMap::new();
                headers.insert(
                    reqwest::header::CONTENT_TYPE,
                    reqwest::header::HeaderValue::from_static("application/x-protobuf"),
                );
                owned
                    .spclient()
                    .request(
                        &reqwest::Method::POST,
                        &route,
                        Some(headers),
                        Some(body.as_slice()),
                    )
                    .await
                    .map(|response| {
                        let url = pb_read_string(&response, 1);
                        format!("{} · url={url:?}", describe_bytes(&response))
                    })
                    .map_err(|e| format!("ERROR: {e}"))
            });
            match outcome {
                Ok(summary) => log::info!("SP_TTS: spclient POST {label} {path} → {summary}"),
                Err(e) => log::info!("SP_TTS: spclient POST {label} {path} → {e}"),
            }
        }

        // Y el host propio, con las dos credenciales a mano.
        let url = format!("https://tts.spotify.com{path}");
        for (label, body) in [("texto", texto.clone()), ("binario", binario.clone())] {
            let (status, summary) = tts_request(
                session,
                reqwest::Method::POST,
                &url,
                Some(body),
                bearer.clone(),
                client.clone(),
            );
            log::info!("SP_TTS: host POST {label} {url} → {status} · {summary}");
        }
    }
}

/// La puerta del TTS: el namespace `client-tts/v1` del spclient.
///
/// El binario nativo del cliente de Spotify —`usr/share/spotify/spotify`, 59
/// MB, el mismo core C++ que usa el de Windows— tiene **una sola** string de
/// TTS con forma de path: `client-tts/v1/fulfill`. Encaja con la convención
/// `servicio/vN/método` del resto del cliente (`storage-resolve/v2/files/audio/`,
/// `image-resolve/v1/resolve/map`, `playlist/v2/user/`).
///
/// Y el router lo reconoce sin credenciales: en `spclient.wg.spotify.com`
/// todo `/client-tts/v1/**` contesta `401`, mientras un path de control
/// inventado y `/client-tts/v2/**` contestan `404`. El `401` prueba el
/// namespace, no el método —con credenciales, un método inexistente contesta
/// `404`—, así que el método sale del binario y el cuerpo se prueba con las
/// tres combinaciones de credenciales.
///
/// **Lo que no se hace:** adivinar un host. `tts.spotify.com` existe en DNS
/// pero contesta `404` a todo, `/client-tts/v1/fulfill` incluido: no es el host
/// de este servicio.
#[cfg(debug_assertions)]
fn probe_client_tts(session: &Session, params: &crate::voice::VoiceParams) {
    let (bearer, client) = tts_credentials(session);
    log::info!(
        "SP_TTS: credenciales · cuenta={} · client={}",
        bearer.is_some(),
        client.is_some()
    );

    let binario = tts_request_binary(params);
    let texto = tts_request_text(params);

    // `fulfill` es el método que trae el binario; los demás son vecinos, por si
    // el nombre del método cambia entre versiones del cliente.
    let paths = [
        "/client-tts/v1/fulfill",
        "/client-tts/v1/resolve",
        "/client-tts/v1/tts",
        "/client-tts/v1/tts-url",
        "/client-tts/v1/url",
        "/client-tts/v1/narration",
        "/client-tts/v1/audio",
        "/client-tts/v1/voices",
        "/client-tts/v1/synthesize",
        "/client-tts/v1/GetTtsUrl",
    ];

    for path in paths {
        let url = format!("https://spclient.wg.spotify.com{path}");

        // Las tres combinaciones: con la cuenta sola, con el client token solo
        // y con los dos. Un `200` en una de las tres es la puerta.
        for (label, cuenta, ctoken) in [
            ("cuenta", bearer.clone(), None),
            ("client", None, client.clone()),
            ("ambas", bearer.clone(), client.clone()),
        ] {
            let (status, body) =
                client_tts_request(session, &url, binario.clone(), cuenta, ctoken);
            if status == 200 {
                guardar_audio(path, &body);
            }
            log::info!(
                "SP_TTS: POST {label} {path} → {status} · {}",
                describe_bytes(&body)
            );
        }

        // Y el spclient de librespot, que manda los headers que el servicio
        // espera: si el reqwest crudo rebota y éste no, la diferencia está en
        // un header y no en el path.
        let owned = session.clone();
        let route = path.to_owned();
        let cuerpo = binario.clone();
        let outcome = call(session, async move {
            let mut headers = reqwest::header::HeaderMap::new();
            headers.insert(
                reqwest::header::CONTENT_TYPE,
                reqwest::header::HeaderValue::from_static("application/x-protobuf"),
            );
            owned
                .spclient()
                .request(
                    &reqwest::Method::POST,
                    &route,
                    Some(headers),
                    Some(cuerpo.as_slice()),
                )
                .await
                .map(|response| {
                    let url = pb_read_string(&response, 1);
                    format!("{} · url={url:?}", describe_bytes(&response))
                })
                .map_err(|e| format!("ERROR: {e}"))
        });
        match outcome {
            Ok(summary) => log::info!("SP_TTS: spclient POST {path} → {summary}"),
            Err(e) => log::info!("SP_TTS: spclient POST {path} → {e}"),
        }

        // Por último el cuerpo en texto: el spclient de Spotify también acepta
        // protobuf en formato texto, y con el mismo path.
        let (status, body) =
            client_tts_request(session, &url, texto.clone(), bearer.clone(), client.clone());
        log::info!(
            "SP_TTS: POST ambas(texto) {path} → {status} · {}",
            describe_bytes(&body)
        );
    }
}

/// Guardar el audio que devuelve la puerta, para ver qué es.
///
/// El cuerpo no es una URL —el campo 1 del proto no se puede leer como
/// texto—, así que lo que vuelve es otra cosa: un archivo de audio, o un
/// error con forma de audio. Guardarlo y mirarle la magic es la forma de
/// saberlo sin adivinar.
#[cfg(debug_assertions)]
fn guardar_audio(path: &str, body: &[u8]) {
    if body.is_empty() {
        return;
    }
    let nombre = path.trim_start_matches('/').replace('/', "_");
    let destino = std::env::temp_dir().join(format!("starless-{nombre}.bin"));
    if std::fs::write(&destino, body).is_err() {
        log::error!("SP_TTS: no se pudo guardar el audio en {destino:?}");
        return;
    }
    let cabeza: Vec<String> = body
        .iter()
        .take(32)
        .map(|byte| format!("{byte:02X}"))
        .collect();
    log::info!(
        "SP_TTS: {path} → 200 · {} bytes · cabeza {} · guardado en {destino:?}",
        body.len(),
        cabeza.join(" ")
    );
}

/// Las dos credenciales que pide el spclient: el token de la cuenta y el
/// client token.
///
/// Se piden por separado porque no se sabe cuál acepta el servicio: el prefijo
/// `client-` del nombre es la pista de que quiere el client token, pero eso
/// es una inferencia y la respuesta decide.
#[cfg(debug_assertions)]
fn tts_credentials(session: &Session) -> (Option<String>, Option<String>) {
    let bearer = match call(session, {
        let owned = session.clone();
        async move {
            owned
                .login5()
                .auth_token()
                .await
                .map(|token| token.access_token)
                .map_err(|e| format!("ERROR: {e}"))
        }
    }) {
        Ok(token) => Some(token),
        Err(e) => {
            log::error!("SP_TTS: el token de la cuenta no salió: {e}");
            None
        }
    };
    let client = match call(session, {
        let owned = session.clone();
        async move {
            owned
                .spclient()
                .client_token()
                .await
                .map_err(|e| format!("ERROR: {e}"))
        }
    }) {
        Ok(token) => Some(token),
        Err(e) => {
            log::error!("SP_TTS: el client token no salió: {e}");
            None
        }
    };
    (bearer, client)
}

/// Un POST al spclient con la combinación de credenciales que se le pase.
///
/// Se prueban las tres a propósito: con la cuenta sola, con el client token
/// solo y con los dos. Un `200` en una es la puerta; un `401` en las tres
/// dice que la combinación está mal.
///
/// **Lo medido:** la puerta es `POST /client-tts/v1/fulfill` y pide el token de
/// la **cuenta** —con el client token solo contesta `401`— y el cuerpo en
/// protobuf **binario**: en texto contesta `400`. Y contesta con el audio, no
/// con una URL.
#[cfg(debug_assertions)]
fn client_tts_request(
    session: &Session,
    url: &str,
    body: Vec<u8>,
    bearer: Option<String>,
    client: Option<String>,
) -> (u16, Vec<u8>) {
    let method = reqwest::Method::POST;
    let url = url.to_owned();
    match call(session, async move {
        let mut request = reqwest::Client::new()
            .request(method, &url)
            .header(
                "User-Agent",
                "Spotify/124200290 Windows/0 (librespot)",
            )
            .header("Content-Type", "application/x-protobuf")
            .body(body);
        if let Some(bearer) = bearer {
            request = request.bearer_auth(bearer);
        }
        if let Some(client) = client {
            request = request.header("client-token", client);
        }

        match request.send().await {
            Ok(response) => {
                let status = response.status().as_u16();
                let bytes = response.bytes().await.unwrap_or_default();
                Ok((status, bytes.to_vec()))
            }
            Err(e) => Ok((0, format!("ERROR: {e}").into_bytes())),
        }
    }) {
        Ok(result) => result,
        Err(e) => (0, format!("ERROR: {e}").into_bytes()),
    }
}

/// Una request al host del TTS, con las dos credenciales a la vez.
///
/// Se mandan las dos porque no se sabe cuál pide: el token de la cuenta para
/// los servicios del spclient, el client token para los "client-\*". Un `401`
/// con una y un `200` con la otra es justo el dato que se busca.
#[cfg(debug_assertions)]
fn tts_request(
    session: &Session,
    method: reqwest::Method,
    url: &str,
    body: Option<Vec<u8>>,
    bearer: Option<String>,
    client: Option<String>,
) -> (u16, String) {
    let method = method.clone();
    let url = url.to_owned();
    match call(session, async move {
        let mut request = reqwest::Client::new()
            .request(method, &url)
            .header("User-Agent", "Spotify/124200290 Windows/0 (librespot)");
        if let Some(bearer) = bearer {
            request = request.bearer_auth(bearer);
        }
        if let Some(client) = client {
            request = request.header("client-token", client);
        }
        if let Some(body) = body {
            request = request
                .header("Content-Type", "application/x-protobuf")
                .body(body);
        }

        match request.send().await {
            Ok(response) => {
                let status = response.status().as_u16();
                let bytes = response.bytes().await.unwrap_or_default();
                Ok((status, describe_bytes(&bytes)))
            }
            Err(e) => Ok((0, format!("ERROR: {e}"))),
        }
    }) {
        Ok(result) => result,
        Err(e) => (0, format!("ERROR: {e}")),
    }
}

// ---------------------------------------------------------------------------
// La visibilidad: ¿pública o privada?
// ---------------------------------------------------------------------------

/// `true` when the environment asks for the probe. Read once, at startup.
///
/// **Esta sonda modifica la cuenta, y por eso pide una playlist por su id.**
/// Sin `STARLESS_SP_PRIVATE_ID` no escribe nada: sólo lee y dice qué trae
/// cada ítem de la biblioteca. La sonda de creación —que sí escribe— se
/// dejó inofensiva a propósito; acá no se puede, porque lo que se busca es
/// justamente la puerta de escritura. El precio de medirla es que la
/// playlist nombrada cambie de visibilidad, y por eso la sonda **la vuelve a
/// dejar como la encontró**.
#[cfg(debug_assertions)]
pub fn private_requested() -> bool {
    std::env::var("STARLESS_SP_PRIVATE")
        .map(|value| value != "0" && !value.is_empty())
        .unwrap_or(false)
}

/// La playlist que la sonda puede tocar, si el ambiente la nombró.
#[cfg(debug_assertions)]
fn private_target() -> Option<String> {
    std::env::var("STARLESS_SP_PRIVATE_ID")
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

/// Un ítem de la biblioteca: la uri, la visibilidad que trae y el resto.
///
/// **La visibilidad es un atributo del ítem, no de la playlist.** `public` es
/// el campo 10 de `ItemAttributes`, el mismo que el cliente de escritorio
/// manda en `true` cuando agrega la playlist a la biblioteca — y el que hay
/// que poner en `false` para que sea privada. Que sea un atributo *del
/// ítem* dice también dónde se escribe: en el rootlist, que es la lista de
/// la biblioteca, y no en la playlist.
#[cfg(debug_assertions)]
struct RootItem {
    uri: String,
    public: Option<bool>,
    timestamp: Option<i64>,
    formats: Vec<String>,
}

/// La biblioteca, ítem por ítem.
///
/// La lectura es la misma que hace la pantalla —`get_rootlist` con las
/// decoraciones de siempre— y por eso lo que sale acá es lo que la app
/// tendría en la mano para dibujar un interruptor.
#[cfg(debug_assertions)]
fn rootlist_items(session: &Session) -> Vec<RootItem> {
    let owned = session.clone();
    let body = match call(session, async move {
        owned
            .spclient()
            .get_rootlist(0, Some(ROOTLIST_PAGE))
            .await
            .map_err(|e| {
                log::error!("SP_PRIVATE: no se pudo leer la biblioteca: {e}");
                "network_failed".to_string()
            })
    }) {
        Ok(body) => body,
        Err(e) => {
            log::error!("SP_PRIVATE: la biblioteca no vino: {e}");
            return Vec::new();
        }
    };

    let message = match SelectedListContent::parse_from_bytes(&body) {
        Ok(message) => message,
        Err(e) => {
            log::error!("SP_PRIVATE: el rootlist vino con otra forma: {e}");
            return Vec::new();
        }
    };

    let contents = message.contents.get_or_default();
    contents
        .items
        .iter()
        .map(|item| {
            let attributes = item.attributes.as_ref();
            RootItem {
                uri: item.uri().to_owned(),
                public: attributes.and_then(|a| a.public),
                timestamp: attributes.and_then(|a| a.timestamp),
                formats: attributes
                    .map(|a| {
                        a.format_attributes
                            .iter()
                            .map(|format| format!("{}={}", format.key(), format.value()))
                            .collect()
                    })
                    .unwrap_or_default(),
            }
        })
        .collect()
}

/// La visibilidad de una playlist, de punta a punta.
///
/// **Primero se lee, después se escribe, y al final se deja como estaba.**
/// El orden importa: sin saber qué trae cada ítem no hay forma de decir que
/// un `200` cambió algo, porque el servicio contesta `200` a un pedido que
/// no entendió.
#[cfg(debug_assertions)]
pub fn run_private_probe(app: tauri::AppHandle) {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(session) = crate::selftest::wait_for_session(&app) else {
            log::error!("SP_PRIVATE: la sesión no llegó a conectar");
            return;
        };

        log::info!("=== DIAGNOSTIC: sonda de visibilidad ===");

        let items = rootlist_items(&session);
        for (index, item) in items.iter().enumerate() {
            log::info!(
                "SP_PRIVATE: [{index}] {} · public={:?} · timestamp={:?} · formatos={:?}",
                item.uri,
                item.public,
                item.timestamp,
                item.formats
            );
        }

        let Some(target) = private_target() else {
            log::info!("SP_PRIVATE: sin STARLESS_SP_PRIVATE_ID no se escribe nada");
            return;
        };

        let uri = format!("spotify:playlist:{target}");
        let Some(index) = items.iter().position(|item| item.uri == uri) else {
            log::error!("SP_PRIVATE: la playlist {target} no está en la biblioteca");
            return;
        };
        let original = items[index].public;
        log::info!(
            "SP_PRIVATE: la playlist {target} está en el índice {index} y trae public={original:?}"
        );

        let account = session.username().to_owned();
        let path = format!("/playlist/v2/user/{account}/rootlist/changes");

        // Las tres formas en que un op puede decir a qué ítem se refiere. Se
        // prueban todas porque el proto no dice cuál es: `index` y `item` son
        // los dos opcionales, y el que el cliente de escritorio usa no está
        // escrito en ninguna parte.
        for shape in ["item", "index", "index+item"] {
            let change = visibility_change(
                &super::rootlist_revision(&session).unwrap_or_default(),
                &account,
                super::now_millis(),
                &uri,
                match shape {
                    "item" => None,
                    _ => Some(index as i32),
                },
                matches!(shape, "item" | "index+item"),
                false,
            );

            let body = change.write_to_bytes().unwrap_or_default();
            let (status, text) = post_rootlist(&session, &path, body);
            log::info!("SP_PRIVATE: la forma `{shape}` → {status} · {text}");

            // El `200` no dice nada: lo que dice es si el atributo cambió.
            let after = rootlist_items(&session);
            let now = after
                .iter()
                .find(|item| item.uri == uri)
                .and_then(|item| item.public);
            log::info!("SP_PRIVATE: después de la forma `{shape}`, public={now:?}");

            if now != original {
                log::info!("SP_PRIVATE: la forma `{shape}` FUNCIONÓ");
                // Se deja la cuenta como la encontró.
                let restore = visibility_change(
                    &super::rootlist_revision(&session).unwrap_or_default(),
                    &account,
                    super::now_millis(),
                    &uri,
                    match shape {
                        "item" => None,
                        _ => Some(index as i32),
                    },
                    matches!(shape, "item" | "index+item"),
                    original.unwrap_or(true),
                );
                let body = restore.write_to_bytes().unwrap_or_default();
                let (status, text) = post_rootlist(&session, &path, body);
                log::info!("SP_PRIVATE: se restauró → {status} · {text}");
                break;
            }
        }

        log::info!("=== DIAGNOSTIC: fin de la sonda de visibilidad ===");
    });
}

/// El `ListChanges` que cambia la visibilidad de un ítem de la biblioteca.
///
/// **Es un op de atributos de ítem, no de lista.** La playlist es un ítem de
/// la biblioteca —una fila del rootlist— y su `public` es un atributo de ese
/// ítem: `ItemAttributes.public`, el mismo campo que el cliente de escritorio
/// manda en `true` cuando la playlist entra en la biblioteca.
#[cfg(debug_assertions)]
fn visibility_change(
    revision: &[u8],
    account: &str,
    timestamp: i64,
    uri: &str,
    index: Option<i32>,
    with_item: bool,
    public: bool,
) -> ListChanges {
    ListChanges {
        base_revision: Some(revision.to_vec()),
        deltas: vec![super::delta(
            vec![Op {
                kind: Some(EnumOrUnknown::new(op::Kind::UPDATE_ITEM_ATTRIBUTES)),
                update_item_attributes: MessageField::some(UpdateItemAttributes {
                    index,
                    new_attributes: MessageField::some(ItemAttributesPartialState {
                        values: MessageField::some(ItemAttributes {
                            public: Some(public),
                            ..Default::default()
                        }),
                        ..Default::default()
                    }),
                    item: if with_item {
                        MessageField::some(Item {
                            uri: Some(uri.to_owned()),
                            ..Default::default()
                        })
                    } else {
                        MessageField::none()
                    },
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

/// Un pedido al rootlist que **no tira el cuerpo de los rechazos**.
///
/// El cliente de librespot convierte toda respuesta que no sea 2xx en un
/// error que sólo lleva el status, así que un rechazo sin explicación obliga
/// a `reqwest`. Es la misma razón por la que existe `probe_refusal`.
#[cfg(debug_assertions)]
fn post_rootlist(session: &Session, path: &str, body: Vec<u8>) -> (u16, String) {
    let owned = session.clone();
    let route = path.to_owned();
    match call(session, async move {
        let base = owned.spclient().base_url().await.map_err(|e| e.to_string())?;
        let token = owned.login5().auth_token().await.map_err(|e| e.to_string())?;
        let authorization = format!("{} {}", token.token_type, token.access_token);
        let client_token = owned.spclient().client_token().await.unwrap_or_default();
        let url = format!("{base}{route}?product=0&country={}&salt=1", owned.country());

        let response = reqwest::Client::new()
            .post(url)
            .header(reqwest::header::AUTHORIZATION, authorization)
            .header("client-token", client_token)
            .header(
                reqwest::header::CONTENT_TYPE,
                "application/x-www-form-urlencoded",
            )
            .body(body)
            .send()
            .await
            .map_err(|e| format!("la red: {e}"))?;

        let status = response.status().as_u16();
        let bytes = response.bytes().await.map_err(|e| format!("el cuerpo: {e}"))?;
        Ok((status, describe_bytes(&bytes)))
    }) {
        Ok(result) => result,
        Err(e) => (0, format!("ERROR: {e}")),
    }
}

// ---------------------------------------------------------------------------
// El jam: la puerta de la sesión compartida
// ---------------------------------------------------------------------------

/// `true` when the environment asks for the jam probe.
///
/// **El jam no es una playlist: es una sesión.** El servicio lo llama
/// `social-connect` —"Social Listening" para el servicio— y el cliente de
/// escritorio le habla con rutas de la forma `servicio/vN/método`:
/// `social-connect/v2/sessions/current`, `social-connect/v2/session_update`,
/// `social-connect/v2/sessions/current_or_new?activate=…`.
///
/// La puerta **no se adivinó**: salió de los strings del `Spotify.dll` del
/// cliente de escritorio, que las trae enteras, y de ahí salió también el
/// nombre del proto que las describe (`social_connect_v2.proto`, volcado con
/// `scripts/proto-dump.ts`). Lo que falta —y lo que esta sonda mide— es si esa
/// puerta existe **para una sesión de streaming** y qué contesta.
///
/// Un `404` dice que el camino está mal; un `405` que el router lo conoce pero
/// no con ese verbo; un `200` que la puerta está abierta. La diferencia entre
/// esas tres cosas es lo que separa un camino inventado de uno real, y por eso
/// se miden las dos: no se mira el cuerpo, que es lo que más miente.
#[cfg(debug_assertions)]
pub fn jam_requested() -> bool {
    std::env::var("STARLESS_SP_JAM")
        .map(|value| value != "0" && !value.is_empty())
        .unwrap_or(false)
}

/// Crear una sesión de jam **sí escribe en la cuenta**.
///
/// Va detrás de un ambiente aparte, y no como una bandera más, porque la
/// diferencia importa: una lectura no le cambia nada a nadie, y una sesión de
/// jam viva se le ve a la persona que la está probando —aparece en el cliente
/// de Spotify y en la lista de sesiones— hasta que alguien la cierre.
#[cfg(debug_assertions)]
pub fn jam_create_requested() -> bool {
    std::env::var("STARLESS_SP_JAM_CREATE")
        .map(|value| value != "0" && !value.is_empty())
        .unwrap_or(false)
}

/// La medición corta: **¿la cola del jam aparece cuando alguien mete una
/// canción?**
///
/// Son tres pedidos —leer la cola, mandar el comando, volver a leerla— y
/// nada más. Existe por una razón concreta: la sonda completa hace cien
/// pedidos seguidos y el servicio contesta `429` a partir de la sesenta, así
/// que la medición que importa llega a la puerta demasiado tarde. Con una
/// sesión activa y sin canción sonando, la cola no existe —el servicio
/// contesta `Not Found`—, y la pregunta es si el comando la crea.
///
/// `STARLESS_SP_JAM_QUEUE=1` corre esto y nada más.
#[cfg(debug_assertions)]
pub fn jam_queue_requested() -> bool {
    std::env::var("STARLESS_SP_JAM_QUEUE")
        .map(|value| value != "0" && !value.is_empty())
        .unwrap_or(false)
}

/// La medición de la puerta de avisos: `STARLESS_SP_JAM_UPDATES=1`.
///
/// **Va sola, como la de la cola.** La sonda completa hace cien pedidos
/// seguidos y el servicio corta la tanda con un `429` a partir de la sesenta;
/// esta mide ocho, y tiene que llegar.
#[cfg(debug_assertions)]
pub fn jam_updates_requested() -> bool {
    std::env::var("STARLESS_SP_JAM_UPDATES")
        .map(|value| value != "0" && !value.is_empty())
        .unwrap_or(false)
}

/// El jam, medido.
///
/// **La primera llamada crea la sesión, y no es culpa de la sonda.** El
/// camino que funciona se llama `current_or_new`: "la actual o una nueva". Es
/// una lectura que además abre una sesión si no había una —con su token de
/// join y su dueño— y por eso el cierre va **siempre**, no sólo cuando el
/// ambiente pidió crear.
///
/// De la respuesta de esa primera llamada salen el `session_id` y el
/// `join_session_token`, y de ahí salen las preguntas que dependen de ellos:
/// la puerta por la que se une la gente, y la puerta para cerrar.
///
/// Las rutas que ya se midsieron y contestaron `404` se vuelven a medir: son
/// baratas, y una ruta que un día conteste `200` es un dato, no una curiosidad.
#[cfg(debug_assertions)]
pub fn run_jam_probe(app: tauri::AppHandle) {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(session) = crate::selftest::wait_for_session(&app) else {
            log::error!("SP_JAM: la sesión no llegó a conectar");
            return;
        };

        log::info!("=== DIAGNOSTIC: sonda del jam ===");

        // **Primero por la misma puerta que usa la app.** Todo lo de abajo habla
        // con `reqwest` y trae el cuerpo de todas las respuestas, que es lo que
        // hace falta para *medir*. Lo que hace la pantalla es otra cosa: la
        // función de producción, que habla con el cliente de librespot. Las dos
        // tienen que funcionar, y la que no se puede ver desde el log es
        // justamente la segunda.
        let app_session = super::jam_session(&session, true);

        // **La medición corta va primero y sola**: son tres pedidos, y con la
        // sonda completa el servicio corta la tanda con un `429` antes de
        // llegar.
        if jam_queue_requested() {
            let session_id = app_session
                .as_ref()
                .map(|found| found.session_id.clone())
                .unwrap_or_default();

            if !session_id.is_empty() {
                jam_probe_queue_only(&session, &session_id, &app);
            } else {
                log::error!("SP_JAM: no hay sesión para medir la cola");
            }

            log::info!("=== DIAGNOSTIC: fin de la sonda del jam ===");
            return;
        }

        // **La puerta de avisos, sola.** Son ocho pedidos y miden la puerta que
        // el cliente de escritorio usa para saber quién se une.
        if jam_updates_requested() {
            let session_id = app_session
                .as_ref()
                .map(|found| found.session_id.clone())
                .unwrap_or_default();

            if session_id.is_empty() {
                log::error!("SP_JAM: no hay sesión para medir la puerta de avisos");
            } else {
                jam_probe_updates(&session, &session_id);
            }

            log::info!("=== DIAGNOSTIC: fin de la sonda del jam ===");
            return;
        }

        match &app_session {
            Ok(found) => log::info!(
                "SP_JAM: la función de la app devolvió la sesión {} · {} participantes · código {:?}",
                found.session_id,
                found.session_members.len(),
                found.join_session_token
            ),
            Err(e) => log::error!("SP_JAM: la función de la app falló: {e}"),
        }

        // La puerta que existe. Todo lo demás depende de su respuesta.
        let current = jam_ask(
            &session,
            "lectura",
            "la sesión actual o una nueva",
            &reqwest::Method::GET,
            "/social-connect/v2/sessions/current_or_new?activate=false",
            None,
        );

        let payload = current
            .as_ref()
            .and_then(|(_, bytes)| serde_json::from_slice::<serde_json::Value>(bytes).ok());

        let session_id = payload.as_ref().and_then(|value| find_key(value, "session_id"));
        let join_token = payload
            .as_ref()
            .and_then(|value| find_key(value, "join_session_token"));
        let join_uri = payload.as_ref().and_then(|value| find_key(value, "join_session_uri"));
        let join_url = payload.as_ref().and_then(|value| find_key(value, "join_session_url"));

        // El id de un participante: es lo que identifica a alguien **dentro**
        // de la sesión, y es lo que las puertas de miembro y de expulsión
        // necesitan. No es el nombre de la cuenta.
        let member_id = payload
            .as_ref()
            .and_then(|value| find_first_member_id(value))
            .unwrap_or_default();

        // El id del dispositivo, que el cliente de escritorio manda en la
        // activación (`…current_or_new?activate=…&local_device_id=`) y en la
        // puerta de comandos. librespot lo tiene a mano.
        let device = session.device_id().to_owned();

        log::info!(
            "SP_JAM: session_id={session_id:?} · join_session_token={join_token:?} · join_session_uri={join_uri:?} · join_session_url={join_url:?}"
        );

        // La puerta por la que se une la gente: es la que se comparte, y es la
        // que decide si el jam es un sistema o una sala de espera vacía.
        //
        // El `GET` contesta `405`, y eso no es un fallo: es el router diciendo
        // "esta dirección existe y no con ese verbo". Así que el verbo se
        // busca, con y sin cuerpo.
        if let Some(token) = &join_token {
            let route = format!("/social-connect/v2/sessions/join/{token}");

            jam_ask(
                &session,
                "join",
                "unirse con el token, con GET",
                &reqwest::Method::GET,
                &route,
                None,
            );
            jam_ask(
                &session,
                "join",
                "unirse con el token, con POST",
                &reqwest::Method::POST,
                &route,
                None,
            );
            jam_ask(
                &session,
                "join",
                "unirse con el token, con POST y cuerpo",
                &reqwest::Method::POST,
                &route,
                Some(b"{}"),
            );
        }

        // Activar: el mismo camino, con `activate=true`. La creación es un
        // `GET`, y mandarlo por `POST` contesta `405` —el router lo rechaza—.
        if jam_create_requested() {
            jam_ask(
                &session,
                "activar",
                "la sesión nueva, activada",
                &reqwest::Method::GET,
                "/social-connect/v2/sessions/current_or_new?activate=true",
                None,
            );

            // **La cola del jam no está enseguida.** La primera vez que se midió
            // —con la sesión activada cinco minutos antes— la cola estaba, con
            // trescientas canciones; con la sesión activada hace cinco segundos
            // el servicio contesta `Not Found`. Lo que se puede medir es el
            // tiempo, y por eso se espera antes de leer.
            log::info!("SP_JAM: se esperan 10 s a que la cola del jam exista");
            std::thread::sleep(std::time::Duration::from_secs(10));
        } else {
            log::info!("SP_JAM: sin STARLESS_SP_JAM_CREATE no se activa ninguna sesión");
        }

        // La sesión por su id, con barra y sin barra: la barra final cambia
        // el camino en estos routers, y no hay que suponerlo.
        //
        // El `GET` contesta `405` en los dos casos, así que la ruta existe y
        // el verbo es otro: se prueba el `POST` —que en este servicio es el
        // que modifica una sesión— con y sin cuerpo.
        if let Some(id) = &session_id {
            jam_ask(
                &session,
                "lectura",
                "la sesión por su id",
                &reqwest::Method::GET,
                &format!("/social-connect/v2/sessions/{id}"),
                None,
            );
            jam_ask(
                &session,
                "lectura",
                "la sesión por su id, con barra",
                &reqwest::Method::GET,
                &format!("/social-connect/v2/sessions/{id}/"),
                None,
            );
            jam_ask(
                &session,
                "escritura",
                "la sesión por su id, con POST",
                &reqwest::Method::POST,
                &format!("/social-connect/v2/sessions/{id}"),
                None,
            );
            jam_ask(
                &session,
                "escritura",
                "la sesión por su id, con POST y cuerpo",
                &reqwest::Method::POST,
                &format!("/social-connect/v2/sessions/{id}"),
                Some(b"{}"),
            );

            // La cola: es una lista (`spotify:list:jam-list:`), y se pregunta
            // si el servicio de playlists la sirve, que es lo que contestaría
            // si fuera una playlist común.
            jam_ask(
                &session,
                "cola",
                "la cola, por el servicio de playlists",
                &reqwest::Method::GET,
                &format!("/playlist/v2/playlist/{id}"),
                None,
            );

            // Y si no es una playlist, es una *lista*: el servicio de listas es
            // `playlist/spotify.list.v1.ListReadService/GetLists` —también
            // del cliente de escritorio—, y su identificador es la URI.
            // Cuál es la URI de la cola no se sabe: se prueban las dos cosas
            // que la sesión trae, y sobre todo **la respuesta sin
            // parámetros**, que dice qué es lo que el servicio echa de menos.
            jam_ask(
                &session,
                "cola",
                "el servicio de listas, sin parámetros",
                &reqwest::Method::GET,
                "/playlist/spotify.list.v1.ListReadService/GetLists",
                None,
            );
            jam_ask(
                &session,
                "cola",
                "la cola como lista, con el id de la sesión",
                &reqwest::Method::GET,
                &format!(
                    "/playlist/spotify.list.v1.ListReadService/GetLists?uri=spotify:list:jam-list:{id}"
                ),
                None,
            );

            if let Some(token) = &join_token {
                jam_ask(
                    &session,
                    "cola",
                    "la cola como lista, con el token",
                    &reqwest::Method::GET,
                    &format!(
                        "/playlist/spotify.list.v1.ListReadService/GetLists?uri=spotify:list:jam-list:{token}"
                    ),
                    None,
                );
            }

            // Y si la cola viviera en la sesión, con sus propias rutas.
            jam_ask(
                &session,
                "cola",
                "la cola, dentro de la sesión",
                &reqwest::Method::GET,
                &format!("/social-connect/v2/sessions/{id}/queue"),
                None,
            );

            // El servicio de listas es `POST`, no `GET` —el `405` lo dice— y
            // el cuerpo es lo que falta. Un cuerpo vacío dice qué echa de
            // menos el servicio; los dos identificadores que la sesión trae
            // se prueban después, en JSON y a pelo.
            jam_ask(
                &session,
                "cola",
                "el servicio de listas, con POST y cuerpo vacío",
                &reqwest::Method::POST,
                "/playlist/spotify.list.v1.ListReadService/GetLists",
                Some(b"{}"),
            );
            jam_ask(
                &session,
                "cola",
                "el servicio de listas, con POST y el id de la sesión",
                &reqwest::Method::POST,
                "/playlist/spotify.list.v1.ListReadService/GetLists",
                Some(
                    format!(
                        r#"{{"requests":[{{"identifier":{{"uri":"spotify:list:jam-list:{id}"}}}}]}}"#
                    )
                    .as_bytes(),
                ),
            );

            // Y el mismo pedido **en protobuf**, que es como lo habla el
            // servicio: el JSON de arriba lo rechazó con un mensaje que decía
            // qué faltaba —"RequestedFields must not be empty"—, y ese
            // mensaje viene en el `RequestedFields` del `RequestOptions`.
            for (que, slug, uri) in [
                (
                    "el id de la sesión",
                    "sesion",
                    format!("spotify:list:jam-list:{id}"),
                ),
                (
                    "el token",
                    "token",
                    join_token
                        .as_ref()
                        .map(|token| format!("spotify:list:jam-list:{token}"))
                        .unwrap_or_default(),
                ),
            ] {
                if uri.ends_with(':') {
                    continue;
                }

                let answered = jam_ask_typed(
                    &session,
                    "cola",
                    &format!("la cola como lista, en protobuf, con {que}"),
                    &reqwest::Method::POST,
                    "/playlist/spotify.list.v1.ListReadService/GetLists",
                    Some(&jam_list_request(&uri)),
                    "application/x-protobuf",
                );

                // La respuesta del servicio de listas es **protobuf**, y
                // grande: el log la muestra recortada, así que se guarda
                // entera en disco para poder mirarla sin volver a medir.
                //
                // **La cola y la respuesta de error van a archivos distintos.**
                // El servicio contesta `Not Found` cuando el jam todavía no
                // tiene cola, y un archivo con eso adentro no es una cola: es
                // lo que el test del decodificador lee, y si lo leyera
                // estaría probando que el decodificador falla.
                if let Some((status, bytes)) = answered {
                    let is_queue = super::jamlist::tracks(&bytes).is_some();
                    let name = if is_queue {
                        format!("jam-list-{slug}.bin")
                    } else {
                        format!("jam-list-{slug}-error.bin")
                    };
                    let path = jam_scratch_path(&name);
                    let written = std::fs::write(&path, &bytes).is_ok();

                    log::info!(
                        "SP_JAM: [cola] {que} → {status} · {} bytes · {}",
                        bytes.len(),
                        describe_strings(&bytes)
                    );

                    if written {
                        log::info!("SP_JAM: [cola] la respuesta entera quedó en {path}");
                    }
                }
            }

            // El verbo para modificar una sesión: el `POST` está descartado
            // (`405`), así que se prueban los otros dos.
            jam_ask(
                &session,
                "escritura",
                "la sesión por su id, con PUT",
                &reqwest::Method::PUT,
                &format!("/social-connect/v2/sessions/{id}"),
                Some(b"{}"),
            );
            jam_ask(
                &session,
                "escritura",
                "la sesión por su id, con PATCH",
                &reqwest::Method::PATCH,
                &format!("/social-connect/v2/sessions/{id}"),
                Some(b"{}"),
            );

            // **Las puertas que el cliente de escritorio usa y esta sonda no ha
            // medido.** Salieron de los strings del `Spotify.dll`, en el bloque
            // del jam: `social-connect/v2/sessions/` + `…/leave?reason=`,
            // `…/commands/from/`, y —en el cliente del partner API— `…/kick` y
            // `…/member/`.
            //
            // Se miden por su forma, no por su contenido: un `404` dice que el
            // camino no existe y un `405` que el router lo conoce pero no con
            // ese verbo. La diferencia entre las dos cosas es lo que separa un
            // camino inventado de uno real, y es lo único que se afirma acá.
            jam_probe_paths(&session, id, &member_id, &device);
            jam_probe_writes(&session, id, &device);
            jam_probe_queue_write(&session, id, &device, &app);
        }

        // Los permisos de la sesión, que son dos puertas con barra.
        for route in [
            "/social-connect/v2/sessions/current/queue_only_mode",
            "/social-connect/v2/sessions/current/queue_only_mode/",
            "/social-connect/v2/sessions/current/volume_control",
            "/social-connect/v2/sessions/current/volume_control/",
        ] {
            jam_ask(
                &session,
                "lectura",
                "los permisos de la sesión",
                &reqwest::Method::GET,
                route,
                None,
            );
        }

        // La actualización: el router la conoce —`411 Length Required` la delata
        // aunque no la entienda— pero exige un cuerpo.
        jam_ask(
            &session,
            "escritura",
            "la actualización, con cuerpo",
            &reqwest::Method::POST,
            "/social-connect/v2/session_update",
            Some(b"{}"),
        );

        // Y ahora cerrar, que es lo que deja la cuenta como estaba.
        //
        // **Por la función de la app primero**: es la que aprieta el botón, y
        // cerrar dos veces la misma sesión no es una medición, es ruido.
        let closed_by_app = match &app_session {
            Ok(found) => match super::jam_leave(&session, &found.session_id) {
                Ok(()) => {
                    log::info!(
                        "SP_JAM: la función de la app cerró la sesión {}",
                        found.session_id
                    );
                    true
                }
                Err(e) => {
                    log::error!("SP_JAM: la función de la app no pudo cerrar: {e}");
                    false
                }
            },
            Err(_) => false,
        };

        if !closed_by_app {
            if let Some(id) = &session_id {
                jam_end(&session, id);
            }
        }

        // Y la última puerta: la de salir. Va al final porque **salir cierra la
        // sesión**, y midiendo antes se rompería todo lo de arriba.
        jam_probe_leave(&session, session_id.as_deref().unwrap_or_default());

        log::info!("=== DIAGNOSTIC: fin de la sonda del jam ===");
    });
}

/// Las puertas del jam que el cliente de escritorio usa y que esta sonda no
/// había medido.
///
/// **Salieron de los strings del `Spotify.dll`**, del bloque del jam: la puerta
/// de comandos (`…/sessions/<id>/commands/from/<device>`), la de los
/// participantes (`…/member/<id>`) y la de la expulsión (`…/kick`). Se miden
/// por su forma y no por su contenido: un `404` dice que el camino no existe,
/// un `405` que el router lo conoce pero no con ese verbo.
///
/// **Ninguna de estas preguntas escribe en la cuenta.** Salvo la de la salida —
/// que va aparte, y al final— una puerta que existe y contesta `405` es un
/// dato; una que contesta `404` es un dato también: el camino no existe.
#[cfg(debug_assertions)]
fn jam_probe_paths(session: &Session, session_id: &str, member_id: &str, device: &str) {
    // La puerta de comandos: por donde el jam manda una instrucción a un
    // dispositivo. El `device` va en el camino —`commands/from/<device>`— y
    // dice de quién viene la instrucción.
    jam_ask(
        session,
        "comandos",
        "la puerta de comandos, con GET",
        &reqwest::Method::GET,
        &format!("/social-connect/v2/sessions/{session_id}/commands/from/{device}"),
        None,
    );
    jam_ask(
        session,
        "comandos",
        "la puerta de comandos, con POST",
        &reqwest::Method::POST,
        &format!("/social-connect/v2/sessions/{session_id}/commands/from/{device}"),
        Some(b"{}"),
    );

    // Los participantes y la expulsión. La forma del camino es lo que se
    // mide: las dos versiones, porque el cliente del partner API usa la
    // tercera y el jam usa la segunda.
    for route in [
        format!("/social-connect/v2/sessions/{session_id}/members"),
        format!("/social-connect/v2/sessions/{session_id}/member/{member_id}"),
        format!("/social-connect/v3/sessions/{session_id}/member/{member_id}"),
        format!("/social-connect/v2/sessions/{session_id}/kick/{member_id}"),
        format!("/social-connect/v3/sessions/{session_id}/kick/{member_id}"),
    ] {
        jam_ask(
            session,
            "participantes",
            "la puerta de un participante",
            &reqwest::Method::GET,
            &route,
            None,
        );
    }

    // La lectura de la sesión con el id del dispositivo local: el cliente de
    // escritorio lo manda al activar, y contesta si la sesión recuerda
    // cuál es el dispositivo anfitrión.
    jam_ask(
        session,
        "lectura",
        "la sesión, con el dispositivo local",
        &reqwest::Method::GET,
        &format!("/social-connect/v2/sessions/current_or_new?activate=false&local_device_id={device}"),
        None,
    );

    // **La lectura por id**: la puerta que el panel necesita para no perder
    // el ritmo. `current_or_new` crea la sesión si no hay ninguna, así que
    // usarla para refrescar crearía un jam donde no hay ninguno. Si esta
    // puerta existe, el panel puede preguntar por la sesión que ya tiene.
    jam_ask(
        session,
        "lectura",
        "la sesión, por id",
        &reqwest::Method::GET,
        &format!("/social-connect/v2/sessions/{session_id}"),
        None,
    );
}

/// Las escrituras: **las puertas queWRITINGen la cola compartida**.
///
/// La cola del jam es una lista (`spotify:list:jam-list:<id>`) y se lee con
/// `GetLists`. Cómo se *escribe* es lo que no está medido, y hay dos candidatas
/// que salen de lo que el repo ya sabe hacer:
///
/// 1. La misma puerta de playlist4 que usa el repo para crear y modificar
///    playlists — `POST /playlist/v2/playlist/<id>/changes` con un
///    `ListChanges`— pero con el id de la lista del jam. El cliente de
///    escritorio tiene la cadena `jam-` al lado de `spotify:list:jam-list:`,
///    y eso hace sospechar que el id de la lista en playlist4 es `jam-<id>`.
/// 2. La puerta de comandos, que existe (contestó `400 missing or empty
///    command field`) y que el cliente de escritorio llama `redirectPlayerCommand`.
///
/// Se miden las dos. La primera con un `ListChanges` de verdad —el mismo
/// `ADD` con `add_last` que el repo manda a una playlist—; la segunda con el
/// cuerpo que el cliente de escritorio arma: `{"command":%s,...}`.
#[cfg(debug_assertions)]
fn jam_probe_writes(session: &Session, session_id: &str, device: &str) {
    let account = session.username().to_owned();
    let timestamp = now_millis();
    let track = "spotify:track:3b5E38f6Dbx28IVof4oeAA";

    // **Primero la lectura, y de ella la revisión.** Una escritura sin la
    // revisión es un `400` a un cuerpo que el servicio acepta: el cuerpo
    // está bien, lo que no está bien es contra qué versión se escribe.
    let uri = format!("spotify:list:jam-list:{session_id}");
    let listed = jam_ask_typed(
        session,
        "cola",
        "leer la cola del jam",
        &reqwest::Method::POST,
        "/playlist/spotify.list.v1.ListReadService/GetLists",
        Some(&super::jamlist::request(&uri)),
        "application/x-protobuf",
    );

    let revision = listed
        .as_ref()
        .and_then(|(_, bytes)| super::jamlist::revision(bytes))
        .unwrap_or_default();
    let before = listed
        .as_ref()
        .and_then(|(_, bytes)| super::jamlist::tracks(bytes))
        .map(|tracks| tracks.len())
        .unwrap_or_default();

    log::info!(
        "SP_JAM: la cola del jam tiene {before} canciones y una revisión de {} bytes",
        revision.len()
    );

    let changes = ListChanges {
        base_revision: Some(revision.clone()),
        deltas: vec![delta(
            vec![Op {
                kind: Some(EnumOrUnknown::new(op::Kind::ADD)),
                add: MessageField::some(Add {
                    add_last: Some(true),
                    items: vec![Item {
                        uri: Some(track.to_owned()),
                        attributes: MessageField::some(ItemAttributes {
                            added_by: Some(account.clone()),
                            timestamp: Some(timestamp),
                            ..Default::default()
                        }),
                        ..Default::default()
                    }],
                    ..Default::default()
                }),
                ..Default::default()
            }],
            &account,
            timestamp,
        )],
        want_resulting_revisions: Some(true),
        want_sync_result: Some(true),
        nonces: vec![1],
        ..Default::default()
    };

    let body = changes.write_to_bytes().unwrap_or_default();

    for candidate in [
        format!("jam-{session_id}"),
        session_id.to_owned(),
        format!("spotify:list:jam-list:{session_id}"),
        // Un id que no existe de ninguna manera: la **comparación**. Si el
        // jam contestara lo mismo que este, los tres de arriba no serían una
        // lista y el `400` no estaría hablando de la lista del jam.
        "4uLU6hMCjMI75M1A2tKUQC".to_owned(),
    ] {
        let answered = jam_ask_typed(
            session,
            "escritura",
            "escribir en la cola del jam",
            &reqwest::Method::POST,
            &format!("/playlist/v2/playlist/{candidate}/changes"),
            Some(&body),
            "application/x-www-form-urlencoded",
        );

        // Y después de escribir, se lee otra vez: **la única prueba de que
        // la canción entró es que la lista la tiene.**
        let after = jam_ask_typed(
            session,
            "cola",
            "releer la cola del jam",
            &reqwest::Method::POST,
            "/playlist/spotify.list.v1.ListReadService/GetLists",
            Some(&super::jamlist::request(&uri)),
            "application/x-protobuf",
        )
        .and_then(|(_, bytes)| super::jamlist::tracks(&bytes))
        .map(|tracks| tracks.len())
        .unwrap_or_default();

        let status = answered.as_ref().map(|(status, _)| *status).unwrap_or(0);
        log::info!(
            "SP_JAM: la escritura en `{candidate}` → {status} · la cola pasó de {before} a {after} canciones"
        );
    }

    // La puerta de comandos, con el cuerpo que arma el cliente de escritorio:
    // `{"command":%.*s,"connection_type":"%s","intent_id":"%s"}`.
    for body in [
        "{\"command\":{}}".to_owned(),
        format!(
            "{{\"command\":{{\"type\":\"PLAY\",\"context_uri\":\"{track}\"}},\"connection_type\":\"LOCAL\",\"intent_id\":\"jam\"}}"
        ),
        format!(
            "{{\"player_command_json\":\"{{\\\"type\\\":\\\"PLAY\\\"}}\",\"target_device_id\":\"{device}\",\"command_id\":\"starless-probe\"}}"
        ),
    ] {
        jam_ask(
            session,
            "comandos",
            "mandar un comando a la sesión",
            &reqwest::Method::POST,
            &format!("/social-connect/v2/sessions/{session_id}/commands/from/{device}"),
            Some(body.as_bytes()),
        );
    }

    // El estado del dispositivo: si el servidor guarda el estado de este
    // dispositivo, la puerta existe y es lo que un invitado mira para seguir
    // al anfitrión.
    jam_ask(
        session,
        "estado",
        "el estado del dispositivo",
        &reqwest::Method::GET,
        &format!("/connect-state/v1/devices/{device}"),
        None,
    );
    jam_ask(
        session,
        "estado",
        "el grupo de dispositivos",
        &reqwest::Method::GET,
        "/connect-state/v1/cluster",
        None,
    );

    // El grupo de dispositivos se guarda entero: son casi cuarenta mil bytes y
    // el log los corta. Lo que importa es si trae el estado de reproducción
    // —el contexto, la canción y dónde va— y eso no se lee de una línea
    // recortada.
    if let Some((status, bytes)) = jam_ask(
        session,
        "estado",
        "el grupo de dispositivos, completo",
        &reqwest::Method::GET,
        "/connect-state/v1/cluster",
        None,
    ) {
        let path = jam_scratch_path("connect-cluster.json");
        std::fs::write(&path, &bytes).ok();
        log::info!(
            "SP_JAM: el grupo de dispositivos quedó en {path} ({status}, {} bytes)",
            bytes.len()
        );
    }
}

/// **La puerta que falta: escribir en la cola compartida del jam.**
///
/// Lo que se sabe hasta ahora es que la cola **no** es una playlist de playlist4,
/// y que el `400` de `POST /playlist/v2/playlist/<id>/changes` no dice "el cuerpo
/// está mal": dice que **el id no tiene la forma que playlist4 acepta**. La
/// comparación lo prueba —un id de base62 que no existe contesta `404`, y el id
/// de la sesión, que son 32 hex, contesta `400`—. playlist4 sólo acepta ids de
/// 22 caracteres de base62, así que la cola del jam —que se lee como
/// `spotify:list:jam-list:<id>`— no tiene id de playlist4: no se escribe por
/// ahí.
///
/// Lo que sí tiene la cola es un **servicio**: el de la lectura es
/// `playlist/spotify.list.v1.ListReadService/GetLists`, en el host `playlist`.
/// El de la escritura no aparece en el cliente de escritorio —su descriptor no
/// está embebido, así que no hay forma de volcarlo—, pero los nombres de los
/// servicios sí están, y son los que se preguntan acá.
///
/// **Un cuerpo vacío no escribe nada**, así que la matriz es segura: lo que
/// contesten los status dice si el servicio existe. Un `404` es que no existe;
/// un `405` es que el router lo conoce pero no con ese verbo; un `400` es que el
/// método existe y el cuerpo no es el suyo —que es el dato bueno, porque el
/// error dice qué falta—; y un `200` es que el método se accepts.
#[cfg(debug_assertions)]
fn jam_probe_queue_write(
    session: &Session,
    session_id: &str,
    device: &str,
    app: &tauri::AppHandle,
) {
    let track = "spotify:track:3b5E38f6Dbx28IVof4oeAA";

    // **1. La puerta de comandos del jam, con la forma que el servicio
    // entiende.**
    //
    // El error "Could not parse command" no era por el tipo de comando: era
    // por la **forma**. El comando no es un objeto con `type`, es un objeto con
    // `endpoint`, y el `command` del sobre es ese objeto —no una cadena—:
    //
    //   {"command": {"endpoint": "add_to_queue", "track": {"uri": "spotify:track:…"},
    //                "options": {…}, "logging_params": {…}},
    //    "connection_type": "wlan", "intent_id": "<hex>"}
    //
    // Los endpoints son los del player: `add_to_queue`, `play`, `pause`,
    // `skip_next`, `skip_prev`, `seek_to`, `set_queue`… y `add_to_queue` es
    // el que mete una canción en la cola del jam.
    let commands = format!("/social-connect/v2/sessions/{session_id}/commands/from/{device}");

    let now = crate::spclient::now_millis();
    // El `intent_id` y el `command_id` son hex de 16 bytes. Que sean
    // aleatorios no importa para la medición; que estén es lo que importa.
    let intent = "a1b2c3d4e5f60718293a4b5c6d7e8f90";

    for (what, command) in [
        (
            "add_to_queue, con la uri de la pista",
            format!(
                "{{\"endpoint\":\"add_to_queue\",\"track\":{{\"uri\":\"{track}\"}},\"options\":{{\"override_restrictions\":false,\"only_for_local_device\":false,\"system_initiated\":false}},\"logging_params\":{{\"command_initiated_time\":{now},\"command_received_time\":{now},\"page_instance_ids\":[],\"interaction_ids\":[],\"device_identifier\":\"{device}\",\"command_id\":\"{intent}\"}}}}"
            ),
        ),
        (
            "add_to_queue, con la uri y el uid",
            format!(
                "{{\"endpoint\":\"add_to_queue\",\"track\":{{\"uri\":\"{track}\",\"uid\":\"cb970d145ffcc3721d38\"}},\"options\":{{\"override_restrictions\":false,\"only_for_local_device\":false,\"system_initiated\":false}},\"logging_params\":{{\"command_initiated_time\":{now},\"command_received_time\":{now},\"page_instance_ids\":[],\"interaction_ids\":[],\"device_identifier\":\"{device}\",\"command_id\":\"{intent}\"}}}}"
            ),
        ),
        (
            "add_to_queue, sin logging_params",
            format!(
                "{{\"endpoint\":\"add_to_queue\",\"track\":{{\"uri\":\"{track}\"}}}}"
            ),
        ),
        (
            "play, con la uri de la pista",
            format!(
                "{{\"endpoint\":\"play\",\"track\":{{\"uri\":\"{track}\"}},\"options\":{{\"override_restrictions\":false,\"only_for_local_device\":false,\"system_initiated\":false}},\"logging_params\":{{\"command_initiated_time\":{now},\"command_received_time\":{now},\"page_instance_ids\":[],\"interaction_ids\":[],\"device_identifier\":\"{device}\",\"command_id\":\"{intent}\"}}}}"
            ),
        ),
        (
            "pause",
            format!(
                "{{\"endpoint\":\"pause\",\"options\":{{\"override_restrictions\":false,\"only_for_local_device\":false,\"system_initiated\":false}},\"logging_params\":{{\"command_initiated_time\":{now},\"command_received_time\":{now},\"page_instance_ids\":[],\"interaction_ids\":[],\"device_identifier\":\"{device}\",\"command_id\":\"{intent}\"}}}}"
            ),
        ),
        (
            "skip_next",
            format!(
                "{{\"endpoint\":\"skip_next\",\"options\":{{\"override_restrictions\":false,\"only_for_local_device\":false,\"system_initiated\":false}},\"logging_params\":{{\"command_initiated_time\":{now},\"command_received_time\":{now},\"page_instance_ids\":[],\"interaction_ids\":[],\"device_identifier\":\"{device}\",\"command_id\":\"{intent}\"}}}}"
            ),
        ),
    ] {
        let body = format!(
            "{{\"command\":{command},\"connection_type\":\"wlan\",\"intent_id\":\"{intent}\"}}"
        );

        jam_ask(
            session,
            "comandos",
            what,
            &reqwest::Method::POST,
            &commands,
            Some(body.as_bytes()),
        );
    }

    // **2. Los servicios del host `playlist`.** El de la lectura se sabe; los
    // de la escritura se preguntan por su forma.
    //
    // **El cuerpo tiene que tener bytes.** Un cuerpo de cero bytes no manda
    // `Content-Length` y contesta `411 Length Required` —la respuesta del
    // front door, que no dice nada del servicio—. Por eso el cuerpo es un
    // protobuf válido y vacío: dos bytes que el servicio puede leer.
    for service in [
        "spotify.list.v1.ListWriteService",
        "spotify.list.v1.ListService",
        "spotify.list.v1.ListEditService",
        "spotify.list.v1.ListMutationService",
        "spotify.list.v1.ListItemService",
        "spotify.playlist_esperanto.proto.PlaylistService",
        "spotify.playlist_esperanto.proto.PlaylistDataService",
        "spotify.playlist_esperanto.proto.PlaylistPlayService",
    ] {
        for method in ["Modify", "AddItems", "Add", "WriteLists", "PutLists", "AddToList"] {
            let route = format!("/playlist/{service}/{method}");

            jam_ask_typed(
                session,
                "escritura",
                "un servicio de escritura de listas",
                &reqwest::Method::POST,
                &route,
                Some(b"\x0a\x00"),
                "application/x-protobuf",
            );

            // El servicio corta con `429` si le llegan many requests juntos:
            // la matriz son decenas, y una tanda que se corta a mitad no
            // sirve para nada.
            std::thread::sleep(std::time::Duration::from_millis(150));
        }
    }

    // **El control**: el servicio de la lectura, que se sabe que existe. Si
    // este contesta `200`, la matriz se lee bien; si contesta `404`, el
    // problema es otro y la matriz no dice nada.
    jam_ask_typed(
        session,
        "escritura",
        "el control: el servicio que se sabe que existe",
        &reqwest::Method::POST,
        "/playlist/spotify.list.v1.ListReadService/GetLists",
        Some(b"\x0a\x00"),
        "application/x-protobuf",
    );

    // **3. Las puertas de la cola dentro del propio servicio del jam.** El
    // cliente de escritorio tiene el nombre `jam.patch_track`, y `queue` ya se
    // midió —`404`— pero en singular y con más segmentos no.
    for route in [
        format!("/social-connect/v2/sessions/{session_id}/tracks"),
        format!("/social-connect/v2/sessions/{session_id}/track"),
        format!("/social-connect/v2/sessions/{session_id}/items"),
        format!("/social-connect/v2/sessions/{session_id}/queue/items"),
        format!("/social-connect/v2/sessions/{session_id}/queue/add"),
        format!("/social-connect/v2/sessions/{session_id}/patch_track"),
        format!("/social-connect/v2/sessions/{session_id}/jam/patch_track"),
    ] {
        jam_ask(
            session,
            "cola",
            "una puerta de la cola del jam",
            &reqwest::Method::POST,
            &route,
            Some(b"{}"),
        );
    }

    // **4. El verbo `PATCH` sobre playlist4.** El cliente de escritorio tiene
    // las dos cadenas `PATCH` y `Accept-Patch` al lado de la URL de playlist4,
    // y eso es una pista que la sonda no había seguido.
    for id in [session_id.to_owned(), format!("jam-{session_id}")] {
        jam_ask(
            session,
            "escritura",
            "la cola del jam, con PATCH",
            &reqwest::Method::PATCH,
            &format!("/playlist/v2/playlist/{id}"),
            Some(b"{}"),
        );
    }

    // **5. Y ahora la función de producción**, que es la que aprieta el botón
    // de la app: el mismo comando, pero armado por el código que quedó y no a
    // mano. Si esta contesta bien, lo que se midió arriba es lo que la app
    // manda.
    jam_probe_queue_only(session, session_id, app);
}

/// La medición de la cola: **leer, mandar el comando, volver a leer**.
///
/// La comparación es lo que dice si el comando sirvió: que la cola haya
/// cambiado, o que haya **aparecido** —que es lo que pasa si el servicio la
/// crea cuando alguien mete una canción—.
///
/// Y antes de eso hay una prueba más: **que el anfitrión esté sonando**. La
/// cola del jam es la cola del player del anfitrión, y un player que no está
/// sonando no tiene cola. Con algo sonando, la cola del jam tendría que estar.
#[cfg(debug_assertions)]
fn jam_probe_queue_only(
    session: &Session,
    session_id: &str,
    app: &tauri::AppHandle,
) {
    let before = jam_queue_tracks(session, session_id);
    log::info!(
        "SP_JAM: [cola] antes de nada: {} canciones",
        before.as_ref().map(|c| c.len()).unwrap_or(0)
    );

    // **La prueba: que el anfitrión esté sonando.** Con el volumen en cero,
    // porque esto es una medición y no un concierto.
    let saved_volume = crate::settings::saved_volume();
    jam_probe_play(session, app, "3b5E38f6Dbx28IVof4oeAA");
    std::thread::sleep(std::time::Duration::from_secs(15));

    let playing = jam_queue_tracks(session, session_id);
    log::info!(
        "SP_JAM: [cola] con el anfitrión sonando: {} canciones",
        playing.as_ref().map(|c| c.len()).unwrap_or(0)
    );

    match super::jam_add_to_queue(session, session_id, "3b5E38f6Dbx28IVof4oeAA") {
        Ok(()) => log::info!(
            "SP_JAM: [comandos] la función de la app agregó la canción al jam y el servicio la aceptó"
        ),
        Err(e) => log::error!("SP_JAM: [comandos] la función de la app no pudo agregar: {e}"),
    }

    // **Un momento antes de volver a leer.** La cola del jam la escribe el
    // servicio, no el comando: el comando entra y el servicio lo aplica
    // después.
    std::thread::sleep(std::time::Duration::from_secs(3));

    let after = jam_queue_tracks(session, session_id);
    log::info!(
        "SP_JAM: [cola] después del comando: {} canciones",
        after.as_ref().map(|c| c.len()).unwrap_or(0)
    );

    // El volumen del usuario vuelve a ser el que era.
    if let Some(volume) = saved_volume {
        if let Some(state) = app.try_state::<crate::playback::PlaybackState>() {
            crate::playback::set_volume(&state, volume);
        }
    }

    match (&playing, &after) {
        (None, Some(after)) => log::info!(
            "SP_JAM: [cola] la cola APARECIÓ con el comando: {} canciones",
            after.len()
        ),
        (Some(playing), Some(after)) => {
            if playing.len() == after.len() && playing == after {
                log::info!("SP_JAM: [cola] la cola NO cambió: el comando entró y no la llenó");
            } else {
                log::info!(
                    "SP_JAM: [cola] la cola cambió: {} → {} canciones",
                    playing.len(),
                    after.len()
                );
                if let Some(added) = after.iter().find(|uri| !playing.contains(uri)) {
                    log::info!("SP_JAM: [cola] la canción nueva es {added}");
                }
            }
        }
        (Some(playing), None) => log::info!(
            "SP_JAM: [cola] la cola desapareció: {} → nada",
            playing.len()
        ),
        (None, None) => {
            log::info!("SP_JAM: [cola] la cola no existe ni con el anfitrión sonando ni después del comando")
        }
    }
}

/// Que el anfitrión esté "sonando" de verdad, **con el volumen en cero**.
///
/// **Son dos cosas, y las dos hacen falta.** La primera es la **radio**: la
/// app la pide al servicio cuando el usuario elige una canción de una
/// búsqueda, y esa llamada es la que le dice al servicio *qué contexto está
/// sonando* —con el lente de autoplay encima—. La segunda es la canción, que
/// el player reproduce.
///
/// **El player de librespot no tiene contexto**: `librespot-playback` no
/// publica ninguno, y `load(track_id)` es una pista suelta. El contexto lo
/// publica la radio, y por eso la cola del jam —que es el contexto del
/// anfitrión más su autoplay— existe con una radio y no existe con una pista.
///
/// El volumen lo pone en cero el que llama —y lo vuelve a poner—: la
/// medición necesita que el player esté sonando, no que se escuche.
#[cfg(debug_assertions)]
fn jam_probe_play(session: &Session, app: &tauri::AppHandle, track_id: &str) {
    let Some(state) = app.try_state::<crate::playback::PlaybackState>() else {
        log::error!("SP_JAM: no hay estado de reproducción para la prueba");
        return;
    };

    crate::playback::set_volume(&state, 0);

    // **La radio**: la llamada que publica el contexto del anfitrión.
    let context = format!("spotify:track:{track_id}");
    probe_autoplay(session, &context, &[]);

    let owned = session.clone();
    // La vida de la referencia: el futuro tiene que ser `'static`, y el id
    // viene prestado.
    let id = track_id.to_owned();
    let duration = call(session, async move {
        let uri = format!("spotify:track:{id}");
        let Ok(parsed) = SpotifyUri::from_uri(&uri) else {
            return Err("bad_track_id".to_string());
        };
        MetaTrack::get(&owned, &parsed)
            .await
            .map(|track| track.duration.max(0) as u32)
            .map_err(|e| e.to_string())
    })
    .unwrap_or(0);

    crate::playback::ensure_player(app, session);
    match crate::playback::play(&state, track_id, 0, duration) {
        Ok(()) => log::info!("SP_JAM: la prueba suena {track_id} ({duration} ms)"),
        Err(e) => log::error!("SP_JAM: la prueba no pudo sonar: {e}"),
    }
}

/// La cola del jam, leída y decodificada.
///
/// **Es la misma lectura que hace la app**, con el mismo cuerpo y el mismo
/// `content-type`: lo que se compara antes y después del comando tiene que ser
/// lo que la app ve.
#[cfg(debug_assertions)]
fn jam_queue_tracks(session: &Session, session_id: &str) -> Option<Vec<String>> {
    let uri = format!("spotify:list:jam-list:{session_id}");
    let body = jam_list_request(&uri);

    let (status, bytes) = jam_ask_typed(
        session,
        "cola",
        "la cola del jam",
        &reqwest::Method::POST,
        "/playlist/spotify.list.v1.ListReadService/GetLists",
        Some(&body),
        "application/x-protobuf",
    )?;

    if status != 200 {
        log::info!("SP_JAM: [cola] la cola del jam → {status} · {} bytes", bytes.len());
        return None;
    }

    super::jamlist::tracks(&bytes)
}

/// La puerta de salida, que es la última porque **puede cerrar la sesión**.
///
/// Se mide sobre una sesión nueva, así que lo de arriba no se rompe. Y al
/// final se cierra lo que quede: una sesión de jam viva se le ve a la persona
/// que la está probando, y eso es ruido, no un resultado.
#[cfg(debug_assertions)]
fn jam_probe_leave(session: &Session, session_id: &str) {
    log::info!(
        "SP_JAM: la puerta de salida se mide sobre una sesión nueva (la de {session_id} ya se cerró)"
    );

    let fresh = jam_ask(
        session,
        "salir",
        "una sesión nueva para medir la salida",
        &reqwest::Method::GET,
        "/social-connect/v2/sessions/current_or_new?activate=true",
        None,
    );

    let Some(id) = fresh
        .as_ref()
        .and_then(|(_, bytes)| serde_json::from_slice::<serde_json::Value>(bytes).ok())
        .and_then(|value| find_key(&value, "session_id"))
    else {
        log::error!("SP_JAM: no se pudo abrir una sesión para medir la salida");
        return;
    };

    // Las cuatro formas que se pueden pensar, con el motivo que el cliente
    // de escritorio manda en la query (`…/leave?reason=`).
    jam_ask(
        session,
        "salir",
        "salir de la sesión, con GET",
        &reqwest::Method::GET,
        &format!("/social-connect/v2/sessions/{id}/leave"),
        None,
    );
    jam_ask(
        session,
        "salir",
        "salir de la sesión, con DELETE",
        &reqwest::Method::DELETE,
        &format!("/social-connect/v2/sessions/{id}/leave"),
        None,
    );
    jam_ask(
        session,
        "salir",
        "salir de la sesión, con DELETE y motivo",
        &reqwest::Method::DELETE,
        &format!("/social-connect/v2/sessions/{id}/leave?reason=USER_LEFT"),
        None,
    );
    jam_ask(
        session,
        "salir",
        "salir de la sesión, con POST y cuerpo",
        &reqwest::Method::POST,
        &format!("/social-connect/v2/sessions/{id}/leave"),
        Some(b"{}"),
    );
    jam_ask(
        session,
        "salir",
        "salir de la sesión, en la versión 3",
        &reqwest::Method::DELETE,
        &format!("/social-connect/v3/sessions/{id}/leave?reason=USER_LEFT"),
        None,
    );

    // Lo que quede vivo se cierra, para no dejar nada abierto en la cuenta.
    jam_ask(
        session,
        "cerrar",
        "cerrar la sesión de la medición de salida",
        &reqwest::Method::DELETE,
        &format!("/social-connect/v2/sessions/{id}"),
        None,
    );
}

/// La puerta de avisos del jam: `social-connect/v2/session_update`.
///
/// **El proto la describe y el cliente la usa; Starless no.** `social_connect_v2.proto`
/// —volcado del `Spotify.dll`— tiene `SessionUpdate { session, reason }`, y
/// el motivo es lo que dice **qué pasó**: `USER_JOINED`, `USER_LEFT`,
/// `ACTIVE_DEVICE_CHANGED`, `SESSION_MEMBER_UPDATED`… Es el canal de avisos
/// del jam, y la app no lo usa: pregunta cada tres segundos, que es
/// exactamente por lo que el servicio le corta la tanda con un `429`.
///
/// La pregunta es si la puerta existe para una sesión de streaming, y qué
/// contesta.
#[cfg(debug_assertions)]
fn jam_probe_updates(session: &Session, session_id: &str) {
    log::info!("=== DIAGNOSTIC: la puerta de avisos del jam ===");

    let con_id = format!("{{\"session_id\":\"{session_id}\"}}");

    jam_ask(
        session,
        "aviso",
        "la puerta de avisos, con GET",
        &reqwest::Method::GET,
        "/social-connect/v2/session_update",
        None,
    );
    jam_ask(
        session,
        "aviso",
        "la puerta de avisos, con POST y sin cuerpo",
        &reqwest::Method::POST,
        "/social-connect/v2/session_update",
        None,
    );
    jam_ask(
        session,
        "aviso",
        "la puerta de avisos, con POST y cuerpo vacío",
        &reqwest::Method::POST,
        "/social-connect/v2/session_update",
        Some(b"{}"),
    );
    jam_ask(
        session,
        "aviso",
        "la puerta de avisos, con POST y el id de la sesión",
        &reqwest::Method::POST,
        "/social-connect/v2/session_update",
        Some(con_id.as_bytes()),
    );
    jam_ask(
        session,
        "aviso",
        "la puerta de avisos, con GET y el id en la query",
        &reqwest::Method::GET,
        &format!("/social-connect/v2/session_update?session_id={session_id}"),
        None,
    );
    jam_ask(
        session,
        "aviso",
        "la puerta de avisos, adentro de la sesión",
        &reqwest::Method::POST,
        &format!("/social-connect/v2/sessions/{session_id}/session_update"),
        Some(b"{}"),
    );

    // **La sesión actual, en protobuf.**
    //
    // El JSON que se lee ahora trae `session_members`. El protobuf puede
    // traer más —o menos—, y la diferencia entre las dos respuestas es
    // justamente lo que hay que ver: si el JSON no trae a los invitados y el
    // protobuf sí, el arreglo es leerlo de otra forma.
    for (label, route) in [
        ("la sesión actual en JSON", "/social-connect/v2/sessions/current"),
        ("la sesión actual en protobuf", "/social-connect/v2/sessions/current?alt=protobuf"),
    ] {
        if let Some((status, body)) = jam_ask_typed(
            session,
            "aviso",
            label,
            &reqwest::Method::GET,
            route,
            None,
            "application/json",
        ) {
            log::info!(
                "SP_JAM: [aviso] {label}: {status} · {} bytes",
                body.len()
            );
            log::info!("SP_JAM: [aviso] {label}: {}", jam_legible(&body));
        }
    }
}

/// Un cuerpo binario, en algo que se pueda leer en el log.
///
/// **Los strings del protobuf se leen tal cual**: los ids de los miembros y
/// los nombres están ahí, en UTF-8, y lo que se busca es verlos. Los bytes
/// sueltos se vuelven un punto.
#[cfg(debug_assertions)]
fn jam_legible(body: &[u8]) -> String {
    let mut out = String::new();
    for byte in body {
        match byte {
            0x20..=0x7e => out.push(*byte as char),
            b'\n' | b'\r' | b'\t' => out.push(' '),
            _ => out.push('·'),
        }
        if out.chars().count() >= 1200 {
            out.push('…');
            break;
        }
    }
    out
}

/// Una pregunta a la puerta del jam, y lo que contestó.
///
/// **No se usa el cliente de librespot.** `HttpClient::request` tira el cuerpo
/// de toda respuesta que no sea 2xx, un nivel más abajo que cualquier tipo con
/// nombre: un `404` y un `400` llegarían sin cuerpo y sin explicación, que es
/// justo lo que hay que ver. Por eso esto habla con `reqwest` —el cliente
/// async, que dentro de `call` no levanta un runtime propio— y trae el status
/// y el cuerpo de todo.
///
/// El `client-token` va como lo manda librespot, y el token de la cuenta es el
/// de la sesión: un `401` con el del cliente sería una respuesta sobre la
/// identidad, no sobre la puerta.
#[cfg(debug_assertions)]
fn jam_ask(
    session: &Session,
    label: &str,
    what: &str,
    method: &reqwest::Method,
    route: &str,
    body: Option<&[u8]>,
) -> Option<(u16, Vec<u8>)> {
    jam_ask_typed(session, label, what, method, route, body, "application/json")
}

/// Lo mismo, pero con el `content-type` que se le pida.
///
/// **El servicio de listas habla protobuf y contesta `application/x-protobuf`**,
/// y el `content-type` del pedido es parte de eso: no es un detalle que se
/// pueda dejar en JSON y esperar que el servicio lo entienda igual.
#[cfg(debug_assertions)]
fn jam_ask_typed(
    session: &Session,
    label: &str,
    what: &str,
    method: &reqwest::Method,
    route: &str,
    body: Option<&[u8]>,
    content_type: &'static str,
) -> Option<(u16, Vec<u8>)> {
    let owned = session.clone();
    let route = route.to_owned();
    let method = method.clone();
    let body = body.map(|bytes| bytes.to_vec());

    // El log los vuelve a necesitar, y el pedido se los lleva: se guardan las
    // etiquetas aparte en vez de clonar el método y la ruta dos veces.
    let method_label = method.to_string();
    let route_label = route.clone();

    let outcome = call(session, async move {
        let base = owned.spclient().base_url().await.map_err(|e| e.to_string())?;
        let token = owned.login5().auth_token().await.map_err(|e| e.to_string())?;
        let client_token = owned.spclient().client_token().await.unwrap_or_default();
        let url = jam_url(&base, &route, &owned.country());
        let authorization = format!("{} {}", token.token_type, token.access_token);

        let mut request = reqwest::Client::new().request(method, url);
        request = request.header(reqwest::header::AUTHORIZATION, authorization);
        if !client_token.is_empty() {
            request = request.header("client-token", client_token);
        }
        if let Some(bytes) = body {
            request = request
                .header(reqwest::header::CONTENT_TYPE, content_type)
                .body(bytes);
        }

        let response = request.send().await.map_err(|e| format!("la red: {e}"))?;
        let status = response.status().as_u16();
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("—")
            .to_owned();
        let bytes = response.bytes().await.map_err(|e| format!("el cuerpo: {e}"))?;

        Ok((status, content_type, bytes.to_vec()))
    });

    match outcome {
        Ok((status, content_type, bytes)) => {
            log::info!(
                "SP_JAM: [{label}] {what} · {method_label} {route_label} → {status} · {content_type} · {}",
                describe_body(&bytes)
            );
            Some((status, bytes))
        }
        Err(e) => {
            log::error!("SP_JAM: [{label}] {what} · {method_label} {route_label} → no llegó: {e}");
            None
        }
    }
}

/// La URL completa, con la query que el router de Spotify espera.
///
/// `product=0` y `country` son los que `spclient` le agrega a cada pedido, y
/// `salt` es lo que rompe la caché de los `GET`. No se inventan: si el camino
/// ya trae su propia query, los extras se cuelgan de ella con `&`.
#[cfg(debug_assertions)]
fn jam_url(base: &str, route: &str, country: &str) -> String {
    let separator = if route.contains('?') { '&' } else { '?' };
    format!("{base}{route}{separator}product=0&country={country}&salt=1")
}

/// El cuerpo de una respuesta, como JSON si lo es.
///
/// La forma del jam es JSON —la ruta de la sesión lo pide con `alt=protobuf`
/// para el otro caso—, y un JSON entero dice más que un volcado de bytes: los
/// nombres de los campos son la mitad del protocolo.
#[cfg(debug_assertions)]
fn describe_body(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes);

    match serde_json::from_str::<serde_json::Value>(text.trim()) {
        Ok(value) => {
            let compact = value.to_string();
            format!("{} bytes · json {}", bytes.len(), cut_chars(&compact, 1500))
        }
        Err(_) => describe_bytes(bytes),
    }
}

/// Corta por caracteres, y no por bytes.
///
/// Un byte parte un carácter, y un acento cortado a la mitad no es texto: es
/// basura que después hay que distinguir de un error real.
#[cfg(debug_assertions)]
fn cut_chars(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_owned();
    }

    let cut: String = text.chars().take(max).collect();
    format!("{cut}…")
}

/// Intenta cerrar la sesión que se acaba de abrir.
///
/// Tampoco se sabe cómo se cierra —eso es parte de lo que hay que medir—, así
/// que se prueban las tres formas que el router de este servicio acepta en el
/// resto de la API: borrar el recurso, o decirle al servidor que la sesión
/// terminó.
#[cfg(debug_assertions)]
fn jam_end(session: &Session, session_id: &str) {
    let candidates = [
        (
            reqwest::Method::DELETE,
            format!("/social-connect/v2/sessions/{session_id}"),
            "borrar la sesión",
        ),
        (
            reqwest::Method::DELETE,
            "/social-connect/v2/sessions/current".to_owned(),
            "borrar la sesión actual",
        ),
        (
            reqwest::Method::POST,
            "/social-connect/v2/sessions/current/leave".to_owned(),
            "salir de la sesión",
        ),
    ];

    for (method, route, what) in candidates {
        let answered = jam_ask(session, "cerrar", what, &method, &route, None);

        if let Some((status, _)) = answered {
            if status < 400 {
                log::info!("SP_JAM: la sesión se cerró con {method} {route} ({what})");
                return;
            }
        }
    }

    log::error!(
        "SP_JAM: no se pudo cerrar la sesión {session_id}; se cierra desde el cliente de Spotify"
    );
}

/// El cuerpo de un `GetListsRequest`, armado a mano.
///
/// El servicio de listas habla protobuf y **no hay proto de él en
/// librespot**: los mensajes viven en el cliente de escritorio, y el
/// `spotify/list/v1/list_read_service.proto` que el cliente trae embebido no
/// compila. Así que el cuerpo se arma a mano, con los números de campo del
/// volcado:
///
/// ```text
/// GetListsRequest { requests: 1 }
///   GetListRequest { identifier: 1, options: 2 }
///     ListIdentifier { uri: 1 }
///     RequestOptions { requested_fields: 4 }
///       RequestedFields { all: 1 }
/// ```
///
/// `all: true` es lo que el servicio pedía con su mensaje: sin eso contesta
/// "RequestedFields must not be empty".
#[cfg(debug_assertions)]
fn jam_list_request(uri: &str) -> Vec<u8> {
    // `RequestedFields { all: true }` — campo 1, varint.
    let requested = vec![0x08, 0x01];
    // `RequestOptions { requested_fields: 4 }`
    let options = pb_bytes(4, &requested);
    // `ListIdentifier { uri: 1 }`
    let identifier = pb_bytes(1, uri.as_bytes());
    // `GetListRequest { identifier: 1, options: 2 }`
    let mut get_list = pb_bytes(1, &identifier);
    get_list.extend(pb_bytes(2, &options));
    // `GetListsRequest { requests: 1 }`
    pb_bytes(1, &get_list)
}

/// Un campo de protobuf en longitud-delimitada.
///
/// A mano, porque el crate no tiene el proto de este servicio: los mensajes
/// están en el cliente de escritorio y no en librespot.
#[cfg(debug_assertions)]
fn pb_bytes(number: u32, payload: &[u8]) -> Vec<u8> {
    let mut out = pb_varint(((number as u64) << 3) | 2);
    out.extend(pb_varint(payload.len() as u64));
    out.extend_from_slice(payload);
    out
}

/// Un varint de protobuf.
#[cfg(debug_assertions)]
fn pb_varint(mut value: u64) -> Vec<u8> {
    let mut out = Vec::new();

    loop {
        let byte = (value & 0x7f) as u8;
        value >>= 7;

        if value == 0 {
            out.push(byte);
            break;
        }

        out.push(byte | 0x80);
    }

    out
}

/// Los strings de un cuerpo binario.
///
/// Un protobuf no se lee, pero sus strings sí: los nombres de campo y los
/// valores de texto quedan como texto plano adentro, y con eso se ve qué trae
/// la respuesta sin necesidad de compilar el proto del servicio.
#[cfg(debug_assertions)]
fn describe_strings(bytes: &[u8]) -> String {
    let mut found: Vec<String> = Vec::new();
    let mut current = String::new();

    for byte in bytes {
        if byte.is_ascii_graphic() || *byte == b' ' {
            current.push(*byte as char);
        } else {
            if current.len() >= 5 && !found.contains(&current) {
                found.push(current.clone());
            }
            current.clear();
        }
    }

    if current.len() >= 5 && !found.contains(&current) {
        found.push(current);
    }

    found
        .into_iter()
        .take(40)
        .map(|text| format!("“{text}”"))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Dónde dejar un archivo de la sonda.
///
/// Vive con el log, en `%LOCALAPPDATA%\Starless`: es el único directorio que
/// sobrevive a un reinicio y que no se borra al cerrar sesión, que es lo que
/// un archivo de medición necesita.
#[cfg(debug_assertions)]
fn jam_scratch_path(name: &str) -> String {
    let base = std::env::var("LOCALAPPDATA").unwrap_or_default();
    format!("{base}\\Starless\\{name}")
}

/// El id del primer participante de la sesión.
///
/// **No es el nombre de la cuenta**: es el id que el servicio le da a cada
/// persona *dentro* de la sesión, y es lo que las puertas de miembro y de
/// expulsión necesitan.
#[cfg(debug_assertions)]
fn find_first_member_id(value: &serde_json::Value) -> Option<String> {
    let members = match value {
        serde_json::Value::Object(map) => map.get("session_members")?,
        _ => return None,
    };

    let members = members.as_array()?;
    let first = members.first()?;

    first.get("id")?.as_str().map(|id| id.to_owned())
}

/// Busca un campo por nombre, a cualquier nivel del JSON.
#[cfg(debug_assertions)]
/// La medición que decide si el jam tiene anfitrión: **publicar el estado del
/// player y ver si la cola compartida deja de ser la del teléfono.**
///
/// **Por qué esta medición y no otra.** La cola compartida del jam no es una
/// lista que escribe el jam: es el contexto que publica el player del
/// anfitrión. Mientras Starless no publique nada, el servicio sigue viendo al
/// teléfono como el que manda, y la cola muestra las canciones del teléfono.
/// La pregunta es de una sola respuesta: después de publicar, ¿la cola
/// muestra las canciones de Starless?
///
/// `STARLESS_SP_JAM_STATE=1` corre esto y nada más.
#[cfg(debug_assertions)]
pub fn jam_state_requested() -> bool {
    std::env::var("STARLESS_SP_JAM_STATE")
        .map(|value| value != "0" && !value.is_empty())
        .unwrap_or(false)
}

/// La pista con la que se mide.
///
/// **Una que cualquiera reconozca**: si aparece en el celu, el comando llegó.
#[cfg(debug_assertions)]
const STATE_TRACK: &str = "0VjIjW4GlUZAMYd2vXMi3b";

/// La medición del estado del player.
#[cfg(debug_assertions)]
pub fn run_jam_state_probe(app: tauri::AppHandle) {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(session) = crate::selftest::wait_for_session(&app) else {
            log::error!("SP_JAM_STATE: la sesión no llegó a conectar");
            return;
        };

        log::info!("=== DIAGNOSTIC: el estado del player ===");

        // 0. Los comandos del otro lado, **antes** de abrir el `dealer`.
        //
        // **Sin esto el teléfono no puede mandar nada**: los comandos del
        // player llegan empujados por el `dealer`, y si no hay nadie escuchando
        // el tema, se pierden con un aviso en el log y nada más.
        jam_probe_commands(&session);

        // 0 bis. El `connection id`.
        //
        // **Sin esto el `PUT` contesta `400`**: el servicio exige el
        // `X-Spotify-Connection-Id` y ese id lo empuja el backend por el
        // `dealer`, que Starless no abría.
        match super::state::watch_connection_id(&session) {
            Ok(()) => log::info!("SP_JAM_STATE: estoy esperando el connection id"),
            Err(error) => log::error!("SP_JAM_STATE: no se pudo escuchar el pusher: {error}"),
        }
        for _ in 0..20 {
            std::thread::sleep(std::time::Duration::from_secs(1));
            if !session.connection_id().is_empty() {
                break;
            }
        }
        log::info!("SP_JAM_STATE: el connection id es {:?}", session.connection_id());

        // 1. El contexto de una canción, con los `uid` que da el servicio.
        let uri = format!("spotify:track:{STATE_TRACK}");
        let Some(snapshot) = super::state::snapshot_for(&session, &uri, 0) else {
            log::error!("SP_JAM_STATE: el contexto de {STATE_TRACK} no vino");
            return;
        };
        let mias = snapshot.track.uri.clone();
        log::info!(
            "SP_JAM_STATE: el contexto tiene {} pistas · la primera es {} con uid {} y gid {}",
            snapshot.next.len() + 1,
            mias,
            snapshot.track.uid,
            snapshot
                .track
                .gid
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        );

        // 2. Publicarlo. **Esto es lo que no estaba.**
        match super::state::publish(&session, &snapshot) {
            Ok(()) => log::info!("SP_JAM_STATE: el estado se publicó"),
            Err(error) => log::error!("SP_JAM_STATE: el estado no se publicó: {error}"),
        }

        // 3. Qué ve el servicio de este lado.
        jam_probe_cluster(&session);

        // 4. Abrir el jam y leer la cola: ¿es la de Starless?
        let Ok(jam) = super::jam_session(&session, true) else {
            log::error!("SP_JAM_STATE: no se pudo abrir el jam");
            return;
        };
        let session_id = jam.session_id.clone();
        log::info!("SP_JAM_STATE: jam {session_id}");

        match super::jam_queue_items(&session, &session_id) {
            Ok(items) => {
                let primeras: Vec<String> = items
                    .iter()
                    .take(6)
                    .map(|(uri, uid)| format!("{uri}#{uid}"))
                    .collect();
                let mias_en_la_cola = items.iter().filter(|(uri, _)| uri == &mias).count();
                log::info!(
                    "SP_JAM_STATE: la cola tiene {} canciones · {} de Starless · primeras {primeras:?}",
                    items.len(),
                    mias_en_la_cola
                );
            }
            Err(error) => log::error!("SP_JAM_STATE: la cola no se pudo leer: {error}"),
        }

        // 5. Mandar una canción a la cola con el `uid` que dio el servicio.
        //
        // **El `uid` es lo que decide a qué canción apunta el comando.** Con el
        // `uid` de la pista, el comando apunta a esa; sin él, el servicio lo
        // aplica a la que está sonando.
        let Some((empujada, uid)) = snapshot
            .next
            .first()
            .map(|track| (track.uri.clone(), track.uid.clone()))
        else {
            log::error!("SP_JAM_STATE: el contexto no trajo ninguna pista más");
            return;
        };
        let id = empujada.rsplit(':').next().unwrap_or_default().to_string();
        match super::jam_add_to_queue_with_uid(&session, &session_id, &id, Some(&uid)) {
            Ok(()) => log::info!("SP_JAM_STATE: mandé {empujada} con uid {uid}"),
            Err(error) => log::error!("SP_JAM_STATE: el comando no entró: {error}"),
        }

        std::thread::sleep(std::time::Duration::from_secs(6));
        match super::jam_queue_items(&session, &session_id) {
            Ok(items) => {
                let veces = items.iter().filter(|(uri, _)| uri == &empujada).count();
                log::info!(
                    "SP_JAM_STATE: la cola tiene {} canciones · la que mandé aparece {veces} vez(es)",
                    items.len()
                );
            }
            Err(error) => log::error!("SP_JAM_STATE: la cola no se pudo leer: {error}"),
        }

        // 7. Los comandos del otro lado.
        //
        // **El backend empuja los comandos del player por el `dealer`.** Es lo
        // que hace que el teléfono pueda saltar la canción de Starless: el
        // comando llega a este lado, no al revés. El que escucha ya está
        // puesto, arriba: si se pusiera acá, los comandos que llegan mientras
        // se publica el estado se pierden.

        // 8. Y ahora, a mirar: ¿la cola_shared sigue a Starless?
        for vuelta in 1..=12 {
            std::thread::sleep(std::time::Duration::from_secs(5));
            match super::jam_session(&session, false) {
                Ok(jam) => {
                    let (_, cuerpo) = jam_ask(
                        &session,
                        "estado",
                        "la sesión del jam",
                        &reqwest::Method::GET,
                        &format!("/social-connect/v2/sessions/{session_id}"),
                        None,
                    )
                    .unwrap_or((0, Vec::new()));
                    let json: serde_json::Value =
                        serde_json::from_slice(&cuerpo).unwrap_or(serde_json::Value::Null);
                    let anfitrion = find_key(&json, "host_device_info")
                        .unwrap_or_else(|| "?".to_string());
                    if vuelta == 1 {
                        log::info!("SP_JAM_STATE: la sesión entera es {json}");
                    }
                    log::info!(
                        "SP_JAM_STATE: vuelta {vuelta} · anfitrión={anfitrion} · miembros={} · dueño={}",
                        jam.session_members.len(),
                        jam.is_session_owner
                    );
                }
                Err(error) => log::error!("SP_JAM_STATE: la sesión no se pudo leer: {error}"),
            }
            match super::jam_queue_items(&session, &session_id) {
                Ok(items) => {
                    let mias = items.iter().filter(|(uri, _)| uri == &mias).count();
                    log::info!(
                        "SP_JAM_STATE: vuelta {vuelta} · la cola tiene {} canciones · {mias} de Starless",
                        items.len()
                    );
                }
                Err(error) => log::error!("SP_JAM_STATE: la cola no se pudo leer: {error}"),
            }
        }
    });
}

/// Los comandos que el otro lado manda.
///
/// **El backend empuja los comandos del player por el `dealer`**, y sin
/// escucharlos el teléfono puede pedirle a Starless que salte la canción y no
/// pasa nada.
#[cfg(debug_assertions)]
fn jam_probe_commands(session: &Session) {
    let owned = session.clone();

    // **La suscripción va antes que la conexión del dealer**, y por eso se
    // reintenta: si el websocket todavía no está, no hay constructor al que
    // suscribirse y el comando se pierde.
    let mut intentos = 0;
    let subscription = loop {
        match owned.dealer().add_listen_for("hm://connect-state/v1/player/command") {
            Ok(subscription) => break subscription,
            Err(error) => {
                intentos += 1;
                if intentos > 30 {
                    log::error!("SP_JAM_STATE: no se pudieron escuchar los comandos: {error}");
                    return;
                }
                std::thread::sleep(std::time::Duration::from_millis(500));
            }
        }
    };

    owned.spawn(async move {
        let mut stream = subscription.map(|message| {
            let cuerpo = match &message.payload {
                PayloadValue::Json(texto) => texto.clone(),
                PayloadValue::Raw(bytes) => String::from_utf8_lossy(bytes).to_string(),
                PayloadValue::Empty => "(vacío)".to_string(),
            };
            Ok::<(String, String), librespot_core::Error>((message.uri.clone(), cuerpo))
        });

        while let Some(Ok((uri, cuerpo))) = stream.next().await {
            log::info!("SP_JAM_STATE: comando del player en {uri} · {cuerpo}");
        }
    });
}

/// El cluster: qué dispositivos ve el servicio y cuál manda.
///
/// **Es la foto del estado**: si el `context_uri` es el de Starless, el
/// servicio ya sabe qué estamos sonando, y el jam tiene anfitrión.
#[cfg(debug_assertions)]
fn jam_probe_cluster(session: &Session) {
    let Some((status, body)) = jam_ask(
        session,
        "estado",
        "el grupo de dispositivos",
        &reqwest::Method::GET,
        "/connect-state/v1/cluster",
        None,
    ) else {
        log::error!("SP_JAM_STATE: el cluster no contestó");
        return;
    };

    log::info!("SP_JAM_STATE: el cluster → {status}");
    let Ok(json) = serde_json::from_slice::<serde_json::Value>(&body) else {
        log::error!("SP_JAM_STATE: el cluster vino con otra forma");
        return;
    };

    let activo = find_key(&json, "active_device_id");
    let contexto = find_key(&json, "context_uri");
    log::info!("SP_JAM_STATE: el que manda es {activo:?} · el contexto es {contexto:?}");
}

fn find_key(value: &serde_json::Value, key: &str) -> Option<String> {
    match value {
        serde_json::Value::Object(map) => {
            for (name, child) in map {
                if name == key {
                    if let Some(text) = child.as_str() {
                        return Some(text.to_owned());
                    }
                }
                if let Some(found) = find_key(child, key) {
                    return Some(found);
                }
            }
            None
        }
        serde_json::Value::Array(items) => {
            for item in items {
                if let Some(found) = find_key(item, key) {
                    return Some(found);
                }
            }
            None
        }
        _ => None,
    }
}
