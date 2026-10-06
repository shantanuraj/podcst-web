import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';
import { AccountSession } from '@/shared/auth/account-session';
import type { IEpisodeInfo } from '@/types';
import AudioUtils from './AudioUtils';
import { writeSession } from './persisted-session';
import { restoreAccountProgress } from './playback-state';
import { onPlayer } from './player-events';
import { getCurrentEpisode, usePlayer } from './usePlayer';

const episode = (id: number) =>
  ({
    id,
    podcastId: id,
    guid: String(id),
    title: `Episode ${id}`,
    duration: 3600,
    cover: '',
    file: { url: `https://example.invalid/${id}.mp3` },
  }) as IEpisodeInfo;
const [browser, phone, queued] = [episode(1), episode(2), episode(3)];
const owner = {
  id: 'owner',
  email: 'owner@example.invalid',
  name: null,
  image: null,
  hasPasskey: false,
};
const initial = usePlayer.getState();
let client: QueryClient;
let session: AccountSession;

beforeEach(() => {
  spyOn(AudioUtils, 'play').mockImplementation(() => {});
  spyOn(AudioUtils, 'pause').mockImplementation(() => {});
  spyOn(AudioUtils, 'stop').mockImplementation(() => {});
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
      },
    },
  });
  writeSession({
    scope: owner.id,
    queue: [browser, queued],
    current: 0,
    position: 1728,
  });
  client = new QueryClient();
  session = new AccountSession(client, owner, {
    readSession: async () => owner,
    resetPlayer: (scope, revision) =>
      usePlayer.getState().setAccount(scope, revision),
    reload() {},
    publish() {},
  });
  session.synchronizePlayer();
});

afterEach(() => {
  client.clear();
  Reflect.deleteProperty(globalThis, 'window');
  usePlayer.setState(initial, true);
  mock.restore();
});

const restore = (episode: IEpisodeInfo = phone, position = 1438) =>
  restoreAccountProgress(session, session.token(), { episode, position });

test('server playback replaces the cached episode without discarding the queue or saving the outgoing episode', () => {
  const leave = mock();
  const off = onPlayer('leave', leave);
  try {
    expect(usePlayer.getState().hasPlaybackActivity).toBe(false);
    expect(restore()).toBe(true);
    expect(getCurrentEpisode(usePlayer.getState())).toEqual(phone);
    expect(usePlayer.getState()).toMatchObject({
      queue: [browser, queued, phone],
      seekPosition: 1438,
      state: 'paused',
      hasPlaybackActivity: false,
    });
    expect(leave).not.toHaveBeenCalled();
    expect(AudioUtils.play).not.toHaveBeenCalled();
  } finally {
    off();
  }
});

test('server playback reconciles the position of an already queued episode', () => {
  expect(restore(browser, 1800)).toBe(true);
  expect(usePlayer.getState()).toMatchObject({
    queue: [browser, queued],
    currentTrackIndex: 0,
    seekPosition: 1800,
    hasPlaybackActivity: false,
  });
});

test('editing up next does not give stale cached playback precedence', () => {
  usePlayer.getState().enqueueEpisode(episode(4), false);
  usePlayer.getState().moveUpNext(1, 0);
  expect(usePlayer.getState().hasPlaybackActivity).toBe(false);
  expect(restore()).toBe(true);
});

for (const action of ['play', 'seek', 'next', 'clear', 'complete'] as const) {
  test(`a delayed server restore cannot replace a local ${action} action`, () => {
    const player = usePlayer.getState();
    if (action === 'play') {
      player.resumeEpisode();
      player.pause();
    }
    if (action === 'seek') player.seekTo(1700);
    if (action === 'next') player.skipToNextEpisode();
    if (action === 'clear') player.clearQueue();
    if (action === 'complete') player.markPlayed();
    const state = usePlayer.getState();
    expect(state.hasPlaybackActivity).toBe(true);
    expect(restore()).toBe(false);
    expect(usePlayer.getState()).toBe(state);
  });
}

test('an unchanged position notification is not local playback activity', () => {
  usePlayer.getState().setSeekPosition(1728);
  expect(restore()).toBe(true);
});

test('account retirement resets activity and fences the old restore', () => {
  const token = session.token();
  usePlayer.getState().seekTo(1700);
  session.beginAuthChange();
  expect(usePlayer.getState().hasPlaybackActivity).toBe(false);
  expect(
    restoreAccountProgress(session, token, { episode: phone, position: 1438 }),
  ).toBe(false);
});
