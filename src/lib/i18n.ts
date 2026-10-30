/**
 * Bilingual copy.
 *
 * PRODUCT.md rule 5: Spanish and English ship together, and both are written so
 * they read naturally rather than one being a translation of the other. Keep
 * both here; never inline a user-visible string in a component.
 */

export type Lang = "es" | "en";

export const strings = {
  es: {
    searchPlaceholder: "Buscar canciones",
    clearSearch: "Limpiar búsqueda",
    searchResultsTitle: "Resultados",
    searchResultsFor: "Para «{query}»",
    searching: "Buscando…",
    searchHint: "Escribe al menos dos letras",
    searchNoResults: "Sin resultados para esta búsqueda.",
    searchSeeAllResults: "Ver todos los resultados",
    searchNoMatches: "Ninguna canción coincide con esto.",

    searchBack: "Volver a los resultados",

    // Artist profile
    artistKind: "Artista",
    artistSongs: "Canciones",
    artistLoadFailed: "No se pudo cargar el perfil del artista.",
    // La ficha del artista. El encabezado no dice "Populares" ni "Discografía"
    // porque ninguna de las dos cosas se puede calcular acá — el listado es lo
    // que esta app encuentra para ese nombre, y se dice eso.
    artistSongsFound: "Lo que Starless encuentra",
    artistSongsNone: "No se encontraron canciones de este artista.",
    // El álbum, con el mismo trato que el artista: se busca por nombre y se
    // filtra por id, así que el encabezado no puede prometer un catálogo entero.
    albumKind: "Álbum",
    albumSongsFound: "Lo que Starless encuentra",
    albumSongsNone: "No se encontraron canciones de este álbum.",
    back: "Volver",
    columnAlbum: "Álbum",
    navHome: "Inicio",
    navLibrary: "Tu biblioteca",
    collapseLibrary: "Contraer la biblioteca",
    expandLibrary: "Expandir la biblioteca",
    navSettings: "Ajustes",

    libraryTitle: "Tu biblioteca",
    likedSongs: "Canciones que te gustan",
    yourPlaylists: "Tus playlists",
    madeForYou: "Hecho para ti",
    // El DJ de la cuenta. Su card no muestra cuántas canciones tiene —no se
    // sabe hasta que se pide el mix— sino lo que es: alguien que elige.
    djSubtitle: "Elige la música por ti",
    djPlay: "Reproducir",
    djUnavailable: "No se pudo leer el DJ",
    // El DJ hablando, en la barra. El nombre y la frase los manda el
    // servicio; estos dos son lo que se pone cuando no vinieron.
    djSpeaker: "DJ",
    djSpeaking: "Hablando",
    // El botón de la barra: el DJ elige otra tanda.
    djNext: "Pedirle al DJ otra tanda",
    // Con el DJ hablando: el botón que corta la frase y deja sonar la
    // canción que el DJ eligió.
    djSkipVoice: "Saltar la voz del DJ y escuchar la canción",
    librarySort: "Ordenar",
    sortNameAsc: "Nombre, de A a Z",
    sortNameDesc: "Nombre, de Z a A",
    sortCreator: "Por creador",
    sortTracks: "Por cantidad de canciones",
    viewGrid: "Cuadrícula",
    viewList: "Lista",
    newPlaylistName: "Nombre",
    newPlaylistCreate: "Crear",
    newPlaylistCancel: "Cancelar",
    newPlaylistBusy: "Creando…",
    newPlaylistFailedCreate: "No se pudo crear la playlist",
    newPlaylistFailedAttach: "La playlist se creó pero no apareció en la biblioteca",
    newPlaylistFailedAdd: "La playlist se creó, pero la canción no entró",
    newPlaylistDone: "Playlist creada",
    homeTitle: "Inicio",
    openPlaylist: "Abrir",
    lyricsTitle: "Letra",
    showLyrics: "Ver la letra",
    closeLyrics: "Volver",
    noLyrics: "Esta canción no tiene letra.",
    lyricsNotSynced: "Esta letra viene sin sincronizar, así que no se puede seguir sola.",
    lyricsPaused: "Reproduce la canción para que la letra se mueva.",
    jumpToLine: "Ir a este momento",
    playlists: "playlists",
    planPremium: "Premium",
    planFree: "Sin Premium no hay audio",
    loading: "Cargando…",
    emptyList: "Nada por aquí todavía",
    playlistEmpty: "Esta playlist todavía no tiene canciones.",
    likedEmpty: "Las canciones que marques con el corazón aparecen aquí.",
    // La playlist, dibujada como la dibuja el cliente de escritorio: el tipo de
    // lista arriba y el orden y el filtro al lado de las canciones.
    playlistCollaborative: "Playlist colaborativa",
    playlistPrivate: "Playlist privada",
    playlistSearch: "Buscar en esta playlist",
    playlistNoMatches: "Ninguna canción de esta playlist coincide con la búsqueda.",
    playlistOrder: "Orden de la lista",
    orderCustom: "Orden personalizado",
    orderTitle: "Título",
    orderAdded: "Agregado recientemente",
    orderArtist: "Artista",
    orderAlbum: "Álbum",
    sortBy: "Ordenar por",
    sortAscending: "ascendente",
    sortDescending: "descendente",
    viewAs: "Ver como",
    viewCompact: "Compacta",
    playAll: "Reproducir todo",
    // El menú de los tres puntos de una canción. Tres filas y las tres hacen
    // algo: las que no podrían, se leen como averiadas.
    trackMenu: "Opciones de la canción",
    trackMenuFor: "Opciones de {name}",
    goToArtist: "Ir al artista {name}",
    goToAlbum: "Ir al álbum {name}",
    addToQueue: "Agregar a la cola",
    addToPlaylist: "Agregar a la playlist",
    findPlaylist: "Buscar una playlist",
    addedToPlaylist: "Agregada a «{name}»",
    noPlaylistsYet: "Todavía no tienes ninguna playlist.",
    noPlaylistMatches: "Ninguna playlist coincide con la búsqueda.",
    copyLink: "Copiar enlace",
    copyFailed: "No se pudo copiar",
    // El menú de los tres puntos de una playlist. Tres filas y las tres
    // hacen algo: las que no podrían, se leen como averiadas.
    playlistMenu: "Opciones de la playlist",
    playlistMenuFor: "Opciones de «{name}»",
    playlistQueued: "{count} canciones en la cola",
    // El diálogo de los detalles: la portada, el nombre y la descripción.
    playlistDetails: "Editar los detalles",
    playlistDetailsName: "Nombre",
    playlistDetailsDescription: "Agregá una descripción opcional",
    playlistDetailsSave: "Guardar",
    playlistDetailsCancel: "Cancelar",
    playlistDetailsSaving: "Guardando…",
    playlistDetailsFailed: "No se pudieron guardar los detalles.",
    playlistDetailsTimeout: "El guardado no respondió a tiempo. Vuelve a intentarlo.",
    playlistVisibilityFailed:
      "Se guardaron los detalles, pero la playlist no cambió de visibilidad.",
    playlistMakePrivate: "Hacerla privada",
    playlistChoosePhoto: "Elegir una foto",
    playlistRestoreCover: "Volver a la portada de Spotify",
    playlistUploadFailed: "No se pudo subir la imagen.",
    playlistNotReadable:
      "Esta playlist la creó otra persona. Spotify solo deja leer las que te pertenecen o en las que colaboras.",
    librarySubtitle: "Tu música, tal cual la guardaste",
    songs: "canciones",

    nowPlaying: "Reproduciendo ahora",
    failed: "No se pudo cargar",

    columnTitle: "Título",
    columnStatus: "Estado",
    columnTime: "Duración",
    columnAdded: "Fecha de adición",

    play: "Reproducir",
    pause: "Pausar",
    previous: "Anterior",
    next: "Siguiente",
    shuffle: "Aleatorio",
    shuffleOn: "Aleatorio activado",
    shuffleOff: "Aleatorio desactivado",
    repeat: "Repetir",
    repeatAll: "Repetir toda la lista",
    repeatOne: "Repetir esta canción",
    volume: "Volumen",
    mute: "Silenciar",
    unmute: "Activar el sonido",
    position: "Posición",

    playbackErrorTitle: "No se pudo reproducir",
    loadingPlayback: "Cargando…",

    language: "Idioma",
    premiumRequired: "Requiere Spotify Premium",

    // Auth
    authKicker: "Cliente de escritorio",
    authTitle: "Tu música, en tu escritorio",
    authBody:
      "Conéctate con tu cuenta de Spotify. Starless no ve tu contraseña y no envía telemetría.",
    authConnect: "Conectar con Spotify",
    authReport: "¿Algo no anda? Cuéntanos qué pasó.",
    feedbackEmpty: "Cuéntanos qué pasó, o adjunta el log para que el reporte sirva de algo.",
    authWaiting: "Termina la autorización en el navegador…",
    authConnecting: "Conectando con Spotify…",
    authTimeout: "Spotify no respondió. Probá otra vez.",
    authPremium:
      "Se necesita Premium. Sin Premium, Spotify no entrega audio aunque la cuenta sea válida.",
    authPrivate: "Tu sesión se queda en este equipo. Ni credenciales ni historial salen de aquí.",
    authMissingClient:
      "Falta el Client ID de Spotify. Registra una app en developer.spotify.com y define la variable STARLESS_SPOTIFY_CLIENT_ID antes de iniciar Starless.",
    authCancelled: "Cancelaste el inicio de sesión.",
    authOAuthFailed: "No se pudo completar el inicio de sesión con Spotify.",
    authBusy: "La sesión está ocupada. Inténtalo de nuevo.",
    authCacheFailed: "No se pudo leer la caché de credenciales.",
    authSignoutFailed: "No se pudo cerrar la sesión.",
    authUnknown: "Algo falló al conectar con Spotify.",

    // Secondary action rail
    queue: "Cola de reproducción",
    queueNowPlaying: "Ahora suena",
    queueNextUp: "A continuación",
    queueEmpty: "Nada en cola",
    device: "Dispositivo",
    more: "Más opciones",

    // Settings
    settingsTitle: "Ajustes",
    settingsSubtitle: "Audio, cuenta y diagnóstico.",
    sectionGeneral: "General",
    sectionAudio: "Audio",
    sectionAccount: "Cuenta",
    sectionCustom: "Personalización",
    menuOpacity: "Opacidad de los menús",
    menuOpacityHint: "Qué tan sólidos se ven los menús. Más sólido es más fácil de leer.",
    menuOpacitySolid: "Sólido",
    menuOpacityGlass: "Translúcido",
    accentColor: "Color de acento",
    accentColorHint: "El color que marca las acciones.",
    accentColorCustom: "Otro color",
    sectionDiagnostics: "Diagnóstico",
    close: "Cerrar",

    theme: "Tema",
    themeDark: "Oscuro",
    themeSystem: "Del sistema",

    colourMode: "Modo daltónico",
    colourModeHint:
      "Adapta los colores que significan estado. Los colores de las instancias no cambian.",
    colourModeOff: "Desactivado",
    colourModeOn: "Activado",

    audioQuality: "Calidad de audio",
    audioQualityHint: "Más calidad significa más datos y algo menos de batería.",
    qualityLow: "Baja",
    qualityNormal: "Normal",
    qualityHigh: "Alta",

    normalisation: "Normalizar volumen",
    normalisationHint: "Iguala el volumen entre canciones para que no te sorprendan los picos.",
    crossfade: "Transición entre canciones",
    crossfadeHint:
      "Cuando una canción termina sola, la siguiente empieza esos segundos antes y las dos se mezclan.",
    crossfadeOff: "Apagado",
    crossfadeSeconds: "{n} s",

    startWithWindows: "Iniciar con Windows",
    startWithWindowsHint: "Starless se abre minimizado a la bandeja al arrancar el sistema.",

    signedInAs: "Sesión iniciada como",
    signOut: "Cerrar sesión",

    version: "Versión",
    savedAutomatically: "Guardado automáticamente",
    protocol: "Protocolo de reproducción",
    changelogs: "Changelogs",
    changelogUnreleased: "En desarrollo",
    changelogReconstructed: "Reconstruido",
    prereleaseBadge: "pre-release",
    publicBadge: "pública",

    // Updates
    updatesTitle: "Actualizaciones",
    updatesHint: "Starless se comprueba solo al abrir. Nada se descarga hasta que lo pidas.",
    updateCheck: "Buscar actualizaciones",
    updateCurrent: "Estás al día",
    updateAvailable: "Hay una versión más nueva: {version}. Se instalará al cerrar Starless.",
    updateInstall: "Actualizar",
    updateDownloading: "Descargando…",
    updateGoBack:
      "Hay una versión pública ({version}) y estás corriendo una más nueva. Puedes volver a la pública cuando quieras.",
    updateGoBackShort: "Volver a la {version}",
    updateGoBackSame: "La {version} pública es otra build: no la de develop que tienes instalada.",
    updateGoBackSameShort: "Instalar la {version} pública",
    updateInstallError:
      "La instalación falló. La copia que tienes instalada no cambió, y puedes intentarlo otra vez.",
    prereleaseTitle: "Prerelease de develop",
    prereleaseHint: "Se instala encima de la que tienes y la reemplaza.",
    prereleaseCheck: "Buscar prerelease",
    prereleaseChecking: "Buscando…",
    prereleaseNone: "No hay prerelease",
    prereleaseSame: "Ya estás corriendo la {version} de develop.",
    prereleaseAvailable: "Hay una {version} de develop lista. Se instalará al cerrar Starless.",
    prereleaseInstall: "Instalar la prerelease",
    prereleaseError:
      "No se pudo preguntar a GitHub. Es un problema de conexión, no de la copia instalada.",
    prereleaseRateLimited:
      "GitHub limitó las consultas desde esta máquina. El presupuesto vuelve en una hora: prueba otra vez después.",
    prereleaseInstallError:
      "La instalación de la prerelease falló. La copia que tienes instalada no cambió, y puedes intentarlo otra vez.",
    updateAlertTitle: "Hay una versión nueva",
    updateAlertBody: "v{version} está lista. Se instala desde Ajustes, cuando tú lo decidas.",
    updateSimulated: "v{version} (simulada). No hay nada que instalar: es un estado de prueba.",
    updateSimulatedShort: "Simulada, no instalable",

    // Development only. These exist so a state that is otherwise hard to reach —
    // an update that does not exist — can be looked at without publishing
    // anything. They are dropped from release builds by `import.meta.env.DEV`.
    devOnly: "Sólo en desarrollo",
    devOnlyHint: "Estos botones no existen en una versión publicada: Vite los elimina al compilar.",
    devSimulateUpdate: "Simular una actualización",
    devClearUpdate: "Quitar la simulación",
    devSimulateCrash: "Simular un crash",
    devCrashPlanted:
      "Listo. Cierra la app y vuelve a abrirla: el aviso de crash aparece al arrancar.",

    newPlaylist: "Nueva playlist",
    showLibrary: "Mostrar biblioteca",
    /**
     * The one message that says "the library did not load" instead of showing
     * an empty one.
     *
     * It deliberately does not say whose fault it is. For months this app had a
     * whole failure that produced a perfectly normal-looking empty library, and
     * the honest cause — that the Web API would not serve this account — was
     * invisible from the inside. "Spotify isn't handing us your library right
     * now" says what happened without sending anybody to look for a problem in
     * their own account, and without promising that retrying will help.
     */
    libraryUnavailableTitle: "No pudimos leer tu biblioteca",
    libraryUnavailableBody:
      "Spotify no le está entregando tu biblioteca en este momento. Si acabas de abrir la app, prueba de nuevo en un rato.",
    hideLibrary: "Ocultar biblioteca",

    // A session that ended without being closed
    crashKicker: "La sesión anterior falló",
    crashTitle: "Starless no se cerró bien",
    crashBody:
      "La app terminó sin cerrarse. Puede ser un fallo puntual o algo de la máquina. Si quieres, mandamos el registro para encontrarlo.",
    crashShowDetail: "Ver qué se enviaría",
    crashHideDetail: "Ocultar el detalle",
    crashScrubbed: "Sin datos personales",
    crashSend: "Enviar el registro",
    crashSending: "Enviando…",
    crashDismiss: "Ahora no",
    crashPrivacy: "No se envía nada hasta que aprietes el botón. Starless no reporta uso.",
    crashSent: "Reporte creado:",
    crashSentDuplicate: "Ya lo habían reportado; sumamos el tuyo:",
    reportRateLimited: "Llegaste al límite de reportes por hora. Prueba de nuevo más tarde.",
    reportRejected: "El servidor no aceptó este reporte. Prueba acortando el mensaje.",
    feedbackTopic: "Qué nos cuentas",
    feedbackTopicBug: "Un problema",
    feedbackTopicIdea: "Una idea",
    feedbackTopicOther: "Otra cosa",
    crashReportUnavailable: "No se pudo preparar el reporte.",
    crashReportFailed: "No se pudo enviar el reporte.",

    // Saying something when nothing crashed
    feedbackKicker: "Feedback",
    feedbackTitle: "Cuéntale a quien lo lee",
    feedbackBody:
      "Algo que anda lento, algo que no encuentras, algo que te molesta. No hace falta que esté roto.",
    feedbackPlaceholder: "¿Qué pasó, o qué te gustaría que pasara?",
    feedbackAttachLog: "Adjuntar el registro",
    feedbackAttachLogHint:
      "Se envía la última parte de starless.log, sin tu nombre de cuenta ni identificadores. Apagado por defecto.",
    feedbackShowDetail: "Ver qué se enviaría",
    feedbackSend: "Enviar feedback",

    // The window's own controls, since there is no system title bar
    windowMinimize: "Minimizar",
    windowMaximize: "Maximizar",
    windowRestore: "Restaurar",
    windowClose: "Cerrar",
  },
  en: {
    searchPlaceholder: "Songs",
    clearSearch: "Clear search",
    searchResultsTitle: "Results",
    searchResultsFor: "For “{query}”",
    searching: "Searching…",
    searchHint: "Type at least two characters",
    searchNoResults: "No results for this search.",
    searchSeeAllResults: "See all results",
    searchNoMatches: "No song matches this.",

    searchBack: "Back to results",

    artistKind: "Artist",
    artistSongs: "Songs",
    artistLoadFailed: "Couldn't load this artist.",
    // The artist's page. The heading says neither "Popular" nor "Discography",
    // because neither can be computed here — the list is what this app finds for
    // that name, and it says so.
    artistSongsFound: "What Starless finds",
    artistSongsNone: "No songs were found for this artist.",
    albumKind: "Album",
    albumSongsFound: "What Starless finds",
    albumSongsNone: "No songs were found for this album.",
    back: "Back",
    columnAlbum: "Album",
    navHome: "Home",
    navLibrary: "Your library",
    collapseLibrary: "Collapse the library",
    expandLibrary: "Expand the library",
    navSettings: "Settings",

    libraryTitle: "Your library",
    likedSongs: "Liked Songs",
    yourPlaylists: "Your playlists",
    madeForYou: "Made for you",
    // The account's DJ. Its card does not say how many songs it has —that is
    // only known once the mix is asked for— but what it is: someone who picks.
    djSubtitle: "Picks the music for you",
    djPlay: "Play",
    djUnavailable: "Couldn't read the DJ",
    // The DJ talking, in the player bar. The name and the line come from the
    // service; these two are what goes in when they don't.
    djSpeaker: "DJ",
    djSpeaking: "Speaking",
    // The bar's button: the DJ picks another set.
    djNext: "Ask the DJ for another set",
    // With the DJ talking: the button that cuts the line off and lets the
    // song the DJ picked play.
    djSkipVoice: "Skip the DJ's voice and hear the song",
    librarySort: "Sort",
    sortNameAsc: "Name, A to Z",
    sortNameDesc: "Name, Z to A",
    sortCreator: "By creator",
    sortTracks: "By song count",
    viewGrid: "Grid",
    viewList: "List",
    newPlaylistName: "Name",
    newPlaylistCreate: "Create",
    newPlaylistCancel: "Cancel",
    newPlaylistBusy: "Creating…",
    newPlaylistFailedCreate: "The playlist could not be created",
    newPlaylistFailedAttach: "The playlist was created but did not reach your library",
    newPlaylistFailedAdd: "The playlist was created, but the song did not go in",
    newPlaylistDone: "Playlist created",
    homeTitle: "Home",
    openPlaylist: "Open",
    lyricsTitle: "Lyrics",
    showLyrics: "Show lyrics",
    closeLyrics: "Back",
    noLyrics: "This song has no lyrics.",
    lyricsNotSynced: "These lyrics are not synced, so they cannot follow along.",
    lyricsPaused: "Play the song to make the lyrics move.",
    jumpToLine: "Jump to this moment",
    playlists: "playlists",
    planPremium: "Premium",
    planFree: "No audio without Premium",
    loading: "Loading…",
    emptyList: "Nothing here yet",
    playlistEmpty: "This playlist has no songs yet.",
    likedEmpty: "Songs you like with the heart show up here.",
    // The playlist, drawn the way the desktop client draws it: what kind of list
    // this is, then the order and the filter beside the songs.
    playlistCollaborative: "Collaborative playlist",
    playlistPrivate: "Private playlist",
    playlistSearch: "Search in this playlist",
    playlistNoMatches: "No song in this playlist matches that search.",
    playlistOrder: "Playlist order",
    orderCustom: "Custom order",
    orderTitle: "Title",
    orderAdded: "Recently added",
    orderArtist: "Artist",
    orderAlbum: "Album",
    sortBy: "Sort by",
    sortAscending: "ascending",
    sortDescending: "descending",
    viewAs: "View as",
    viewCompact: "Compact",
    playAll: "Play all",
    // A song's three dots. Three rows, and all three do something: the ones that
    // could not would read as broken.
    trackMenu: "Song options",
    trackMenuFor: "Options for {name}",
    goToArtist: "Go to {name}",
    goToAlbum: "Go to album {name}",
    addToQueue: "Add to queue",
    addToPlaylist: "Add to playlist",
    findPlaylist: "Find a playlist",
    addedToPlaylist: "Added to “{name}”",
    noPlaylistsYet: "You don't have any playlists yet.",
    noPlaylistMatches: "No playlist matches that search.",
    copyLink: "Copy link",
    copyFailed: "Couldn't copy",
    // A playlist's three dots. Three rows, and all three do something: the ones
    // that could not would read as broken.
    playlistMenu: "Playlist options",
    playlistMenuFor: "Options for “{name}”",
    playlistQueued: "{count} songs in the queue",
    // The details dialog: the cover, the name and the description.
    playlistDetails: "Edit details",
    playlistDetailsName: "Name",
    playlistDetailsDescription: "Add an optional description",
    playlistDetailsSave: "Save",
    playlistDetailsCancel: "Cancel",
    playlistDetailsSaving: "Saving…",
    playlistDetailsFailed: "Couldn't save the details.",
    playlistDetailsTimeout: "The save didn't answer in time. Try again.",
    playlistVisibilityFailed: "The details were saved, but the playlist didn't change visibility.",
    playlistMakePrivate: "Make private",
    playlistChoosePhoto: "Choose photo",
    playlistRestoreCover: "Restore Spotify's cover",
    playlistUploadFailed: "Couldn't upload the image.",
    playlistNotReadable:
      "Someone else made this playlist. Spotify only lets an app read the contents of the ones you own or collaborate on.",
    librarySubtitle: "Your music, exactly as you saved it",
    songs: "songs",

    nowPlaying: "Now playing",
    failed: "Couldn't load",

    columnTitle: "Title",
    columnStatus: "Status",
    columnTime: "Time",
    columnAdded: "Date added",

    play: "Play",
    pause: "Pause",
    previous: "Previous",
    next: "Next",
    shuffle: "Shuffle",
    shuffleOn: "Shuffle on",
    shuffleOff: "Shuffle off",
    repeat: "Repeat",
    repeatAll: "Repeat the whole list",
    repeatOne: "Repeat this song",
    volume: "Volume",
    mute: "Mute",
    unmute: "Unmute",
    position: "Seek",

    playbackErrorTitle: "Couldn't play this",
    loadingPlayback: "Loading…",

    language: "Language",
    premiumRequired: "Requires Spotify Premium",

    // Auth
    authKicker: "Desktop client",
    authTitle: "Your music, on your desktop",
    authBody:
      "Connect your Spotify account. Starless never sees your password and sends no telemetry.",
    authConnect: "Connect with Spotify",
    authReport: "Something not working? Tell us what happened.",
    feedbackEmpty: "Tell us what happened, or attach the log so the report is worth reading.",
    authWaiting: "Finish the approval in your browser…",
    authConnecting: "Connecting to Spotify…",
    authTimeout: "Spotify did not answer. Try again.",
    authPremium:
      "Premium is required. Without it, Spotify delivers no audio even when the account is valid.",
    authPrivate: "Your session stays on this machine. Neither credentials nor history leave it.",
    authMissingClient:
      "Spotify Client ID missing. Register an app at developer.spotify.com and set the STARLESS_SPOTIFY_CLIENT_ID environment variable before starting Starless.",
    authCancelled: "You cancelled the sign-in.",
    authOAuthFailed: "Could not complete sign-in with Spotify.",
    authBusy: "The session is busy. Try again.",
    authCacheFailed: "Could not read the credential cache.",
    authSignoutFailed: "Could not sign out.",
    authUnknown: "Something went wrong connecting to Spotify.",

    queue: "Play queue",
    queueNowPlaying: "Now playing",
    queueNextUp: "Next up",
    queueEmpty: "Nothing queued",
    device: "Device",
    more: "More options",

    settingsTitle: "Settings",
    settingsSubtitle: "Audio, account and diagnostics.",
    sectionGeneral: "General",
    sectionAudio: "Audio",
    sectionAccount: "Account",
    sectionCustom: "Customisation",
    menuOpacity: "Menu opacity",
    menuOpacityHint: "How solid the menus look. More solid is easier to read.",
    menuOpacitySolid: "Solid",
    menuOpacityGlass: "Translucent",
    accentColor: "Accent colour",
    accentColorHint: "The colour that marks actions.",
    accentColorCustom: "Custom colour",
    sectionDiagnostics: "Diagnostics",
    close: "Close",

    theme: "Theme",
    themeDark: "Dark",
    themeSystem: "Match system",

    colourMode: "Colour mode",
    colourModeHint: "Adapts the colours that carry meaning. Instance colours do not change.",
    colourModeOff: "Off",
    colourModeOn: "On",

    audioQuality: "Audio quality",
    audioQualityHint: "Higher quality uses more data and a little more battery.",
    qualityLow: "Low",
    qualityNormal: "Normal",
    qualityHigh: "High",

    normalisation: "Normalise volume",
    normalisationHint: "Levels the volume across songs so no track jumps out at you.",
    crossfade: "Crossfade",
    crossfadeHint:
      "When a song ends on its own, the next one starts that many seconds early and the two blend.",
    crossfadeOff: "Off",
    crossfadeSeconds: "{n} s",

    startWithWindows: "Start with Windows",
    startWithWindowsHint: "Starless opens minimised to the tray when the system starts.",

    signedInAs: "Signed in as",
    signOut: "Sign out",

    version: "Version",
    savedAutomatically: "Saved automatically",
    protocol: "Playback protocol",
    changelogs: "Changelogs",
    changelogUnreleased: "In development",
    changelogReconstructed: "Reconstructed",
    prereleaseBadge: "pre-release",
    publicBadge: "public",

    updatesTitle: "Updates",
    updatesHint: "Starless checks on its own when it opens. Nothing downloads until you ask.",
    updateCheck: "Check for updates",
    updateCurrent: "You're up to date",
    updateAvailable: "A newer version is out: {version}. It installs when Starless closes.",
    updateInstall: "Update",
    updateDownloading: "Downloading…",
    updateGoBack:
      "There is a public version ({version}) and you are running a newer one. You can go back to the public one whenever you want.",
    updateGoBackShort: "Go back to {version}",
    updateGoBackSame:
      "The public {version} is a different build: not the develop one you have installed.",
    updateGoBackSameShort: "Install the public {version}",
    updateInstallError:
      "The install failed. The copy you have installed did not change, and you can try again.",
    prereleaseTitle: "Develop prerelease",
    prereleaseHint: "It installs over what you are running and replaces it.",
    prereleaseCheck: "Check prerelease",
    prereleaseChecking: "Checking…",
    prereleaseNone: "No prerelease",
    prereleaseSame: "You are already running the {version} from develop.",
    prereleaseAvailable:
      "There is a {version} from develop ready. It installs when Starless closes.",
    prereleaseInstall: "Install the prerelease",
    prereleaseError:
      "GitHub could not be reached. That is a connection problem, not a problem with the copy you have installed.",
    prereleaseRateLimited:
      "GitHub limited the queries from this machine. The budget comes back in an hour: try again later.",
    prereleaseInstallError:
      "The prerelease install failed. The copy you have installed did not change, and you can try again.",
    updateAlertTitle: "There is a newer version",
    updateAlertBody: "v{version} is ready. It installs from Settings, when you decide.",
    updateSimulated: "v{version} (simulated). There is nothing to install: this is a test state.",
    updateSimulatedShort: "Simulated, not installable",

    // Development only. Same strings, same reason.
    devOnly: "Development only",
    devOnlyHint:
      "These buttons do not exist in a published build: Vite removes them at compile time.",
    devSimulateUpdate: "Simulate an update",
    devClearUpdate: "Clear the simulation",
    devSimulateCrash: "Simulate a crash",
    devCrashPlanted: "Done. Quit the app and open it again: the crash prompt appears at launch.",

    newPlaylist: "New playlist",
    showLibrary: "Show library",
    libraryUnavailableTitle: "We couldn't read your library",
    libraryUnavailableBody:
      "Spotify isn't handing it your library right now. If you just opened the app, try again in a little while.",
    hideLibrary: "Hide library",

    // A session that ended without being closed
    crashKicker: "The last session failed",
    crashTitle: "Starless did not close cleanly",
    crashBody:
      "The app ended without shutting down. It could be a one-off bug or something about the machine. If you want, we can send the log so it can be found.",
    crashShowDetail: "See what would be sent",
    crashHideDetail: "Hide the detail",
    crashScrubbed: "No personal data",
    crashSend: "Send the log",
    crashSending: "Sending…",
    crashDismiss: "Not now",
    crashPrivacy: "Nothing is sent until you press the button. Starless reports no usage.",
    crashSent: "Report created:",
    crashSentDuplicate: "Already reported; we added yours:",
    reportRateLimited: "You reached the limit of reports per hour. Try again later.",
    reportRejected: "The server did not accept this report. Try a shorter message.",
    feedbackTopic: "What it is about",
    feedbackTopicBug: "A problem",
    feedbackTopicIdea: "An idea",
    feedbackTopicOther: "Something else",
    crashReportUnavailable: "The report could not be prepared.",
    crashReportFailed: "The report could not be sent.",

    // Saying something when nothing crashed
    feedbackKicker: "Feedback",
    feedbackTitle: "Tell whoever reads this",
    feedbackBody:
      "Something that runs slow, something you cannot find, something that keeps getting in your way. It does not have to be broken.",
    feedbackPlaceholder: "What happened, or what you would like to happen?",
    feedbackAttachLog: "Attach the log",
    feedbackAttachLogHint:
      "Sends the tail of starless.log, with your account name and any identifiers already removed. Off by default.",
    feedbackShowDetail: "See what would be sent",
    feedbackSend: "Send feedback",

    // The window's own controls, since there is no system title bar
    windowMinimize: "Minimise",
    windowMaximize: "Maximise",
    windowRestore: "Restore",
    windowClose: "Close",
  },
} satisfies Record<Lang, Record<string, string>>;

export type StringKey = keyof (typeof strings)["es"];
