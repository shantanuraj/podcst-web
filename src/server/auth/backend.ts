import { createRedis } from '../redis';
import { createChallengeStore } from './challenges';
import { AuthError } from './error';
import { createAuthLimiter, trustedAuthSource } from './limits';

let redis: ReturnType<typeof createRedis> | undefined;

export function authSecret() {
  const value = process.env.AUTH_CODE_SECRET;
  if (!value || value.length % 2 !== 0 || !/^[a-f0-9]{64,}$/i.test(value))
    throw new AuthError(503, 'Authentication unavailable');
  return value;
}

function authRedis() {
  if (!redis) {
    redis = createRedis();
    redis.on('error', () => {});
  }
  return redis;
}

export const challengeStore = () => createChallengeStore(authRedis());

export async function limitAuth(
  request: Request,
  kind: 'send' | 'verify' | 'challenge',
  subject: string,
) {
  const secret = authSecret();
  await createAuthLimiter(authRedis(), secret)(
    kind,
    subject,
    trustedAuthSource(request, process.env.AUTH_TRUSTED_IP_HEADER),
  );
}
