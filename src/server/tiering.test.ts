import { expect, test } from 'bun:test';
import { ESSENTIAL_IDS_SQL } from './tiering';

test('essential query references the three signals and nothing else', () => {
  const q = ESSENTIAL_IDS_SQL.toLowerCase();
  expect(q).toContain('from subscriptions');
  expect(q).toContain('from top_podcasts');
  expect(q).toContain('playback_progress');
  expect(q).toContain("interval '90 days'");
  expect(q).not.toContain('is_active');
  expect(q).not.toContain('last_published');
});
