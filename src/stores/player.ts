/**
 * Player reducer / actions
 */

import {
  Epic,
} from 'redux-observable';

import {
  State,
} from './root';

import {
  noop,
  INoopAction,
} from './utils';

import Audio from '../utils/audio';

/**
 * Play related actions
 */
export interface IPlayEpisodeAction {
  type: 'PLAY_EPISODE';
  episode: App.Episode;
}
export const PLAY_EPISODE: IPlayEpisodeAction['type'] = 'PLAY_EPISODE';
export const playEpisode = (episode: App.Episode): IPlayEpisodeAction => ({
  type: PLAY_EPISODE,
  episode,
});

/**
 * Pause related actions
 */
interface IPauseAction {
  type: 'PAUSE_EPISODE';
}
const PAUSE_EPISODE: IPauseAction['type'] = 'PAUSE_EPISODE';
export const pauseEpisode = (): IPauseAction => ({
  type: PAUSE_EPISODE,
});

interface IPauseAudioAction {
  type: 'PAUSE_EPISODE_AUDIO';
}
const PAUSE_EPISODE_AUDIO: IPauseAudioAction['type'] = 'PAUSE_EPISODE_AUDIO';
const pauseEpisodeAudio = (): IPauseAudioAction => ({
  type: PAUSE_EPISODE_AUDIO,
});

/**
 * Resume related actions
 */
interface IResumeEpisodeAction {
  type: 'RESUME_EPISODE';
}
const RESUME_EPISODE: IResumeEpisodeAction['type'] = 'RESUME_EPISODE';
export const resumeEpisode = (): IResumeEpisodeAction => ({
  type: RESUME_EPISODE,
});

interface IResumeEpisodeAudioAction {
  type: 'RESUME_EPISODE_AUDIO';
}
const RESUME_EPISODE_AUDIO: IResumeEpisodeAudioAction['type'] = 'RESUME_EPISODE_AUDIO';
const resumeEpisodeAudio = (): IResumeEpisodeAudioAction => ({
  type: RESUME_EPISODE_AUDIO,
});

/**
 * Stop related actions
 */
interface IStopAction {
  type: 'STOP_EPISODE';
}
export const STOP_EPISODE: IStopAction['type'] = 'STOP_EPISODE';
export const stopEpisode = (): IStopAction => ({
  type: STOP_EPISODE,
});

interface IStopAudioAction {
  type: 'STOP_EPISODE_AUDIO';
}
const STOP_EPISODE_AUDIO: IStopAudioAction['type'] = 'STOP_EPISODE_AUDIO';
const stopEpisodeAudio = (): IStopAudioAction => ({
  type: STOP_EPISODE_AUDIO,
});

/**
 * Skip to next action helpers
 */
interface ISkipToNextAction {
  type: 'SKIP_TO_NEXT_EPISODE';
}
const SKIP_TO_NEXT_EPISODE: ISkipToNextAction['type'] = 'SKIP_TO_NEXT_EPISODE';
export const skipToNextEpisode = (): ISkipToNextAction => ({
  type: SKIP_TO_NEXT_EPISODE,
});

/**
 * Skip to previous action helpers
 */
interface ISkipToPrevAction {
  type: 'SKIP_TO_PREV_EPISODE';
}
const SKIP_TO_PREV_EPISODE: ISkipToPrevAction['type'] = 'SKIP_TO_PREV_EPISODE';
export const skipToPrevEpisode = (): ISkipToPrevAction => ({
  type: SKIP_TO_PREV_EPISODE,
});

interface ISkipAudioAction {
  type: 'SKIP_AUDIO';
}
const SKIP_AUDIO: ISkipAudioAction['type'] = 'SKIP_AUDIO';
const skipAudio = (): ISkipAudioAction => ({
  type: SKIP_AUDIO,
});

/**
 * Seek update action
 */
interface ISeekUpdateAction {
  type: 'SEEK_UPDATE';
  seekPosition: number;
  duration: number;
}
const SEEK_UPDATE: ISeekUpdateAction['type'] = 'SEEK_UPDATE';
export const seekUpdate = (seekPosition: number, duration: number): ISeekUpdateAction => ({
  type: SEEK_UPDATE,
  duration,
  seekPosition,
});

/**
 * Manual seek update action
 */
interface IManualSeekUpdateAction {
  type: 'MANUAL_SEEK_UPDATE';
  seekPosition: number;
  duration: number;
}
const MANUAL_SEEK_UPDATE: IManualSeekUpdateAction['type'] = 'MANUAL_SEEK_UPDATE';
export const manualSeekUpdate = (seekPosition: number, duration: number): IManualSeekUpdateAction => ({
  type: MANUAL_SEEK_UPDATE,
  duration,
  seekPosition,
});

/**
 * Seek update success action
 */
interface ISeekUpdateSuccessAction {
  type: 'SEEK_UPDATE_SUCCESS';
  seekPosition: number;
  duration: number;
}
const SEEK_UPDATE_SUCCESS: ISeekUpdateSuccessAction['type'] = 'SEEK_UPDATE_SUCCESS';
export const seekUpdateSuccess = (seekPosition: number, duration: number) => ({
  type: SEEK_UPDATE_SUCCESS,
  duration,
  seekPosition,
});

interface ISetBufferAction {
  type: 'SET_BUFFER';
  buffering: boolean;
}
const SET_BUFFER: ISetBufferAction['type'] = 'SET_BUFFER';
export const setBuffer = (buffering: boolean): ISetBufferAction => ({
  type: SET_BUFFER,
  buffering,
});

export type PlayerActions =
  IPlayEpisodeAction |
  IPauseAction |
  IPauseAudioAction |
  IResumeEpisodeAction |
  IResumeEpisodeAudioAction |
  IStopAction |
  IStopAudioAction |
  ISkipToNextAction |
  ISkipToPrevAction |
  ISkipAudioAction |
  ISeekUpdateAction |
  ISeekUpdateSuccessAction |
  IManualSeekUpdateAction |
  ISetBufferAction |
  INoopAction;

export interface IPlayerState {
  currentEpisode: number;
  queue: App.Episode[];
  state: EpisodePlayerState;
  seekPosition: number;
  duration: number;
  buffering: boolean;
}

export const seekUpdateEpic: Epic<PlayerActions, State> = (action$) =>
  action$
    .ofType(SEEK_UPDATE)
    .throttleTime(1000)
    .map(
      (action: ISeekUpdateAction) =>
        seekUpdateSuccess(action.seekPosition, action.duration),
    );

export const manualSeekUpdateEpic: Epic<PlayerActions, State> = (action$) =>
  action$
    .ofType(MANUAL_SEEK_UPDATE)
    .do((action: IManualSeekUpdateAction) => Audio.seekTo(action.seekPosition))
    .map(noop);

export const playerAudioEpic: Epic<PlayerActions, State> = (action$, state) =>
  action$
    .filter((action) => (
      action.type === PLAY_EPISODE ||
      action.type === PAUSE_EPISODE ||
      action.type === RESUME_EPISODE ||
      action.type === STOP_EPISODE ||
      action.type === SKIP_TO_NEXT_EPISODE ||
      action.type === SKIP_TO_PREV_EPISODE
    ))
    .do((action: PlayerActions) => {
      switch (action.type) {
        case PLAY_EPISODE:
          return Audio.play(action.episode);
        case PAUSE_EPISODE:
          return Audio.pause();
        case RESUME_EPISODE:
          return Audio.resume();
        case STOP_EPISODE:
          return Audio.stop();
        case SKIP_TO_NEXT_EPISODE:
        case SKIP_TO_PREV_EPISODE:
          const {
            currentEpisode,
            queue,
          } = state.getState().player;
          return Audio.skipTo(queue[currentEpisode]);
      }
    })
    .map((action: PlayerActions) => {
      switch (action.type) {
        case PLAY_EPISODE:
          return setBuffer(true);
        case PAUSE_EPISODE:
          return pauseEpisodeAudio();
        case RESUME_EPISODE:
          return resumeEpisodeAudio();
        case STOP_EPISODE:
          return stopEpisodeAudio();
        case SKIP_TO_NEXT_EPISODE:
        case SKIP_TO_PREV_EPISODE:
          return skipAudio();
        default:
          return noop();
      }
    });

export const player = (
  state: IPlayerState = {
    buffering: false,
    currentEpisode: 0,
    duration: 0,
    queue: [],
    seekPosition: 0,
    state: 'stopped',
  },
  action: PlayerActions,
): IPlayerState => {
  switch (action.type) {
    case PLAY_EPISODE: {
      const queue = state.queue.concat(action.episode);
      const currentEpisode = queue.length - 1;
      const {
        duration,
      } = queue[currentEpisode];
      return {
        ...state,
        currentEpisode,
        duration: duration || 0,
        queue,
        state: 'playing',
      };
    }
    case PAUSE_EPISODE: {
      return state.queue.length === 0 || state.state === 'stopped' ?
      state :
      {
        ...state,
        state: 'paused',
      };
    }
    case RESUME_EPISODE: {
      return state.queue.length === 0 || state.state === 'stopped' ?
      state :
      {
        ...state,
        state: 'playing',
      };
    }
    case STOP_EPISODE: {
      return {
        ...state,
        seekPosition: 0,
        state: 'stopped',
      };
    }
    case SKIP_TO_NEXT_EPISODE: {
      const currentEpisode = (state.currentEpisode + 1) % state.queue.length;
      const {
        duration,
      } = state.queue[currentEpisode];
      return {
        ...state,
        currentEpisode,
        duration: duration || 0,
      };
    }
    case SKIP_TO_PREV_EPISODE: {
      const currentEpisode = state.currentEpisode === 0 ?
        state.queue.length - 1 :
        (state.currentEpisode - 1) / state.queue.length;
      const {
        duration,
      } = state.queue[currentEpisode];
      return {
        ...state,
        currentEpisode,
        duration: duration || 0,
      };
    }
    case MANUAL_SEEK_UPDATE:
    case SEEK_UPDATE_SUCCESS: {
      const episode = state.queue[state.currentEpisode];
      return {
        ...state,
        duration: action.duration || episode.duration || 0,
        seekPosition: action.seekPosition,
      };
    }
    case SET_BUFFER:
      const { buffering } = action;
      return {
        ...state,
        buffering,
      };
    default:
      return state;
  }
};
