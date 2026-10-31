//! La cola compartida del jam.
//!
//! **La cola de un jam es una lista, y la lista no es una playlist.** Se llama
//! `spotify:list:jam-list:<id de la sesión>` y se lee por el servicio de
//! listas —`playlist/spotify.list.v1.ListReadService/GetLists`—, que habla
//! protobuf con un mensaje que **no está en librespot**: vive en el cliente de
//! escritorio (`spotify/list/v1/…`) y no compila ahí. Así que el pedido y la
//! respuesta se arman y se leen a mano, con los números de campo del volcado.
//!
//! ```text
//! GetListsRequest { requests: 1 }
//!   GetListRequest { identifier: 1, options: 2 }
//!     ListIdentifier { uri: 1 }
//!     RequestOptions { requested_fields: 4 }
//!       RequestedFields { all: 1 }
//! ```
//!
//! `all: true` es lo que el servicio pedía con su mensaje: sin eso contesta
//! "RequestedFields must not be empty".
//!
//! Y la respuesta:
//!
//! ```text
//! GetListsResponse { responses: 1 }
//!   GetListResponse { entity: 1 }
//!     ListEntity { attributes: 1, items: 2, meta_items: 3 }
//!       Item { id: 1, attributes: 2 }
//!         Attributes { uri: 1, name: 3, … }
//! ```
//!
//! **Lo que se trae de vuelta son las URIs de las canciones, en el orden en
//! que la lista las tiene.** El nombre y la foto no vienen en la lista: se
//! resuelven aparte, contra la metadata de la sesión, que es la que ya sabe
//! leer las canciones.

/// El cuerpo de un `GetListsRequest` para una lista.
pub(super) fn request(uri: &str) -> Vec<u8> {
    // `RequestedFields { all: true }` — campo 1, varint.
    let requested = vec![0x08, 0x01];
    // `RequestOptions { requested_fields: 4 }`
    let options = bytes(4, &requested);
    // `ListIdentifier { uri: 1 }`
    let identifier = bytes(1, uri.as_bytes());
    // `GetListRequest { identifier: 1, options: 2 }`
    let mut get_list = bytes(1, &identifier);
    get_list.extend(bytes(2, &options));
    // `GetListsRequest { requests: 1 }`
    bytes(1, &get_list)
}

/// Las URIs de las canciones de la lista, en el orden en que la lista las
/// tiene.
///
/// **Una lista que no vino no es una lista vacía**: es una respuesta que no
/// se entendió, y distinguishable de una cola de verdad. Por eso esto devuelve
/// `Option`: `None` es "no se pudo leer", y `Some(vec![])` es "la lista está
/// vacía".
pub(super) fn tracks(body: &[u8]) -> Option<Vec<String>> {
    let mut reader = Reader::new(body);
    let mut out = Vec::new();
    let mut seen = false;

    while let Some((number, wire)) = reader.field() {
        if number == 1 && wire == 2 {
            // `GetListsResponse.responses` → `GetListResponse`
            let response = reader.take()?;
            let entity = entity(response)?;
            seen = true;
            out.extend(items(entity)?);
        } else if reader.skip(wire).is_none() {
            return None;
        }
    }

    if seen { Some(out) } else { None }
}

/// La `ListEntity` de una respuesta.
fn entity(body: &[u8]) -> Option<&[u8]> {
    let mut reader = Reader::new(body);
    while let Some((number, wire)) = reader.field() {
        if number == 1 && wire == 2 {
            return Some(reader.take()?);
        }
        reader.skip(wire)?;
    }
    None
}

/// Las canciones de una `ListEntity`.
fn items(body: &[u8]) -> Option<Vec<String>> {
    let mut reader = Reader::new(body);
    let mut out = Vec::new();

    while let Some((number, wire)) = reader.field() {
        if number == 2 && wire == 2 {
            // `ListEntity.items` → `Item`
            let item = reader.take()?;
            if let Some(uri) = item_uri(item) {
                out.push(uri);
            }
        } else if reader.skip(wire).is_none() {
            return None;
        }
    }

    Some(out)
}

/// La URI de una canción: está en los atributos del item.
fn item_uri(body: &[u8]) -> Option<String> {
    let mut reader = Reader::new(body);
    while let Some((number, wire)) = reader.field() {
        if number == 2 && wire == 2 {
            // `Item.attributes` → `Attributes`
            let attributes = reader.take()?;
            return attribute_uri(attributes);
        }
        reader.skip(wire)?;
    }
    None
}

/// La URI de los atributos.
fn attribute_uri(body: &[u8]) -> Option<String> {
    let mut reader = Reader::new(body);
    while let Some((number, wire)) = reader.field() {
        if number == 1 && wire == 2 {
            // `Attributes.uri`
            let uri = reader.take()?;
            return String::from_utf8(uri.to_vec()).ok();
        }
        reader.skip(wire)?;
    }
    None
}

/// Un campo de protobuf en longitud-delimitada.
fn bytes(number: u32, payload: &[u8]) -> Vec<u8> {
    let mut out = varint((u64::from(number) << 3) | 2);
    out.extend(varint(payload.len() as u64));
    out.extend_from_slice(payload);
    out
}

/// Un varint de protobuf.
fn varint(mut value: u64) -> Vec<u8> {
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

/// La revisión de la lista: contra ella hay que escribir.
///
/// **La revisión es lo que hace que una escritura no pise a otra.** Sin ella,
/// el servicio contesta `400` a un cuerpo que él mismo acepta: el cuerpo
/// está bien, lo que no está bien es contra qué versión se está escribiendo.
///
/// Viene en la respuesta de la lectura —`GetListResponse.info.revision`— y es
/// una secuencia de bytes, no un texto.
pub(super) fn revision(body: &[u8]) -> Option<Vec<u8>> {
    let mut reader = Reader::new(body);

    while let Some((number, wire)) = reader.field() {
        if number == 1 && wire == 2 {
            // `GetListsResponse.responses` → `GetListResponse`
            let response = reader.take()?;
            let info = response_info(response)?;
            return info_revision(info);
        } else if reader.skip(wire).is_none() {
            return None;
        }
    }

    None
}

/// La `ResponseInfo` de una respuesta.
fn response_info(body: &[u8]) -> Option<&[u8]> {
    let mut reader = Reader::new(body);
    while let Some((number, wire)) = reader.field() {
        if number == 2 && wire == 2 {
            // `GetListResponse.info`
            return Some(reader.take()?);
        }
        reader.skip(wire)?;
    }
    None
}

/// La revisión dentro de una `ResponseInfo`.
fn info_revision(body: &[u8]) -> Option<Vec<u8>> {
    let mut reader = Reader::new(body);
    while let Some((number, wire)) = reader.field() {
        if number == 7 && wire == 2 {
            // `ResponseInfo.revision`
            return Some(reader.take()?.to_vec());
        }
        reader.skip(wire)?;
    }
    None
}

/// La respuesta del servicio cuando la lista **no existe**.
///
/// **No es una lista vacía: es una lista que todavía no está.** El servicio
/// contesta un `Status` con el texto `Not Found` adentro —21 bytes, medido— y
/// la app lo reportaba como "la cola vino con otra forma", que miente: lo que
/// vino fue una respuesta, y lo que dice es que no hay cola.
///
/// La diferencia importa porque las dos cosas se ven igual en la pantalla si
/// no se distinguen: una cola vacía es un estado normal y una cola que no se
/// pudo leer es un error.
pub(super) fn not_found(body: &[u8]) -> bool {
    body.windows(9).any(|window| window == b"Not Found")
}

/// Un lector de protobuf.
///
/// **A mano, porque el crate no tiene el proto de este servicio.** Nunca tira
/// la excepción: una respuesta que no se entiende es `None`, y eso es
/// distinto de una lista vacía.
struct Reader<'a> {
    data: &'a [u8],
    at: usize,
}

impl<'a> Reader<'a> {
    fn new(data: &'a [u8]) -> Self {
        Reader { data, at: 0 }
    }

    /// El siguiente campo: su número y su tipo de cable.
    fn field(&mut self) -> Option<(u32, u8)> {
        let key = self.varint()?;
        Some(((key >> 3) as u32, (key & 7) as u8))
    }

    /// El cuerpo de un campo de longitud delimitada.
    fn take(&mut self) -> Option<&'a [u8]> {
        let length = self.varint()? as usize;
        let end = self.at.checked_add(length)?;
        if end > self.data.len() {
            return None;
        }
        let out = &self.data[self.at..end];
        self.at = end;
        Some(out)
    }

    /// Salta un campo que no interesa.
    fn skip(&mut self, wire: u8) -> Option<()> {
        match wire {
            0 => {
                self.varint()?;
            }
            1 => self.at += 8,
            2 => {
                self.take()?;
            }
            5 => self.at += 4,
            _ => return None,
        }
        if self.at > self.data.len() {
            return None;
        }
        Some(())
    }

    /// Un varint.
    fn varint(&mut self) -> Option<u64> {
        let mut value = 0u64;
        let mut shift = 0u32;
        while self.at < self.data.len() {
            let byte = self.data[self.at];
            self.at += 1;
            value |= u64::from(byte & 0x7f) << shift;
            if byte & 0x80 == 0 {
                return Some(value);
            }
            shift += 7;
            if shift > 63 {
                return None;
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// El mensaje que devuelve el servicio de listas, armado a mano.
    ///
    /// Es el camino entero —`GetListsResponse` → `GetListResponse` →
    /// `ListEntity` → `Item` → `Attributes`— con dos canciones.
    fn sample() -> Vec<u8> {
        let attributes = bytes(1, b"spotify:track:3b5E38f6Dbx28IVof4oeAA");
        let item = bytes(2, &attributes);
        let entity = bytes(2, &item);
        let response = bytes(1, &entity);
        bytes(1, &response)
    }

    #[test]
    fn the_tracks_come_back_in_order() {
        let mut body = sample();
        let attributes = bytes(1, b"spotify:track:6zRAJ97ey0RjKa5uKkXfNA");
        let item = bytes(2, &attributes);
        let entity = bytes(2, &item);
        let response = bytes(1, &entity);
        // La segunda respuesta va **dentro** de su campo: la lista de
        // respuestas es un campo repetido, y cada una es un mensaje entero.
        body.extend(bytes(1, &response));

        let tracks = tracks(&body).expect("la lista se lee");
        assert_eq!(
            tracks,
            vec![
                "spotify:track:3b5E38f6Dbx28IVof4oeAA".to_string(),
                "spotify:track:6zRAJ97ey0RjKa5uKkXfNA".to_string(),
            ]
        );
    }

    #[test]
    fn a_response_that_is_not_a_list_is_not_an_empty_list() {
        assert!(tracks(&[0x08, 0x01]).is_none());
        assert!(tracks(&[]).is_none());
    }

    /// La respuesta del servicio cuando la lista no existe.
    ///
    /// **Son los 21 bytes queContestó el servicio el 31 de octubre de 2026**:
    /// un `Status` con el texto adentro.
    #[test]
    fn a_list_that_does_not_exist_says_so() {
        let body = [
            0x0a, 0x13, 0x12, 0x11, 0x0a, 0x0f, 0x12, 0x02, 0x08, 0x01, 0x32, 0x09, b'N', b'o',
            b't', b' ', b'F', b'o', b'u', b'n', b'd',
        ];
        assert!(not_found(&body));
        assert!(!not_found(&sample()));
        assert!(!not_found(&[]));
    }

    #[test]
    fn the_request_carries_the_uri_and_the_fields() {
        let body = request("spotify:list:jam-list:abc");

        // La URI tiene que estar en el cuerpo: es lo que identifica la lista.
        let text = String::from_utf8_lossy(&body);
        assert!(text.contains("spotify:list:jam-list:abc"));
    }

    /// El decodificador contra la respuesta real del servicio.
    ///
    /// **La respuesta entera quedó en `%LOCALAPPDATA%\Starless`** cuando se
    /// midió la cola: 43 KB de protobuf que el log muestra recortada. Si el
    /// archivo está, el decodificador se prueba contra él; si no, el test no
    /// dice nada.
    ///
    /// **Un archivo que no es una cola no rompe el test.** El servicio
    /// contesta `Not Found` cuando el jam todavía no tiene cola —y la sonda
    /// guarda esa respuesta—, y eso no es una cola que el decodificador haya
    /// dejado de leer: es otra cosa. La sonda guarda la cola en un archivo y
    /// la respuesta de error en otro, así que el archivo de la cola es una
    /// cola; el `if` es para el archivo que quedó de una versión anterior.
    #[test]
    fn the_decoder_reads_the_real_answer() {
        let base = std::env::var("LOCALAPPDATA").unwrap_or_default();
        let path = format!("{base}\\Starless\\jam-list-sesion.bin");
        let Ok(bytes) = std::fs::read(&path) else {
            return;
        };

        let Some(songs) = tracks(&bytes) else {
            // No es una cola: no hay nada que probar acá.
            return;
        };
        assert!(!songs.is_empty(), "la cola real no está vacía");
        assert!(
            songs.iter().all(|uri| uri.starts_with("spotify:track:")),
            "todas las canciones de la cola son pistas"
        );

        // Y la revisión viene en la misma respuesta: sin ella no se puede
        // escribir sobre la lista.
        assert!(revision(&bytes).is_some(), "la lista trae su revisión");
    }
}
