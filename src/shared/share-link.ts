import { maxSeconds, origin } from '../../contracts/sharing/links.json';
import { isCanonicalId } from './canonical-id';

export type Moment =
  | { kind: 'time'; start: number }
  | { kind: 'clip'; start: number; end: number }
  | { kind: 'chapter'; chapter: number; start: number; end: number };

export interface ShareTarget {
  podcastId: string;
  episodeId?: string;
  moment?: Moment;
}

export interface SharedLink {
  podcastId: string;
  episodeId: string | null;
  moment: Moment | null;
  invalidMoment: boolean;
}

const hosts = new Set(['podcst.app', 'www.podcst.app']);
const timePattern = /^(?:(\d{1,7})h)?(?:(\d{1,7})m)?(?:(\d{1,7})s)?$/;
const chapterPattern = /^[1-9]\d{0,3}$/;

const pad = (value: number) => String(value).padStart(2, '0');

export function formatShareTime(seconds: number): string {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}h${pad(m)}m${pad(s)}s`;
  if (m) return `${m}m${pad(s)}s`;
  return `${s}s`;
}

export function parseShareTime(token: string): number | null {
  const match = timePattern.exec(token);
  if (!match || token === '') return null;
  const [h, m, s] = match
    .slice(1)
    .map((part) => (part === undefined ? undefined : Number(part)));
  if (h !== undefined && m !== undefined && m >= 60) return null;
  if ((h !== undefined || m !== undefined) && s !== undefined && s >= 60)
    return null;
  const total = (h ?? 0) * 3600 + (m ?? 0) * 60 + (s ?? 0);
  return total <= maxSeconds ? total : null;
}

const second = (value: number) =>
  Number.isFinite(value) && value >= 0 && value <= maxSeconds
    ? Math.floor(value)
    : null;

function momentQuery(moment: Moment): string | null {
  const start = second(moment.start);
  if (start === null) return null;
  if (moment.kind === 'time') return `t=${formatShareTime(start)}`;
  const end = second(moment.end);
  if (end === null || end <= start) return null;
  const range = `t=${formatShareTime(start)}-${formatShareTime(end)}`;
  if (moment.kind === 'clip') return range;
  return Number.isInteger(moment.chapter) &&
    chapterPattern.test(String(moment.chapter))
    ? `ch=${moment.chapter}&${range}`
    : null;
}

export function shareUrl({
  podcastId,
  episodeId,
  moment,
}: ShareTarget): string | null {
  if (!isCanonicalId(podcastId)) return null;
  if (episodeId === undefined)
    return moment ? null : `${origin}/episodes/${podcastId}`;
  if (!isCanonicalId(episodeId)) return null;
  const path = `${origin}/episodes/${podcastId}/${episodeId}`;
  if (!moment) return path;
  const query = momentQuery(moment);
  return query && `${path}?${query}`;
}

export function parseMoment(
  times: readonly string[],
  chapters: readonly string[],
): Moment | null {
  if (times.length !== 1 || chapters.length > 1) return null;
  const range = times[0].split('-');
  if (range.length > 2) return null;
  const [start, end] = range.map(parseShareTime);
  if (start === null) return null;
  if (range.length === 1)
    return chapters.length ? null : { kind: 'time', start };
  if (end === null || end <= start) return null;
  if (!chapters.length) return { kind: 'clip', start, end };
  return chapterPattern.test(chapters[0])
    ? { kind: 'chapter', chapter: Number(chapters[0]), start, end }
    : null;
}

export function parseShareUrl(value: string): SharedLink | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== 'https:' ||
    !hosts.has(url.hostname) ||
    url.port ||
    url.username ||
    url.password
  )
    return null;
  const [root, podcastId, episodeId, ...rest] = url.pathname
    .split('/')
    .slice(1);
  if (
    root !== 'episodes' ||
    rest.length ||
    !isCanonicalId(podcastId) ||
    (episodeId !== undefined && !isCanonicalId(episodeId))
  )
    return null;
  const times = url.searchParams.getAll('t');
  const chapters = url.searchParams.getAll('ch');
  const requested = times.length > 0 || chapters.length > 0;
  const moment =
    requested && episodeId !== undefined ? parseMoment(times, chapters) : null;
  return {
    podcastId,
    episodeId: episodeId ?? null,
    moment,
    invalidMoment: requested && !moment,
  };
}
