import { createHmac, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import type { Redis } from 'ioredis';
import { CODE_ATTEMPTS } from './email-service';
import { AuthError } from './error';

const SENDS_PER_EMAIL = 5;
const SENDS_PER_SOURCE = 20;

const consume = `
  local time = redis.call('TIME')
  local now = time[1] * 1000 + math.floor(time[2] / 1000)
  local retry = 0
  for i, key in ipairs(KEYS) do
    local window = tonumber(ARGV[i * 2])
    local limit = tonumber(ARGV[i * 2 + 1])
    redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
    if redis.call('ZCARD', key) >= limit then
      local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
      retry = math.max(retry, tonumber(oldest[2]) + window - now)
    end
  end
  if retry > 0 then return math.ceil(retry / 1000) end
  for i, key in ipairs(KEYS) do
    redis.call('ZADD', key, now, ARGV[1])
    redis.call('PEXPIRE', key, ARGV[i * 2])
  end
  return 0
`;

export function trustedAuthSource(request: Request, header?: string) {
  const value = header ? request.headers.get(header)?.trim() : undefined;
  if (!value || !isIP(value)) return 'unattributed';
  return isIP(value) === 6 ? new URL(`http://[${value}]/`).hostname : value;
}

export function createAuthLimiter(redis: Pick<Redis, 'eval'>, secret: string) {
  if (Buffer.byteLength(secret) < 32)
    throw new AuthError(503, 'Authentication unavailable');
  const key = (scope: string, value: string) =>
    `auth:limit:${scope}:${createHmac('sha256', secret).update(value).digest('hex')}`;
  return async (
    kind: 'send' | 'verify' | 'challenge',
    email: string,
    source: string,
  ) => {
    const policies =
      kind === 'challenge'
        ? ([
            [key('challenge-source', source), 3_600_000, SENDS_PER_SOURCE],
          ] as const)
        : kind === 'send'
          ? ([
              [key('cooldown', email.toLowerCase()), 60_000, 1],
              [
                key('send-email', email.toLowerCase()),
                3_600_000,
                SENDS_PER_EMAIL,
              ],
              [key('send-source', source), 3_600_000, SENDS_PER_SOURCE],
            ] as const)
          : ([
              [
                key('verify-email', email.toLowerCase()),
                3_600_000,
                SENDS_PER_EMAIL * CODE_ATTEMPTS,
              ],
              [
                key('verify-source', source),
                3_600_000,
                SENDS_PER_SOURCE * CODE_ATTEMPTS,
              ],
            ] as const);
    let retry: unknown;
    try {
      retry = await redis.eval(
        consume,
        policies.length,
        ...policies.map(([name]) => name),
        randomUUID(),
        ...policies.flatMap(([, window, limit]) => [window, limit]),
      );
    } catch {
      throw new AuthError(503, 'Authentication unavailable');
    }
    if (typeof retry !== 'number' || !Number.isInteger(retry) || retry < 0)
      throw new AuthError(503, 'Authentication unavailable');
    if (retry > 0)
      throw new AuthError(429, 'Too many authentication requests', retry);
  };
}
