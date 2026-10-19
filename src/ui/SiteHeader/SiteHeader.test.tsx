import { expect, spyOn, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { PathnameContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import * as navigation from 'next/navigation';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AccountContext } from '@/shared/auth/AccountBoundary';
import type { AccountUser } from '@/shared/auth/account';
import { AccountSession } from '@/shared/auth/account-session';
import { TranslationProvider } from '@/shared/i18n';
import { QueryProvider } from '@/shared/query/QueryProvider';
import { SiteHeader } from './SiteHeader';

const owner: AccountUser = {
  id: 'header-owner',
  email: 'owner@example.invalid',
  name: null,
  image: null,
  hasPasskey: false,
};

function render(node: ReactNode) {
  return renderToStaticMarkup(
    <AppRouterContext.Provider
      value={{
        bfcacheId: 'fixture',
        back() {},
        forward() {},
        refresh() {},
        push() {},
        replace() {},
        prefetch() {},
      }}
    >
      <PathnameContext.Provider value="/us/feed/top">
        <TranslationProvider>{node}</TranslationProvider>
      </PathnameContext.Provider>
    </AppRouterContext.Provider>,
  );
}

test.each([
  null,
  owner,
])('the account slot stays neutral until identity resolves to %j', async (user) => {
  const client = new QueryClient();
  const session = new AccountSession(client, undefined, {
    readSession: async () => user,
    resetPlayer() {},
    reload() {},
    publish() {},
  });
  const header = () =>
    render(
      <QueryClientProvider client={client}>
        <AccountContext.Provider value={session}>
          <SiteHeader />
        </AccountContext.Provider>
      </QueryClientProvider>,
    );
  try {
    const unresolved = header();
    expect(unresolved).not.toContain('href="/auth"');
    expect(unresolved).not.toContain('href="/account"');
    expect(unresolved).toContain('aria-busy="true"');
    expect(unresolved).toContain('href="/library"');
    await session.refresh();
    const resolved = header();
    expect(resolved).not.toContain('aria-busy="true"');
    expect(resolved).toContain('href="/account"');
    if (user) {
      expect(resolved).toContain(`title="${owner.email}"`);
      expect(resolved).not.toContain('href="/auth"');
    } else expect(resolved).toContain('href="/auth"');
  } finally {
    client.clear();
  }
});

test('the root provider keeps the shared Discover header unresolved', () => {
  const segment = spyOn(navigation, 'useSelectedLayoutSegment').mockReturnValue(
    '(discover)',
  );
  try {
    const markup = render(
      <QueryProvider user={owner}>
        <SiteHeader />
      </QueryProvider>,
    );
    expect(markup).not.toContain(owner.email);
    expect(markup).not.toContain('href="/auth"');
    expect(markup).toContain('aria-busy="true"');
  } finally {
    segment.mockRestore();
  }
});

test('the root provider retains server identity on dynamic pages', () => {
  const segment = spyOn(navigation, 'useSelectedLayoutSegment').mockReturnValue(
    'episodes',
  );
  try {
    const markup = render(
      <QueryProvider user={owner}>
        <SiteHeader />
      </QueryProvider>,
    );
    expect(markup).toContain(`title="${owner.email}"`);
    expect(markup).not.toContain('aria-busy="true"');
  } finally {
    segment.mockRestore();
  }
});

test('Discover stays active for the rewritten server URL and public client URL', () => {
  const path = spyOn(navigation, 'usePathname');
  const client = new QueryClient();
  const session = new AccountSession(client, undefined, {
    resetPlayer() {},
    reload() {},
    publish() {},
  });
  try {
    for (const pathname of [
      '/discover-render/en/us/feed/top',
      '/discover-render/fr/ca/feed/top/chart',
      '/us/feed/top',
    ]) {
      path.mockReturnValue(pathname);
      const markup = render(
        <QueryClientProvider client={client}>
          <AccountContext.Provider value={session}>
            <SiteHeader />
          </AccountContext.Provider>
        </QueryClientProvider>,
      );
      expect(markup).toMatch(/aria-current="page" href="\/feed\/top"/);
    }
  } finally {
    path.mockRestore();
    client.clear();
  }
});
