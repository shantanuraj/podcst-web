import { CancelledError } from '@tanstack/react-query';
import { get } from '@/data/api';
import type {
  AccountSession,
  AccountToken,
} from '@/shared/auth/account-session';
import type { IEpisodeInfo } from '@/types';
import { usePlayer } from './usePlayer';

export interface PlaybackProgress {
  episode: IEpisodeInfo;
  position: number;
}

export function playbackQueryOptions(session: AccountSession) {
  const token = session.token();
  const options = session.query('playback', 'playback', async (signal) => {
    const progress = await get<PlaybackProgress | null>(
      '/progress',
      {},
      undefined,
      signal,
    );
    if (progress && !session.current(token, progress.episode.podcastId))
      throw new CancelledError();
    return progress;
  });
  return {
    ...options,
    enabled: options.enabled && token.scope !== null,
    staleTime: Infinity,
  };
}

export function restoreAccountProgress(
  session: AccountSession,
  token: AccountToken,
  progress: PlaybackProgress,
) {
  const player = usePlayer.getState();
  if (
    token.scope === null ||
    !session.current(token, progress.episode.podcastId) ||
    player.accountScope !== token.scope ||
    player.accountRevision !== token.revision ||
    player.hasPlaybackActivity ||
    player.state === 'playing' ||
    player.state === 'buffering'
  )
    return false;
  player.restoreEpisode(progress.episode, progress.position);
  return true;
}
