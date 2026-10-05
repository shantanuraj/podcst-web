import type { Redis, RedisOptions } from 'ioredis';
import { createRedis } from '@/server/redis';
import {
  type ChapterCache,
  LOCK_TTL_MS,
  MAX_CACHE_BYTES,
  parseCacheEntry,
} from './cache';

export const REDIS_TIMEOUT_MS = 500;
export const chapterRedisOptions: RedisOptions = {
  lazyConnect: true,
  enableOfflineQueue: false,
  autoResendUnfulfilledCommands: false,
  enableReadyCheck: false,
  disableClientInfo: true,
  connectTimeout: REDIS_TIMEOUT_MS,
  disconnectTimeout: 0,
  commandTimeout: REDIS_TIMEOUT_MS,
  socketTimeout: REDIS_TIMEOUT_MS,
  maxRetriesPerRequest: 0,
  retryStrategy: () => null,
};

const publish = `
if redis.call('GET', KEYS[2]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
redis.call('DEL', KEYS[2])
return 1
`;
const release = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export function createRedisChapterCache(
  redis: Redis = createRedis(chapterRedisOptions),
): ChapterCache {
  let connecting: Promise<void> | undefined;
  let retryAt = 0;
  redis.on('error', () => {});
  async function run<T>(operation: () => Promise<T>): Promise<T> {
    if (Date.now() < retryAt) throw new Error('Chapter cache unavailable');
    try {
      if (redis.status !== 'ready') {
        connecting ??= redis.connect().finally(() => {
          connecting = undefined;
        });
        await connecting;
      }
      return await operation();
    } catch {
      retryAt = Date.now() + 1000;
      redis.disconnect();
      throw new Error('Chapter cache unavailable');
    }
  }
  return {
    get: (key) =>
      run(async () =>
        parseCacheEntry(await redis.getrange(key, 0, MAX_CACHE_BYTES)),
      ),
    acquire: (key, token) =>
      run(
        async () =>
          (await redis.set(`${key}:lock`, token, 'PX', LOCK_TTL_MS, 'NX')) ===
          'OK',
      ),
    publish: (key, token, entry, ttl) =>
      run(async () => {
        const data = JSON.stringify(entry);
        if (ttl <= 0 || !Number.isSafeInteger(ttl) || !parseCacheEntry(data))
          return false;
        return (
          (await redis.eval(
            publish,
            2,
            key,
            `${key}:lock`,
            token,
            data,
            ttl,
          )) === 1
        );
      }),
    release: (key, token) =>
      run(async () => {
        await redis.eval(release, 1, `${key}:lock`, token);
      }),
  };
}
