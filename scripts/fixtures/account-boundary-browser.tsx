import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { ApiError } from '../../src/data/api';
import { useEpisodesInfinite } from '../../src/data/feed';
import {
  AccountContent,
  AccountContext,
} from '../../src/shared/auth/AccountBoundary';
import {
  type AccountUser,
  accountQueryKey,
} from '../../src/shared/auth/account';
import {
  ACCOUNT_EVENT,
  connectAccountEvents,
} from '../../src/shared/auth/account-events';
import { AccountSession } from '../../src/shared/auth/account-session';
import { restoreAccountProgress } from '../../src/shared/player/playback-state';
import { usePlaybackSync } from '../../src/shared/player/usePlaybackSync';
import { usePlayer } from '../../src/shared/player/usePlayer';
import type { IEpisodeInfo, IPaginatedEpisodes } from '../../src/types';
import { EpisodesHydration } from '../../src/ui/EpisodesList/EpisodesHydration';

const owner: AccountUser = {
  id: 'owner-a',
  email: 'a@example.invalid',
  name: null,
  image: null,
  hasPasskey: false,
};
const episode = {
  id: 4242,
  podcastId: 42,
  guid: 'private-fixture',
  isPrivate: true,
  title: 'Private owner sentinel',
  cover:
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jmz8AAAAASUVORK5CYII=',
  file: { url: 'https://media.example.invalid/private' },
} as IEpisodeInfo;
const page: IPaginatedEpisodes = {
  episodes: [episode],
  total: 1,
  hasMore: false,
};
const assert = (value: unknown, message: string) => {
  if (!value) throw new Error(message);
};
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 10));
async function waitFor(check: () => boolean) {
  for (let i = 0; i < 300; i++) {
    if (check()) return;
    await tick();
  }
  throw new Error('Browser fixture timed out');
}

function PlaybackSync() {
  usePlaybackSync();
  return null;
}

function Episodes() {
  const result = useEpisodesInfinite({ podcastId: 42 });
  return (
    <div id="episode-list">
      {result.data?.pages
        .flatMap((p) => p.episodes)
        .map((e) => (
          <span key={e.id}>{e.title}</span>
        ))}
    </div>
  );
}

async function run() {
  if (location.pathname === '/peer') {
    await fetch('/switch', { method: 'POST' });
    localStorage.setItem(
      ACCOUNT_EVENT,
      JSON.stringify({ id: crypto.randomUUID() }),
    );
    window.close();
    return;
  }
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  let reloads = 0;
  const session = new AccountSession(client, owner, {
    resetPlayer: (scope, revision) =>
      usePlayer.getState().setAccount(scope, revision),
    reload: () => {
      reloads++;
    },
    publish() {},
  });
  const events = connectAccountEvents(session, window);
  client.setQueryData(['top', 'us'], ['public chart']);
  const container = document.getElementById('app');
  if (!container) throw new Error('Missing fixture container');
  const root = createRoot(container);
  root.render(
    <QueryClientProvider client={client}>
      <AccountContext.Provider value={session}>
        <PlaybackSync />
        <AccountContent scope={owner.id} resource={42} privateContent>
          <div id="private-heading">Private metadata sentinel</div>
          <EpisodesHydration scope={owner.id} podcastId={42} initialData={page}>
            <Episodes />
          </EpisodesHydration>
        </AccountContent>
      </AccountContext.Provider>
    </QueryClientProvider>,
  );
  await waitFor(
    () =>
      document
        .getElementById('episode-list')
        ?.textContent?.includes(episode.title) === true,
  );
  await session.refresh();
  usePlayer.getState().restoreEpisode(episode, 44);
  const oldToken = session.token();
  let release!: (value: { episode: IEpisodeInfo; position: number }) => void;
  const delayed = new Promise<{ episode: IEpisodeInfo; position: number }>(
    (resolve) => {
      release = resolve;
    },
  );
  const lateKey = accountQueryKey(owner.id, 'playback', 'playback');
  const pending = client
    .fetchQuery(session.query('playback', 'playback', () => delayed))
    .catch(() => null);
  const peer = window.open('/peer', 'account-peer');
  assert(peer, 'Second tab did not open');
  await waitFor(
    () => session.scope === 'other-b' && session.getSnapshot().ready,
  );
  release({ episode, position: 44 });
  await pending;
  await waitFor(() => !document.getElementById('private-heading'));
  assert(
    !document.body.textContent?.includes(episode.title),
    'Old private episode still rendered',
  );
  assert(
    client.getQueryData(lateKey) === undefined,
    'Delayed response restored old account data',
  );
  assert(usePlayer.getState().queue.length === 0, 'Old account queue survived');
  assert(
    !restoreAccountProgress(session, oldToken, { episode, position: 44 }),
    'Old progress restored into new account',
  );
  let denied = false;
  await client
    .fetchQuery(
      session.query('episodes', 42, async (signal) => {
        const response = await fetch('/api/feed/episodes?podcastId=42', {
          signal,
        });
        denied = response.status === 404;
        if (!response.ok) throw new ApiError(response.status, 'Unavailable');
        return response.json();
      }),
    )
    .catch(() => {});
  await session.refresh();
  assert(denied, 'Other account was not denied');
  assert(
    !document.body.textContent?.includes('Private owner sentinel'),
    'Denied refetch exposed old hydration',
  );
  assert(
    client.getQueryData(['top', 'us']) !== undefined,
    'Public cache was evicted',
  );
  const result = document.getElementById('result');
  if (!result) throw new Error('Missing fixture result');
  result.dataset.status = 'passed';
  result.textContent = JSON.stringify({
    crossTab: true,
    staleHydrationHidden: true,
    deniedRefetchCleared: true,
    delayedResponseFenced: true,
    progressRestoreFenced: true,
    queueCleared: true,
    publicCacheRetained: true,
    reloads,
  });
  events.close();
  root.unmount();
  client.clear();
  await fetch('/result', {
    method: 'POST',
    body: JSON.stringify({
      passed: true,
      checks: JSON.parse(result.textContent),
    }),
  });
}

void run().catch((error) => {
  const result = document.getElementById('result');
  if (result) {
    result.dataset.status = 'failed';
    result.textContent = String(error);
  }
  void fetch('/result', {
    method: 'POST',
    body: JSON.stringify({ passed: false, error: String(error) }),
  });
});
