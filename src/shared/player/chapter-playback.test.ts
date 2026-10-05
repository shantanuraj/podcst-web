import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import type { IEpisodeInfo } from '@/types';
import AudioUtils from './AudioUtils';
import { navigateChapter } from './chapter-playback';
import { sameEpisode } from './episode-identity';
import { getSeekOrStartAt, type IPlayerState, usePlayer } from './usePlayer';

const episode = {
  id: 42,
  feed: 'synthetic',
  guid: 'chapter-fixture',
} as IEpisodeInfo;
const chapters = [
  { title: 'Start', start: 0 },
  { title: 'Topic', start: 30.5 },
];

afterEach(() => {
  mock.restore();
});

test('chapter navigation seeks through existing actions in original time, with episode fallbacks', () => {
  const player = {
    queue: [episode],
    currentTrackIndex: 0,
    seekPosition: 1,
    rate: 2,
    seekOrStartAt: mock(),
    skipToNextEpisode: mock(),
    skipToPreviousEpisode: mock(),
  } as unknown as IPlayerState;
  navigateChapter(player, episode, chapters, 'next');
  expect(player.seekOrStartAt).toHaveBeenCalledWith(episode, 30.5);
  player.seekPosition = 30.5;
  navigateChapter(player, episode, chapters, 'previous');
  expect(player.seekOrStartAt).toHaveBeenLastCalledWith(episode, 0);
  player.seekPosition = 34;
  navigateChapter(player, episode, chapters, 'previous');
  expect(player.seekOrStartAt).toHaveBeenLastCalledWith(episode, 30.5);
  navigateChapter(player, episode, chapters, 'next');
  expect(player.skipToNextEpisode).toHaveBeenCalledTimes(1);
  navigateChapter(player, episode, [], 'previous');
  expect(player.skipToPreviousEpisode).toHaveBeenCalledTimes(1);
  navigateChapter(player, { ...episode, id: 43 }, chapters, 'next');
  expect(player.skipToNextEpisode).toHaveBeenCalledTimes(1);
});

test('chapter identity includes feed or database ID, not GUID alone', () => {
  expect(sameEpisode(episode, { ...episode, id: 43 })).toBe(false);
  expect(
    sameEpisode(
      { ...episode, id: undefined },
      { ...episode, id: undefined, feed: 'different' },
    ),
  ).toBe(false);
});

test('selection uses existing seek/start action for local audio and unloaded episodes', () => {
  const state = usePlayer.getState();
  const seek = spyOn(AudioUtils, 'seekTo').mockImplementation(() => {});
  spyOn(AudioUtils, 'loaded').mockReturnValue(true);
  const start = mock();
  usePlayer.setState({
    queue: [episode],
    currentTrackIndex: 0,
    state: 'paused',
    playEpisode: start,
  });
  getSeekOrStartAt(usePlayer.getState())(episode, 30.5);
  expect(seek).toHaveBeenCalledWith(30.5);
  const other = { ...episode, id: 43, guid: 'other' };
  getSeekOrStartAt(usePlayer.getState())(other, 12.25);
  expect(start).toHaveBeenCalledWith(other, 12.25);
  usePlayer.setState(state, true);
});

test('restored paused episodes retain chapter seeks before Howler is initialized', () => {
  const saved = usePlayer.getState();
  const seek = spyOn(AudioUtils, 'seekTo').mockImplementation(() => {});
  try {
    usePlayer.setState({
      queue: [episode],
      currentTrackIndex: 0,
      state: 'paused',
      seekPosition: 0,
    });
    getSeekOrStartAt(usePlayer.getState())(episode, 30.5);
    expect(usePlayer.getState().seekPosition).toBe(30.5);
    expect(usePlayer.getState().state).toBe('paused');
    expect(seek).not.toHaveBeenCalled();
  } finally {
    usePlayer.setState(saved, true);
  }
});

test('chapter selection cannot seek a different episode with a reused GUID', () => {
  const saved = usePlayer.getState();
  const seek = spyOn(AudioUtils, 'seekTo').mockImplementation(() => {});
  const play = spyOn(AudioUtils, 'play').mockImplementation(() => {});
  const other = { ...episode, id: 43, feed: 'different-feed' };
  try {
    usePlayer.setState({
      queue: [episode],
      currentTrackIndex: 0,
      state: 'paused',
    });
    getSeekOrStartAt(usePlayer.getState())(other, 12.25);
    expect(usePlayer.getState().queue).toEqual([episode, other]);
    expect(usePlayer.getState().currentTrackIndex).toBe(1);
    expect(play).toHaveBeenCalledWith(other, true, 12.25);
    expect(seek).not.toHaveBeenCalled();
  } finally {
    usePlayer.setState(saved, true);
  }
});

test('chapter selection reaches Chromecast seek without changing system track handlers', () => {
  const saved = ['window', 'cast', 'chrome'].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  const state = usePlayer.getState();
  const seek = mock();
  const context = {
    getCurrentSession: () => ({ getMediaSession: () => ({ seek }) }),
  };
  const cast = {
    framework: {
      CastState: { CONNECTED: 'CONNECTED' },
      CastContext: { getInstance: () => context },
    },
  };
  const chrome = {
    cast: {
      media: {
        SeekRequest: class {
          currentTime = 0;
        },
      },
    },
  };
  try {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { cast },
    });
    Object.defineProperty(globalThis, 'cast', {
      configurable: true,
      value: cast,
    });
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: chrome,
    });
    usePlayer.setState({
      queue: [episode],
      currentTrackIndex: 0,
      state: 'paused',
      chromecastState: 'CONNECTED' as cast.framework.CastState,
    });
    getSeekOrStartAt(usePlayer.getState())(episode, 30.5);
    expect(seek.mock.calls[0][0].currentTime).toBe(30.5);
    expect(usePlayer.getState().skipToNextEpisode).toBe(
      state.skipToNextEpisode,
    );
    expect(usePlayer.getState().skipToPreviousEpisode).toBe(
      state.skipToPreviousEpisode,
    );
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    usePlayer.setState(state, true);
  }
});
