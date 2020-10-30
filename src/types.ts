/* tslint:disable:no-namespace */

/**
 * Shared Explicit state type
 */
export type ExplicitState = 'explicit' | 'cleaned' | 'notExplicit';

export type FeedType = 'top';

/**
 * Adapted Podcast interface
 */
export interface IPodcast {
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
export interface IEpisode {
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
export interface IEpisodeInfo extends IEpisode {
  feed: string;
}

/**
 * Episode listing
 */
export interface IEpisodeListing {
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
export interface IPodcastEpisodesInfo extends IEpisodeListing {
  episodes: IEpisodeInfo[];
  feed: string;
}

export type RenderablePodcast = IPodcast | IPodcastEpisodesInfo;

/**
 * Podcasts Search result interface
 */
export interface IPodcastSearchResult {
  id: number;
  author: string;
  feed: string;
  thumbnail: string;
  title: string;
}

export type ThemeMode = 'dark' | 'light';

export interface ITheme {
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

export interface ISubscriptionsMap {
  [feed: string]: IPodcastEpisodesInfo;
}

export interface IFileInfo {
  url: string;
  length: string;
  type: string;
}

export interface IOPMLFeed {
  title: string;
  feed: string;
}

export interface IOPMLJson {
  feeds: IOPMLFeed[];
}

export type EpisodePlayerState = 'playing' | 'paused' | 'stopped';

export type KeyboardShortcuts =
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
  | 'toggle-drawer'
  | 'select';

export interface IKeyboardShortcutsMap {
  [keyCode: number]: KeyboardShortcuts;
}

export interface IPodcastWebpackModule {
  hot?: {
    accept: (val?: string, cb?: () => void) => void;
  };
}

export interface IProcess {
  env: {
    APP_VERSION: string;
    IN_BROWSER: string;
    NODE_ENV: 'development' | 'produciton';
  };
}

export interface IArtwork {
  src: string;
  sizes: '96x96' | '128x128' | '192x192' | '256x256' | '384x384' | '512x512';
  type: 'image/png' | 'image/jpeg';
}

export interface IChromeMediaMetadataProps {
  album: string;
  artist: string;
  artwork: IArtwork[];
  title: string;
}

export interface IChromeMediaMetadataClass {
  new (props: IChromeMediaMetadataProps): IChromeMediaMetadata;
}

export interface IChromeMediaMetadata {
  __data: string;
}

export type ChromeMediaSessionEvents =
  | 'play'
  | 'pause'
  | 'seekbackward'
  | 'seekforward'
  | 'previoustrack'
  | 'nexttrack';

export type ChromeEventHandler = () => void;

export interface IChromeMediaSession {
  metadata: IChromeMediaMetadata;
  setActionHandler(event: ChromeMediaSessionEvents, handleR: ChromeEventHandler): void;
}

export interface IChromeNavigator extends Navigator {
  mediaSession: IChromeMediaSession;
}

export interface INavigatorShareProps {
  text: string;
  title: string;
  url: string;
}

export interface IShareEnabledNavigator extends Navigator {
  share(info: INavigatorShareProps): Promise<undefined>;
}
