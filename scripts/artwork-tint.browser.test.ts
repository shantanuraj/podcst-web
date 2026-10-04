import { expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const chrome = process.env.CHROME_BIN;

test.skipIf(!chrome)(
  'artwork tint hook reads CORS metadata and fences stale and private artwork',
  async () => {
    if (!chrome) throw new Error('CHROME_BIN required');
    const build = await Bun.build({
      entrypoints: [
        new URL('./fixtures/artwork-tint-browser.tsx', import.meta.url)
          .pathname,
      ],
      target: 'browser',
      define: { 'process.env.NODE_ENV': JSON.stringify('development') },
    });
    expect(build.success).toBe(true);
    const javascript = await build.outputs[0].text();
    const result = Promise.withResolvers<{
      passed: boolean;
      checks?: Record<string, boolean>;
      error?: string;
    }>();
    const requests: { path: string; method: string }[] = [];
    const web = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === '/fixture.js')
          return new Response(javascript, {
            headers: { 'Content-Type': 'text/javascript' },
          });
        if (path === '/')
          return new Response(
            '<!doctype html><div id="app"></div><script type="module" src="/fixture.js"></script>',
            {
              headers: { 'Content-Type': 'text/html' },
            },
          );
        if (path === '/result') {
          result.resolve(await request.json());
          return new Response('{}');
        }
        return new Response(null, { status: 404 });
      },
    });
    const proxy = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname;
        requests.push({ path, method: request.method });
        if (path === '/slow' || path === '/unmount') await Bun.sleep(250);
        const headers = new Headers({
          'Cache-Control': 'no-store',
          'X-Artwork-Tint-Light': path === '/fast' ? '#80c0f8' : '#b8c4c4',
          'X-Artwork-Tint-Dark': '#3d4a4a',
        });
        if (path !== '/blocked')
          headers.set(
            'Access-Control-Allow-Origin',
            `http://127.0.0.1:${web.port}`,
          );
        if (path !== '/hidden')
          headers.set(
            'Access-Control-Expose-Headers',
            'X-Artwork-Tint-Light, X-Artwork-Tint-Dark',
          );
        if (path === '/malformed')
          headers.set('X-Artwork-Tint-Light', 'not-a-colour');
        return new Response(null, {
          status: path === '/error' ? 503 : 200,
          headers,
        });
      },
    });
    const profile = mkdtempSync(join(tmpdir(), 'podcst-tint-browser-'));
    chmodSync(profile, 0o700);
    const child = Bun.spawn(
      [
        chrome,
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-sync',
        `--user-data-dir=${profile}`,
        `http://127.0.0.1:${web.port}/?proxy=http://127.0.0.1:${proxy.port}`,
      ],
      { stdout: 'ignore', stderr: 'pipe' },
    );
    const errors = new Response(child.stderr).text();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const outcome = await Promise.race([
        result.promise,
        child.exited.then((code) => {
          throw new Error(`Browser exited early: ${code}`);
        }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Tint browser fixture timed out')),
            30_000,
          );
        }),
      ]);
      if (!outcome.passed)
        throw new Error(outcome.error || 'Browser regression failed');
      expect(outcome.checks).toEqual({
        deduplicated: true,
        themeReuse: true,
        privateSkipped: true,
        staleResponseIgnored: true,
        corsFallback: true,
        unmounted: true,
      });
      expect(requests).toHaveLength(8);
      expect(requests.every(({ method }) => method === 'HEAD')).toBe(true);
      expect(requests.filter(({ path }) => path === '/shared')).toHaveLength(1);
    } finally {
      if (timeout) clearTimeout(timeout);
      child.kill('SIGKILL');
      await child.exited;
      await errors;
      web.stop(true);
      proxy.stop(true);
      rmSync(profile, { recursive: true, force: true });
    }
  },
  45_000,
);
