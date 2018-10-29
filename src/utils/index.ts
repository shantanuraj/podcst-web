/**
 * Utility functions
 */

import { App, IOPMLFeed, IOPMLJson } from '../typings';

import { FormEvent } from 'react';

/**
 * Simple event value extractor callback
 * @param fn - Callback to execute with string value
 */
export const onEvent = <T extends FormEvent>(fn: (val: string) => void) => {
  return (event: Event | T) => {
    const target = event.target as HTMLInputElement;
    fn(target.value);
  };
};

const URL_REGEX = /^https?\:\//;

const HOST_REGEX = /^https?\:\/\/(www\.)?(.*)/;

/**
 * Returns normalized link
 */
const getLink = (token: string, maybeSpace: string): string => {
  const trimmedToken = token.trim();
  const lastChar = trimmedToken[trimmedToken.length - 1];
  let normalizedToken = trimmedToken;
  let seperator = maybeSpace;
  if (lastChar === '.') {
    normalizedToken = trimmedToken.slice(0, -1);
    seperator = lastChar + maybeSpace;
  }
  return `<a target="_blank" href="${normalizedToken}">${normalizedToken}</a><span>${seperator}</span>`;
};

/**
 * Linkify text
 */
export const linkifyText = (text: string): string => {
  const tokens = text.split(/\s/);
  const linkifed = tokens.map((token, i) => {
    const hasSpace = i !== tokens.length - 1;
    const maybeSpace = hasSpace ? ' ' : '';

    if (URL_REGEX.test(token)) {
      return getLink(token, maybeSpace);
    } else {
      return token + maybeSpace;
    }
  });

  return linkifed.join('');
};

/**
 * Strip host from link
 */
export const stripHost = (link: string): string => {
  const matches = link.match(HOST_REGEX) as RegExpMatchArray;
  if (matches && matches[2]) {
    return matches[2].split('/')[0];
  }
  return link.split('/')[0];
};

/**
 * Scroll to top helper
 */
export const scrollToTop = () => process.env.IN_BROWSER && window.scrollTo(0, 0);

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Get month name for month number
 */
export const monthName = (monthNumber: number) => months[monthNumber];

/**
 * Format remaining time
 */
export const formatTime = (time: number) => {
  const date = new Date(0);
  date.setSeconds(time);

  const res = date.toISOString().substr(11, 8);
  const [hh] = res.split(':');

  return res.slice(hh === '00' ? 3 : 0);
};

/**
 * Element selector for ignoring keyboard events
 */
const ignoreKeyboardSelector = 'header *';

/**
 * Boolean check for ignore selector
 */
export const isNotIgnoreElement = (target: EventTarget | null) =>
  !!target && !(target as HTMLElement).matches(ignoreKeyboardSelector);

/**
 * Parse OPML XML element to JSON
 */
const adaptFeed = (el: HTMLElement): IOPMLFeed => ({
  title: el.getAttribute('text') as string,
  feed: el.getAttribute('xmlUrl') as string,
});

/**
 * Parse OPML XML to JSON feed
 */
export const opmltoJSON = (file: string): IOPMLJson => {
  const parser = new DOMParser();
  const xml = parser.parseFromString(file, 'text/xml');
  const feeds = Array.from(xml.querySelectorAll('outline[type="rss"]')) as HTMLElement[];

  return {
    feeds: feeds.map(adaptFeed),
  };
};

/**
 * Get episodes route for podcast episode listing
 */
export const getEpisodesRoute = (feed: string): string => {
  return `/episodes?feed=${encodeURIComponent(feed)}`;
};

/**
 * Get episode route for info
 */
export const getEpisodeRoute = (feed: string, title: string): string => {
  return `/episode?feed=${encodeURIComponent(feed)}&title=${encodeURIComponent(title)}`;
};

/**
 * Not null utility
 */
export const notNull = <T>(val: T | null) => val !== null;

/**
 * Add feed prop to episodes
 */
export const patchEpisodesResponse = (feed: string) => (
  res: App.IEpisodeListing | null,
): App.IPodcastEpisodesInfo | null => {
  if (res) {
    const episodes: App.IEpisodeInfo[] = res.episodes.map(episode => ({ ...episode, feed }));
    return { ...res, episodes, feed };
  } else {
    return null;
  }
};

/**
 * Normalize seek value to handle edge-cases
 */
export const normalizeSeek = (seekTo: number, duration: number) => {
  if (seekTo < 0) {
    return 0;
  } else if (seekTo > duration) {
    return duration;
  }

  return seekTo;
};

/**
 * Get placeholder image link based on theme mode
 */
export const placeholderURL = (mode: App.ThemeMode) => `url(/icons/launcher-${mode}.svg)`;

/**
 * Get css rule for image with placeholder
 */
export const imageWithPlaceholder = (mode: App.ThemeMode, ...images: string[]) =>
  images
    .filter(notNull)
    .map(i => `url(${i})`)
    .concat(placeholderURL(mode))
    .join(', ');
