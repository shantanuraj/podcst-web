import { createHash } from 'node:crypto';
import assets from '../../contracts/review/assets.json';
import seed from '../../contracts/review/seed.json';
import {
  pinnedAddress,
  pinnedRequest,
  resolvePublicAddress,
} from '../../src/server/http/public-destination';
import { fetchFeed } from '../../src/server/ingest/feed-refresh';
import { directArtwork } from '../../src/shared/artwork';
import { reviewEpisodeGuid } from '../../src/shared/review-sampler';
import { ReviewAccountError } from './review-account-state';
import { type ResolvedReviewSeed, validateReviewSeed } from './review-seed';

export function reviewHttpsUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    url.href !== value
  )
    throw new ReviewAccountError(
      'Sampler URLs must be canonical HTTPS without userinfo or fragments',
    );
  return url;
}

async function readAsset(input: string, length: number, range = false) {
  const url = reviewHttpsUrl(input);
  const signal = AbortSignal.timeout(30_000);
  const address = await pinnedAddress(
    url.hostname,
    signal,
    resolvePublicAddress,
  );
  return new Promise<{ bytes: Buffer; type: string }>((resolve, reject) => {
    const request = pinnedRequest(
      url,
      address,
      signal,
      {
        'Accept-Encoding': 'identity',
        ...(range ? { Range: 'bytes=0-1' } : {}),
      },
      (response) => {
        const expectedLength = range ? 2 : length;
        if (
          response.statusCode !== (range ? 206 : 200) ||
          Number(response.headers['content-length']) !== expectedLength ||
          (range && response.headers['content-range'] !== `bytes 0-1/${length}`)
        ) {
          response.destroy();
          reject(
            new ReviewAccountError(
              'Sampler media length or range response is invalid',
            ),
          );
          return;
        }
        const chunks: Buffer[] = [];
        let received = 0;
        response.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (received > expectedLength)
            response.destroy(
              new ReviewAccountError('Sampler asset is oversized'),
            );
          else chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () => {
          if (received !== expectedLength)
            reject(new ReviewAccountError('Sampler asset is truncated'));
          else
            resolve({
              bytes: Buffer.concat(chunks),
              type: response.headers['content-type']?.split(';')[0] ?? '',
            });
        });
      },
    );
    request.on('error', reject);
    request.end();
  });
}

export async function resolveReviewSeed(
  urls: { public: string; private: string },
  dependencies = { fetchFeed, readAsset },
): Promise<ResolvedReviewSeed> {
  const feeds: ResolvedReviewSeed['feeds'] = [];
  for (const key of ['public', 'private'] as const) {
    reviewHttpsUrl(urls[key]);
    const fetched = await dependencies.fetchFeed(
      urls[key],
      undefined,
      key === 'private',
    );
    if (fetched.status !== 'updated')
      throw new ReviewAccountError('Sampler feed unavailable');
    feeds.push({ key, url: urls[key], fetched });
  }
  const resolved = { revision: seed.revision, feeds };
  validateReviewSeed(resolved);
  const checked = new Set<string>();
  const check = async (
    url: string,
    asset: { length: number; sha256: string },
    type: string,
  ) => {
    const body = await dependencies.readAsset(url, asset.length);
    if (
      body.type !== type ||
      createHash('sha256').update(body.bytes).digest('hex') !== asset.sha256
    )
      throw new ReviewAccountError(
        'Sampler asset content differs from the pinned fixture',
      );
    if (type === 'audio/mpeg') {
      const range = await dependencies.readAsset(url, asset.length, true);
      if (range.type !== type || !range.bytes.equals(body.bytes.subarray(0, 2)))
        throw new ReviewAccountError('Sampler media range content differs');
    }
  };
  for (const feed of feeds) {
    if (!checked.has(feed.fetched.data.cover)) {
      const original = directArtwork(feed.fetched.data.cover);
      if (!original) throw new ReviewAccountError('Sampler artwork is invalid');
      await check(original, assets.cover, 'image/png');
      checked.add(feed.fetched.data.cover);
    }
    for (const episode of feed.fetched.data.episodes) {
      const key = Object.keys(assets).find(
        (key) => reviewEpisodeGuid(key) === episode.guid,
      );
      const asset = key ? assets[key as keyof typeof assets] : null;
      if (
        !asset ||
        !('duration' in asset) ||
        episode.duration !== asset.duration ||
        episode.file.length !== asset.length
      )
        throw new ReviewAccountError(
          'Sampler enclosure differs from the pinned fixture',
        );
      await check(episode.file.url, asset, 'audio/mpeg');
    }
  }
  return resolved;
}
