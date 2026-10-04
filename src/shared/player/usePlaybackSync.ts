import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { responseData } from '@/data/api';
import { useAccountSession } from '@/shared/auth/AccountBoundary';
import { playbackQueryOptions, restoreAccountProgress } from './playback-state';
import {
  getCurrentEpisode,
  getPlaybackState,
  getSeekPosition,
  usePlayer,
} from './usePlayer';

const SYNC_INTERVAL_MS = 30_000;
const COMPLETION_THRESHOLD = 0.95;

export function usePlaybackSync() {
  const session = useAccountSession();
  const token = session.token();
  const restoredRef = useRef<number | null>(null);
  const lastSavedRef = useRef<{
    revision: number;
    episodeId: number;
    position: number;
  } | null>(null);
  const duration = usePlayer((s) => s.duration);
  const progress = useQuery(playbackQueryOptions(session));

  useEffect(() => {
    if (
      !session.current(token) ||
      !progress.isSuccess ||
      restoredRef.current === token.revision
    )
      return;
    restoredRef.current = token.revision;
    if (progress.data) restoreAccountProgress(session, token, progress.data);
  }, [session, token, progress.data, progress.isSuccess]);

  const save = useCallback(
    async (episodeId: number, position: number, completed: boolean) => {
      if (token.scope === null || !session.current(token)) return;
      try {
        await session.run(token, 'playback', async (signal) =>
          responseData(
            await fetch('/api/progress', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ episodeId, position, completed }),
              signal,
            }),
          ),
        );
        if (session.current(token))
          lastSavedRef.current = {
            revision: token.revision,
            episodeId,
            position,
          };
      } catch {}
    },
    [session, token],
  );

  const saveCurrentProgress = useCallback(
    (completed = false) => {
      const state = usePlayer.getState();
      if (
        token.scope === null ||
        !session.current(token) ||
        state.accountScope !== token.scope ||
        state.accountRevision !== token.revision
      )
        return;
      const episode = getCurrentEpisode(state);
      if (!episode?.id) return;
      const position = getSeekPosition(state);
      const last = lastSavedRef.current;
      if (
        !completed &&
        last?.revision === token.revision &&
        last.episodeId === episode.id &&
        last.position === position
      )
        return;
      void save(episode.id, position, completed);
    },
    [session, token, save],
  );

  useEffect(() => {
    if (token.scope === null || !session.current(token)) return;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    if (getPlaybackState(usePlayer.getState()) === 'playing')
      intervalId = setInterval(() => saveCurrentProgress(), SYNC_INTERVAL_MS);
    const unsubscribe = usePlayer.subscribe(
      (state) => ({
        playbackState: getPlaybackState(state),
        episode: getCurrentEpisode(state),
      }),
      ({ playbackState }, prev) => {
        if (!session.current(token)) return;
        const state = usePlayer.getState();
        if (
          state.accountScope !== token.scope ||
          state.accountRevision !== token.revision
        )
          return;
        if (playbackState === 'playing' && !intervalId)
          intervalId = setInterval(
            () => saveCurrentProgress(),
            SYNC_INTERVAL_MS,
          );
        if (playbackState === 'paused' && prev.playbackState === 'playing') {
          saveCurrentProgress();
          if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
          }
        }
        if (
          playbackState === 'idle' &&
          prev.playbackState !== 'idle' &&
          prev.episode?.id
        ) {
          void save(prev.episode.id, 0, true);
          if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
          }
        }
      },
      {
        equalityFn: (a, b) =>
          a.playbackState === b.playbackState &&
          a.episode?.id === b.episode?.id,
      },
    );
    return () => {
      unsubscribe();
      if (intervalId) clearInterval(intervalId);
    };
  }, [session, token, saveCurrentProgress, save]);

  useEffect(() => {
    if (token.scope === null || !session.current(token)) return;
    const state = usePlayer.getState();
    const episode = getCurrentEpisode(state);
    if (
      !episode?.id ||
      !duration ||
      state.accountScope !== token.scope ||
      state.accountRevision !== token.revision
    )
      return;
    if (getSeekPosition(state) / duration >= COMPLETION_THRESHOLD)
      void save(episode.id, getSeekPosition(state), true);
  }, [session, token, duration, save]);

  useEffect(() => {
    if (token.scope === null || !session.current(token)) return;
    const beforeUnload = () => {
      const state = usePlayer.getState();
      if (
        !session.current(token) ||
        state.accountScope !== token.scope ||
        state.accountRevision !== token.revision
      )
        return;
      const episode = getCurrentEpisode(state);
      if (
        episode?.id &&
        ['playing', 'paused'].includes(getPlaybackState(state))
      )
        navigator.sendBeacon(
          '/api/progress',
          JSON.stringify({
            episodeId: episode.id,
            position: getSeekPosition(state),
            completed: false,
          }),
        );
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [session, token]);
}
