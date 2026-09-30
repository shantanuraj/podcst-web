import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import * as nextLink from 'next/link';
import type { ReactElement, ReactPortal } from 'react';
import * as reactDom from 'react-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { PodcastLoading, PodcastsLoading } from '@/ui/PageLoading/PageLoading';
import { PageLink } from './PageLink';

afterEach(() => {
  spyOn(nextLink, 'useLinkStatus').mockRestore();
  spyOn(reactDom, 'createPortal').mockRestore();
});

describe('page navigation feedback', () => {
  for (const loading of ['podcast', 'podcasts'] as const) {
    test(`${loading} preserves a usable server-rendered anchor without a document`, () => {
      expect(typeof document).toBe('undefined');
      const markup = renderToStaticMarkup(
        <PageLink
          href="/episodes/1"
          loading={loading}
          className="podcast-link"
          target="_blank"
          rel="noopener"
          aria-label="Open The Daily"
        >
          The Daily
        </PageLink>,
      );

      expect(markup).toContain('href="/episodes/1"');
      expect(markup).toContain('class="podcast-link"');
      expect(markup).toContain('target="_blank"');
      expect(markup).toContain('rel="noopener"');
      expect(markup).toContain('aria-label="Open The Daily"');
      expect(markup).toContain('>The Daily</a>');
      expect(markup).not.toContain('aria-busy');
      expect(markup).not.toContain('loading=');
    });

    test(`${loading} sends its pending skeleton to the page target`, () => {
      spyOn(nextLink, 'useLinkStatus').mockReturnValue({ pending: true });
      const createPortal = spyOn(reactDom, 'createPortal').mockImplementation(
        () => null as unknown as ReactPortal,
      );
      const target = {} as Element;
      const getElementById = (id: string) =>
        id === 'page-loading' ? target : null;
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: { getElementById },
      });

      try {
        renderToStaticMarkup(
          <PageLink href="/episodes/1" loading={loading}>
            The Daily
          </PageLink>,
        );
        expect(createPortal).toHaveBeenCalledTimes(1);
        expect(createPortal.mock.calls[0][1]).toBe(target);
        const overlay = createPortal.mock.calls[0][0] as ReactElement<{
          children: ReactElement;
        }>;
        expect(overlay.props.children.type).toBe(
          loading === 'podcast' ? PodcastLoading : PodcastsLoading,
        );
      } finally {
        Reflect.deleteProperty(globalThis, 'document');
      }
    });
  }
});
