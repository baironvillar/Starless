//! El crossfade: la canción que termina baja mientras la siguiente sube.
//!
//! **Un solo player y un solo stream.** librespot decodifica una pista a la
//! vez, y abrir un segundo player con su propio stream es justo lo que no se
//! puede hacer en Windows: dos clientes del mismo dispositivo WASAPI se pelean.
//! Lo que sí se puede es lo que hace este módulo, y depende de dos hechos de
//! librespot que se midieron en su código:
//!
//! - **El player es gapless por defecto.** Al final natural de una pista no
//!   detiene el sink: queda en `EndOfTrack`, y la pista siguiente se escribe en
//!   el mismo sink, detrás de la anterior.
//! - **El ritmo del decoder lo pone el sink.** `write` no vuelve hasta que la
//!   cola de rodio baja de 26 paquetes, y eso es lo único que hace que el
//!   decoder vaya a la velocidad de la música.
//!
//! Así que en los últimos N segundos de la canción el sink deja de frenar al
//! decoder: el final entero queda en la cola, el decoder llega al final antes
//! de tiempo y `EndOfTrack` sale N segundos antes de que la canción deje de
//! sonar. Cuando la siguiente se carga, ese final se separa en una cola propia
//! —un `rodio::Sink` más sobre **el mismo mixer**— y la canción nueva entra en
//! otra. Con la primera muestra de la nueva empieza el fundido: la vieja baja
//! de una a lo largo de toda la transición y la nueva sube con la potencia que
//! la vieja deja, para que las dos se oyan mezcladas y la transición no suene
//! más fuerte que una canción sola.
//!
//! **Sólo en el paso automático.** Un clic en otra canción, un seek o una
//! pausa en esos últimos segundos no son una transición: el final que estaba
//! en la cola se apaga en un instante y lo que el usuario pidió suena ya.

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use librespot_playback::{NUM_CHANNELS, SAMPLE_RATE};

/// El máximo del ajuste, el mismo que ofrece el cliente oficial.
pub const MAX_SECONDS: u32 = 12;

/// Cuánto tarda en apagarse lo que el usuario dejó atrás.
///
/// Corto, porque es una respuesta a un clic y no una transición, pero no cero:
/// un corte seco en el medio de una onda se oye como un chasquido.
const QUICK_FADE: Duration = Duration::from_millis(400);

/// Cuánto tarda en callarse la música cuando el usuario pausa.
///
/// Más corto que un corte de song: una pausa es una orden de "ahora", y cuatro
/// cientos de milisegundos de cola sonando ya son cuatro cientos de
/// milisegundos de "no me hizo caso".
const PAUSE_FADE: Duration = Duration::from_millis(120);

/// Cuánto tarda en apagarse el audio del lugar de antes cuando el usuario
/// salta.
///
/// Corta a propósito: un salto es un corte, y lo que tiene que desaparecer es
/// el audio viejo. Lo que no puede ser es un chasquido.
const CUT_FADE: Duration = Duration::from_millis(60);

/// Cada cuánto se mueve el volumen durante un fundido.
const STEP: Duration = Duration::from_millis(20);

/// Cuánto entra adelantada la canción que entra en una transición.
///
/// **Cero: la canción entra desde su principio.** La mezcla es entre las dos y
/// una que arranca en su segundo seis se oye como si le faltara el principio.
/// El adelanto que hubo antes —la mitad del crossfade— saltaba la entrada de
/// cada canción, y con una transición de doce segundos eso son seis.
const LEAD_IN_MS: u32 = 0;

/// El colchón de la posición.
///
/// La posición llega con los eventos del player, dos veces por segundo, así
/// que puede ir medio segundo atrás de lo que el decoder ya escribió.
const POSITION_MARGIN_MS: u32 = 600;

/// Los paquetes que el sink deja en cola antes de frenar al decoder.
///
/// Es el número de librespot y no se toca: es lo que hace que el decoder vaya
/// al ritmo de la música fuera de los últimos segundos.
const PACED_PACKETS: usize = 26;

/// Los segundos del ajuste; 0 es apagado.
static SECONDS: AtomicU32 = AtomicU32::new(0);

/// Cuánto dura la canción con el crossfade puesto.
///
/// **La canción dura menos: los últimos segundos son la mezcla.** Con doce
/// segundos de crossfade, una canción de tres minutos veintiuno dura tres
/// minutos nueve, y la siguiente entra desde el principio mientras el final
/// de la anterior se baja debajo. Es lo que hace Spotify, y sin esto la
/// barra llegaba al final de la canción cuando la siguiente ya estaba
/// sonando.
pub fn effective_duration_ms(duration_ms: u32) -> u32 {
    shorten(duration_ms, SECONDS.load(Ordering::Relaxed))
}

/// La misma cuenta, con los segundos a mano.
fn shorten(duration_ms: u32, seconds: u32) -> u32 {
    duration_ms.saturating_sub(seconds * 1000)
}

/// Cuánto audio queda en la cola del sink: lo que el decoder ya escribió y
/// todavía no sonó.
///
/// **La posición que se muestra es la que se oye, no la que lleva el
/// decoder.** En los últimos segundos de una canción el decoder deja de
/// frenarse y deja el final entero en la cola —con un crossfade de doce
/// segundos, doce segundos—, así que la posición que manda va por delante de
/// lo que se está oyendo.
pub fn queued_ms() -> u32 {
    decks()
        .map(|decks| decks.current().remaining().as_millis() as u32)
        .unwrap_or_default()
}

/// La duración de la pista que se está decodificando.
static DURATION_MS: AtomicU32 = AtomicU32::new(0);

/// Hasta dónde llegó el decoder, según el último evento del player.
static POSITION_MS: AtomicU32 = AtomicU32::new(0);

/// Las colas del sink que está abierto ahora.
///
/// Se reemplaza cada vez que se abre un sink —el player se rehace después de
/// un atasco— para que las órdenes vayan al que suena y no a uno abandonado.
static DECKS: Mutex<Option<Arc<Decks>>> = Mutex::new(None);

/// La atenuación del volumen, en bits de f64.
///
/// **El audio se atenúa cuando sale de la cola, no cuando entra.** El mixer de
/// librespot la aplicaba antes de escribir en el sink, y ahí el volumen quedaba
/// cocido en los paquetes: la cola —hasta 26 paquetes, casi 700 ms de música—
/// seguía sonando con el volumen viejo, así que mover el control se oía tarde
/// y con la curva equivocada. Atenuado al salir, el cambio se oye en la
/// muestra siguiente.
///
/// Se publica una sola vez, cuando se abre el sink, y de ahí en adelante la
/// lee quien hace sonar el audio.
static ATTENUATION: Mutex<Option<Arc<AtomicU64>>> = Mutex::new(None);

/// Publicar la atenuación del player.
///
/// Lo publica el player cuando se crea. Si ya había una —el player se rehace
/// después de un atasco— se deja la primera: es el mismo arco, y apuntar a
/// otro dejaría la cola escuchando un volumen viejo.
pub fn publish_attenuation(attenuation: Arc<AtomicU64>) {
    let mut guard = lock(&ATTENUATION);
    if guard.is_none() {
        *guard = Some(attenuation);
    }
}

/// La atenuación de este momento, tal como la va a oír quien escuchó.
fn attenuation() -> f64 {
    lock(&ATTENUATION)
        .as_ref()
        .map(|value| f64::from_bits(value.load(Ordering::Relaxed)))
        .unwrap_or(1.0)
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn decks() -> Option<Arc<Decks>> {
    lock(&DECKS).clone()
}

/// Cambiar los segundos del crossfade. Vale desde la próxima canción.
pub fn set_seconds(seconds: u32) {
    SECONDS.store(seconds.min(MAX_SECONDS), Ordering::Relaxed);
}

/// El pedido de reproducción al que pertenecen las posiciones que se aceptan.
static REQUEST: AtomicU64 = AtomicU64::new(0);

/// Si ya llegó el `PlayRequestIdChanged` de la última carga.
///
/// **Los eventos del player llegan por un canal, y van atrasados.** Una
/// posición de la canción anterior puede procesarse después de que la nueva
/// ya se cargó, y con ella la canción nueva parecería estar en sus últimos
/// segundos: el decoder dejaría de frenarse y la canción entera entraría en la
/// cola. Por eso, desde la carga hasta que el canal anuncia el pedido nuevo,
/// ninguna posición cuenta, y después sólo las de ese pedido.
static ACCEPTING: AtomicBool = AtomicBool::new(false);

/// El player anunció el pedido de la carga que acaba de recibir.
pub fn request_changed(play_request_id: u64) {
    REQUEST.store(play_request_id, Ordering::Relaxed);
    ACCEPTING.store(true, Ordering::Relaxed);
}

/// El decoder avanzó. Lo llama el manejador de eventos del player.
pub fn position(play_request_id: u64, position_ms: u32) {
    if ACCEPTING.load(Ordering::Relaxed) && REQUEST.load(Ordering::Relaxed) == play_request_id {
        POSITION_MS.store(position_ms, Ordering::Relaxed);
    }
}

/// Una pista está por cargarse. Devuelve desde dónde cargarla.
///
/// `automatic` es que la anterior terminó sola: ese es el único caso en que el
/// final que quedó en la cola se mezcla con la nueva. Si no, se apaga rápido.
///
/// **En una transición, la canción nueva entra adelantada** la mitad de los
/// segundos del crossfade. El comienzo de una canción suele ser lo más quieto
/// —silencio, una entrada que crece—, y debajo del final de otra se pierde: la
/// mezcla se oye como un hueco. Entrando ya avanzada, lo que sube es la canción
/// sonando. Con tope en un cuarto de la duración, para que una canción corta no
/// empiece por la mitad.
pub fn before_load(automatic: bool, duration_ms: u32, position_ms: u32) -> u32 {
    let mut start = position_ms;
    if let Some(decks) = decks() {
        decks.settle_waiting();
        if decks.armed.swap(false, Ordering::Relaxed) {
            if automatic {
                decks.retire(Retire::Crossfade);
                if position_ms == 0 {
                    start = position_ms + LEAD_IN_MS;
                    log::info!("crossfade: la siguiente entra desde el principio");
                }
            } else {
                decks.retire(Retire::Quick);
            }
        } else if decks.current().silenced.load(Ordering::Relaxed) {
            // **La cola quedó congelada por una pausa.** La canción nueva
            // necesita una cola nueva: en la congelada no entraría nada y el
            // usuario escucharía silencio donde pidió una canción.
            decks.retire(Retire::Quick);
        }
    }
    ACCEPTING.store(false, Ordering::Relaxed);
    DURATION_MS.store(duration_ms, Ordering::Relaxed);
    POSITION_MS.store(start, Ordering::Relaxed);
    start
}

/// El usuario saltó dentro de la canción: el final que estaba en cola ya no va.
///
/// La posición se pone acá y no se espera al evento `Seeked`: hasta que llega,
/// la vieja diría que seguimos en los últimos segundos y el decoder no se
/// frenaría.
///
/// **Y lo que quedó en la cola se va con el salto.** La cola es el audio del
/// lugar de antes: si sigue ahí, suena encima de la posición nueva —el
/// control del player vuelve a la posición vieja y el salto no parece
/// funcionar— y la posición que se oye tarda lo que la cola tarda en vaciarse.
pub fn cut(position_ms: u32) {
    POSITION_MS.store(position_ms, Ordering::Relaxed);
    if let Some(decks) = decks() {
        decks.armed.swap(false, Ordering::Relaxed);
        decks.cut();
    }
}

/// El DJ va a hablar: el final de la canción suena entero, sin fundido.
///
/// La frase va **después** de la canción, no encima, y cortarle los últimos
/// segundos para hacerle lugar sería quitarle a la canción su final.
pub fn release_tail() {
    if let Some(decks) = decks()
        && decks.armed.swap(false, Ordering::Relaxed)
    {
        decks.retire(Retire::Natural);
    }
}

/// Cuánto le falta a la música para callarse, contando los finales en cola.
pub fn silence_left() -> Duration {
    decks().map(|decks| decks.silence_left()).unwrap_or_default()
}

/// El usuario pausó: la música se calla ya.
///
/// **Lo que sigue sonando es la cola, no el player.** Pausar el player deja de
/// pedirle audio, pero la cola —hasta 26 paquetes, casi 700 ms de música— sigue
/// en el mixer y se sigue oyendo: la pausa tardaba lo que la cola tarda en
/// vaciarse, y para quien apretó el botón eso es un botón que no funciona.
///
/// La cola se apaga con una rampa corta y después **queda congelada**: si
/// siguiera vaciándose, al volver a play la canción saltearía todo lo que pasó
/// en la pausa.
pub fn silence() {
    if let Some(decks) = decks() {
        decks.silence();
    }
}

/// El usuario volvió a play: la cola sigue donde estaba.
///
/// La cola congelada vuelve a sonar con el volumen que tenía, y la música
/// sigue donde la dejaste: no hay salto.
pub fn resume() {
    if let Some(decks) = decks() {
        decks.resume();
    }
}

/// ¿Estamos en los últimos segundos de la canción, donde el decoder no se frena?
fn in_tail() -> bool {
    let seconds = SECONDS.load(Ordering::Relaxed);
    let duration = DURATION_MS.load(Ordering::Relaxed);
    if seconds == 0 || duration == 0 {
        return false;
    }
    let position = POSITION_MS.load(Ordering::Relaxed);
    position.saturating_add(seconds * 1000 + POSITION_MARGIN_MS) >= duration
}

/// Muestras a duración, con el formato que da el player.
fn samples_to_duration(samples: u64) -> Duration {
    Duration::from_secs_f64(samples as f64 / (f64::from(SAMPLE_RATE) * f64::from(NUM_CHANNELS)))
}

/// Una cola de audio sobre el mixer.
struct Deck {
    sink: rodio::Sink,
    /// Las muestras que entraron.
    queued: AtomicU64,
    /// Las muestras que ya sonaron. Lo suma cada paquete al soltarse.
    played: Arc<AtomicU64>,
    /// Quién mueve el volumen. Un fundido nuevo sube el número, y el anterior,
    /// al verlo cambiado, deja de tocar esta cola.
    fade: AtomicU64,
    /// Un final que suena entero: una pausa no lo apaga.
    keep: AtomicBool,
    /// La cola quedó callada por una pausa y está esperando que vuelva el play.
    silenced: AtomicBool,
}

impl Deck {
    fn new(mixer: &rodio::mixer::Mixer, volume: f32) -> Arc<Deck> {
        let sink = rodio::Sink::connect_new(mixer);
        sink.set_volume(volume);
        Arc::new(Deck {
            sink,
            queued: AtomicU64::new(0),
            played: Arc::new(AtomicU64::new(0)),
            fade: AtomicU64::new(0),
            keep: AtomicBool::new(false),
            silenced: AtomicBool::new(false),
        })
    }

    fn append(&self, samples: &[f32]) {
        let count = samples.len() as u64;
        self.queued.fetch_add(count, Ordering::Relaxed);
        self.sink.append(Counted {
            inner: rodio::buffer::SamplesBuffer::new(NUM_CHANNELS as u16, SAMPLE_RATE, samples),
            samples: count,
            played: self.played.clone(),
        });
    }

    fn remaining(&self) -> Duration {
        if self.sink.empty() {
            return Duration::ZERO;
        }
        let queued = self.queued.load(Ordering::Relaxed);
        let played = self.played.load(Ordering::Relaxed);
        samples_to_duration(queued.saturating_sub(played))
    }
}

/// Un paquete que, al soltarse, avisa que ya sonó.
///
/// Es lo que deja saber cuánto le queda a un final en cola: rodio sabe cuántas
/// fuentes le quedan, no cuánto duran.
struct Counted {
    inner: rodio::buffer::SamplesBuffer,
    samples: u64,
    played: Arc<AtomicU64>,
}

impl Drop for Counted {
    fn drop(&mut self) {
        self.played.fetch_add(self.samples, Ordering::Relaxed);
    }
}

impl Iterator for Counted {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        // **La atenuación se aplica cuando la muestra sale de la cola.**
        //
        // Antes la aplicaba el mixer de librespot, antes de que el paquete
        // entrara en la cola: la cola sonaba con el volumen que tenía cuando
        // se encoló, y el control del volumen tardaba lo que la cola tarda en
        // vaciarse —hasta 26 paquetes— en llegar al oído. Acá se atenúa al
        // salir, que es cuando el oído la está esperando.
        self.inner.next().map(|sample| sample * attenuation() as f32)
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        self.inner.size_hint()
    }
}

impl rodio::Source for Counted {
    fn current_span_len(&self) -> Option<usize> {
        self.inner.current_span_len()
    }

    fn channels(&self) -> u16 {
        self.inner.channels()
    }

    fn sample_rate(&self) -> u32 {
        self.inner.sample_rate()
    }

    fn total_duration(&self) -> Option<Duration> {
        self.inner.total_duration()
    }
}

/// Cómo se va la cola que se deja atrás.
enum Retire {
    /// Se queda sonando hasta que la canción nueva entra, y ahí se mezclan.
    Crossfade,
    /// Se apaga en un instante: el usuario pidió otra cosa.
    Quick,
    /// Suena entera, sin fundido: el DJ habla después.
    Natural,
}

/// Las colas del sink de Starless.
pub struct Decks {
    mixer: rodio::mixer::Mixer,
    /// Donde escribe el player.
    current: Mutex<Arc<Deck>>,
    /// Los finales que todavía suenan.
    tails: Mutex<Vec<Arc<Deck>>>,
    /// El final que espera la primera muestra de la canción nueva para bajar.
    waiting: Mutex<Option<Arc<Deck>>>,
    /// El final de la canción está en la cola de `current`: el decoder no se frenó.
    armed: AtomicBool,
}

impl Decks {
    /// Abrir las colas sobre el mixer del stream, y que sean las que reciben
    /// las órdenes de aquí en adelante.
    pub fn open(mixer: rodio::mixer::Mixer) -> Arc<Decks> {
        let decks = Arc::new(Decks {
            current: Mutex::new(Deck::new(&mixer, 1.0)),
            mixer,
            tails: Mutex::new(Vec::new()),
            waiting: Mutex::new(None),
            armed: AtomicBool::new(false),
        });
        *lock(&DECKS) = Some(decks.clone());
        decks
    }

    fn current(&self) -> Arc<Deck> {
        lock(&self.current).clone()
    }

    /// Lo que el sink hace con un paquete del player.
    pub fn write(&self, samples: &[f32]) {
        let deck = self.current();

        // La primera muestra de la canción nueva: es el momento del fundido, y
        // no antes. Si se empezara al cargarla, el tiempo de la carga —medio
        // segundo, o varios con mala red— se comería el final de la anterior.
        if deck.queued.load(Ordering::Relaxed) == 0
            && let Some(tail) = lock(&self.waiting).take()
        {
            crossfade(tail, deck.clone());
        }

        deck.append(samples);

        if in_tail() {
            // Sin freno: el final de la canción entra entero en la cola.
            self.armed.store(true, Ordering::Relaxed);
            return;
        }

        // El bucle de vaciado es el de librespot y no se puede acortar: el sink
        // de rodio espera al dispositivo **dentro** de `write`, en un bucle sin
        // fin. Es el único lugar donde se puede esperar.
        while deck.sink.len() > PACED_PACKETS {
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    pub fn start(&self) {
        self.current().sink.play();
    }

    /// Callar la música y congelar la cola.
    ///
    /// La cola se apaga con una rampa corta y después queda quieta: si
    /// siguiera vaciándose en silencio, al volver a play la canción saltearía
    /// todo lo que pasó en la pausa.
    pub fn silence(&self) {
        self.settle_waiting();
        // Una pausa en el medio de un fundido calla también lo que bajaba.
        for tail in lock(&self.tails).iter() {
            if !tail.keep.load(Ordering::Relaxed) {
                fade_out(tail.clone(), QUICK_FADE);
            }
        }
        let current = self.current();
        current.silenced.store(true, Ordering::Relaxed);
        fade_out_and_pause(current, PAUSE_FADE);
    }

    /// Descartar lo que quedó en la cola.
    ///
    /// Un salto descarta el audio del lugar de antes: si no, suena encima de
    /// la posición nueva y el salto no se oye.
    pub fn cut(&self) {
        let fresh = Deck::new(&self.mixer, 1.0);
        let old = std::mem::replace(&mut *lock(&self.current), fresh);

        {
            let mut tails = lock(&self.tails);
            tails.retain(|tail| !tail.sink.empty());
            tails.push(old.clone());
        }

        // **La cola vieja se va, pero no de golpe.** Un corte seco se oye
        // como un chasquido; una rampa cortita lo evita y casi no se nota.
        fade_out(old, CUT_FADE);
    }

    /// La cola vuelve a sonar, con el volumen que tenía.
    ///
    /// **Sólo se deshace lo que hizo una pausa.** Una cola nueva —la de una
    /// canción que recién entra en un fundido— tiene su propio volumen, y
    /// pisarlo acá dejaría la transición sin fundido.
    pub fn resume(&self) {
        let current = self.current();
        if current.silenced.swap(false, Ordering::Relaxed) {
            // El fundido que la calló termina acá: si siguiera, volvería a
            // bajar el volumen después de que volvió el play.
            current.fade.fetch_add(1, Ordering::Relaxed);
            current.sink.set_volume(1.0);
        }
        current.sink.play();
    }

    /// El player se detuvo: una pausa, un stop, o el DJ que necesita silencio.
    pub fn stop(&self) {
        self.settle_waiting();
        if self.armed.swap(false, Ordering::Relaxed) {
            // Hay segundos de final en la cola. Esperar a que se vacíe sería
            // hacer esperar a la pausa esos segundos.
            self.retire(Retire::Quick);
        }
        // Una pausa en el medio de un fundido calla también lo que bajaba.
        for tail in lock(&self.tails).iter() {
            if !tail.keep.load(Ordering::Relaxed) {
                fade_out(tail.clone(), QUICK_FADE);
            }
        }
        let current = self.current();
        current.sink.sleep_until_end();
        current.sink.pause();
    }

    /// Un final esperaba una canción que nunca empezó: se apaga, y la cola
    /// actual vuelve a su volumen.
    fn settle_waiting(&self) {
        if let Some(tail) = lock(&self.waiting).take() {
            fade_out(tail, QUICK_FADE);
            let current = self.current();
            current.fade.fetch_add(1, Ordering::Relaxed);
            current.sink.set_volume(1.0);
        }
    }

    /// Dejar atrás la cola actual y abrir una nueva para lo que venga.
    fn retire(&self, how: Retire) {
        let volume = match how {
            Retire::Crossfade => 0.0,
            Retire::Quick | Retire::Natural => 1.0,
        };
        let fresh = Deck::new(&self.mixer, volume);
        let old = std::mem::replace(&mut *lock(&self.current), fresh);

        {
            let mut tails = lock(&self.tails);
            tails.retain(|tail| !tail.sink.empty());
            tails.push(old.clone());
        }

        match how {
            Retire::Crossfade => *lock(&self.waiting) = Some(old),
            Retire::Quick => fade_out(old, QUICK_FADE),
            Retire::Natural => old.keep.store(true, Ordering::Relaxed),
        }
    }

    fn silence_left(&self) -> Duration {
        let mut tails = lock(&self.tails);
        tails.retain(|tail| !tail.sink.empty());
        tails
            .iter()
            .map(|tail| tail.remaining())
            .chain(std::iter::once(self.current().remaining()))
            .max()
            .unwrap_or_default()
    }
}

/// La canción que termina baja y la nueva sube, durante lo que le queda a la
/// que termina.
fn crossfade(tail: Arc<Deck>, fresh: Arc<Deck>) {
    let remaining = tail.remaining();
    // **El fundido dura lo que el ajuste dice, no lo que quedó en la cola.**
    //
    // La cola del final puede traer más audio del que dura la transición —el
    // final entero de la canción, cuando el decoder no se frenó— y medir el
    // fundido con eso hacía que la canción nueva tardara doce segundos en
    // llegar a su volumen, con la vieja todavía encima: un crossfade que no
    // se oye como un crossfade. Y si la cola se acaba antes, el fundido se
    // acorta con ella: la vieja tiene que estar callada cuando se acaba su
    // audio.
    let setting = Duration::from_millis(u64::from(SECONDS.load(Ordering::Relaxed)) * 1000);
    let length = remaining.min(setting);
    // La carga tardó más que el final: no hay nada que mezclar, la nueva entra
    // a su volumen.
    if length < Duration::from_millis(50) {
        tail.sink.stop();
        fresh.fade.fetch_add(1, Ordering::Relaxed);
        fresh.sink.set_volume(1.0);
        return;
    }
    log::info!(
        "crossfade de {} ms (la cola traía {} ms en {} paquetes; posición {} de {})",
        length.as_millis(),
        remaining.as_millis(),
        tail.sink.len(),
        POSITION_MS.load(Ordering::Relaxed),
        DURATION_MS.load(Ordering::Relaxed),
    );
    // El final que baja ya está en la lista de finales —`retire` lo puso
    // ahí—, así que una pausa lo calla como a cualquier otro.
    mix(tail, fresh, length);
}

/// Los dos volúmenes de la transición en un momento dado.
///
/// `t` es cuánto de la transición pasó, de 0 a 1. La vieja baja linealmente y
/// la nueva sube con la potencia que queda: la suma de las dos es siempre la
/// misma, y por eso la transición no se oye más fuerte que una canción sola.
///
/// La curva sale de Spotify: la vieja baja de una a lo largo del ajuste y la
/// nueva entra desde su principio y sube con lo que la vieja deja.
fn mix_volumes(t: f32) -> (f32, f32) {
    let down = 1.0 - t;
    let up = (1.0 - down * down).max(0.0).sqrt();
    (down, up)
}

/// La transición: la que sale baja mientras la que entra sube.
///
/// **La vieja baja de una y la nueva sube con la potencia constante.** La suma
/// de las potencias de las dos es siempre la misma, así que la transición no
/// se oye más fuerte que una canción sola: con las dos a volumen completo
/// durante el primer segundo se oía el doble, y eso es lo que hace que una
/// mezcla suene a mezcla y no a dos canciones encima.
///
/// La que sale sigue `cos` cuando se apaga sola (`fade_out`), y ahí no hay
/// nadie que la tape: el pozo de volumen de dos rampas lineales se oye.
fn mix(tail: Arc<Deck>, fresh: Arc<Deck>, length: Duration) {
    let down_id = tail.fade.fetch_add(1, Ordering::Relaxed) + 1;
    let down_from = tail.sink.volume();
    let up_id = fresh.fade.fetch_add(1, Ordering::Relaxed) + 1;

    std::thread::spawn(move || {
        let started = Instant::now();
        let mut quarter = 0u8;
        loop {
            let elapsed = started.elapsed().as_secs_f32();
            let t = (elapsed / length.as_secs_f32()).min(1.0);

            let (down, up) = mix_volumes(t);

            if tail.fade.load(Ordering::Relaxed) == down_id {
                tail.sink.set_volume(down_from * down);
            }
            if fresh.fade.load(Ordering::Relaxed) == up_id {
                fresh.sink.set_volume(up);
            }

            // Un rastro por cuarto de transición: si las dos no se oyen
            // mezcladas, el log dice por qué.
            let mark = (t * 4.0) as u8;
            if mark > quarter {
                quarter = mark;
                log::info!(
                    "crossfade {}%: la vieja en {:.2}, la nueva en {:.2}",
                    mark * 25,
                    tail.sink.volume(),
                    fresh.sink.volume(),
                );
            }

            if t >= 1.0 {
                if tail.fade.load(Ordering::Relaxed) == down_id {
                    tail.sink.stop();
                }
                if fresh.fade.load(Ordering::Relaxed) == up_id {
                    fresh.sink.set_volume(1.0);
                }
                return;
            }
            std::thread::sleep(STEP);
        }
    });
}

/// Apagar la cola: el volumen baja a cero en `length` y la cola se va.
///
/// **La curva es de igual potencia** —`cos`— y no lineal: dos rampas
/// lineales se suman con un pozo de volumen en el medio, que es lo que se oye
/// cuando una canción se apaga debajo de otra.
fn fade_out(deck: Arc<Deck>, length: Duration) {
    let id = deck.fade.fetch_add(1, Ordering::Relaxed) + 1;
    let from = deck.sink.volume();
    std::thread::spawn(move || {
        let started = Instant::now();
        loop {
            let t = (started.elapsed().as_secs_f32() / length.as_secs_f32()).min(1.0);
            if deck.fade.load(Ordering::Relaxed) == id {
                let angle = t * std::f32::consts::FRAC_PI_2;
                deck.sink.set_volume(from * angle.cos());
            }
            if t >= 1.0 {
                if deck.fade.load(Ordering::Relaxed) == id {
                    deck.sink.set_volume(0.0);
                    // `stop` vacía la cola: el audio del lugar de antes no
                    // suena encima del nuevo.
                    deck.sink.stop();
                }
                return;
            }
            std::thread::sleep(STEP);
        }
    });
}

/// Apagar la cola y **congelarla**.///
/// A diferencia de `fade_out`, la cola no se vacía: queda guardada, con la
/// música que le faltaba, para que al volver a play la canción siga donde
/// estaba. Si se vaciara, al volver a play la canción saltearía todo lo que
/// pasó en la pausa —o, peor, seguiría sonando desde el principio.
fn fade_out_and_pause(deck: Arc<Deck>, length: Duration) {
    let id = deck.fade.fetch_add(1, Ordering::Relaxed) + 1;
    let from = deck.sink.volume();
    std::thread::spawn(move || {
        let started = Instant::now();
        loop {
            let t = (started.elapsed().as_secs_f32() / length.as_secs_f32()).min(1.0);
            if deck.fade.load(Ordering::Relaxed) == id {
                let angle = t * std::f32::consts::FRAC_PI_2;
                deck.sink.set_volume(from * angle.cos());
            }
            if t >= 1.0 {
                if deck.fade.load(Ordering::Relaxed) == id {
                    deck.sink.set_volume(0.0);
                    // **La cola se queda donde está.** El player dejó de
                    // pedirle audio, pero lo que ya estaba guardado seguía
                    // sonando: por eso la pausa tardaba lo que la cola tarda
                    // en vaciarse. Congelada, el silencio es inmediato y la
                    // música sigue donde la dejaste.
                    deck.sink.pause();
                }
                return;
            }
            std::thread::sleep(STEP);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_tail_starts_seconds_before_the_end() {
        SECONDS.store(5, Ordering::Relaxed);
        DURATION_MS.store(200_000, Ordering::Relaxed);

        POSITION_MS.store(190_000, Ordering::Relaxed);
        assert!(!in_tail(), "diez segundos antes todavía se frena");

        POSITION_MS.store(195_000, Ordering::Relaxed);
        assert!(in_tail(), "cinco segundos antes ya no");

        SECONDS.store(0, Ordering::Relaxed);
        assert!(!in_tail(), "con el ajuste en 0 nunca");

        SECONDS.store(5, Ordering::Relaxed);
        DURATION_MS.store(0, Ordering::Relaxed);
        assert!(!in_tail(), "sin duración conocida nunca");
    }

    #[test]
    fn the_next_song_comes_in_at_its_own_beginning() {
        // La mezcla es entre las dos canciones: si la que entra empieza en su
        // segundo seis, se oye como si le faltara el principio. El adelanto
        // que hubo antes saltaba la entrada de cada canción.
        assert_eq!(LEAD_IN_MS, 0);
    }

    #[test]
    fn the_crossfade_takes_its_seconds_off_the_song() {
        // Con doce segundos de crossfade, una canción de tres minutos
        // veintiuno dura tres minutos nueve: los últimos segundos son la
        // mezcla y no forman parte de la canción.
        assert_eq!(shorten(201_946, 12), 189_946);
        assert_eq!(shorten(201_946, 0), 201_946);
        // Una canción más corta que el crossfade no da la vuelta.
        assert_eq!(shorten(5_000, 12), 0);
    }

    #[test]
    fn the_mix_never_gets_louder_than_one_song() {
        // La suma de las potencias de las dos tiene que ser la misma en toda
        // la transición: si sube, la mezcla se oye más fuerte que una canción
        // sola, y con las dos a volumen completo al principio se oía el doble.
        for step in 0..=100 {
            let t = step as f32 / 100.0;
            let (down, up) = mix_volumes(t);
            let power = down * down + up * up;
            assert!(
                (power - 1.0).abs() < 0.0001,
                "en el {t} la mezcla vale {power}, no 1"
            );
        }
        // Y la nueva arranca en silencio y termina sola.
        assert_eq!(mix_volumes(0.0), (1.0, 0.0));
        let (down, up) = mix_volumes(1.0);
        assert!(down < 0.001 && up > 0.999);
    }

    /// El fundido tiene que llegar al audio que **ya está en cola**.
    ///
    /// El final de la canción que termina queda encolado —once segundos de
    /// audio— y el fundido lo baja con `set_volume` sobre el sink. Si rodio
    /// tomara el volumen sólo en el momento de encolar, esa cola se oiría
    /// entera: el crossfade sería una canción y después otra.
    #[test]
    fn the_fade_reaches_the_audio_that_is_already_queued() {
        // Un mixer sin dispositivo: el mismo que usa la app.
        let (mixer, mut output) = rodio::mixer::mixer(2, SAMPLE_RATE);
        let sink = rodio::Sink::connect_new(&mixer);
        sink.append(rodio::buffer::SamplesBuffer::new(
            2,
            SAMPLE_RATE,
            vec![1.0f32; SAMPLE_RATE as usize * 2],
        ));

        // Lo que sale antes de tocar el volumen, ya en régimen: rodio refresca
        // el volumen del sink cada cinco milisegundos, así que los primeros
        // milisegundos salen con el valor anterior.
        let _: f32 = output.by_ref().take(2048).sum();
        let loud: f32 = output.by_ref().take(8192).sum();

        sink.set_volume(0.1);
        // Los milisegundos del retraso, y después la medida.
        let _: f32 = output.by_ref().take(2048).sum();
        let quiet: f32 = output.by_ref().take(8192).sum();

        assert!(loud > 0.0, "el audio sale del mixer");
        assert!(
            quiet < loud / 5.0,
            "el fundido tiene que bajar el audio encolado: {quiet} contra {loud}"
        );
    }

    #[test]
    fn a_second_of_audio_is_a_second() {
        let samples = u64::from(SAMPLE_RATE) * u64::from(NUM_CHANNELS);
        assert_eq!(samples_to_duration(samples), Duration::from_secs(1));
    }
}
