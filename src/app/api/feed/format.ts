/**
 * Podcast parsing utilities
 */

import type { IEpisodeListing, IPodcastSearchResult } from '@/types';

/**
 * Extract base link from a url
 */
export const extractBaseLink = (url: string): string | null => {
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    const { protocol, host } = parsed;
    return `${protocol}//${host}`;
  } catch (_err) {
    return null;
  }
};

/**
 * Style attribute regex
 */
const STYLE_ATTR_REGEX = /style="[^"]*"/g;

/**
 * Reformat show notes to strip out custom styles
 */
export const reformatShowNotes = (notes: string) => {
  const reformattedNotes = notes.replace(STYLE_ATTR_REGEX, '');

  return reformattedNotes;
};

/**
 * Show notes count comparator
 */
export const showNotesSorter = (a: string, b: string) => a.length - b.length;

/**
 * Convert feed response to search response
 */
export const feedToSearchResponse =
  (feed: string) =>
  (res: IEpisodeListing | null): IPodcastSearchResult[] =>
    res
      ? [
          {
            feed,
            author: res.author,
            thumbnail: res.cover,
            title: res.title,
          },
        ]
      : [];
