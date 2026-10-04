import { Parser } from 'htmlparser2';
import { chapters as rules } from '../../contracts/playback/rules.json';

export interface Chapter {
  title: string;
  start: number;
}

export interface EpisodeChapters {
  chapters: Chapter[];
  source: 'embedded' | 'shownotes' | 'none';
}

export function normalizeChapterTitle(title: string) {
  return title
    .replace(/[\p{Cc}\p{Cf}\s]+/gu, ' ')
    .trim()
    .slice(0, 300);
}

export function validTimeline(chapters: Chapter[]) {
  return (
    chapters.length >= rules.minimumCount &&
    chapters.every(
      ({ start }, index) =>
        Number.isFinite(start) &&
        start >= 0 &&
        (index === 0 || start > chapters[index - 1].start),
    )
  );
}

export function timestampSeconds(timestamp: string): number | null {
  if (!/^\d{1,2}:\d{1,2}(?::\d{2})?$/.test(timestamp)) return null;
  const parts = timestamp.split(':').map(Number);
  if (parts.slice(1).some((part) => part >= 60)) return null;
  return parts.reduce((seconds, part) => seconds * 60 + part, 0);
}

export const timestampPattern = /\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b/g;

export function showNoteChapters(html: string): Chapter[] {
  if (html.length > 1024 * 1024) return [];
  let text = '';
  let hidden = 0;
  const breaks = new Set([
    'br',
    'p',
    'li',
    'div',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
  ]);
  const parser = new Parser({
    onopentag(name) {
      if (name === 'script' || name === 'style') hidden++;
      if (!hidden && breaks.has(name)) text += '\n';
    },
    onclosetag(name) {
      if (name === 'script' || name === 'style') hidden--;
      if (!hidden && breaks.has(name)) text += '\n';
    },
    ontext(value) {
      if (!hidden) text += value;
    },
  });
  parser.end(html);
  const chapters: Chapter[] = [];
  for (const line of text.split(/[\r\n\u0085\u2028\u2029]+/)) {
    const match = line.match(
      /^\s*[\p{P}\p{S}]*\s*((?:\d{1,2}:)?\d{1,2}:\d{2})[\])]?\s+(.+?)\s*$/u,
    );
    if (!match) continue;
    const start = timestampSeconds(match[1]);
    const title = normalizeChapterTitle(
      match[2].replace(/^[\p{Pd}|]+\s+/u, ''),
    );
    if (start !== null && title) chapters.push({ title, start });
  }
  return validTimeline(chapters) ? chapters : [];
}

export function currentChapterIndex(chapters: Chapter[], position: number) {
  return Number.isFinite(position)
    ? chapters.findLastIndex(({ start }) => start <= position)
    : -1;
}

export function chapterTarget(
  chapters: Chapter[],
  position: number,
  direction: 'previous' | 'next',
): number | null {
  if (direction === 'next')
    return (
      chapters.find(
        ({ start }) => start > position + rules.nextStartEpsilonSeconds,
      )?.start ?? null
    );
  const index = currentChapterIndex(chapters, position);
  if (index < 0) return null;
  return chapters[
    index === 0 ||
    position - chapters[index].start > rules.previousRestartThresholdSeconds
      ? index
      : index - 1
  ].start;
}
