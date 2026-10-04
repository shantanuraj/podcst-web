import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { useArtworkTint } from './useArtworkTint';

test('server rendering returns a neutral tint without browser APIs', () => {
  function Consumer() {
    const tint = useArtworkTint(
      'https://assets.podcst.app/?p=https%3A%2F%2Fexample.com%2Fcover.png',
    );
    return <span>{tint?.light ?? 'neutral'}</span>;
  }
  expect(renderToStaticMarkup(<Consumer />)).toBe('<span>neutral</span>');
});
