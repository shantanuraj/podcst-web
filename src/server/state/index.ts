import { getSession } from '../auth/session';
import { sql } from '../db';
import { createListLimiter } from '../lists/limits';
import { createRedis } from '../redis';
import { createFollowStateService } from './follows';
import { createProgressStateService } from './progress';
import { createStateChangeHandlers } from './response';

const redis = createRedis({ enableOfflineQueue: false });
redis.on('error', () => {});
const consume = createListLimiter(redis);
let connecting: Promise<void> | undefined;

export async function limitState(
  accountId: string,
  kind: 'changes' | 'clients' | 'imports',
) {
  if (redis.status !== 'ready') {
    connecting ??= redis.connect().finally(() => {
      connecting = undefined;
    });
    await connecting;
  }
  await consume(accountId, kind);
}

export const progressState = createProgressStateService(sql, (id) =>
  limitState(id, 'clients'),
);
export const followState = createFollowStateService(sql, (id) =>
  limitState(id, 'clients'),
);
export const stateChanges = createStateChangeHandlers(
  { progress: progressState.change, follows: followState.change },
  async () => (await getSession())?.userId ?? null,
  (id) => limitState(id, 'changes'),
);
