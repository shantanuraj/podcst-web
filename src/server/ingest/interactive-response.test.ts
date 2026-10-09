import { expect, test } from 'bun:test';
import { FEED_LIMITS } from '@/shared/feed-contract';
import { readJsonBody } from '../http/json-body';
import { FeedAdmissionError } from './feed-demand';
import { feedError, readFeedBody } from './interactive-response';

const request = (body: BodyInit) =>
  new Request('https://example.invalid/api/feed', { method: 'POST', body });

test('interactive body intake shares byte, UTF-8 and streamed deadline bounds', async () => {
  expect(
    await readFeedBody(request('{"url":"https://example.invalid"}')),
  ).toEqual({ url: 'https://example.invalid' });
  await expect(
    readFeedBody(request('x'.repeat(FEED_LIMITS.bodyBytes + 1))),
  ).rejects.toMatchObject({ status: 413 });
  await expect(
    readFeedBody(request(new Uint8Array([0xff]))),
  ).rejects.toMatchObject({ status: 400 });
  await expect(readFeedBody(request('[]'))).rejects.toMatchObject({
    status: 400,
  });
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{'));
    },
    cancel() {
      cancelled = true;
    },
  });
  await expect(
    readJsonBody(request(stream), FEED_LIMITS.bodyBytes, 10),
  ).rejects.toMatchObject({ status: 408 });
  expect(cancelled).toBe(true);
});

test('admission failures are stable, private and locator-free', async () => {
  for (const code of ['rate_limited', 'unavailable'] as const) {
    const response = feedError(new FeedAdmissionError(code, 12));
    expect(response.status).toBe(code === 'rate_limited' ? 429 : 503);
    expect(response.headers.get('Retry-After')).toBe('12');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Vary')).toBe('Cookie');
    expect(await response.json()).toEqual({
      code,
      message: 'Feed unavailable',
    });
  }
  const response = feedError(
    new Error('https://example.invalid/?token=synthetic-private'),
  );
  expect(await response.text()).not.toContain('synthetic-private');
});
