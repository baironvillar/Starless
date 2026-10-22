//! La voz del DJ.
//!
//! **Dónde está la puerta.** La narración del DJ viaja como metadata de la
//! fila: el SSML y los parámetros de la mezcla. El audio lo hace otro
//! servicio, y su puerta está en el spclient:
//! `POST /client-tts/v1/fulfill`.
//!
//! Lo que se midió de esa puerta:
//!
//! - Pide el **token de la cuenta**: con el client token solo contesta `401`.
//! - Exige el cuerpo en protobuf **binario**: en texto contesta `400`.
//! - Contesta con el **audio**, no con una URL: un MP3 de 320 kbps, 44,1 kHz
//!   y mono.
//!
//! **Una sola salida de audio, dos fuentes.** La música y la voz salen por el
//! mismo stream, y no por dos: en Windows dos clientes del mismo dispositivo
//! WASAPI se pelean, y el que pierde le pasa sus bytes al otro. Para poder
//! mezclar la voz con la música hace falta el `Mixer` de ese stream, y
//! librespot no lo deja ver —el `Sink` que recibe es una caja opaca—.
//! Por eso el `Sink` es de Starless y no de librespot: el `SinkBuilder` es un
//! puntero a función, y lo que se le pasa puede ser un sink propio.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait};
use librespot_playback::audio_backend::{Sink, SinkError, SinkResult};
use librespot_playback::config::AudioFormat;
use librespot_playback::convert::Converter;
use librespot_playback::decoder::AudioPacket;
use librespot_playback::{NUM_CHANNELS, SAMPLE_RATE};
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

/// La salida de audio.
///
/// Lo publica el sink que se abre junto con el player: el `mixer` es por
/// donde entra la voz y el `sink` es por donde sale la música. Los dos hacen
/// falta, y por razones distintas: la voz necesita el mixer para mezclarse con
/// la música, y el DJ necesita el sink para saber si la música ya se calló.
struct Output {
    mixer: rodio::mixer::Mixer,
    sink: Arc<rodio::Sink>,
}

static OUTPUT: OnceLock<Output> = OnceLock::new();

/// Esperar a que exista la salida de audio.
///
/// La abre el player, y el player se arma la primera vez que se pide sonido:
/// antes de eso no hay mixer por donde entre la voz.
pub fn wait_for_mixer(timeout: Duration) -> bool {
    let deadline = std::time::Instant::now() + timeout;
    while std::time::Instant::now() < deadline {
        if OUTPUT.get().is_some() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    false
}

/// La atenuación del player.
///
/// La voz lee **la misma** que la música, así que el volumen de la app es el
/// volumen de la voz: no hay un volumen para la música y otro para el DJ, y
/// mutear calla a los dos.
static ATTENUATION: Mutex<Option<Arc<AtomicU64>>> = Mutex::new(None);

/// La voz que está en curso, si hay una.
///
/// Se guarda para poder cortarla desde otro hilo: la fuente lee la bandera en
/// cada muestra, y con la bandera puesta se calla.
static CURRENT: Mutex<Option<Arc<AtomicBool>>> = Mutex::new(None);

/// Publicar la atenuación del player.
///
/// Lo publica el player cuando se crea. Si ya había una —el player se rehace
/// después de un atasco—, se deja la primera: es el mismo arco, y apuntar a
/// otro dejaría la voz escuchando un volumen viejo.
pub fn publish_attenuation(attenuation: Arc<AtomicU64>) {
    let mut guard = match ATTENUATION.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    if guard.is_none() {
        *guard = Some(attenuation);
    }
}

/// Empezar una voz.
///
/// La bandera se comparte entre el hilo que pide el audio, el que lo suena y
/// el que lo corta. **La voz anterior, si había una, se corta**: dos DJ
/// hablando a la vez no es una conversación.
pub fn begin() -> Arc<AtomicBool> {
    stop();
    let flag = Arc::new(AtomicBool::new(false));
    let mut guard = match CURRENT.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    *guard = Some(flag.clone());
    flag
}

/// Cortar la voz que esté en curso, esté pidiendo el audio o esté sonando.
pub fn stop() {
    let previous = {
        let mut guard = match CURRENT.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        guard.take()
    };
    if let Some(flag) = previous {
        flag.store(true, Ordering::Relaxed);
    }
}

/// La voz que está sonando.
///
/// Es el handle: sabe cuánto dura y si terminó sola o la cortaron.
pub struct Voice {
    stop: Arc<AtomicBool>,
    duration: Duration,
}

impl Voice {
    /// Esperar a que termine, y decir si terminó sola o la cortaron.
    ///
    /// `true` es que se oyó entera; `false` es que alguien la cortó —el
    /// usuario puso otra cosa— y hay que hacer como si no hubiera pasado.
    pub fn wait(&self) -> bool {
        let deadline = std::time::Instant::now() + self.duration;
        while std::time::Instant::now() < deadline {
            if self.stop.load(Ordering::Relaxed) {
                return false;
            }
            std::thread::sleep(Duration::from_millis(40));
        }
        true
    }
}

/// La fuente de la voz del DJ.
///
/// **Es una fuente y no un buffer fijo por dos razones.** La primera es el
/// volumen: la voz tiene que bajar cuando el usuario baja el volumen y
/// callarse cuando lo mutea, y eso se lee muestra por muestra —si el factor se
/// calcula una sola vez, mutear durante la frase no la calla—. La segunda es
/// que se pueda cortar: la fuente devuelve `None` cuando la bandera está
/// puesta, y el mixer la suelta.
struct VoiceSource {
    samples: std::vec::IntoIter<f32>,
    channels: u16,
    rate: u32,
    volume: Arc<AtomicU64>,
    stop: Arc<AtomicBool>,
}

impl Iterator for VoiceSource {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        if self.stop.load(Ordering::Relaxed) {
            return None;
        }
        let sample = self.samples.next()?;
        let volume = f64::from_bits(self.volume.load(Ordering::Relaxed));
        Some((f64::from(sample) * volume) as f32)
    }
}

impl rodio::Source for VoiceSource {
    fn current_span_len(&self) -> Option<usize> {
        Some(self.samples.len())
    }

    fn channels(&self) -> u16 {
        self.channels
    }

    fn sample_rate(&self) -> u32 {
        self.rate
    }

    fn total_duration(&self) -> Option<Duration> {
        Some(Duration::from_secs_f64(
            self.samples.len() as f64 / (self.rate as f64 * self.channels as f64),
        ))
    }
}

/// El sink de Starless.
///
/// Es el de librespot con una diferencia: guarda el `Mixer` del stream, que
/// librespot no deja ver. Sin eso, la voz tendría que abrir un segundo stream
/// en el mismo dispositivo.
pub struct StarlessSink {
    sink: Arc<rodio::Sink>,
    /// El stream tiene que quedar vivo: si se cae, el mixer se cae con él.
    _stream: rodio::OutputStream,
}

/// El sink que se le pasa al player.
///
/// Lo llama el hilo del player, y no el principal: si el dispositivo no se
/// puede abrir, el hilo muere ahí y `is_invalid` lo dice. Ese es el mecanismo
/// que ya existe y que la app usa para nombrar el problema —"no se pudo abrir
/// el dispositivo de audio de Windows"— en vez de dejar un player mudo que
/// parece uno que funciona.
pub fn build_sink(device: Option<String>, format: AudioFormat) -> Box<dyn Sink> {
    Box::new(open(device, format))
}

/// Fallar con un mensaje que diga qué pasó.
///
/// El panic es a propósito y no un descuido: el hilo de audio muere, el
/// player queda inválido, y la app puede contar la verdad. Con
/// `panic = "unwind"` el hilo muere y no la app.
fn device_failed(reason: &str) -> ! {
    log::error!("el dispositivo de salida de audio no se pudo abrir: {reason}");
    panic!("el dispositivo de salida de audio no se pudo abrir: {reason}");
}

fn open(device: Option<String>, format: AudioFormat) -> StarlessSink {
    let host = cpal::default_host();
    log::info!(
        "Using Starless sink with format {format:?} and cpal host: {}",
        host.id().name()
    );

    let cpal_device = match device.as_deref() {
        Some(device_name) => {
            let mut devices = match host.output_devices() {
                Ok(devices) => devices,
                Err(e) => device_failed(&e.to_string()),
            };
            match devices.find(|candidate| {
                candidate.name().ok().is_some_and(|name| name == device_name)
            }) {
                Some(device) => device,
                None => device_failed(&format!("el dispositivo {device_name} no está")),
            }
        }
        None => match host.default_output_device() {
            Some(device) => device,
            None => device_failed("no hay dispositivo de salida por defecto"),
        },
    };

    let name = cpal_device.name().ok();
    log::info!(
        "Using audio device: {}",
        name.as_deref().unwrap_or("[unknown name]")
    );

    // La negociación es la de librespot, porque cambiarla cambia el sonido:
    // primero estéreo a 44,1 kHz —que es lo que el player da— y, si el
    // dispositivo no lo tiene, el que por defecto tenga.
    let default_config = match cpal_device.default_output_config() {
        Ok(config) => config,
        Err(e) => device_failed(&e.to_string()),
    };
    let mut configs = match cpal_device.supported_output_configs() {
        Ok(configs) => configs,
        Err(e) => device_failed(&e.to_string()),
    };
    let config = configs
        .find(|candidate| candidate.channels() == NUM_CHANNELS as cpal::ChannelCount)
        .and_then(|candidate| {
            candidate
                .try_with_sample_rate(cpal::SampleRate(SAMPLE_RATE))
                .or_else(|| candidate.try_with_sample_rate(default_config.sample_rate()))
        })
        .unwrap_or(default_config);

    let sample_format = match format {
        AudioFormat::F64 => cpal::SampleFormat::F64,
        AudioFormat::F32 => cpal::SampleFormat::F32,
        AudioFormat::S32 => cpal::SampleFormat::I32,
        AudioFormat::S24 | AudioFormat::S24_3 => cpal::SampleFormat::I24,
        AudioFormat::S16 => cpal::SampleFormat::I16,
    };

    let mut stream = match rodio::OutputStreamBuilder::default()
        .with_device(cpal_device.clone())
        .with_config(&config.config())
        .with_sample_format(sample_format)
        .open_stream()
    {
        Ok(stream) => stream,
        Err(e) => {
            // La configuración elegida no servió: se prueba la del sistema, que
            // es lo que hace rodio cuando no le dicen otra cosa.
            log::warn!("el stream no se pudo abrir con la configuración elegida: {e}");
            match rodio::OutputStreamBuilder::from_device(cpal_device) {
                Ok(builder) => match builder.open_stream_or_fallback() {
                    Ok(stream) => stream,
                    Err(e) => device_failed(&e.to_string()),
                },
                Err(e) => device_failed(&e.to_string()),
            }
        }
    };
    stream.log_on_drop(false);

    // El mixer es la puerta de entrada de la voz: se publica acá, y la voz
    // entra por él, mezclada con la música. El sink va con él porque el DJ
    // necesita saber cuándo se calló la música.
    let mixer = stream.mixer().clone();
    let sink = Arc::new(rodio::Sink::connect_new(stream.mixer()));
    if OUTPUT
        .set(Output {
            mixer,
            sink: sink.clone(),
        })
        .is_err()
    {
        log::warn!("la salida de audio ya estaba publicada; se queda la primera");
    }

    StarlessSink {
        sink,
        _stream: stream,
    }
}

impl Sink for StarlessSink {
    fn start(&mut self) -> SinkResult<()> {
        self.sink.play();
        Ok(())
    }

    fn stop(&mut self) -> SinkResult<()> {
        self.sink.sleep_until_end();
        self.sink.pause();
        Ok(())
    }

    fn write(&mut self, packet: AudioPacket, converter: &mut Converter) -> SinkResult<()> {
        let samples = packet
            .samples()
            .map_err(|e| SinkError::OnWrite(e.to_string()))?;
        let samples_f32: &[f32] = &converter.f64_to_f32(samples);
        let source = rodio::buffer::SamplesBuffer::new(
            NUM_CHANNELS as u16,
            SAMPLE_RATE,
            samples_f32,
        );
        self.sink.append(source);

        // El bucle de vaciado es el de librespot y no se puede acortar: el sink
        // de rodio espera al dispositivo **dentro** de `write`, en un bucle sin
        // fin. Es el único lugar donde se puede esperar.
        while self.sink.len() > 26 {
            std::thread::sleep(Duration::from_millis(10));
        }
        Ok(())
    }
}

/// Los parámetros de la voz, tal como el DJ los deja.
///
/// Se leen de la metadata de la fila y no se inventan: el servicio dice qué
/// formato de audio quiere, a qué frecuencia y con qué voz, y pedir otra cosa
/// es pedir un audio que nadie pidió.
#[derive(Debug, Clone)]
pub struct VoiceParams {
    /// El SSML: lo que dice, con las etiquetas y las referencias adentro.
    pub ssml: String,
    /// El idioma, que sale del propio SSML (`xml:lang`).
    pub language: String,
    /// El número de la voz: `VOICE35` es la 35.
    pub voice: u64,
    /// El número del proveedor: `SONANTIC_FAST` es el 6.
    pub provider: u64,
    /// El formato de audio pedido.
    pub audio_format: u64,
    /// La frecuencia, en hercios.
    pub sample_rate: u64,
}

impl VoiceParams {
    /// Los parámetros de la narración de una fila del DJ.
    ///
    /// `kind` es el prefijo del campo: `narration.intro.` para la de apertura y
    /// `narration.outro.` para la de cierre.
    pub fn from_metadata(
        metadata: &serde_json::Map<String, serde_json::Value>,
        kind: &str,
    ) -> Option<Self> {
        let ssml = field(metadata, kind, ".ssml")?.to_owned();

        // El idioma no viene como campo: sale del propio SSML, que lo declara
        // en `xml:lang`. Adivinarlo sería mandar un idioma que el servicio no
        // pidió.
        let language = ssml
            .split("xml:lang=\"")
            .nth(1)
            .and_then(|rest| rest.split('"').next())
            .unwrap_or("es")
            .to_owned();

        Some(Self {
            ssml,
            language,
            voice: voice_number(field(metadata, kind, ".voice")),
            provider: provider_number(field(metadata, kind, ".tts_provider")),
            audio_format: audio_format_number(field(metadata, kind, ".audio_format")),
            sample_rate: field(metadata, kind, ".sample_rate")
                .and_then(|value| value.trim().parse::<u64>().ok())
                .unwrap_or(44100),
        })
    }

    /// El pedido: el `TtsRequest` del proto, en protobuf binario.
    ///
    /// Los tags: `1` texto, `2` ssml, `3` formato, `4` idioma, `5` voz, `6`
    /// proveedor, `7` frecuencia. El `oneof` del prompt es el `2` cuando lo que
    /// se manda es el SSML.
    pub fn request_body(&self) -> Vec<u8> {
        let mut out = Vec::new();
        field_bytes(&mut out, 2, self.ssml.as_bytes());
        field_varint(&mut out, 3, self.audio_format);
        field_bytes(&mut out, 4, self.language.as_bytes());
        field_varint(&mut out, 5, self.voice);
        field_varint(&mut out, 6, self.provider);
        field_varint(&mut out, 7, self.sample_rate);
        out
    }
}

/// Un valor de la narración, por el final de su nombre.
///
/// Se busca por el final y no por el nombre entero porque el campo puede
/// venir con el SSML en el medio —`narration.intro.ssml.artist`— y lo que
/// importa es el campo, no dónde está el prefijo.
fn field<'a>(
    metadata: &'a serde_json::Map<String, serde_json::Value>,
    kind: &str,
    suffix: &str,
) -> Option<&'a str> {
    metadata
        .iter()
        .find(|(key, _)| key.starts_with(kind) && key.ends_with(suffix))
        .and_then(|(_, value)| value.as_str())
}

/// El número de la voz.
///
/// El DJ manda el nombre —`VOICE35`— y el servicio espera el número. La lista
/// va del 1 al 40, que es lo que declara el proto.
fn voice_number(name: Option<&str>) -> u64 {
    name.and_then(|value| {
        value
            .trim()
            .strip_prefix("VOICE")
            .and_then(|digits| digits.parse::<u64>().ok())
    })
    .unwrap_or(0)
}

/// El número del proveedor.
///
/// El proto declara `CLOUD_TTS = 1`, `READSPEAKER = 2`, `POLLY = 3`,
/// `WELL_SAID = 4`, `SONANTIC_DEPRECATED = 5` y `SONANTIC_FAST = 6`. El DJ usa
/// el 6.
fn provider_number(name: Option<&str>) -> u64 {
    match name.map(|value| value.trim().to_ascii_uppercase()) {
        Some(value) => match value.as_str() {
            "CLOUD_TTS" => 1,
            "READSPEAKER" => 2,
            "POLLY" => 3,
            "WELL_SAID" => 4,
            "SONANTIC_DEPRECATED" => 5,
            "SONANTIC_FAST" => 6,
            other => other.parse::<u64>().unwrap_or(0),
        },
        None => 0,
    }
}

/// El número del formato de audio.
///
/// El proto de Spotify declara `UNSPECIFIED = 0`, `WAV = 1`, `PCM = 2`,
/// `OPUS = 3`, `VORBIS = 4` y `MP3 = 5`.
fn audio_format_number(name: Option<&str>) -> u64 {
    match name.map(|value| value.trim().to_ascii_uppercase()) {
        Some(value) => match value.as_str() {
            "UNSPECIFIED" => 0,
            "WAV" => 1,
            "PCM" => 2,
            "OPUS" => 3,
            "VORBIS" => 4,
            "MP3" => 5,
            other => other.parse::<u64>().unwrap_or(3),
        },
        None => 3,
    }
}

/// Un campo de texto: tag, longitud, bytes.
fn field_bytes(out: &mut Vec<u8>, field: u32, value: &[u8]) {
    out.push(((field << 3) | 2) as u8);
    varint(out, value.len() as u64);
    out.extend_from_slice(value);
}

/// Un campo de número: tag y varint.
fn field_varint(out: &mut Vec<u8>, field: u32, value: u64) {
    out.push((field << 3) as u8);
    varint(out, value);
}

/// Un varint de protobuf.
fn varint(out: &mut Vec<u8>, mut value: u64) {
    loop {
        let mut byte = (value & 0x7f) as u8;
        value >>= 7;
        if value != 0 {
            byte |= 0x80;
        }
        out.push(byte);
        if value == 0 {
            break;
        }
    }
}

/// Poner la voz a sonar.
///
/// Devuelve el handle, que es lo que sabe cuánto dura y si terminó sola o la
/// cortaron. La voz sale por el mixer del player —la misma salida que la
/// música— y con el volumen del usuario: mutear la calla.
pub fn speak(audio: &[u8], stop: Arc<AtomicBool>) -> Result<Voice, String> {
    let (samples, rate, channels) = decode(audio)?;
    let Some(output) = OUTPUT.get() else {
        log::error!("la voz del DJ no se pudo poner: no hay mixer de audio");
        return Err("no_audio_device".to_string());
    };

    // **La música se calla antes de que la voz entre.** El `stop` del player
    // deja el sink vaciándose —lo que ya estaba metido sigue sonando
    // mientras se vacía— y una voz que entra encima de esa cola se pisa con
    // ella. Por eso se espera a que no quede nada sonando.
    wait_for_silence(&output.sink);

    let volume = match ATTENUATION.lock() {
        Ok(guard) => guard.clone(),
        Err(poisoned) => poisoned.into_inner().clone(),
    }
    .unwrap_or_else(|| {
        log::warn!("la voz del DJ no sabe el volumen del player; suena a escala completa");
        Arc::new(AtomicU64::new(1.0f64.to_bits()))
    });

    let duration = Duration::from_secs_f64(samples.len() as f64 / (rate as f64 * channels as f64));
    log::info!(
        "la voz del DJ: {} muestras a {rate} Hz y {channels} canales, {duration:?}",
        samples.len()
    );

    output.mixer.add(VoiceSource {
        samples: samples.into_iter(),
        channels,
        rate,
        volume,
        stop: stop.clone(),
    });
    Ok(Voice { stop, duration })
}

/// Esperar a que la música se callara de verdad.
///
/// El sink cuenta las fuentes que le quedaron metidas: mientras haya alguna,
/// hay música sonando. La espera tiene un tope, porque un player trabado no
/// puede dejar al DJ mudo para siempre —en ese caso entra igual y el log lo
/// dice—.
fn wait_for_silence(sink: &rodio::Sink) {
    let deadline = std::time::Instant::now() + Duration::from_millis(1500);
    while sink.len() > 0 {
        if std::time::Instant::now() >= deadline {
            log::warn!("la música no se calló a tiempo; la voz del DJ entra encima");
            return;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// El audio del DJ, a PCM.
///
/// Se decodifica con symphonia —el mismo que usa librespot para los archivos
/// locales— porque el servicio puede mandar el audio en más de un formato, y
/// adivinar cuál es peor que preguntárselo al archivo.
///
/// Lo que vuelve es el audio entrelazado, con la frecuencia y el número de
/// canales del archivo: el mixer se encarga de llevarlo a lo que el stream
/// pida.
fn decode(audio: &[u8]) -> Result<(Vec<f32>, u32, u16), String> {
    // El lector de symphonia vive más que esta función, así que el audio se
    // copia: el `Cursor` tiene que ser `'static`, y el slice que vino no lo es.
    let source = MediaSourceStream::new(
        Box::new(std::io::Cursor::new(audio.to_vec())),
        Default::default(),
    );
    let mut hint = Hint::new();
    // Lo que manda el servicio es un MP3, pero el archivo sabe mejor qué es:
    // la pista es una sugerencia, no una sentencia.
    hint.with_extension("mp3");

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            source,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| {
            log::error!("la voz del DJ no se pudo decodificar: {e}");
            "bad_response".to_string()
        })?;
    let mut format = probed.format;
    let track = format.default_track().ok_or_else(|| {
        log::error!("la voz del DJ no tiene pista");
        "bad_response".to_string()
    })?;
    let track_id = track.id;
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| {
            log::error!("la voz del DJ no tiene decodificador: {e}");
            "bad_response".to_string()
        })?;

    let mut samples: Vec<f32> = Vec::new();
    let mut rate = SAMPLE_RATE;
    let mut channels = NUM_CHANNELS as u16;

    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            // El final del archivo no es un error: es el final.
            Err(SymphoniaError::IoError(error))
                if error.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break
            }
            Err(SymphoniaError::ResetRequired) => break,
            Err(error) => {
                log::error!("la voz del DJ se cortó al leer: {error}");
                break;
            }
        };
        if packet.track_id() != track_id {
            continue;
        }

        match decoder.decode(&packet) {
            Ok(decoded) => {
                let spec = *decoded.spec();
                rate = spec.rate;
                channels = spec.channels.count() as u16;
                let mut buffer = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
                buffer.copy_interleaved_ref(decoded);
                samples.extend_from_slice(buffer.samples());
            }
            // Un frame que no se pudo decodificar no mata el resto: el archivo
            // puede tener un frame malo y despuésvenir bien.
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(error) => {
                log::error!("la voz del DJ no se pudo decodificar: {error}");
                break;
            }
        }
    }

    if samples.is_empty() {
        log::error!("la voz del DJ vino sin muestras");
        return Err("bad_response".to_string());
    }
    Ok((samples, rate, channels))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn metadata() -> serde_json::Map<String, serde_json::Value> {
        let json = serde_json::json!({
            "narration.intro.ssml": "<speak xml:lang=\"es-MX\">Hola</speak>",
            "narration.intro.voice": "VOICE35",
            "narration.intro.tts_provider": "SONANTIC_FAST",
            "narration.intro.audio_format": "MP3",
            "narration.intro.sample_rate": "44100",
            "narration.intro.artist": "DJ Livi",
        });
        json.as_object().cloned().expect("es un objeto")
    }

    /// Los parámetros salen de la metadata tal cual, y no inventados.
    #[test]
    fn the_parameters_come_from_the_metadata() {
        let params = VoiceParams::from_metadata(&metadata(), "narration.intro.")
            .expect("la fila trae narración");
        assert_eq!(params.voice, 35);
        assert_eq!(params.provider, 6);
        assert_eq!(params.audio_format, 5);
        assert_eq!(params.sample_rate, 44100);
    }

    /// El idioma sale del propio SSML, que es donde lo declara.
    #[test]
    fn the_language_comes_from_the_ssml() {
        let params = VoiceParams::from_metadata(&metadata(), "narration.intro.")
            .expect("la fila trae narración");
        assert_eq!(params.language, "es-MX");
    }

    /// Una fila sin narración no tiene parámetros de voz.
    #[test]
    fn a_row_without_narration_has_no_voice() {
        let empty = serde_json::Map::new();
        assert!(VoiceParams::from_metadata(&empty, "narration.intro.").is_none());
    }

    /// Los campos del pedido, en orden: el tag y su valor.
    ///
    /// Los de texto vienen con la longitud y los de número con el varint, así
    /// que el valor que se lee de los de texto es la longitud: el contenido se
    /// comprueba aparte.
    fn fields(body: &[u8]) -> Vec<(u32, u64)> {
        let mut out = Vec::new();
        let mut i = 0;
        while i < body.len() {
            let tag = u32::from(body[i] >> 3);
            let wire = body[i] & 0x07;
            i += 1;
            match wire {
                0 => {
                    let mut value = 0u64;
                    let mut shift = 0;
                    while i < body.len() {
                        let byte = body[i];
                        i += 1;
                        value |= u64::from(byte & 0x7f) << shift;
                        if byte & 0x80 == 0 {
                            break;
                        }
                        shift += 7;
                    }
                    out.push((tag, value));
                }
                2 => {
                    let mut length = 0usize;
                    let mut shift = 0;
                    while i < body.len() {
                        let byte = body[i];
                        i += 1;
                        length |= usize::from(byte & 0x7f) << shift;
                        if byte & 0x80 == 0 {
                            break;
                        }
                        shift += 7;
                    }
                    out.push((tag, length as u64));
                    i += length;
                }
                _ => break,
            }
        }
        out
    }

    /// El pedido lleva el SSML en el `oneof` del prompt —el tag 2— y los
    /// parámetros en los tags que el proto declara.
    #[test]
    fn the_request_has_the_tags_the_proto_declares() {
        let params = VoiceParams::from_metadata(&metadata(), "narration.intro.")
            .expect("la fila trae narración");
        let body = params.request_body();

        assert_eq!(
            fields(&body),
            vec![
                (2, params.ssml.len() as u64),
                (3, params.audio_format),
                (4, params.language.len() as u64),
                (5, params.voice),
                (6, params.provider),
                (7, params.sample_rate),
            ]
        );

        // Y el SSML viaja entero, que es lo que el servicio lee.
        let length = params.ssml.len();
        let ssml = String::from_utf8_lossy(&body[2..2 + length]);
        assert_eq!(ssml, params.ssml);
    }
}
