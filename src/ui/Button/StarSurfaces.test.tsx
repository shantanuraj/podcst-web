import { beforeEach, describe, expect, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IDBFactory } from 'fake-indexeddb';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import LibraryPage from '@/app/library/page';
import { AccountContext } from '@/shared/auth/AccountBoundary';
import { AccountSession } from '@/shared/auth/account-session';
import { TranslationProvider } from '@/shared/i18n';
import { NowPlaying } from '@/shared/player/NowPlaying';
import { starRuntime } from '@/shared/stars/browser';
import type { IEpisodeInfo } from '@/types';
import { EpisodeActions } from '@/ui/EpisodeInfo/EpisodeActions';
import { EpisodeRow } from '@/ui/EpisodesList/EpisodeRow';

const episode: IEpisodeInfo = {
  id: '301841099',
  podcastId: '1',
  feed: 'https://example.invalid/rss',
  guid: 'star-surface-fixture',
  title: 'A starrable episode',
  podcastTitle: 'A podcast',
  cover: 'https://example.invalid/cover.jpg',
  duration: 600,
  summary: null,
  published: null,
  explicit: false,
  link: null,
  author: null,
  episodeArt: null,
  showNotes: '',
  file: {
    url: 'https://example.invalid/audio.mp3',
    length: 0,
    type: 'audio/mpeg',
  },
};

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

function fixture(account: string | null = null) {
  const client = new QueryClient();
  const session = new AccountSession(
    client,
    account
      ? {
          id: account,
          email: 'owner@example.invalid',
          name: null,
          image: null,
          hasPasskey: false,
        }
      : null,
    {
      resetPlayer() {},
      reload() {},
      publish() {},
    },
  );
  const sync = starRuntime(session).sync;
  const render = (node: ReactNode) =>
    renderToStaticMarkup(
      <AppRouterContext.Provider
        value={{
          back() {},
          forward() {},
          refresh() {},
          push() {},
          replace() {},
          prefetch() {},
        }}
      >
        <QueryClientProvider client={client}>
          <AccountContext.Provider value={session}>
            <TranslationProvider>{node}</TranslationProvider>
          </AccountContext.Provider>
        </QueryClientProvider>
      </AppRouterContext.Provider>,
    );
  return { client, session, sync, render };
}

function starControl(markup: string) {
  const controls =
    markup.match(
      /<button\b[^>]*\bdata-starred="(?:true|false)"[^>]*>[\s\S]*?<\/button>/g,
    ) ?? [];
  expect(controls).toHaveLength(1);
  return controls[0];
}

const surfaces = [
  {
    name: 'episode detail actions',
    render: (item: IEpisodeInfo) => (
      <EpisodeActions episode={item} shareTitle={item.title} />
    ),
  },
  {
    name: 'current podcast episode rows',
    render: (item: IEpisodeInfo) => <EpisodeRow episode={item} />,
  },
  {
    name: 'expanded Now Playing',
    render: (item: IEpisodeInfo) => (
      <NowPlaying episode={item} onClose={() => {}} />
    ),
  },
];

describe('star controls on current web surfaces', () => {
  for (const surface of surfaces) {
    test(`${surface.name} keeps the star visible before storage hydration`, () => {
      const f = fixture();
      try {
        const control = starControl(f.render(surface.render(episode)));
        expect(control).toContain('aria-label="Star A starrable episode"');
        expect(control).toContain('disabled=""');
      } finally {
        f.client.clear();
      }
    });

    test(`${surface.name} reflects durable guest stars and unstars`, async () => {
      const f = fixture();
      try {
        await f.sync.activate(null);
        let control = starControl(f.render(surface.render(episode)));
        expect(control).toContain('aria-pressed="false"');
        expect(control).not.toContain('disabled=""');
        await f.sync.edit(episode.id as string, 'add', episode);
        control = starControl(f.render(surface.render(episode)));
        expect(control).toContain('aria-label="Unstar A starrable episode"');
        expect(control).toContain('aria-pressed="true"');
        await f.sync.edit(episode.id as string, 'remove');
        expect(starControl(f.render(surface.render(episode)))).toContain(
          'aria-pressed="false"',
        );
      } finally {
        f.client.clear();
      }
    });
  }

  test('episode page uses a labeled control and requires a canonical ID', async () => {
    const f = fixture();
    try {
      await f.sync.activate(null);
      const render = (item: IEpisodeInfo) =>
        f.render(<EpisodeActions episode={item} shareTitle={item.title} />);
      expect(starControl(render(episode))).toContain('Star</button>');
      const unresolved = starControl(render({ ...episode, id: undefined }));
      expect(unresolved).toContain('Star</button>');
      expect(unresolved).toContain('disabled=""');
    } finally {
      f.client.clear();
    }
  });

  test('signed-in private episodes retain star controls while sharing is hidden', async () => {
    const f = fixture('owner');
    const item = { ...episode, isPrivate: true };
    try {
      await f.sync.activate('owner');
      await f.sync.edit(item.id as string, 'add', item);
      const markup = f.render(
        <EpisodeActions episode={item} shareTitle={item.title} />,
      );
      const control = starControl(markup);
      expect(control).toContain('aria-pressed="true"');
      expect(control).not.toContain('disabled=""');
      expect(markup).not.toContain('aria-label="Share"');
      f.session.beginAuthChange();
      const retired = starControl(
        f.render(<EpisodeActions episode={item} shareTitle={item.title} />),
      );
      expect(retired).toContain('aria-pressed="false"');
      expect(retired).toContain('disabled=""');
    } finally {
      f.client.clear();
    }
  });

  test('hydrated Starred library rows offer an unstar control', async () => {
    const f = fixture();
    try {
      await f.sync.activate(null);
      await f.sync.edit(episode.id as string, 'add', episode);
      const control = starControl(f.render(<LibraryPage />));
      expect(control).toContain('aria-label="Unstar A starrable episode"');
      expect(control).toContain('aria-pressed="true"');
      expect(control).not.toContain('disabled=""');
    } finally {
      f.client.clear();
    }
  });
});
