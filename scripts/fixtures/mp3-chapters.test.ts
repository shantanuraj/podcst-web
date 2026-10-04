import { expect, test } from 'bun:test';
import { parseBuffer } from 'music-metadata';
import { artworkFixtureMp3 } from './mp3-chapters';

for (const version of [3, 4] as const) {
  test(`ID3v2.${version} artwork fixtures preserve hidden timed images`, async () => {
    const bytes = artworkFixtureMp3(version);
    expect(
      Buffer.from(
        await Bun.file(
          `contracts/fixtures/media/chapters-artwork-v2${version}.mp3`,
        ).arrayBuffer(),
      ),
    ).toEqual(bytes);
    const metadata = await parseBuffer(bytes, { mimeType: 'audio/mpeg' });
    expect(metadata.quality.warnings).toEqual([]);
    const tags = metadata.native[`ID3v2.${version}`];
    const chapters = tags
      .filter(({ id }) => id === 'CHAP')
      .map(
        ({ value }) =>
          value as {
            label: string;
            info: { startTime: number; endTime: number };
            frames: Map<string, unknown>;
          },
      );
    expect(chapters.map(({ label }) => label)).toEqual([
      'opening',
      'visual',
      'topic',
      'ending',
    ]);
    expect(chapters.filter(({ frames }) => frames.has('APIC'))).toHaveLength(3);
    expect(chapters[1].info).toMatchObject({ startTime: 2000, endTime: 3500 });
    expect(
      tags
        .filter(({ id }) => id === 'CTOC')
        .flatMap(
          ({ value }) =>
            (value as { childElementIds: string[] }).childElementIds,
        ),
    ).not.toContain('visual');
  });
}
