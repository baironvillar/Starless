import type { Lang } from "./i18n";

/**
 * What changed, in the app, in the order it changed.
 *
 * **0.1.0 and 0.2.0 are reconstructed; 0.3.0 is recorded.** Starless was built in
 * one sitting and the first two entries have no history behind them: there was no
 * `.git`, no commit log, no release notes. The split below comes from file
 * modification times, which line up into three clean clusters: the scaffold and
 * the design system (05:46–07:21), the app that actually played music
 * (15:20–17:42), and the search work (17:58 onward). Files never touched after
 * their cluster are the strongest members of their version.
 *
 * That is evidence, not a record. It is accurate about *what existed* and
 * inferred about *which version introduced it*, and the inference is marked as
 * such rather than dressed up as history. From 0.3.0 onward there is a repository
 * and a tag, so `git log` replaces that reasoning with something nobody has to
 * guess about.
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
    version: "0.3.2",
    date: "2026-10-17",
    released: true,
    sections: {
      es: [
        {
          title: "Corregido",
          items: [
            "Al abrir otra playlist, la lista arrancaba a la altura donde habías dejado la anterior. Ahora cada lista arranca en su propio arriba.",
            "Las filas de una lista aparecían con huecos entre medio durante unos segundos: la cascada de entrada no tenía tope, así que en una playlist de 198 canciones la última fila esperaba casi seis segundos en ser visible. Ahora la cascada se detiene en la primera docena.",
            "Abrir una playlist mostraba filas de la anterior. Una playlist puede tener la misma canción dos veces, y con esa fila compartida entre dos canciones React dejaba las filas viejas montadas: seguían pintando la lista previa debajo del nombre y el conteo de la nueva. Cuatro canciones repetidas en «Mi playlist n.º 4» eran cuatro filas de más en cada lista que abrieras después.",
            "Pasar el cursor por las playlists volvía a descargar todas sus páginas, una y otra vez: el precargado se guardaba ya vencido, así que el `staleTime` de cinco minutos del hook no llegaba nunca a aplicarse. Una playlist larga se descargó seis veces completas en diez segundos.",
            "Después de una actualización, la app siguiente abría pidiendo el reporte de un crash que nunca hubo. El actualizador entrega el instalador a Windows y el proceso se va antes de que se pueda cerrar la sesión a tiempo, así que el marcador de sesión sobrevive.",
            "Una sesión que moría a los pocos segundos ya no cuenta como caída. Un cierre abrupto se distingue de un crash por lo único que los separa: cuánto vivió.",
            "El español estaba escrito en voseo rioplatense. Ahora es neutro.",
          ],
        },
      ],
      en: [
        {
          title: "Fixed",
          items: [
            "Opening another playlist left the list scrolled to wherever you had left the last one. Every list now starts at its own top.",
            "Rows in a list came in with gaps between them for a few seconds: the entrance cascade had no ceiling, so on a 198-song playlist the last row waited almost six seconds to become visible. The cascade now stops at the first dozen.",
            'Opening a playlist showed rows from the previous one. A playlist can hold the same song twice, and with one key shared between two songs React left the old rows mounted: they went on painting the previous list underneath the new name and the new count. Four repeated songs in "Mi playlist n.º 4" were four extra rows on every list you opened afterwards.',
            "Hovering a playlist in the sidebar re-downloaded every page of it, over and over: the prefetch was written already stale, so the hook's five-minute freshness never applied. One long playlist downloaded six times in ten seconds.",
            "After an update, the next launch opened asking for a crash report that never happened. The updater hands the installer to Windows and the process is gone before the session can be closed properly, so the marker survives.",
            "A session that died within seconds no longer counts as a crash. What separates an abrupt kill from a crash is the only thing that does: how long it lived.",
            "The Spanish was written in Rioplatense voseo. It is neutral now.",
          ],
        },
      ],
    },
  },
  {
    version: "0.3.1",
    date: "2026-10-17",
    released: true,
    sections: {
      es: [
        {
          title: "Añadido",
          items: [
            "El feedback se puede escribir también desde la pantalla de inicio de sesión. A quien la app no le funciona ya no tiene que Signed in para contarlo: esa pantalla era, irónicamente, justo donde no había dónde escribir.",
            "Una pestaña de Personalización en Ajustes, con el primer ajuste propio: qué tan opacos son los menús. Se recuerda entre arranques, y una muestra al lado del deslizador deja ver el resultado mientras lo mueves.",
          ],
        },
        {
          title: "Corregido",
          items: [
            "Cada arranque mostraba la pantalla de inicio de sesión un instante antes de la app, aunque la sesión estuviera guardada. Ahora se espera en silencio y solo pregunta cuando de verdad no hay sesión.",
            "Enviar un reporte caía en una página de error de GitHub: la URL era demasiado larga. Ahora entra, y el recorte se lleva el final del log —que es donde está la falla— en vez de la cabecera.",
            "El botón de enviar estaba apagado y sin decir por qué cuando el mensaje estaba vacío. Un clic que no hace nada es indistinguible de un clic roto.",
            "La sesión se caía sola una hora después de entrar. Si Spotify respondía a una renovación con un solo token de acceso, Starless guardaba el token de refresco vacío encima del que sí servía; en el vencimiento siguiente ya no había con qué renovar y sólo quedaba volver a iniciar sesión.",
          ],
        },
        {
          title: "Cambiado",
          items: [
            "El formulario de feedback y el aviso de caída ya no se apilan sobre otro panel de vidrio, que DESIGN.md prohíbe: ahora llevan un velo plano detrás.",
            "La build compilada salía con el vidrio sin difuminado. El minificador de Tailwind se comía el `backdrop-filter` estándar y dejaba sólo el prefijo `-webkit-`, que WebView2 ignora: al 55% se leían las canciones de atrás a través del panel, mientras `bun run dev` se veía perfecto porque ahí el CSS no pasa por el minificador. Ahora el vidrio sale difuminado como corresponde, y qué tan opaco es lo eliges en Ajustes → Personalización.",
            "El ajuste de opacidad también alcanza a la cola y a los ajustes, no sólo a los menús flotantes.",
          ],
        },
      ],
      en: [
        {
          title: "Added",
          items: [
            "Feedback can be written from the sign-in screen too. Someone the app does not work for no longer has to sign in to say so — which was, unhelpfully, the one screen with nowhere to write it.",
            "A Customisation tab in Settings, with the app's first setting of its own: how opaque the menus are. It is remembered across restarts, and a swatch beside the slider shows the result while you drag.",
          ],
        },
        {
          title: "Fixed",
          items: [
            "Every launch flashed the sign-in screen for a moment before the app, even with a session already saved. It now waits quietly and only asks when there genuinely is no session.",
            "Sending a report landed on a GitHub error page: the URL was too long. It goes through now, and the excerpt keeps the end of the log — where the failure is — instead of the header.",
            "The send button was disabled with no explanation when the message was empty. A click that does nothing is indistinguishable from a broken one.",
            "The session used to die an hour after you signed in. When Spotify answered a refresh with a bare access token, Starless wrote an empty refresh token over the working one — so at the next expiry there was nothing left to renew with, and signing in again was the only way out.",
          ],
        },
        {
          title: "Changed",
          items: [
            "The feedback form and the crash prompt no longer stack on top of another glass panel, which DESIGN.md forbids: they sit on a flat veil instead.",
            "The packaged build shipped glass with a dead blur. Tailwind's minifier swallowed the standard `backdrop-filter` and left only the `-webkit-` prefix, which WebView2 ignores — so at 55% you could read the song titles straight through the settings panel, while `bun run dev` looked perfect because its CSS never goes through the minifier. The glass is properly frosted again, and how opaque it is is yours to set in Settings → Customisation.",
            "The opacity setting reaches the queue and the settings panel too, not only the floating menus.",
          ],
        },
      ],
    },
  },
  {
    version: "0.3.0",
    date: "2026-10-17",
    released: true,
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
            "Detección de caídas: si la app no se cerró bien, Starless lo nota y te ofrece enviar el reporte, con el log ya recortado y sin datos personales. No sale un solo byte de tu máquina hasta que lo mandas.",
            "Feedback dentro de la app, en Ajustes → Diagnóstico. El log va adjunto solo si lo pides.",
            "El volumen se recuerda entre arranques.",
            "Un ícono nuevo: una estrella que se apaga.",
            "La ventana ya no usa la barra de título del sistema. Minimizar, maximizar y cerrar viven a la derecha del buscador.",
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
            "La biblioteca se vaciaba sola alrededor de una hora después de iniciar sesión: el refresco del token corría en el hilo asíncrono, entraba en panic y se llevaba por delante todas las llamadas a la Web API sin dejar una línea en el log.",
            "Un cliente HTTP que fallaba al construirse quedaba cacheado como fallo, así que un mal arranque llenaba la biblioteca de vacío hasta reiniciar la app.",
            "Enviar un reporte congelaba la ventana mientras hacía la petición.",
          ],
        },
        {
          title: "Cambiado",
          items: [
            "Escribir ya no borra la pantalla principal. Enter es lo que decide.",
            "Una canción que no se puede reproducir se salta, hasta cinco seguidas antes de rendirse.",
            "Las consultas que Spotify responde con 503 se reintentan una vez: es su borde, no la petición.",
            "El botón de la cola vive solo en la barra de reproducción; también estaba arriba.",
            "Cerrar sesión se mudó de Biblioteca a Ajustes → Cuenta, y ahora funciona: el botón que estaba ahí no hacía nada.",
            "El selector de idioma salió de la barra superior y vive en Ajustes → General.",
            "El botón de inicio muestra una casa en vez de un disco.",
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
            "Crash detection: if the app did not close cleanly, Starless notices and offers to send the report, with the log already scrubbed and carrying nothing personal. Not one byte leaves your machine until you send it.",
            "Feedback inside the app, under Settings → Diagnostics. The log goes along only if you ask for it.",
            "The volume is remembered between launches.",
            "A new icon: a star going out.",
            "The window no longer uses the system title bar. Minimize, maximize and close live at the right of the search field.",
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
            "The library emptied itself about an hour after signing in: the token refresh ran on the async thread, panicked, and took every Web API call down with it without leaving a line in the log.",
            "An HTTP client that failed to build was cached as a failure, so one bad moment at launch left the library empty until the app was restarted.",
            "Sending a report froze the window while it made the request.",
          ],
        },
        {
          title: "Changed",
          items: [
            "Typing no longer wipes the main screen. Enter is what decides.",
            "A song that will not play is skipped, up to five in a row before giving up.",
            "Calls Spotify answers with 503 are retried once: that is their edge, not the request.",
            "The queue button lives in the player bar only; it used to be at the top as well.",
            "Sign out moved from Library to Settings → Account, and it works now: the button that was there did nothing.",
            "The language switch left the top bar and lives in Settings → General.",
            "The home button shows a house instead of a disc.",
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
  es: "Estas entradas se reconstruyeron a partir de las fechas de los archivos, no de un registro: Starless se construyó de una sola sentada y nunca tuvo control de versiones. Dicen con exactitud qué existía; qué versión lo introdujo es una inferencia, y está marcada como tal. Y 0.3.0 es el primer build que alguien pudo descargar: 0.1.0 y 0.2.0 nunca salieron de esta máquina.",
  en: "These entries were reconstructed from file timestamps, not from a record: Starless was built in one sitting and never had version control. They are exact about what existed; which version introduced it is an inference, marked as one. And 0.3.0 is the first build anyone could download: 0.1.0 and 0.2.0 never left this machine.",
};
