import { describe, expect, test } from 'bun:test';
import { quantize, selectTint } from './palette';

const darkMuted = { rgb: 0x3d4a4a, population: 40 };
const darkVibrant = { rgb: 0x0a3d80, population: 10 };
const lightMuted = { rgb: 0xb8c4c4, population: 20 };
const lightVibrant = { rgb: 0x80c0ff, population: 30 };
const vibrant = { rgb: 0x1f7ae0, population: 50 };

function repeat(rgb: number, count: number) {
  return Array<number>(count).fill(rgb);
}

describe('native artwork tint selection', () => {
  test('prefers muted swatches over vibrant and dominant swatches', () => {
    expect(
      selectTint([darkMuted, darkVibrant, lightMuted, lightVibrant]),
    ).toEqual({ light: '#b8c4c4', dark: '#3d4a4a' });
  });

  test('falls back from muted to vibrant to dominant', () => {
    expect(selectTint([darkVibrant, vibrant])).toEqual({
      light: '#1f7ae0',
      dark: '#0a3d80',
    });
    expect(selectTint([lightVibrant, vibrant])).toEqual({
      light: '#80c0ff',
      dark: '#1f7ae0',
    });
    expect(selectTint([vibrant])).toEqual({
      light: '#1f7ae0',
      dark: '#1f7ae0',
    });
    expect(selectTint([])).toBeNull();
  });

  test("an earlier target exclusively claims a later target's best swatch", () => {
    const shared = { rgb: 0x2b5c3a, population: 50 };
    const other = { rgb: 0x1e2b24, population: 5 };
    expect(selectTint([shared, other])).toEqual({
      light: '#2b5c3a',
      dark: '#1e2b24',
    });
    expect(selectTint([other, shared])).toEqual(selectTint([shared, other]));
  });

  test('scores saturation and lightness rather than only population', () => {
    const dominant = { rgb: 0x707878, population: 50 };
    expect(selectTint([dominant, darkMuted, lightMuted])).toEqual({
      light: '#b8c4c4',
      dark: '#3d4a4a',
    });
  });

  test('population breaks otherwise equal target scores', () => {
    const teal = { rgb: 0xb8c4c4, population: 10 };
    const purple = { rgb: 0xc4b8c4, population: 30 };
    expect(selectTint([teal, purple])?.light).toBe('#c4b8c4');
    expect(selectTint([purple, teal])?.light).toBe('#c4b8c4');
  });

  test('handles achromatic, red and negative-hue colours', () => {
    for (const rgb of [0x888888, 0xff0000, 0xff00cc, 0x336666]) {
      const hex = `#${rgb.toString(16).padStart(6, '0')}`;
      expect(selectTint([{ rgb, population: 1 }])).toEqual({
        light: hex,
        dark: hex,
      });
    }
  });
});

describe('native artwork quantization', () => {
  test('rejects near-black, near-white and the Android skin-tone range', () => {
    expect(quantize([0x080808, 0xf8f8f8, 0xd2a07c])).toEqual([]);
    expect(selectTint(quantize([0x000000, 0xffffff]))).toBeNull();
    expect(quantize([])).toEqual([]);
    expect(quantize([0x336666])).toEqual([{ rgb: 0x306060, population: 1 }]);
  });

  test('keeps distinct colours and their populations', () => {
    const swatches = quantize([
      ...repeat(0x336666, 30),
      ...repeat(0x1f7ae0, 10),
      ...repeat(0x000000, 60),
    ]);
    expect(swatches).toHaveLength(2);
    expect(new Set(swatches.map(({ population }) => population))).toEqual(
      new Set([30, 10]),
    );
    expect(swatches.find(({ population }) => population === 30)?.rgb).toBe(
      0x306060,
    );
  });

  test('matches the native solid-image fixture', () => {
    expect(
      selectTint(quantize(new Uint32Array(64 * 64).fill(0x336666))),
    ).toEqual({
      light: '#306060',
      dark: '#306060',
    });
  });

  test('cuts many colours into at most the requested number of boxes', () => {
    const pixels = Uint32Array.from({ length: 4096 }, (_, index) => {
      const red = (index % 64) * 4;
      const green = Math.floor(index / 64) * 4;
      return (red << 16) | (green << 8) | 0x80;
    });
    const original = pixels.slice();
    const swatches = quantize(pixels);
    expect(swatches.length).toBeLessThanOrEqual(16);
    expect(swatches.length).toBeGreaterThan(8);
    for (const swatch of swatches)
      expect(quantize([swatch.rgb])).toHaveLength(1);
    expect(quantize(pixels, 8).length).toBeLessThanOrEqual(8);
    expect(quantize(pixels)).toEqual(swatches);
    expect(pixels).toEqual(original);
  });

  test('averages split boxes by population and conserves accepted pixels', () => {
    const pixels = [...repeat(0x306060, 30), ...repeat(0x606060, 10)];
    expect(quantize(pixels, 1)).toEqual([{ rgb: 0x406060, population: 40 }]);
    expect(
      quantize([...pixels, ...repeat(0x80c0ff, 20)], 2).reduce(
        (total, swatch) => total + swatch.population,
        0,
      ),
    ).toBe(60);
  });

  test('rejects invalid palette limits', () => {
    for (const limit of [0, -1, 1.5, 257, NaN, Infinity])
      expect(() => quantize([], limit)).toThrow(RangeError);
  });
});
