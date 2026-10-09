import { SaxesParser } from 'saxes';
import { FEED_LIMITS } from './feed-contract';

export interface OpmlFeed {
  title: string;
  feed: string;
}

export const OPML_ERROR =
  'Invalid or oversized OPML. Existing imports retained.';

export async function readOpml(file: Blob): Promise<string[]> {
  if (file.size > FEED_LIMITS.opml.bytes) throw new Error(OPML_ERROR);
  const bytes = await file.arrayBuffer();
  return opmlFeeds(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

export function opmlFeeds(text: string): string[] {
  const limits = FEED_LIMITS.opml;
  if (new TextEncoder().encode(text).length > limits.bytes)
    throw new Error(OPML_ERROR);
  const feeds = new Set<string>();
  let depth = 0;
  let outlines = 0;
  const reject = (): never => {
    throw new Error(OPML_ERROR);
  };
  const parser = new SaxesParser();
  parser.on('error', reject);
  parser.on('doctype', reject);
  parser.on('opentag', ({ name, attributes }) => {
    if (++depth > limits.depth) reject();
    if (name !== 'outline') return;
    if (++outlines > limits.outlines) reject();
    const url = Object.entries(attributes)
      .find(([key]) => key.toLowerCase() === 'xmlurl')?.[1]
      ?.trim();
    if (!url) return;
    if (url.length > 4096) reject();
    feeds.add(url);
    if (feeds.size > limits.feeds) reject();
  });
  parser.on('closetag', () => {
    depth--;
  });
  parser.write(text).close();
  return [...feeds];
}

export function opmlDocument(feeds: readonly OpmlFeed[]): string {
  const doc = document.implementation.createDocument('', '', null);
  const opml = doc.createElement('opml');
  opml.setAttribute('version', '1.0');
  const head = doc.createElement('head');
  const title = doc.createElement('title');
  title.textContent = 'Podcst Subscriptions';
  head.appendChild(title);
  opml.appendChild(head);
  const body = doc.createElement('body');
  for (const feed of feeds) {
    const outline = doc.createElement('outline');
    outline.setAttribute('type', 'rss');
    outline.setAttribute('text', feed.title);
    outline.setAttribute('title', feed.title);
    outline.setAttribute('xmlUrl', feed.feed);
    body.appendChild(outline);
  }
  opml.appendChild(body);
  return `<?xml version="1.0" encoding="utf-8"?>\n${new XMLSerializer().serializeToString(opml)}`;
}

export function downloadOpml(feeds: readonly OpmlFeed[]) {
  const url = URL.createObjectURL(
    new Blob([opmlDocument(feeds)], { type: 'text/x-opml' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = 'podcst-subscriptions.opml';
  link.click();
  URL.revokeObjectURL(url);
}
