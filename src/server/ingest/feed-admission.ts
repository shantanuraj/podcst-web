import { createHmac, randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { FEED_LIMITS } from '@/shared/feed-contract';
import { FeedAdmissionError } from './feed-demand';

type Principal = { kind: 'account' | 'source'; id: string };
type Policy = {
  key: string;
  limit: number;
  windowMs: number;
  active?: boolean;
};

const acquire = `
  local time = redis.call('TIME')
  local now = time[1] * 1000 + math.floor(time[2] / 1000)
  local retry = 0
  for i, key in ipairs(KEYS) do
    local window = tonumber(ARGV[i * 3 - 1])
    local limit = tonumber(ARGV[i * 3])
    local active = ARGV[i * 3 + 1] == '1'
    redis.call('ZREMRANGEBYSCORE', key, '-inf', active and now or now - window)
    if redis.call('ZCARD', key) >= limit then
      local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
      retry = math.max(retry, tonumber(oldest[2]) + (active and 0 or window) - now)
    end
  end
  if retry > 0 then return math.max(1, math.ceil(retry / 1000)) end
  for i, key in ipairs(KEYS) do
    local window = tonumber(ARGV[i * 3 - 1])
    local active = ARGV[i * 3 + 1] == '1'
    redis.call('ZADD', key, active and now + window or now, ARGV[1])
    redis.call('PEXPIRE', key, window)
  end
  return 0
`;
const release = `
  for _, key in ipairs(KEYS) do redis.call('ZREM', key, ARGV[1]) end
  return 1
`;
const owns = `
  local time = redis.call('TIME')
  local now = time[1] * 1000 + math.floor(time[2] / 1000)
  for _, key in ipairs(KEYS) do
    local untilAt = redis.call('ZSCORE', key, ARGV[1])
    if not untilAt or tonumber(untilAt) <= now then return 0 end
  end
  return 1
`;

export function createFeedAdmission(
  redis: Pick<Redis, 'eval'>,
  secret: string,
) {
  if (Buffer.byteLength(secret) < 32)
    throw new FeedAdmissionError('unavailable');
  const principalKey = (principal: Principal) =>
    createHmac('sha256', secret)
      .update(`${principal.kind}:${principal.id}`)
      .digest('hex');
  const key = (kind: string, scope: string) =>
    `feeds:{admission}:${kind}:${scope}`;
  const evaluate = async (
    script: string,
    keys: string[],
    args: (string | number)[],
  ) => {
    try {
      const result = await redis.eval(script, keys.length, ...keys, ...args);
      if (
        typeof result !== 'number' ||
        !Number.isSafeInteger(result) ||
        result < 0
      )
        throw new Error('Invalid admission response');
      return result;
    } catch {
      throw new FeedAdmissionError('unavailable');
    }
  };
  const consume = async (policies: Policy[]) => {
    const token = randomUUID();
    const retry = await evaluate(
      acquire,
      policies.map(({ key }) => key),
      [
        token,
        ...policies.flatMap(({ windowMs, limit, active }) => [
          windowMs,
          limit,
          active ? 1 : 0,
        ]),
      ],
    );
    if (retry > 0) throw new FeedAdmissionError('rate_limited', retry);
    return token;
  };
  const minute = (kind: string, scope: string, limit: number): Policy => ({
    key: key(kind, scope),
    limit,
    windowMs: 60_000,
  });

  return {
    async refresh(principal: Principal) {
      await consume([
        minute(
          'refresh',
          principalKey(principal),
          FEED_LIMITS.refresh.requestsPerMinute,
        ),
        minute('refresh', 'global', FEED_LIMITS.refresh.startsPerMinute),
      ]);
    },
    async importRequest(principal: Principal) {
      await consume([
        minute(
          'import-request',
          principalKey(principal),
          FEED_LIMITS.imports.requestsPerMinute,
        ),
      ]);
    },
    async importLease(principal: Principal, callerSignal?: AbortSignal) {
      callerSignal?.throwIfAborted();
      const deadline = AbortSignal.timeout(FEED_LIMITS.imports.deadlineMs);
      const signal = callerSignal
        ? AbortSignal.any([callerSignal, deadline])
        : deadline;
      const scope = principalKey(principal);
      const active: Policy[] = [
        {
          key: key('import-active', scope),
          limit: FEED_LIMITS.imports.concurrencyPerAccount,
          windowMs: FEED_LIMITS.imports.deadlineMs,
          active: true,
        },
        {
          key: key('import-active', 'global'),
          limit: FEED_LIMITS.imports.concurrencyGlobal,
          windowMs: FEED_LIMITS.imports.deadlineMs,
          active: true,
        },
      ];
      const token = await consume([
        minute('import-start', scope, FEED_LIMITS.imports.startsPerMinute),
        minute('import-start', 'global', FEED_LIMITS.imports.startsPerMinute),
        ...active,
      ]);
      const keys = active.map(({ key }) => key);
      let released = false;
      return {
        signal,
        async assertOwned() {
          signal.throwIfAborted();
          if (released || (await evaluate(owns, keys, [token])) !== 1)
            throw new FeedAdmissionError('unavailable');
          signal.throwIfAborted();
        },
        async release() {
          released = true;
          await evaluate(release, keys, [token]);
        },
      };
    },
  };
}
