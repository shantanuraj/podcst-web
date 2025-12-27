export const messages = {
  common: {
    appName: 'Podcst',
    version: 'Version',
    madeBy: 'Made by',
    loading: 'Loading...',
    error: 'Something went wrong',
  },

  nav: {
    discover: 'Discover',
    library: 'Library',
    settings: 'Settings',
    profile: 'Profile',
    signIn: 'Sign in',
    signOut: 'Sign out',
  },

  search: {
    placeholder: 'Search podcasts...',
    noResults: 'No podcasts found',
  },

  auth: {
    title: 'Sign In',
    subtitle: 'Use your email to continue with a passkey',
    emailPlaceholder: 'you@example.com',
    continue: 'Continue',
    continuing: 'Continue...',
    useADifferentEmail: 'Use a different email',
    verifyTitle: 'Verify your email',
    verifySubtitle: 'We sent a code to {email}',
    codePlaceholder: 'Enter 6-digit code',
    verify: 'Verify',
    verifying: 'Verifying...',
    resendCode: 'Resend code',
    resending: 'Resending...',
    codeSent: 'New code sent!',
  },

  settings: {
    title: 'Settings',
    language: 'Language',
    languageDescription: 'Interface language',
    region: 'Region',
    regionDescription: 'Top podcast charts region',
    theme: 'Theme',
    themeDescription: 'Customize the appearance of Podcst',
    shortcuts: 'Keyboard Shortcuts',
    shortcutsDescription: 'View and manage shortcuts',
    export: 'Export Subscriptions',
    exportDescription: 'Download your library as an OPML file',
    emptyLibrary: 'Your Library is Empty',
    emptyLibraryDescription: 'Subscribe to podcasts to build your personal library, or import your existing subscriptions from another app.',
    browsePopularPodcasts: 'Browse popular podcasts',
    exportLibrary: 'Export Library',
    exportLibraryDescription: 'Download your library as an OPML file. You can use this file to import your podcasts into other applications',
    exportLibrayCta: 'Download OPML File',
    exportLibraryCount: '{count} {count, plural, one {podcast} other {podcasts}} in your library',
  },

  profile: {
    title: 'Profile',
    account: 'Account',
    subscriptions: 'Subscriptions',
    syncDescription:
      'You have {count} {count, plural, one {podcast} other {podcasts}} saved on this device. Import them to your account to sync across all your devices.',
    importFromDevice: 'Import from Device',
    importing: 'Importing...',
    downloadOPML: 'Download OPML',
  },

  player: {
    nowPlaying: 'Now Playing',
    play: 'Play',
    pause: 'Pause',
    seekBack: 'Seek back 10 seconds',
    seekForward: 'Seek forward 10 seconds',
    speed: 'Playback speed',
    mute: 'Mute',
    unmute: 'Unmute',
    queue: 'Queue',
    airplay: 'AirPlay',
    chromecast: 'Cast',
  },

  podcast: {
    subscribe: 'Subscribe',
    subscribed: 'Subscribed',
    unsubscribe: 'Unsubscribe',
    episodes: 'Episodes',
    showNotes: 'Show Notes',
    playEpisode: 'Play episode',
    addToQueue: 'Add to queue',
    share: 'Share',
    episodeCount: '{count} episodes',
  },

  library: {
    title: 'Library',
    empty: 'No podcasts yet',
    emptyDescription: 'Subscribe to podcasts to see them here',
    recents: 'Recently Played',
    subscriptions: 'Subscriptions',
  },

  feed: {
    trending: 'Trending',
    topPodcasts: 'Top Podcasts',
    newReleases: 'New Releases',
  },

  queue: {
    title: 'Queue',
    empty: 'Add some episodes to queue to see them here',
  },

  regions: {
    us: 'United States',
    nl: 'Netherlands',
    ca: 'Canada',
    kr: 'South Korea',
    my: 'Malaysia',
    in: 'India',
    mx: 'Mexico',
    fr: 'France',
    se: 'Sweden',
    no: 'Norway',
  },

  languages: {
    en: 'English',
    nl: 'Dutch',
    fr: 'French',
    sv: 'Swedish',
    ko: 'Korean',
    es: 'Spanish',
  },

  shortcuts: {
    home: 'Home / Top',
    subscriptions: 'Subscriptions',
    recents: 'Recents',
    settings: 'Settings',
    search: 'Search',
    toggleTheme: 'Toggle theme',
    previousTheme: 'Previous theme',
    showEpisodeInfo: 'Show episode info',
    queue: 'Queue',
    playPause: 'Play / Pause',
    seekBack: 'Seek back',
    seekAhead: 'Seek ahead',
    seekToPercent: 'Seek to n %',
    nextEpisode: 'Next episode',
    previousEpisode: 'Previous episode',
    increaseSpeed: 'Increase playback rate',
    decreaseSpeed: 'Lower playback rate',
    toggleMute: 'Toggle mute',
    showShortcuts: 'Show shortcuts',
  },

  themes: {
    autumnLight: 'Autumn Light',
    autumnDark: 'Autumn Dark',
    lightBlurb: 'Clean and bright apperance',
    darkBlurb: 'Optimized for low-light environments',
  },

  errors: {
    notFound: 'Page not found',
    notFoundDescription: "The page you're looking for doesn't exist",
    goHome: 'Go home',
  },
} as const;

export type Messages = typeof messages;
