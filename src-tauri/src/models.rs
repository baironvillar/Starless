//! Las formas que el frontend ve.
//!
//! Estos tipos no son de Spotify ni de librespot: son de Starless. Existen desde
//! antes de que la biblioteca viniera por la Web API y le servían a las dos por
//! igual, y pasaron intactos por la migración — el frontend nunca se enteró de
//! que había cambiado de dónde venían los datos.
//!
//! Que la app hable un solo vocabulario hacia adentro es lo que hizo posible
//! cambiar de proveedor sin tocar una línea de React. Por eso viven acá y no en
//! el módulo del cliente que los llenaba: un archivo llamado `webapi` que
//! sobrevive a la Web API sería una mentira con nombre propio.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Una imagen, y sólo su dirección.
///
/// **Sin `width` ni `height`, a propósito.** Los terciosvendían las dos, y el
/// frontend ordenaba por ancho para quedarse con la portada más grande. Pero el
/// canal por el que llega la biblioteca —`PictureSize`, en
/// `playlist4_external.proto`— **no tiene esos campos**: trae `target_name` y
/// `url`, y nada más. El ancho se adivinaría parseando el nombre del objetivo
/// ("small", "large", "XL"), que es una conjetura sobre una etiqueta, no un
/// dato.
///
/// Así que el campo venía siempre en `null`, el `reduce` del frontend comparaba
/// `0 > 0` y devolvía la primera imagen — que es exactamente lo que su comentario
/// decía que no pasaba. La app nunca eligió la portada grande; al borrar los
/// campos no se pierde nada, se cae una promesa que nunca se cumplió. Si algún día
/// el canal trae los tamaños de verdad, el campo vuelve con algo que lo llene.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Image {
    pub url: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Owner {
    #[serde(default)]
    pub display_name: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Artist {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Album {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub images: Vec<Image>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Track {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub duration_ms: Option<u32>,
    #[serde(default)]
    pub artists: Vec<Artist>,
    #[serde(default)]
    pub album: Option<Album>,
    /// Absent from responses for apps created after February 2026, so it is an
    /// `Option` rather than a `0` that quietly means "no data".
    #[serde(default)]
    pub popularity: Option<u32>,
    /// Cuándo se agregó esta canción a la lista de la que vino, en milisegundos
    /// desde la época Unix.
    ///
    /// **Es de la fila, no de la canción, y por eso viaja en la pista.** Viene en
    /// `ItemAttributes.timestamp` (`playlist4_external.proto`), que sólo existe
    /// cuando la respuesta es una lista de reproducción: un `Context` —canciones
    /// guardadas, búsqueda— trae las URIs peladas y no trae fecha por ítem. La
    /// columna "cuándo la agregué" es, literalmente, una pregunta sobre la fila.
    ///
    /// Un `Option` y no un `0`: `None` es "esta lista no dice", que es un hecho
    /// distinto de "se agregó el 1 de enero de 1970". La pantalla lo muestra así.
    #[serde(default)]
    pub added_at: Option<i64>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TrackTotal {
    pub total: u32,
}

/// El DJ: lo que Spotify le fabricó a la cuenta, y lo que dice.
///
/// **El mix y la voz son dos cosas distintas.** Las canciones del DJ son
/// pistas del catálogo, con nombre, con duración y con audio, y se reproducen
/// como cualquier otra. La voz sí se puede tener: el texto de la narración
/// viene con la fila, y el audio lo pide el backend al servicio que lo
/// fabrica. Así que esto lleva la frase, el nombre de quien la dice y el
/// número de la voz que va a sonar.
///
/// **La frase va con su canción, y no suelta.** El DJ abre el tramo con una
/// frase y lo cierra con otra, y el servicio las cuelga de la primera y de la
/// última canción del tramo. Por eso las frases van indexadas por canción: la
/// que se muestra es la de la que está sonando, no la última que llegó.
///
/// **Y la voz no va acá.** La voz es de la canción, y se pide cuando la
/// canción va a sonar: el backend la guarda y el frontend la pide por id. Un
/// número de voz en el mix era el número de la *página*, y una página tiene
/// cinco canciones y dos frases: el frontend no iba a saber cuál de las dos
/// era la que había que decir.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DjMix {
    /// Las canciones que eligió el DJ, en el orden que las eligió.
    pub tracks: Vec<Track>,
    /// Lo que dice el DJ, por id de canción. No todas las canciones tienen.
    #[serde(default)]
    pub lines: HashMap<String, DjNarration>,
}

/// Lo que hizo la voz del DJ.
///
/// Va al frontend como evento, porque el frontend tiene que saber cuándo
/// puede poner la música: la voz va primero, y la canción después.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DjVoiceEvent {
    /// La voz de la que se trata: el mismo número que volvió en el mix.
    pub id: u64,
    /// `true` cuando ya terminó, se haya oido entera o la hayan cortado.
    pub done: bool,
}

/// Una frase del DJ.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DjNarration {
    /// Quién la dice: "DJ Livi".
    pub speaker: String,
    /// La frase, en texto y sin el SSML.
    pub line: String,
}

/// Una página de la sesión del DJ: las canciones, y por dónde sigue.
///
/// **La página siguiente no se pide igual que la primera.** La primera viene
/// como `pages[].tracks`; las que siguen traen las canciones en la raíz, con
/// su `next_page_url` al lado. Es el mismo servicio con dos formas, y una
/// implementación que sólo leyera una de las dos convertiría una estación en
/// una lista de diez.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DjPage {
    /// Lo que sonó en esta página.
    pub mix: DjMix,
    /// Por dónde sigue la sesión, en el host de Spotify. `None` cuando el DJ
    /// dijo que se terminó.
    #[serde(default)]
    pub next: Option<String>,
    /// Los parámetros de la voz del DJ, por canción.
    ///
    /// **No va al frontend.** El webview no necesita saber qué formato de audio
    /// pidió el DJ: la voz se pide y se pone en el backend, y al panel le
    /// alcanza con la frase.
    ///
    /// Va por canción y no por página porque la frase es de la canción: la
    /// primera de un tramo abre y la última lo cierra, y las dos se dicen
    /// **antes** de esa canción —"así termina este segmento, al ritmo de The
    /// Weeknd" se dice, y después suena The Weeknd—.
    #[serde(skip)]
    pub voices: HashMap<String, crate::voice::VoiceParams>,
}

/// One line of a song's words, with the moment it is sung.
///
/// `start_ms` is `None` when the provider sent no timings, which is a real answer
/// and not a zero: a lyrics service that has the words but no clock produces
/// `"startTimeMs": "0"` for every line, and reading that as "sung at the start of
/// the song" would light up line one for the whole track.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LyricLine {
    pub text: String,
    #[serde(default)]
    pub start_ms: Option<u64>,
}

/// The words to a song, if the provider has them.
///
/// Not every song does. That is a normal answer, not a failure, and the frontend
/// has something true to say when it happens.
///
/// **No `language`.** El proveedor sí lo manda, y durante un tiempo el campo se
/// quedó con la excusa de que algún día diría si una letra era original o
/// traducida. Nunca llegó ese día: nadie lo leía, y un campo que viaja en cada
/// respuesta para que nadie lo mire es ruido con forma de dato. Si algún día hay
/// una pantalla que lo use, vuelve con el valor que ya está en la respuesta.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Lyrics {
    #[serde(default)]
    pub lines: Vec<LyricLine>,
    /// True when the lines carry timings and can be followed along.
    #[serde(default)]
    pub synced: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Playlist {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub images: Vec<Image>,
    #[serde(default)]
    pub owner: Option<Owner>,
    #[serde(default)]
    pub tracks: Option<TrackTotal>,
    #[serde(default)]
    pub collaborative: bool,
    /// La descripción que escribió el dueño, si hay alguna.
    ///
    /// **Viene en los atributos del rootlist**, en el mismo mensaje que el
    /// nombre: no es una lectura extra ni una pantalla nueva. Una descripción
    /// vacía es una descripción vacía, no una descripción ausente — de ahí el
    /// `Option` con filtro en vez de un `String` vacío que no distingue
    /// "no escribió nada" de "escribió un espacio".
    #[serde(default)]
    pub description: Option<String>,
    /// Si la portada es una que subió el dueño.
    ///
    /// **La que se ve no lo dice.** Spotify arma una portada con las primeras
    /// canciones cuando el dueño no sube ninguna, y las dos se ven igual en
    /// `images`. Lo que las distingue está en los atributos: el id de la imagen
    /// propia viaja ahí, y sin él no hay portada propia. Sin este campo, el
    /// diálogo de detalles no puede ofrecer quitar la que el dueño puso — y
    /// offercerlo a ciegas sería prometer algo que a veces no hay.
    #[serde(default)]
    pub custom_cover: bool,
    /// Si la playlist es pública.
    ///
    /// **No está en los atributos de la playlist, sino en el ítem de la
    /// biblioteca.** `public` es el campo 10 de `ItemAttributes` —el mismo que el
    /// cliente de escritorio manda en `true` cuando la playlist entra en la
    /// biblioteca— y dice si aparece en el perfil público de la cuenta. Es lo
    /// único que "Make private" pone en `false`.
    ///
    /// Un ítem sin ese atributo es una playlist **pública**, que es el estado por
    /// defecto de Spotify: declararla privada sin saberlo sería mentira.
    #[serde(default = "public_by_default")]
    pub is_public: bool,
}

/// Lo público es lo que Spotify hace por omisión.
fn public_by_default() -> bool {
    true
}

/// Lo que cambió en los detalles de una playlist.
///
/// **Cada campo es opcional, y `None` significa "no lo toques".** Los atributos
/// de una playlist se escriben como un estado parcial: `values` lleva lo que se
/// pone y `no_value` lo que se vacía, y lo que no está en ninguno de los dos se
/// queda como estaba. Por eso un `None` acá no es "vaciarlo" sino "no
/// escribirlo" — y por eso el renombrado no tocó la descripción de las
/// playlists que ya la traían.
///
/// **La portada no viaja por acá.** El frontend manda la imagen —los bytes del
/// JPEG— y el backend la sube, la registra y recién entonces llena el id que
/// va en los atributos. El id de la imagen no lo pone nadie desde el webview:
/// es una cosa del servicio, y una cosa del servicio no se escribe a mano.
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct PlaylistDetails {
    /// El nombre nuevo.
    #[serde(default)]
    pub name: Option<String>,
    /// La descripción nueva. Una vacía es una descripción vacía.
    #[serde(default)]
    pub description: Option<String>,
    /// Quitar la portada propia y volver a la que arma Spotify.
    #[serde(default)]
    pub remove_picture: bool,
    /// La visibilidad nueva: `false` es privada.
    ///
    /// **Viaja aparte de los atributos, porque es otro mensaje.** La visibilidad
    /// es un atributo del ítem de la biblioteca —una fila del rootlist— y no de
    /// la playlist: se escribe contra la revisión de la biblioteca y en otro
    /// endpoint. Por eso va en su propio campo y no dentro de `ListAttributes`,
    /// que no tiene dónde ponerlo.
    ///
    /// `None` es "no la toques", como en los otros campos: el diálogo sólo lo
    /// manda cuando la persona movió el interruptor.
    #[serde(default)]
    pub is_public: Option<bool>,
}

/// La cuenta, tal como la ve el frontend.
///
/// **Sin `email`.** La sesión entrega un perfil con nombre y fotos, no una
/// casilla: el campo venía siempre en `None` y nadie lo leía. Una dirección que
/// nunca llega no es un dato, es la promesa de uno.
///
/// El resto de la forma la exige la regla del repo: el webview no recibe
/// credenciales, así que lo que sale de acá es lo que la pantalla puede saber
/// sobre la sesión — quién es, y si puede reproducir algo.
#[derive(Serialize, Debug)]
pub struct Account {
    pub id: String,
    #[serde(default)]
    pub display_name: Option<String>,
    /// `premium`. Checked once, early: without Premium Spotify serves no audio
    /// at all, and librespot already refuses to keep a session open for one.
    #[serde(default)]
    pub product: Option<String>,
    #[serde(default)]
    pub images: Vec<Image>,
}
