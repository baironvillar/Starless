import type { Lang } from "./i18n";

/**
 * What changed, in the app, in the order it changed.
 *
 * **These entries are reconstructed, not recorded.** Starless was built in one
 * sitting and has no version control behind it: there is no `.git`, no commit
 * history, and no release notes — the README is still Tauri's template. The split
 * below comes from file modification times, which line up into three clean
 * clusters: the scaffold and the design system (05:46–07:21), the app that
 * actually played music (15:20–17:42), and the search work (17:58 onward). Files
 * never touched after their cluster are the strongest members of their version.
 *
 * That is evidence, not a record. It is accurate about *what existed* and
 * inferred about *which version introduced it*, and the inference is marked as
 * such rather than dressed up as history. Once the project is in a repository,
 * `git log` replaces this reasoning with something nobody has to guess about.
 *
 * Both languages, because PRODUCT.md ships them together. A changelog is the one
 * screen a user reads when something is already wrong, and it is the worst
 * possible place to hand someone a language they did not choose.
 */

type Section = { title: string; items: string[] };

export type ChangelogEntry = {
  version: string;
  /** `null` for a build still in development. */
  date: string | null;
  released: boolean;
  /**
   * True when this entry was inferred rather than recorded. It changes nothing
   * about what is listed; it only tells the reader how much to trust the
   * version-to-change mapping.
   */
  reconstructed?: boolean;
  sections: Record<Lang, Section[]>;
};

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "0.3.0",
    date: null,
    released: false,
    sections: {
      es: [
        {
          title: "Añadido",
          items: [
            "Búsqueda con sugerencias que se abren bajo el campo, sin quitar lo que estabas leyendo.",
            "Pestañas en los resultados: Todo, Canciones, Álbumes, Playlists y Artistas.",
            "Perfil de artista con su discografía y sus canciones.",
            "Reproducir un álbum entero desde su tarjeta, con cola propia.",
            "Agregar una canción a una playlist, y crear la playlist desde ahí mismo.",
            "Registro a archivo local, con rotación, y autodiagnóstico con STARLESS_DIAGNOSTIC=1.",
            "Actualizaciones automáticas: Starless comprueba si hay una versión nueva al abrir y tú decides cuándo instalarla.",
            "Estos changelogs, en Diagnóstico.",
          ],
        },
        {
          title: "Corregido",
          items: [
            "No sonaba nada: Spotify rechaza el client token de las apps nuevas. Ahora la sesión de reproducción y la Web API usan identidades distintas.",
            "Las playlists devolvían 403 tras la migración de Spotify de febrero de 2026. El endpoint se llama /items ahora, no /tracks.",
            "Todas las playlists decían «0 canciones» porque Spotify eliminó el total. El conteo ahora es exacto: se cuenta lo que se cargó.",
            "Una canción retirada vaciaba la biblioteca entera.",
            "La app se caía al escribir en el buscador: la política de reintento recibía un error que no era el tipo que esperaba.",
            "Cerrar sesión dejaba cacheado un «no has iniciado sesión» que sobrevivía al reinicio.",
            "Abrir una playlist hacía un handshake TLS completo cada vez: ahora el cliente HTTP se comparte.",
          ],
        },
        {
          title: "Cambiado",
          items: [
            "Escribir ya no borra la pantalla principal. Enter es lo que decide.",
            "Una canción que no se puede reproducir se salta, hasta cinco seguidas antes de rendirse.",
            "Las consultas que Spotify responde con 503 se reintentan una vez: es su borde, no la petición.",
          ],
        },
      ],
      en: [
        {
          title: "Added",
          items: [
            "Search with suggestions that open under the field, without taking away what you were reading.",
            "Result tabs: All, Songs, Albums, Playlists and Artists.",
            "An artist profile with their discography and their songs.",
            "Playing a whole album from its card, with its own queue.",
            "Adding a song to a playlist, and creating the playlist from there.",
            "A local log file with rotation, plus a self-test behind STARLESS_DIAGNOSTIC=1.",
            "Automatic updates: Starless checks for a new version when it opens, and you decide when to install it.",
            "These changelogs, under Diagnostics.",
          ],
        },
        {
          title: "Fixed",
          items: [
            "Nothing played: Spotify refuses the client token of new apps. The playback session and the Web API now use separate identities.",
            "Playlists answered 403 after Spotify's February 2026 migration. The endpoint is /items now, not /tracks.",
            "Every playlist said “0 songs” because Spotify removed the total. The count is exact now: it counts what was loaded.",
            "A single withdrawn song emptied the whole library.",
            "The app crashed while typing in the search box: the retry policy was handed an error that was not the type it expected.",
            "Signing out left a cached “not signed in” that survived a restart.",
            "Opening a playlist paid a full TLS handshake every time: the HTTP client is shared now.",
          ],
        },
        {
          title: "Changed",
          items: [
            "Typing no longer wipes the main screen. Enter is what decides.",
            "A song that will not play is skipped, up to five in a row before giving up.",
            "Calls Spotify answers with 503 are retried once: that is their edge, not the request.",
          ],
        },
      ],
    },
  },
  {
    version: "0.2.0",
    date: null,
    released: true,
    reconstructed: true,
    sections: {
      es: [
        {
          title: "Añadido",
          items: [
            "Inicio de sesión con Spotify por OAuth. La app nunca ve tu contraseña.",
            "Audio de verdad: el PCM va de librespot al driver de Windows por WASAPI, sin pasar por la ventana.",
            "Tu biblioteca: canciones que te gustan y tus playlists, con el conteo exacto.",
            "Barra de reproducción con datos reales: portada, aleatorio, anterior, pausa, siguiente y repetir.",
            "Cola de reproducción, con lo que suena y lo que sigue.",
            "Agregar una canción a una playlist, y crear la playlist desde ahí.",
            "Registro a archivo local y autodiagnóstico con STARLESS_DIAGNOSTIC=1.",
          ],
        },
        {
          title: "Corregido",
          items: [
            "No se podía reproducir nada: Spotify rechaza el client token de las apps nuevas, así que la sesión de reproducción y la Web API usan identidades distintas.",
            "Las playlists devolvían 403 tras la migración de Spotify de febrero de 2026. El endpoint se llama /items ahora, no /tracks.",
            "Todas las playlists decían «0 canciones» porque Spotify eliminó el total. Ahora se pagina hasta el final y el conteo es exacto.",
            "Una canción retirada vaciaba la biblioteca entera.",
            "Abrir una playlist hacía un handshake TLS completo cada vez: ahora el cliente HTTP se comparte.",
          ],
        },
        {
          title: "Cambiado",
          items: [
            "Premium se pide y se explica temprano, porque sin Premium Spotify no entrega audio.",
            "Una canción que no se puede reproducir se salta, hasta cinco seguidas antes de rendirse.",
          ],
        },
      ],
      en: [
        {
          title: "Added",
          items: [
            "Spotify sign-in through OAuth. The app never sees your password.",
            "Real audio: PCM goes from librespot to the Windows driver over WASAPI, never through the window.",
            "Your library: Liked Songs and your playlists, with the exact count.",
            "A player bar with real data: cover, shuffle, previous, pause, next and repeat.",
            "A play queue, with what is playing and what is next.",
            "Adding a song to a playlist, and creating the playlist from there.",
            "A local log file and a self-test behind STARLESS_DIAGNOSTIC=1.",
          ],
        },
        {
          title: "Fixed",
          items: [
            "Nothing could play: Spotify refuses the client token of new apps, so the playback session and the Web API use separate identities.",
            "Playlists answered 403 after Spotify's February 2026 migration. The endpoint is /items now, not /tracks.",
            "Every playlist said “0 songs” because Spotify removed the total. The list is now walked to its end and the count is exact.",
            "A single withdrawn song emptied the whole library.",
            "Opening a playlist paid a full TLS handshake every time: the HTTP client is shared now.",
          ],
        },
        {
          title: "Changed",
          items: [
            "Premium is asked about and explained early, because without it Spotify delivers no audio.",
            "A song that will not play is skipped, up to five in a row before giving up.",
          ],
        },
      ],
    },
  },
  {
    version: "0.1.0",
    date: null,
    released: true,
    reconstructed: true,
    sections: {
      es: [
        {
          title: "Añadido",
          items: [
            "La app de escritorio: ventana, proceso de Rust y estructura de comandos.",
            "El sistema visual: vidrio translúcido, paleta y tipografías definidas en DESIGN.md.",
            "Interfaz bilingüe, español e inglés, con selector.",
            "La versión en un solo lugar, con un script que la propaga a los tres manifiestos y falla en CI si discrepan.",
          ],
        },
      ],
      en: [
        {
          title: "Added",
          items: [
            "The desktop app: window, Rust process and command surface.",
            "The visual system: floating glass, palette and typography, as set out in DESIGN.md.",
            "A bilingual interface, Spanish and English, with a selector.",
            "The version in one place, with a script that propagates it to all three manifests and fails CI when they disagree.",
          ],
        },
      ],
    },
  },
];

export const PREVIOUS_NOTE: Record<Lang, string> = {
  es: "Estas entradas se reconstruyeron a partir de las fechas de los archivos, no de un registro: Starless se construyó de una sola sentada y nunca tuvo control de versiones. Dicen con exactitud qué existía; qué versión lo introdujo es una inferencia, y está marcada como tal.",
  en: "These entries were reconstructed from file timestamps, not from a record: Starless was built in one sitting and never had version control. They are exact about what existed; which version introduced it is an inference, marked as one.",
};
