import { useAccountSession } from '@/shared/auth/AccountBoundary';
import type { IEpisodeInfo } from '@/types';
import { usePlayer } from './usePlayer';

export function useAccountPlayback() {
  const session = useAccountSession();
  const token = session.token();
  return (episode: IEpisodeInfo, action: () => void) => {
    if (
      !session.current(token, episode.podcastId) ||
      (episode.isPrivate && token.scope === null)
    )
      return;
    usePlayer.getState().setAccount(token.scope, token.revision);
    action();
  };
}
