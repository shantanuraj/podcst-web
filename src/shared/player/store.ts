import { PlayerActions, PlayerContextValue } from './context';

export function playerReducer(
  state: PlayerContextValue,
  action: PlayerActions,
): PlayerContextValue {
  switch (action.type) {
    case 'QUEUE_EPISODE': {
      return {
        ...state,
        queue: state.queue.concat(action.episode),
      };
    }
    case 'PLAY_EPISODE': {
      const nextState = {
        ...state,
        state: 'playing' as const,
        currentTrackIndex: state.queue.findIndex((episode) => episode.guid === action.episode.guid),
      };

      // Queue episode if not in the queue
      if (nextState.currentTrackIndex === -1) {
        nextState.currentTrackIndex = nextState.queue.length;
        nextState.queue = nextState.queue.concat(action.episode);
      }

      return nextState;
    }
    case 'SET_PLAYER_STATE': {
      return {
        ...state,
        state: action.state,
      };
    }
    default:
      return state;
  }
}

export const initialState: PlayerContextValue = {
  queue: [],
  currentTrackIndex: 0,
  state: 'idle',
};
