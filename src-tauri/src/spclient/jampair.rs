//! El jam, con los dos lados en esta máquina.
//!
//! **Por qué esto existe.** El jam se midió siempre contra la cuenta del
//! anfitrión: un jam abierto, un comando enviado, una cola leída. Eso mide las
//! puertas —y las mide bien—, pero no mide el jam, que es un protocolo de dos
//! cuentas. Y cada intento de probarlo de punta a punta terminaba igual:
//! pull request, build, dos personas con un teléfono en la mano, y el resultado
//! en la palabra de alguien. Un protocolo que sólo se puede probar después de
//! mergearlo es un protocolo que se prueba una vez cada tres semanas.
//!
//! **Acá los dos lados son locales.** El anfitrión es la sesión de la app —la
//! cuenta de esta máquina— y el invitado es una segunda sesión de librespot con
//! las credenciales de otra cuenta, en su propio directorio de caché y con su
//! propio id de dispositivo. El arnés camina el ciclo entero y dice, paso por
//! paso, qué funciona y qué no.
//!
//! ```
//! STARLESS_SP_JAM_PAIR=1 \
//! STARLESS_SP_JAM_PAIR_CACHE=<directorio de la segunda cuenta> \
//! cargo run
//! ```
//!
//! **La segunda cuenta se conecta una vez, con la app**: `STARLESS_CACHE_DIR`
//! apunta su caché a otro directorio, se entra con la otra cuenta en el
//! navegador, y se cierra. Después el arnés abre los dos cachés en el mismo
//! proceso.

use std::path::{Path, PathBuf};

use librespot_core::Session;

use super::{jam_add_to_queue, jam_end, jam_join, jam_leave, jam_queue, jam_session};

/// La puerta: `STARLESS_SP_JAM_PAIR=1`.
pub fn requested() -> bool {
    std::env::var("STARLESS_SP_JAM_PAIR")
        .map(|value| value != "0" && !value.is_empty())
        .unwrap_or(false)
}

/// El modo de mirar: `STARLESS_SP_JAM_WATCH=1`.
///
/// **Un solo lado, y del otro lado está el cliente oficial o un teléfono.**
/// El arnés abre el jam, dice el código y después mira: cada tres segundos
/// pregunta cuántos participantes hay y cuántas canciones tiene la cola. Sirve
/// para medir el otro lado cuando el otro lado es una persona con la app
/// instalada, que es el caso que el par de cuentas no puede cubrir.
pub fn watch_requested() -> bool {
    std::env::var("STARLESS_SP_JAM_WATCH")
        .map(|value| value != "0" && !value.is_empty())
        .unwrap_or(false)
}

/// Cuánto se mira, en segundos.
fn watch_seconds() -> u64 {
    std::env::var("STARLESS_SP_JAM_WATCH_SECONDS")
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .filter(|seconds| *seconds > 0)
        .unwrap_or(180)
}

/// La pista que el arnés empuja a la cola mientras mira.
///
/// **Una que cualquiera reconozca**: si aparece en el celu, el comando llegó.
const PUSH: &str = "0VjIjW4GlUZAMYd2vXMi3b";

/// El `uid` de esa pista: el SHA-1 de su URI.
///
/// **El `uid` es lo que hace que la canción sea la correcta.** El comando del
/// player lleva la pista como un `ContextTrack` (`{ uri, uid, gid, metadata }`),
/// y mandando sólo la URI el servicio acepta el comando y lo aplica **a la
/// pista que está sonando**: al otro lado del jam entra la canción de siempre y
/// la lista compartida no cambia.
///
/// El `uid` que se ve en la lista tiene la forma de un SHA-1 —cuarenta hex—, y
/// el del probe era el SHA-1 de la URI. Este es el de esta pista.
const PUSH_UID: &str = "e1f66c09f889547da78626c2ef1e87bdad2af66c";

/// El modo de mirar: el anfitrión solo, mirando.
/// 
/// **El código va al log, porque es lo que la otra persona tiene que pegar.**
pub fn watch(app: tauri::AppHandle) {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(host) = crate::selftest::wait_for_session(&app) else {
            log::error!("SP_JAM_WATCH: la sesión no llegó a conectar");
            return;
        };

        let session = match jam_session(&host, true) {
            Ok(session) => session,
            Err(error) => {
                log::error!("SP_JAM_WATCH: no se pudo abrir el jam: {error}");
                return;
            }
        };

        let session_id = session.session_id.clone();
        let code = session.join_session_token.clone().unwrap_or_default();
        log::info!("=== DIAGNOSTIC: el jam mirando ===");
        log::info!("SP_JAM_WATCH: sesión {session_id}");
        log::info!("SP_JAM_WATCH: CÓDIGO {code}");
        log::info!(
            "SP_JAM_WATCH: unite con ese código desde el otro cliente; miro {} segundos",
            watch_seconds()
        );

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(watch_seconds());
        let mut antes_miembros: Option<usize> = None;
        let mut antes_cola: Option<usize> = None;
        let mut vueltas = 0_u32;

        // **El contexto del anfitrión se publica una vez, al principio.**
        //
        // La cola compartida del jam es el contexto que publica el player del
        // anfitrión, y el player de librespot no publica ninguno: lo publica
        // la llamada de autoplay. Sin esto, la cola que se lee es la semilla
        // —las últimas canciones de la cuenta— y no hay nada que agregar.
        super::probe::probe_autoplay(&host, &format!("spotify:track:{PUSH}"), &[]);
        log::info!("SP_JAM_WATCH: publiqué el contexto del anfitrión");

        while std::time::Instant::now() < deadline {
            // **Cada cuánto se pregunta importa tanto como qué se pregunta.**
            // El servicio corta la tanda con un `429` —medido: a los tres
            // segundos, con la app preguntando al mismo tiempo, se corta— así
            // que acá se pregunta cada cinco y la cola se lee **una** vez por
            // vuelta.
            std::thread::sleep(std::time::Duration::from_secs(5));
            vueltas += 1;

            // **Cada treinta segundos, el anfitrión empuja una canción.**
            //
            // La pregunta es si el comando llega a la cola compartida: el
            // servicio lo acepta con `RECOVERED`, pero eso dice que *entró*,
            // no que la lista lo tomó. Y si la lista no lo toma, el cruce de
            // canciones no existe — y entonces hay que buscar otra puerta.
            if vueltas % 6 == 0 {
                match super::jam_add_to_queue_with_uid(
                    &host,
                    &session_id,
                    PUSH,
                    Some(PUSH_UID),
                ) {
                    Ok(()) => log::info!("SP_JAM_WATCH: mandé {PUSH} a la cola compartida"),
                    Err(error) => log::error!("SP_JAM_WATCH: el comando no entró: {error}"),
                }
            }

            let Ok(poll) = jam_session(&host, false) else {
                log::error!("SP_JAM_WATCH: la puerta no contestó");
                continue;
            };
            if poll.session_id != session_id {
                log::error!(
                    "SP_JAM_WATCH: la sesión cambió a {} — el jam terminó",
                    poll.session_id
                );
                break;
            }

            let miembros = poll.session_members.len();
            let cola = match jam_queue(&host, &session_id) {
                Ok(queue) => {
                    // **Lo que cambia se dice; lo que no cambia no.** Un log por
                    // cada vuelta con lo mismo es ruido, y el ruido esconde el
                    // momento en que el otro lado entró.
                    if antes_cola != Some(queue.len()) {
                        antes_cola = Some(queue.len());
                        let nombres: Vec<&str> =
                            queue.iter().take(5).map(|track| track.name.as_str()).collect();
                        log::info!("SP_JAM_WATCH: la cola tiene {} canciones: {nombres:?}", queue.len());
                    }
                    queue.len()
                }
                Err(error) => {
                    log::error!("SP_JAM_WATCH: la cola no se pudo leer: {error}");
                    antes_cola = None;
                    0
                }
            };

            // **La cola entera, con el id de cada canción.**
            //
            // El `uid` es lo que el comando del player necesita para agregar
            // *esa* canción, y la lista entera es lo que el otro lado está
            // mirando: si las dos coinciden, el otro lado ve esta lista.
            if vueltas % 3 == 0 {
                match super::jam_queue_items(&host, &session_id) {
                    Ok(items) => {
                        let toda: Vec<String> = items
                            .iter()
                            .map(|(uri, uid)| format!("{uri}#{uid}"))
                            .collect();
                        log::info!("SP_JAM_WATCH: la cola completa: {toda:?}");
                    }
                    Err(error) => {
                        log::error!("SP_JAM_WATCH: la cola completa no se pudo leer: {error}");
                    }
                }
            }

            if antes_miembros != Some(miembros) {
                // **Quiénes, no sólo cuántos.** El nombre del miembro es lo que
                // dice si el otro lado entró de verdad o si el servicio está
                // contando a la misma cuenta una sola vez.
                let gente: Vec<String> = poll
                    .session_members
                    .iter()
                    .map(|member| {
                        format!(
                            "{} ({})",
                            member.display_name.as_deref().unwrap_or(member.id.as_str()),
                            member.id
                        )
                    })
                    .collect();
                log::info!(
                    "SP_JAM_WATCH: {miembros} participante(s) · cola con {cola} canciones · {gente:?} · dueño={}",
                    poll.is_session_owner
                );
                antes_miembros = Some(miembros);
            }
        }

        match jam_end(&host, &session_id) {
            Ok(()) => log::info!("SP_JAM_WATCH: el jam se cerró"),
            Err(error) => log::error!("SP_JAM_WATCH: el jam no se pudo cerrar: {error}"),
        }
        log::info!("=== DIAGNOSTIC: fin del jam mirando ===");
    });
}

/// Dónde vive la credencial de la segunda cuenta.
///
/// **Sin esto el arnés no puede arrancar**, y no adivina: adivinar sería
/// conectarse con la cuenta del anfitrión dos veces y medir un jam de una
/// persona.
fn guest_cache_dir() -> Option<PathBuf> {
    std::env::var("STARLESS_SP_JAM_PAIR_CACHE")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
}

/// La pista que el invitado pone en la cola compartida.
///
/// **Una sola, y la misma en todas las corridas**, para que dos veredictos
/// seguidos se puedan comparar.
const TRACK: &str = "3b5E38f6Dbx28IVof4oeAA";

/// El nombre del dispositivo del invitado.
///
/// **Distinto del del anfitrión a propósito**: el servicio agrupa a los
/// miembros de una sesión por el dispositivo que manda el comando, y dos
/// sesiones con el mismo id serían una sola para él.
const GUEST_DEVICE: &str = "Starless-b";

/// Un paso que pasó.
fn pasa(nombre: &str, detalle: impl AsRef<str>) {
    log::info!("SP_JAM_PAIR: PASA  {nombre} · {}", detalle.as_ref());
}

/// Un paso que no pasó.
fn falla(nombre: &str, detalle: impl AsRef<str>) {
    log::error!("SP_JAM_PAIR: FALLA {nombre} · {}", detalle.as_ref());
}

/// La segunda sesión: otra cuenta, otro dispositivo, el mismo servicio.
fn guest_session(dir: &Path) -> Result<Session, String> {
    let cache = crate::auth::open_cache_at(dir)?;
    if cache.credentials().is_none() {
        return Err(format!(
            "no hay credenciales en {}: esa cuenta todavía no se conectó en esta máquina",
            dir.display()
        ));
    }

    let client_id = crate::auth::streaming_client_id();
    let mut config = crate::auth::session_config(&client_id);
    config.device_id = GUEST_DEVICE.to_string();
    crate::auth::connect_now_as(config, &cache)
}

/// El ciclo entero, paso por paso.
pub fn run(app: tauri::AppHandle) {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(host) = crate::selftest::wait_for_session(&app) else {
            log::error!("SP_JAM_PAIR: la sesión del anfitrión no llegó a conectar");
            return;
        };

        let Some(dir) = guest_cache_dir() else {
            log::error!(
                "SP_JAM_PAIR: falta STARLESS_SP_JAM_PAIR_CACHE — el directorio donde vive la credencial de la segunda cuenta"
            );
            return;
        };

        let guest = match guest_session(&dir) {
            Ok(session) => session,
            Err(error) => {
                log::error!("SP_JAM_PAIR: la segunda cuenta no conectó: {error}");
                return;
            }
        };

        log::info!("=== DIAGNOSTIC: el jam con los dos lados ===");
        log::info!(
            "SP_JAM_PAIR: anfitrión {} (dispositivo {}) · invitado (dispositivo {})",
            host.username(),
            host.device_id(),
            GUEST_DEVICE
        );

        // 1. El anfitrión abre el jam.
        let host_session = match jam_session(&host, true) {
            Ok(session) => session,
            Err(error) => {
                falla("el anfitrión abre el jam", &error);
                return;
            }
        };
        let session_id = host_session.session_id.clone();
        pasa(
            "el anfitrión abre el jam",
            format!("sesión {session_id} · {} participantes", host_session.session_members.len()),
        );

        // 2. El jam trae el código con el que se une la gente.
        let Some(token) = host_session
            .join_session_token
            .clone()
            .filter(|token| !token.is_empty())
        else {
            falla("el jam trae un código para unirse", "vino sin join_session_token");
            return;
        };
        pasa("el jam trae un código para unirse", "sí");

        // 3. El invitado se une con el código.
        //
        // **Esto es lo primero que puede fallar de verdad**: la puerta de unirse
        // es un `POST` con cuerpo y no acepta cualquier cuenta.
        let joined = match jam_join(&guest, &token) {
            Ok(session) => session,
            Err(error) => {
                falla("el invitado se une con el código", &error);
                return;
            }
        };
        if joined.session_id == session_id {
            pasa("el invitado se une con el código", format!("entró en {session_id}"));
        } else {
            falla(
                "el invitado se une con el código",
                format!(
                    "entró en {} y el jam es {session_id}",
                    joined.session_id
                ),
            );
            return;
        }

        // 4. El invitado puede preguntar por la sesión y recibe la del anfitrión.
        //
        // **La puerta que pregunta es la misma que abre, y abre.** Si la
        // respuesta del invitado fuera una sesión propia —una nueva, con su
        // dueño— el panel del invitado cerraría el jam a los tres segundos, y
        // sería exactamente el síntoma de "el jam no funciona".
        match jam_session(&guest, false) {
            Ok(poll) => {
                if poll.session_id == session_id {
                    pasa(
                        "el invitado sigue en la sesión del anfitrión",
                        format!("preguntó y recibió {session_id}"),
                    );
                } else {
                    falla(
                        "el invitado sigue en la sesión del anfitrión",
                        format!(
                            "preguntó y el servicio le devolvió {} — una sesión distinta",
                            poll.session_id
                        ),
                    );
                }
            }
            Err(error) => falla("el invitado puede preguntar por la sesión", &error),
        }

        // 5. El anfitrión pregunta y ve al invitado.
        match jam_session(&host, false) {
            Ok(poll) => {
                let members = poll.session_members.len();
                if members >= 2 {
                    pasa(
                        "el anfitrión ve al invitado",
                        format!("{members} participantes"),
                    );
                } else {
                    falla(
                        "el anfitrión ve al invitado",
                        format!("la sesión trae {members} participante(s) y el invitado no está"),
                    );
                }
            }
            Err(error) => falla("el anfitrión puede preguntar por la sesión", &error),
        }

        // 6. El invitado manda una canción a la cola compartida.
        match jam_add_to_queue(&guest, &session_id, TRACK) {
            Ok(()) => pasa("el invitado manda una canción a la cola", TRACK),
            Err(error) => falla("el invitado manda una canción a la cola", &error),
        }

        // 7. La canción aparece en la cola que lee el anfitrión.
        //
        // **Este es el paso que decide si el jam sirve para algo.** La cola del
        // jam es la cola del player del anfitrión: si esa cola no existe —y
        // con librespot no hay cola publicada—, el comando entra y no hay nada
        // que leer, y el otro lado no escucha nada.
        match jam_queue(&host, &session_id) {
            Ok(queue) => {
                if queue.iter().any(|track| track.id == TRACK) {
                    pasa(
                        "la canción del invitado llegó a la cola del anfitrión",
                        format!("la cola tiene {} canciones", queue.len()),
                    );
                } else {
                    falla(
                        "la canción del invitado llegó a la cola del anfitrión",
                        format!(
                            "la cola tiene {} canciones y ninguna es la que mandó el invitado",
                            queue.len()
                        ),
                    );
                }
            }
            Err(error) => falla("el anfitrión puede leer la cola compartida", &error),
        }

        // 8. Y el invitado lee la misma cola.
        match jam_queue(&guest, &session_id) {
            Ok(queue) => pasa(
                "el invitado puede leer la cola compartida",
                format!("{} canciones", queue.len()),
            ),
            Err(error) => falla("el invitado puede leer la cola compartida", &error),
        }

        // 9. El anfitrión manda una canción a su propia cola.
        //
        // **Lo que hace el cliente de escritorio cuando sos el anfitrión.** Si
        // esto tampoco crea la lista, la lista no la crea el comando: la crea
        // el player que publica su contexto, y librespot no publica ninguno.
        match jam_add_to_queue(&host, &session_id, TRACK) {
            Ok(()) => pasa("el anfitrión manda una canción a su propia cola", TRACK),
            Err(error) => falla("el anfitrión manda una canción a su propia cola", &error),
        }
        match jam_queue(&host, &session_id) {
            Ok(queue) => {
                if queue.iter().any(|track| track.id == TRACK) {
                    pasa(
                        "la cola del anfitrión se puede sembrar",
                        format!("la cola tiene {} canciones", queue.len()),
                    );
                } else {
                    falla(
                        "la cola del anfitrión se puede sembrar",
                        format!("la cola tiene {} canciones y no tomó la suya", queue.len()),
                    );
                }
            }
            Err(error) => falla("el anfitrión puede leer la cola compartida", &error),
        }

        // 10. El invitado se sale.
        match jam_leave(&guest, &session_id) {
            Ok(()) => pasa("el invitado se sale del jam", "la puerta de irse"),
            Err(error) => falla("el invitado se sale del jam", &error),
        }

        // 11. El anfitrión lo ve irse.
        match jam_session(&host, false) {
            Ok(poll) => {
                let members = poll.session_members.len();
                if members < 2 {
                    pasa(
                        "el anfitrión ve al invitado irse",
                        format!("quedan {members} participante(s)"),
                    );
                } else {
                    falla(
                        "el anfitrión ve al invitado irse",
                        format!("la sesión sigue con {members} participantes"),
                    );
                }
            }
            Err(error) => falla("el anfitrión puede preguntar por la sesión", &error),
        }

        // 12. El anfitrión cierra el jam.
        match jam_end(&host, &session_id) {
            Ok(()) => pasa("el anfitrión cierra el jam", "la puerta del dueño"),
            Err(error) => falla("el anfitrión cierra el jam", &error),
        }

        log::info!("=== DIAGNOSTIC: fin del jam con los dos lados ===");
    });
}
