import type { Messages } from './en';

export const messages: Messages = {
  common: {
    appName: 'Podcst',
    version: 'वर्जन',
    madeBy: 'निर्माता',
    author: 'शान्तनु राज',
    loading: 'लोड हो रहा है...',
    error: 'कुछ गलत हो गया',
  },

  nav: {
    discover: 'टॉप',
    library: 'लाइब्रेरी',
    settings: 'सेटिंग्स',
    profile: 'प्रोफ़ाइल',
    signIn: 'साइन इन',
    signOut: 'साइन आउट',
  },

  search: {
    placeholder: 'पॉडकास्ट खोजें...',
    episodesPlaceholder: 'एपिसोड खोजें...',
    noResults: 'कोई पॉडकास्ट नहीं मिला',
    label: 'पॉडकास्ट खोजें',
  },

  auth: {
    title: 'साइन इन',
    subtitle: 'जारी रखने के लिए अपना ईमेल उपयोग करें',
    emailPlaceholder: 'you@example.com',
    continue: 'जारी रखें',
    continuing: 'जारी है...',
    useADifferentEmail: 'दूसरे ईमेल का उपयोग करें',
    verifyTitle: 'अपना ईमेल सत्यापित करें',
    verifySubtitle: 'हमने {email} पर एक कोड भेजा है',
    codePlaceholder: '000000',
    enterCode: 'कोड दर्ज करें',
    verify: 'सत्यापित करें',
    verifying: 'सत्यापित हो रहा है...',
    resendCode: 'कोड दोबारा भेजें',
    resending: 'दोबारा भेजा जा रहा है...',
    codeSent: 'नया कोड भेज दिया गया है!',
    createPasskey: 'इसके बजाय पासकी का उपयोग करें',
  },

  settings: {
    title: 'सेटिंग्स',
    language: 'भाषा',
    languageDescription: 'इंटरफ़ेस भाषा',
    region: 'क्षेत्र',
    regionDescription: 'टॉप पॉडकास्ट चार्ट के लिए अपना क्षेत्र चुनें',
    theme: 'थीम',
    themeDescription: 'Podcst का स्वरूप बदलें',
    shortcuts: 'कीबोर्ड शॉर्टकट्स',
    shortcutsDescription: 'शॉर्टकट्स देखें और प्रबंधित करें',
    export: 'निर्यात करें',
    exportDescription: 'अपनी लाइब्रेरी को OPML फ़ाइल के रूप में डाउनलोड करें',
    exportDescriptionLong:
      'अपनी सदस्यताओं को अन्य ऐप्स में आयात करने के लिए OPML फ़ाइल के रूप में डाउनलोड करें।',
    emptyLibrary: 'आपकी लाइब्रेरी खाली है',
    emptyLibraryDescription:
      'अपनी व्यक्तिगत लाइब्रेरी बनाने के लिए पॉडकास्ट को सब्सक्राइब करें, या किसी अन्य ऐप से अपनी मौजूदा सदस्यताएँ आयात करें।',
    browsePopularPodcasts: 'लोकप्रिय पॉडकास्ट देखें',
    exportLibrary: 'लाइब्रेरी निर्यात करें',
    exportLibraryDescription:
      'अपनी लाइब्रेरी को OPML फ़ाइल के रूप में डाउनलोड करें। आप इस फ़ाइल का उपयोग अन्य एप्लिकेशन्स में अपने पॉडकास्ट आयात करने के लिए कर सकते हैं।',
    exportLibraryCta: 'OPML फ़ाइल डाउनलोड करें',
    exportLibraryCount:
      'आपकी लाइब्रेरी में {count} {count, plural, one {पॉडकास्ट} other {पॉडकास्ट}} हैं',
  },

  profile: {
    title: 'प्रोफ़ाइल',
    account: 'अकाउंट',
    subscriptions: 'सदस्यताएँ',
    syncDescription:
      'इस डिवाइस पर आपके {count} पॉडकास्ट सुरक्षित हैं। सभी डिवाइसेस पर सिंक करने के लिए उन्हें अपने अकाउंट में आयात करें।',
    importFromDevice: 'डिवाइस से आयात करें',
    importing: 'आयात हो रहा है...',
    downloadOPML: 'OPML डाउनलोड करें',
  },

  player: {
    nowPlaying: 'अभी चल रहा है',
    play: 'चलाएं',
    pause: 'रोकें',
    resume: 'जारी रखें',
    seekBack: 'पीछे ले जाएं',
    seekForward: 'आगे ले जाएं',
    speed: 'प्लेबैक गति',
    mute: 'म्यूट',
    unmute: 'अनम्यूट',
    queue: 'कतार देखें',
    airplay: 'AirPlay',
    chromecast: 'Cast',
  },

  podcast: {
    subscribe: 'सब्सक्राइब',
    subscribed: 'सब्सक्राइब किया गया',
    unsubscribe: 'अनसब्सक्राइब',
    episodes: 'एपिसोड',
    showNotes: 'एपिसोड नोट्स',
    playEpisode: 'एपिसोड चलाएं',
    addToQueue: 'कतार में जोड़ें',
    share: 'शेयर',
    episodeCount: '{count, plural, one {# एपिसोड} other {# एपिसोड}}',
    episodeSearchCount:
      '{total} में से {count} {total, plural, one {एपिसोड} other {एपिसोड}}',
    sort: 'क्रम:',
    sortOptions: {
      releaseDesc: 'रिलीज़ की तारीख (नया → पुराना)',
      releaseAsc: 'रिलीज़ की तारीख (पुराना → नया)',
      titleAsc: 'शीर्षक (A → Z)',
      titleDesc: 'शीर्षक (Z → A)',
      lengthAsc: 'अवधि (छोटा → लंबा)',
      lengthDesc: 'अवधि (लंबा → छोटा)',
    },
    loadingEpisodes: 'एपिसोड लोड हो रहे हैं...',
    loadError: 'एपिसोड लोड करने में विफल',
    loadingMore: 'और लोड हो रहा है...',
    allLoaded: 'सभी एपिसोड लोड हो गए',
  },

  library: {
    title: 'लाइब्रेरी',
    empty: 'अभी तक कोई पॉडकास्ट नहीं',
    emptyDescription: 'उन्हें यहां देखने के लिए पॉडकास्ट सब्सक्राइब करें',
    recents: 'हाल ही में चलाए गए',
    subscriptions: 'सदस्यताएँ',
  },

  feed: {
    trending: 'ट्रेंडिंग',
    topPodcasts: 'टॉप चार्ट्स',
    newReleases: 'नई रिलीज़',
  },

  queue: {
    title: 'कतार',
    empty: 'उन्हें यहां देखने के लिए कतार में कुछ एपिसोड जोड़ें',
  },

  regions: {
    us: 'संयुक्त राज्य अमेरिका',
    nl: 'नीदरलैंड',
    ca: 'कनाडा',
    kr: 'दक्षिण कोरिया',
    my: 'मलेशिया',
    in: 'भारत',
    mx: 'मेक्सिको',
    fr: 'फ्रांस',
    se: 'स्वीडन',
    no: 'नार्वे',
  },

  languages: {
    en: 'अंग्रेजी',
    nl: 'डच',
    fr: 'फ्रांसीसी',
    sv: 'स्वीडिश',
    ko: 'कोरियाई',
    es: 'स्पेनिश',
    hi: 'हिन्दी',
  },

  shortcuts: {
    home: 'होम / टॉप',
    subscriptions: 'सदस्यताएँ',
    recents: 'हालिया',
    settings: 'सेटिंग्स',
    search: 'खोजें',
    toggleTheme: 'थीम बदलें',
    previousTheme: 'पिछली थीम',
    showEpisodeInfo: 'एपिसोड की जानकारी दिखाएं',
    queue: 'कतार',
    playPause: 'चलाएं / रोकें',
    seekBack: 'पीछे ले जाएं',
    seekAhead: 'आगे ले जाएं',
    seekToPercent: 'n % पर जाएं',
    nextEpisode: 'अगला एपिसोड',
    previousEpisode: 'पिछला एपिसोड',
    increaseSpeed: 'प्लेबैक गति बढ़ाएं',
    decreaseSpeed: 'प्लेबैक गति कम करें',
    toggleMute: 'म्यूट बदलें',
    showShortcuts: 'शॉर्टकट्स दिखाएं',
  },

  themes: {
    autumnLight: 'ऑटम लाइट',
    autumnDark: 'ऑटम डार्क',
    lightBlurb: 'साफ और उज्ज्वल स्वरूप',
    darkBlurb: 'कम रोशनी वाले वातावरण के लिए अनुकूलित',
  },

  errors: {
    notFound: 'पेज नहीं मिला',
    notFoundDescription: 'आप जिस पेज की तलाश कर रहे हैं वह मौजूद नहीं है',
    goHome: 'होम पर जाएं',
  },
};
