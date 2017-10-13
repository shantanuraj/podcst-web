/**
 * Shared Explicit state type
 */
type ExplicitState = 'explicit' | 'cleaned' | 'notExplicit';

type FeedType =
  'top';

/**
 * Application type dependencies
 */
declare namespace App {
  /**
   * Adapted Podcast interface
   */
  interface Podcast {
    /**
     * iTunes id of the podcast
     */
    id: number;
    /**
     * Podcast author
     */
    author: string;
    /**
     * Podcast rss feed
     */
    feed: string;
    /**
     * Podcast title
     */
    title: string;
    /**
     * Podcast large cover art
     */
    cover: string;
    /**
     * Podcast small cover art
     */
    thumbnail: string;
    /**
     * List of categories podcast appears in
     */
    categories: number[];
    /**
     * Podcast's explicitness
     */
    explicit: ExplicitState;
    /**
     * Podcast's episode count
     */
    count: number;
  }

  /**
   * Adapted Episode interface
   */
  interface Episode {
    title: string;
    summary: string | null;
    published: number | null;
    cover: string | null;
    explicit: boolean;
    duration: number | null;
    link: string | null;
    file: FileInfo;
    author: string | null;
    episodeArt: string | null;
    showNotes: string;
  }

  /**
   * Adapted Episode with feed info
   */
  interface EpisodeInfo extends Episode {
    feed: string;
  }

  /**
   * Episode listing
   */
  interface EpisodeListing {
    title: string;
    link: string;
    published: number | null;
    description: string;
    author: string;
    cover: string;
    keywords: string[];
    explicit: boolean;
    episodes: Episode[];
  }

  /**
   * Episode info listing
   */
  interface PodcastEpisodesInfo extends EpisodeListing {
    episodes: EpisodeInfo[];
  }

  type RenderablePodcast = Podcast | (PodcastEpisodesInfo & {
    feed: string;
  });

  /**
   * Podcasts Search result interface
   */
  interface PodcastSearchResult {
    author: string;
    feed: string;
    thumbnail: string;
    title: string;
  }

  type ThemeMode = 'dark' | 'light';

  interface Theme {
    accent: string;
    background: string;
    backgroundDark: string;
    backgroundLight: string;
    backgroundSearch: string;
    loaderAnimation: string;
    subTitle: string;
    text: string;
    textLight: string;
  }
}

interface SubscriptionsMap {
  [feed: string]: App.RenderablePodcast;
}

interface FileInfo {
  url: string;
  length: string;
  type: string;
}

interface OPMLFeed {
  title: string;
  feed: string;
}

interface OPMLJson {
  feeds: OPMLFeed[];
}

type EpisodePlayerState =
  'playing' |
  'paused'  |
  'stopped';

type KeyboardShortcuts =
  'play' |
  'next' |
  'prev' |
  'seek-back' |
  'seek-forward' |
  'dismiss' |
  'focus' |
  'up' |
  'down' |
  'change-theme' |
  'episode-info' |
  'settings' |
  'select';

interface KeyboardShortcutsMap {
  [keyCode: number]: KeyboardShortcuts;
}

interface PodcastWebpackModule {
  hot?: {
    accept: () => void;
  };
}

declare let module: PodcastWebpackModule;

type Require = (package: string) => void;

declare let require: Require;

interface Process {
  env: {
    APP_VERSION: string;
    IN_BROWSER: string;
    NODE_ENV: 'development' | 'produciton';
  }
}

interface Artwork {
  src: string;
  sizes: '96x96' | '128x128' | '192x192' | '256x256' | '384x384' | '512x512';
  type: 'image/png' | 'image/jpeg';
}

interface ChromeMediaMetadataProps {
  album: string;
  artist: string;
  artwork: Artwork[];
  title: string;
}

interface ChromeMediaMetadata {
  new(props: ChromeMediaMetadataProps): ChromeMediaMetadata;
}

type ChromeMediaSessionEvents =
  'play' |
  'pause' |
  'seekbackward' |
  'seekforward' |
  'previoustrack' |
  'nexttrack';

type ChromeEventHandler = () => void;

interface ChromeMediaSession {
  setActionHandler(ChromeMediaSessionEvents, ChromeEventHandler);
  metadata: ChromeMediaMetadata;
}

interface ChromeNavigator extends Navigator {
  mediaSession: ChromeMediaSession;
}

interface ReduxDevToolsEnabledWindow extends Window {
  __REDUX_DEVTOOLS_EXTENSION_COMPOSE__: any;
}

declare let process: Process;

declare let MediaMetadata: ChromeMediaMetadata;
