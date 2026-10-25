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
    version: "0.5.4",
    date: "2026-10-24",
    released: true,
    sections: {
      es: [
        {
          title: "Corregido",
          items: [
            "La app tardaba 5,5 segundos en mostrar la biblioteca. Los pedidos salían antes de que la sesión terminara de conectar, así que fallaban, y el frontend los reintentaba cuatro segundos después: la espera estaba en el reintento y no en la conexión. Ahora el backend espera a que la sesión esté lista y responde de una.",
            "El DJ se quedaba mudo un par de segundos antes de la frase que cierra un tramo. El audio se pedía por adelantado, pero sólo para las páginas siguientes: la primera se pedía en el momento de hablarla. Ahora la primera página también lo pide, y la misma frase nunca se pide dos veces.",
            "El log dice cuánto tarda cada lectura. «Cargar la biblioteca es lento» no es un error que nadie pueda arreglar; «la biblioteca tardó 1211 ms» sí.",
          ],
        },
        {
          title: "Textos",
          items: [
            "Los textos de la app ya no usan el voseo y son más cortos. «Prerelease de develop» no explica qué es develop: dice lo que hace.",
            "Las notas de cada versión se reescribieron en español neutro y más corto, en la app y en GitHub.",
          ],
        },
        {
          title: "Cambiado",
          items: [
            "La release lleva un solo instalador, y es el `.msi`. Hasta la 0.5.3 había dos —el `.exe` de NSIS y el `.msi`— y la página tenía cinco archivos para descargar. Ahora son tres: el instalador, su firma y el manifest. El nombre del instalador tampoco lleva el idioma encima: `Starless_0.5.4_x64.msi` y no `Starless_0.5.4_x64_en-US.msi`.",
            "Si instalaste con el `.exe`, instala el `.msi` una vez. El `.msi` instala para toda la máquina y el `.exe` lo hacía sólo para el usuario: Windows pide permiso de administrador, y quedan dos copias en la máquina hasta que desinstales la vieja. A partir de ahí las actualizaciones son del `.msi`.",
          ],
        },
      ],
      en: [
        {
          title: "Fixed",
          items: [
            "The app took 5.5 seconds to show the library. The requests went out before the session finished connecting, so they failed, and the frontend retried them four seconds later: the wait was in the retry, not in the connection. The backend now waits for the session to be ready and answers in one go.",
            "The DJ stayed silent for a couple of seconds before the line that closes a stretch. The audio was asked for in advance, but only for the pages that follow: the first page asked for it at the moment it was spoken. The first page asks for it in advance too now, and the same line is never asked for twice.",
            "The log says how long each read takes. 'Loading the library is slow' is not a bug anybody can fix; 'the library took 1211 ms' is.",
          ],
        },
        {
          title: "Copy",
          items: [
            "The app's copy no longer uses the voseo and is shorter. 'Develop prerelease' does not explain what develop is: it says what it does.",
            "The notes of each version were rewritten in neutral Spanish and shorter, in the app and on GitHub.",
          ],
        },
        {
          title: "Changed",
          items: [
            "The release ships one installer now, and it is the `.msi`. Up to 0.5.3 there were two —the NSIS `.exe` and the `.msi`— and the page had five files to download. There are three now: the installer, its signature and the manifest. The installer's name has no locale on it either: `Starless_0.5.4_x64.msi` and not `Starless_0.5.4_x64_en-US.msi`.",
            "If you installed with the `.exe`, install the `.msi` once. The `.msi` installs for the whole machine and the `.exe` installed for the user only: Windows asks for administrator rights, and two copies stay on the machine until you uninstall the old one. After that, the updates are the `.msi`'s.",
          ],
        },
      ],
    },
  },
  {
    version: "0.5.3",
    date: "2026-10-23",
    released: true,
    sections: {
      es: [
        {
          title: "Corregido",
          items: [
            "El botón de «Buscar prerelease» no encontraba nada y hacía parecer que GitHub estaba caído. Tres motivos: el manifest se bajaba desde el frontend, detrás de una redirección a otro host sin cabeceras CORS; la API de GitHub responde 403 sin `User-Agent` y la biblioteca HTTP no lo manda solo; y la lista de releases es un índice que va con retraso. Ahora el canal se resuelve entero en el backend —etiquetas, release y manifest—, sin CORS de por medio.",
            "Si GitHub limitó las consultas desde esa máquina, la fila lo dice. El límite es de sesenta consultas por hora y por dirección, y agotarlo se ve igual que una caída: un 403 sin explicación. Ahora la fila distingue los dos casos: uno se acaba y el otro no.",
            "La línea pública también es una puerta. Desde una prerelease, la release pública sólo se ofrecía si era más nueva, así que no había forma de volver a la línea estable. Ahora se ofrece igual —aunque sea más vieja— y la fila lo dice antes de hacerlo: «Volver a la 0.5.1». La pastilla de Ajustes y la alerta del arranque no la anuncian: un «0.5.1» mientras corres 0.5.3 es una vuelta atrás.",
          ],
        },
      ],
      en: [
        {
          title: "Fixed",
          items: [
            "The 'Check prerelease' button found nothing and made it look like GitHub was down. Three reasons: the webview fetched the manifest itself, behind a redirect to another host with no CORS headers; the GitHub API answers 403 without a `User-Agent`, and the HTTP library does not send it on its own; and the list of releases is an index that runs behind. The channel is now resolved in the backend —tags, release and manifest— with no CORS in the way.",
            "If GitHub ran out of queries for this machine, the row says so. The limit is sixty queries per hour per address, and running out of it looks exactly like an outage: a 403 with no explanation. The row now tells the two apart: one of them ends and the other does not.",
            "The public line is a door too. From a prerelease, the public release was only offered when it was newer, so there was no way back to the stable line. It is offered now either way —even when it is older— and the row says so before it does: 'Go back to 0.5.1'. The Settings badge and the launch alert do not announce it: a '0.5.1' while you run 0.5.3 is a way back.",
          ],
        },
      ],
    },
  },
  {
    version: "0.5.2",
    date: "2026-10-23",
    released: true,
    sections: {
      es: [
        {
          title: "Corregido",
          items: [
            "El botón de «Buscar prerelease» no encontraba la prerelease. La app preguntaba a la lista de releases de GitHub, y esa lista es un índice que va con retraso: la release existe desde que se publica, pero la lista que la apunta tarda unos minutos más. Con la 0.5.1 recién publicada, el botón decía «No hay prerelease» mientras GitHub mostraba una. Ahora el camino va por las etiquetas —que existen desde que se empuja el tag— y cada una se pregunta por su nombre.",
            "La prerelease se encontraba pero no se podía instalar. El frontend armaba el `Update` con el JSON del manifest, pero un `Update` del plugin es un handle a un recurso que vive en Rust: sin el `rid` que devuelve el backend no hay nada que descargar. Ahora es el backend el que apunta el manifest —con el mismo updater, la misma llave y la misma verificación de firma— y lo que vuelve es instalable.",
            "Una descarga que falla ahora lo dice. Antes la promesa se rechazaba sola: el botón no cambiaba y nada explicaba por qué. Ahora la fila dice que la descarga falló, que la copia instalada no cambió, y deja el botón para reintentar.",
          ],
        },
      ],
      en: [
        {
          title: "Fixed",
          items: [
            "The 'Check prerelease' button could not find the prerelease. The app asked GitHub for the list of releases, and that list is an index that runs behind: the release exists as soon as it is published, but the list pointing at it takes a few minutes longer. With 0.5.1 just published, the button said 'No prerelease' while GitHub showed one. The path now goes through the tags —which exist from the moment the tag is pushed— and each one is asked for by name.",
            "The prerelease was found but could not be installed. The frontend built the `Update` from the manifest's JSON, but an `Update` in the plugin is a handle to a resource that lives in Rust: without the `rid` the backend returns there is nothing to download. Now the backend points the manifest —with the same updater, the same key and the same signature check— and what comes back is installable.",
            "A download that fails now says so. Before, the promise rejected on its own: the button did not change and nothing explained why. Now the row says the download failed, that the installed copy did not change, and leaves the button there to try again.",
          ],
        },
      ],
    },
  },
  {
    version: "0.5.1",
    date: "2026-10-22",
    released: true,
    sections: {
      es: [
        {
          title: "Nuevo",
          items: [
            "La app ahora dice si es una pre-release. Junto a la versión en Ajustes aparece una pastilla «pre-release» cuando la build salió de `develop`; en una release no aparece nada. El ícono invertido ya lo decía, pero sólo para quien sabe qué significa: dos copias de la app en la misma máquina se veían iguales, y ahora se distinguen.",
          ],
        },
        {
          title: "Corregido",
          items: [
            "La app se abría con una cola que nadie había pedido. Al abrir Starless, el panel «A CONTINUACIÓN» traía las canciones que se veían en pantalla: ocho canciones bajo un encabezado de cola, antes de que sonara una sola. Ahora la cola no existe hasta que la creas: hasta que suena algo, el panel dice que no hay nada en cola.",
            "Agregar una canción a la cola convertía la pantalla entera en cola. Sin cola, la canción agregada era la cola: quedaban ocho canciones en el panel, siete de las cuales nunca pediste. Ahora, sin cola, la canción agregada es la cola —y queda una sola—; con cola, se agrega al final, como siempre.",
          ],
        },
      ],
      en: [
        {
          title: "New",
          items: [
            "The app now says whether it is a prerelease. Next to the version in Settings there is a 'pre-release' pill when the build came from `develop`; in a release there is nothing. The inverted icon already said so, but only to somebody who knew what it meant: two copies of the app on the same machine used to look the same, and now they do not.",
          ],
        },
        {
          title: "Fixed",
          items: [
            "The app used to open with a queue nobody had asked for. When you opened Starless, the 'Up next' panel carried the songs that were on screen: eight songs under a queue heading, before a single song had played. Now the queue does not exist until you make it: until something plays, the panel says there is nothing queued.",
            "Adding a song to the queue turned the whole screen into a queue. With no queue, the song you added was the queue: eight songs in the panel, seven of which you never asked for. Now, with no queue, the song you added is the queue —and there is just the one—; with a queue, it goes to the end, as always.",
          ],
        },
      ],
    },
  },
  {
    version: "0.5.0",
    date: "2026-10-22",
    released: true,
    sections: {
      es: [
        {
          title: "Nuevo",
          items: [
            "El DJ de Spotify ahora suena, y se escucha. La tarjeta de la repisa de Inicio —la que decía «0 canciones»— no es una playlist: su contenido hay que pedirlo aparte. Al hacer clic arranca la primera canción y el DJ sigue eligiendo: la cola se llena sola con las páginas siguientes de su sesión, así que no se acaba como una lista y cada vez trae material nuevo. La voz del DJ también se oye: la pide el servicio que la fabrica, sale por el mismo auricular que la música y queda escrita arriba de la cola. También suena desde la barra lateral, antes una pantalla vacía. Y la tarjeta se ve como la de Spotify, con su fondo azul y su medusa, en vez de un cuadro vacío.",
            "El DJ habla antes de que empiece la música. Cuando lo tocas, Starless corta lo que estaba sonando, deja que el DJ diga su frase —con su ícono abajo a la izquierda, en la barra— y recién después arranca la canción. La voz sale por el mismo auricular que la música y con el mismo volumen: si lo bajas, baja el del DJ; si lo silencias, se calla. Si pones una canción mientras habla, la frase se corta: estaba dicha para otra. Con el DJ sonando la cola no muestra qué viene después: el DJ sigue eligiendo, así que lo que viene no está decidido, y la frase es una sorpresa.",
            "El DJ también tiene su botón en la barra, como en el cliente oficial. Aparece con la sesión del DJ y desaparece con ella. Es el mismo camino que la card de la repisa, así que el DJ no arranca de cero: sigue su propia sesión y pasa a la tanda siguiente. Es la marca del DJ —el anillo de la medusa— en un solo color, porque la barra es cromo y el cromo va en tinta.",
            "La barra se queda callada cuando no suena nada. Decía «Nada sonando» y «Elige una canción de tu biblioteca»: era un rótulo sobre una ausencia, y ocupaba el lugar donde va la portada. Ahora, cuando pones una canción, emerge desde abajo con la animación de siempre: no aparece en la barra, sube desde el borde.",
            "El DJ vuelve a hablar en cada tramo. La frase va pegada a su canción, no a la tanda: la de apertura abre el tramo con la primera, la de cierre lo cierra con la última, y las dos se dicen antes de que suene esa canción. Antes Starless la pedía una sola vez, cuando le devolvía la tanda, así que después de la primera canción el DJ se callaba para siempre: la frase siguiente aparecía escrita arriba de la cola y nadie la decía. Ahora presenta cada tramo en el momento justo —la canción que suena nunca se corta para hablar, y la que viene se anuncia antes de arrancar— y el botón de reproducir y el de siguiente cortan la frase y dejan sonar la canción que el DJ eligió: es la forma de saltearle la voz sin perder lo que te recomendó.",
            "El apartado «Reproducido recientemente» de la cola se fue por ahora. El backend todavía no sabe qué se escuchó antes, y un encabezado sobre una lista vacía es una promesa que la app no puede cumplir. Cuando haya algo que contar, vuelve.",
            "La pantalla de playlists. Abres una de tus listas y la ves como en Spotify: el mosaico de portadas, el nombre, quién la armó, cuántas canciones tiene y cuánto dura, los botones de reproducir y de aleatorio —el de aleatorio sólo enciende el modo, no empieza a sonar—, y la tabla con número, título, álbum, la fecha en que la agregaste y la duración. Puedes filtrarla y ordenarla, el artista y el álbum llevan a su ficha, y cada canción tiene su menú. La lista que ves es la que suena: filtrar o reordenar cambia lo que viene después.",
            "Desde el menú de cada canción se puede agregar a una playlist. El submenú se abre al lado, con buscador y con sólo tus propias playlists —las de otros no se pueden escribir—, y al elegir una la app te confirma que la canción entró. También se puede crear una playlist nueva desde ahí, con la canción ya adentro. Se escribe por la misma sesión con la que Starless reproduce: no hay ningún permiso nuevo ni una segunda pantalla de autorización.",
            "La barra de reproducción ya no está ahí desde que abres la app. Antes aparecía con un fundido al abrir la ventana, y lo que aparecía era un rectángulo de vidrio vacío: un play apagado, dos ceros y nada a la izquierda. Ahora la barra llega con la música —al poner una canción, o cuando el DJ empieza a hablar— y antes de eso la ventana es sólo la biblioteca. Y la ventana le hace lugar: la biblioteca, el riel y la cola bajan hasta el borde mientras no hay barra, y suben cuando la música llega.",
          ],
        },
        {
          title: "Corregido",
          items: [
            "Cuando salteabas, se oía un pedazo de la canción anterior antes de que el DJ hablara. La música se cortaba recién cuando el audio de la frase ya estaba listo, un par de segundos después del clic: la app seguía con la canción que ya habías salteado. Ahora la música se calla en el momento, y el audio de la frase se pide por adelantado —la página siguiente llega cinco canciones antes de que la cola se vacíe—, así que el DJ toma la posta sin huecos.",
            "Starless saltaba para atrás, y a veces arrancaban dos canciones a la vez. El «siguiente» se decidía buscando por su id la canción que estaba sonando, y el DJ ofrece la misma canción dos veces: la app encontraba la primera copia —la que ya había sonado— y de ahí el salto era a una canción del pasado. Ahora la app recuerda en qué lugar de la cola está, y cada pedido de reproducción lleva un número: si mientras tanto pediste otra cosa, la respuesta que llega tarde no pone ninguna canción encima de la que ya está sonando. En el log se veía: dos canciones arrancando con 19 milisegundos de diferencia.",
            "Con el DJ hablando, el volumen y el transporte quedaban bloqueados. La barra se apagaba cuando no había ninguna canción, y durante los diez segundos que el DJ habla todavía no la hay: el control de volumen quedaba en gris y no se podía tocar, y el botón de siguiente tampoco. Ahora la barra no está apagada: la música viene, y el volumen es justamente lo que se quiere bajar —la voz es lo más fuerte de la sala—. Y el botón de reproducir corta la frase y deja sonar la canción que el DJ eligió.",
            "El DJ repetía las mismas canciones. No era cosa de Spotify: Starless le preguntaba al servicio por la línea de tiempo desde el principio, y esa línea siempre empieza igual. Ahora le pregunta por el tramo de ahora —la misma puerta que usa el cliente de Spotify—, así que cada vez que lo tocas arranca con canciones distintas y la cola sigue llenándose con material nuevo. Medido: dos pedidos seguidos con cinco segundos de diferencia devuelven canciones completamente distintas; antes devolvían las mismas.",
            "Se cayó la conexión con Spotify y Starless se la levanta. Antes saltaba canción tras canción diciendo que esa no se pudo reproducir —la pista estaba bien, lo que faltaba era la conexión— y terminabas viendo seis errores seguidos. Ahora la app avisa que está reconectando, arma una sesión nueva con las mismas credenciales y vuelve a poner la canción que había fallado. Si de verdad no se puede, lo dice, y ése es el único caso en que hay que cerrar y abrir la app.",
            "Starless se quedaba mudo y no volvía. Cuando el dispositivo de salida dejaba de tomar el audio, el hilo que reproduce se quedaba esperando para siempre —no estaba muerto: estaba esperando— y la app seguía mandándole cosas que nadie leía. La ventana se veía perfecta, la barra marcaba la posición clavada y no sonaba nada; cada canción que elegías se quedaba esperando en una fila. Ahora la app lo nota —pregunta si la posición sigue avanzando—, deja el reproductor viejo atrás sin esperar a que vuelva, abre otro y vuelve a poner la canción.",
            "Starless perdía la música y no la recuperaba. Si la conexión con Spotify se caía con la cola vacía, la app ni se enteraba: la reconexión está atada a una canción que falla, y con la cola vacía no falla ninguna. La conexión se quedaba muerta —y el DJ, que habla por su propio camino, seguía hablando—. Ahora un clic arma la sesión nueva y vuelve a poner la canción que pediste: es el mismo pedido que hace una falla, y el único que puedes hacer. Y el botón de reproducir dejó de hacerse el vivo: antes le pedía al reproductor que siguiera con una pista que ya no tenía y recibía silencio, con la barra diciendo «sonando»; ahora carga la pista de nuevo.",
          ],
        },
      ],
      en: [
        {
          title: "New",
          items: [
            "Spotify's DJ now plays, and you can hear it. The card on the home shelf —the one that said '0 songs'— is not a playlist: its content has to be asked for. Clicking it starts the first song, and the DJ keeps choosing: the queue fills itself with the next pages of its session, so it does not end like a list and every time brings new material. The DJ's voice is audible too: it is asked for from the service that makes it, comes out of the same headset as the music and stays written above the queue. It plays from the sidebar too, which used to show an empty screen. And the card looks like Spotify's, with its blue field and its jellyfish, instead of an empty square.",
            "The DJ speaks before the music starts. When you touch it, Starless cuts whatever was playing, lets the DJ say its line —with its icon at the bottom left, on the bar— and only then starts the song. The voice comes out of the same headset as the music and at the same volume: turn it down and the DJ turns down with it, mute it and it goes quiet. If you pick a song while it is talking, the line gets cut: it was meant for another one. With the DJ playing the queue does not show what comes next: the DJ keeps choosing, so what comes is not decided yet, and the line is a surprise.",
            "The DJ also has its own button on the bar, like in the official client. It shows up with the DJ's session and goes away with it. It is the same path as the card on the shelf, so the DJ does not start over: it follows its own session and moves on to the next set. It is the DJ's mark —the jellyfish's ring— in a single colour, because the bar is chrome and chrome stays in ink.",
            "The bar keeps quiet when nothing is playing. It used to say 'Nothing playing' and 'Pick a song from your library': a caption over an absence, taking the room the cover goes in. Now, when you put a song on, it comes up from below with the usual motion: it does not appear on the bar, it rises from the edge.",
            "The DJ talks again on every stretch. The line hangs on its song, not on the set: the opening one opens the stretch with the first song and the closing one closes it with the last, and both are said before that song plays. Starless used to ask for it once, when the set came back, so after the first song the DJ went quiet for good: the next line showed up written above the queue and nobody said it. Now the DJ introduces every stretch at the right moment —the song that is playing is never cut to make room for talking, and the one that comes is announced before it starts— and the play button and the next one cut the line off and let the song the DJ picked play: that is how you skip its voice without losing what it recommended.",
            "The queue's 'Recently played' section is gone for now. The backend still cannot say what was played before, and a heading over an empty list is a promise the app cannot keep. It comes back when there is something to tell.",
            "The playlist screen. Open one of your lists and it looks like Spotify: the cover mosaic, the name, who made it, how many songs it has and how long it runs, the play and shuffle buttons —shuffle only turns the mode on, it does not start anything— and the table with number, title, album, the date you added it and its length. You can filter it and reorder it, the artist and album lead to their own page, and every song has its own menu. The list you see is the list that plays: filtering or reordering changes what comes next.",
            "Every song's menu can add it to a playlist. The submenu opens beside it, with a search box and with your own playlists only —other people's cannot be written to— and the app tells you when the song is in. You can also create a new playlist from there, with the song already in it. It is written through the session Starless already plays with: no new permission and no second screen asking for anything.",
            "The player bar is no longer there from the moment you open the app. It used to fade in as the window opened, and what faded in was an empty glass rectangle: a dead play button, two zeros and nothing on the left. Now the bar arrives with the music —when you put a song on, or when the DJ starts talking— and until then the window is just the library. And the window makes room for it: the library, the rail and the queue go down to the edge while there is no bar, and they come back up when the music arrives.",
          ],
        },
        {
          title: "Fixed",
          items: [
            "When you skipped, you heard a piece of the previous song before the DJ spoke. The music was only cut once the phrase's audio was ready, a couple of seconds after the click: the app stayed on the song you had already skipped. Now the music stops right away, and the phrase's audio is asked for in advance —the next page arrives five songs before the queue empties— so the DJ takes the turn without gaps.",
            "Starless used to jump backwards, and sometimes two songs would start at once. The next one was decided by looking up the playing song by its id, and the DJ offers the same song twice: the app found the first copy —the one that had already played— and from there the jump was to a song from the past. The app now remembers where in the queue it is, and every playback request carries a number: if you asked for something else in the meantime, the late answer does not put a song on top of the one that is already playing. The log showed it: two songs starting nineteen milliseconds apart.",
            "With the DJ talking, the volume and the transport were locked. The bar went dark when there was no song, and during the DJ's ten seconds of talking there is still none: the volume control was greyed out and could not be touched, and neither could the next button. Now the bar is not dark: the music is on its way, and the volume is exactly what you want to turn down —the voice is the loudest thing in the room—. And the play button cuts the line off and lets the song the DJ picked play.",
            "The DJ used to play the same songs. It was not Spotify's doing: Starless was asking the service for the timeline from the beginning, and that timeline always starts the same way. It now asks for the current stretch —the same door Spotify's own client uses— so every time you touch it starts with different songs and the queue keeps filling with new material. Measured: two requests five seconds apart now return completely different songs; before they returned the same ones.",
            "When the connection to Spotify drops, Starless picks it back up. It used to skip from song to song saying that one could not be played —the song was fine, the connection was gone— and you ended up reading six errors in a row. Now the app says it is reconnecting, builds a new session with the same credentials, and puts the song that failed back on. If it really cannot get back, it says so, and that is the one case where the app has to be closed and reopened.",
            "Starless used to go mute and stay mute. When the output device stopped taking the audio, the thread that plays waited for it forever —it was not dead: it was waiting— and the app kept handing it commands nobody was reading. The window looked perfect, the bar showed the position frozen, and nothing played; every song you picked sat in a queue. The app notices now —it asks whether the position is still moving— leaves the old player behind without waiting for it to come back, opens another one, and puts the song back on.",
            "Starless used to lose the music and not get it back. If the connection to Spotify dropped while there was nothing in the queue, the app did not even notice: the reconnection is tied to a song that fails, and with an empty queue none fails. The connection stayed dead —and the DJ, which talks through its own path, kept talking—. Now a click builds the new session and puts the song you asked for back on: it is the same request a failure makes, and the only one you can make. And the play button stopped pretending: it used to ask the player to carry on with a track it no longer had and got silence in return, with the bar saying 'playing'; now it loads the track again.",
          ],
        },
      ],
    },
  },
  {
    version: "0.4.0",
    date: "2026-10-18",
    // La 0.4.0 salió el 18 de octubre. **Lo que hay en esta entrada es lo que
    // traía ese build y nada más**: lo que se hizo después de su lanzamiento
    // está en la 0.5.0, porque un changelog que cuenta cosas que no estaban en
    // la versión que describe es una lista de deseos, no un changelog.
    released: true,
    sections: {
      es: [
        {
          title: "Nuevo",
          items: [
            "Cuando hay una versión nueva, Starless lo dice: una alerta flotante que aparece una vez y se desvanece sola, el botón de Ajustes queda marcado en verde, y dentro de Ajustes el botón de actualizar se pone en verde con la versión disponible. Nada se descarga ni se instala solo — instalar sigue siendo un clic tuyo, en Ajustes, porque Starless está sonando.",
            "Un fallo al comprobar no marca nada. Si GitHub no se puede alcanzar, eso dice algo de la red y nada de tu instalación, así que el botón se queda como estaba.",
            "Las letras. Un botón en la barra de abajo, al lado de la cola. Siguen la posición del audio línea por línea cuando el proveedor manda los tiempos, y avisan que no pueden seguirlas cuando no los manda, en vez de quedarse clavadas en la primera línea toda la canción. Cada línea con tiempo es un botón: haz clic y la canción salta a ese minuto. Vienen por la sesión que ya reproducía: ningún permiso nuevo, ningún client id propio. Este apartado es para el gordito `kaliuchisfangirl`.",
          ],
        },
        {
          title: "Corregido",
          items: [
            "Para casi todo el mundo, la biblioteca salía vacía y no decía por qué. Spotify dejó de entregar datos a las apps nuevas salvo a cinco cuentas en una lista, así que las demás veían un cliente firmado con una biblioteca que no aparecía. Starless ahora lee tu biblioteca, tus playlists, tus canciones guardadas y la búsqueda por la misma sesión con la que reproduce: sin lista, sin revisión y sin una dependencia que se caiga sola. Y si algo falla al leerla, la app lo dice en vez de mostrar un vacío.",
            "Dos Starless abiertas a la vez ya no pueden pasar. Antes competían por las claves de audio y la que perdía le pasaba sus bytes a la otra: seis canciones quemadas en catorce segundos, todas reportadas como canciones que Spotify no entregaba. Ahora la segunda copia sube la ventana de la que ya está y se cierra.",
            "Se cayó la conexión con Spotify y Starless lo dice. Antes saltaba canción tras canción diciendo que esa no se pudo reproducir —la pista estaba bien, lo que faltaba era la conexión—, y como la sesión no vuelve sola terminabas viendo seis errores seguidos. Ahora dice qué pasó y para; hay que cerrar y abrir la app.",
            "Volvieron las portadas originales de tus playlists. Spotify no las manda cuando lees la biblioteca, pero las guarda en otro lado, y Starless ahora va a buscarlas: son las imágenes de Spotify, no un mosaico que dibuja la app.",
            "El botón de Inicio va al inicio de verdad. Antes sólo movía el resaltado y dejaba la playlist abierta en pantalla.",
            "Hay una pantalla principal. Antes «Inicio» era tu lista de canciones que te gustan con otro nombre: una lista de cosas que ya elegiste, que es mala forma de decidir qué escuchar después. Ahora es una repisa con tus playlists y, aparte, lo que Spotify te fabricó —hoy, DJ—. No hay fila de filtros ni recomendaciones: salen del motor de recomendaciones de Spotify, que estaba detrás de la Web API que ya no funciona. Se probaron catorce URIs contra la sesión que sí funciona y ninguna respondió.",
            "Arreglada la cola después de buscar. Elegir una canción del desplegable, o hacer clic dentro de la playlist que ya estaba abierta, dejaban la cola de la lista anterior —buscabas una canción y después seguían las que te gustan—. Ahora cada lista define lo que viene después.",
            "El botón de aleatorio ahora se ve. Antes sorteaba una canción distinta en cada salto pero el panel de cola seguía mostrando el mismo orden de siempre: lo que estaba al lado contradecía lo que sonaba. Ahora al prenderlo se decide un orden nuevo, se ve en el panel y se mantiene; apagarlo no lo deshace.",
          ],
        },
        {
          title: "Cambiado",
          items: [
            "Entrar es una sola aprobación. Antes Starless pedía permiso dos veces —una para reproducir y otra para leer tu biblioteca— y la segunda era justamente la que empezaba a devolver errores. Ahora hay una sola pantalla porque sólo hay una identidad.",
            "La pantalla de resultados es una lista de canciones en orden alfabético. El buscador siempre mostró canciones; lo que se fue son las pestañas de álbumes, artistas y playlists, que no tenían una ruta detrás.",
            "Reproducir desde la pantalla de inicio arma una cola nueva cada vez. Una playlist es una afirmación sobre el orden, así que abrirla y reproducir respeta ese orden; desde cualquier otro lado no. Antes salía siempre la misma cola y terminabas escuchando las mismas canciones seguidas.",
          ],
        },
        {
          title: "Se va",
          items: [
            "Las pestañas de álbumes, artistas y playlists en los resultados, la discografía del artista, y agregar canciones a una playlist o crear una. No hay una versión de esas que funcione a medias: la ruta que las alimentaba ya no existe y no hay otra que devuelva la verdad. Es preferible que el botón no esté a que esté y no haga nada.",
          ],
        },
      ],
      en: [
        {
          title: "New",
          items: [
            "When there is a newer version, Starless says so: a floating alert that appears once and fades on its own, the Settings button is marked in green, and inside Settings the update button turns green with the version available. Nothing downloads and nothing installs by itself — installing is still your click, in Settings, because Starless is playing music.",
            "A failed check marks nothing. If GitHub cannot be reached, that says something about the network and nothing about your installation, so the button stays as it was.",
            "Lyrics. A button in the player bar, next to the queue. They follow the audio line by line when the provider sends the timings, and say so when it does not, instead of sitting on the first line all song. Every line with a time is a button: click it and the song jumps to that minute. It comes through the session that was already playing: no new permission, no client id of our own. This section is for the chubby one, `kaliuchisfangirl`.",
          ],
        },
        {
          title: "Fixed",
          items: [
            "For almost everyone, the library came up empty and said nothing about why. Spotify stopped handing data to new apps except for five accounts on an allowlist, so everyone else was looking at a signed-in client with no library in it. Starless now reads your library, your playlists, your saved songs and your search through the same session it plays music with: no allowlist, no review, and no dependency that can fall over on its own. And if reading it does fail, the app says so instead of showing an empty shelf.",
            "Two copies of Starless can no longer run at once. They used to compete for the audio keys and the loser handed its bytes to the winner: six songs burned through in fourteen seconds, every one of them reported as a song Spotify would not deliver. The second copy now brings the running window forward and closes.",
            "When the connection to Spotify drops, Starless says so. It used to skip from song to song saying that one could not be played — the song was fine, the connection was gone — and since the session never comes back on its own you ended up reading six errors in a row. Now it says what happened and stops; close and reopen the app.",
            "Your playlist covers are back. Spotify does not send them when you read the library, but it does keep them somewhere else, and Starless now goes and gets them: these are Spotify's own images, not a mosaic the app draws itself.",
            "The Home button actually goes home. It used to move the highlight and leave the playlist open on screen.",
            "There is a home screen now. 'Home' used to be your saved songs wearing a different name: a list of things you had already chosen, which is a poor place to decide what to listen to next. It is a shelf now — your playlists, and separately what Spotify made for you, which today means DJ. There is no filter row and no recommendations: they come out of Spotify's recommendation engine, which sat behind the Web API that no longer works. Fourteen URIs were tried against the session that does work, without a single answer.",
            "The queue after a search is fixed. Picking a song from the dropdown, or clicking inside the playlist already open, left the queue on the previous list — you searched for a song and your liked songs came next. Each list now defines what follows it.",
            "The shuffle button now shows. It used to draw a different song at every jump while the queue panel kept listing the same order, so what was on screen contradicted what you were hearing. Turning it on now decides a new order, the panel shows it, and it stays. Turning it off does not undo it.",
          ],
        },
        {
          title: "Changed",
          items: [
            "Signing in is one approval. Starless used to ask twice —once to play, once to read your library— and the second one was the one that started failing. There is one screen now because there is only one identity.",
            "The results screen is a list of songs in alphabetical order. The search box always showed songs; what went away are the album, artist and playlist tabs, which had nothing behind them.",
            "Playing from the home screen now builds a fresh queue every time. A playlist is a statement about order, so opening one and playing from it keeps that order; anywhere else does not. It used to be the same queue every time and the same songs after every song.",
          ],
        },
        {
          title: "Removed",
          items: [
            "The album, artist and playlist tabs in search results, the artist discography, and adding songs to a playlist or creating one. There is no half-working version of those: the route that fed them no longer exists and nothing else returns the truth. A button that does nothing is worse than no button.",
          ],
        },
      ],
    },
  },
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
            "Abrir una playlist mostraba filas de la anterior. Una playlist puede tener la misma canción dos veces, y con esa fila compartida entre dos canciones React dejaba las filas viejas montadas, pintando la lista previa debajo del nombre y el conteo de la nueva. Cuatro canciones repetidas en «Mi playlist n.º 4» eran cuatro filas de más en cada lista que abrieras después.",
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
            'Opening a playlist showed rows from the previous one. A playlist can hold the same song twice, and with one key shared between two songs React left the old rows mounted, painting the previous list underneath the new name and the new count. Four repeated songs in "Mi playlist n.º 4" were four extra rows on every list you opened afterwards.',
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
            "El feedback se puede escribir también desde la pantalla de inicio de sesión. A quien la app no le funciona ya no tiene que iniciar sesión para contarlo: esa pantalla era, irónicamente, justo donde no había dónde escribir.",
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
            "La build compilada salía con el vidrio sin difuminado. El minificador de Tailwind se comía el `backdrop-filter` estándar y dejaba sólo el prefijo `-webkit-`, que WebView2 ignora: al 55% se leían las canciones de atrás a través del panel, mientras `bun run dev` se veía perfecto porque ahí el CSS no pasa por el minificador. Ahora el vidrio sale difuminado, y qué tan opaco es lo eliges en Ajustes → Personalización.",
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
            "The packaged build shipped glass with a dead blur. Tailwind's minifier swallowed the standard `backdrop-filter` and left only the `-webkit-` prefix, which WebView2 ignores — so at 55% you could read the song titles straight through the settings panel, while `bun run dev` looked perfect because its CSS never goes through the minifier. The glass is frosted again, and how opaque it is is yours to set in Settings → Customisation.",
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
            "Registro a archivo local, con rotación, y autodiagnóstico con `STARLESS_DIAGNOSTIC=1`.",
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
            "Las playlists devolvían 403 tras la migración de Spotify de febrero de 2026. El endpoint se llama `/items` ahora, no `/tracks`.",
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
            "A local log file with rotation, plus a self-test behind `STARLESS_DIAGNOSTIC=1`.",
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
            "Playlists answered 403 after Spotify's February 2026 migration. The endpoint is `/items` now, not `/tracks`.",
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
            "Registro a archivo local y autodiagnóstico con `STARLESS_DIAGNOSTIC=1`.",
          ],
        },
        {
          title: "Corregido",
          items: [
            "No se podía reproducir nada: Spotify rechaza el client token de las apps nuevas, así que la sesión de reproducción y la Web API usan identidades distintas.",
            "Las playlists devolvían 403 tras la migración de Spotify de febrero de 2026. El endpoint se llama `/items` ahora, no `/tracks`.",
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
            "A local log file and a self-test behind `STARLESS_DIAGNOSTIC=1`.",
          ],
        },
        {
          title: "Fixed",
          items: [
            "Nothing could play: Spotify refuses the client token of new apps, so the playback session and the Web API use separate identities.",
            "Playlists answered 403 after Spotify's February 2026 migration. The endpoint is `/items` now, not `/tracks`.",
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
