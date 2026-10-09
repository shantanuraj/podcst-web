import { FEED_LIMITS } from './feed-contract';
import type { StateScope } from './state-contract';

export function feedImportBatches(scope: StateScope, feeds: readonly string[]) {
  const batches: string[][] = [];
  let batch: string[] = [];
  const fits = (urls: string[]) =>
    new TextEncoder().encode(JSON.stringify({ ...scope, feedUrls: urls }))
      .byteLength <= FEED_LIMITS.bodyBytes;
  for (const feed of feeds) {
    if (!feed || feed.length > 4096)
      throw new Error('Invalid import feed length');
    if (batch.length === FEED_LIMITS.imports.items || !fits([...batch, feed])) {
      if (batch.length) batches.push(batch);
      batch = [];
    }
    batch.push(feed);
    if (!fits(batch)) throw new Error('Import request too large');
  }
  if (batch.length) batches.push(batch);
  return batches;
}
