import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  chapterFrame,
  contentsFrame,
  fixtureMp3,
  fixtureTag,
  frame,
  syncsafe,
  tag,
} from '../../../scripts/fixtures/mp3-chapters';
import { id3TagSize, MAX_TAG_BYTES, parseMp3Chapters } from './mp3';

for (const version of [3, 4] as const) {
  test(`ID3v2.${version} titles and nested CTOC yield a flat source-time timeline`, async () => {
    expect(await parseMp3Chapters(fixtureTag(version))).toEqual([
      { title: 'Opening', start: 0 },
      { title: 'A synthetic topic', start: 2 },
      { title: 'Résumé & finish', start: 4.5 },
    ]);
    expect(
      readFileSync(`contracts/fixtures/media/chapters-v2${version}.mp3`),
    ).toEqual(fixtureMp3(version));
  });

  test(`ID3v2.${version} missing titles, invalid starts, duplicate starts and cyclic CTOC`, async () => {
    const bytes = tag(version, [
      contentsFrame(version, 'toc', ['toc', 'b', 'missing']),
      chapterFrame(version, 'a', 0),
      chapterFrame(version, 'b', 1000, '  Topic\n  two  '),
      chapterFrame(version, 'duplicate', 1000, 'Ignored'),
      chapterFrame(version, 'unknown', 0xffffffff, 'Invalid'),
      chapterFrame(version, 'backwards', 3000, 'Invalid', 2000),
    ]);
    expect(await parseMp3Chapters(bytes)).toEqual([
      { title: '', start: 0 },
      { title: 'Topic two', start: 1 },
    ]);
  });

  test(`ID3v2.${version} accepts padding but rejects overflowing frames and nested chapters`, async () => {
    expect(
      await parseMp3Chapters(
        tag(version, [fixtureTag(version).subarray(10), Buffer.alloc(123)]),
      ),
    ).toHaveLength(3);
    const overflow = fixtureTag(version);
    overflow.fill(0x7f, 14, 18);
    expect(await parseMp3Chapters(overflow)).toEqual([]);
    const nested = chapterFrame(version, 'outer', 0);
    const body = Buffer.concat([
      nested.subarray(10),
      chapterFrame(version, 'inner', 0),
    ]);
    expect(
      await parseMp3Chapters(tag(version, [frame(version, 'CHAP', body)])),
    ).toEqual([]);
  });

  test(`ID3v2.${version} decodes Latin-1 and multi-byte frame sizes with bounded titles`, async () => {
    const latin = frame(
      version,
      'CHAP',
      Buffer.concat([
        chapterFrame(version, 'latin', 1500).subarray(10),
        frame(
          version,
          'TIT2',
          Buffer.concat([Buffer.from([0]), Buffer.from('Café', 'latin1')]),
        ),
      ]),
    );
    expect(
      await parseMp3Chapters(
        tag(version, [
          chapterFrame(version, 'long', 0, 'x'.repeat(400)),
          latin,
        ]),
      ),
    ).toEqual([
      { title: 'x'.repeat(300), start: 0 },
      { title: 'Café', start: 1.5 },
    ]);
  });

  test(`ID3v2.${version} absent, single and truncated chapters`, async () => {
    expect(await parseMp3Chapters(tag(version, []))).toEqual([]);
    expect(
      await parseMp3Chapters(tag(version, [chapterFrame(version, 'one', 0)])),
    ).toEqual([]);
    expect(await parseMp3Chapters(fixtureTag(version).subarray(0, -1))).toEqual(
      [],
    );
    expect(
      await parseMp3Chapters(
        tag(version, [frame(version, 'CHAP', Buffer.from('broken'))]),
      ),
    ).toEqual([]);
  });
}

test('rejects oversized, unsupported and invalid tag headers', () => {
  expect(id3TagSize(Buffer.alloc(10))).toBeNull();
  expect(() => id3TagSize(Buffer.alloc(9))).toThrow();
  const oversized = Buffer.concat([
    Buffer.from('ID3\x04\0\0'),
    syncsafe(MAX_TAG_BYTES),
  ]);
  expect(() => id3TagSize(oversized)).toThrow();
  for (const index of [3, 4, 5, 6]) {
    const bytes = fixtureTag(4);
    bytes[index] = 0xff;
    expect(() => id3TagSize(bytes)).toThrow();
  }
});
