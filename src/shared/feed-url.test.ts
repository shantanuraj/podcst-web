import { expect, test } from 'bun:test';
import { feedUrl, isFeedUrlInput } from './feed-url';

test('URL-like input is distinguished from ordinary titles', () => {
  for (const value of [
    ' https://example.invalid/rss ',
    'HTTPS://example.invalid/rss',
    'http:/invalid',
    'ftp://example.invalid/rss',
  ]) {
    expect(isFeedUrlInput(value)).toBe(true);
  }
  expect(isFeedUrlInput('News: Today')).toBe(false);
});

test('feed validation retains complete credential-bearing locators', () => {
  const url = 'https://example.invalid/feed?token=a%2Bb&part=1&part=2';
  expect(feedUrl(` ${url} `)).toBe(url);
});

test('unsupported protocols and embedded passwords are rejected', () => {
  for (const value of [
    'file:///private',
    'ftp://example.invalid/feed',
    'https://listener:secret@example.invalid/feed',
    '/relative',
  ]) {
    expect(() => feedUrl(value)).toThrow();
  }
});
