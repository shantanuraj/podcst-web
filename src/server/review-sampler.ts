import { timingSafeEqual } from 'node:crypto';
import assets from '../../contracts/review/assets.json';
import sampler from '../../contracts/review/sampler.json';
import seed from '../../contracts/review/seed.json';
import { reviewEpisodeGuid } from '../shared/review-sampler';

const xml = (value: string | number) =>
  String(value).replace(
    /[<>&"']/g,
    (character) =>
      ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&apos;',
      })[character] ?? character,
  );

export function samplerFeed(kind: 'public' | 'private', origin: string) {
  const episodes = seed.feeds.find((feed) => feed.key === kind)?.episodes ?? [];
  const base = new URL('/samples/review/v1/', origin).href;
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel>
<title>Podcst ${kind === 'private' ? 'Private ' : ''}Sampler</title>
<description>Original short stories for trying Podcst, narrated with a synthetic voice. No personal or customer data.</description>
<link>${xml(origin)}</link><language>en</language><itunes:author>${xml(sampler.author)}</itunes:author>
<itunes:explicit>false</itunes:explicit><itunes:image href="${xml(base)}cover.png"/>
${episodes
  .map((key) => {
    const episode = sampler.episodes.find((episode) => episode.key === key);
    const asset = assets[key as keyof typeof assets];
    if (!episode || !('duration' in asset))
      throw new Error('Sampler asset missing');
    return `<item><guid isPermaLink="false">${xml(reviewEpisodeGuid(key))}</guid>
<title>${xml(episode.title)}</title><description>${xml(episode.description)}</description>
<pubDate>${xml(new Date(Date.parse(sampler.published) - sampler.episodes.indexOf(episode) * 86_400_000).toUTCString())}</pubDate>
<itunes:duration>${asset.duration}</itunes:duration>
<enclosure url="${xml(base)}${xml(key)}.mp3" type="audio/mpeg" length="${asset.length}"/></item>`;
  })
  .join('\n')}
</channel></rss>`;
}

export function serveSampler(
  key: string,
  origin: string,
  tokens: (string | undefined)[],
) {
  const supplied = Buffer.from(key);
  const privateFeed = tokens.some((token) => {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return false;
    const expected = Buffer.from(token);
    return (
      supplied.length === expected.length && timingSafeEqual(supplied, expected)
    );
  });
  const headers = {
    'Cache-Control': 'private, no-store',
    'X-Robots-Tag': 'noindex, nofollow',
    'Referrer-Policy': 'no-referrer',
  };
  if (key !== 'public' && !privateFeed)
    return new Response(null, { status: 404, headers });
  return new Response(samplerFeed(privateFeed ? 'private' : 'public', origin), {
    headers: {
      ...headers,
      'Content-Type': 'application/rss+xml; charset=utf-8',
    },
  });
}
