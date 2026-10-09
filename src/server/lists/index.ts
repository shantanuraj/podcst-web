import { getSession } from '../auth/session';
import { sql } from '../db';
import { interactiveAdmission } from '../ingest/interactive-admission';
import { createRedis } from '../redis';
import { createListLimiter } from './limits';
import { recoverListContent } from './recovery';
import { createListHandlers } from './response';
import { createEpisodeListService } from './service';

const redis = createRedis({ enableOfflineQueue: false });
redis.on('error', () => {});
const consume = createListLimiter(redis);
const connect = async () => {
  if (redis.status === 'wait') await redis.connect();
};
const limit = async (userId: string, kind: 'clients' | 'changes') => {
  await connect();
  await consume(userId, kind);
};

const episodeLists = createEpisodeListService(sql, (userId) =>
  limit(userId, 'clients'),
);
export const listHandlers = createListHandlers(
  episodeLists,
  async () => (await getSession())?.userId ?? null,
  (userId) => limit(userId, 'changes'),
  async (userId, listId) => {
    try {
      await recoverListContent(sql, userId, listId, async () => {
        await (await interactiveAdmission()).refresh({
          kind: 'account',
          id: userId,
        });
      });
    } catch {}
  },
);
