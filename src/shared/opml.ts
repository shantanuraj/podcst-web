import { Parser } from 'htmlparser2';

export interface OpmlFeed {
  title: string;
  feed: string;
}

export function opmlFeeds(text: string): string[] {
  const feeds = new Set<string>();
  const parser = new Parser(
    {
      onopentag(name, attributes) {
        const url = attributes.xmlurl?.trim();
        if (name === 'outline' && url) feeds.add(url);
      },
    },
    { xmlMode: true, lowerCaseAttributeNames: true, decodeEntities: true },
  );
  parser.end(text);
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
