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
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Lyrics {
    #[serde(default)]
    pub lines: Vec<LyricLine>,
    /// Spanish, Portuguese, "en", whatever the provider said. Used to decide
    /// nothing yet, kept because it is the only thing that tells a translated
    /// lyrics page from an original one.
    #[serde(default)]
    pub language: Option<String>,
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
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AlbumCard {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub images: Vec<Image>,
    #[serde(default)]
    pub artists: Vec<Artist>,
    /// `2016`, or `2016-08-20` when Spotify had the precision to give it.
    #[serde(default)]
    pub release_date: Option<String>,
    /// `year`, `month` or `day`. Without it there is no way to tell "2016" from
    /// "1 January 2016", and rendering the second as the first invents a
    /// precision nobody was given.
    #[serde(default)]
    pub release_date_precision: Option<String>,
    #[serde(default)]
    pub total_tracks: Option<u32>,
    /// `album`, `single` or `compilation`.
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

#[derive(Serialize, Debug)]
pub struct ArtistProfile {
    pub artist: ArtistCard,
    /// **Always empty, and the field stays.** The channel that reads a library
    /// answers an artist's songs but has no route for their discography — the
    /// search parser drops the type, and there is no per-artist album view. The
    /// shape keeps the door open for the day there is one, and until then the
    /// screen hides the section instead of pretending.
    pub albums: Vec<AlbumCard>,
    pub tracks: Vec<Track>,
}

#[derive(Serialize, Debug)]
pub struct Account {
    pub id: String,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
    /// `premium`. Checked once, early: without Premium Spotify serves no audio
    /// at all, and librespot already refuses to keep a session open for one.
    #[serde(default)]
    pub product: Option<String>,
    #[serde(default)]
    pub images: Vec<Image>,
}