import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProxiedImage } from '@/ui/Image';
import { artworkFallback, artworkSources } from './artwork';

const source = 'https://images.example.com/cover.jpg?token=a%2Bb%252Fc&v=1';
const proxy = `https://assets.podcst.app/?p=${encodeURIComponent(source)}`;

describe('artwork sources', () => {
  test('preserves the exact signed source through one proxy fallback', () => {
    const fallback = artworkFallback(source);
    expect(fallback).toBe(proxy);
    expect(new URL(fallback ?? '').searchParams.get('p')).toBe(source);
    expect(artworkFallback(fallback)).toBeUndefined();
  });

  test('never wraps an existing proxy URL, including failed and nested URLs', () => {
    for (const url of [
      proxy,
      `${proxy}&w=384`,
      `https://assets.podcst.app/?p=${encodeURIComponent(proxy)}`,
      'https://assets.podcst.app/broken',
      'http://assets.podcst.app/?p=broken',
    ]) {
      expect(artworkFallback(url)).toBeUndefined();
    }
  });

  test('does not proxy missing, relative, non-HTTP, or credentialed sources', () => {
    for (const value of [
      undefined,
      '',
      '/cover.png',
      'data:image/png;base64,abc',
      'blob:https://podcst.app/id',
      'file:///cover.png',
      'https://user:secret@example.com/cover.png',
    ]) {
      expect(artworkFallback(value)).toBeUndefined();
    }
  });

  test('keeps direct artwork optimistic and unchanged', () => {
    expect(artworkSources(source, '56px')).toEqual({ src: source });
  });

  test('generates all responsive sizes without changing the encoded source', () => {
    const result = artworkSources(`${proxy}&w=160&w=1024`, '56px');
    expect(new URL(result.src ?? '').searchParams.get('w')).toBe('384');
    const candidates = result.srcSet?.split(', ').map((candidate) => {
      const [url, descriptor] = candidate.split(' ');
      const parsed = new URL(url);
      expect(parsed.searchParams.getAll('w')).toHaveLength(1);
      expect(parsed.searchParams.get('p')).toBe(source);
      return [parsed.searchParams.get('w'), descriptor];
    });
    expect(candidates).toEqual([
      ['160', '160w'],
      ['384', '384w'],
      ['1024', '1024w'],
    ]);
  });

  test('does not advertise responsive candidates without a known frame size', () => {
    expect(artworkSources(proxy)).toEqual({ src: proxy });
  });

  test('does not rewrite malformed or recursively proxied sources', () => {
    for (const value of [
      'https://assets.podcst.app/',
      'https://assets.podcst.app/?p=file:///cover.png',
      `${proxy}&p=${encodeURIComponent(source)}`,
      `https://assets.podcst.app/?p=${encodeURIComponent(proxy)}`,
    ]) {
      expect(artworkSources(value, '56px')).toEqual({ src: value });
    }
  });
});

describe('artwork markup', () => {
  test('server-rendered direct images keep their original loading route', () => {
    const markup = renderToStaticMarkup(
      <ProxiedImage src={source} sizes="56px" loading="lazy" alt="Cover" />,
    );
    expect(markup).not.toContain('srcSet=');
    expect(markup).not.toContain('assets.podcst.app');
    expect(markup).toContain('loading="lazy"');
    expect(markup).toContain('decoding="async"');
    expect(markup).toContain('alt="Cover"');
  });

  test('server-rendered proxied images let the browser select the sized source', () => {
    const markup = renderToStaticMarkup(
      <ProxiedImage src={proxy} sizes="56px" loading="lazy" alt="Cover" />,
    );
    expect(markup).toContain('srcSet=');
    expect(markup).toContain('sizes="56px"');
    expect(markup).toContain('160w');
    expect(markup).toContain('384w');
    expect(markup).toContain('1024w');
    expect(markup).not.toContain(
      encodeURIComponent('https://assets.podcst.app/'),
    );
  });
});
