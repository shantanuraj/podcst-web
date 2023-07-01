/**
 * Time duration in seconds after which feed pages are revalidated
 */
export const FEED_REVALIDATE_DURATION = 3600000; // 1 hour

/**
 * iTunes API host
 **/
export const ITUNES_API = `https://itunes.apple.com`;

/**
 * Default podcasts count to return
 */
export const DEFAULT_PODCASTS_COUNT = 30;

/**
 * Default podcawts locale to return
 */
export const DEFAULT_PODCASTS_LOCALE = 'us';

/**
 * Minimum number of podcasts wanted from iTunes feed api
 */
export const MIN_PODCASTS_COUNT = 2;

/**
 * Maximium number of podcasts returned by iTunes feed api
 */
export const MAX_PODCASTS_COUNT = 200;

/**
 * Redis key for Top podcasts
 */
export const KEY_TOP_PODCASTS = 'top';

/**
 * Redis key for parsed Feed
 */
export const KEY_PARSED_FEED = 'feed';

/**
 * Time delta to determine if cache is stale
 */
export const CACHE_STALE_DELTA = 3600000; // 1 hour
