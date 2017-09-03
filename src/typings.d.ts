/**
 * Podcast typings
 */
export interface SubscriptionMap {
  [feed: string]: Podcast
}

export interface Podcast {
  title: string;
  link: string;
  published: number;
  description: string;
  author: string;
  cover: string;
  keywords: string[];
  explicit: boolean;
  episodes: Episode[];
}

export interface Episode {
  title: string;
  summary?: string;
  showNotes: string;
  published?: number;
  cover: string;
  explicit: boolean;
  duration?: number;
  link?: string;
  file: FileInfo;
  author?: string;
  episodeArt?: string;
}

interface FileInfo {
  url: string;
  length: string;
  type: string;
}
