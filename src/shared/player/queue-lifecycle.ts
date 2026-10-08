import type { AccountSession } from '@/shared/auth/account-session';
import {
  checkpointSession,
  erasedQueueKey,
  eraseSession,
  writeSession,
} from './persisted-session';
import { usePlayer } from './usePlayer';

const eraseFailure =
  'Queue erasure incomplete. Source data retained; retry required.';

export function connectQueueSession(session: AccountSession) {
  const hide = (account: string) => {
    const player = usePlayer.getState();
    if (player.accountScope === account)
      player.setAccount(undefined, player.accountRevision + 1);
  };
  const unregister = session.registerLifecycle({
    suspend: async () => {
      const scope = session.scope;
      const player = usePlayer.getState();
      try {
        if (player.accountScope === scope)
          await writeSession({
            scope,
            queue: player.queue,
            current: player.currentTrackIndex,
            position: player.seekPosition,
          });
        await checkpointSession(scope);
      } catch (error) {
        const current = usePlayer.getState();
        if (
          current.accountScope === player.accountScope &&
          current.accountRevision === player.accountRevision
        )
          usePlayer.setState({
            storageError: 'Queue checkpoint failed. Source data retained.',
          });
        throw error;
      }
    },
    erase: async (account) => {
      hide(account);
      try {
        await eraseSession(account);
        const player = usePlayer.getState();
        if (
          session.scope === account &&
          player.accountScope === undefined &&
          player.storageError === eraseFailure
        )
          usePlayer.setState({ storageError: undefined });
      } catch (error) {
        const player = usePlayer.getState();
        if (
          session.scope === account &&
          (player.accountScope === undefined || player.accountScope === account)
        )
          usePlayer.setState({
            storageError: eraseFailure,
          });
        throw error;
      }
    },
  });
  const changed = (event: StorageEvent) => {
    const account = usePlayer.getState().accountScope;
    if (
      account &&
      event.key === erasedQueueKey(account) &&
      event.newValue !== null
    )
      hide(account);
  };
  window.addEventListener('storage', changed);
  return () => {
    unregister();
    window.removeEventListener('storage', changed);
  };
}
