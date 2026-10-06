import { getSession } from '../auth/session';
import { sql } from '../db';
import { createRedis } from '../redis';
import { createListLimiter } from './limits';
import { createListHandlers } from './response';
import { createEpisodeListService } from './service';

const redis = createRedis({ enableOfflineQueue: false });
redis.on('error', () => {});
const consume = createListLimiter(redis);
const limit = async (userId: string, kind: 'clients' | 'changes') => {
  if (redis.status === 'wait') await redis.connect();
  await consume(userId, kind);
};

export const episodeLists = createEpisodeListService(sql, (userId) =>
  limit(userId, 'clients'),
);
export const listHandlers = createListHandlers(
  episodeLists,
  async () => (await getSession())?.userId ?? null,
  (userId) => limit(userId, 'changes'),
);
