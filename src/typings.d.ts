/* tslint:disable:no-namespace */

/**
 * Shared Explicit state type
 */
type ExplicitState = 'explicit' | 'cleaned' | 'notExplicit';

type FeedType = 'top';

/**
 * Application type dependencies
 */
declare namespace App {
  /**
   * Adapted Podcast interface
   */
  interface IPodcast {
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
  interface IEpisode {
    title: string;
    summary: string | null;
    published: number | null;
    cover: string;
    explicit: boolean;
    duration: number | null;
    link: string | null;
    file: IFileInfo;
    author: string | null;
    episodeArt: string | null;
    showNotes: string;
  }

  /**
   * Adapted Episode with feed info
   */
  interface IEpisodeInfo extends IEpisode {
    feed: string;
  }

  /**
   * Episode listing
   */
  interface IEpisodeListing {
    title: string;
    link: string;
    published: number | null;
    description: string;
    author: string;
    cover: string;
    keywords: string[];
    explicit: boolean;
    episodes: IEpisode[];
  }

  /**
   * Episode info listing
   */
  interface IPodcastEpisodesInfo extends IEpisodeListing {
    episodes: IEpisodeInfo[];
  }

  type RenderablePodcast =
    | IPodcast
    | (IPodcastEpisodesInfo & {
        feed: string;
      });

  /**
   * Podcasts Search result interface
   */
  interface IPodcastSearchResult {
    author: string;
    feed: string;
    thumbnail: string;
    title: string;
  }

  type ThemeMode = 'dark' | 'light';

  interface ITheme {
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

interface ISubscriptionsMap {
  [feed: string]: App.RenderablePodcast;
}

interface IFileInfo {
  url: string;
  length: string;
  type: string;
}

interface IOPMLFeed {
  title: string;
  feed: string;
}

interface IOPMLJson {
  feeds: IOPMLFeed[];
}

type EpisodePlayerState = 'playing' | 'paused' | 'stopped';

type KeyboardShortcuts =
  | 'play'
  | 'next'
  | 'prev'
  | 'seek-back'
  | 'seek-forward'
  | 'dismiss'
  | 'focus'
  | 'up'
  | 'down'
  | 'change-theme'
  | 'episode-info'
  | 'settings'
  | 'select';

interface IKeyboardShortcutsMap {
  [keyCode: number]: KeyboardShortcuts;
}

interface IPodcastWebpackModule {
  hot?: {
    accept: () => void;
  };
}

declare let module: IPodcastWebpackModule;

type Require = (package: string) => void;

declare let require: Require;

interface IProcess {
  env: {
    APP_VERSION: string;
    IN_BROWSER: string;
    NODE_ENV: 'development' | 'produciton';
  };
}

interface IArtwork {
  src: string;
  sizes: '96x96' | '128x128' | '192x192' | '256x256' | '384x384' | '512x512';
  type: 'image/png' | 'image/jpeg';
}

interface IChromeMediaMetadataProps {
  album: string;
  artist: string;
  artwork: IArtwork[];
  title: string;
}

interface IChromeMediaMetadata {
  new (props: IChromeMediaMetadataProps): {};
}

type ChromeMediaSessionEvents = 'play' | 'pause' | 'seekbackward' | 'seekforward' | 'previoustrack' | 'nexttrack';

type ChromeEventHandler = () => void;

interface IChromeMediaSession {
  metadata: IChromeMediaMetadata;
  setActionHandler(ChromeMediaSessionEvents, ChromeEventHandler);
}

interface IChromeNavigator extends Navigator {
  mediaSession: IChromeMediaSession;
}

interface IReduxDevToolsEnabledWindow extends Window {
  __REDUX_DEVTOOLS_EXTENSION_COMPOSE__: any;
}

declare let process: IProcess;

declare let MediaMetadata: IChromeMediaMetadata;
