/**
 * Player reducer / actions
 */

import { Epic } from 'redux-observable';

import { IState } from './root';

import { INoopAction, noop } from './utils';

import Audio from '../utils/audio';

import { normalizeSeek } from '../utils';

import { SEEK_DELTA } from '../utils/constants';

/**
 * Play related actions
 */
export interface IPlayEpisodeAction {
  type: 'PLAY_EPISODE';
  episode: App.IEpisodeInfo;
}
export const PLAY_EPISODE: IPlayEpisodeAction['type'] = 'PLAY_EPISODE';
export const playEpisode = (episode: App.IEpisodeInfo): IPlayEpisodeAction => ({
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
interface ISeekUpdateRequestAction {
  type: 'SEEK_UPDATE_REQUEST';
  duration: number;
  seekPosition: number;
}
const SEEK_UPDATE_REQUEST: ISeekUpdateRequestAction['type'] = 'SEEK_UPDATE_REQUEST';
export const seekUpdateRequest = (seekPosition: number, duration: number): ISeekUpdateRequestAction => ({
  type: SEEK_UPDATE_REQUEST,
  duration,
  seekPosition,
});

/**
 * Manual seek update action
 */
interface IManualSeekUpdateAction {
  type: 'MANUAL_SEEK_UPDATE';
  duration: number;
  seekPosition: number;
}
const MANUAL_SEEK_UPDATE: IManualSeekUpdateAction['type'] = 'MANUAL_SEEK_UPDATE';
export const manualSeekUpdate = (seekPosition: number, duration: number): IManualSeekUpdateAction => ({
  type: MANUAL_SEEK_UPDATE,
  duration,
  seekPosition,
});

/**
 * Jump Seek action creator
 */
export type SeekDirection = 'seek-forward' | 'seek-back';
interface IJumpSeekAction {
  type: 'JUMP_SEEK';
  direction: SeekDirection;
}
const JUMP_SEEK: IJumpSeekAction['type'] = 'JUMP_SEEK';
export const jumpSeek = (direction: SeekDirection) => ({
  type: JUMP_SEEK,
  direction,
});

/**
 * Seek update success action
 */
interface ISeekUpdateSuccessAction {
  type: 'SEEK_UPDATE_SUCCESS';
  duration: number;
  seekPosition: number;
}
const SEEK_UPDATE_SUCCESS: ISeekUpdateSuccessAction['type'] = 'SEEK_UPDATE_SUCCESS';
export const seekUpdateSuccess = (seekPosition: number, duration: number): ISeekUpdateSuccessAction => ({
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
  | IPlayEpisodeAction
  | IPauseAction
  | IPauseAudioAction
  | IResumeEpisodeAction
  | IResumeEpisodeAudioAction
  | IStopAction
  | IStopAudioAction
  | ISkipToNextAction
  | ISkipToPrevAction
  | ISkipAudioAction
  | ISeekUpdateRequestAction
  | ISeekUpdateSuccessAction
  | IJumpSeekAction
  | IManualSeekUpdateAction
  | ISetBufferAction
  | INoopAction;

export interface IPlayerState {
  buffering: boolean;
  currentEpisode: number;
  duration: number;
  queue: App.IEpisodeInfo[];
  seekDelta: number;
  seekPosition: number;
  state: EpisodePlayerState;
}

export const seekUpdateEpic: Epic<PlayerActions, IState> = action$ =>
  action$
    .ofType(SEEK_UPDATE_REQUEST)
    .throttleTime(1000)
    .map((action: ISeekUpdateRequestAction) => seekUpdateSuccess(action.seekPosition, action.duration));

export const manualSeekUpdateEpic: Epic<PlayerActions, IState> = action$ =>
  action$
    .ofType(MANUAL_SEEK_UPDATE)
    .do((action: IManualSeekUpdateAction) => Audio.seekTo(action.seekPosition))
    .map(noop);

export const playerAudioEpic: Epic<PlayerActions, IState> = (action$, state) =>
  action$
    .filter(
      action =>
        action.type === PLAY_EPISODE ||
        action.type === PAUSE_EPISODE ||
        action.type === RESUME_EPISODE ||
        action.type === STOP_EPISODE ||
        action.type === SKIP_TO_NEXT_EPISODE ||
        action.type === SKIP_TO_PREV_EPISODE,
    )
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
          const { currentEpisode, queue } = state.getState().player;
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
    seekDelta: SEEK_DELTA,
    seekPosition: 0,
    state: 'stopped',
  },
  action: PlayerActions,
): IPlayerState => {
  switch (action.type) {
    case PLAY_EPISODE: {
      const queue = state.queue.concat(action.episode);
      const currentEpisode = queue.length - 1;
      const { duration } = queue[currentEpisode];
      return {
        ...state,
        currentEpisode,
        duration: duration || 0,
        queue,
        seekPosition: 0,
        state: 'playing',
      };
    }
    case PAUSE_EPISODE: {
      return state.queue.length === 0 || state.state === 'stopped'
        ? state
        : {
            ...state,
            state: 'paused',
          };
    }
    case RESUME_EPISODE: {
      return state.queue.length === 0 || state.state === 'stopped'
        ? state
        : {
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
      const { duration } = state.queue[currentEpisode];
      return {
        ...state,
        currentEpisode,
        duration: duration || 0,
      };
    }
    case SKIP_TO_PREV_EPISODE: {
      const currentEpisode =
        state.currentEpisode === 0 ? state.queue.length - 1 : (state.currentEpisode - 1) / state.queue.length;
      const { duration } = state.queue[currentEpisode];
      return {
        ...state,
        currentEpisode,
        duration: duration || 0,
      };
    }
    case MANUAL_SEEK_UPDATE:
    case SEEK_UPDATE_SUCCESS: {
      const episode = state.queue[state.currentEpisode];
      return state.buffering || state.state === 'stopped'
        ? state
        : {
            ...state,
            duration: action.duration || episode.duration || 0,
            seekPosition: action.seekPosition,
          };
    }
    case JUMP_SEEK: {
      const { direction } = action;
      const { duration, seekDelta, seekPosition } = state;
      const seekTo = seekPosition + seekDelta * (direction === 'seek-forward' ? 1 : -1);
      return state.buffering || state.state === 'stopped'
        ? state
        : {
            ...state,
            seekPosition: normalizeSeek(seekTo, duration),
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
