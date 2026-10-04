export interface ArtworkTint {
  readonly light: string;
  readonly dark: string;
}

interface Swatch {
  rgb: number;
  population: number;
}

function hsl(rgb: number) {
  const red = ((rgb >> 16) & 0xff) / 255;
  const green = ((rgb >> 8) & 0xff) / 255;
  const blue = (rgb & 0xff) / 255;
  const high = Math.max(red, green, blue);
  const low = Math.min(red, green, blue);
  const delta = high - low;
  const lightness = (high + low) / 2;
  const hue =
    delta === 0
      ? 0
      : high === red
        ? ((green - blue) / delta) % 6
        : high === green
          ? (blue - red) / delta + 2
          : (red - green) / delta + 4;
  return {
    hue: (((hue * 60) % 360) + 360) % 360,
    saturation: delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1)),
    lightness,
  };
}

function allowed(rgb: number) {
  const { hue, saturation, lightness } = hsl(rgb);
  return (
    lightness > 0.05 &&
    lightness < 0.95 &&
    !(hue >= 10 && hue <= 37 && saturation <= 0.82)
  );
}

const lightnessTargets = {
  light: [0.55, 0.74, 1],
  normal: [0.3, 0.5, 0.7],
  dark: [0, 0.26, 0.45],
} as const;

const saturationTargets = {
  vibrant: [0.35, 1, 1],
  muted: [0, 0.3, 0.4],
} as const;

export function selectTint(swatches: readonly Swatch[]): ArtworkTint | null {
  const dominant = swatches.reduce<Swatch | undefined>(
    (best, swatch) =>
      !best || swatch.population > best.population ? swatch : best,
    undefined,
  );
  if (!dominant || dominant.population <= 0) return null;

  const used = new Set<number>();
  const selected = new Map<string, Swatch>();
  for (const [kind, saturation] of Object.entries(saturationTargets)) {
    for (const [tone, lightness] of Object.entries(lightnessTargets)) {
      let best: Swatch | undefined;
      let bestScore = -Infinity;
      for (const swatch of swatches) {
        if (used.has(swatch.rgb)) continue;
        const color = hsl(swatch.rgb);
        if (
          color.saturation < saturation[0] ||
          color.saturation > saturation[2] ||
          color.lightness < lightness[0] ||
          color.lightness > lightness[2]
        )
          continue;
        const score =
          0.24 * (1 - Math.abs(color.saturation - saturation[1])) +
          0.52 * (1 - Math.abs(color.lightness - lightness[1])) +
          (0.24 * swatch.population) / dominant.population;
        if (score > bestScore) {
          best = swatch;
          bestScore = score;
        }
      }
      if (best) {
        selected.set(`${tone}-${kind}`, best);
        used.add(best.rgb);
      }
    }
  }

  const tint = (tone: 'light' | 'dark') => {
    const swatch =
      selected.get(`${tone}-muted`) ??
      selected.get(`${tone}-vibrant`) ??
      dominant;
    return `#${swatch.rgb.toString(16).padStart(6, '0')}`;
  };
  return { light: tint('light'), dark: tint('dark') };
}

function channel(color: number, index: number) {
  return (color >> (10 - 5 * index)) & 0x1f;
}

function widen(red: number, green: number, blue: number) {
  return (red << 19) | (green << 11) | (blue << 3);
}

function rgb(color: number) {
  return widen(channel(color, 0), channel(color, 1), channel(color, 2));
}

class ColorBox {
  readonly population: number;
  readonly low: number[];
  readonly high: number[];

  constructor(
    readonly start: number,
    readonly end: number,
    colors: number[],
    histogram: Uint32Array,
  ) {
    this.population = 0;
    this.low = [31, 31, 31];
    this.high = [0, 0, 0];
    for (let offset = start; offset < end; offset++) {
      const color = colors[offset];
      this.population += histogram[color];
      for (let index = 0; index < 3; index++) {
        const value = channel(color, index);
        this.low[index] = Math.min(this.low[index], value);
        this.high[index] = Math.max(this.high[index], value);
      }
    }
  }

  get volume() {
    return this.high.reduce(
      (volume, value, index) => volume * (value - this.low[index] + 1),
      1,
    );
  }

  get longestChannel() {
    const lengths = this.high.map((value, index) => value - this.low[index]);
    if (lengths[0] >= lengths[1] && lengths[0] >= lengths[2]) return 0;
    return lengths[1] >= lengths[0] && lengths[1] >= lengths[2] ? 1 : 2;
  }

  average(colors: number[], histogram: Uint32Array): Swatch {
    const sums = [0, 0, 0];
    for (let offset = this.start; offset < this.end; offset++) {
      const color = colors[offset];
      for (let index = 0; index < 3; index++)
        sums[index] += histogram[color] * channel(color, index);
    }
    const means = sums.map((sum) => Math.round(sum / this.population));
    return {
      rgb: widen(means[0], means[1], means[2]),
      population: this.population,
    };
  }
}

export function quantize(pixels: ArrayLike<number>, maxColors = 16): Swatch[] {
  if (!Number.isInteger(maxColors) || maxColors < 1 || maxColors > 256)
    throw new RangeError('maxColors must be an integer between 1 and 256');

  const histogram = new Uint32Array(1 << 15);
  for (let index = 0; index < pixels.length; index++) {
    const pixel = pixels[index];
    histogram[
      (((pixel >> 19) & 0x1f) << 10) |
        (((pixel >> 11) & 0x1f) << 5) |
        ((pixel >> 3) & 0x1f)
    ]++;
  }
  const colors: number[] = [];
  for (let color = 0; color < histogram.length; color++)
    if (histogram[color] > 0 && allowed(rgb(color))) colors.push(color);
  if (colors.length <= maxColors)
    return colors.map((color) => ({
      rgb: rgb(color),
      population: histogram[color],
    }));

  const boxes = [new ColorBox(0, colors.length, colors, histogram)];
  while (boxes.length < maxColors) {
    let index = 0;
    for (let candidate = 1; candidate < boxes.length; candidate++)
      if (boxes[candidate].volume > boxes[index].volume) index = candidate;
    const box = boxes[index];
    if (box.end - box.start <= 1) break;
    const order = [
      [0, 1, 2],
      [1, 0, 2],
      [2, 1, 0],
    ][box.longestChannel];
    const key = (color: number) =>
      order.reduce((value, index) => (value << 5) | channel(color, index), 0);
    const sorted = colors
      .slice(box.start, box.end)
      .sort((a, b) => key(a) - key(b));
    colors.splice(box.start, sorted.length, ...sorted);
    let count = 0;
    let split = box.start;
    for (; split < box.end - 2; split++) {
      count += histogram[colors[split]];
      if (count >= Math.floor(box.population / 2)) break;
    }
    boxes[index] = new ColorBox(box.start, split + 1, colors, histogram);
    boxes.push(new ColorBox(split + 1, box.end, colors, histogram));
  }
  return boxes
    .map((box) => box.average(colors, histogram))
    .filter((swatch) => allowed(swatch.rgb));
}
