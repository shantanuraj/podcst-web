import { after } from 'next/server';
import { getSession } from '../auth/session';
import { sql } from '../db';
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
  (userId, listId) =>
    after(async () => {
      try {
        await recoverListContent(sql, userId, listId, async (podcastId) => {
          await connect();
          return (
            (await redis.set(
              `lists:rebuild:${podcastId}`,
              '1',
              'EX',
              900,
              'NX',
            )) === 'OK'
          );
        });
      } catch {
        console.warn('Saved episode content recovery failed');
      }
    }),
);
