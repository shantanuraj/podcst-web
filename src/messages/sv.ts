import type { Messages } from './en';

export const messages: Messages = {
  common: {
    appName: 'Podcst',
    version: 'Version',
    madeBy: 'Skapad av',
    author: 'Shantanu Raj',
    loading: 'Laddar...',
    error: 'Något gick fel',
  },

  nav: {
    discover: 'Upptäck',
    library: 'Bibliotek',
    settings: 'Inställningar',
    profile: 'Profil',
    signIn: 'Logga in',
    signOut: 'Logga ut',
  },

  search: {
    placeholder: 'Sök poddar...',
    noResults: 'Inga poddar hittades',
    label: 'Sök poddar',
  },

  auth: {
    title: 'Logga in',
    subtitle: 'Använd din e-post för att fortsätta med en nyckel (passkey)',
    emailPlaceholder: 'dig@exempel.se',
    continue: 'Fortsätt',
    continuing: 'Fortsätter...',
    useADifferentEmail: 'Använd en annan e-post',
    verifyTitle: 'Verifiera din e-post',
    verifySubtitle: 'Vi har skickat en kod till {email}',
    codePlaceholder: '000000',
    enterCode: 'Ange kod',
    verify: 'Verifiera',
    verifying: 'Verifierar...',
    resendCode: 'Skicka kod igen',
    resending: 'Skickar igen...',
    codeSent: 'Ny kod skickad!',
  },

  settings: {
    title: 'Inställningar',
    language: 'Språk',
    languageDescription: 'Gränssnittsspråk',
    region: 'Region',
    regionDescription: 'Välj din region för topplistor',
    theme: 'Tema',
    themeDescription: 'Anpassa utseendet på Podcst',
    shortcuts: 'Kortkommandon',
    shortcutsDescription: 'Visa och hantera kortkommandon',
    export: 'Exportera',
    exportDescription: 'Ladda ner ditt bibliotek som en OPML-fil',
    exportDescriptionLong:
      'Ladda ner dina prenumerationer som en OPML-fil för att importera i andra appar.',
    emptyLibrary: 'Ditt bibliotek är tomt',
    emptyLibraryDescription:
      'Prenumerera på poddar för att bygga ditt personliga bibliotek, eller importera dina befintliga prenumerationer från en annan app.',
    browsePopularPodcasts: 'Bläddra bland populära poddar',
    exportLibrary: 'Exportera bibliotek',
    exportLibraryDescription:
      'Ladda ner ditt bibliotek som en OPML-fil. Du kan använda den här filen för att importera dina poddar i andra appar.',
    exportLibraryCta: 'Ladda ner OPML-fil',
    exportLibraryCount:
      '{count} {count, plural, one {podd} other {poddar}} i ditt bibliotek',
  },

  profile: {
    title: 'Profil',
    account: 'Konto',
    subscriptions: 'Prenumerationer',
    syncDescription:
      'Du har {count} {count, plural, one {podd} other {poddar}} sparade på den här enheten. Importera dem till ditt konto för att synkronisera mellan alla dina enheter.',
    importFromDevice: 'Importera från enhet',
    importing: 'Importerar...',
    downloadOPML: 'Ladda ner OPML',
  },

  player: {
    nowPlaying: 'Spelas nu',
    play: 'Spela',
    pause: 'Pausa',
    seekBack: 'Spola bakåt',
    seekForward: 'Spola framåt',
    speed: 'Uppspelningshastighet',
    mute: 'Ljud av',
    unmute: 'Ljud på',
    queue: 'Visa kö',
    airplay: 'AirPlay',
    chromecast: 'Cast',
  },

  podcast: {
    subscribe: 'Prenumerera',
    subscribed: 'Prenumererar',
    unsubscribe: 'Sluta prenumerera',
    episodes: 'Avsnitt',
    showNotes: 'Avsnittsinfo',
    playEpisode: 'Spela avsnitt',
    addToQueue: 'Lägg i kö',
    share: 'Dela',
    episodeCount: '{count} avsnitt',
  },

  library: {
    title: 'Bibliotek',
    empty: 'Inga poddar ännu',
    emptyDescription: 'Prenumerera på poddar för att se dem här',
    recents: 'Senast spelade',
    subscriptions: 'Prenumerationer',
  },

  feed: {
    trending: 'Trendigt',
    topPodcasts: 'Topplistor',
    newReleases: 'Nya släpp',
  },

  queue: {
    title: 'Kö',
    empty: 'Lägg till några avsnitt i kön för att se dem här',
  },

  regions: {
    us: 'USA',
    nl: 'Nederländerna',
    ca: 'Kanada',
    kr: 'Sydkorea',
    my: 'Malaysia',
    in: 'Indien',
    mx: 'Mexiko',
    fr: 'Frankrike',
    se: 'Sverige',
    no: 'Norge',
  },

  languages: {
    en: 'Engelska',
    nl: 'Nederländska',
    fr: 'Franska',
    sv: 'Svenska',
    ko: 'Koreanska',
    es: 'Spanska',
    hi: 'Hindi',
  },

  shortcuts: {
    home: 'Hem / Topp',
    subscriptions: 'Prenumerationer',
    recents: 'Senast spelade',
    settings: 'Inställningar',
    search: 'Sök',
    toggleTheme: 'Växla tema',
    previousTheme: 'Föregående tema',
    showEpisodeInfo: 'Visa avsnittsinfo',
    queue: 'Kö',
    playPause: 'Spela / Pausa',
    seekBack: 'Spola bakåt',
    seekAhead: 'Spola framåt',
    seekToPercent: 'Hoppa till n %',
    nextEpisode: 'Nästa avsnitt',
    previousEpisode: 'Föregående avsnitt',
    increaseSpeed: 'Öka hastighet',
    decreaseSpeed: 'Sänk hastighet',
    toggleMute: 'Växla ljud av/på',
    showShortcuts: 'Visa kortkommandon',
  },

  themes: {
    autumnLight: 'Höstljus',
    autumnDark: 'Höstmörker',
    lightBlurb: 'Rent och ljust utseende',
    darkBlurb: 'Optimerat för mörka miljöer',
  },

  errors: {
    notFound: 'Sidan hittades inte',
    notFoundDescription: 'Sidan du letar efter finns inte',
    goHome: 'Gå hem',
  },
};
