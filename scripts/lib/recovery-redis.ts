import { isIP } from 'node:net';
import { createSecureContext } from 'node:tls';
import { Redis } from 'ioredis';

export interface RecoveryRedisConfiguration {
  url: string;
  tls?: { ca?: string; cert?: string; key?: string };
}

export function createRecoveryRedis(config: RecoveryRedisConfiguration) {
  const url = new URL(config.url);
  if (
    !['redis:', 'rediss:'].includes(url.protocol) ||
    !url.hostname ||
    url.search ||
    url.hash ||
    (url.protocol === 'redis:' &&
      (config.tls !== undefined ||
        !['127.0.0.1', '[::1]'].includes(url.hostname)))
  )
    throw new Error('Recovery cache transport refused');
  const material = config.tls;
  if (
    material !== undefined &&
    (!material ||
      typeof material !== 'object' ||
      Array.isArray(material) ||
      Object.entries(material).some(
        ([key, value]) =>
          !['ca', 'cert', 'key'].includes(key) ||
          typeof value !== 'string' ||
          !value.trim(),
      ) ||
      Boolean(material.cert) !== Boolean(material.key))
  )
    throw new Error('Recovery cache TLS configuration refused');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const tls =
    url.protocol === 'rediss:'
      ? {
          ...material,
          rejectUnauthorized: true,
          ...(!isIP(hostname) && { servername: hostname }),
        }
      : undefined;
  if (tls) createSecureContext(tls);
  const redis = new Redis(config.url, {
    ...(tls && { tls }),
    lazyConnect: true,
    connectTimeout: 1000,
    commandTimeout: 2000,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  redis.on('error', () => {});
  return redis;
}
