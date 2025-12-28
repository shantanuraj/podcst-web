import type { Messages } from './en';

export const messages: Messages = {
  common: {
    appName: 'Podcst',
    version: 'Version',
    madeBy: 'Créé par',
    author: 'Shantanu Raj',
    loading: 'Chargement...',
    error: 'Une erreur est survenue',
  },

  nav: {
    discover: 'Découvrir',
    library: 'Bibliothèque',
    settings: 'Réglages',
    profile: 'Profil',
    signIn: 'Se connecter',
    signOut: 'Se déconnecter',
  },

  search: {
    placeholder: 'Rechercher des podcasts...',
    noResults: 'Aucun podcast trouvé',
    label: 'Rechercher des podcasts',
  },

  auth: {
    title: 'Connexion',
    subtitle: 'Utilisez votre email pour continuer',
    emailPlaceholder: 'vous@exemple.fr',
    continue: 'Continuer',
    continuing: 'Continuer...',
    useADifferentEmail: 'Utiliser un autre email',
    verifyTitle: 'Vérifiez votre email',
    verifySubtitle: 'Nous avons envoyé un code à {email}',
    codePlaceholder: '000000',
    enterCode: 'Entrez le code',
    verify: 'Vérifier',
    verifying: 'Vérification...',
    resendCode: 'Renvoyer le code',
    resending: 'Renvoi...',
    codeSent: 'Nouveau code envoyé !',
    createPasskey: 'Utiliser une clé d’accès à la place',
  },

  settings: {
    title: 'Réglages',
    language: 'Langue',
    languageDescription: 'Langue de l’interface',
    region: 'Région',
    regionDescription:
      'Choisissez votre région pour les classements de podcasts',
    theme: 'Thème',
    themeDescription: 'Personnalisez l’apparence de Podcst',
    shortcuts: 'Raccourcis clavier',
    shortcutsDescription: 'Voir et gérer les raccourcis',
    export: 'Exporter',
    exportDescription: 'Téléchargez votre bibliothèque au format OPML',
    exportDescriptionLong:
      'Téléchargez vos abonnements au format OPML pour les importer dans d’autres applications.',
    emptyLibrary: 'Votre bibliothèque est vide',
    emptyLibraryDescription:
      'Abonnez-vous à des podcasts pour construire votre bibliothèque personnelle, ou importez vos abonnements existants depuis une autre application.',
    browsePopularPodcasts: 'Parcourir les podcasts populaires',
    exportLibrary: 'Exporter la bibliothèque',
    exportLibraryDescription:
      'Téléchargez votre bibliothèque au format OPML. Vous pouvez utiliser ce fichier pour importer vos podcasts dans d’autres applications.',
    exportLibraryCta: 'Télécharger le fichier OPML',
    exportLibraryCount:
      '{count} {count, plural, one {podcast} other {podcasts}} dans votre bibliothèque',
  },

  profile: {
    title: 'Profil',
    account: 'Compte',
    subscriptions: 'Abonnements',
    syncDescription:
      'Vous avez {count} {count, plural, one {podcast enregistré} other {podcasts enregistrés}} sur cet appareil. Importez-les sur votre compte pour les synchroniser sur tous vos appareils.',
    importFromDevice: 'Importer depuis l’appareil',
    importing: 'Importation...',
    downloadOPML: 'Télécharger OPML',
  },

  player: {
    nowPlaying: 'Lecture en cours',
    play: 'Lire',
    pause: 'Pause',
    seekBack: 'Retour arrière',
    seekForward: 'Avancer',
    speed: 'Vitesse de lecture',
    mute: 'Muet',
    unmute: 'Réactiver le son',
    queue: 'Voir la file d’attente',
    airplay: 'AirPlay',
    chromecast: 'Cast',
  },

  podcast: {
    subscribe: 'S’abonner',
    subscribed: 'Abonné',
    unsubscribe: 'Se désabonner',
    episodes: 'Épisodes',
    showNotes: 'Notes de l’épisode',
    playEpisode: 'Lire l’épisode',
    addToQueue: 'Ajouter à la file d’attente',
    share: 'Partager',
    episodeCount: '{count} épisodes',
  },

  library: {
    title: 'Bibliothèque',
    empty: 'Aucun podcast pour le moment',
    emptyDescription: 'Abonnez-vous à des podcasts pour les voir ici',
    recents: 'Écoutés récemment',
    subscriptions: 'Abonnements',
  },

  feed: {
    trending: 'Tendances',
    topPodcasts: 'Classements',
    newReleases: 'Nouveautés',
  },

  queue: {
    title: 'File d’attente',
    empty: 'Ajoutez des épisodes à la file d’attente pour les voir ici',
  },

  regions: {
    us: 'États-Unis',
    nl: 'Pays-Bas',
    ca: 'Canada',
    kr: 'Corée du Sud',
    my: 'Malaisie',
    in: 'Inde',
    mx: 'Mexique',
    fr: 'France',
    se: 'Suède',
    no: 'Norvège',
  },

  languages: {
    en: 'Anglais',
    nl: 'Néerlandais',
    fr: 'Français',
    sv: 'Suédois',
    ko: 'Coréen',
    es: 'Espagnol',
    hi: 'Hindi',
  },

  shortcuts: {
    home: 'Accueil / Tops',
    subscriptions: 'Abonnements',
    recents: 'Récents',
    settings: 'Réglages',
    search: 'Recherche',
    toggleTheme: 'Changer de thème',
    previousTheme: 'Thème précédent',
    showEpisodeInfo: 'Voir les infos de l’épisode',
    queue: 'File d’attente',
    playPause: 'Lecture / Pause',
    seekBack: 'Retour arrière',
    seekAhead: 'Avancer',
    seekToPercent: 'Sauter à n %',
    nextEpisode: 'Épisode suivant',
    previousEpisode: 'Épisode précédent',
    increaseSpeed: 'Augmenter la vitesse',
    decreaseSpeed: 'Diminuer la vitesse',
    toggleMute: 'Couper/Réactiver le son',
    showShortcuts: 'Afficher les raccourcis',
  },

  themes: {
    autumnLight: 'Automne Clair',
    autumnDark: 'Automne Sombre',
    lightBlurb: 'Apparence propre et lumineuse',
    darkBlurb: 'Optimisé pour les environnements sombres',
  },

  errors: {
    notFound: 'Page non trouvée',
    notFoundDescription: 'La page que vous recherchez n’existe pas',
    goHome: 'Retour à l’accueil',
  },
};
