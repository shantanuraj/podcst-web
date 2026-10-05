import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import type { IEpisodeInfo } from '@/types';
import AudioUtils from './AudioUtils';
import { readSession, writeSession } from './persisted-session';
import { type EpisodePosition, onPlayer } from './player-events';
import { getCurrentEpisode, usePlayer } from './usePlayer';

const episode = (id: number) =>
  ({
    id,
    feed: 'synthetic',
    guid: `episode-${id}`,
    title: `Episode ${id}`,
    duration: 600,
    file: { url: `https://example.invalid/${id}.mp3` },
  }) as IEpisodeInfo;

const [a, b, c] = [episode(1), episode(2), episode(3)];
const initial = usePlayer.getState();

beforeEach(() => {
  spyOn(AudioUtils, 'play').mockImplementation(() => {});
  spyOn(AudioUtils, 'pause').mockImplementation(() => {});
  spyOn(AudioUtils, 'resume').mockImplementation(() => {});
  spyOn(AudioUtils, 'stop').mockImplementation(() => {});
  spyOn(AudioUtils, 'seekTo').mockImplementation(() => {});
});

afterEach(() => {
  mock.restore();
  usePlayer.setState(initial, true);
});

function listen(kind: 'complete' | 'leave') {
  const seen: EpisodePosition[] = [];
  const off = onPlayer(kind, (value) => seen.push(value));
  return { seen, off };
}

test('finishing completes the episode and plays the one that followed it', () => {
  const completed = listen('complete');
  const player = usePlayer.getState();
  player.playEpisode(a);
  player.enqueueEpisode(b, false);
  player.enqueueEpisode(c, true);
  usePlayer.setState({ state: 'playing', duration: 612, seekPosition: 611 });
  usePlayer.getState().onPlaybackEnd();
  completed.off();
  const state = usePlayer.getState();
  expect(state.queue).toEqual([c, b]);
  expect(getCurrentEpisode(state)).toBe(c);
  expect(state.state).toBe('buffering');
  expect(state.seekPosition).toBe(0);
  expect(completed.seen).toEqual([{ episode: a, position: 612 }]);
  expect(AudioUtils.play).toHaveBeenLastCalledWith(c, true, 0);
});

test('stop keeps the queue and place, and play resumes there', () => {
  const player = usePlayer.getState();
  player.playEpisode(a, 42);
  player.enqueueEpisode(b, false);
  usePlayer.setState({ state: 'playing' });
  usePlayer.getState().stop();
  expect(usePlayer.getState()).toMatchObject({
    queue: [a, b],
    currentTrackIndex: 0,
    seekPosition: 42,
    state: 'idle',
  });
  expect(AudioUtils.stop).toHaveBeenCalled();
  usePlayer.getState().markPlayed();
  expect(usePlayer.getState().queue).toEqual([a, b]);
  usePlayer.getState().togglePlayback();
  expect(usePlayer.getState().state).toBe('buffering');
  expect(AudioUtils.play).toHaveBeenLastCalledWith(a, true, 42);
});

test('moving to another episode while paused unloads audio and saves the outgoing place', () => {
  const left = listen('leave');
  const player = usePlayer.getState();
  player.playEpisode(a);
  player.enqueueEpisode(b, false);
  usePlayer.setState({ state: 'paused', seekPosition: 90 });
  usePlayer.getState().skipToNextEpisode();
  left.off();
  expect(getCurrentEpisode(usePlayer.getState())).toBe(b);
  expect(usePlayer.getState().state).toBe('paused');
  expect(AudioUtils.stop).toHaveBeenCalled();
  expect(left.seen).toEqual([{ episode: a, position: 90 }]);
  usePlayer.getState().togglePlayback();
  expect(usePlayer.getState().state).toBe('buffering');
  expect(AudioUtils.play).toHaveBeenLastCalledWith(b, true, 0);
});

test('editing up next keeps the current episode first', () => {
  const player = usePlayer.getState();
  for (const queued of [a, b, c]) player.enqueueEpisode(queued, false);
  player.playEpisode(b);
  usePlayer.getState().moveUpNext(1, 0);
  expect(usePlayer.getState().queue).toEqual([b, a, c]);
  usePlayer.getState().removeUpNext([0]);
  expect(usePlayer.getState().queue).toEqual([b, c]);
  expect(getCurrentEpisode(usePlayer.getState())).toBe(b);
  usePlayer.getState().clearQueue();
  expect(usePlayer.getState()).toMatchObject({ queue: [], state: 'idle' });
});

test('only contract speeds are accepted and holding restores the chosen speed', () => {
  spyOn(AudioUtils, 'setRate').mockImplementation(() => {});
  const player = usePlayer.getState();
  player.setRate(1.25);
  player.setRate(1.3);
  expect(usePlayer.getState().rate).toBe(1.25);
  usePlayer.getState().setOverridenRate(2);
  expect(usePlayer.getState().rate).toBe(2);
  usePlayer.getState().setOverridenRate(undefined);
  expect(usePlayer.getState()).toMatchObject({
    rate: 1.25,
    savedRate: undefined,
  });
});

test('a persisted session is restored only for the account that saved it', () => {
  const store = new Map<string, string>();
  const window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    },
  };
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: window,
  });
  try {
    writeSession({ scope: 'owner', queue: [a, b], current: 1, position: 30 });
    expect(readSession('other')).toBeNull();
    expect(readSession(null)).toBeNull();
    usePlayer.getState().setAccount('owner', 1);
    expect(usePlayer.getState()).toMatchObject({
      queue: [a, b],
      currentTrackIndex: 1,
      seekPosition: 30,
      state: 'paused',
    });
    usePlayer.getState().setAccount(undefined, 2);
    usePlayer.getState().setAccount('other', 2);
    expect(usePlayer.getState().queue).toEqual([]);
    expect(readSession('owner')).toBeNull();
  } finally {
    Reflect.deleteProperty(globalThis, 'window');
  }
});
