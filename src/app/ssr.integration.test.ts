import { describe, expect, test } from 'bun:test';

const baseUrl = process.env.SSR_TEST_BASE_URL;
const podcastPath = '/episodes/1';
const episodePath = `${podcastPath}/282272719`;
const chartPath = '/us/feed/top';
const userAgents = {
  browser:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  bot: 'Twitterbot/1.0',
};

interface StructuredData {
  '@type': string;
  name?: string;
  url?: string;
  itemListElement?: { item: { name: string } }[];
  associatedMedia?: { contentUrl: string };
  partOfSeries?: { name: string; url: string };
}

async function inspectHtml(html: string) {
  const exposedHtml = await new HTMLRewriter()
    .on('[hidden], template', {
      element: (element) => {
        element.remove();
      },
    })
    .on('[style]', {
      element(element) {
        if (
          /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(
            element.getAttribute('style') || '',
          )
        ) {
          element.remove();
        }
      },
    })
    .transform(new Response(html))
    .text();

  const schemas: StructuredData[] = [];
  let schemaText = '';
  let title = '';
  let description = '';
  let canonical = '';
  let openGraphTitle = '';
  let twitterTitle = '';
  await new HTMLRewriter()
    .on('head title', {
      text: (chunk) => {
        title += chunk.text;
      },
    })
    .on('head meta[name="description"]', {
      element: (element) => {
        description = element.getAttribute('content') || '';
      },
    })
    .on('head link[rel="canonical"]', {
      element: (element) => {
        canonical = element.getAttribute('href') || '';
      },
    })
    .on('head meta[property="og:title"]', {
      element: (element) => {
        openGraphTitle = element.getAttribute('content') || '';
      },
    })
    .on('head meta[name="twitter:title"]', {
      element: (element) => {
        twitterTitle = element.getAttribute('content') || '';
      },
    })
    .on('script[type="application/ld+json"]', {
      element(element) {
        schemaText = '';
        element.onEndTag(() => {
          schemas.push(JSON.parse(schemaText));
        });
      },
      text(chunk) {
        schemaText += chunk.text;
      },
    })
    .transform(new Response(exposedHtml))
    .text();

  const visibleHtml = await new HTMLRewriter()
    .on('script, style', {
      element: (element) => {
        element.remove();
      },
    })
    .transform(new Response(exposedHtml))
    .text();

  let heading = '';
  let chartHeading = '';
  let showNotes = '';
  let pending = false;
  const links: { href: string; label: string }[] = [];
  await new HTMLRewriter()
    .on('main h1', {
      text: (chunk) => {
        heading += chunk.text;
      },
    })
    .on('main h2', {
      text: (chunk) => {
        chartHeading += chunk.text;
      },
    })
    .on('main #show-notes p', {
      text: (chunk) => {
        showNotes += chunk.text;
      },
    })
    .on('main [aria-busy="true"]', {
      element: () => {
        pending = true;
      },
    })
    .on('main a[href]', {
      element: (element) => {
        links.push({ href: element.getAttribute('href') || '', label: '' });
      },
      text: (chunk) => {
        links[links.length - 1].label += chunk.text;
      },
    })
    .transform(new Response(visibleHtml))
    .text();

  return {
    title: title.trim(),
    description,
    canonical,
    openGraphTitle,
    twitterTitle,
    schemas,
    heading: heading.trim(),
    chartHeading: chartHeading.trim(),
    showNotes: showNotes.trim(),
    pending,
    links,
  };
}

async function readPage(pathname: string, userAgent: string) {
  if (!baseUrl) throw new Error('SSR_TEST_BASE_URL required');
  const response = await fetch(new URL(pathname, baseUrl), {
    headers: {
      accept: 'text/html',
      'accept-language': 'en-US,en;q=0.9',
      'user-agent': userAgent,
    },
    signal: AbortSignal.timeout(30_000),
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/html');
  const page = await inspectHtml(await response.text());
  expect(page.pending).toBe(false);
  expect(page.title.length).toBeGreaterThan(0);
  expect(page.openGraphTitle).toBe(page.title);
  expect(page.twitterTitle).toBe(page.title);
  expect(page.description.length).toBeGreaterThan(0);
  expect(new URL(page.canonical).pathname).toBe(pathname);
  return page;
}

describe.skipIf(!baseUrl)('public HTML without JavaScript', () => {
  for (const [name, userAgent] of Object.entries(userAgents)) {
    test(`${name}: episode content and structured data are visible without streamed scripts`, async () => {
      const page = await readPage(episodePath, userAgent);
      expect(page.heading.length).toBeGreaterThan(0);
      expect(page.title).toContain(page.heading);
      expect(page.showNotes.length).toBeGreaterThan(0);
      const podcastLink = page.links.find((link) => link.href === podcastPath);
      expect(podcastLink?.label.length).toBeGreaterThan(0);
      const episode = page.schemas.find(
        (schema) => schema['@type'] === 'PodcastEpisode',
      );
      expect(episode).toBeDefined();
      expect(Bun.escapeHTML(episode?.name || '')).toBe(page.heading);
      expect(new URL(episode?.url || '').pathname).toBe(episodePath);
      expect(episode?.associatedMedia?.contentUrl).toMatch(/^https?:\/\//);
      expect(Bun.escapeHTML(episode?.partOfSeries?.name || '')).toBe(
        podcastLink?.label || '',
      );
    }, 35_000);

    test(`${name}: podcast heading and first episode page are visible without hydration`, async () => {
      const page = await readPage(podcastPath, userAgent);
      expect(page.heading.length).toBeGreaterThan(0);
      expect(page.title).toContain(page.heading);
      const episodes = page.links.filter((link) =>
        /^\/episodes\/1\/\d+$/.test(link.href),
      );
      expect(episodes).toHaveLength(20);
      expect(episodes.every((episode) => episode.label.trim().length > 0)).toBe(
        true,
      );
      const podcast = page.schemas.find(
        (schema) => schema['@type'] === 'PodcastSeries',
      );
      expect(podcast).toBeDefined();
      expect(Bun.escapeHTML(podcast?.name || '')).toBe(page.heading);
      expect(new URL(podcast?.url || '').pathname).toBe(podcastPath);
    }, 35_000);

    test(`${name}: chart entries and metadata are available without JavaScript`, async () => {
      const page = await readPage(chartPath, userAgent);
      expect(page.chartHeading.length).toBeGreaterThan(0);
      expect(page.title).toContain('Podcasts');
      const podcasts = page.links.filter((link) =>
        link.href.startsWith('/episodes/'),
      );
      expect(podcasts.length).toBeGreaterThan(0);
      const chart = page.schemas.find(
        (schema) => schema['@type'] === 'ItemList',
      );
      expect(chart).toBeDefined();
      expect(chart?.itemListElement?.length).toBeGreaterThan(0);
      for (const item of chart?.itemListElement || []) {
        expect(
          podcasts.some((podcast) =>
            podcast.label.includes(Bun.escapeHTML(item.item.name)),
          ),
        ).toBe(true);
      }
    }, 35_000);
  }
});
