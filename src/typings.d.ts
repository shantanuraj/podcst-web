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
}

interface FileInfo {
  url: string;
  length: string;
  type: string;
}


