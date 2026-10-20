import { createHmac, randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';

export class SearchAdmissionError extends Error {
  constructor(
    readonly status: 429 | 503 = 503,
    readonly retryAfter = 5,
  ) {
    super(status === 429 ? 'Too many search requests' : 'Search unavailable');
  }
}

export interface SearchPolicy {
  sourcePerMinute: number;
  globalPerMinute: number;
}

export function readSearchPolicy(
  env: Record<string, string | undefined> = process.env,
): SearchPolicy {
  const read = (name: string) => {
    const value = env[name];
    const number = Number(value);
    if (!value || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(number))
      throw new SearchAdmissionError();
    return number;
  };
  return {
    sourcePerMinute: read('SEARCH_SOURCE_PER_MINUTE'),
    globalPerMinute: read('SEARCH_GLOBAL_PER_MINUTE'),
  };
}

// Match the existing auth limiter's rolling-window/all-or-nothing reservation.
// The shared hash tag keeps both keys in one slot on clustered Redis.
const consume = `
  local time = redis.call('TIME')
  local now = time[1] * 1000 + math.floor(time[2] / 1000)
  local retry = 0
  for i, key in ipairs(KEYS) do
    redis.call('ZREMRANGEBYSCORE', key, '-inf', now - 60000)
    if redis.call('ZCARD', key) >= tonumber(ARGV[i + 1]) then
      local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
      retry = math.max(retry, tonumber(oldest[2]) + 60000 - now)
    end
  end
  if retry > 0 then return math.ceil(retry / 1000) end
  for _, key in ipairs(KEYS) do
    redis.call('ZADD', key, now, ARGV[1])
    redis.call('PEXPIRE', key, 60000)
  end
  return 0
`;

export function createSearchLimiter(
  redis: Pick<Redis, 'eval'>,
  secret: string,
  policy: SearchPolicy,
) {
  if (
    Buffer.byteLength(secret) < 32 ||
    ![policy.sourcePerMinute, policy.globalPerMinute].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    )
  )
    throw new SearchAdmissionError();
  return async (source: string) => {
    const digest = createHmac('sha256', secret).update(source).digest('hex');
    let retry: unknown;
    try {
      retry = await redis.eval(
        consume,
        2,
        `search:{budget}:source:${digest}`,
        'search:{budget}:global',
        randomUUID(),
        policy.sourcePerMinute,
        policy.globalPerMinute,
      );
    } catch {
      throw new SearchAdmissionError();
    }
    if (
      typeof retry !== 'number' ||
      !Number.isInteger(retry) ||
      retry < 0 ||
      retry > 60
    )
      throw new SearchAdmissionError();
    if (retry > 0) throw new SearchAdmissionError(429, retry);
  };
}
