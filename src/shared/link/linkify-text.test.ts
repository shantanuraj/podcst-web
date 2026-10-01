import { describe, expect, test } from 'bun:test';
import { linkifyText } from './linkify-text';

describe('untrusted podcast HTML', () => {
  test('strips executable elements, event handlers and unsafe links', () => {
    const html = linkifyText(
      '<p onclick="steal()">Notes</p><script>steal()</script><img src="https://example.invalid/art" onerror="steal()"><a href="javascript:steal()">bad</a><iframe src="https://example.invalid/frame"></iframe><svg onload="steal()"></svg>',
    );
    expect(html).toContain('Notes');
    expect(html).not.toContain('steal');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('onclick');
  });

  test('keeps timestamps and safe formatted links without opener access', () => {
    const html = linkifyText(
      '<p><strong>Chapter</strong> 12:34</p><a href="https://example.invalid/show" target="_blank" rel="opener">Show</a>',
    );
    expect(html).toContain('<strong>Chapter</strong>');
    expect(html).toContain('data-timestamp="12:34"');
    expect(html).toContain('href="https://example.invalid/show"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain('rel="opener"');
  });

  test('does not interpret years or link attributes as episode timestamps', () => {
    const html = linkifyText(
      '<p>Released in 2026. Listen at 01:23:45.</p><a href="https://example.invalid/12:34">Original link</a>',
    );
    expect(html).toContain('href="https://example.invalid/12:34"');
    expect(html).toContain('data-timestamp="01:23:45"');
    expect(html).not.toContain('data-timestamp="20:26"');
    expect(html.match(/data-timestamp=/g)).toHaveLength(1);
  });

  test('sanitizes markup introduced by bare URL linkification', () => {
    const html = linkifyText('https://example.invalid/"onclick="steal()');
    expect(html).not.toMatch(/<[^>]+\sonclick\s*=/i);
    expect(html).not.toContain('<script');
  });

  test('rejects encoded script protocols and embedded documents', () => {
    const html = linkifyText(
      '<a href="jav&#x61;script:steal()">link</a><img src="data:image/svg+xml;base64,test"><object data="https://example.invalid"></object>',
    );
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('data:image');
    expect(html).not.toContain('<object');
  });
});
