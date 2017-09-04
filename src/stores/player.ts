/**
 * Player reducer / actions
 */

import {
  Epic,
} from 'redux-observable';

import {
  State,
} from './root';

import Audio from '../utils/audio';

interface PlayEpisodeAction {
  type: 'PLAY_EPISODE',
  episode: App.Episode,
}
const PLAY_EPISODE: PlayEpisodeAction['type'] = 'PLAY_EPISODE';
export const playEpisode = (episode: App.Episode): PlayEpisodeAction => ({
  type: PLAY_EPISODE,
  episode,
});

interface PlayEpisodeAudioAction {
  type: 'PLAY_EPISODE_AUDIO',
  episode: App.Episode,
}
const PLAY_EPISODE_AUDIO: PlayEpisodeAudioAction['type'] = 'PLAY_EPISODE_AUDIO';
const playEpisodeAudio = (episode: App.Episode): PlayEpisodeAudioAction => ({
  type: PLAY_EPISODE_AUDIO,
  episode,
});

interface PauseAction {
  type: 'PAUSE_EPISODE',
}
const PAUSE_EPISODE: PauseAction['type'] = 'PAUSE_EPISODE';
export const pauseEpisode = (): PauseAction => ({
  type: PAUSE_EPISODE,
});

interface PauseAudioAction {
  type: 'PAUSE_EPISODE_AUDIO',
}
const PAUSE_EPISODE_AUDIO: PauseAudioAction['type'] = 'PAUSE_EPISODE_AUDIO';
const pauseEpisodeAudio = (): PauseAudioAction => ({
  type: PAUSE_EPISODE_AUDIO,
});

interface StopAction {
  type: 'STOP_EPISODE',
}
const STOP_EPISODE: StopAction['type'] = 'STOP_EPISODE';
export const stopEpisode = (): StopAction => ({
  type: STOP_EPISODE,
});

interface StopAudioAction {
  type: 'STOP_EPISODE_AUDIO',
}
const STOP_EPISODE_AUDIO: StopAudioAction['type'] = 'STOP_EPISODE_AUDIO';
const stopEpisodeAudio = (): StopAudioAction => ({
  type: STOP_EPISODE_AUDIO,
});

interface SkipToNextAction {
  type: 'SKIP_TO_NEXT_EPISODE',
}
const SKIP_TO_NEXT_EPISODE: SkipToNextAction['type'] = 'SKIP_TO_NEXT_EPISODE';
export const skipToNextEpisode = (): SkipToNextAction => ({
  type: SKIP_TO_NEXT_EPISODE,
});

interface SkipToPrevAction {
  type: 'SKIP_TO_PREV_EPISODE',
}
const SKIP_TO_PREV_EPISODE: SkipToPrevAction['type'] = 'SKIP_TO_PREV_EPISODE';
export const skipToPrevEpisode = (): SkipToPrevAction => ({
  type: SKIP_TO_PREV_EPISODE,
});

interface SkipAudioAction {
  type: 'SKIP_AUDIO',
}
const SKIP_AUDIO: SkipAudioAction['type'] = 'SKIP_AUDIO';
const skipAudio = (): SkipAudioAction => ({
  type: SKIP_AUDIO,
});

interface NoopAction {
  type: 'NOOP',
}
const NOOP: NoopAction['type'] = 'NOOP';
const noop = (): NoopAction => ({
  type: NOOP,
});

export type PlayerActions =
  PlayEpisodeAction |
  PlayEpisodeAudioAction |
  PauseAction |
  PauseAudioAction |
  StopAction |
  StopAudioAction |
  SkipToNextAction |
  SkipToPrevAction |
  SkipAudioAction |
  NoopAction;

export interface PlayerState {
  currentEpisode: number;
  queue: App.Episode[];
  state: EpisodePlayerState;
}

export const playerAudioEpic: Epic<PlayerActions, State> = (action$, state) =>
  action$
    .filter(action => action.type !== NOOP)
    .map((action: PlayerActions) => {
      switch (action.type) {
        case PLAY_EPISODE:
          Audio.play(action.episode);
          return playEpisodeAudio(action.episode);
        case PAUSE_EPISODE:
          Audio.pause();
          return pauseEpisodeAudio();
        case STOP_EPISODE:
          Audio.stop();
          return stopEpisodeAudio();
        case SKIP_TO_NEXT_EPISODE:
        case SKIP_TO_PREV_EPISODE:
          const {
            currentEpisode,
            queue,
          } = state.getState().player;
          Audio.skipTo(queue[currentEpisode]);
          return skipAudio();
        default:
          return noop();
      }
    });

export const player = (state: PlayerState = {
  currentEpisode: 0,
  queue: [],
  state: 'stopped',
}, action: PlayerActions): PlayerState => {
  switch (action.type) {
    case PLAY_EPISODE:
      const queue = state.queue.concat(action.episode);
      const currentEpisode = queue.length - 1;
      return {
        ...state,
        currentEpisode,
        state: 'playing',
        queue,
      };
    case PAUSE_EPISODE:
      return {
        ...state,
        state: 'paused',
      };
    case STOP_EPISODE:
      return {
        ...state,
        state: 'stopped',
      };
    case SKIP_TO_NEXT_EPISODE:
      return {
        ...state,
        currentEpisode: (state.currentEpisode + 1) / state.queue.length,
      };
    case SKIP_TO_PREV_EPISODE:
      return {
        ...state,
        currentEpisode: state.currentEpisode === 0 ?
          state.queue.length - 1 :
          (state.currentEpisode - 1) / state.queue.length,
      };
    default:
      return state;
  }
}
