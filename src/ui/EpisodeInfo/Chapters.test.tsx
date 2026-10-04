import { expect, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { chapterQueryOptions } from '@/data/chapters';
import { messagesByLanguage } from '@/messages';
import { AccountContext } from '@/shared/auth/AccountBoundary';
import { AccountSession } from '@/shared/auth/account-session';
import type { EpisodeChapters } from '@/shared/chapters';
import { TranslationProvider } from '@/shared/i18n';
import type { IEpisodeInfo } from '@/types';
import { Chapters } from './Chapters';

const episode = {
  id: 42,
  podcastId: 7,
  feed: 'fixture',
  guid: 'fixture',
  showNotes: '00:00 Notes start<br>01:00 Notes end',
} as IEpisodeInfo;

function render(data?: EpisodeChapters, item = episode, failed = false) {
  const client = new QueryClient();
  const session = new AccountSession(client, null, {
    resetPlayer() {},
    reload() {},
    publish() {},
  });
  if (data)
    client.setQueryData(chapterQueryOptions(session, item).queryKey, data);
  if (failed)
    client
      .getQueryCache()
      .find({ queryKey: chapterQueryOptions(session, item).queryKey })
      ?.setState({ status: 'error', error: new Error('Metadata unavailable') });
  const markup = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <AccountContext.Provider value={session}>
        <TranslationProvider>
          <Chapters episode={item} />
        </TranslationProvider>
      </AccountContext.Provider>
    </QueryClientProvider>,
  );
  client.clear();
  return markup;
}

test('renders accessible embedded chapter buttons as text, with localized missing titles', () => {
  const markup = render({
    source: 'embedded',
    chapters: [
      { title: '<img src=x onerror=alert(1)>', start: 0 },
      { title: '', start: 60 },
    ],
  });
  expect(markup).toContain('aria-labelledby=');
  expect(markup).toContain('<ol');
  expect(markup).toContain('aria-label="Play');
  expect(markup).toContain('Chapter 2');
  expect(markup).toContain('01:00');
  expect(markup).toContain('&lt;img');
  expect(markup).not.toContain('<img');
  expect(markup).not.toContain('Notes start');
});

test('shows fallback while loading and no chapters when unavailable', () => {
  const loading = render();
  expect(loading).toContain('Loading embedded chapters');
  expect(loading).toContain('Notes start');
  expect(render(undefined, { ...episode, id: undefined })).toContain(
    'Chapters from show notes',
  );
  expect(render({ chapters: [], source: 'none' })).toContain(
    'No chapters available',
  );
});

test('failed refetches discard stale embedded metadata in favor of show notes', () => {
  const markup = render(
    {
      source: 'embedded',
      chapters: [
        { title: 'Stale embedded', start: 0 },
        { title: 'Stale ending', start: 20 },
      ],
    },
    episode,
    true,
  );
  expect(markup).toContain('Notes start');
  expect(markup).not.toContain('Stale embedded');
});

test('does not render private show-note fallback to a guest', () => {
  expect(render(undefined, { ...episode, isPrivate: true })).not.toContain(
    'Notes start',
  );
});

test('every supported language supplies chapter accessibility labels', () => {
  for (const messages of Object.values(messagesByLanguage)) {
    expect(messages.chapters.title.length).toBeGreaterThan(0);
    expect(messages.chapters.previous.length).toBeGreaterThan(0);
    expect(messages.chapters.next.length).toBeGreaterThan(0);
    expect(messages.chapters.seek).toContain('{title}');
    expect(messages.chapters.seek).toContain('{timestamp}');
    expect(messages.chapters.untitled).toContain('{number}');
  }
});
