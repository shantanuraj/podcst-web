/* tslint:disable:no-namespace */

/**
 * Shared Explicit state type
 */
export type ExplicitState = 'explicit' | 'cleaned' | 'notExplicit';

export type FeedType = 'top';

/**
 * iTunes typings
 */
export namespace iTunes {
  /**
   * Search response interface
   */
  export interface Response {
    results: Podcast[];
  }

  export interface Podcast {
    /**
     * Podcast author name
     */
    artistName: string;
    /**
     * Podcast cover art 100x100 size
     */
    artworkUrl100: string;
    /**
     * Podcast cover art 600x600 size
     */
    artworkUrl600: string;
    /**
     * Censored Podcast name
     */
    collectionCensoredName: string;
    /**
     * Explicit status
     */
    collectionExplicitness: ExplicitState;
    /**
     * Podcast ID
     */
    collectionId: number;
    /**
     * Podcast name
     */
    collectionName: string;
    /**
     * iTunes URL
     */
    collectionViewUrl: string;
    /**
     * RSS feed url
     */
    feedUrl: string;
    /**
     * Podcast categories list numeric string ids
     */
    genreIds: string[];
    /**
     * Podcast categories list
     */
    genres: string[];
    /**
     * Entity type must always be `podcast`
     */
    kind: 'podcast';
    /**
     * Primary category
     */
    primaryGenreName: string;
    /**
     * ISO Release date
     */
    releaseDate: string;
    /**
     * Episodes count
     */
    trackCount: number;
  }

  /**
   * Feed Response interface
   */
  export interface FeedResponse {
    feed: {
      /**
       * List of feed podcasts
       */
      entry: FeedPodcast[];
    };
  }

  export interface FeedPodcast {
    id: {
      attributes: {
        /**
         * Numeric string id
         */
        'im:id': string;
      };
    };
  }
}

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
  id?: number;
  podcastId?: number;
  feed: string;
  podcastTitle?: string;
}

/**
 * Episode listing
 */
export interface IEpisodeListing {
  title: string;
  link: string | null;
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
  id?: number;
  episodes: IEpisodeInfo[];
  feed: string;
}

export type RenderablePodcast = IPodcast | IPodcastEpisodesInfo;

/**
 * Podcasts Search result interface
 */
export interface IPodcastSearchResult {
  id?: number;
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
  length: number;
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

export interface IPlaybackControls {
  seekPosition: number;
  setSeekPosition: (position: number) => void;
  playEpisode: (episode: IEpisodeInfo, seekPosition?: number) => void;
  resumeEpisode: () => void;
  togglePlayback: () => void;
  setPlayerState: (state: 'playing' | 'paused' | 'idle') => void;
  seekBackward: () => void;
  seekForward: () => void;
  seekTo: (seconds: number) => void;
  setVolume: (volume: number) => void;
  mute: (muted: boolean) => void;
  rate: number;
  setRate: (rate: number) => void;
  savedRate: number | undefined;
  setOverridenRate: (rate: number | undefined) => void;
  seekOrStartAt: (episode: IEpisodeInfo, seekPosition: number) => void;
}

export interface IShortUrl {
  feed: string;
  guid: string;
}
