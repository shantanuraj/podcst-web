import { requireRuntimeAdmission } from '../erasure/admission';
import { assertAuthEpoch } from '../erasure/recovery-auth';
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

async function authNamespace() {
  const admission = await requireRuntimeAdmission();
  if (!admission) return 'initial';
  await assertAuthEpoch(
    authRedis(),
    admission.authEpoch,
    admission.runId,
    admission.redisIdentity,
  );
  return admission.authEpoch;
}
export const challengeStore = () =>
  createChallengeStore(authRedis(), authNamespace);

export async function limitAuth(
  request: Request,
  kind: 'send' | 'verify' | 'challenge',
  subject: string,
) {
  const secret = authSecret();
  await authNamespace();
  await createAuthLimiter(authRedis(), secret)(
    kind,
    subject,
    trustedAuthSource(request, process.env.AUTH_TRUSTED_IP_HEADER),
  );
}
