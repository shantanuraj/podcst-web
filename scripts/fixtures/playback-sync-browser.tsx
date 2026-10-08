import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { connectState, stateRuntime } from '../../src/data/state-browser';
import { AccountContext } from '../../src/shared/auth/AccountBoundary';
import { AccountSession } from '../../src/shared/auth/account-session';
import AudioUtils from '../../src/shared/player/AudioUtils';
import { writeSession } from '../../src/shared/player/persisted-session';
import { usePlaybackSync } from '../../src/shared/player/usePlaybackSync';
import {
  getCurrentEpisode,
  usePlayer,
} from '../../src/shared/player/usePlayer';
import type { IEpisodeInfo } from '../../src/types';

const owner = {
  id: 'owner',
  email: 'owner@example.invalid',
  name: null,
  image: null,
  hasPasskey: false,
};
const episode = (id: number) =>
  ({
    id: String(id),
    podcastId: String(id),
    guid: String(id),
    feed: `https://example.invalid/${id}.rss`,
    title: `Episode ${id}`,
    duration: 3600,
    cover: '',
    file: { url: `https://example.invalid/${id}.mp3` },
  }) as IEpisodeInfo;
const [browser, phone, queued] = [episode(1), episode(2), episode(3)];
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 20));
const assert = (value: unknown, message: string) => {
  if (!value) throw new Error(message);
};
async function waitFor(check: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 300; i++) {
    if (await check()) return;
    await tick();
  }
  throw new Error('Playback fixture timed out');
}
const writes = async () =>
  (await fetch('/writes')).json() as Promise<unknown[]>;
const pagehide = () =>
  window.dispatchEvent(new PageTransitionEvent('pagehide'));
const phoneProgress = (position: number) =>
  fetch('/phone', {
    method: 'POST',
    body: JSON.stringify({ episode: phone, position }),
  });

let mounted = false;
function PlaybackSync() {
  usePlaybackSync();
  mounted = true;
  return null;
}

async function run() {
  AudioUtils.play = () => {};
  AudioUtils.pause = () => {};
  AudioUtils.stop = () => {};
  const reloaded = sessionStorage.getItem('reloaded') === 'true';
  if (!reloaded) {
    writeSession({
      scope: owner.id,
      queue: [browser, queued],
      current: 0,
      position: 1728,
    });
    await phoneProgress(1438);
  }
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const session = new AccountSession(client, owner, {
    readSession: async () => owner,
    resetPlayer: (scope, revision) =>
      usePlayer.getState().setAccount(scope, revision),
    reload() {},
    publish() {},
  });
  session.synchronizePlayer();
  const disconnect = connectState(session);
  await stateRuntime(session).sync.activate(owner.id);
  const container = document.getElementById('app');
  if (!container) throw new Error('Missing fixture container');
  const root = createRoot(container);
  root.render(
    <QueryClientProvider client={client}>
      <AccountContext.Provider value={session}>
        <PlaybackSync />
      </AccountContext.Provider>
    </QueryClientProvider>,
  );
  await waitFor(
    () =>
      mounted && usePlayer.getState().seekPosition === (reloaded ? 2100 : 1438),
  );
  assert(
    getCurrentEpisode(usePlayer.getState())?.id === phone.id,
    'Stale episode won restoration',
  );
  assert(
    usePlayer
      .getState()
      .queue.map((item) => item.id)
      .join(',') === '1,3,2',
    'Restoration discarded the queue',
  );
  assert(
    !usePlayer.getState().hasPlaybackActivity,
    'Restoration counted as local playback',
  );
  await tick();
  pagehide();
  await tick();
  assert(
    (await writes()).length === (reloaded ? 1 : 0),
    'Restoring or unloading saved stale playback',
  );

  if (!reloaded) {
    usePlayer.getState().resumeEpisode();
    usePlayer.getState().setPlayerState('playing');
    usePlayer.getState().setSeekPosition(1439.5);
    usePlayer.getState().pause();
    await waitFor(async () => (await writes()).length === 1);
    await tick();
    await phoneProgress(2100);
    await session.refresh();
    await tick();
    pagehide();
    await tick();
    assert(
      (await writes()).length === 1,
      'An unchanged pause promoted stale progress',
    );
    sessionStorage.setItem('reloaded', 'true');
    location.reload();
    return;
  }

  usePlayer.getState().resumeEpisode();
  usePlayer.getState().setPlayerState('playing');
  usePlayer.getState().setSeekPosition(2101);
  pagehide();
  await waitFor(async () => (await writes()).length === 2);
  await tick();
  await stateRuntime(session).sync.checkpoint();
  usePlayer.getState().pause();
  pagehide();
  await tick();
  assert((await writes()).length === 2, 'An acknowledged flush was repeated');

  await fetch('/fail', { method: 'POST' });
  usePlayer.getState().seekTo(2140);
  await waitFor(async () => (await writes()).length === 3);
  await tick();
  pagehide();
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await stateRuntime(session).sync.refresh();
  await waitFor(async () => (await writes()).length === 4);
  await tick();
  usePlayer.getState().markPlayed();
  await waitFor(async () => (await writes()).length === 5);
  await tick();
  disconnect();
  root.unmount();
  client.clear();
  await fetch('/result', {
    method: 'POST',
    body: JSON.stringify({
      passed: true,
      checks: {
        restoredDifferentEpisode: true,
        restoredSameEpisode: true,
        preservedQueue: true,
        unchangedRefreshIsReadOnly: true,
        unsavedProgressFlushed: true,
        failedSaveRetried: true,
        completionSaved: true,
      },
    }),
  });
}

void run().catch((error) => {
  void fetch('/result', {
    method: 'POST',
    body: JSON.stringify({ passed: false, error: String(error) }),
  });
});
