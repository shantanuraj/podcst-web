import create from 'zustand';

import { IEpisodeInfo, IPlaybackControls, PlayerState } from '../../types';
import AudioUtils from './AudioUtils';
import { updatePlaybackHandlers, updatePlaybackMetadata } from './mediaUtils';

export interface IPlayerState extends IPlaybackControls {
  audioInitialised: boolean;
  queue: IEpisodeInfo[];
  currentTrackIndex: number;
  duration: number;
  state: PlayerState;
  setDuration: (duration: number) => void;
  queueEpisode: (episode: IEpisodeInfo) => void;
  skipToNextEpisode: () => void;
  skipToPreviousEpisode: () => void;
}

export const usePlayer = create<IPlayerState>((set) => ({
  audioInitialised: false,
  queue: [] as IEpisodeInfo[],
  currentTrackIndex: 0,
  seekPosition: 0,
  duration: 0,
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
      seekPosition: state === 'idle' ? 0 : prevState.seekPosition,
    })),

  resumeEpisode: () => {
    set({ state: 'playing' });
  },

  togglePlayback: () => {
    set((prevState) => ({ state: prevState.state === 'playing' ? 'paused' : 'playing' }));
  },

  setSeekPosition: (seekPosition) => {
    set({ seekPosition });
  },

  setDuration: (duration) => {
    set({ duration });
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

  // Effects only
  seekBackward: AudioUtils.seekBackward,

  seekForward: AudioUtils.seekForward,

  seekTo: AudioUtils.seekTo,

  setVolume: AudioUtils.setVolume,

  setRate: AudioUtils.setRate,

  mute: AudioUtils.mute,
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
            seekUpdate: currentState.setSeekPosition,
            duration: currentState.setDuration,
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
export const getSeekPosition = (state: IPlayerState) => state.seekPosition;
export const getSeekBackward = (state: IPlayerState) => state.seekBackward;
export const getSeekForward = (state: IPlayerState) => state.seekForward;
export const getSeekTo = (state: IPlayerState) => state.seekTo;
export const getSetVolume = (state: IPlayerState) => state.setVolume;
export const getSetRate = (state: IPlayerState) => state.setRate;
export const getMute = (state: IPlayerState) => state.mute;
