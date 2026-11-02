import { expect, test } from 'bun:test';
import { runBrowserFixture } from './lib/browser-fixture';

const chrome = process.env.CHROME_BIN;

test.skipIf(!chrome)(
  'PlayButton preserves hooks and episode identity across playback and navigation',
  async () => {
    if (!chrome) throw new Error('CHROME_BIN required');
    const outcome = await runBrowserFixture({
      chrome,
      entrypoint: new URL(
        './fixtures/play-button-browser.tsx',
        import.meta.url,
      ),
      development: true,
      fetch: () => undefined,
    });
    expect(outcome.checks).toEqual({
      stableHooks: true,
      playbackLabels: true,
      iconVariants: true,
      episodeChanges: true,
      playbackActions: true,
      forwardedRef: true,
    });
  },
  60_000,
);
