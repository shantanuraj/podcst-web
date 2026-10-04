import { StrictMode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { useArtworkTint } from '../../src/shared/artwork/useArtworkTint';

const nativeFetch = window.fetch.bind(window);
const proxy = new URLSearchParams(location.search).get('proxy');
const requests: string[] = [];
const completed: string[] = [];

window.fetch = (async (input: RequestInfo | URL, options?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin !== 'https://assets.podcst.app')
    return nativeFetch(input, options);
  const source = new URL(url.searchParams.get('p') ?? '');
  requests.push(source.pathname);
  try {
    return await nativeFetch(`${proxy}${source.pathname}`, options);
  } finally {
    completed.push(source.pathname);
  }
}) as typeof window.fetch;

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function until(check: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Browser condition timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const source = (name: string, width = 384) =>
  `https://assets.podcst.app/?${new URLSearchParams({
    p: `https://images.example.com/${name}`,
    w: String(width),
  })}`;

function Consumer({
  id = 'tint',
  src,
  privateSource = false,
  dark = false,
}: {
  id?: string;
  src?: string;
  privateSource?: boolean;
  dark?: boolean;
}) {
  const tint = useArtworkTint(src, privateSource);
  return (
    <output id={id}>{tint?.[dark ? 'dark' : 'light'] ?? 'neutral'}</output>
  );
}

async function run() {
  const host = document.getElementById('app');
  assert(host, 'Missing root');
  const root = createRoot(host);
  const value = (id = 'tint') => document.getElementById(id)?.textContent;
  flushSync(() => {
    root.render(
      <StrictMode>
        <Consumer src={source('shared')} />
        <Consumer id="second" src={source('shared', 1024)} dark />
        <Consumer id="private" src={source('private')} privateSource />
        <Consumer id="direct" src="https://images.example.com/direct" />
      </StrictMode>,
    );
  });
  await until(() => value() === '#b8c4c4' && value('second') === '#3d4a4a');
  assert(requests.length === 1, 'Concurrent consumers duplicated the request');
  assert(value('private') === 'neutral', 'Private source acquired a tint');
  assert(value('direct') === 'neutral', 'Direct source acquired a tint');

  const render = (src: string, privateSource = false, dark = false) => {
    flushSync(() =>
      root.render(
        <Consumer src={src} privateSource={privateSource} dark={dark} />,
      ),
    );
  };
  render(source('shared'), false, true);
  await until(() => value() === '#3d4a4a');
  assert(requests.length === 1, 'Theme change reloaded the palette');
  render(source('shared'), true);
  assert(value() === 'neutral', 'Private flag retained a public tint');
  assert(requests.length === 1, 'Private flag triggered a request');

  render(source('slow'));
  assert(value() === 'neutral', 'Source change retained the old tint');
  await until(() => requests.includes('/slow'));
  render(source('fast'));
  await until(() => value() === '#80c0f8');
  await until(() => completed.includes('/slow'));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert(value() === '#80c0f8', 'Stale response overwrote the current tint');

  for (const name of ['hidden', 'blocked', 'malformed', 'error']) {
    render(source(name));
    assert(value() === 'neutral', `${name} retained the previous tint`);
    await until(() => completed.includes(`/${name}`));
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert(value() === 'neutral', `${name} did not fall back safely`);
  }

  render(source('unmount'));
  await until(() => requests.includes('/unmount'));
  flushSync(() => root.unmount());
  await until(() => completed.includes('/unmount'));
  assert(!host.textContent, 'Unmounted consumer updated the DOM');
  assert(
    !requests.includes('/private') && !requests.includes('/direct'),
    'Artwork routing changed',
  );

  return {
    deduplicated: true,
    themeReuse: true,
    privateSkipped: true,
    staleResponseIgnored: true,
    corsFallback: true,
    unmounted: true,
  };
}

void run().then(
  (checks) =>
    nativeFetch('/result', {
      method: 'POST',
      body: JSON.stringify({ passed: true, checks }),
    }),
  (error: Error) =>
    nativeFetch('/result', {
      method: 'POST',
      body: JSON.stringify({ passed: false, error: error.stack }),
    }),
);
