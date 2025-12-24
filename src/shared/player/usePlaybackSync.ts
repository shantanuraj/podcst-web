import { useEffect, useRef, useCallback } from 'react';
import { useSession } from '@/shared/auth/useAuth';
import {
  usePlayer,
  getCurrentEpisode,
  getPlaybackState,
  getSeekPosition,
} from './usePlayer';
import type { IEpisodeInfo } from '@/types';

const SYNC_INTERVAL_MS = 30_000;
const COMPLETION_THRESHOLD = 0.95;

interface PlaybackProgress {
  episode: IEpisodeInfo;
  position: number;
}

async function fetchCurrentProgress(): Promise<PlaybackProgress | null> {
  const res = await fetch('/api/progress');
  if (!res.ok) return null;
  return res.json();
}

async function saveProgress(episodeId: number, position: number, completed: boolean) {
  await fetch('/api/progress', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ episodeId, position, completed }),
  });
}

export function usePlaybackSync() {
  const { data: user, isLoading: sessionLoading } = useSession();
  const restoredRef = useRef(false);
  const lastSavedRef = useRef<{ episodeId: number; position: number } | null>(null);

  const queueEpisode = usePlayer((s) => s.queueEpisode);
  const setSeekPosition = usePlayer((s) => s.setSeekPosition);
  const duration = usePlayer((s) => s.duration);

  useEffect(() => {
    if (sessionLoading || !user || restoredRef.current) return;
    restoredRef.current = true;

    const queue = usePlayer.getState().queue;
    if (queue.length > 0) return;

    fetchCurrentProgress().then((progress) => {
      if (!progress?.episode) return;
      queueEpisode(progress.episode);
      setSeekPosition(progress.position);
    });
  }, [user, sessionLoading, queueEpisode, setSeekPosition]);

  const saveCurrentProgress = useCallback(
    (completed = false) => {
      if (!user) return;

      const state = usePlayer.getState();
      const episode = getCurrentEpisode(state);
      if (!episode?.id) return;

      const position = getSeekPosition(state);
      const last = lastSavedRef.current;

      if (!completed && last?.episodeId === episode.id && last?.position === position) {
        return;
      }

      lastSavedRef.current = { episodeId: episode.id, position };
      saveProgress(episode.id, position, completed);
    },
    [user],
  );

  useEffect(() => {
    if (!user) return;

    let intervalId: ReturnType<typeof setInterval> | null = null;

    const unsubscribe = usePlayer.subscribe(
      (state) => ({ playbackState: getPlaybackState(state), episode: getCurrentEpisode(state) }),
      ({ playbackState, episode }, prev) => {
        if (playbackState === 'playing' && !intervalId) {
          intervalId = setInterval(() => saveCurrentProgress(), SYNC_INTERVAL_MS);
        }

        if (playbackState === 'paused' && prev.playbackState === 'playing') {
          saveCurrentProgress();
          if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
          }
        }

        if (playbackState === 'idle' && prev.playbackState !== 'idle' && prev.episode?.id) {
          saveProgress(prev.episode.id, 0, true);
          lastSavedRef.current = null;
          if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
          }
        }
      },
      { equalityFn: (a, b) => a.playbackState === b.playbackState && a.episode?.id === b.episode?.id },
    );

    return () => {
      unsubscribe();
      if (intervalId) clearInterval(intervalId);
    };
  }, [user, saveCurrentProgress]);

  useEffect(() => {
    if (!user) return;

    const state = usePlayer.getState();
    const episode = getCurrentEpisode(state);
    if (!episode?.id || !duration) return;

    const position = getSeekPosition(state);
    if (position / duration >= COMPLETION_THRESHOLD) {
      saveProgress(episode.id, position, true);
    }
  }, [user, duration]);

  useEffect(() => {
    if (!user) return;

    const handleBeforeUnload = () => {
      const state = usePlayer.getState();
      const playbackState = getPlaybackState(state);
      if (playbackState === 'playing' || playbackState === 'paused') {
        const episode = getCurrentEpisode(state);
        if (episode?.id) {
          const position = getSeekPosition(state);
          navigator.sendBeacon(
            '/api/progress',
            JSON.stringify({ episodeId: episode.id, position, completed: false }),
          );
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [user]);
}
