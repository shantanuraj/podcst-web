import type { Messages } from './en';

export const messages: Messages = {
  common: {
    appName: 'Podcst',
    version: 'Versie',
    madeBy: 'Gemaakt door',
    author: 'Shantanu Raj',
    loading: 'Laden...',
    error: 'Er is iets misgegaan',
  },

  nav: {
    discover: 'Ontdekken',
    library: 'Bibliotheek',
    settings: 'Instellingen',
    profile: 'Profiel',
    signIn: 'Inloggen',
    signOut: 'Uitloggen',
  },

  search: {
    placeholder: 'Zoek podcasts...',
    noResults: 'Geen podcasts gevonden',
    label: 'Zoek podcasts',
  },

  auth: {
    title: 'Inloggen',
    subtitle: 'Gebruik je e-mailadres om verder te gaan met een passkey',
    emailPlaceholder: 'jouw@voorbeeld.nl',
    continue: 'Doorgaan',
    continuing: 'Doorgaan...',
    useADifferentEmail: 'Gebruik een ander e-postadres',
    verifyTitle: 'Verifieer je e-mailadres',
    verifySubtitle: 'We hebben een code gestuurd naar {email}',
    codePlaceholder: '000000',
    enterCode: 'Voer code in',
    verify: 'Verifiëren',
    verifying: 'Verifiëren...',
    resendCode: 'Code opnieuw versturen',
    resending: 'Opnieuw versturen...',
    codeSent: 'Nieuwe code verzonden!',
  },

  settings: {
    title: 'Instellingen',
    language: 'Taal',
    languageDescription: 'Interfacetaal',
    region: 'Regio',
    regionDescription: 'Kies je regio voor podcast-hitlijsten',
    theme: 'Thema',
    themeDescription: 'Pas het uiterlijk van Podcst aan',
    shortcuts: 'Sneltoetsen',
    shortcutsDescription: 'Bekijk en beheer sneltoetsen',
    export: 'Exporteren',
    exportDescription: 'Download je bibliotheek als een OPML-bestand',
    exportDescriptionLong:
      'Download je abonnementen als een OPML-bestand om te importeren in andere apps.',
    emptyLibrary: 'Je bibliotheek is leeg',
    emptyLibraryDescription:
      'Abonneer je op podcasts om je persoonlijke bibliotheek op te bouwen, of importeer je bestaande abonnementen uit een andere app.',
    browsePopularPodcasts: 'Blader door populaire podcasts',
    exportLibrary: 'Bibliotheek exporteren',
    exportLibraryDescription:
      'Download je bibliotheek als een OPML-bestand. Je kunt dit bestand gebruiken om je podcasts in andere applicaties te importeren.',
    exportLibraryCta: 'OPML-bestand downloaden',
    exportLibraryCount:
      '{count} {count, plural, one {podcast} other {podcasts}} in je bibliotheek',
  },

  profile: {
    title: 'Profiel',
    account: 'Account',
    subscriptions: 'Abonnementen',
    syncDescription:
      'Je hebt {count} {count, plural, one {podcast} other {podcasts}} opgeslagen op dit apparaat. Importeer ze naar je account om te synchroniseren tussen al je apparaten.',
    importFromDevice: 'Importeren van apparaat',
    importing: 'Importeren...',
    downloadOPML: 'Download OPML',
  },

  player: {
    nowPlaying: 'Nu spelend',
    play: 'Afspelen',
    pause: 'Pauzeren',
    seekBack: 'Terugspoelen',
    seekForward: 'Vooruitspoelen',
    speed: 'Afspeelsnelheid',
    mute: 'Dempen',
    unmute: 'Dempen opheffen',
    queue: 'Wachtrij bekijken',
    airplay: 'AirPlay',
    chromecast: 'Cast',
  },

  podcast: {
    subscribe: 'Abonneren',
    subscribed: 'Geabonneerd',
    unsubscribe: 'Abonnement opzeggen',
    episodes: 'Afleveringen',
    showNotes: 'Beschrijving',
    playEpisode: 'Aflevering afspelen',
    addToQueue: 'Toevoegen aan wachtrij',
    share: 'Delen',
    episodeCount: '{count} afleveringen',
  },

  library: {
    title: 'Bibliotheek',
    empty: 'Nog geen podcasts',
    emptyDescription: 'Abonneer je op podcasts om ze hier te zien',
    recents: 'Onlangs gespeeld',
    subscriptions: 'Abonnementen',
  },

  feed: {
    trending: 'Trending',
    topPodcasts: 'Hitlijsten',
    newReleases: 'Nieuwe releases',
  },

  queue: {
    title: 'Wachtrij',
    empty: 'Voeg afleveringen toe aan de wachtrij om ze hier te zien',
  },

  regions: {
    us: 'Verenigde Staten',
    nl: 'Nederland',
    ca: 'Canada',
    kr: 'Zuid-Korea',
    my: 'Maleisië',
    in: 'India',
    mx: 'Mexico',
    fr: 'Frankrijk',
    se: 'Zweden',
    no: 'Noorwegen',
  },

  languages: {
    en: 'Engels',
    nl: 'Nederlands',
    fr: 'Frans',
    sv: 'Zweeds',
    ko: 'Koreaans',
    es: 'Spaans',
    hi: 'Hindi',
  },

  shortcuts: {
    home: 'Home / Top',
    subscriptions: 'Abonnementen',
    recents: 'Onlangs gespeeld',
    settings: 'Instellingen',
    search: 'Zoeken',
    toggleTheme: 'Thema wisselen',
    previousTheme: 'Vorig thema',
    showEpisodeInfo: 'Toon afleveringsinformatie',
    queue: 'Wachtrij',
    playPause: 'Afspelen / Pauzeren',
    seekBack: 'Terugspoelen',
    seekAhead: 'Vooruitspoelen',
    seekToPercent: 'Spring naar n %',
    nextEpisode: 'Volgende aflevering',
    previousEpisode: 'Vorige aflevering',
    increaseSpeed: 'Snelheid verhogen',
    decreaseSpeed: 'Snelheid verlagen',
    toggleMute: 'Dempen aan/uit',
    showShortcuts: 'Toon sneltoetsen',
  },

  themes: {
    autumnLight: 'Herfstlicht',
    autumnDark: 'Herfstnacht',
    lightBlurb: 'Schoon en helder uiterlijk',
    darkBlurb: 'Geoptimaliseerd voor donkere omgevingen',
  },

  errors: {
    notFound: 'Pagina niet gevonden',
    notFoundDescription: 'De pagina die je zoekt bestaat niet',
    goHome: 'Ga naar Home',
  },
};
