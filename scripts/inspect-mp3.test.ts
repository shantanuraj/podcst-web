import { afterAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  chapterFrame,
  contentsFrame,
  fixtureMp3,
  fixtureTag,
  frame,
  tag,
} from './fixtures/mp3-chapters';
import { inspectMp3, serializeTags } from './inspect-mp3';

const directory = await mkdtemp(join(tmpdir(), 'inspect-mp3-test-'));
const artwork = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==',
  'base64',
);
const sha256 = createHash('sha256').update(artwork).digest('hex');
const audio = fixtureMp3(3).subarray(fixtureTag(3).length);

function media(version: 3 | 4) {
  const picture = frame(
    version,
    'APIC',
    Buffer.concat([Buffer.from('\0image/png\0\x03cover\0'), artwork]),
  );
  const info = Buffer.alloc(16, 0xff);
  info.writeUInt32BE(1000, 0);
  info.writeUInt32BE(2000, 4);
  const id3v1 = Buffer.alloc(128);
  id3v1.write('TAG');
  id3v1.write('Trailing title', 3);
  return Buffer.concat([
    tag(version, [
      picture,
      contentsFrame(version, 'toc', ['opening', 'illustrated']),
      chapterFrame(version, 'opening', 0, 'Opening'),
      frame(
        version,
        'CHAP',
        Buffer.concat([
          Buffer.from('illustrated\0'),
          info,
          frame(version, 'TIT2', Buffer.from('\0Illustrated chapter')),
          frame(
            version,
            'WXXX',
            Buffer.from('\0chapter url\0https://example.com/chapter'),
          ),
          picture,
        ]),
      ),
    ]),
    audio,
    id3v1,
  ]);
}

const bytes = media(3);
const file = join(directory, 'episode.mp3');
await Bun.write(file, bytes);

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/audio.mp3')
      return new Response(bytes, {
        headers: {
          'Content-Type': 'audio/mpeg',
          'Content-Length': String(bytes.length),
          ETag: '"fixture"',
        },
      });
    if (url.pathname === '/redirect')
      return Response.redirect(new URL('/audio.mp3', url), 302);
    if (url.pathname === '/loop')
      return Response.redirect(new URL('/loop', url), 302);
    if (url.pathname === '/unsafe')
      return new Response(null, {
        status: 302,
        headers: { Location: 'file:///tmp/audio.mp3' },
      });
    if (url.pathname === '/partial')
      return new Response(bytes, { status: 206 });
    if (url.pathname === '/stream')
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(bytes.subarray(0, 16));
            controller.enqueue(bytes.subarray(16));
            controller.close();
          },
        }),
      );
    if (url.pathname === '/slow')
      return new Promise((resolve) => {
        setTimeout(() => resolve(new Response(bytes)), 100);
      });
    if (url.pathname === '/episodes/1391/565896')
      return new Response(
        `<script type="application/ld+json">not json</script>
         <script type="application/ld+json">{"@type":"WebSite"}</script>
         <script type="application/ld+json">${JSON.stringify({
           '@type': 'PodcastEpisode',
           name: 'Fixture episode',
           associatedMedia: { contentUrl: '/redirect' },
         })}</script>`,
      );
    if (url.pathname === '/episodes/1/2')
      return new Response('<html>Not an episode</html>');
    return new Response('Missing', { status: 404 });
  },
});
const baseUrl = server.url.origin;

afterAll(async () => {
  server.stop(true);
  await rm(directory, { recursive: true, force: true });
});

for (const version of [3, 4] as const) {
  test(`preserves ID3v2.${version} chapter links, artwork, CTOC and trailing tags`, async () => {
    const path = join(directory, `v${version}.mp3`);
    await Bun.write(path, media(version));
    const report = await inspectMp3(path);
    expect(report.leadingId3v2?.version).toBe(`2.${version}.0`);
    expect(report.source.bytes).toBe(media(version).length);
    expect(report.format.tagTypes).toEqual([`ID3v2.${version}`, 'ID3v1']);
    expect(report.format.duration).toBeGreaterThan(0);
    expect(report.quality.warnings).toEqual([]);
    const native = report.native[`ID3v2.${version}`];
    const toc = native.find(({ id }) => id === 'CTOC');
    const chapter = native.filter(({ id }) => id === 'CHAP')[1];
    expect(serializeTags(toc?.value)).toMatchObject({
      label: 'toc',
      flags: { topLevel: true, ordered: true },
      childElementIds: ['opening', 'illustrated'],
    });
    expect(serializeTags(chapter.value)).toMatchObject({
      label: 'illustrated',
      info: { startTime: 1000, endTime: 2000 },
      frames: {
        TIT2: 'Illustrated chapter',
        WXXX: { url: 'https://example.com/chapter' },
        APIC: {
          format: 'image/png',
          type: 'Cover (front)',
          description: 'cover',
          data: { byteLength: artwork.length, sha256 },
        },
      },
    });
    expect(
      serializeTags(native.find(({ id }) => id === 'APIC')?.value),
    ).toMatchObject({
      data: { byteLength: artwork.length, sha256 },
    });
    expect(report.native.ID3v1).toContainEqual({
      id: 'title',
      value: 'Trailing title',
    });
  });
}

test('serializes nested Maps and binary values without losing their contents', () => {
  const value = new Map([['APIC', { data: artwork }]]);
  expect(serializeTags(value)).toEqual({
    APIC: { data: { byteLength: artwork.length, sha256 } },
  });
  expect(serializeTags(value, true)).toEqual({
    APIC: {
      data: {
        byteLength: artwork.length,
        sha256,
        base64: artwork.toString('base64'),
      },
    },
  });
  expect(serializeTags([1n, new Date('2026-01-01T00:00:00Z')])).toEqual([
    '1',
    '2026-01-01T00:00:00.000Z',
  ]);
});

test('includes linked artwork URLs without fetching them', () => {
  const url = 'https://example.com/chapter.png';
  expect(
    serializeTags({ format: '-->', data: Buffer.from(`${url}\0`) }),
  ).toMatchObject({ format: '-->', url });
});

test('inspects tags larger than the production chapter limit', async () => {
  const path = join(directory, 'large-tag.mp3');
  await Bun.write(
    path,
    Buffer.concat([
      tag(3, [
        frame(
          3,
          'APIC',
          Buffer.concat([
            Buffer.from('\0image/png\0\x03\0'),
            artwork,
            Buffer.alloc(600 * 1024),
          ]),
        ),
      ]),
      audio,
    ]),
  );
  const report = await inspectMp3(path);
  expect(report.leadingId3v2?.totalBytes).toBeGreaterThan(512 * 1024);
  expect(report.common.picture?.[0].data.byteLength).toBe(
    artwork.length + 600 * 1024,
  );
});

test('reads file URLs and MP3s without a leading ID3 tag', async () => {
  expect((await inspectMp3(pathToFileURL(file).href)).source.path).toBe(file);
  const path = join(directory, 'untagged.mp3');
  await Bun.write(path, audio);
  const report = await inspectMp3(path);
  expect(report.leadingId3v2).toBeNull();
  expect(report.format.tagTypes).toEqual([]);
});

test('reports direct URL redirects and decodes the complete download', async () => {
  const report = await inspectMp3(`${baseUrl}/redirect`);
  expect(report.source.http).toMatchObject({
    finalUrl: `${baseUrl}/audio.mp3`,
    redirects: [
      {
        url: `${baseUrl}/redirect`,
        status: 302,
        location: `${baseUrl}/audio.mp3`,
      },
    ],
    headers: { etag: '"fixture"' },
  });
  expect(report.source.path).toBeUndefined();
  expect(report.native).toEqual((await inspectMp3(file)).native);
});

test.each([
  '1391/565896',
  `${baseUrl}/episodes/1391/565896`,
])('resolves a public episode enclosure from %s', async (input) => {
  const report = await inspectMp3(input, { baseUrl });
  expect(report.source.episode).toMatchObject({
    title: 'Fixture episode',
    finalUrl: `${baseUrl}/episodes/1391/565896`,
  });
  expect(report.source.http?.finalUrl).toBe(`${baseUrl}/audio.mp3`);
  expect(report.native).toEqual((await inspectMp3(file)).native);
});

describe('failures', () => {
  test('rejects absent files, directories and truncated ID3 tags', async () => {
    await expect(inspectMp3(join(directory, 'missing.mp3'))).rejects.toThrow();
    await expect(inspectMp3(directory)).rejects.toThrow('regular file');
    const path = join(directory, 'truncated.mp3');
    await Bun.write(path, bytes.subarray(0, 10));
    await expect(inspectMp3(path)).rejects.toThrow('beyond the end');
  });

  test('rejects missing enclosures, bad statuses, unsafe redirects and loops', async () => {
    await expect(inspectMp3('1/2', { baseUrl })).rejects.toThrow(
      'No public PodcastEpisode',
    );
    await expect(inspectMp3(`${baseUrl}/missing`)).rejects.toThrow('HTTP 404');
    await expect(inspectMp3(`${baseUrl}/partial`)).rejects.toThrow('HTTP 206');
    await expect(inspectMp3(`${baseUrl}/unsafe`)).rejects.toThrow(
      'Only HTTP(S)',
    );
    await expect(inspectMp3(`${baseUrl}/loop`)).rejects.toThrow(
      '10 HTTP redirects',
    );
  });

  test('bounds both declared and streaming downloads and cleans temporary files', async () => {
    const temporaryFiles = async () =>
      (await readdir(tmpdir()))
        .filter((name) => name.startsWith('podcst-inspect-mp3-'))
        .sort();
    const before = await temporaryFiles();
    for (const path of ['audio.mp3', 'stream'])
      await expect(
        inspectMp3(`${baseUrl}/${path}`, { maxBytes: 32 }),
      ).rejects.toThrow('exceeds 32');
    await expect(
      inspectMp3(`${baseUrl}/slow`, { timeoutMs: 10 }),
    ).rejects.toThrow();
    expect(await temporaryFiles()).toEqual(before);
  });

  test.each([
    0,
    -1,
    Number.NaN,
    1.5,
  ])('rejects invalid limits: %s', async (value) => {
    await expect(inspectMp3(file, { maxBytes: value })).rejects.toThrow(
      'positive safe integer',
    );
    await expect(inspectMp3(file, { timeoutMs: value })).rejects.toThrow(
      'positive safe integer',
    );
  });
});

test('CLI emits JSON, supports help and rejects invalid arguments', async () => {
  const run = async (...args: string[]) => {
    const child = Bun.spawn(
      [process.execPath, 'scripts/inspect-mp3.ts', ...args],
      {
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { code, stdout, stderr };
  };
  const result = await run('--binary', file);
  expect(result.code).toBe(0);
  expect(result.stderr).toBe('');
  const report = JSON.parse(result.stdout);
  expect(report.common.picture[0].data.base64).toBe(artwork.toString('base64'));
  expect((await run('--help')).stdout).toContain('podcast_id/episode_id');
  for (const args of [
    [],
    [file, file],
    ['--unknown'],
    ['--timeout', 'bad', file],
  ]) {
    const invalid = await run(...args);
    expect(invalid.code).toBe(1);
    expect(invalid.stdout).toBe('');
    expect(invalid.stderr).not.toBe('');
  }
});
