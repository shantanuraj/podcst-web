import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { responseData } from '@/data/api';
import { useAccountSession } from '@/shared/auth/AccountBoundary';
import type { IEpisodeInfo } from '@/types';
import { completion, progress } from '../../../contracts/playback/rules.json';
import { sameEpisode } from './episode-identity';
import { playbackQueryOptions, restoreAccountProgress } from './playback-state';
import { type EpisodePosition, onPlayer } from './player-events';
import {
  getCurrentEpisode,
  getPlaybackState,
  type IPlayerState,
  usePlayer,
} from './usePlayer';

const SYNC_INTERVAL_MS = progress.periodicPlayingSeconds * 1000;
const SEEK_JUMP_SECONDS = 2;

const completedAt = (episode: IEpisodeInfo, position: number) => {
  const duration =
    sameEpisode(getCurrentEpisode(usePlayer.getState()), episode) &&
    usePlayer.getState().duration
      ? usePlayer.getState().duration
      : episode.duration || 0;
  return (
    duration > 0 &&
    position / duration >=
      completion.parity.savedPositionFractionOfKnownDuration
  );
};

const request = (
  episodeId: number,
  position: number,
  completed: boolean,
  init: RequestInit,
) =>
  fetch('/api/progress', {
    ...init,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ episodeId, position, completed }),
  });

export function usePlaybackSync() {
  const session = useAccountSession();
  const token = session.token();
  const restoredRef = useRef<number | null>(null);
  const lastSavedRef = useRef<{
    revision: number;
    episodeId: number;
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
      token.scope !== null &&
      session.current(token) &&
      state.accountScope === token.scope &&
      state.accountRevision === token.revision,
    [session, token],
  );

  const save = useCallback(
    async (
      { episode, position }: EpisodePosition,
      completed: boolean,
      keepalive = false,
    ) => {
      const episodeId = episode.id;
      const state = usePlayer.getState();
      if (
        !episodeId ||
        !owns(state) ||
        (!state.hasPlaybackActivity && !completed)
      )
        return;
      position = Math.floor(position);
      completed ||= completedAt(episode, position);
      const last = lastSavedRef.current;
      if (
        last?.revision === token.revision &&
        last.episodeId === episodeId &&
        last.position === position &&
        last.completed === completed
      )
        return;
      try {
        await session.run(token, 'playback', async (signal) =>
          responseData(
            await request(episodeId, position, completed, {
              signal,
              keepalive,
            }),
          ),
        );
        if (session.current(token))
          lastSavedRef.current = {
            revision: token.revision,
            episodeId,
            position,
            completed,
          };
      } catch {}
    },
    [session, token, owns],
  );

  const saveCurrent = useCallback(() => {
    const state = usePlayer.getState();
    const episode = getCurrentEpisode(state);
    if (episode) void save({ episode, position: state.seekPosition }, false);
  }, [save]);

  useEffect(() => {
    if (token.scope === null || !session.current(token)) return;
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
    const offLeave = onPlayer('leave', (value) => void save(value, false));
    const offComplete = onPlayer('complete', (value) => void save(value, true));
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
      seeked();
      stopInterval();
    };
  }, [session, token, owns, save, saveCurrent]);

  useEffect(() => {
    if (token.scope === null) return;
    const leave = () => {
      const state = usePlayer.getState();
      const episode = getCurrentEpisode(state);
      if (!episode?.id || !owns(state) || state.state === 'idle') return;
      void save({ episode, position: state.seekPosition }, false, true);
    };
    window.addEventListener('pagehide', leave);
    return () => window.removeEventListener('pagehide', leave);
  }, [token, owns, save]);
}
