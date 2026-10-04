import { parseBuffer } from 'music-metadata';
import {
  type Chapter,
  normalizeChapterTitle,
  validTimeline,
} from '@/shared/chapters';

export const MAX_TAG_BYTES = 512 * 1024;
export const MAX_CHAPTERS = 1000;

export function id3TagSize(header: Uint8Array): number | null {
  if (header.length < 10) throw new Error('Truncated metadata');
  if (Buffer.from(header.subarray(0, 3)).toString('ascii') !== 'ID3')
    return null;
  if (
    ![3, 4].includes(header[3]) ||
    header[4] !== 0 ||
    header[5] & (header[3] === 4 ? 0xef : 0xff)
  )
    throw new Error('Unsupported metadata');
  if (header.subarray(6, 10).some((byte) => byte & 0x80))
    throw new Error('Invalid metadata size');
  const size =
    header.subarray(6, 10).reduce((value, byte) => value * 128 + byte, 0) + 10;
  if (size > MAX_TAG_BYTES) throw new Error('Metadata too large');
  return size;
}

interface ChapterFrame {
  label: string;
  info: { startTime: number; endTime: number };
  frames: Map<string, unknown>;
}

interface ContentsFrame {
  label: string;
  flags: { topLevel: boolean };
  childElementIds: string[];
}

function boundedFrames(
  buffer: Buffer,
  version: number,
  nested = false,
): number {
  let offset = 0;
  let count = 0;
  while (offset < buffer.length) {
    if (
      buffer[offset] === 0 &&
      buffer.subarray(offset).every((byte) => byte === 0)
    )
      break;
    if (++count > 4096 || offset + 10 > buffer.length)
      throw new Error('Invalid frames');
    const id = buffer.toString('ascii', offset, offset + 4);
    const sizeBytes = buffer.subarray(offset + 4, offset + 8);
    if (
      !/^[A-Z0-9]{4}$/.test(id) ||
      (version === 4 && sizeBytes.some((byte) => byte & 0x80)) ||
      buffer[offset + 9] !== 0
    )
      throw new Error('Unsupported frame');
    const size =
      version === 4
        ? sizeBytes.reduce((value, byte) => value * 128 + byte, 0)
        : sizeBytes.readUInt32BE();
    const end = offset + 10 + size;
    if (end > buffer.length) throw new Error('Truncated frame');
    if (id === 'CHAP' || id === 'CTOC') {
      if (nested) throw new Error('Nested chapter frame');
      const body = buffer.subarray(offset + 10, end);
      let cursor = body.indexOf(0) + 1;
      if (!cursor) throw new Error('Unterminated frame');
      if (id === 'CHAP') cursor += 16;
      else {
        const children = body[cursor + 1];
        cursor += 2;
        for (let index = 0; index < children; index++) {
          const terminator = body.indexOf(0, cursor);
          if (terminator < 0) throw new Error('Unterminated contents');
          cursor = terminator + 1;
        }
      }
      if (cursor > body.length) throw new Error('Truncated chapter');
      boundedFrames(body.subarray(cursor), version, true);
    }
    offset = end;
  }
  return offset;
}

export async function parseMp3Chapters(buffer: Buffer): Promise<Chapter[]> {
  try {
    if (id3TagSize(buffer.subarray(0, 10)) !== buffer.length) return [];
    const size = boundedFrames(buffer.subarray(10), buffer[3]);
    const bounded = Buffer.from(buffer.subarray(0, size + 10));
    for (let index = 0; index < 4; index++)
      bounded[9 - index] = (size >>> (index * 7)) & 127;
    const metadata = await parseBuffer(
      bounded,
      { mimeType: 'audio/mpeg' },
      {
        duration: false,
        skipCovers: true,
        skipPostHeaders: true,
      },
    );
    if (metadata.quality.warnings.length) return [];
    const tags = metadata.native[`ID3v2.${buffer[3]}`] ?? [];
    const frames = new Map<string, ChapterFrame>();
    const contents = new Map<string, ContentsFrame>();
    for (const tag of tags) {
      if (tag.id === 'CHAP') {
        const frame = tag.value as ChapterFrame;
        if (!frames.has(frame.label)) frames.set(frame.label, frame);
      } else if (tag.id === 'CTOC') {
        const frame = tag.value as ContentsFrame;
        if (!contents.has(frame.label)) contents.set(frame.label, frame);
      }
    }
    if (frames.size > MAX_CHAPTERS) return [];
    const ordered: ChapterFrame[] = [];
    const visited = new Set<string>();
    const pending = [...contents.values()]
      .filter((toc) => toc.flags.topLevel)
      .map((toc) => toc.label);
    pending.push(...frames.keys());
    while (pending.length) {
      const id = pending.shift();
      if (id === undefined || visited.has(id)) continue;
      visited.add(id);
      const frame = frames.get(id);
      if (frame) ordered.push(frame);
      else pending.unshift(...(contents.get(id)?.childElementIds ?? []));
    }
    const chapters: Chapter[] = [];
    for (const frame of ordered) {
      const { startTime, endTime } = frame.info;
      if (
        !Number.isInteger(startTime) ||
        startTime < 0 ||
        startTime >= 0xffffffff ||
        (endTime !== 0xffffffff && endTime < startTime)
      )
        continue;
      const raw = frame.frames.get('TIT2');
      const title =
        typeof raw === 'string'
          ? raw
          : Array.isArray(raw)
            ? (raw.find((value) => typeof value === 'string') ?? '')
            : '';
      chapters.push({
        start: startTime / 1000,
        title: normalizeChapterTitle(title),
      });
    }
    chapters.sort((a, b) => a.start - b.start);
    const unique = chapters.filter(
      (chapter, index) =>
        index === 0 || chapter.start !== chapters[index - 1].start,
    );
    return validTimeline(unique) ? unique : [];
  } catch {
    return [];
  }
}
