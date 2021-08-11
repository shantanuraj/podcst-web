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
    type: 'PLAY_EPISODE',
    episode,
  } as const);

export const setPlayerState = (state: PlayerState) =>
  ({
    type: 'SET_PLAYER_STATE',
    state,
  } as const);

export type PlayerActions =
  | ReturnType<typeof queueEpisode>
  | ReturnType<typeof playEpisode>
  | ReturnType<typeof setPlayerState>;

export const PlayerActionsContext = createContext<Dispatch<PlayerActions> | undefined>(undefined);
PlayerActionsContext.displayName = 'PlayerActionsContext';
