import { Howl } from 'howler';

import AudioUtils from './AudioUtils';
import { PlayerActions, PlayerContextValue } from './context';

function reducer(state: PlayerContextValue, action: PlayerActions): PlayerContextValue {
  switch (action.type) {
    case 'QUEUE_EPISODE': {
      return {
        ...state,
        queue: state.queue.concat(action.episode),
      };
    }
    case 'SET_PLAYER_STATE': {
      if (action.state === 'buffering') {
        const nextState = {
          ...state,
          state: action.state,
          currentTrackIndex: state.queue.findIndex(
            (episode) => episode.guid === action.episode.guid,
          ),
        };

        // Queue episode if not in the queue
        if (nextState.currentTrackIndex === -1) {
          nextState.currentTrackIndex = nextState.queue.length;
          nextState.queue = nextState.queue.concat(action.episode);
        }

        return nextState;
      }

      return {
        ...state,
        state: action.state,
      };
    }
    case 'RESUME_EPISODE': {
      return {
        ...state,
        state: 'playing',
      };
    }
    case 'SKIP_TO_NEXT_EPISODE': {
      return {
        ...state,
        state: 'buffering',
        currentTrackIndex: (state.currentTrackIndex + 1) % state.queue.length,
      };
    }
    case 'SKIP_TO_PREVIOUS_EPISODE': {
      return {
        ...state,
        state: 'buffering',
        currentTrackIndex:
          state.currentTrackIndex === 0
            ? state.queue.length - 1
            : (state.currentTrackIndex - 1) / state.queue.length,
      };
    }
    default:
      return state;
  }
}

const effects = (nextState: PlayerContextValue, action: PlayerActions) => {
  switch (action.type) {
    case 'RESUME_EPISODE': {
      AudioUtils.resume();
      break;
    }
    case 'SET_PLAYER_STATE': {
      switch (action.state) {
        case 'buffering':
          AudioUtils.play(action.episode);
          break;
        case 'paused':
          AudioUtils.pause();
          break;
        case 'idle':
          AudioUtils.stop();
          break;
      }
      break;
    }
    case 'SEEK_TO': {
      AudioUtils.seekTo(action.seconds);
      break;
    }
    case 'SEEK_BACKWARD':
    case 'SEEK_FORWARD': {
      const seekDirection = action.type === 'SEEK_BACKWARD' ? -1 : 1;
      AudioUtils.seekBy(seekDirection * SEEK_DELTA);
      break;
    }
    case 'SKIP_TO_NEXT_EPISODE':
    case 'SKIP_TO_PREVIOUS_EPISODE': {
      AudioUtils.pause();
      AudioUtils.play(nextState.queue[nextState.currentTrackIndex]);
      break;
    }
  }
};

const withEffects = <S extends unknown, A extends unknown>(
  reducer: (state: S, action: A) => S,
  effects: (nextState: S, action: A) => void,
) => {
  return (state: S, action: A) => {
    const nextState = reducer(state, action);
    effects(nextState, action);
    return nextState;
  };
};

export const playerReducer = withEffects(reducer, effects);

export const initialState: PlayerContextValue = {
  queue: [],
  currentTrackIndex: 0,
  state: 'idle',
};

/**
 * Default Seek jump delta
 */
export const SEEK_DELTA = 10;
