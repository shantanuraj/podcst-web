import { expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const chrome = process.env.CHROME_BIN;

test.skipIf(!chrome)(
  'real two-tab cookie change retires private hydration, queries and playback',
  async () => {
    if (!chrome) throw new Error('CHROME_BIN required');
    const profile = mkdtempSync(join(tmpdir(), 'podcst-account-browser-'));
    chmodSync(profile, 0o700);
    const build = await Bun.build({
      entrypoints: [
        new URL('./fixtures/account-boundary-browser.tsx', import.meta.url)
          .pathname,
      ],
      target: 'browser',
      define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    });
    expect(build.success).toBe(true);
    const javascript = await build.outputs[0].text();
    const html =
      '<!doctype html><html><body><div id="app"></div><pre id="result" data-status="pending"></pre><script type="module" src="/fixture.js"></script></body></html>';
    let finish!: (value: {
      passed: boolean;
      checks?: Record<string, unknown>;
      error?: string;
    }) => void;
    const result = new Promise<Parameters<typeof finish>[0]>((resolve) => {
      finish = resolve;
    });
    const requests: string[] = [];
    let progressWrites = 0;
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname;
        requests.push(path);
        const other = request.headers
          .get('cookie')
          ?.includes('account=other-b');
        if (path === '/fixture.js')
          return new Response(javascript, {
            headers: { 'Content-Type': 'text/javascript' },
          });
        if (path === '/')
          return new Response(html, {
            headers: {
              'Content-Type': 'text/html',
              'Set-Cookie':
                'account=owner-a; HttpOnly; SameSite=Strict; Path=/',
            },
          });
        if (path === '/peer')
          return new Response(html, {
            headers: { 'Content-Type': 'text/html' },
          });
        if (path === '/switch')
          return new Response('{}', {
            headers: {
              'Content-Type': 'application/json',
              'Set-Cookie':
                'account=other-b; HttpOnly; SameSite=Strict; Path=/',
            },
          });
        if (path === '/api/auth/session')
          return Response.json({
            user: {
              id: other ? 'other-b' : 'owner-a',
              email: 'fixture@example.invalid',
              name: null,
              image: null,
              hasPasskey: false,
            },
          });
        if (path === '/api/progress') {
          if (request.method !== 'GET') progressWrites++;
          return Response.json(
            request.method === 'GET' ? null : { success: true },
          );
        }
        if (path === '/api/feed/episodes')
          return Response.json({ message: 'Unavailable' }, { status: 404 });
        if (path === '/result') {
          finish(await request.json());
          return new Response('{}');
        }
        return new Response(null, { status: 404 });
      },
    });
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
        '--disable-popup-blocking',
        `--user-data-dir=${profile}`,
        `http://127.0.0.1:${server.port}/`,
      ],
      { stdout: 'ignore', stderr: 'pipe' },
    );
    const errors = new Response(child.stderr).text();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const outcome = await Promise.race([
        result,
        child.exited.then((code) => {
          throw new Error(`Browser exited early: ${code}`);
        }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () =>
              reject(
                new Error(
                  `Browser fixture timed out; requests: ${requests.join(',')}`,
                ),
              ),
            45_000,
          );
        }),
      ]);
      if (!outcome.passed)
        throw new Error(outcome.error || 'Browser regression failed');
      expect(outcome.checks).toMatchObject({
        crossTab: true,
        staleHydrationHidden: true,
        deniedRefetchCleared: true,
        delayedResponseFenced: true,
        progressRestoreFenced: true,
        queueCleared: true,
        publicCacheRetained: true,
      });
      expect(requests).toContain('/peer');
      expect(requests).toContain('/switch');
      expect(requests).toContain('/api/feed/episodes');
      expect(progressWrites).toBe(0);
    } finally {
      if (timeout) clearTimeout(timeout);
      child.kill('SIGKILL');
      await child.exited;
      await errors;
      server.stop(true);
      rmSync(profile, { recursive: true, force: true });
    }
  },
  60_000,
);
