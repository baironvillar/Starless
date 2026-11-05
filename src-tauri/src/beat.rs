//! El pulso de la música, para que la barra de volumen lata con el beat.
//!
//! **Se mide donde la muestra suena, no donde se decodifica.** La cola del sink
//! va hasta 700 ms por delante del oído —y doce segundos en el final de una
//! canción con crossfade—, así que medir al encolar haría latir la barra antes
//! que el bombo. `crossfade::Counted::next` llama a `feed` en el momento en que
//! el mixer saca la muestra hacia el dispositivo.
//!
//! **Se mide antes del volumen**: el pulso es de la canción, no de la perilla.
//!
//! El audio no pasa por el webview (regla 1 de `AGENTS.md`), así que el webview
//! no puede oír nada: recibe un número entre 0 y 1, unas treinta veces por
//! segundo, y sólo mientras suena algo.

use std::cell::RefCell;
use std::sync::Once;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::time::Duration;

use librespot_playback::{NUM_CHANNELS, SAMPLE_RATE};
use tauri::{AppHandle, Emitter};

/// Muestras por segundo tal como llegan: intercaladas, izquierda y derecha.
const RATE: f32 = (SAMPLE_RATE * NUM_CHANNELS as u32) as f32;

/// Hasta dónde se escucha el bombo. Por encima están las voces y los platillos,
/// que marcan otra cosa que el beat.
const BASS_HZ: f32 = 150.0;

/// Cuánto tarda en apagarse un golpe: lo que dura la onda en pantalla.
const RELEASE_S: f32 = 0.15;

/// La memoria del nivel de fondo. Un golpe es un golpe contra este segundo y medio.
const AVERAGE_S: f32 = 1.5;

/// Cada cuántas muestras se publica el pulso. Escribir el atómico en cada una
/// sería 88 200 escrituras por segundo para un lector que mira treinta.
const PUBLISH_EVERY: u32 = 512;

/// Cada cuánto el webview recibe el pulso.
const EMIT_INTERVAL: Duration = Duration::from_millis(33);

/// El último pulso, en bits de `f32`.
static PULSE: AtomicU32 = AtomicU32::new(0);
/// Cuántas veces se publicó. Si no se mueve, no está sonando nada.
static TICKS: AtomicU64 = AtomicU64::new(0);

thread_local! {
    // El mixer saca las muestras desde un solo hilo, el del dispositivo.
    static DETECTOR: RefCell<Detector> = RefCell::new(Detector::new(RATE));
}

/// Un detector de golpes de graves: un pasabajos, una envolvente rápida y un
/// promedio lento. El pulso es cuánto sobresale la envolvente del promedio.
struct Detector {
    lowpass: f32,
    envelope: f32,
    average: f32,
    a_lowpass: f32,
    release: f32,
    a_average: f32,
    count: u32,
}

impl Detector {
    fn new(rate: f32) -> Self {
        Self {
            lowpass: 0.0,
            envelope: 0.0,
            average: 0.0,
            a_lowpass: 1.0 - (-2.0 * std::f32::consts::PI * BASS_HZ / rate).exp(),
            release: (-1.0 / (RELEASE_S * rate)).exp(),
            a_average: 1.0 / (AVERAGE_S * rate),
            count: 0,
        }
    }

    fn feed(&mut self, sample: f32) {
        self.lowpass += self.a_lowpass * (sample - self.lowpass);
        self.envelope = self.lowpass.abs().max(self.envelope * self.release);
        self.average += self.a_average * (self.envelope - self.average);
    }

    /// 0 en el fondo, 1 en un golpe que dobla el nivel de fondo o más.
    fn pulse(&self) -> f32 {
        if self.average < 1e-4 {
            return 0.0;
        }
        ((self.envelope / self.average - 1.15) / 0.85).clamp(0.0, 1.0)
    }
}

/// Lo llama el sink por cada muestra que sale hacia el dispositivo.
pub fn feed(sample: f32) {
    DETECTOR.with(|cell| {
        let mut detector = cell.borrow_mut();
        detector.feed(sample);
        detector.count += 1;
        if detector.count >= PUBLISH_EVERY {
            detector.count = 0;
            PULSE.store(detector.pulse().to_bits(), Ordering::Relaxed);
            TICKS.fetch_add(1, Ordering::Relaxed);
        }
    });
}

/// Arrancar el hilo que avisa el pulso al webview. Una vez por proceso: el
/// player se vuelve a crear en cada recuperación, y el hilo no tiene por qué.
pub fn start(app: &AppHandle) {
    static STARTED: Once = Once::new();
    STARTED.call_once(|| {
        let app = app.clone();
        std::thread::spawn(move || {
            let mut last_ticks = 0;
            let mut quiet = true;
            loop {
                std::thread::sleep(EMIT_INTERVAL);
                let ticks = TICKS.load(Ordering::Relaxed);
                if ticks == last_ticks {
                    // Pausa, fin de la cola o DJ hablando: un cero, y silencio.
                    if !quiet {
                        let _ = app.emit("player://beat", 0.0f32);
                        quiet = true;
                    }
                    continue;
                }
                last_ticks = ticks;
                quiet = false;
                let _ = app.emit(
                    "player://beat",
                    f32::from_bits(PULSE.load(Ordering::Relaxed)),
                );
            }
        });
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Medio segundo de un bombo de 60 Hz que se apaga, cada medio segundo,
    /// sobre un fondo bajo, y el pulso medido justo después de un golpe y justo
    /// antes del siguiente.
    #[test]
    fn a_kick_pulses_and_the_gap_between_kicks_does_not() {
        let rate = 1000.0;
        let mut detector = Detector::new(rate);
        let mut after_kick = Vec::new();
        let mut before_kick = Vec::new();
        for i in 0..(rate as usize * 6) {
            let t = i as f32 / rate;
            let since = t % 0.5;
            let kick = (-since * 20.0).exp() * (2.0 * std::f32::consts::PI * 60.0 * t).sin();
            detector.feed(0.8 * kick + 0.02 * (2.0 * std::f32::consts::PI * 40.0 * t).sin());
            // Pasados los primeros dos segundos, que llenan el promedio.
            if t > 2.0 {
                if (0.04..0.05).contains(&since) {
                    after_kick.push(detector.pulse());
                }
                if (0.45..0.46).contains(&since) {
                    before_kick.push(detector.pulse());
                }
            }
        }
        let max_after = after_kick.iter().copied().fold(0.0, f32::max);
        let max_before = before_kick.iter().copied().fold(0.0, f32::max);
        assert!(max_after > 0.5, "el golpe tiene que latir: {max_after}");
        assert!(max_before < 0.1, "entre golpes no: {max_before}");
    }

    #[test]
    fn silence_is_no_pulse() {
        let mut detector = Detector::new(1000.0);
        for _ in 0..5000 {
            detector.feed(0.0);
        }
        assert_eq!(detector.pulse(), 0.0);
    }
}
