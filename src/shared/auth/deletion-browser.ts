import { ApiError, responseData } from '@/data/api';
import { AccountDeletionCoordinator } from '@/shared/account-deletion';
import AudioUtils from '@/shared/player/AudioUtils';
import { usePlayer } from '@/shared/player/usePlayer';
import type { AccountSession } from './account-session';
import { browserDeletionStorage } from './deletion-storage';
import { connectDeletionTabs } from './deletion-tabs';

const runtimes = new WeakMap<
  AccountSession,
  ReturnType<typeof createRuntime>
>();

async function request(path: string, body: unknown, method = 'POST') {
  return responseData(
    await fetch(`/api/account/deletion${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
      cache: 'no-store',
    }),
  );
}

async function retireMedia(account: string) {
  const player = usePlayer.getState();
  if (player.accountScope !== account) return;
  AudioUtils.stop();
  if (typeof window !== 'undefined' && 'cast' in window) {
    const media = cast.framework.CastContext.getInstance()
      .getCurrentSession()
      ?.getMediaSession();
    if (media)
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Unable to stop casting; retry cleanup')),
          10_000,
        );
        media.stop(
          new chrome.cast.media.StopRequest(),
          () => {
            clearTimeout(timer);
            resolve();
          },
          (error) => {
            clearTimeout(timer);
            reject(error);
          },
        );
      });
  }
}

function createRuntime(session: AccountSession) {
  const storage = browserDeletionStorage();
  const suspend = async (account: string) => {
    if (session.scope !== account) return;
    await session.checkpointAndSuspend();
    await retireMedia(account);
    session.suspendForDeletion(account);
  };
  const retirement = {
    peers: undefined as ReturnType<typeof connectDeletionTabs> | undefined,
  };
  const coordinator = new AccountDeletionCoordinator(storage, {
    verifiedAccount: () => session.verifiedAccount,
    suspend,
    resume: (account) => session.resumeAfterDeletionCancellation(account),
    prepare: (accountId) => request('', { accountId }),
    submit: async (_account, operationId, code) => {
      try {
        return await request(
          '',
          { operationId, code, confirmed: true },
          'DELETE',
        );
      } catch (error) {
        if (error instanceof ApiError && error.status === 422)
          return { operationId, status: 'rejected' };
        throw error;
      }
    },
    status: (receipt) => request('/status', { receipt }),
    cleanup: {
      retire: async (account) => {
        await suspend(account);
        if (!retirement.peers)
          throw new Error('Browser cleanup is not initialized');
        await retirement.peers.retire(account);
      },
      media: retireMedia,
      data: (account) => session.eraseConfirmedAccount(account),
      credentials: async (account) => {
        session.forgetDeletedAccount(account);
      },
    },
  });
  return { storage, coordinator, retirement, suspend };
}

export function deletionRuntime(session: AccountSession) {
  let runtime = runtimes.get(session);
  if (!runtime) {
    runtime = createRuntime(session);
    runtimes.set(session, runtime);
  }
  return runtime;
}

export function connectDeletion(session: AccountSession) {
  const { storage, coordinator, retirement, suspend } =
    deletionRuntime(session);
  try {
    retirement.peers = connectDeletionTabs(async (account) => {
      const record = await coordinator.read(account);
      if (record?.outcome !== 'completed')
        throw new Error('Deletion confirmation required');
      await suspend(account);
      session.forgetDeletedAccount(account);
      await session.eraseConfirmedAccount(account);
    });
  } catch {
    retirement.peers = undefined;
  }
  let running = false;
  const resume = async () => {
    if (running) return;
    running = true;
    try {
      for (const record of storage.records()) {
        if (
          record.outcome !== 'unsubmitted' &&
          record.cleanup?.next !== 'complete'
        )
          await coordinator.check(record.accountId);
      }
    } catch {
    } finally {
      running = false;
    }
  };
  const unsubscribe = storage.subscribe((account) => {
    if (account && account === session.scope) {
      void storage
        .read(account)
        .then((record) =>
          record
            ? suspend(account)
            : session.resumeAfterDeletionCancellation(account),
        )
        .catch(() => {});
    }
    void resume();
  });
  const timer = setInterval(() => {
    if (document.visibilityState === 'visible') void resume();
  }, 10_000);
  void resume();
  window.addEventListener('online', resume);
  return () => {
    retirement.peers?.close();
    retirement.peers = undefined;
    unsubscribe();
    clearInterval(timer);
    window.removeEventListener('online', resume);
  };
}
