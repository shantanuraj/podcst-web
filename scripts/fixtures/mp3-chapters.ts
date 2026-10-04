export function syncsafe(value: number) {
  return Buffer.from([
    (value >>> 21) & 127,
    (value >>> 14) & 127,
    (value >>> 7) & 127,
    value & 127,
  ]);
}

export function frame(version: 3 | 4, id: string, body: Buffer) {
  const size = version === 4 ? syncsafe(body.length) : Buffer.alloc(4);
  if (version === 3) size.writeUInt32BE(body.length);
  return Buffer.concat([Buffer.from(id), size, Buffer.alloc(2), body]);
}

export function chapterFrame(
  version: 3 | 4,
  id: string,
  start: number,
  title?: string,
  end = 0xffffffff,
) {
  const info = Buffer.alloc(16, 0xff);
  info.writeUInt32BE(start, 0);
  info.writeUInt32BE(end, 4);
  const text =
    title === undefined
      ? Buffer.alloc(0)
      : frame(
          version,
          'TIT2',
          version === 3
            ? Buffer.concat([
                Buffer.from([1, 0xff, 0xfe]),
                Buffer.from(title, 'utf16le'),
              ])
            : Buffer.concat([Buffer.from([3]), Buffer.from(title)]),
        );
  return frame(
    version,
    'CHAP',
    Buffer.concat([Buffer.from(`${id}\0`), info, text]),
  );
}

export function contentsFrame(
  version: 3 | 4,
  id: string,
  children: string[],
  flags = 3,
) {
  return frame(
    version,
    'CTOC',
    Buffer.concat([
      Buffer.from(`${id}\0`),
      Buffer.from([flags, children.length]),
      ...children.map((child) => Buffer.from(`${child}\0`)),
    ]),
  );
}

export function tag(version: 3 | 4, frames: Buffer[]) {
  const body = Buffer.concat(frames);
  return Buffer.concat([
    Buffer.from([0x49, 0x44, 0x33, version, 0, 0]),
    syncsafe(body.length),
    body,
  ]);
}

export function fixtureTag(version: 3 | 4) {
  return tag(version, [
    contentsFrame(version, 'toc', ['last', 'group']),
    contentsFrame(version, 'group', ['opening', 'middle'], 1),
    chapterFrame(version, 'last', 4500, 'Résumé & finish'),
    chapterFrame(version, 'opening', 0, 'Opening'),
    chapterFrame(version, 'middle', 2000, 'A synthetic topic'),
  ]);
}

export function fixtureMp3(version: 3 | 4) {
  const silence = Buffer.alloc(417);
  silence.set([0xff, 0xfb, 0x90, 0x00]);
  return Buffer.concat([
    fixtureTag(version),
    ...Array.from({ length: 320 }, () => silence),
  ]);
}

export function artworkFixtureMp3(version: 3 | 4) {
  const images = [
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAADUlEQVR4nGP4z8AARAAI/gH/xp559wAAAABJRU5ErkJggg==',
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAADUlEQVR4nGNgYPgPRAAFAgH/wSuWnwAAAABJRU5ErkJggg==',
  ].map((image) =>
    frame(
      version,
      'APIC',
      Buffer.concat([
        Buffer.from('\0image/png\0\0\0'),
        Buffer.from(image, 'base64'),
      ]),
    ),
  );
  const chapter = (
    id: string,
    start: number,
    end: number,
    title: string,
    image?: Buffer,
  ) => {
    const body = chapterFrame(version, id, start, title, end).subarray(10);
    return frame(
      version,
      'CHAP',
      Buffer.concat([body, image ?? Buffer.alloc(0)]),
    );
  };
  const silence = fixtureMp3(version).subarray(fixtureTag(version).length);
  return Buffer.concat([
    tag(version, [
      contentsFrame(version, 'toc', ['opening', 'group']),
      contentsFrame(version, 'group', ['topic', 'ending'], 1),
      chapter('opening', 0, 4000, 'Opening', images[0]),
      chapter('visual', 2000, 3500, '', images[1]),
      chapter('topic', 4000, 8000, 'No artwork'),
      chapter('ending', 8000, 12000, 'Ending', images[1]),
    ]),
    silence,
    silence,
  ]);
}

if (import.meta.main) {
  for (const version of [3, 4] as const) {
    await Bun.write(
      `contracts/fixtures/media/chapters-v2${version}.mp3`,
      fixtureMp3(version),
    );
    await Bun.write(
      `contracts/fixtures/media/chapters-artwork-v2${version}.mp3`,
      artworkFixtureMp3(version),
    );
  }
}
