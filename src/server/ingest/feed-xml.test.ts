import { describe, expect, test } from 'bun:test';
import { adaptFeed, parseFeedEvidence } from '../../app/api/feed/parser';
import { validateFeedXml } from './feed-xml';

describe('feed XML resource policy', () => {
  test('rejects unsafe declarations without echoing content', async () => {
    for (const xml of [
      '<!DOCTYPE rss SYSTEM "https://private.invalid/token"><rss/>',
      '<!DOCTYPE rss [<!ENTITY secret SYSTEM "file:///private">]><rss>&secret;</rss>',
      '<!ENTITY secret "private"><rss/>',
      '<rss><secret>private-token</rss>',
    ]) {
      for (const parse of [adaptFeed, parseFeedEvidence]) {
        try {
          await parse(xml);
          throw new Error('accepted');
        } catch (error) {
          expect(String(error)).toContain('Invalid or unsafe feed XML');
          expect(String(error)).not.toContain('private');
        }
      }
    }
  });

  test('allows declaration-like text inside CDATA and comments', () => {
    expect(() =>
      validateFeedXml(
        '<rss><!-- <!DOCTYPE ignored> --><description><![CDATA[<!DOCTYPE example>]]></description></rss>',
      ),
    ).not.toThrow();
  });

  test('bounds depth, element count, attributes and input bytes', () => {
    for (const xml of [
      `${'<a>'.repeat(65)}${'</a>'.repeat(65)}`,
      `<rss>${'<a/>'.repeat(250_001)}</rss>`,
      `<rss ${Array.from({ length: 65 }, (_, i) => `a${i}="v"`).join(' ')} />`,
      'x'.repeat(32 * 1024 * 1024 + 1),
    ])
      expect(() => validateFeedXml(xml)).toThrow('Invalid or unsafe feed XML');
  });
});
