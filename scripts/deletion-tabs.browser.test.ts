import { expect, test } from 'bun:test';
import { runBrowserFixture } from './lib/browser-fixture';

const chrome = process.env.CHROME_BIN;
test.skipIf(!chrome)(
  'real tabs acknowledge retirement and reject failed media cleanup',
  async () => {
    if (!chrome) throw new Error('CHROME_BIN required');
    const result = await runBrowserFixture({
      chrome,
      entrypoint: new URL(
        './fixtures/deletion-tabs-browser.ts',
        import.meta.url,
      ),
      fetch: () => undefined,
    });
    expect(result.checks).toEqual({
      acknowledged: true,
      failureRetained: true,
    });
  },
  60_000,
);
