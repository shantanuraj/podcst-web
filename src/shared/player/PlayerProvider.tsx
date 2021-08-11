import * as React from 'react';
import { PlayerActionsContext, PlayerStateContext } from './context';
import { initialState, playerReducer } from './store';

export const PlayerProvider: React.FC = ({ children }) => {
  const [value, dispatch] = React.useReducer(playerReducer, initialState);
  return (
    <PlayerActionsContext.Provider value={dispatch}>
      <PlayerStateContext.Provider value={value}>{children}</PlayerStateContext.Provider>
    </PlayerActionsContext.Provider>
  );
};
