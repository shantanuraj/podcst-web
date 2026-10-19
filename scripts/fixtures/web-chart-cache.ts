// A still-valid legacy Redis entry must not extend the Discover ISR interval.
export const staleChart = {
  timestamp: Date.now(),
  entity: Array.from({ length: 100 }, (_, index) => {
    const id = String((index % 8) + 1);
    return {
      id,
      feed: `https://example.invalid/feed-${id}.xml`,
      title: 'Outdated cached chart',
      author: 'Synthetic old author',
      cover: 'https://example.invalid/cover.png',
      thumbnail: 'https://example.invalid/cover.png',
      categories: [],
      explicit: 'notExplicit',
      count: 25,
    };
  }),
};

if (import.meta.main) console.log(JSON.stringify(staleChart));
