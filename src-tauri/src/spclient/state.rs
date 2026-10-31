//! El estado del player, publicado al servicio.
//!
//! **Por qué este módulo existe.** Starless reproduce música, pero no le decía
//! a Spotify qué estaba sonando. El `player` de librespot 0.8 es **local**:
//! habla con el servicio de archivos y con nada más —el `dealer`, que es donde
//! vive el protocolo del player, no se usa para nada— y el estado que el
//! servicio necesita para saber qué está sonando se publica **aparte**, en
//! `PUT /connect-state/v1/devices/<id>`, que es lo que hace `librespot-connect`.
//! Starless tenía la dependencia en el `Cargo.toml` y no la usaba.
//!
//! **Sin esto el jam no puede funcionar, y no es un detalle de la cola.** La
//! cola compartida del jam no es una lista que escribe el jam: es el contexto
//! que publica el player del anfitrión, y el servicio lo arma con lo que
//! encuentra en el cluster. Medido el 31 de octubre de 2026: la cola tenía cien
//! canciones —la mitad sin id, que es la semilla de la cuenta, y la mitad con
//! id, que es el contexto del teléfono—, y **cambiaba sola cuando el teléfono
//! sonaba otra cosa**. Con Starless sin publicar nada, el jam no tenía un
//! anfitrión: tenía al teléfono.
//!
//! **El `uid` lo da el servicio, no Starless.** Cada pista del contexto lleva un
//! `uid` —cuarenta hex— que es el identificador que tiene *dentro* de ese
//! contexto, y es lo que el comando del player necesita para decir *agregá
//! esta* y no *la que está sonando*. Por eso el contexto se pide al servicio
//! (`context-resolve`) en vez de inventarlo: el `uid` que el servicio dio es el
//! único con el que el comando puede apuntar a una pista.

use std::time::{SystemTime, UNIX_EPOCH};

use futures_util::StreamExt;
use librespot_core::Session;
use librespot_core::error::Error;
use librespot_protocol::autoplay_context_request::AutoplayContextRequest;
use librespot_protocol::connect::{
    Capabilities, Device, DeviceInfo, MemberType, PutStateReason, PutStateRequest,
};
use librespot_protocol::context::Context;
use librespot_protocol::devices::DeviceType;
use librespot_protocol::player::{
    ContextIndex, ContextPlayerOptions, PlayOrigin, PlayerState, ProvidedTrack, Suppressions,
};
use protobuf::{EnumOrUnknown, MessageField};

use super::call;

/// El tema del `dealer` por el que el servicio avisa el `connection id`.
const PUSHER_TOPIC: &str = "hm://pusher/v1/connections/";

/// El encabezado con el que llega ese id.
const CONNECTION_HEADER: &str = "Spotify-Connection-Id";

/// Si el `dealer` ya se abrió.
///
/// **El `dealer` se abre una sola vez por proceso**: el gestor guarda el
/// websocket en un casillero y el constructor se lleva el que lo armó, así que
/// un segundo `start()` falla con "no hay constructor". La app y las sondas
/// piden lo mismo —el `connection id`— y las dos lo piden.
static DEALER_OPENED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// Una pista del contexto, con el `uid` que le dio el servicio.
#[derive(Clone, Debug, Default)]
pub struct Track {
    /// La URI de la pista: `spotify:track:<id>`.
    pub uri: String,
    /// El identificador de la pista dentro del contexto.
    pub uid: String,
    /// El identificador global, si el servicio lo mandó.
    pub gid: Vec<u8>,
}

/// Lo que Starless está sonando, tal como lo ve el resto de la cuenta.
pub struct Snapshot {
    /// La URI del contexto: la canción que está sonando.
    pub context_uri: String,
    /// El URL del contexto: el mismo, con las lentes que el servicio pide.
    pub context_url: String,
    /// La canción que está sonando.
    pub track: Track,
    /// Las que siguen.
    pub next: Vec<Track>,
    /// Dónde está el reproductor, en milisegundos.
    pub position_ms: u64,
    /// Cuánto dura la canción, en milisegundos.
    pub duration_ms: u64,
    /// Si está sonando o en pausa.
    pub playing: bool,
}

/// Publica el estado del player.
///
/// **El `PUT` es el que hace que el jam tenga un anfitrión.** Sin él, el
/// servicio sigue viendo al último dispositivo que publicó, que es el del
/// teléfono: el jam abre, tiene participantes, y la cola compartida muestra las
/// canciones de otro device.
pub fn publish(session: &Session, snapshot: &Snapshot) -> Result<(), String> {
    let request = build(session, snapshot);
    let owned = session.clone();

    call(session, async move {
        owned
            .spclient()
            .put_connect_state_request(&request)
            .await
            .map(|body| {
                log::info!("spclient: el estado del player se publicó ({body:?})");
            })
            .map_err(|e| {
                log::error!("spclient: el estado del player no se publicó: {e}");
                e.to_string()
            })
    })
}

/// Escucha el `connection id` que el servicio asigna a esta conexión.
///
/// **Sin esto el `PUT` de estado no existe.** El servicio exige el
/// `X-Spotify-Connection-Id` en cada estado publicado, y ese id no lo da la
/// sesión: lo empuja el backend por el `dealer`, en el mensaje de
/// `hm://pusher/v1/connections/`. Sin él, el `PUT` contesta `400` —medido el 31
/// de octubre de 2026— y el jam se queda sin anfitrión.
///
/// **El `dealer` es el websocket que empuja las cosas, y Starless no lo
/// abría.** El `player` de librespot 0.8 es local y habla con el servicio de
/// archivos, no con el del player; el `dealer` es lo que queda, y es también
/// el pubsub del jam: por ahí llegan los avisos de que alguien se unió.
///
/// **La suscripción va antes que la conexión a propósito**: el mensaje con el
/// id llega una sola vez, cuando el websocket se abre, y suscribirse después
/// es suscribirse tarde.
pub fn watch_connection_id(session: &Session) -> Result<(), String> {
    if DEALER_OPENED.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return Ok(());
    }

    let owned = session.clone();

    // **La suscripción va antes que la conexión, y se queda con ella.**
    //
    // El constructor del dealer lleva las suscripciones al websocket cuando se
    // abre, y después de eso no queda constructor al que suscribirse: el
    // `add_listen_for` contesta "no hay constructor" y el `connection id`
    // nunca llega. Por eso lo que se escucha es el `Subscription` que se
    // registró, y no una suscripción nueva.
    let subscription = match owned.dealer().add_listen_for(PUSHER_TOPIC) {
        Ok(subscription) => subscription,
        Err(error) => {
            DEALER_OPENED.store(false, std::sync::atomic::Ordering::SeqCst);
            return Err(format!("no se pudo suscribir al pusher: {error}"));
        }
    };

    // **El websocket se abre aparte**: `start()` espera el apretón de manos y
    // no puede correr dentro de una función sincrónica.
    let para_arrancar = owned.clone();
    owned.spawn(async move {
        if let Err(error) = para_arrancar.dealer().start().await {
            log::error!("spclient: el dealer no arrancó: {error}");
        }
    });

    let para_escuchar = owned.clone();
    owned.spawn(async move {
        let mut stream = subscription.map(|message| {
            message
                .headers
                .get(CONNECTION_HEADER)
                .cloned()
                .ok_or_else(|| Error::failed_precondition("el mensaje no trajo el connection id"))
        });

        while let Some(connection_id) = stream.next().await {
            match connection_id {
                Ok(connection_id) => {
                    log::info!("spclient: el servicio asignó el connection id {connection_id}");
                    para_escuchar.set_connection_id(&connection_id);
                }
                Err(error) => log::error!("spclient: el pusher no vino: {error}"),
            }
        }
    });

    Ok(())
}

/// El contexto de una canción, tal como lo arma el servicio.
///
/// **Se lo pide al servicio y no se lo inventa**, por el `uid`: la lista de
/// pistas que vuelve trae el `uid` de cada una, y ese `uid` es lo que permite
/// que un comando apunte a una pista concreta de la cola compartida.
pub fn autoplay_context(session: &Session, track_uri: &str) -> Option<Context> {
    let request = AutoplayContextRequest {
        context_uri: Some(track_uri.to_owned()),
        recent_track_uri: Vec::new(),
        is_video: Some(false),
        special_fields: Default::default(),
    };
    let owned = session.clone();
    let uri = track_uri.to_owned();

    call(session, async move {
        owned
            .spclient()
            .get_autoplay_context(&request)
            .await
            .map_err(|e| {
                log::error!("spclient: el contexto de {uri} no vino: {e}");
                e.to_string()
            })
    })
    .ok()
}

/// El snapshot de una canción, con el contexto que le corresponde.
///
/// **La canción que está sonando no es parte del contexto.** El contexto es lo
/// que va *después*: es la estación que el servicio arma para que la música no
/// se corte. Por eso la pista va con el `uid` vacío —el servicio no le dio uno
/// para ella— y las del contexto lo traen.
pub fn snapshot_for(session: &Session, track_uri: &str, duration_ms: u64) -> Option<Snapshot> {
    let context = autoplay_context(session, track_uri)?;
    let tracks = context_tracks(&context);
    let current = track_uri.to_owned();

    Some(Snapshot {
        context_uri: current.clone(),
        context_url: format!("context://{current}?spotify-apply-lenses=autoplay"),
        track: Track {
            uri: current.clone(),
            ..Default::default()
        },
        next: tracks
            .into_iter()
            .filter(|candidate| candidate.uri != current)
            .take(50)
            .collect(),
        position_ms: 0,
        duration_ms,
        playing: true,
    })
}

/// El estado de un player que no está sonando nada.
///
/// **Vacío y no falso.** El servicio tiene que ver que el dispositivo existe
/// pero no está en medio de una canción: sin esto, el jam sigue creyendo que
/// Starless está sonando la última cosa que se publicó.
pub fn empty_snapshot() -> Snapshot {
    Snapshot {
        context_uri: String::new(),
        context_url: String::new(),
        track: Track::default(),
        next: Vec::new(),
        position_ms: 0,
        duration_ms: 0,
        playing: false,
    }
}

/// Las pistas de un contexto, en orden, con su `uid`.
fn context_tracks(context: &Context) -> Vec<Track> {
    context
        .pages
        .iter()
        .flat_map(|page| page.tracks.iter())
        .map(|track| Track {
            uri: track.uri.clone().unwrap_or_default(),
            uid: track.uid.clone().unwrap_or_default(),
            gid: track.gid.clone().unwrap_or_default(),
        })
        .filter(|track| !track.uri.is_empty())
        .collect()
}

/// Arma el pedido que el servicio entiende.
///
/// **Los campos son los de `librespot-connect`, no los de la app oficial**: es
/// el mismo `PutStateRequest` y el mismo `member_type`, porque el servicio
/// espera ese formato y no otro.
fn build(session: &Session, snapshot: &Snapshot) -> PutStateRequest {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|since| since.as_millis() as i64)
        .unwrap_or_default();

    let player_state = PlayerState {
        timestamp: now,
        context_uri: snapshot.context_uri.clone(),
        context_url: snapshot.context_url.clone(),
        track: MessageField::some(provided(&snapshot.track)),
        next_tracks: snapshot.next.iter().map(provided).collect(),
        index: MessageField::some(ContextIndex {
            page: 0,
            track: 0,
            ..Default::default()
        }),
        position_as_of_timestamp: snapshot.position_ms as i64,
        duration: snapshot.duration_ms as i64,
        is_playing: snapshot.playing,
        is_paused: !snapshot.playing,
        is_buffering: false,
        is_system_initiated: true,
        playback_speed: 1.,
        session_id: session.session_id(),
        // **Los tres que siempre manda `librespot-connect`.** No son opcionales
        // en la práctica: el estado sin ellos no es un estado de player y el
        // servicio lo rechaza con `400`.
        play_origin: MessageField::some(PlayOrigin::new()),
        options: MessageField::some(ContextPlayerOptions::new()),
        suppressions: MessageField::some(Suppressions::new()),
        ..Default::default()
    };

    PutStateRequest {
        member_type: EnumOrUnknown::new(MemberType::CONNECT_STATE),
        put_state_reason: EnumOrUnknown::new(PutStateReason::PLAYER_STATE_CHANGED),
        is_active: true,
        device: MessageField::some(Device {
            device_info: MessageField::some(DeviceInfo {
                can_play: true,
                volume: 100,
                name: "Starless".to_string(),
                device_id: session.device_id().to_string(),
                // **El tipo de dispositivo es el de la app, no el de un parlante.**
                // La sesión de Starless no manda tipo de dispositivo en el
                // login —no hay ninguno en `SessionConfig`—, así que el que
                // se publica es el de una app de escritorio. Poner el de
                // librespot —un parlante— sería mentirle al servicio.
                device_type: EnumOrUnknown::new(DeviceType::COMPUTER),
                device_software_version: env!("CARGO_PKG_VERSION").to_string(),
                spirc_version: librespot_core::version::SPOTIFY_SPIRC_VERSION.to_string(),
                client_id: session.client_id(),
                capabilities: MessageField::some(Capabilities {
                    can_be_player: true,
                    is_controllable: true,
                    is_observable: true,
                    needs_full_player_state: true,
                    command_acks: true,
                    supports_gzip_pushes: true,
                    supports_playlist_v2: true,
                    supports_transfer_command: true,
                    supports_command_request: true,
                    supports_set_options_command: true,
                    restrict_to_local: false,
                    connect_disabled: false,
                    disable_volume: false,
                    hidden: false,
                    volume_steps: 64,
                    supported_types: vec![
                        "audio/episode".into(),
                        "audio/track".into(),
                        "audio/local".into(),
                    ],
                    ..Default::default()
                }),
                ..Default::default()
            }),
            player_state: MessageField::some(player_state),
            ..Default::default()
        }),
        ..Default::default()
    }
}

/// Una pista del contexto, en la forma que el estado del player usa.
fn provided(track: &Track) -> ProvidedTrack {
    ProvidedTrack {
        uri: track.uri.clone(),
        uid: track.uid.clone(),
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use super::Track;
    use super::context_tracks;
    use librespot_protocol::context::Context;
    use librespot_protocol::context_page::ContextPage;
    use librespot_protocol::context_track::ContextTrack;

    /// El contexto trae las pistas con su `uid`, y el `uid` es lo que permite
    /// que un comando apunte a una pista y no a otra.
    #[test]
    fn the_context_tracks_keep_the_uid_the_service_gave() {
        let context = Context {
            uri: Some("spotify:track:3b5E38f6Dbx28IVof4oeAA".into()),
            pages: vec![ContextPage {
                tracks: vec![ContextTrack {
                    uri: Some("spotify:track:3b5E38f6Dbx28IVof4oeAA".into()),
                    uid: Some("cb970d145ffcc3721d38e3a5ff012695e8645fdb".into()),
                    ..Default::default()
                }],
                ..Default::default()
            }],
            ..Default::default()
        };

        let tracks = context_tracks(&context);

        assert_eq!(tracks.len(), 1);
        assert_eq!(tracks[0].uid, "cb970d145ffcc3721d38e3a5ff012695e8645fdb");
    }

    /// Una pista sin URI no sirve: el servicio la ignora y el jam queda con una
    /// canción de la nada.
    #[test]
    fn a_track_without_uri_does_not_count() {
        let context = Context {
            pages: vec![ContextPage {
                tracks: vec![ContextTrack {
                    uid: Some("algo".into()),
                    ..Default::default()
                }],
                ..Default::default()
            }],
            ..Default::default()
        };

        assert!(context_tracks(&context).is_empty());
    }

    /// La pista vacía es la que se publica cuando no hay nada sonando: el
    /// servicio tiene que ver que el dispositivo existe pero no está en medio
    /// de una canción.
    #[test]
    fn an_empty_track_is_still_a_track() {
        let track = Track::default();
        assert!(track.uri.is_empty());
    }
}
