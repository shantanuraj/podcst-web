import { expect, mock, spyOn, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IDBFactory } from 'fake-indexeddb';
import { renderToStaticMarkup } from 'react-dom/server';
import { stateRuntime } from '@/data/state-browser';
import { AccountContext } from '@/shared/auth/AccountBoundary';
import { AccountSession } from '@/shared/auth/account-session';
import { GuestProgressTransfer } from './GuestProgressTransfer';

test('selected guest tuple and explicit action are visible only inside a verified account boundary', async () => {
  globalThis.indexedDB = new IDBFactory();
  const locks = Object.getOwnPropertyDescriptor(navigator, 'locks');
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: async (_name: string, work: () => Promise<void>) => work(),
    },
  });
  const scope = {
    protocol: 1,
    accountId: 'a',
    generation: '17adbd84-d0e4-4e2d-ad9f-b084efee3211',
  };
  const fetcher = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async () => Response.json({ ...scope, revision: '0', items: [] }),
      { preconnect: () => {} },
    ),
  );
  const client = new QueryClient();
  const session = new AccountSession(
    client,
    {
      id: 'a',
      email: 'fixture@example.invalid',
      name: null,
      image: null,
      hasPasskey: false,
    },
    { resetPlayer() {}, reload() {}, publish() {} },
  );
  const sync = stateRuntime(session).sync;
  const render = () =>
    renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <AccountContext.Provider value={session}>
          <GuestProgressTransfer episodeId="9007199254740993" />
        </AccountContext.Provider>
      </QueryClientProvider>,
    );
  try {
    await sync.activate(null);
    await sync.progress('9007199254740993', 'replay', 37);
    await sync.activate('a');
    const html = render();
    expect(html).toContain('37');
    expect(html).toContain('Unplayed');
    expect(html).toContain('Use this position for this account');
    expect(html).not.toContain('disabled');
    expect(
      fetcher.mock.calls.every(([, options]) => options?.method === 'GET'),
    ).toBe(true);
    session.beginAuthChange();
    expect(render()).toBe('');
  } finally {
    client.clear();
    await sync.suspend();
    if (locks) Object.defineProperty(navigator, 'locks', locks);
    else Reflect.deleteProperty(navigator, 'locks');
    mock.restore();
  }
});
