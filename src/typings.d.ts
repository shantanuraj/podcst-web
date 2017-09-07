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

  type RenderablePodcast = Podcast | (EpisodeListing & {
    feed: string;
  });
}

interface SubscriptionsMap {
  [feed: string]: App.EpisodeListing;
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
  'dismiss' |
  'focus' |
  'up' |
  'down';

interface KeyboardShortcutsMap {
  [keyCode: number]: KeyboardShortcuts;
}

interface PodcastWebpackModule {
  hot?: {
    accept: () => void;
  };
}

declare let module: PodcastWebpackModule;