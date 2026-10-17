//! The Spotify Web API, as far as it can be reached from a public app id.
//!
//! **Everything here is one HTTP call away from a new app being useless**, so the
//! surface is deliberately small. These are the endpoints that still work for an
//! app in development mode:
//!
//! | Call | Gives us |
//! |---|---|
//! | `/me` | display name, profile picture, and — the one that matters — whether the account is Premium |
//! | `/me/playlists` | the user's own playlists |
//! | `/me/tracks` | Liked Songs |
//! | `/search` | the search box |
//! | `/playlists/{id}/items` | what is on a playlist |
//! | `/playlists/{id}/items` (POST) | putting a track on a playlist |
//! | `/me/playlists` (POST) | a playlist of our own |
//!
//! The playlist endpoints say `items`, not `tracks`, and that is not a style
//! choice: Spotify's February 2026 migration renamed them, and the old `/tracks`
//! path answers `403` for every playlist in development mode — including the ones
//! the account owns. See `playlist_tracks`.
//!
//! One consequence is worth stating plainly rather than discovering later: in
//! development mode, playlist contents are only readable for playlists the user
//! owns or collaborates on. Followed playlists and Spotify's own editorial ones
//! (Daily Mix, Discover Weekly) return 403 no matter what the client does, and
//! there is no client-side way around it.
//!
//! The last three are the reason several calls here can answer `forbidden`
//! instead of working: writing to a playlist needs the `playlist-modify-*`
//! scopes, which `auth::SCOPES` does not ask for yet. They are here because the
//! scopes are the part that is missing, not the calls.
//!
//! What is **not** here, and why: `/browse/*`, `/recommendations`, `/artists/{id}/
//! related-artists` and `/artists/{id}/top-tracks` were closed to applications
//! created after 11 February 2026. The algorithmic home feed therefore cannot
//! come from this API at all â€” it has to come from librespot's internal
//! `spclient`, which is a different module with a different set of risks.
//! `PRODUCT.md` keeps the feed, so that work exists; it just is not this file.
//!
//! Field names are left exactly as Spotify sends them. Renaming them to
//! camelCase here would be cosmetic and would make every struct carry a rename
//! attribute whose only job is to be wrong one day.

use std::sync::OnceLock;

use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::auth;
use crate::token::NETWORK_TIMEOUT;

const API: &str = "https://api.spotify.com/v1";

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Image {
    pub url: String,
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub height: Option<u32>,
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
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TrackTotal {
    pub total: u32,
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
}

/// Un álbum tal como lo devuelve una búsqueda.
///
/// Distinto de [`Album`] porque el álbum *de una pista* no trae año: la canción
/// dice «Blonde» y nada más. Aquí sí viene `release_date`, y es lo único que
/// permite poner «2016» bajo una portada sin inventarlo.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AlbumCard {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub images: Vec<Image>,
    #[serde(default)]
    pub artists: Vec<Artist>,
    /// `2016`, o `2016-08-20` cuando Spotify tuvo la precisión para darla.
    #[serde(default)]
    pub release_date: Option<String>,
    /// `year`, `month` o `day`. Sin esto no hay forma de saber si «2016» es un
    /// año entero o el día 1 de enero, y mostrar «2016-01-01» sería fabricar
    /// precisión que nadie recibió.
    #[serde(default)]
    pub release_date_precision: Option<String>,
    #[serde(default)]
    pub total_tracks: Option<u32>,
    /// `album`, `single` o `compilation`.
    #[serde(default)]
    pub album_type: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ArtistCard {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub images: Vec<Image>,
}

/// Una búsqueda completa: lo que el usuario pidió, en las cuatro cosas que puede
/// haber pedido.
///
/// Una sola estructura porque las cuatro respuestas van en el mismo viaje a
/// Spotify y separarlas obligaría a la pantalla a pedir cuatro veces lo que el
/// usuario escribió una.
#[derive(Serialize, Debug, Default)]
pub struct SearchResults {
    pub tracks: Vec<Track>,
    pub albums: Vec<AlbumCard>,
    pub artists: Vec<ArtistCard>,
    pub playlists: Vec<Playlist>,
}

/// La ficha de un artista.
///
/// **No tiene canciones «populares»** porque no hay forma de obtenerlas:
/// `/artists/{id}/top-tracks` responde 403 a toda app creada después del 11 de
/// febrero de 2026. Las canciones de aquí salen de una búsqueda con filtro de
/// campo y son reales, pero no están ordenadas por popularidad — y por eso esta
/// vista no las llama «populares».
#[derive(Serialize, Debug)]
pub struct ArtistProfile {
    pub artist: ArtistCard,
    pub albums: Vec<AlbumCard>,
    pub tracks: Vec<Track>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Account {
    pub id: String,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
    /// `premium`, or `free`/`premium_user`. The check Starless has to make
    /// early, because without Premium Spotify serves no audio at all.
    #[serde(default)]
    pub product: Option<String>,
    #[serde(default)]
    pub images: Vec<Image>,
}

/// A `/me/tracks` entry, which wraps the track in the moment it was saved.
#[derive(Deserialize)]
struct SavedItem {
    /// `None` for a track Spotify has withdrawn — delisted, or unavailable in
    /// this account's region.
    ///
    /// It really does come back as `null` here, not as a partial object, so a
    /// non-optional field does not fail the *entire* library on one bad song: the
    /// response stops deserialising and the user sees an empty Liked Songs with an
    /// error, instead of 199 of their 200 songs.
    track: Option<Track>,
}

#[derive(Deserialize)]
struct SavedPage {
    #[serde(default)]
    items: Vec<SavedItem>,
}

#[derive(Deserialize, Default)]
struct PlaylistPage {
    #[serde(default)]
    items: Vec<Playlist>,
}

/// Una página de `/search`.
///
/// Los cuatro tipos son opcionales porque `/search` solo devuelve las llaves que
/// pediste: asking for tracks and reading `albums.items` on that response is an
/// error waiting for a query that does not ask for albums.
#[derive(Deserialize, Default)]
struct SearchPage {
    #[serde(default)]
    tracks: TrackItems,
    #[serde(default)]
    albums: AlbumItems,
    #[serde(default)]
    artists: ArtistItems,
    #[serde(default)]
    playlists: PlaylistPage,
}

#[derive(Deserialize, Default)]
struct TrackItems {
    #[serde(default)]
    items: Vec<Track>,
}

/// Una página de `/search?type=album`, o de `/artists/{id}/albums` — misma forma
/// en los dos casos, verificado contra la API en producción.
#[derive(Deserialize, Default)]
struct AlbumItems {
    #[serde(default)]
    items: Vec<AlbumCard>,
}

#[derive(Deserialize, Default)]
struct AlbumItemsPage {
    #[serde(default)]
    items: Vec<AlbumCard>,
}

#[derive(Deserialize, Default)]
struct ArtistItems {
    #[serde(default)]
    items: Vec<ArtistCard>,
}

/// Una página de `/albums/{id}/tracks`.
///
/// **La lista viene plana**, sin el envoltorio `{"track": …}` que usan las
/// playlists. Se verificó: cada elemento de `items` es la pista, con sus
/// propios `name` y `artists`, y `items[].track` viene `null`. Reutilizar aquí
/// el tipo de las playlists daría 200 con una lista vacía y ningún error.
#[derive(Deserialize, Default)]
struct AlbumTracksPage {
    #[serde(default)]
    items: Vec<Track>,
}

/// A `/playlists/{id}/items` entry. The inner key is `item`, not `track` — part of
/// the same February 2026 rename, and the reason a client that only updates the
/// URL gets 200 with an empty list and no error.
///
/// `Option` because a withdrawn track arrives with nothing in that slot, and one
/// unavailable song must not turn a whole playlist into a parse error.
#[derive(Deserialize)]
struct PlaylistItem {
    #[serde(default)]
    item: Option<Track>,
}

#[derive(Deserialize)]
struct PlaylistItemsPage {
    #[serde(default)]
    items: Vec<PlaylistItem>,
}

/// One HTTP client, shared by every call, for the life of the process.
///
/// Built once and reused, and the reuse is the whole point: a fresh
/// `reqwest::blocking::Client` per request means a fresh TLS handshake against
/// `api.spotify.com` every time. Measured from this machine, that is most of an
/// 800ms request — the connection is established, used once, and thrown away,
/// so opening a playlist paid the handshake again even though the previous
/// request had just done it.
///
/// **A failed build is not remembered.** `OnceLock::get_or_init` takes a closure
/// that cannot fail, and the obvious workaround — caching the `Result` — was
/// here for a while and cost a whole session of an empty library. Building a
/// blocking client spawns a thread and does a handshake with it, so it fails
/// for reasons that are gone seconds later (a slow start, a saturated thread
/// pool, a laptop coming off sleep). Caching that failure means every later call
/// in the process returns it too: one unlucky second at launch, and the library
/// stays empty until the app is restarted, with no `webapi:` line anywhere to
/// say why — because a client that never built never reaches the line that logs
/// every answer.
///
/// `OnceLock::get_or_try_init` would say this more directly but is still
/// unstable. Two threads racing here both build and the first one into the cell
/// is the one everyone uses; the loser's client is dropped on the blocking
/// thread that built it, which is the only place a blocking client may be
/// dropped at all.
static CLIENT: OnceLock<reqwest::blocking::Client> = OnceLock::new();

fn client() -> Result<&'static reqwest::blocking::Client, String> {
    if let Some(existing) = CLIENT.get() {
        return Ok(existing);
    }

    let built = reqwest::blocking::Client::builder()
        .timeout(NETWORK_TIMEOUT)
        // Connection reuse is reqwest's default, but it is the behaviour this
        // function exists to provide, so it is stated rather than assumed.
        .pool_max_idle_per_host(4)
        .build()
        .map_err(|e| {
            // Logged here because this failure produces no request: `send` never
            // gets far enough to log the answer it has to report.
            log::error!("webapi: no se pudo abrir el cliente HTTP: {e}");
            auth::fail("network_failed", e)
        })?;

    Ok(CLIENT.get_or_init(|| built))
}

/// One request. Blocking, because the caller has already refreshed the token on
/// a blocking thread and there is no point pretending otherwise here.
///
/// Takes the bearer token rather than the state that owns it, so it can move
/// into a blocking closure.
///
/// The error path is deliberately opaque to the webview: a 403 from a
/// development-mode app is a product-level condition with a dedicated screen,
/// not something to render as a stack trace.
///
/// Hands back the response with its status already vetted instead of the decoded
/// body, because the writes below answer 201 with a snapshot id that nobody here
/// reads, and decoding a body we do not need is how a successful call turns into
/// a `bad_response`.
///
/// A `503` gets one more try. It is not politeness: measured against this
/// account, two of every fifteen requests to `api.spotify.com` came back 503 with
/// nothing wrong on our side — it is Spotify's edge, not the request. Retrying once
/// turns a visible "search failed" into a delay nobody notices.
fn send(
    path: &str,
    method: Method,
    body: Option<&serde_json::Value>,
    access_token: &str,
) -> Result<reqwest::blocking::Response, String> {
    let client = client()?;

    for attempt in 0..SERVICE_UNAVAILABLE_ATTEMPTS {
        let mut request = client
            .request(method.clone(), format!("{API}{path}"))
            .bearer_auth(access_token);
        if let Some(body) = body {
            // Through `json` rather than a hand-rolled header: it is the only way the
            // Content-Type gets set, and Spotify refuses a POST without it with an
            // error that says nothing about the body.
            request = request.json(body);
        }

        let response = request.send().map_err(|e| {
            // The other half of "one line per call". Without this, a request that
            // never reached Spotify leaves no trace at all, and "the request
            // failed" and "the request was never made" are the same empty log.
            log::error!("webapi: {path} no llegó a Spotify: {e}");
            auth::fail("network_failed", e)
        })?;
        let status = response.status().as_u16();

        // Every answer, not only the refusals.
        //
        // This was added because a twelve-minute Spotify outage produced a log
        // with nothing in it but errors: "the library is empty" and "the library
        // never asked" are indistinguishable when a success says nothing. One line
        // per call is what makes the next one answerable — and this is a local
        // file with rotation, not telemetry.
        log::info!("webapi: {status} {path}");

        if status == 503 && attempt + 1 < SERVICE_UNAVAILABLE_ATTEMPTS {
            log::warn!("webapi: 503 en {path}, un reintento");
            std::thread::sleep(SERVICE_UNAVAILABLE_WAIT);
            continue;
        }

        return match status {
            200 | 201 | 204 => Ok(response),
            // The path goes into the log for every refusal, not just the rare ones.
            // A bare `forbidden` is undiagnosable: "which playlist?", "which call?" —
            // and a 403 that the user sees as "your account can't access this" is very
            // often one specific playlist rather than the whole token.
            401 => Err(auth::fail("unauthorised", path)),
            403 => Err(auth::fail("forbidden", path)),
            429 => Err(auth::fail("rate_limited", path)),
            503 => Err(auth::fail("service_unavailable", path)),
            code => Err(auth::fail(&format!("api_{code}"), path)),
        };
    }

    // The loop above always returns or continues. This line is only here so the
    // signature closes; the only way to reach it is a `continue` with no attempt
    // left, which the condition above rules out.
    Err(auth::fail("service_unavailable", path))
}

/// How many tries a `503` gets, and how long to wait between them. Long enough
/// for the edge to recover, short enough that a genuinely broken request fails
/// fast instead of hanging.
const SERVICE_UNAVAILABLE_ATTEMPTS: usize = 2;
const SERVICE_UNAVAILABLE_WAIT: std::time::Duration = std::time::Duration::from_millis(400);

/// The body of a response [`send`] has already agreed is worth reading.
fn decode<T: serde::de::DeserializeOwned>(
    response: reqwest::blocking::Response,
) -> Result<T, String> {
    response
        .json::<T>()
        .map_err(|e| auth::fail("bad_response", e))
}

fn get<T: serde::de::DeserializeOwned>(path: &str, access_token: &str) -> Result<T, String> {
    decode(send(path, Method::GET, None, access_token)?)
}

pub fn liked_tracks(access_token: &str) -> Result<Vec<Track>, String> {
    Ok(get::<SavedPage>("/me/tracks?limit=50", access_token)?
        .items
        .into_iter()
        .filter_map(|item| item.track)
        .collect())
}

pub fn search(access_token: &str, query: &str) -> Result<Vec<Track>, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    let encoded: String = urlencoding::encode(trimmed).into_owned();
    // Development-mode apps are capped at 10 results per search, down from 50.
    let path = format!("/search?q={encoded}&type=track&limit={SEARCH_LIMIT}");
    Ok(get::<SearchPage>(&path, access_token)?.tracks.items)
}

/// The per-type ceiling for `/search` in development mode.
///
/// Measured, not assumed: `limit=10` answers 200 with ten items, `limit=11`
/// answers 503 and `limit=20` answers 400. The quota is ten per type, and there
/// is no client-side way to raise it.
const SEARCH_LIMIT: usize = 10;

/// Everything one query turned up, in all four types.
///
/// Two requests, on purpose. The first asks for all four types at once, which is
/// one round trip for everything the results screen shows. The second asks only
/// for the *second page of songs*: ten results is a thin "Songs" tab next to
/// Spotify's, and `offset` works even though `limit` cannot grow, so the songs get
/// a second page while albums, artists and playlists do not need one.
pub fn search_all(access_token: &str, query: &str) -> Result<SearchResults, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(SearchResults::default());
    }
    let encoded: String = urlencoding::encode(trimmed).into_owned();

    let first = get::<SearchPage>(
        &format!("/search?q={encoded}&type=track,album,artist,playlist&limit={SEARCH_LIMIT}"),
        access_token,
    )?;
    let more = get::<SearchPage>(
        &format!("/search?q={encoded}&type=track&limit={SEARCH_LIMIT}&offset={SEARCH_LIMIT}"),
        access_token,
    )?;

    Ok(SearchResults {
        tracks: first.tracks.items.into_iter().chain(more.tracks.items).collect(),
        albums: first.albums.items,
        artists: first.artists.items,
        playlists: first.playlists.items,
    })
}

/// Everything on an album, in the order it plays.
///
/// This is what makes the play button on an album card real rather than
/// decorative: the card hands the frontend an actual track list to queue, and the
/// frontend plays the first one.
///
/// Note the payload is **flat** here — no `{"track": …}` wrapper, unlike playlist
/// items. Verified against the live API; reusing the playlist page type would give
/// a clean 200 with an empty list and no error to chase.
pub fn album_tracks(access_token: &str, album_id: &str) -> Result<Vec<Track>, String> {
    let id = urlencoding::encode(album_id);
    let mut tracks: Vec<Track> = Vec::new();

    for page in 0..MAX_PAGES {
        let offset = page * PAGE_SIZE;
        let path = format!("/albums/{id}/tracks?limit={PAGE_SIZE}&offset={offset}");
        let batch = get::<AlbumTracksPage>(&path, access_token)?;

        let received = batch.items.len();
        tracks.extend(batch.items);
        if received < PAGE_SIZE {
            break;
        }
    }

    Ok(tracks)
}

/// How many albums a profile shows. Spotify's own artist page shows a shelf of
/// about ten, and past that the discography is a scroll nobody does in a profile
/// they opened by accident.
const ARTIST_ALBUM_LIMIT: usize = 10;

/// An artist, their discography, and the songs a field-filtered search returns
/// for them.
///
/// **There are no "top tracks" here and that is not an omission.**
/// `/artists/{id}/top-tracks` answers 403 for every app created after 11 February
/// 2026 — measured, not documented-only — and Spotify removed the `popularity`
/// field that would have let this client rank songs itself. So the songs are
/// whatever `artist:<name>` finds, filtered to the ones this artist is actually
/// credited on (collaborations credit other people too, and they would otherwise
/// show up as this artist's songs).
///
/// The alternative — leaving the section out — would be a profile with a face and
/// no music on it, which is worse than an honest list in search order.
pub fn artist_profile(access_token: &str, artist_id: &str) -> Result<ArtistProfile, String> {
    let id = urlencoding::encode(artist_id);

    let artist: ArtistCard = get(&format!("/artists/{id}"), access_token)?;
    let albums = get::<AlbumItemsPage>(
        &format!("/artists/{id}/albums?limit={ARTIST_ALBUM_LIMIT}&include_groups=album,single"),
        access_token,
    )?
    .items;

    // The field filter is `artist:`, unquoted — with quotes Spotify answered 503.
    let field = format!("artist:{}", artist.name);
    let query = urlencoding::encode(&field);
    let songs = get::<SearchPage>(
        &format!("/search?q={query}&type=track&limit={SEARCH_LIMIT}"),
        access_token,
    )?;
    let tracks = songs
        .tracks
        .items
        .into_iter()
        .filter(|track| track.artists.iter().any(|credit| credit.id == artist.id))
        .collect();

    Ok(ArtistProfile {
        artist,
        albums,
        tracks,
    })
}

/// How many items to ask for per page. Also this endpoint's ceiling.
const PAGE_SIZE: usize = 50;

/// How many pages to walk before giving up.
///
/// Not a limit on what a playlist may contain — a limit on how long "open a
/// playlist" is allowed to take. Twenty pages is a thousand songs, which is past
/// what anyone scrolls, and past that the answer is still exact for the part on
/// screen because the count always describes what was actually loaded.
const MAX_PAGES: usize = 20;

/// A playlist, fully walked.
///
/// `/items`, not `/tracks`: Spotify's February 2026 migration renamed every
/// playlist-content endpoint, and the old path is not merely deprecated for a
/// development app — it answers 403 for every playlist, including ones the
/// account owns, with an empty body that points nowhere.
///
/// The rename also moved the payload. What used to arrive as `tracks` is now
/// `items`, and what used to be `items[].track` is now `items[].item` — so a
/// client that only changes the URL gets 200 with an empty list and no error.
///
/// Paged all the way to the end because the count is the point. Spotify removed
/// the total from `/me/playlists` and from `GET /playlists/{id}` in the same
/// migration, so the only honest number left is the one you counted yourself.
/// Each page after the first reuses a keep-alive connection, so this is a few
/// hundred milliseconds rather than a handshake per page.
pub fn playlist_tracks(access_token: &str, playlist_id: &str) -> Result<Vec<Track>, String> {
    let id = urlencoding::encode(playlist_id);
    let mut tracks: Vec<Track> = Vec::new();

    for page in 0..MAX_PAGES {
        let offset = page * PAGE_SIZE;
        let path = format!("/playlists/{id}/items?limit={PAGE_SIZE}&offset={offset}");
        let batch = get::<PlaylistItemsPage>(&path, access_token)?;

        // A short page is the last page. Spotify returns `limit` items on every
        // page but the last, so this is the only end-of-list signal there is.
        let received = batch.items.len();
        // Withdrawn tracks arrive with nothing in the inner slot and are dropped
        // rather than rendered as empty rows: a song that cannot be played is
        // worse absent than present, and placeholders would make every row after
        // it a lie about what the list holds.
        tracks.extend(batch.items.into_iter().filter_map(|entry| entry.item));

        if received < PAGE_SIZE {
            break;
        }
    }

    Ok(tracks)
}

pub fn add_to_playlist(
    access_token: &str,
    playlist_id: &str,
    track_ids: &[String],
) -> Result<(), String> {
    if track_ids.is_empty() {
        // An empty POST is a 400 from Spotify that reads like an app bug. Saying
        // what actually happened is the difference between a UI that can grey
        // out its own button and one that shows a failure the user cannot cause.
        return Err("empty_selection".to_string());
    }
    let id = urlencoding::encode(playlist_id);
    let body = json!({
        "uris": track_ids
            .iter()
            .map(|track_id| format!("spotify:track:{track_id}"))
            .collect::<Vec<String>>(),
    });
    // `/items` for the same reason as the read above: the February 2026 rename took
    // the write endpoint with it, and the old one is 403 for a development app.
    //
    // No `decode`: the 201 carries a snapshot id for optimistic concurrency that
    // this client has no use for yet.
    send(
        &format!("/playlists/{id}/items"),
        Method::POST,
        Some(&body),
        access_token,
    )
    .map(|_| ())
}

/// Make a private playlist owned by whoever the token belongs to.
///
/// Takes no account id: Spotify deprecated `POST /users/{id}/playlists` in favour
/// of `POST /me/playlists`, and the id we would have interpolated is by definition
/// the one the token already identifies. Passing it separately was one more thing
/// that could disagree with the credential actually being used.
pub fn create_playlist(access_token: &str, name: &str) -> Result<Playlist, String> {
    // Private, and stamped with the app's name. A playlist made from here is
    // Starless's own space; defaulting it to public would put it one link away
    // from anybody on the internet.
    let body = json!({ "name": name, "public": false, "description": "Starless" });
    decode(send("/me/playlists", Method::POST, Some(&body), access_token)?)
}
