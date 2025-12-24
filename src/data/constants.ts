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
 * Redis key for short URLs
 */
export const KEY_SHORT_URL = 'short';

/**
 * Time delta to determine if cache is stale in seconds
 */
export const CACHE_STALE_DELTA = 3600; // 1 hour

/**
 * Image proxy URL
 */
export const IMAGE_PROXY_URL = 'https://assets.podcst.app/';
