import { expect, test } from 'bun:test';
import fixtures from '../../contracts/feeds/opml.json';
import { FEED_LIMITS } from './feed-contract';
import { opmlFeeds, readOpml } from './opml';

for (const item of fixtures.cases)
  test(item.name, () => {
    const text =
      item.xml ??
      (item.prefix ?? '') +
        Array.from(
          { length: item.repeat ?? 0 },
          (_, i) => item.fragment?.replace('{i}', String(i)) ?? '',
        ).join('') +
        (item.suffix ?? '').repeat(item.closeRepeat ?? 0) +
        (item.tail ?? '');
    if (!item.valid) expect(() => opmlFeeds(text)).toThrow();
    else {
      const result = opmlFeeds(text);
      expect(result).toHaveLength(item.count!);
      if (item.feeds) expect(result).toEqual(item.feeds);
    }
  });

test('refuses oversized files before reading and invalid UTF-8 before parsing', async () => {
  let read = false;
  await expect(
    readOpml({
      size: FEED_LIMITS.opml.bytes + 1,
      arrayBuffer: async () => {
        read = true;
        return new ArrayBuffer(0);
      },
    } as Blob),
  ).rejects.toThrow();
  expect(read).toBe(false);
  await expect(readOpml(new Blob([new Uint8Array([0xff])]))).rejects.toThrow();
});

test('reads every xmlUrl once, nested or not, whatever its type', () => {
  expect(
    opmlFeeds(`<?xml version="1.0"?><opml><body>
      <outline text="feeds">
        <outline type="rss" text="A" xmlUrl="https://a.example/feed" />
        <outline text="B" xmlUrl=" https://b.example/feed?a=1&amp;b=2 " />
      </outline>
      <outline type="rss" text="A again" xmlUrl="https://a.example/feed" />
      <outline text="folder" />
    </body></opml>`),
  ).toEqual(['https://a.example/feed', 'https://b.example/feed?a=1&b=2']);
});
