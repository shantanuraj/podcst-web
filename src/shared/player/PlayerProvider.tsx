import * as React from 'react';
import AudioUtils from './AudioUtils';
import { PlayerActionsContext, PlayerStateContext, setPlayerState } from './context';
import { initialState, playerReducer } from './store';

export const PlayerProvider: React.FC = ({ children }) => {
  const [value, dispatch] = React.useReducer(playerReducer, initialState);

  React.useEffect(() => {
    AudioUtils.init({
      stopEpisode: () => dispatch(setPlayerState('idle')),
      setPlaybackStarted: () => {
        dispatch(setPlayerState('playing'));
      },
      seekUpdate: () => {},
    });
  }, []);

  return (
    <PlayerActionsContext.Provider value={dispatch}>
      <PlayerStateContext.Provider value={value}>{children}</PlayerStateContext.Provider>
    </PlayerActionsContext.Provider>
  );
};
