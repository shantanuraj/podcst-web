import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import type { IEpisodeInfo } from '@/types';
import AudioUtils from './AudioUtils';
import { readSession, writeSession } from './persisted-session';
import { type EpisodePosition, onPlayer } from './player-events';
import { getCurrentEpisode, usePlayer } from './usePlayer';

const episode = (id: number) =>
  ({
    id: String(id),
    feed: 'synthetic',
    guid: `episode-${id}`,
    title: `Episode ${id}`,
    duration: 600,
    file: { url: `https://example.invalid/${id}.mp3` },
  }) as IEpisodeInfo;

const [a, b, c] = [episode(1), episode(2), episode(3)];
const initial = usePlayer.getState();

const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
beforeEach(async () => {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: async (_name: string, work: () => void) => work() },
  });
  spyOn(AudioUtils, 'play').mockImplementation(() => {});
  spyOn(AudioUtils, 'pause').mockImplementation(() => {});
  spyOn(AudioUtils, 'resume').mockImplementation(() => {});
  spyOn(AudioUtils, 'stop').mockImplementation(() => {});
  spyOn(AudioUtils, 'seekTo').mockImplementation(() => {});
});

afterEach(() => {
  if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks);
  else Reflect.deleteProperty(navigator, 'locks');
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

test('a persisted session is restored only for its account and survives A to B to A', async () => {
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
    await writeSession({
      scope: 'owner',
      queue: [a, b],
      current: 1,
      position: 30,
    });
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
    expect(readSession('owner')?.queue).toEqual([a, b]);
    usePlayer.getState().setAccount('owner', 3);
    expect(usePlayer.getState().queue).toEqual([a, b]);
  } finally {
    Reflect.deleteProperty(globalThis, 'window');
  }
});

function clipBehind(start = 60, end = 120) {
  const player = usePlayer.getState();
  player.playEpisode(a, 30);
  player.enqueueEpisode(b, false);
  usePlayer.setState({ state: 'playing', seekPosition: 45 });
  usePlayer.getState().playClip(c, { start, end });
}

test('a clip borrows the current slot and the previous episode tops up next', () => {
  const left = listen('leave');
  clipBehind();
  left.off();
  const state = usePlayer.getState();
  expect(state.queue).toEqual([c, a, b]);
  expect(getCurrentEpisode(state)).toBe(c);
  expect(state).toMatchObject({ state: 'buffering', seekPosition: 60 });
  expect(state.clip).toMatchObject({
    start: 60,
    end: 120,
    borrowed: true,
    ended: false,
    previous: { episode: a, position: 45 },
  });
  expect(left.seen).toEqual([{ episode: a, position: 45 }]);
  expect(AudioUtils.play).toHaveBeenLastCalledWith(c, true, 60);
});

test('a clip pauses once at its end without completing or advancing', () => {
  const completed = listen('complete');
  clipBehind();
  usePlayer.setState({ state: 'playing' });
  usePlayer.getState().setSeekPosition(119.5);
  expect(usePlayer.getState().clip?.ended).toBe(false);
  usePlayer.getState().setSeekPosition(120.2);
  usePlayer.getState().onPlaybackEnd();
  completed.off();
  const state = usePlayer.getState();
  expect(state.clip?.ended).toBe(true);
  expect(state.state).toBe('paused');
  expect(getCurrentEpisode(state)).toBe(c);
  expect(completed.seen).toEqual([]);
});

test('seeking inside a clip stays within its range', () => {
  clipBehind();
  spyOn(AudioUtils, 'loaded').mockImplementation(() => true);
  usePlayer.getState().seekTo(10);
  expect(AudioUtils.seekTo).toHaveBeenLastCalledWith(60);
  usePlayer.getState().seekTo(500);
  expect(AudioUtils.seekTo).toHaveBeenLastCalledWith(120);
});

test('keep listening leaves clip mode in place and keeps the episode current', () => {
  clipBehind();
  usePlayer.getState().setSeekPosition(120);
  usePlayer.getState().keepListening();
  const state = usePlayer.getState();
  expect(state.clip).toBeUndefined();
  expect(getCurrentEpisode(state)).toBe(c);
  expect(state.state).toBe('buffering');
  expect(state.seekPosition).toBe(120);
});

test('closing a borrowed clip returns the queue and the previous place', () => {
  clipBehind();
  usePlayer.getState().closeClip();
  const state = usePlayer.getState();
  expect(state.clip).toBeUndefined();
  expect(state.queue).toEqual([a, b]);
  expect(getCurrentEpisode(state)).toBe(a);
  expect(state).toMatchObject({ state: 'paused', seekPosition: 45 });
});

test('closing a clip of an already queued episode keeps it queued', () => {
  const player = usePlayer.getState();
  player.playEpisode(a);
  player.enqueueEpisode(c, false);
  usePlayer.getState().playClip(c, { start: 5, end: 10 });
  expect(usePlayer.getState().clip?.borrowed).toBe(false);
  usePlayer.getState().closeClip();
  expect(usePlayer.getState().queue).toEqual([a, c]);
  expect(getCurrentEpisode(usePlayer.getState())).toBe(a);
});

test('queueing a clip episode moves it to the end and restores the previous episode', () => {
  clipBehind();
  usePlayer.getState().queueClipEpisode();
  const state = usePlayer.getState();
  expect(state.clip).toBeUndefined();
  expect(state.queue).toEqual([a, b, c]);
  expect(getCurrentEpisode(state)).toBe(a);
  expect(state).toMatchObject({ state: 'paused', seekPosition: 45 });
});

test('playing another episode leaves clip mode and returns the borrowed slot', () => {
  clipBehind();
  usePlayer.getState().playEpisode(b);
  const state = usePlayer.getState();
  expect(state.clip).toBeUndefined();
  expect(state.queue).toEqual([a, b]);
  expect(getCurrentEpisode(state)).toBe(b);
});

test('playing the clip episode itself keeps it and leaves clip mode', () => {
  clipBehind();
  usePlayer.getState().playEpisode(c, 70);
  const state = usePlayer.getState();
  expect(state.clip).toBeUndefined();
  expect(state.queue).toEqual([c, a, b]);
  expect(getCurrentEpisode(state)).toBe(c);
});

test('replaying and retargeting a clip seek to its new start', () => {
  clipBehind();
  spyOn(AudioUtils, 'loaded').mockImplementation(() => true);
  usePlayer.getState().setSeekPosition(120);
  usePlayer.getState().replayClip();
  expect(usePlayer.getState().clip?.ended).toBe(false);
  expect(AudioUtils.seekTo).toHaveBeenLastCalledWith(60);
  usePlayer.getState().retargetClip({
    start: 120,
    end: 200,
    chapter: { number: 4, title: 'Four' },
  });
  expect(usePlayer.getState().clip).toMatchObject({
    start: 120,
    end: 200,
    chapter: { number: 4, title: 'Four' },
    ended: false,
  });
  expect(AudioUtils.seekTo).toHaveBeenLastCalledWith(120);
});

test('the persisted session is not rewritten while a clip borrows the queue', async () => {
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
  try {
    usePlayer.getState().setAccount('owner', 1);
    usePlayer.getState().playEpisode(a, 30);
    await Promise.resolve();
    usePlayer.getState().playClip(c, { start: 60, end: 120 });
    await Promise.resolve();
    expect(readSession('owner')?.queue).toEqual([a]);
    usePlayer.getState().closeClip();
    await Promise.resolve();
    expect(readSession('owner')?.queue).toEqual([a]);
  } finally {
    Reflect.deleteProperty(globalThis, 'window');
  }
});

test('playing after a clip ends keeps listening with progress resumed', () => {
  clipBehind();
  usePlayer.getState().setSeekPosition(120);
  usePlayer.getState().togglePlayback();
  const state = usePlayer.getState();
  expect(state.clip).toBeUndefined();
  expect(getCurrentEpisode(state)).toBe(c);
  expect(state.state).toBe('buffering');
});
