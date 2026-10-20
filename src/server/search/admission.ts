import { authSecret } from '../auth/backend';
import { trustedAuthSource } from '../auth/limits';
import { createRedis } from '../redis';
import {
  createSearchLimiter,
  readSearchPolicy,
  SearchAdmissionError,
} from './limits';

let redis: ReturnType<typeof createRedis> | undefined;
let connecting: Promise<void> | undefined;

async function connect(client: ReturnType<typeof createRedis>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      client.connect(),
      new Promise<never>((_, reject) => {
        // connectTimeout covers TCP only. Readiness can issue several commands
        // or keep polling a Redis server that reports it is still loading.
        timer = setTimeout(() => {
          client.disconnect();
          reject(new SearchAdmissionError());
        }, 1000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function limitSearch(request: Request) {
  let limit: ReturnType<typeof createSearchLimiter>;
  try {
    const policy = readSearchPolicy();
    const secret = authSecret();
    redis ??= createRedis({
      enableOfflineQueue: false,
      autoResendUnfulfilledCommands: false,
      connectTimeout: 1000,
      commandTimeout: 1000,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    if (redis.listenerCount('error') === 0) redis.on('error', () => {});
    if (redis.status !== 'ready') {
      connecting ??= connect(redis).finally(() => {
        connecting = undefined;
      });
      await connecting;
    }
    limit = createSearchLimiter(redis, secret, policy);
  } catch {
    throw new SearchAdmissionError();
  }
  await limit(trustedAuthSource(request, process.env.AUTH_TRUSTED_IP_HEADER));
}
