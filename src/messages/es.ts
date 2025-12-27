import type { Messages } from './en';

export const messages: Messages = {
  common: {
    appName: 'Podcst',
    version: 'Versión',
    madeBy: 'Creado por',
    author: 'Shantanu Raj',
    loading: 'Cargando...',
    error: 'Algo salió mal',
  },

  nav: {
    discover: 'Descubrir',
    library: 'Biblioteca',
    settings: 'Ajustes',
    profile: 'Perfil',
    signIn: 'Iniciar sesión',
    signOut: 'Cerrar sesión',
  },

  search: {
    placeholder: 'Buscar podcasts...',
    noResults: 'No se encontraron podcasts',
    label: 'Buscar podcasts',
  },

  auth: {
    title: 'Iniciar Sesión',
    subtitle: 'Usa tu correo para continuar con una llave de acceso (passkey)',
    emailPlaceholder: 'tu@ejemplo.com',
    continue: 'Continuar',
    continuing: 'Continuando...',
    useADifferentEmail: 'Usar un correo diferente',
    verifyTitle: 'Verifica tu correo',
    verifySubtitle: 'Enviamos un código a {email}',
    codePlaceholder: '000000',
    enterCode: 'Introduce el código',
    verify: 'Verificar',
    verifying: 'Verificando...',
    resendCode: 'Reenviar código',
    resending: 'Reenviando...',
    codeSent: '¡Nuevo código enviado!',
  },

  settings: {
    title: 'Ajustes',
    language: 'Idioma',
    languageDescription: 'Idioma de la interfaz',
    region: 'Región',
    regionDescription: 'Elige tu región para las listas de éxitos',
    theme: 'Tema',
    themeDescription: 'Personaliza la apariencia de Podcst',
    shortcuts: 'Atajos de teclado',
    shortcutsDescription: 'Ver y gestionar atajos',
    export: 'Exportar',
    exportDescription: 'Descarga tu biblioteca como un archivo OPML',
    exportDescriptionLong:
      'Descarga tus suscripciones como un archivo OPML para importarlas en otras aplicaciones.',
    emptyLibrary: 'Tu biblioteca está vacía',
    emptyLibraryDescription:
      'Suscríbete a podcasts para crear tu biblioteca personal, o importa tus suscripciones actuales desde otra aplicación.',
    browsePopularPodcasts: 'Explorar podcasts populares',
    exportLibrary: 'Exportar biblioteca',
    exportLibraryDescription:
      'Descarga tu biblioteca como un archivo OPML. Puedes usar este archivo para importar tus podcasts en otras aplicaciones.',
    exportLibraryCta: 'Descargar archivo OPML',
    exportLibraryCount:
      '{count} {count, plural, one {podcast} other {podcasts}} en tu biblioteca',
  },

  profile: {
    title: 'Perfil',
    account: 'Cuenta',
    subscriptions: 'Suscripciones',
    syncDescription:
      'Tienes {count} {count, plural, one {podcast} other {podcasts}} guardados en este dispositivo. Impórtalos a tu cuenta para sincronizarlos en todos tus dispositivos.',
    importFromDevice: 'Importar desde dispositivo',
    importing: 'Importando...',
    downloadOPML: 'Descargar OPML',
  },

  player: {
    nowPlaying: 'Reproduciendo ahora',
    play: 'Reproducir',
    pause: 'Pausar',
    seekBack: 'Retroceder',
    seekForward: 'Adelantar',
    speed: 'Velocidad de reproducción',
    mute: 'Silenciar',
    unmute: 'Activar sonido',
    queue: 'Ver cola',
    airplay: 'AirPlay',
    chromecast: 'Cast',
  },

  podcast: {
    subscribe: 'Suscribirse',
    subscribed: 'Suscrito',
    unsubscribe: 'Anular suscripción',
    episodes: 'Episodios',
    showNotes: 'Notas del episodio',
    playEpisode: 'Reproducir episodio',
    addToQueue: 'Añadir a la cola',
    share: 'Compartir',
    episodeCount: '{count} episodios',
  },

  library: {
    title: 'Biblioteca',
    empty: 'Aún no hay podcasts',
    emptyDescription: 'Suscríbete a podcasts para verlos aquí',
    recents: 'Reproducidos recientemente',
    subscriptions: 'Suscripciones',
  },

  feed: {
    trending: 'Tendencias',
    topPodcasts: 'Listas de éxitos',
    newReleases: 'Nuevos lanzamientos',
  },

  queue: {
    title: 'Cola',
    empty: 'Añade algunos episodios a la cola para verlos aquí',
  },

  regions: {
    us: 'Estados Unidos',
    nl: 'Países Bajos',
    ca: 'Canadá',
    kr: 'Corea del Sur',
    my: 'Malasia',
    in: 'India',
    mx: 'México',
    fr: 'Francia',
    se: 'Suecia',
    no: 'Noruega',
  },

  languages: {
    en: 'Inglés',
    nl: 'Neerlandés',
    fr: 'Francés',
    sv: 'Sueco',
    ko: 'Coreano',
    es: 'Español',
    hi: 'Hindi',
  },

  shortcuts: {
    home: 'Inicio / Éxitos',
    subscriptions: 'Suscripciones',
    recents: 'Recientes',
    settings: 'Ajustes',
    search: 'Buscar',
    toggleTheme: 'Cambiar tema',
    previousTheme: 'Tema anterior',
    showEpisodeInfo: 'Ver info. del episodio',
    queue: 'Cola',
    playPause: 'Reproducir / Pausar',
    seekBack: 'Retroceder',
    seekAhead: 'Adelantar',
    seekToPercent: 'Saltar al n %',
    nextEpisode: 'Siguiente episodio',
    previousEpisode: 'Episodio anterior',
    increaseSpeed: 'Aumentar velocidad',
    decreaseSpeed: 'Disminuir velocidad',
    toggleMute: 'Alternar silencio',
    showShortcuts: 'Mostrar atajos',
  },

  themes: {
    autumnLight: 'Otoño claro',
    autumnDark: 'Otoño oscuro',
    lightBlurb: 'Apariencia limpia y clara',
    darkBlurb: 'Optimizado para entornos oscuros',
  },

  errors: {
    notFound: 'Página no encontrada',
    notFoundDescription: 'La página que buscas no existe',
    goHome: 'Ir al inicio',
  },
};
