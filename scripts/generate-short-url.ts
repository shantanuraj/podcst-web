#!/usr/bin/env node

import { Redis } from 'ioredis';

// Constants
const KEY_SHORT_URL = 'short';

// Redis setup
const redis = new Redis({
  host: process.env.KV_REDIS_HOST,
  password: process.env.KV_REDIS_PASS,
  port: parseInt(process.env.KV_REDIS_PORT || '0', 10),
});

// Helper functions
function generateSlug(length = 6) {
  const chars =
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function slugExists(slug: string) {
  try {
    const res = await redis.get(`${KEY_SHORT_URL}-${slug}`);
    return res !== null;
  } catch (err) {
    return false;
  }
}

async function generateUniqueSlug(length = 6) {
  let slug;
  let attempts = 0;
  const maxAttempts = 10;

  do {
    slug = generateSlug(length);
    attempts++;

    if (attempts > maxAttempts) {
      length++;
      attempts = 0;
    }
  } while (await slugExists(slug));

  return slug;
}

async function saveShortUrl(slug: string, shortUrl: object) {
  const data = {
    entity: shortUrl,
    timestamp: Date.now(),
  };

  return redis.set(`${KEY_SHORT_URL}-${slug}`, JSON.stringify(data));
}

// Parse episode URL
function parseEpisodeUrl(url: string) {
  // Expected format: https://podcst.app/episode/[feed]/[guid]
  const match = url.match(/\/episode\/([^/]+)\/([^/]+)/);
  if (!match) {
    throw new Error(
      'Invalid episode URL format. Expected: https://podcst.app/episode/[feed]/[guid]',
    );
  }

  return {
    feed: decodeURIComponent(match[1]),
    guid: decodeURIComponent(match[2]),
  };
}

// Main function
async function generateShortUrl(
  episodeUrl: string,
  customSlug: string | null = null,
) {
  try {
    // Parse the episode URL
    const { feed: feedUrl, guid } = parseEpisodeUrl(episodeUrl);

    console.log(`Episode GUID: ${guid}`);
    console.log(`Feed URL: ${feedUrl}`);

    // Generate or use custom slug
    let slug;
    if (customSlug) {
      if (await slugExists(customSlug)) {
        throw new Error(`Slug "${customSlug}" already exists`);
      }
      slug = customSlug;
      console.log(`Using custom slug: ${slug}`);
    } else {
      slug = await generateUniqueSlug();
      console.log(`Generated slug: ${slug}`);
    }

    // Save the short URL mapping
    const shortUrlData = {
      feed: feedUrl,
      guid: guid,
    };

    await saveShortUrl(slug, shortUrlData);

    const shortUrl = `https://podcst.app/s/${slug}`;
    console.log(`\n✅ Short URL created: ${shortUrl}`);

    return shortUrl;
  } catch (error: unknown) {
    console.error('❌ Error:', (error as any).message);
    process.exit(1);
  } finally {
    redis.disconnect();
  }
}

// CLI interface
function printUsage() {
  console.log('📎 Short URL Generator for Podcst Episodes\n');
  console.log('Usage:');
  console.log(
    '  node scripts/generate-short-url.js <episode-url> [custom-slug]',
  );
  console.log('');
  console.log('Arguments:');
  console.log('  episode-url    Full episode URL from podcst.app');
  console.log(
    '  custom-slug    Optional custom slug (default: random 6 chars)',
  );
  console.log('');
  console.log('Examples:');
  console.log('  # Generate random short URL');
  console.log(
    '  node scripts/generate-short-url.js "https://podcst.app/episode/https%3A%2F%2Ffeeds.example.com%2Fpodcast.xml/episode-123"',
  );
  console.log('');
  console.log('  # Generate custom short URL');
  console.log(
    '  node scripts/generate-short-url.js "https://podcst.app/episode/https%3A%2F%2Ffeeds.example.com%2Fpodcast.xml/episode-123" "my-episode"',
  );
  console.log('');
  console.log('Environment Variables Required:');
  console.log('  KV_REDIS_HOST - Redis host');
  console.log('  KV_REDIS_PASS - Redis password');
  console.log('  KV_REDIS_PORT - Redis port');
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  printUsage();
  process.exit(0);
}

const episodeUrl = args[0];
const customSlug = args[1] || null;

if (!episodeUrl) {
  console.error('❌ Error: Episode URL is required');
  printUsage();
  process.exit(1);
}

// Validate environment variables
if (
  !process.env.KV_REDIS_HOST ||
  !process.env.KV_REDIS_PASS ||
  !process.env.KV_REDIS_PORT
) {
  console.error('❌ Error: Missing Redis environment variables');
  console.error('Required: KV_REDIS_HOST, KV_REDIS_PASS, KV_REDIS_PORT');
  process.exit(1);
}

// Run the script
console.log('🚀 Generating short URL...\n');
generateShortUrl(episodeUrl, customSlug);
