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

/**
 * Play related actions
 */
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

/**
 * Pause related actions
 */
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

/**
 * Resume related actions
 */
interface ResumeEpisodeAction {
  type: 'RESUME_EPISODE',
}
const RESUME_EPISODE: ResumeEpisodeAction['type'] = 'RESUME_EPISODE';
export const resumeEpisode = (): ResumeEpisodeAction => ({
  type: RESUME_EPISODE,
});

interface ResumeEpisodeAudioAction {
  type: 'RESUME_EPISODE_AUDIO',
}
const RESUME_EPISODE_AUDIO: ResumeEpisodeAudioAction['type'] = 'RESUME_EPISODE_AUDIO';
const resumeEpisodeAudio = (): ResumeEpisodeAudioAction => ({
  type: RESUME_EPISODE_AUDIO,
});

/**
 * Stop related actions
 */
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

/**
 * Skip to next action helpers
 */
interface SkipToNextAction {
  type: 'SKIP_TO_NEXT_EPISODE',
}
const SKIP_TO_NEXT_EPISODE: SkipToNextAction['type'] = 'SKIP_TO_NEXT_EPISODE';
export const skipToNextEpisode = (): SkipToNextAction => ({
  type: SKIP_TO_NEXT_EPISODE,
});

/**
 * Skip to previous action helpers
 */
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

/**
 * Seek update action
 */
interface SeekUpdateAction {
  type: 'SEEK_UPDATE',
  seekPosition: number;
  duration: number;
}
const SEEK_UPDATE: SeekUpdateAction['type'] = 'SEEK_UPDATE';
export const seekUpdate = (seekPosition: number, duration: number) => ({
  type: SEEK_UPDATE,
  seekPosition,
  duration,
});

/**
 * Manual seek update action
 */
interface ManualSeekUpdateAction {
  type: 'MANUAL_SEEK_UPDATE',
  seekPosition: number;
  duration: number;
}
const MANUAL_SEEK_UPDATE: ManualSeekUpdateAction['type'] = 'MANUAL_SEEK_UPDATE';
export const manualSeekUpdate = (seekPosition: number, duration: number) => ({
  type: MANUAL_SEEK_UPDATE,
  seekPosition,
  duration,
});

/**
 * Seek update success action
 */
interface SeekUpdateSuccessAction {
  type: 'SEEK_UPDATE_SUCCESS',
  seekPosition: number;
  duration: number;
}
const SEEK_UPDATE_SUCCESS: SeekUpdateSuccessAction['type'] = 'SEEK_UPDATE_SUCCESS';
export const seekUpdateSuccess = (seekPosition: number, duration: number) => ({
  type: SEEK_UPDATE_SUCCESS,
  seekPosition,
  duration,
});

/**
 * Noop action
 */
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
  ResumeEpisodeAction |
  ResumeEpisodeAudioAction |
  StopAction |
  StopAudioAction |
  SkipToNextAction |
  SkipToPrevAction |
  SkipAudioAction |
  SeekUpdateAction |
  SeekUpdateSuccessAction |
  ManualSeekUpdateAction |
  NoopAction;

export interface PlayerState {
  currentEpisode: number;
  queue: App.Episode[];
  state: EpisodePlayerState;
  seekPosition: number;
  duration: number;
}

export const seekUpdateEpic: Epic<PlayerActions, State> = action$ =>
  action$
    .ofType(SEEK_UPDATE)
    .throttleTime(1000)
    .map(
      (action: SeekUpdateAction) =>
        seekUpdateSuccess(action.seekPosition, action.duration)
    );

export const manualSeekUpdateEpic: Epic<PlayerActions, State> = action$ =>
  action$
    .ofType(MANUAL_SEEK_UPDATE)
    .do((action: ManualSeekUpdateAction) => Audio.seekTo(action.seekPosition))
    .map(noop);

export const playerAudioEpic: Epic<PlayerActions, State> = (action$, state) =>
  action$
    .filter(action => (
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
          return playEpisodeAudio(action.episode);
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

export const player = (state: PlayerState = {
  currentEpisode: 0,
  queue: [],
  state: 'stopped',
  seekPosition: 0,
  duration: 0,
}, action: PlayerActions): PlayerState => {
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
        state: 'playing',
        queue,
      };
    }
    case PAUSE_EPISODE: {
      return {
        ...state,
        state: 'paused',
      };
    }
    case RESUME_EPISODE: {
      return {
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
        seekPosition: action.seekPosition,
        duration: action.duration || episode.duration || 0,
      };
    }
    default:
      return state;
  }
}
