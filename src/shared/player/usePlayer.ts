import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { AccountScope } from '@/shared/auth/account';
import { getValue, setValue } from '@/shared/storage/local';
import type { IEpisodeInfo, PlayerState } from '@/types';
import { speeds } from '../../../contracts/playback/rules.json';
import AudioUtils, { seekUtils } from './AudioUtils';
import { getAdaptedPlaybackState, isChromecastConnected } from './castUtils';
import { sameEpisode } from './episode-identity';
import { updatePlaybackHandlers, updatePlaybackMetadata } from './mediaUtils';
import { readSession, writeSession } from './persisted-session';
import { emitPlayer } from './player-events';
import * as Queue from './queue';

type Session = Queue.QueueSession<IEpisodeInfo>;

export interface IPlayerState {
  storageError?: string;
  accountScope: AccountScope | undefined;
  accountRevision: number;
  setAccount: (scope: AccountScope | undefined, revision: number) => void;

  queue: readonly IEpisodeInfo[];
  currentTrackIndex: number;
  seekPosition: number;
  duration: number;
  rate: number;
  savedRate: number | undefined;
  state: PlayerState;
  hasPlaybackActivity: boolean;

  playEpisode: (episode: IEpisodeInfo, seekPosition?: number) => void;
  enqueueEpisode: (episode: IEpisodeInfo, next: boolean) => void;
  restoreEpisode: (episode: IEpisodeInfo, seekPosition: number) => void;
  togglePlayback: () => void;
  resumeEpisode: () => void;
  pause: () => void;
  stop: () => void;
  markPlayed: () => void;
  onPlaybackEnd: () => void;
  skipToNextEpisode: () => void;
  skipToPreviousEpisode: () => void;
  removeUpNext: (offsets: readonly number[]) => void;
  moveUpNext: (from: number, to: number) => void;
  clearQueue: () => void;

  setPlayerState: (state: 'playing' | 'paused') => void;
  setSeekPosition: (position: number) => void;
  setDuration: (duration: number) => void;
  seekTo: (seconds: number) => void;
  seekBackward: () => void;
  seekForward: () => void;
  seekOrStartAt: (episode: IEpisodeInfo, seekPosition: number) => void;
  setVolume: (volume: number) => void;
  mute: (muted: boolean) => void;
  setRate: (rate: number) => void;
  setOverridenRate: (rate: number | undefined) => void;

  isAirplayEnabled: boolean;
  setIsAirplayEnabled: (isAirplayEnabled: boolean) => void;

  isChromecastEnabled: boolean;
  isChromecastConnecting: boolean;
  setIsChromecastEnabled: (isChromecastEnabled: boolean) => void;

  chromecastState: cast.framework.CastState | undefined;
  setChromecastState: (
    chromecastState: cast.framework.CastState | undefined,
  ) => void;

  playOnChromecast: () => void;

  remotePlayer: cast.framework.RemotePlayer | undefined;
  remotePlayerController: cast.framework.RemotePlayerController | undefined;

  syncSeekAndPause: () => void;
}

const sessionOf = (state: IPlayerState): Session => ({
  queue: state.queue,
  current: state.currentTrackIndex,
  active: state.state !== 'idle',
});

const supportedRate = (rate: unknown) =>
  speeds.supported.includes(rate as number) ? (rate as number) : speeds.default;

export const usePlayer = create<IPlayerState>()(
  subscribeWithSelector((set, get) => {
    const commit = (
      next: Session,
      options: {
        state?: PlayerState;
        completed?: boolean;
        position?: number;
        restoring?: boolean;
      } = {},
    ) => {
      const previous = get();
      const before = getCurrentEpisode(previous);
      const after = next.queue[next.current];
      const changed = !sameEpisode(before, after);
      const state = !next.active
        ? 'idle'
        : (options.state ??
          (previous.state === 'idle'
            ? 'buffering'
            : changed && previous.state !== 'paused'
              ? 'buffering'
              : previous.state));
      if (before && options.completed)
        emitPlayer('complete', {
          episode: before,
          position: previous.duration || before.duration || 0,
        });
      else if (before && changed && !options.restoring)
        emitPlayer('leave', {
          episode: before,
          position: previous.seekPosition,
        });
      set({
        queue: next.queue,
        currentTrackIndex: next.current,
        hasPlaybackActivity:
          previous.hasPlaybackActivity ||
          (!options.restoring &&
            (changed ||
              state !== previous.state ||
              (options.position !== undefined &&
                options.position !== previous.seekPosition) ||
              options.completed === true)),
        state,
        ...(changed ? { seekPosition: 0, duration: after?.duration || 0 } : {}),
        ...(options.position === undefined
          ? {}
          : { seekPosition: options.position }),
      });
    };

    return {
      accountScope: undefined,
      accountRevision: 0,
      setAccount: (accountScope, accountRevision) => {
        const state = get();
        if (
          state.accountScope === accountScope &&
          state.accountRevision === accountRevision
        )
          return;
        try {
          AudioUtils.stop();
        } catch {}
        try {
          state.remotePlayerController?.stop();
        } catch {}
        try {
          if (typeof window !== 'undefined' && 'cast' in window)
            cast.framework.CastContext.getInstance()
              .getCurrentSession()
              ?.endSession(true);
        } catch {}
        let saved: ReturnType<typeof readSession> = null;
        let storageError: string | undefined;
        try {
          saved = accountScope === undefined ? null : readSession(accountScope);
        } catch {
          storageError = 'Saved queue could not be opened. Source retained.';
        }
        const rate = state.savedRate ?? state.rate;
        AudioUtils.setRate(rate);
        set({
          accountScope,
          accountRevision,
          storageError: storageError ?? saved?.recoveryNotice,
          queue: saved?.queue ?? [],
          currentTrackIndex: saved?.current ?? 0,
          seekPosition: saved?.position ?? 0,
          duration: saved?.queue[saved.current].duration || 0,
          state: saved ? 'paused' : 'idle',
          hasPlaybackActivity: false,
          rate,
          savedRate: undefined,
          isAirplayEnabled: false,
          isChromecastConnecting: false,
          chromecastState: undefined,
          remotePlayer: undefined,
          remotePlayerController: undefined,
        });
      },

      queue: [],
      currentTrackIndex: 0,
      seekPosition: 0,
      duration: 0,
      rate: supportedRate(getValue('rate')),
      savedRate: undefined,
      state: 'idle',
      hasPlaybackActivity: false,
      isAirplayEnabled: false,
      isChromecastEnabled: false,
      isChromecastConnecting: false,
      chromecastState: undefined,
      remotePlayer: undefined,
      remotePlayerController: undefined,

      playEpisode: (episode, seekPosition = 0) => {
        commit(Queue.play(sessionOf(get()), episode, sameEpisode), {
          state: 'buffering',
          position: seekPosition,
        });
        emitPlayer('replay', { episode, position: seekPosition });
      },

      enqueueEpisode: (episode, next) =>
        commit(Queue.enqueue(sessionOf(get()), episode, next, sameEpisode)),

      restoreEpisode: (episode, seekPosition) =>
        commit(Queue.play(sessionOf(get()), episode, sameEpisode), {
          state: 'paused',
          position: seekPosition,
          restoring: true,
        }),

      togglePlayback: () => {
        const { state, queue, chromecastState } = get();
        if (state === 'playing' || state === 'buffering')
          return set({ state: 'paused', hasPlaybackActivity: true });
        if (!queue.length) return;
        if (state === 'idle')
          return commit(Queue.reopen(sessionOf(get())), {
            state: 'buffering',
          });
        set({
          hasPlaybackActivity: true,
          state:
            isChromecastConnected(chromecastState) || AudioUtils.loaded()
              ? 'playing'
              : 'buffering',
        });
      },

      resumeEpisode: () => {
        const { state, togglePlayback } = get();
        if (state !== 'playing' && state !== 'buffering') togglePlayback();
      },

      pause: () => {
        const { state } = get();
        if (state === 'playing' || state === 'buffering')
          set({ state: 'paused', hasPlaybackActivity: true });
      },

      stop: () => commit(Queue.stop(sessionOf(get()))),

      markPlayed: () => {
        if (get().state !== 'idle')
          commit(Queue.finish(sessionOf(get())), { completed: true });
      },

      onPlaybackEnd: () => get().markPlayed(),

      skipToNextEpisode: () => commit(Queue.step(sessionOf(get()), 1)),

      skipToPreviousEpisode: () => commit(Queue.step(sessionOf(get()), -1)),

      removeUpNext: (offsets) =>
        commit(Queue.removeUpNext(sessionOf(get()), offsets)),

      moveUpNext: (from, to) =>
        commit(Queue.moveUpNext(sessionOf(get()), from, to)),

      clearQueue: () => commit(Queue.emptySession),

      setPlayerState: (state) =>
        set({
          state,
          hasPlaybackActivity:
            get().hasPlaybackActivity || state !== get().state,
        }),

      setSeekPosition: (seekPosition) =>
        set({
          seekPosition,
          hasPlaybackActivity:
            get().hasPlaybackActivity || seekPosition !== get().seekPosition,
        }),

      setDuration: (duration) => set({ duration }),

      setIsAirplayEnabled: (isAirplayEnabled) => set({ isAirplayEnabled }),

      setIsChromecastEnabled: (isChromecastEnabled) =>
        set({ isChromecastEnabled }),

      setChromecastState: (chromecastState) => set({ chromecastState }),

      playOnChromecast: async () => {
        const { accountScope, accountRevision } = get();
        const current = () =>
          get().accountScope === accountScope &&
          get().accountRevision === accountRevision;
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
        if (!current()) {
          session.endSession(true);
          return;
        }

        const mediaInfo = new chrome.cast.media.MediaInfo(
          currentEpisode.file.url,
          currentEpisode.file.type,
        );
        const metadata = new chrome.cast.media.GenericMediaMetadata();
        metadata.title = currentEpisode.title;
        metadata.subtitle =
          currentEpisode.podcastTitle && currentEpisode.author
            ? `${currentEpisode.podcastTitle} – ${currentEpisode.author}`
            : currentEpisode.podcastTitle || currentEpisode.author || '';
        if (currentEpisode.published) {
          metadata.releaseDate = new Date(
            currentEpisode.published,
          ).toISOString();
        }
        metadata.images = [
          new chrome.cast.Image(
            currentEpisode.episodeArt || currentEpisode.cover,
          ),
        ];
        mediaInfo.metadata = metadata;
        const request = new chrome.cast.media.LoadRequest(mediaInfo);
        request.currentTime = getSeekPosition(get()) || 0;
        request.playbackRate = getRate(get());
        try {
          set({ isChromecastConnecting: true });
          await session.loadMedia(request);
          if (!current()) {
            session.endSession(true);
            return;
          }
          const remotePlayer = new cast.framework.RemotePlayer();
          const remotePlayerController =
            new cast.framework.RemotePlayerController(remotePlayer);

          AudioUtils.stop();

          set({
            remotePlayer,
            remotePlayerController,
            state: getAdaptedPlaybackState(remotePlayer.playerState),
          });
        } catch (err) {
          console.error('Error loading media', err);
        } finally {
          if (current()) set({ isChromecastConnecting: false });
        }
      },

      syncSeekAndPause: () => {
        set({ state: 'paused' });
        const currentEpisode = getCurrentEpisode(get());
        if (currentEpisode)
          AudioUtils.loadAtSeek(currentEpisode, getSeekPosition(get()));
      },

      seekBackward: () => {
        const { duration, seekPosition, seekTo } = get();
        seekTo(seekUtils.seekBackward(seekPosition, duration));
      },

      seekForward: () => {
        const { duration, seekPosition, seekTo } = get();
        seekTo(seekUtils.seekForward(seekPosition, duration));
      },

      seekTo: (seconds) => {
        const { chromecastState, setSeekPosition } = get();
        if (!isChromecastConnected(chromecastState)) {
          if (!AudioUtils.loaded()) return setSeekPosition(seconds);
          return AudioUtils.seekTo(seconds);
        }

        const seekRequest = new chrome.cast.media.SeekRequest();
        seekRequest.currentTime = seconds;

        const context = cast.framework.CastContext.getInstance();
        const session = context.getCurrentSession();
        session
          ?.getMediaSession()
          ?.seek(seekRequest, seekUtils.onSeekSuccess, seekUtils.onSeekError);
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
        if (!speeds.supported.includes(rate)) return;
        const { chromecastState, savedRate } = get();
        if (savedRate === undefined) setValue('rate', rate);
        if (!isChromecastConnected(chromecastState)) {
          AudioUtils.setRate(rate);
          set({ rate });
          return;
        }

        const context = cast.framework.CastContext.getInstance();
        const session = context.getCurrentSession();
        const mediaSession = session?.getMediaSession();

        session
          ?.sendMessage('urn:x-cast:com.google.cast.media', {
            type: 'SET_PLAYBACK_RATE',
            playbackRate: rate,
            requestId: Date.now(),
            mediaSessionId: mediaSession?.mediaSessionId,
          })
          .then(() => set({ rate }))
          .catch((error) => console.error('Error setting rate', error));
      },

      setOverridenRate: (rateOrStop) => {
        const { savedRate, rate, setRate } = get();
        if (rateOrStop === undefined) {
          if (savedRate === undefined) return;
          set({ savedRate: undefined });
          return setRate(savedRate);
        }
        if (savedRate === undefined) set({ savedRate: rate });
        setRate(rateOrStop);
      },

      seekOrStartAt(episode, seekPosition) {
        const playerState = get();
        if (
          sameEpisode(getCurrentEpisode(playerState), episode) &&
          playerState.state !== 'idle'
        )
          return playerState.seekTo(seekPosition);
        return playerState.playEpisode(episode, seekPosition);
      },
    };
  }),
);

AudioUtils.init(
  {
    stopEpisode: () => usePlayer.getState().onPlaybackEnd(),
    setPlaybackStarted: () => {
      if (usePlayer.getState().state === 'buffering')
        usePlayer.getState().setPlayerState('playing');
    },
    seekUpdate: (seconds) => usePlayer.getState().setSeekPosition(seconds),
    duration: (seconds) => usePlayer.getState().setDuration(seconds),
    setIsAirplayEnabled: (enabled) =>
      usePlayer.getState().setIsAirplayEnabled(enabled),
  },
  usePlayer.getState().rate,
);

const PERSISTED_SECONDS = 5;

usePlayer.subscribe((currentState, previousState) => {
  if (
    currentState.accountScope !== undefined &&
    (currentState.accountScope !== previousState.accountScope ||
      currentState.queue !== previousState.queue ||
      currentState.currentTrackIndex !== previousState.currentTrackIndex ||
      currentState.state !== previousState.state ||
      Math.floor(currentState.seekPosition / PERSISTED_SECONDS) !==
        Math.floor(previousState.seekPosition / PERSISTED_SECONDS))
  ) {
    try {
      writeSession({
        scope: currentState.accountScope,
        queue: currentState.queue,
        current: currentState.currentTrackIndex,
        position: currentState.seekPosition,
      });
    } catch {
      usePlayer.setState({
        storageError: 'Queue changes could not be saved. Source retained.',
      });
    }
  }

  if (
    currentState.accountScope !== previousState.accountScope ||
    currentState.accountRevision !== previousState.accountRevision
  ) {
    const ready = currentState.accountScope !== undefined;
    updatePlaybackMetadata(ready ? getCurrentEpisode(currentState) : undefined);
    updatePlaybackHandlers(ready ? currentState : undefined);
    return;
  }
  const currentEpisode = getCurrentEpisode(currentState);
  const previousEpisode = getCurrentEpisode(previousState);
  const changed = !sameEpisode(currentEpisode, previousEpisode);

  if (isChromecastConnected(currentState.chromecastState)) {
    const remoteState = currentState.remotePlayer?.playerState
      ? getAdaptedPlaybackState(currentState.remotePlayer.playerState)
      : null;
    if (
      remoteState &&
      remoteState !== 'buffering' &&
      remoteState !== currentState.state
    )
      currentState.remotePlayerController?.playOrPause();
    if (
      currentEpisode &&
      currentState.state !== 'idle' &&
      ((changed &&
        previousEpisode &&
        (previousState.state === 'playing' ||
          previousState.state === 'paused')) ||
        (currentState.state === 'buffering' &&
          (!previousEpisode || previousState.state === 'idle')))
    )
      currentState.playOnChromecast();
  } else if (changed || currentState.state !== previousState.state) {
    switch (currentState.state) {
      case 'buffering':
        if (currentEpisode)
          AudioUtils.play(currentEpisode, true, currentState.seekPosition);
        break;
      case 'paused':
        if (changed) AudioUtils.stop();
        else AudioUtils.pause();
        break;
      case 'playing':
        if (previousState.state === 'paused') AudioUtils.resume();
        break;
      case 'idle':
        AudioUtils.stop();
        break;
    }
  }

  if (changed) updatePlaybackMetadata(currentEpisode);
});

export const getPlaybackState = (state: IPlayerState) => state.state;
export const getSetPlayerState = (state: IPlayerState) => state.setPlayerState;
export const getCurrentEpisode = (
  state: IPlayerState,
): IEpisodeInfo | undefined => state.queue[state.currentTrackIndex];
export const getIsPlayerOpen = (state: IPlayerState) =>
  getCurrentEpisode(state) !== undefined;
export const getSeekPosition = (state: IPlayerState) => state.seekPosition;
export const getSetSeekPosition = (state: IPlayerState) =>
  state.setSeekPosition;
export const getSeekBackward = (state: IPlayerState) => state.seekBackward;
export const getSeekForward = (state: IPlayerState) => state.seekForward;
export const getSeekTo = (state: IPlayerState) => state.seekTo;
export const getSetVolume = (state: IPlayerState) => state.setVolume;
export const getRate = (state: IPlayerState) => state.rate;
export const getSetRate = (state: IPlayerState) => state.setRate;
export const getSetDuration = (state: IPlayerState) => state.setDuration;
export const getMute = (state: IPlayerState) => state.mute;
export const getIsAirplayEnabled = (state: IPlayerState) =>
  state.isAirplayEnabled;
export const getIsChromecastEnabled = (state: IPlayerState) =>
  state.isChromecastEnabled;
export const getSetIsChromecastEnabled = (state: IPlayerState) =>
  state.setIsChromecastEnabled;
export const getChromecastState = (state: IPlayerState) =>
  state.chromecastState;
export const getSetChromecastState = (state: IPlayerState) =>
  state.setChromecastState;
export const getPlayOnChromecast = (state: IPlayerState) =>
  state.playOnChromecast;
export const getRemotePlayer = (state: IPlayerState) => state.remotePlayer;
export const getRemotePlayerController = (state: IPlayerState) =>
  state.remotePlayerController;
export const getIsChromecastConnected = (state: IPlayerState) =>
  isChromecastConnected(state.chromecastState);
export const getSyncSeekAndPause = (state: IPlayerState) =>
  state.syncSeekAndPause;
export const getEnqueueEpisode = (state: IPlayerState) => state.enqueueEpisode;
export const getEpisodesQueue = (state: IPlayerState) => state.queue;
export const getSeekOrStartAt = (state: IPlayerState) => state.seekOrStartAt;
