import create from 'zustand';

import { IEpisodeInfo, IPlaybackControls, PlayerState } from '../../types';
import AudioUtils, { seekUtils } from './AudioUtils';
import { getAdaptedPlaybackState, isChromecastConnected } from './castUtils';
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

  isAirplayEnabled: boolean;
  setIsAirplayEnabled: (isAirplayEnabled: boolean) => void;

  isChromecastEnabled: boolean;
  setIsChromecastEnabled: (isChromecastEnabled: boolean) => void;

  chromecastState: cast.framework.CastState | undefined;
  setChromecastState: (chromecastState: cast.framework.CastState | undefined) => void;

  playOnChromecast: () => void;

  remotePlayer: cast.framework.RemotePlayer | undefined;
  remotePlayerController: cast.framework.RemotePlayerController | undefined;

  syncSeekAndPause: () => void;
}

export const usePlayer = create<IPlayerState>((set, get) => ({
  audioInitialised: false,
  queue: [] as IEpisodeInfo[],
  currentTrackIndex: 0,
  seekPosition: 0,
  duration: 0,
  state: 'idle',
  isAirplayEnabled: false,
  isChromecastEnabled: false,
  chromecastState: undefined,
  remotePlayer: undefined,
  remotePlayerController: undefined,

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
        seekPosition: 0,
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

  setSeekPosition: (seekPosition) => {
    set({ seekPosition });
  },

  setDuration: (duration) => {
    set({ duration });
  },

  setIsAirplayEnabled: (isAirplayEnabled) => {
    set({ isAirplayEnabled });
  },

  setIsChromecastEnabled: (isChromecastEnabled) => {
    set({ isChromecastEnabled });
  },

  setChromecastState: (chromecastState) => {
    set({ chromecastState });
  },

  playOnChromecast: async () => {
    const currentEpisode = getCurrentEpisode(get());
    if (!('cast' in window) || !currentEpisode) return;

    const context = cast.framework.CastContext.getInstance();
    let session = context.getCurrentSession();
    if (!session) {
      try {
        await context.requestSession();
        session = context.getCurrentSession();
      } catch (err) {
        console.error('Error requesting session', err);
      }
    }
    if (!session) return;

    const mediaInfo = new chrome.cast.media.MediaInfo(
      currentEpisode.file.url,
      currentEpisode.file.type,
    );
    const metadata = new chrome.cast.media.MusicTrackMediaMetadata();
    metadata.artist = currentEpisode.author || '';
    metadata.songName = currentEpisode.title;
    metadata.title = currentEpisode.title;
    if (currentEpisode.published) {
      metadata.releaseDate = new Date(currentEpisode.published).toISOString();
    }
    metadata.images = [new chrome.cast.Image(currentEpisode.episodeArt || currentEpisode.cover)];
    mediaInfo.metadata = metadata;
    const request = new chrome.cast.media.LoadRequest(mediaInfo);
    request.currentTime = getSeekPosition(get()) || 0;
    // @ts-expect-error Missing type definiton in upstream
    // Source {@link https://developers.google.com/cast/docs/reference/web_sender/chrome.cast.media.LoadRequest#playbackRate}
    request.playbackRate = 1;
    try {
      await session.loadMedia(request);
      const remotePlayer = new cast.framework.RemotePlayer();
      const remotePlayerController = new cast.framework.RemotePlayerController(remotePlayer);

      // Unload native audio element
      AudioUtils.stop();

      // Update player state using Chromecast
      set({
        remotePlayer,
        remotePlayerController,
        state: getAdaptedPlaybackState(remotePlayer.playerState),
      });
    } catch (err) {
      console.error('Error loading media', err);
    }
  },

  syncSeekAndPause: () => {
    set({
      state: 'paused',
    });
    // Sync local audio seek to Chromecast
    const currentEpisode = getCurrentEpisode(get());
    const seekPosition = getSeekPosition(get());
    if (currentEpisode) AudioUtils.loadAtSeek(currentEpisode, seekPosition);
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

  seekBackward: () => {
    const { duration, seekPosition, seekTo } = get();
    const newSeekPosition = seekUtils.seekBackward(seekPosition, duration);
    seekTo(newSeekPosition);
  },

  seekForward: () => {
    const { duration, seekPosition, seekTo } = get();
    const newSeekPosition = seekUtils.seekForward(seekPosition, duration);
    seekTo(newSeekPosition);
  },

  seekTo: (seconds) => {
    const { chromecastState } = get();
    if (!isChromecastConnected(chromecastState)) {
      return AudioUtils.seekTo(seconds);
    }

    const seekRequest = new chrome.cast.media.SeekRequest();
    seekRequest.currentTime = seconds;

    const context = cast.framework.CastContext.getInstance();
    const session = context.getCurrentSession();
    session?.getMediaSession()?.seek(seekRequest, seekUtils.onSeekSuccess, seekUtils.onSeekError);
  },

  setVolume: (volume) => {
    const { chromecastState } = get();
    if (!isChromecastConnected(chromecastState)) {
      return AudioUtils.setVolume(volume);
    }

    const context = cast.framework.CastContext.getInstance();
    const session = context.getCurrentSession();
    session?.setVolume(volume);
  },

  mute: (muted) => {
    const { chromecastState } = get();
    if (!isChromecastConnected(chromecastState)) {
      return AudioUtils.mute(muted);
    }

    const context = cast.framework.CastContext.getInstance();
    const session = context.getCurrentSession();
    session?.setMute(muted);
  },

  setRate: (rate) => {
    const { chromecastState } = get();
    if (!isChromecastConnected(chromecastState)) {
      return AudioUtils.setRate(rate);
    }

    const context = cast.framework.CastContext.getInstance();
    const session = context.getCurrentSession();
    const mediaSession = session?.getMediaSession();

    /**
     * Source
     * {@link https://github.com/jellyfin-archive/cordova-plugin-chromecast/issues/64}
     * {@link https://developers.google.com/cast/docs/reference/web_receiver/cast.framework.messages.SetPlaybackRateRequestData}
     */
    session
      ?.sendMessage('urn:x-cast:com.google.cast.media', {
        type: 'SET_PLAYBACK_RATE',
        playbackRate: rate,
        requestId: Date.now(),
        mediaSessionId: mediaSession?.mediaSessionId,
      })
      .catch((error) => console.error('Error setting rate', error));
  },
}));

usePlayer.subscribe((currentState, previousState) => {
  const currentEpisode = currentState.queue[currentState.currentTrackIndex];
  const previousEpisode = previousState.queue[previousState.currentTrackIndex];

  const applyStateAudioEffects =
    currentState.state !== previousState.state &&
    !isChromecastConnected(currentState.chromecastState);

  if (isChromecastConnected(currentState.chromecastState)) {
    const remoteState = currentState.remotePlayer?.playerState
      ? getAdaptedPlaybackState(currentState.remotePlayer.playerState)
      : null;
    const applyStateCastEffects =
      remoteState && remoteState !== 'buffering' && remoteState !== currentState.state;
    if (applyStateCastEffects) {
      currentState.remotePlayerController?.playOrPause();
    }
    if (
      currentEpisode &&
      previousEpisode &&
      currentEpisode.guid !== previousEpisode.guid &&
      (previousState.state === 'playing' || previousState.state === 'paused')
    ) {
      currentState.playOnChromecast();
    }
  } else if (applyStateAudioEffects) {
    switch (currentState.state) {
      case 'buffering':
        if (!previousState.audioInitialised) {
          AudioUtils.init({
            stopEpisode: () => currentState.setPlayerState('idle'),
            setPlaybackStarted: () => currentState.setPlayerState('playing'),
            seekUpdate: currentState.setSeekPosition,
            duration: currentState.setDuration,
            setIsAirplayEnabled: currentState.setIsAirplayEnabled,
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
export const getSetPlayerState = (state: IPlayerState) => state.setPlayerState;
export const getCurrentEpisode = (state: IPlayerState): IEpisodeInfo | undefined =>
  state.queue[state.currentTrackIndex];
export const getIsPlayerOpen = (state: IPlayerState) =>
  getCurrentEpisode(state) !== undefined && state.state !== 'idle';
export const getSeekPosition = (state: IPlayerState) => state.seekPosition;
export const getSetSeekPosition = (state: IPlayerState) => state.setSeekPosition;
export const getSeekBackward = (state: IPlayerState) => state.seekBackward;
export const getSeekForward = (state: IPlayerState) => state.seekForward;
export const getSeekTo = (state: IPlayerState) => state.seekTo;
export const getSetVolume = (state: IPlayerState) => state.setVolume;
export const getSetRate = (state: IPlayerState) => state.setRate;
export const getSetDuration = (state: IPlayerState) => state.setDuration;
export const getMute = (state: IPlayerState) => state.mute;
export const getIsAirplayEnabled = (state: IPlayerState) => state.isAirplayEnabled;
export const getIsChromecastEnabled = (state: IPlayerState) => state.isChromecastEnabled;
export const getSetIsChromecastEnabled = (state: IPlayerState) => state.setIsChromecastEnabled;
export const getChromecastState = (state: IPlayerState) => state.chromecastState;
export const getSetChromecastState = (state: IPlayerState) => state.setChromecastState;
export const getPlayOnChromecast = (state: IPlayerState) => state.playOnChromecast;
export const getRemotePlayer = (state: IPlayerState) => state.remotePlayer;
export const getRemotePlayerController = (state: IPlayerState) => state.remotePlayerController;
export const getIsChromecastConnected = (state: IPlayerState) =>
  isChromecastConnected(state.chromecastState);
export const getSyncSeekAndPause = (state: IPlayerState) => state.syncSeekAndPause;
