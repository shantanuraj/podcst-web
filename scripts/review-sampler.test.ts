import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import assets from '../contracts/review/assets.json';
import sampler from '../contracts/review/sampler.json';
import { adaptFeed } from '../src/app/api/feed/parser';
import { id3TagSize, parseMp3Chapters } from '../src/server/chapters/mp3';
import { samplerFeed, serveSampler } from '../src/server/review-sampler';
import { resolveReviewSeed } from './lib/review-assets';
import { reviewArguments } from './review-account';

test('sampler media hashes, timelines and speech durations match the manifest', async () => {
  for (const episode of sampler.episodes) {
    const bytes = readFileSync(
      new URL(
        `../public/samples/review/v1/${episode.key}.mp3`,
        import.meta.url,
      ),
    );
    const asset = assets[episode.key as Exclude<keyof typeof assets, 'cover'>];
    expect(bytes.length).toBe(asset.length);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
    expect(asset.duration).toBeGreaterThan(60);
    const chapters = await parseMp3Chapters(
      bytes.subarray(0, id3TagSize(bytes) ?? 0),
    );
    expect(chapters.map((chapter) => chapter.title)).toEqual(
      episode.chapters.map((chapter) => chapter.title),
    );
    expect(chapters[0].start).toBe(0);
    expect(chapters.at(-1)?.start).toBeLessThan(asset.duration);
  }
});

test('private sampler locators require configured tokens and disclose no credentials', async () => {
  for (const token of ['', 'bad', '0'.repeat(63), '1'.repeat(64)])
    expect(
      serveSampler(token, 'https://example.invalid', [
        'a'.repeat(64),
        'b'.repeat(64),
      ]).status,
    ).toBe(404);
  expect(
    serveSampler('a'.repeat(64), 'https://example.invalid', []).status,
  ).toBe(404);
  for (const token of ['a'.repeat(64), 'b'.repeat(64), 'public']) {
    const response = serveSampler(token, 'https://example.invalid', [
      'a'.repeat(64),
      'b'.repeat(64),
    ]);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = await response.text();
    expect(body).not.toContain('a'.repeat(64));
    const data = await adaptFeed(body);
    expect(data?.episodes).toHaveLength(token === 'public' ? 4 : 2);
  }
});

test('asset preflight refuses changed audio, invalid ranges, identities and progress', async () => {
  const urls = {
    public: 'https://example.invalid/public',
    private: 'https://example.invalid/private',
  };
  const fetchFeed = async (url: string) => {
    const data = await adaptFeed(
      samplerFeed(
        url === urls.public ? 'public' : 'private',
        'https://example.invalid',
      ),
    );
    if (!data) throw new Error('Invalid fixture');
    return {
      status: 'updated' as const,
      data,
      etag: null,
      lastModified: null,
      hash: 'synthetic',
    };
  };
  const readAsset = async (url: string, _length: number, range = false) => {
    const bytes = readFileSync(
      new URL(`../public${new URL(url).pathname}`, import.meta.url),
    );
    return {
      bytes: range ? bytes.subarray(0, 2) : bytes,
      type: url.endsWith('.mp3') ? 'audio/mpeg' : 'image/png',
    };
  };
  expect(
    (await resolveReviewSeed(urls, { fetchFeed, readAsset })).feeds,
  ).toHaveLength(2);
  await expect(
    resolveReviewSeed(urls, {
      fetchFeed,
      readAsset: async () => ({
        bytes: Buffer.from('changed'),
        type: 'audio/mpeg',
      }),
    }),
  ).rejects.toThrow('differs');
  await expect(
    resolveReviewSeed(urls, {
      fetchFeed,
      readAsset: async (url, length, range) =>
        range
          ? { bytes: Buffer.from('no'), type: 'audio/mpeg' }
          : readAsset(url, length),
    }),
  ).rejects.toThrow('range');
  await expect(
    resolveReviewSeed(urls, {
      readAsset,
      fetchFeed: async (url) => {
        const feed = await fetchFeed(url);
        feed.data.episodes[0].guid = 'different';
        return feed;
      },
    }),
  ).rejects.toThrow('identities');
});

test('operator arguments reject inline credentials, arbitrary users and implicit targets', () => {
  for (const args of [
    ['reset', '--email', 'ordinary@example.invalid'],
    [
      'apply',
      '--config',
      '/private/config',
      '--plan',
      '/private/plan',
      '--output',
      '/private/receipt',
    ],
    ['plan', '--code', '012345'],
    ['apply', '--user-id', 'ordinary'],
    [
      'credential',
      '--config',
      '/private/config',
      '--output',
      '/private/a',
      '--output',
      '/private/b',
    ],
  ])
    expect(() => reviewArguments(args)).toThrow();
  expect(
    reviewArguments([
      'apply',
      '--config',
      '/private/config',
      '--plan',
      '/private/plan',
      '--target',
      'production',
      '--output',
      '/private/receipt',
    ]).options.target,
  ).toBe('production');
});
