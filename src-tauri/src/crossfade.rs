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
//! otra. Con la primera muestra de la nueva empieza el fundido: una baja y la
//! otra sube, con una curva de igual potencia para que el volumen no se hunda
//! en el medio.
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

/// Cada cuánto se mueve el volumen durante un fundido.
const STEP: Duration = Duration::from_millis(20);

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
                    start = lead_in_ms(SECONDS.load(Ordering::Relaxed), duration_ms);
                    log::info!("crossfade: la siguiente entra en {start} ms");
                }
            } else {
                decks.retire(Retire::Quick);
            }
        }
    }
    ACCEPTING.store(false, Ordering::Relaxed);
    DURATION_MS.store(duration_ms, Ordering::Relaxed);
    POSITION_MS.store(start, Ordering::Relaxed);
    start
}

/// Cuánto entra adelantada una canción en una transición.
fn lead_in_ms(seconds: u32, duration_ms: u32) -> u32 {
    (seconds * 1000 / 2).min(duration_ms / 4)
}

/// El usuario saltó dentro de la canción: el final que estaba en cola ya no va.
///
/// La posición se pone acá y no se espera al evento `Seeked`: hasta que llega,
/// la vieja diría que seguimos en los últimos segundos y el decoder no se
/// frenaría.
pub fn cut(position_ms: u32) {
    POSITION_MS.store(position_ms, Ordering::Relaxed);
    if let Some(decks) = decks()
        && decks.armed.swap(false, Ordering::Relaxed)
    {
        decks.retire(Retire::Quick);
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
    let length = tail.remaining();
    // La carga tardó más que el final: no hay nada que mezclar, la nueva entra
    // a su volumen.
    if length < Duration::from_millis(50) {
        tail.sink.stop();
        fresh.fade.fetch_add(1, Ordering::Relaxed);
        fresh.sink.set_volume(1.0);
        return;
    }
    log::info!("crossfade de {} ms", length.as_millis());
    ramp(Some(tail), Some(fresh), length);
}

fn fade_out(deck: Arc<Deck>, length: Duration) {
    ramp(Some(deck), None, length);
}

/// Apagar la cola y **congelarla**.
///
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

/// Mover los volúmenes en un hilo propio, con curva de igual potencia.
///
/// El que baja sigue `cos` y el que sube `sin`: la suma de sus potencias es
/// siempre la misma, y por eso no hay un pozo de volumen en el medio, que es lo
/// que se oye con dos rampas lineales.
fn ramp(down: Option<Arc<Deck>>, up: Option<Arc<Deck>>, length: Duration) {
    let down = down.map(|deck| {
        let id = deck.fade.fetch_add(1, Ordering::Relaxed) + 1;
        let from = deck.sink.volume();
        (deck, id, from)
    });
    let up = up.map(|deck| {
        let id = deck.fade.fetch_add(1, Ordering::Relaxed) + 1;
        (deck, id)
    });

    std::thread::spawn(move || {
        let started = Instant::now();
        loop {
            let t = (started.elapsed().as_secs_f32() / length.as_secs_f32()).min(1.0);
            let angle = t * std::f32::consts::FRAC_PI_2;

            if let Some((deck, id, from)) = &down
                && deck.fade.load(Ordering::Relaxed) == *id
            {
                deck.sink.set_volume(from * angle.cos());
            }
            if let Some((deck, id)) = &up
                && deck.fade.load(Ordering::Relaxed) == *id
            {
                deck.sink.set_volume(angle.sin());
            }

            if t >= 1.0 {
                if let Some((deck, id, _)) = &down
                    && deck.fade.load(Ordering::Relaxed) == *id
                {
                    deck.sink.stop();
                }
                if let Some((deck, id)) = &up
                    && deck.fade.load(Ordering::Relaxed) == *id
                {
                    deck.sink.set_volume(1.0);
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
    fn the_next_song_comes_in_half_the_crossfade_ahead() {
        assert_eq!(lead_in_ms(8, 200_000), 4_000);
        assert_eq!(lead_in_ms(1, 200_000), 500);
        // A short song does not start halfway through.
        assert_eq!(lead_in_ms(12, 20_000), 5_000);
        assert_eq!(lead_in_ms(0, 200_000), 0);
    }

    #[test]
    fn a_second_of_audio_is_a_second() {
        let samples = u64::from(SAMPLE_RATE) * u64::from(NUM_CHANNELS);
        assert_eq!(samples_to_duration(samples), Duration::from_secs(1));
    }
}
