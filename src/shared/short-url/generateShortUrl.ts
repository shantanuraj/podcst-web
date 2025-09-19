import { cache } from '@/app/api/redis';
import { IEpisodeInfo, IShortUrl } from '@/types';

/**
 * Generate a random slug for short URLs
 */
function generateSlug(length: number = 6): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Check if a slug already exists in the cache
 */
async function slugExists(slug: string): Promise<boolean> {
  const existing = await cache.getShortUrl(slug);
  return existing !== null;
}

/**
 * Generate a unique slug that doesn't already exist
 */
async function generateUniqueSlug(length: number = 6): Promise<string> {
  let slug: string;
  let attempts = 0;
  const maxAttempts = 10;

  do {
    slug = generateSlug(length);
    attempts++;

    if (attempts > maxAttempts) {
      // If we can't find a unique slug, increase the length
      length++;
      attempts = 0;
    }
  } while (await slugExists(slug));

  return slug;
}

/**
 * Generate a short URL for an episode
 */
export async function generateShortUrl(episode: IEpisodeInfo): Promise<string> {
  const slug = await generateUniqueSlug();

  const shortUrlData: IShortUrl = {
    feed: episode.feed,
    guid: episode.guid,
  };

  await cache.saveShortUrl(slug, shortUrlData);

  return `https://podcst.app/s/${slug}`;
}

/**
 * Generate a short URL with a custom slug (for manual creation)
 */
export async function generateCustomShortUrl(
  episode: IEpisodeInfo,
  customSlug: string,
): Promise<string | null> {
  // Check if the custom slug already exists
  if (await slugExists(customSlug)) {
    return null; // Slug already taken
  }

  const shortUrlData: IShortUrl = {
    feed: episode.feed,
    guid: episode.guid,
  };

  await cache.saveShortUrl(customSlug, shortUrlData);

  return `https://podcst.app/s/${customSlug}`;
}
