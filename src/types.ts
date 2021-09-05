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
  guid: string;
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

export type PlayerState = 'playing' | 'paused' | 'idle' | 'buffering';

export interface INavigatorShareProps {
  text: string;
  title: string;
  url: string;
}

export interface IShareEnabledNavigator extends Navigator {
  share(info: INavigatorShareProps): Promise<undefined>;
}

export interface IPlaybackControls {
  seekPosition: number;
  setSeekPosition: (position: number) => void;
  playEpisode: (episode: IEpisodeInfo) => void;
  resumeEpisode: () => void;
  togglePlayback: () => void;
  setPlayerState: (state: 'playing' | 'paused' | 'idle') => void;
  seekBackward: () => void;
  seekForward: () => void;
  seekTo: (seconds: number) => void;
  setVolume: (volume: number) => void;
  mute: (muted: boolean) => void;
  setRate: (rate: number) => void;
}
