import * as React from 'react';
import { IEpisodeInfo } from '../../types';
import AudioUtils from './AudioUtils';
import { PlayerActionsContext, PlayerStateContext, setPlayerState } from './context';
import { updateMetadata } from './mediaUtils';
import { initialState, playerReducer } from './store';

export const PlayerProvider: React.FC = ({ children }) => {
  const [value, dispatch] = React.useReducer(playerReducer, initialState);
  const currentEpisodeRef = React.useRef<IEpisodeInfo | null>(null);

  React.useEffect(() => {
    AudioUtils.init({
      stopEpisode: () => dispatch(setPlayerState('idle')),
      setPlaybackStarted: () => {
        dispatch(setPlayerState('playing'));
      },
    });
  }, []);

  React.useEffect(() => {
    const currentEpisode: IEpisodeInfo | undefined = value.queue[value.currentTrackIndex];
    if (!currentEpisode) return;
    if (currentEpisode.guid === currentEpisodeRef.current?.guid) {
      return;
    }

    updateMetadata(currentEpisode, null, dispatch);

    currentEpisodeRef.current = currentEpisode;
  }, [value.queue, value.currentTrackIndex]);

  return (
    <PlayerActionsContext.Provider value={dispatch}>
      <PlayerStateContext.Provider value={value}>{children}</PlayerStateContext.Provider>
    </PlayerActionsContext.Provider>
  );
};
