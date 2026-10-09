import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { feedRefreshOptions } from '../../src/data/feed-refresh';
import { browserStateStorage } from '../../src/data/state-storage';
import { AccountSession } from '../../src/shared/auth/account-session';
import { preserveFeedContent } from '../../src/shared/feed-content';
import { FEED_LIMITS } from '../../src/shared/feed-contract';
import { readOpml } from '../../src/shared/opml';
import { createSubscriptions } from '../../src/shared/subscriptions/useSubscriptions';
import type { IEpisodeInfo } from '../../src/types';

async function run() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const session = new AccountSession(client, null, {
    resetPlayer() {},
    reload() {},
    publish() {},
    readSession: async () => null,
  });
  const id = '9007199254740993';
  const episode = {
    id: '9007199254740995',
    podcastId: id,
    feed: 'https://example.invalid/rss',
    guid: 'retained',
  } as IEpisodeInfo;
  let refreshed = 0;
  let admitted = false;
  const options = feedRefreshOptions(session, id, () => {
    refreshed++;
  });
  const observer = new QueryObserver(client, options);
  const ready = Promise.withResolvers<void>();
  const stop = observer.subscribe((query) => {
    if (query.error) ready.reject(query.error);
    if (query.data?.freshness.state === 'pending') {
      const retained = preserveFeedContent(
        { episodes: [episode] },
        { episodes: [], freshness: query.data.freshness },
      );
      if ((retained.episodes as IEpisodeInfo[])[0]?.id !== episode.id)
        ready.reject(new Error('Pending wiped cached episodes'));
      admitted = true;
    }
    if (query.data?.freshness.state === 'fresh') ready.resolve();
  });
  await ready.promise;
  stop();
  client.clear();
  const feed = 'https://example.invalid/offline-import';
  await createSubscriptions().getState().stageImports([feed]);
  const guestRetained =
    (await browserStateStorage().load()).guest.imports?.[0] === feed;
  let opened = false;
  let byteBounded = false;
  try {
    await readOpml({
      size: FEED_LIMITS.opml.bytes + 1,
      arrayBuffer: async () => {
        opened = true;
        return new ArrayBuffer(0);
      },
    } as Blob);
  } catch {
    byteBounded = !opened;
  }
  return { admitted, refreshed, guestRetained, byteBounded };
}
void run()
  .then((checks) =>
    fetch('/result', {
      method: 'POST',
      body: JSON.stringify({
        passed: Object.values(checks).every(Boolean),
        checks,
      }),
    }),
  )
  .catch((error) =>
    fetch('/result', {
      method: 'POST',
      body: JSON.stringify({ passed: false, error: String(error) }),
    }),
  );
