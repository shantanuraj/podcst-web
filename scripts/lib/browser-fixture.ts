import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface BrowserResult {
  passed: boolean;
  checks?: Record<string, unknown>;
  error?: string;
}

export async function runBrowserFixture({
  chrome,
  entrypoint,
  headers,
  fetch,
}: {
  chrome: string;
  entrypoint: URL;
  headers?: Record<string, string>;
  fetch: (
    request: Request,
  ) => Response | undefined | Promise<Response | undefined>;
}) {
  const build = await Bun.build({
    entrypoints: [entrypoint.pathname],
    target: 'browser',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  });
  if (!build.success) throw new Error(build.logs.join('\n'));
  const javascript = await build.outputs[0].text();
  const html =
    '<!doctype html><html><body><div id="app"></div><pre id="result" data-status="pending"></pre><script type="module" src="/fixture.js"></script></body></html>';
  let finish!: (value: BrowserResult) => void;
  const result = new Promise<BrowserResult>((resolve) => {
    finish = resolve;
  });
  const requests: string[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      requests.push(path);
      if (path === '/fixture.js')
        return new Response(javascript, {
          headers: { 'Content-Type': 'text/javascript' },
        });
      if (path === '/result') {
        finish(await request.json());
        return Response.json({});
      }
      const response = await fetch(request);
      if (response) return response;
      if (path === '/' || path === '/peer')
        return new Response(html, {
          headers: {
            'Content-Type': 'text/html',
            ...(path === '/' ? headers : {}),
          },
        });
      return new Response(null, { status: 404 });
    },
  });
  const profile = mkdtempSync(join(tmpdir(), 'podcst-browser-'));
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
    return { checks: outcome.checks, requests };
  } finally {
    if (timeout) clearTimeout(timeout);
    child.kill('SIGKILL');
    await child.exited;
    await errors;
    server.stop(true);
    rmSync(profile, { recursive: true, force: true });
  }
}
