import { authSecret } from '../auth/backend';
import { createRedis } from '../redis';
import { createFeedAdmission } from './feed-admission';
import { FeedAdmissionError } from './feed-demand';

let redis: ReturnType<typeof createRedis> | undefined;
let connecting: Promise<void> | undefined;

export async function interactiveAdmission() {
  try {
    redis ??= createRedis({
      enableOfflineQueue: false,
      autoResendUnfulfilledCommands: false,
    });
    if (redis.listenerCount('error') === 0) redis.on('error', () => {});
    if (redis.status !== 'ready') {
      connecting ??= redis.connect().finally(() => {
        connecting = undefined;
      });
      await connecting;
    }
    return createFeedAdmission(redis, authSecret());
  } catch {
    throw new FeedAdmissionError('unavailable');
  }
}

export function privateImportAdmission(accountId: string) {
  let admitted:
    | Promise<Awaited<ReturnType<typeof interactiveAdmission>>>
    | undefined;
  const principal = { kind: 'account' as const, id: accountId };
  return async (signal: AbortSignal) => {
    signal.throwIfAborted();
    admitted ??= interactiveAdmission().then(async (limits) => {
      await limits.importRequest(principal);
      return limits;
    });
    return (await admitted).importLease(principal, signal);
  };
}
