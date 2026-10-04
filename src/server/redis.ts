import { Redis, type RedisOptions } from 'ioredis';
import { mtls } from './mtls';

export function createRedis(options: RedisOptions = {}) {
  const isVercel = process.env.VERCEL === '1' || process.env.VERCEL === 'true';
  const readEnv = (...keys: string[]) =>
    keys.map((key) => process.env[key]).find(Boolean);
  const host = isVercel
    ? process.env.KV_REDIS_HOST
    : readEnv('REDIS_HOST', 'KV_REDIS_HOST');
  const url = isVercel
    ? readEnv('KV_REDIS_URL', 'REDIS_URL')
    : host
      ? undefined
      : process.env.REDIS_URL;
  const port = Number.parseInt(
    (isVercel
      ? process.env.KV_REDIS_PORT
      : readEnv('REDIS_PORT', 'KV_REDIS_PORT')) ?? '',
    10,
  );
  const common = { ...(mtls && { tls: mtls }), ...options };
  return url
    ? new Redis(url, common)
    : new Redis({
        host,
        password: isVercel
          ? process.env.KV_REDIS_PASS
          : readEnv('REDIS_PASSWORD', 'REDIS_PASS', 'KV_REDIS_PASS'),
        port: Number.isFinite(port) ? port : 6379,
        ...common,
      });
}
