#!/usr/bin/env bun

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { parse } from 'opentype.js';

const font = parse(
  readFileSync('ios/Podcst/Fonts/InstrumentSerif-Italic.ttf').buffer,
);
const em = font.unitsPerEm;
const { ascender, descender } = font.tables.hhea;
const baseline = (em - ascender + descender) / 2 / em + ascender / em;

function letter(char: string) {
  const glyph = font.charToGlyph(char);
  return { glyph, advance: (glyph.advanceWidth ?? em) / em };
}

type Letter = ReturnType<typeof letter>;

const podcst = letter('p');
const lab = letter('a');

const paper = '#FAF9F7';
const ink = '#1A1A1A';
const accent = '#C84B31';
const night = '#1C1B1A';
const pitch = '#0E0E0D';
const moon = '#F2F0ED';
const ember = '#E06B52';
const white = '#FFFFFF';
const black = '#000000';

type Scale = { glyph: number; dot: number };

const hero: Scale = { glyph: 132 / 160, dot: 0.13 };
const launcher: Scale = { glyph: 64 / 88, dot: 0.12 };
const favicon: Scale = { glyph: 30 / 32, dot: 0.12 };

type Frame = { origin: number; size: number };

function mark(
  { glyph, advance }: Letter,
  { origin, size }: Frame,
  scale: Scale,
  decimals: number,
) {
  const fontSize = scale.glyph * size;
  const x =
    origin + ((1 - advance * scale.glyph) / 2 - 0.1 * scale.glyph) * size;
  const y =
    origin + ((1 - scale.glyph) / 2 + (baseline - 0.12) * scale.glyph) * size;
  const r = (scale.dot * size) / 2;
  const cx = origin + 0.64 * size + r;
  const cy = y - r;
  const n = (v: number) => +v.toFixed(decimals);
  return {
    glyph: glyph.getPath(x, y, fontSize).toPathData(decimals),
    dot: `M${n(cx - r)} ${n(cy)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0Z`,
  };
}

function grid({ origin, size }: Frame, cells: number) {
  const step = size / cells;
  const line = step / 16;
  const end = origin + size;
  return Array.from({ length: cells }, (_, i) => {
    const at = +(origin + (i + 1) * step - line).toFixed(1);
    const w = +line.toFixed(1);
    return `M${origin} ${at}H${end}v${w}H${origin}ZM${at} ${origin}h${w}V${end}h${-w}Z`;
  }).join('');
}

type Tile = {
  letter: Letter;
  scale: Scale;
  fg: string;
  dot?: string;
  bg?: string;
  radius?: number;
  inset?: number;
  lines?: string;
};

const canvas = 1024;

function svg({
  letter,
  scale,
  fg,
  dot,
  bg,
  radius = 0,
  inset = 0,
  lines,
}: Tile) {
  const frame = { origin: inset * canvas, size: (1 - 2 * inset) * canvas };
  const paths = mark(letter, frame, scale, 1);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvas} ${canvas}">`,
    bg &&
      `<rect width="${canvas}" height="${canvas}" rx="${radius * canvas}" fill="${bg}"/>`,
    lines &&
      `<path fill="${lines}" fill-opacity="0.08" d="${grid(frame, 10)}"/>`,
    `<path fill="${fg}" d="${paths.glyph}"/>`,
    dot && `<path fill="${dot}" d="${paths.dot}"/>`,
    '</svg>',
    '',
  ]
    .filter(Boolean)
    .join('\n');
}

function png(tile: Tile, px: number) {
  return new Resvg(svg(tile), { fitTo: { mode: 'width', value: px } })
    .render()
    .asPng();
}

function ico(images: Buffer[]) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((image, i) => {
    const entry = 6 + 16 * i;
    const px = image.readUInt32BE(16);
    header.writeUInt8(px % 256, entry);
    header.writeUInt8(px % 256, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.length;
  });
  return Buffer.concat([header, ...images]);
}

function vector(dp: number, frame: Frame, scale: Scale, fg: string, dot = fg) {
  const paths = mark(podcst, frame, scale, 2);
  const layers =
    fg === dot
      ? [[fg, paths.glyph + paths.dot]]
      : [
          [fg, paths.glyph],
          [dot, paths.dot],
        ];
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<vector xmlns:android="http://schemas.android.com/apk/res/android"',
    `    android:width="${dp}dp"`,
    `    android:height="${dp}dp"`,
    `    android:viewportWidth="${dp}"`,
    `    android:viewportHeight="${dp}">`,
    ...layers.map(
      ([color, data]) =>
        `    <path\n        android:fillColor="${color}"\n        android:pathData="${data}" />`,
    ),
    '</vector>',
    '',
  ].join('\n');
}

const tab: Tile = {
  letter: podcst,
  scale: favicon,
  fg: paper,
  bg: ink,
  radius: 3 / 16,
};
const tabDot: Tile = { ...tab, dot: ember, radius: 7 / 32 };
const day: Tile = {
  letter: podcst,
  scale: hero,
  fg: ink,
  dot: accent,
  bg: paper,
};
const tile: Tile = { ...day, radius: 36 / 160 };
const maskable: Tile = { ...day, scale: launcher, inset: 0.1 };
const adaptive: Frame = { origin: 18, size: 72 };

const bench: Tile = {
  letter: lab,
  scale: hero,
  fg: moon,
  dot: ember,
  bg: night,
  lines: white,
};

type Appearance = 'dark' | 'tinted';

function appIcon(catalog: string, light: Tile, dark: Tile, tinted: Tile) {
  const icons: [string, Tile, Appearance[]][] = [
    ['AppIcon.png', light, []],
    ['AppIcon-Dark.png', dark, ['dark']],
    ['AppIcon-Tinted.png', tinted, ['tinted']],
  ];
  const set = `${catalog}/AppIcon.appiconset`;
  return {
    ...Object.fromEntries(
      icons.map(([name, icon]) => [`${set}/${name}`, png(icon, 1024)]),
    ),
    [`${set}/Contents.json`]: `${JSON.stringify(
      {
        images: icons.map(([filename, , appearance]) => ({
          ...(appearance.length && {
            appearances: appearance.map((value) => ({
              appearance: 'luminosity',
              value,
            })),
          }),
          filename,
          idiom: 'universal',
          platform: 'ios',
          size: '1024x1024',
        })),
        info: { author: 'xcode', version: 1 },
      },
      null,
      2,
    )}\n`,
  };
}

const res = 'android/app/src/main/res';

const files: Record<string, string | Buffer> = {
  'src/app/icon.svg': svg(tabDot),
  'src/app/favicon.ico': ico([png(tab, 16), png(tabDot, 32), png(tabDot, 48)]),
  'src/app/apple-icon.png': png(day, 180),
  'public/icons/icon.svg': svg(tile),
  'public/icons/icon-192.png': png(tile, 192),
  'public/icons/icon-512.png': png(tile, 512),
  'public/icons/maskable-192.png': png(maskable, 192),
  'public/icons/maskable-512.png': png(maskable, 512),
  ...appIcon(
    'ios/Podcst/Assets.xcassets',
    day,
    { ...day, fg: moon, dot: ember, bg: night },
    { ...day, fg: white, dot: white, bg: black },
  ),
  ...appIcon(
    'ios/AudioLab/Assets.xcassets',
    bench,
    { ...bench, bg: pitch },
    { ...bench, fg: white, dot: white, bg: black },
  ),
  'android/app/src/main/ic_launcher-playstore.png': png(day, 512),
  [`${res}/drawable/ic_launcher_foreground.xml`]: vector(
    108,
    adaptive,
    launcher,
    ink,
    accent,
  ),
  [`${res}/drawable/ic_launcher_monochrome.xml`]: vector(
    108,
    adaptive,
    launcher,
    white,
  ),
  [`${res}/drawable/ic_notification.xml`]: vector(
    24,
    { origin: 0, size: 24 },
    favicon,
    white,
  ),
  [`${res}/values/ic_launcher_background.xml`]: [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<resources>',
    `    <color name="ic_launcher_background">${paper}</color>`,
    '</resources>',
    '',
  ].join('\n'),
  [`${res}/mipmap-anydpi-v26/ic_launcher.xml`]: [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">',
    '    <background android:drawable="@color/ic_launcher_background" />',
    '    <foreground android:drawable="@drawable/ic_launcher_foreground" />',
    '    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />',
    '</adaptive-icon>',
    '',
  ].join('\n'),
};

for (const [path, content] of Object.entries(files)) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  console.log(path);
}
