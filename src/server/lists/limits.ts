import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import { ListError } from './service';

const policies = {
  changes: { limit: 120, seconds: 60 },
  clients: { limit: 20, seconds: 60 * 60 },
};

const consume = `
  local count = redis.call('INCR', KEYS[1])
  if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
  return count
`;

export function createListLimiter(redis: Pick<Redis, 'eval'>) {
  return async (userId: string, kind: keyof typeof policies) => {
    const { limit, seconds } = policies[kind];
    const account = createHash('sha256').update(userId).digest('hex');
    const count = await redis.eval(
      consume,
      1,
      `lists:limit:${kind}:${account}`,
      seconds,
    );
    if (typeof count !== 'number')
      throw new Error('List rate limiter unavailable');
    if (count > limit) throw new ListError(429, 'Too many list requests');
  };
}
