import { expect, test } from 'bun:test';
import { opmlFeeds } from './opml';

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
