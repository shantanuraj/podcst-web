import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import sampler from '../contracts/review/sampler.json';

const directory = new URL('../public/samples/review/v1/', import.meta.url);
const temporary = mkdtempSync(join(tmpdir(), 'podcst-sampler-'));
const run = (args: string[]) => {
  const result = Bun.spawnSync(args, { stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) throw new Error(`${args[0]} failed`);
  return result.stdout.toString().trim();
};
const duration = (file: string) =>
  Number(
    run([
      'ffprobe',
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      file,
    ]),
  );
const identity = (bytes: Buffer) => ({
  length: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
});

try {
  mkdirSync(directory, { recursive: true });
  const assets: Record<
    string,
    { length: number; sha256: string; duration?: number }
  > = {};
  for (const episode of sampler.episodes) {
    let milliseconds = 0;
    const chapters: string[] = [];
    const inputs: string[] = [];
    for (const [index, chapter] of episode.chapters.entries()) {
      const path = join(temporary, `${index}.wav`);
      run(['espeak-ng', '-v', 'en-us', '-s', '145', '-w', path, chapter.text]);
      const start = milliseconds;
      milliseconds += Math.round(duration(path) * 1000);
      chapters.push(
        `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${start}\nEND=${milliseconds}\ntitle=${chapter.title}`,
      );
      inputs.push(`file '${path}'`);
    }
    const concat = join(temporary, 'concat.txt');
    const metadata = join(temporary, 'metadata.txt');
    const output = join(temporary, 'episode.mp3');
    writeFileSync(concat, inputs.join('\n'));
    writeFileSync(
      metadata,
      `;FFMETADATA1\ntitle=${episode.title}\nartist=${sampler.author}\n${chapters.join('\n')}\n`,
    );
    run([
      'ffmpeg',
      '-y',
      '-v',
      'error',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      concat,
      '-i',
      metadata,
      '-map_metadata',
      '1',
      '-map_chapters',
      '1',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '64k',
      '-ar',
      '44100',
      '-id3v2_version',
      '3',
      output,
    ]);
    const bytes = readFileSync(output);
    writeFileSync(new URL(`${episode.key}.mp3`, directory), bytes);
    assets[episode.key] = {
      ...identity(bytes),
      duration: Math.floor(duration(output)),
    };
  }
  const cover = new Resvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200"><rect width="1200" height="1200" fill="#193e3a"/><circle cx="600" cy="490" r="300" fill="#efc477"/><path d="M480 650V330l300 160z" fill="#193e3a"/><text x="600" y="945" text-anchor="middle" font-family="Arial" font-size="110" fill="#fff8e8">A little time</text><text x="600" y="1050" text-anchor="middle" font-family="Arial" font-size="72" fill="#fff8e8">to listen</text></svg>`,
  )
    .render()
    .asPng();
  writeFileSync(new URL('cover.png', directory), cover);
  assets.cover = identity(cover);
  writeFileSync(
    new URL('../contracts/review/assets.json', import.meta.url),
    `${JSON.stringify(assets, null, 2)}\n`,
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
