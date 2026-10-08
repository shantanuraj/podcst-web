import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { invalidateProgress } from '@/data/progress';
import { stateRuntime } from '@/data/state-browser';
import { useAccountSession } from '@/shared/auth/AccountBoundary';
import { progress } from '../../../contracts/playback/rules.json';
import { sameEpisode } from './episode-identity';
import { playbackQueryOptions, restoreAccountProgress } from './playback-state';
import { type EpisodePosition, onPlayer } from './player-events';
import {
  getCurrentEpisode,
  getPlaybackState,
  type IPlayerState,
  isClipping,
  usePlayer,
} from './usePlayer';

const SYNC_INTERVAL_MS = progress.periodicPlayingSeconds * 1000;
const SEEK_JUMP_SECONDS = 2;

export function usePlaybackSync() {
  const session = useAccountSession();
  const token = session.token();
  const restoredRef = useRef<number | null>(null);
  const lastSavedRef = useRef<{
    revision: number;
    episodeId: string;
    position: number;
    completed: boolean;
  } | null>(null);
  const saved = useQuery(playbackQueryOptions(session));

  useEffect(() => {
    if (
      !session.current(token) ||
      !saved.isSuccess ||
      restoredRef.current === token.revision
    )
      return;
    restoredRef.current = token.revision;
    if (saved.data) restoreAccountProgress(session, token, saved.data);
  }, [session, token, saved.data, saved.isSuccess]);

  const owns = useCallback(
    (state: IPlayerState) =>
      session.current(token) &&
      state.accountScope === token.scope &&
      state.accountRevision === token.revision,
    [session, token],
  );

  const save = useCallback(
    async ({ episode, position }: EpisodePosition, completed: boolean) => {
      const episodeId = episode.id;
      const state = usePlayer.getState();
      if (
        !episodeId ||
        !owns(state) ||
        isClipping(state, episode) ||
        (!state.hasPlaybackActivity && !completed)
      )
        return;
      position = Math.floor(position);

      const last = lastSavedRef.current;
      if (
        last?.revision === token.revision &&
        last.episodeId === episodeId &&
        last.position === position &&
        last.completed === completed
      )
        return;
      await stateRuntime(session).sync.progress(
        episodeId,
        completed ? 'ended' : 'checkpoint',
        position,
      );
      if (session.current(token)) {
        lastSavedRef.current = {
          revision: token.revision,
          episodeId,
          position,
          completed,
        };
        invalidateProgress(session);
      }
    },
    [session, token, owns],
  );

  const saveCurrent = useCallback(() => {
    const state = usePlayer.getState();
    const episode = getCurrentEpisode(state);
    if (episode)
      void save({ episode, position: state.seekPosition }, false).catch(
        () => {},
      );
  }, [save]);

  useEffect(() => {
    if (!session.current(token)) return;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const startInterval = () => {
      intervalId ??= setInterval(saveCurrent, SYNC_INTERVAL_MS);
    };
    const stopInterval = () => {
      if (intervalId) clearInterval(intervalId);
      intervalId = null;
    };
    if (getPlaybackState(usePlayer.getState()) === 'playing') startInterval();
    const unsubscribe = usePlayer.subscribe(
      (state) => ({
        playbackState: getPlaybackState(state),
        episode: getCurrentEpisode(state),
      }),
      ({ playbackState, episode }, previous) => {
        if (!owns(usePlayer.getState())) return;
        if (playbackState === 'playing') startInterval();
        else stopInterval();
        if (
          (playbackState === 'paused' || playbackState === 'idle') &&
          (previous.playbackState === 'playing' ||
            previous.playbackState === 'buffering') &&
          sameEpisode(episode, previous.episode)
        )
          saveCurrent();
      },
      {
        equalityFn: (a, b) =>
          a.playbackState === b.playbackState &&
          sameEpisode(a.episode, b.episode),
      },
    );
    const offLeave = onPlayer(
      'leave',
      (value) => void save(value, false).catch(() => {}),
    );
    const offReplay = onPlayer('replay', ({ episode, position }) => {
      if (episode.id && owns(usePlayer.getState()))
        void stateRuntime(session)
          .sync.progress(episode.id, 'replay', Math.floor(position))
          .catch(() => {});
    });
    const offComplete = onPlayer(
      'complete',
      (value) => void save(value, true).catch(() => {}),
    );
    const seeked = usePlayer.subscribe(
      (state) => ({
        episode: getCurrentEpisode(state),
        position: state.seekPosition,
      }),
      ({ episode, position }, previous) => {
        if (
          sameEpisode(episode, previous.episode) &&
          usePlayer.getState().state !== 'idle' &&
          Math.abs(position - previous.position) > SEEK_JUMP_SECONDS
        )
          saveCurrent();
      },
      {
        equalityFn: (a, b) =>
          a.position === b.position && sameEpisode(a.episode, b.episode),
      },
    );
    return () => {
      unsubscribe();
      offLeave();
      offComplete();
      offReplay();
      seeked();
      stopInterval();
    };
  }, [session, token, owns, save, saveCurrent]);

  useEffect(
    () =>
      session.registerCheckpoint(async () => {
        const state = usePlayer.getState();
        const episode = getCurrentEpisode(state);
        if (episode && owns(state))
          await save({ episode, position: state.seekPosition }, false);
      }),
    [session, owns, save],
  );

  useEffect(() => {
    if (token.scope === null) return;
    const leave = () => {
      const state = usePlayer.getState();
      const episode = getCurrentEpisode(state);
      if (!episode?.id || !owns(state) || state.state === 'idle') return;
      void save({ episode, position: state.seekPosition }, false).catch(
        () => {},
      );
    };
    window.addEventListener('pagehide', leave);
    return () => window.removeEventListener('pagehide', leave);
  }, [token, owns, save]);
}
