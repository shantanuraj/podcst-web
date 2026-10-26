const channelName = 'podcst-deletion-retirement';
const lockPrefix = 'podcst-account-tab:';

export function connectDeletionTabs(
  retire: (account: string) => Promise<void>,
) {
  const channel = new BroadcastChannel(channelName);
  const id = `${lockPrefix}${crypto.randomUUID()}`;
  let release = () => {};
  let stopped = false;
  const pending = new Map<string, Map<string, (ok: boolean) => void>>();
  const held = navigator.locks.request(
    id,
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
        if (stopped) resolve();
      }),
  );
  const listener = async (event: MessageEvent) => {
    const value = event.data;
    if (!value || typeof value.request !== 'string') return;
    if (value.kind === 'ack' && typeof value.tab === 'string') {
      pending.get(value.request)?.get(value.tab)?.(value.ok === true);
    } else if (value.kind === 'retire' && typeof value.account === 'string') {
      let ok = false;
      try {
        await retire(value.account);
        ok = true;
      } catch {}
      channel.postMessage({ kind: 'ack', request: value.request, tab: id, ok });
    }
  };
  channel.addEventListener('message', listener);
  return {
    async retire(account: string) {
      const locks = await navigator.locks.query();
      const peers =
        locks.held?.flatMap((lock) =>
          lock.name?.startsWith(lockPrefix) && lock.name !== id
            ? [lock.name]
            : [],
        ) ?? [];
      if (!peers.length) return;
      const request = crypto.randomUUID();
      const callbacks = new Map<string, (ok: boolean) => void>();
      pending.set(request, callbacks);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const acknowledgements = Promise.all(
          peers.map(
            (peer) =>
              new Promise<void>((resolve, reject) => {
                callbacks.set(peer, (ok) =>
                  ok
                    ? resolve()
                    : reject(
                        new Error(
                          'Another tab could not stop playback. Close it and retry cleanup.',
                        ),
                      ),
                );
              }),
          ),
        );
        channel.postMessage({ kind: 'retire', request, account });
        await Promise.race([
          acknowledgements,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error(
                    'Another tab has not confirmed cleanup. Close it and retry.',
                  ),
                ),
              10_000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
        pending.delete(request);
      }
    },
    close() {
      stopped = true;
      release();
      void held;
      channel.removeEventListener('message', listener);
      channel.close();
    },
  };
}
