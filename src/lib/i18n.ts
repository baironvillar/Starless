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
    searchPlaceholder: "Buscar canciones, artistas, albums",
    clearSearch: "Limpiar búsqueda",
    searchResultsTitle: "Resultados",
    searchResultsFor: "Para «{query}»",
    searching: "Buscando…",
    searchHint: "Escribe al menos dos letras",
    searchNoResults: "Sin resultados para esta búsqueda.",
    searchSeeAllResults: "Ver todos los resultados",
    searchNoMatches: "Ninguna canción coincide con esto.",

    // Search result tabs
    searchTab_all: "Todo",
    searchTab_songs: "Canciones",
    searchTab_albums: "Álbumes",
    searchTab_playlists: "Playlists",
    searchTab_artists: "Artistas",
    searchBack: "Volver a los resultados",

    // Artist profile
    artistKind: "Artista",
    artistSongs: "Canciones",
    albumsLower: "álbumes",
    artistLoadFailed: "No se pudo cargar el perfil del artista.",
    columnAlbum: "Álbum",
    navHome: "Inicio",
    navLibrary: "Tu biblioteca",
    navSearch: "Buscar",
    navPlaylists: "Tus playlists",
    navSettings: "Ajustes",

    libraryTitle: "Tu biblioteca",
    likedSongs: "Canciones que te gustan",
    yourPlaylists: "Tus playlists",
    createPlaylist: "Crear playlist",
    planPremium: "Premium",
    planFree: "Sin Premium no hay audio",
    loading: "Cargando…",
    emptyList: "Nada por aquí todavía",
    playlistEmpty: "Esta playlist todavía no tiene canciones.",
    playlistNotReadable:
      "Esta playlist la creó otra persona. Spotify solo deja leer el contenido de las que te pertenecen o en las que colaboras.",
    addToPlaylist: "Agregar a playlist",
    playlistSearch: "Buscar o crear una playlist",
    noPlaylistsMatch: "Ninguna playlist coincide.",
    createPlaylistNamed: "Crear «{name}» y agregar",
    saving: "Guardando…",
    librarySubtitle: "Tu música, tal cual la guardaste",
    songs: "canciones",

    nowPlaying: "Reproduciendo ahora",
    queued: "En cola",
    failed: "No se pudo cargar",
    played: "Reproducido",

    columnTitle: "Título",
    columnStatus: "Estado",
    columnTime: "Duración",

    play: "Reproducir",
    pause: "Pausar",
    previous: "Anterior",
    next: "Siguiente",
    shuffle: "Aleatorio",
    shuffleOn: "Aleatorio activado",
    repeat: "Repetir",
    repeatAll: "Repetir toda la lista",
    repeatOne: "Repetir esta canción",
    volume: "Volumen",
    mute: "Silenciar",
    position: "Posición",
    like: "Me gusta",
    unlike: "Quitar de Me gusta",

    nothingPlaying: "Nada sonando",
    nothingPlayingHint: "Elige una canción de tu biblioteca",
    playbackErrorTitle: "No se pudo reproducir",
    loadingPlayback: "Cargando…",
    logFile: "Archivo de registro",
    logFileHint:
      "Starless no envía telemetría. Este es el registro local donde queda por qué una canción no sonó.",

    language: "Idioma",
    premiumRequired: "Requiere Spotify Premium",

    // Auth
    authKicker: "Cliente de escritorio",
    authTitle: "Tu música, en tu escritorio",
    authBody:
      "Conéctate con tu cuenta de Spotify. Starless no ve tu contraseña y no envía telemetría.",
    authConnect: "Conectar con Spotify",
    authWaiting: "Termina la autorización en el navegador…",
    authConnected: "Conectado como",
    authPremium:
      "Se necesita Premium. Sin Premium, Spotify no entrega audio aunque la cuenta sea válida.",
    authPrivate: "Tu sesión se queda en este equipo. Ni credenciales ni historial salen de aquí.",
    authMissingClient:
      "Falta el Client ID de Spotify. Registra una app en developer.spotify.com y define la variable STARLESS_SPOTIFY_CLIENT_ID antes de iniciar Starless.",
    authCancelled: "Cancelaste el inicio de sesión.",
    authReauthorize:
      "Tu sesión de reproducción sigue activa, pero falta el permiso para leer tu biblioteca. Autorízalo una vez más.",
    authOAuthFailed: "No se pudo completar el inicio de sesión con Spotify.",
    authBusy: "La sesión está ocupada. Inténtalo de nuevo.",
    authCacheFailed: "No se pudo leer la caché de credenciales.",
    authSignoutFailed: "No se pudo cerrar la sesión.",
    authUnknown: "Algo falló al conectar con Spotify.",

    // Secondary action rail
    queue: "Cola de reproducción",
    queueNowPlaying: "Ahora suena",
    queueNextUp: "A continuación",
    queueRecentlyPlayed: "Reproducido recientemente",
    queueEmpty: "Nada en cola",
    device: "Dispositivo",
    more: "Más opciones",

    // Settings
    settingsTitle: "Ajustes",
    settingsSubtitle: "Audio, cuenta y diagnóstico.",
    sectionGeneral: "General",
    sectionAudio: "Audio",
    sectionAccount: "Cuenta",
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
    normalisationHint: " Iguala el volumen entre canciones para que no te sorprendan los picos.",
    crossfade: "Transición suave",
    crossfadeHint: "Encadena las canciones con un fundido corto en lugar de cortarse.",

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

    // Updates
    updatesTitle: "Actualizaciones",
    updatesHint: "Starless se comprueba solo al abrir. Nada se descarga hasta que lo pidas.",
    updateCheck: "Buscar actualizaciones",
    updateCurrent: "Estás al día",
    updateAvailable: "Hay una versión más nueva: {version}. Se instalará al cerrar Starless.",
    updateInstall: "Actualizar",
    updateDownloading: "Descargando…",

    newPlaylist: "Nueva playlist",
    showLibrary: "Mostrar biblioteca",
    hideLibrary: "Ocultar biblioteca",

    // A session that ended without being closed
    crashKicker: "La sesión anterior falló",
    crashTitle: "Starless no se cerró bien",
    crashBody:
      "La última vez que abriste Starless, la app terminó sin cerrarse. Puede ser un fallo puntual o algo de la máquina. Si querés, mandamos el registro para poder encontrarlo.",
    crashShowDetail: "Ver qué se enviaría",
    crashHideDetail: "Ocultar el detalle",
    crashScrubbed: "Sin datos personales",
    crashSend: "Enviar el registro",
    crashSending: "Enviando…",
    crashDismiss: "Ahora no",
    crashPrivacy:
      "No se envía nada hasta que aprietes el botón. Starless no reporta uso, ni aunque lo instales y lo abras mil veces.",
    crashSent: "Reporte creado:",
    crashReportUnavailable: "No se pudo preparar el reporte.",
    crashReportFailed: "No se pudo enviar el reporte.",

    // Saying something when nothing crashed
    feedbackKicker: "Feedback",
    feedbackTitle: "Contale a quien lo lee",
    feedbackBody:
      "Algo que anda lento, algo que no encontrás, algo que te está molestando. No hace falta que esté roto: lo que no se reporta no existe.",
    feedbackPlaceholder: "¿Qué pasó, o qué te gustaría que pasara?",
    feedbackAttachLog: "Adjuntar el registro",
    feedbackAttachLogHint:
      "Se envía la última parte de starless.log, ya sin tu nombre de cuenta ni identificadores. Apagado por defecto.",
    feedbackShowDetail: "Ver qué se enviaría",
    feedbackSend: "Enviar feedback",

    // The window's own controls, since there is no system title bar
    windowMinimize: "Minimizar",
    windowMaximize: "Maximizar",
    windowRestore: "Restaurar",
    windowClose: "Cerrar",
  },
  en: {
    searchPlaceholder: "Songs, artists, albums",
    clearSearch: "Clear search",
    searchResultsTitle: "Results",
    searchResultsFor: "For “{query}”",
    searching: "Searching…",
    searchHint: "Type at least two characters",
    searchNoResults: "No results for this search.",
    searchSeeAllResults: "See all results",
    searchNoMatches: "No song matches this.",

    searchTab_all: "All",
    searchTab_songs: "Songs",
    searchTab_albums: "Albums",
    searchTab_playlists: "Playlists",
    searchTab_artists: "Artists",
    searchBack: "Back to results",

    artistKind: "Artist",
    artistSongs: "Songs",
    albumsLower: "albums",
    artistLoadFailed: "Couldn't load this artist.",
    columnAlbum: "Album",
    navHome: "Home",
    navLibrary: "Your library",
    navSearch: "Search",
    navPlaylists: "Your playlists",
    navSettings: "Settings",

    libraryTitle: "Your library",
    likedSongs: "Liked Songs",
    yourPlaylists: "Your playlists",
    createPlaylist: "Create playlist",
    planPremium: "Premium",
    planFree: "No audio without Premium",
    loading: "Loading…",
    emptyList: "Nothing here yet",
    playlistEmpty: "This playlist has no songs yet.",
    playlistNotReadable:
      "Someone else made this playlist. Spotify only lets an app read the contents of the ones you own or collaborate on.",
    addToPlaylist: "Add to playlist",
    playlistSearch: "Search or create a playlist",
    noPlaylistsMatch: "No playlist matches.",
    createPlaylistNamed: "Create “{name}” and add",
    saving: "Saving…",
    librarySubtitle: "Your music, exactly as you saved it",
    songs: "songs",

    nowPlaying: "Now playing",
    queued: "Queued",
    failed: "Couldn't load",
    played: "Played",

    columnTitle: "Title",
    columnStatus: "Status",
    columnTime: "Time",

    play: "Play",
    pause: "Pause",
    previous: "Previous",
    next: "Next",
    shuffle: "Shuffle",
    shuffleOn: "Shuffle on",
    repeat: "Repeat",
    repeatAll: "Repeat the whole list",
    repeatOne: "Repeat this song",
    volume: "Volume",
    mute: "Mute",
    position: "Seek",
    like: "Like",
    unlike: "Remove from Liked Songs",

    nothingPlaying: "Nothing playing",
    nothingPlayingHint: "Pick a song from your library",
    playbackErrorTitle: "Couldn't play this",
    loadingPlayback: "Loading…",
    logFile: "Log file",
    logFileHint:
      "Starless sends no telemetry. This local log is where the reason a song would not play ends up.",

    language: "Language",
    premiumRequired: "Requires Spotify Premium",

    // Auth
    authKicker: "Desktop client",
    authTitle: "Your music, on your desktop",
    authBody:
      "Connect your Spotify account. Starless never sees your password and sends no telemetry.",
    authConnect: "Connect with Spotify",
    authWaiting: "Finish the approval in your browser…",
    authConnected: "Connected as",
    authPremium:
      "Premium is required. Without it, Spotify delivers no audio even when the account is valid.",
    authPrivate: "Your session stays on this machine. Neither credentials nor history leave it.",
    authMissingClient:
      "Spotify Client ID missing. Register an app at developer.spotify.com and set the STARLESS_SPOTIFY_CLIENT_ID environment variable before starting Starless.",
    authCancelled: "You cancelled the sign-in.",
    authReauthorize:
      "Your playback session is still active, but Starless is not yet allowed to read your library. Authorise it once more.",
    authOAuthFailed: "Could not complete sign-in with Spotify.",
    authBusy: "The session is busy. Try again.",
    authCacheFailed: "Could not read the credential cache.",
    authSignoutFailed: "Could not sign out.",
    authUnknown: "Something went wrong connecting to Spotify.",

    queue: "Play queue",
    queueNowPlaying: "Now playing",
    queueNextUp: "Next up",
    queueRecentlyPlayed: "Recently played",
    queueEmpty: "Nothing queued",
    device: "Device",
    more: "More options",

    settingsTitle: "Settings",
    settingsSubtitle: "Audio, account and diagnostics.",
    sectionGeneral: "General",
    sectionAudio: "Audio",
    sectionAccount: "Account",
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
    crossfadeHint: "Blends tracks together instead of cutting between them.",

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

    updatesTitle: "Updates",
    updatesHint: "Starless checks on its own when it opens. Nothing downloads until you ask.",
    updateCheck: "Check for updates",
    updateCurrent: "You're up to date",
    updateAvailable: "A newer version is out: {version}. It installs when Starless closes.",
    updateInstall: "Update",
    updateDownloading: "Downloading…",

    newPlaylist: "New playlist",
    showLibrary: "Show library",
    hideLibrary: "Hide library",

    // A session that ended without being closed
    crashKicker: "The last session failed",
    crashTitle: "Starless did not close cleanly",
    crashBody:
      "The last time you opened Starless, the app ended without shutting down. It could be a one-off bug or something about the machine. If you want, we can send the log so it can be found.",
    crashShowDetail: "See what would be sent",
    crashHideDetail: "Hide the detail",
    crashScrubbed: "No personal data",
    crashSend: "Send the log",
    crashSending: "Sending…",
    crashDismiss: "Not now",
    crashPrivacy:
      "Nothing is sent until you press the button. Starless reports no usage, not even if you install it and open it a thousand times.",
    crashSent: "Report created:",
    crashReportUnavailable: "The report could not be prepared.",
    crashReportFailed: "The report could not be sent.",

    // Saying something when nothing crashed
    feedbackKicker: "Feedback",
    feedbackTitle: "Tell whoever reads this",
    feedbackBody:
      "Something that runs slow, something you cannot find, something that keeps getting in your way. It does not have to be broken: what nobody reports does not exist.",
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
