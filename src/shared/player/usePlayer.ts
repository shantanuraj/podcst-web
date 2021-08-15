import create from 'zustand';

import { IEpisodeInfo, PlayerState } from '../../types';
import AudioUtils from './AudioUtils';
import { updatePlaybackHandlers, updatePlaybackMetadata } from './mediaUtils';

export interface IPlayerState {
  audioInitialised: boolean;
  queue: IEpisodeInfo[];
  currentTrackIndex: number;
  state: PlayerState;
  queueEpisode: (episode: IEpisodeInfo) => void;
  playEpisode: (episode: IEpisodeInfo) => void;
  resumeEpisode: () => void;
  togglePlayback: () => void;
  skipToNextEpisode: () => void;
  skipToPreviousEpisode: () => void;
  setPlayerState: (state: 'playing' | 'paused' | 'idle') => void;
}

export const usePlayer = create<IPlayerState>((set) => ({
  audioInitialised: false,
  queue: [] as IEpisodeInfo[],
  currentTrackIndex: 0,
  state: 'idle',

  queueEpisode: (episode) => set((prevState) => ({ queue: prevState.queue.concat(episode) })),

  playEpisode: (episode) =>
    set((prevState) => {
      let queue = prevState.queue;
      let trackIndex = queue.findIndex((queuedEpisode) => queuedEpisode.guid === episode.guid);
      // Queue episode if not in the queue
      if (trackIndex === -1) {
        trackIndex = queue.length;
        queue = queue.concat(episode);
      }

      return {
        audioInitialised: true,
        queue,
        state: 'buffering',
        currentTrackIndex: trackIndex,
      };
    }),

  setPlayerState: (state) =>
    set((prevState) => ({
      state,
      queue:
        state === 'idle' ? prevState.queue.splice(prevState.currentTrackIndex, 1) : prevState.queue,
    })),

  resumeEpisode: () => {
    set({ state: 'playing' });
  },

  togglePlayback: () => {
    set((prevState) => ({ state: prevState.state === 'playing' ? 'paused' : 'playing' }));
  },

  skipToNextEpisode: () =>
    set((prevState) => ({
      state: 'buffering',
      currentTrackIndex: (prevState.currentTrackIndex + 1) % prevState.queue.length,
    })),

  skipToPreviousEpisode: () =>
    set((prevState) => ({
      state: 'buffering',
      currentTrackIndex:
        prevState.currentTrackIndex === 0
          ? prevState.queue.length - 1
          : (prevState.currentTrackIndex - 1) / prevState.queue.length,
    })),
}));

usePlayer.subscribe((currentState, previousState) => {
  const currentEpisode = currentState.queue[currentState.currentTrackIndex];
  const previousEpisode = previousState.queue[previousState.currentTrackIndex];

  const applyStateEffects = currentState.state !== previousState.state;
  if (applyStateEffects) {
    switch (currentState.state) {
      case 'buffering':
        if (!previousState.audioInitialised) {
          AudioUtils.init({
            stopEpisode: () => currentState.setPlayerState('idle'),
            setPlaybackStarted: () => currentState.setPlayerState('playing'),
          });
          updatePlaybackHandlers(currentState);
        }
        if (currentEpisode) AudioUtils.play(currentEpisode);
        break;
      case 'paused':
        AudioUtils.pause();
        break;
      case 'playing':
        if (previousState.state === 'paused') AudioUtils.resume();
        break;
      case 'idle':
        AudioUtils.stop();
        break;
    }
  }

  const applyMetadatEffect = currentEpisode !== previousEpisode;
  if (applyMetadatEffect) {
    updatePlaybackMetadata(currentEpisode, null);
  }
});

export const getPlaybackState = (state: IPlayerState) => state.state;
export const getCurrentEpisode = (state: IPlayerState): IEpisodeInfo | undefined =>
  state.queue[state.currentTrackIndex];
export const getIsPlayerOpen = (state: IPlayerState) =>
  getCurrentEpisode(state) !== undefined && state.state !== 'idle';
