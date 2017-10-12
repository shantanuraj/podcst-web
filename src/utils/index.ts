/**
 * Utility functions
 */

/**
 * Simple event value extractor callback
 * @param fn - Callback to execute with string value
 */
export const onEvent = (fn: (val: string) => void) => {
  return (event: Event) => {
    const target = event.target as HTMLInputElement;
    fn(target.value);
  };
};

const URL_REGEX = /^https?\:\//;

const HOST_REGEX = /^https?\:\/\/(www\.)?(.*)/;

/**
 * Linkify text
 */
export const linkifyText = (text: string): string => {
  const tokens = text.split(/\s/);
  const linkifed = tokens.map((token, i) => {
    const hasSpace = i !== (tokens.length - 1);
    const maybeSpace = hasSpace ? ' ' : '';

    if (URL_REGEX.test(token)) {
      return `<a target="_blank" href="${token}">${token}</a><span>${maybeSpace}</span>`;
    } else {
      return token + maybeSpace;
    }
  });

  return linkifed.join('');
};

/**
 * Strip host from link
 */
export const stripHost = (link: string): string => (link.match(HOST_REGEX) as RegExpMatchArray)[2].split('/')[0];

/**
 * Scroll to top helper
 */
export const scrollToTop = () => process.env.IN_BROWSER && window.scrollTo(0, 0);

const months = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Get month name for month number
 */
export const monthName = (monthNumber: number) => months[monthNumber];

/**
 * Format remaining time
 */
export const formatTime = (total: number, currentTime: number) => {
  const time = Math.round(total - currentTime);

  const date = new Date(0);
  date.setSeconds(time);

  const res = date.toISOString().substr(11, 8);
  const [ hh ] = res.split(':');

  return res.slice((hh === '00') ? 3 : 0);
};

/**
 * Element selector for ignoring keyboard events
 */
const ignoreKeyboardSelector = 'header *';

/**
 * Boolean check for ignore selector
 */
export const isNotIgnoreElement = (target: EventTarget) => !(target as HTMLElement).matches(ignoreKeyboardSelector);

/**
 * Parse OPML XML element to JSON
 */
const adaptFeed = (el: HTMLElement): OPMLFeed => ({
  title: el.getAttribute('text') as string,
  feed: el.getAttribute('xmlUrl') as string,
});

/**
 * Parse OPML XML to JSON feed
 */
export const opmltoJSON = (file: string): OPMLJson => {
  const parser = new DOMParser();
  const xml = parser.parseFromString(file, 'text/xml');
  const feeds = Array.from(
    xml.querySelectorAll('outline[type="rss"]'),
  ) as HTMLElement[];

  return {
    feeds: feeds.map(adaptFeed),
  };
};

/**
 * Get episode route for info
 */
export const getEpisodeRoute = (feed: string, title: string) => {
  return `/episode?feed=${encodeURIComponent(feed)}&title=${encodeURIComponent(title)}`;
};

/**
 * Not null utility
 */
export const notNull = <T>(val: T | null) => val !== null;

/**
 * Add feed prop to episodes
 */
export const patchEpisodesResponse = (feed: string) =>
  (res: App.EpisodeListing | null): App.PodcastEpisodesInfo | null => {
    if (res) {
      const episodes: App.EpisodeInfo[] = res
        .episodes
        .map((episode) => ({ ...episode, feed }));
      return { ...res, episodes };
    } else {
      return null;
    }
  };
