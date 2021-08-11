import { createContext, Dispatch } from 'react';
import { IEpisodeInfo, PlayerState } from '../../types';

export interface PlayerContextValue {
  queue: IEpisodeInfo[];
  currentTrackIndex: number;
  state: PlayerState;
}

export const PlayerStateContext = createContext<PlayerContextValue | undefined>(undefined);
PlayerStateContext.displayName = 'PlayerStateContext';

export const queueEpisode = (episode: IEpisodeInfo) =>
  ({
    type: 'QUEUE_EPISODE',
    episode,
  } as const);

export const playEpisode = (episode: IEpisodeInfo) =>
  ({
    type: 'SET_PLAYER_STATE',
    state: 'buffering',
    episode,
  } as const);

export const resumeEpisode = (episode: IEpisodeInfo) =>
  ({
    type: 'RESUME_EPISODE',
    episode,
  } as const);

export const skipToNextEpisode = () =>
  ({
    type: 'SKIP_TO_NEXT_EPISODE',
  } as const);

export const skipToPreviousEpisode = () =>
  ({
    type: 'SKIP_TO_PREVIOUS_EPISODE',
  } as const);

export const seekForward = () =>
  ({
    type: 'SEEK_FORWARD',
  } as const);

export const seekBackward = () =>
  ({
    type: 'SEEK_BACKWARD',
  } as const);

export const seekTo = (seconds: number) =>
  ({
    type: 'SEEK_TO',
    seconds,
  } as const);

export const setPlayerState = (state: 'playing' | 'paused' | 'idle') =>
  ({
    type: 'SET_PLAYER_STATE',
    state,
  } as const);

export type PlayerActions =
  | ReturnType<typeof queueEpisode>
  | ReturnType<typeof playEpisode>
  | ReturnType<typeof setPlayerState>
  | ReturnType<typeof resumeEpisode>
  | ReturnType<typeof skipToNextEpisode>
  | ReturnType<typeof skipToPreviousEpisode>
  | ReturnType<typeof seekForward>
  | ReturnType<typeof seekBackward>
  | ReturnType<typeof seekTo>;

export const PlayerActionsContext = createContext<Dispatch<PlayerActions> | undefined>(undefined);
PlayerActionsContext.displayName = 'PlayerActionsContext';
