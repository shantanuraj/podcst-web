import { randomUUID } from 'node:crypto';
import {
  type EpisodeChapters,
  showNoteChapters,
  validTimeline,
} from '@/shared/chapters';
import {
  type ChapterCache,
  type ChapterCacheEntry,
  chapterCacheKey,
  expiresAt,
  FAILURE_TTL_MS,
  needsRefresh,
  usableEntry,
  WORK_TIMEOUT_MS,
} from './cache';
import type { ChapterEpisode } from './episode';
import { type ChapterFetchResult, fetchChapterMetadata } from './http';

export const LOCAL_TTL_MS = 5 * 60_000;
export const MAX_LOCAL_ENTRIES = 128;
export const MAX_IN_FLIGHT = 16;

type ResolveEpisode = (
  id: string,
  userId: string | null,
) => Promise<ChapterEpisode | null>;
interface Options {
  cache: ChapterCache;
  schedule: (work: () => Promise<void>) => void;
  fetchChapters?: typeof fetchChapterMetadata;
  now?: () => number;
  deadline?: () => AbortSignal;
}

export function createChapterService(
  resolveEpisode: ResolveEpisode,
  {
    cache,
    schedule,
    fetchChapters = fetchChapterMetadata,
    now = Date.now,
    deadline = () => AbortSignal.timeout(WORK_TIMEOUT_MS),
  }: Options,
) {
  const local = new Map<
    string,
    { expires: number; entry: ChapterCacheEntry }
  >();
  const pending = new Map<string, Promise<ChapterCacheEntry | null>>();

  async function authorized(id: string, userId: string | null) {
    const episode = await resolveEpisode(id, userId);
    return episode &&
      (episode.owner_user_id === null || episode.owner_user_id === userId)
      ? episode
      : null;
  }

  function remember(key: string, entry: ChapterCacheEntry) {
    for (const [key, value] of local)
      if (value.expires <= now()) local.delete(key);
    if (!local.has(key) && local.size >= MAX_LOCAL_ENTRIES) {
      const oldest = local.keys().next().value;
      if (oldest !== undefined) local.delete(oldest);
    }
    local.set(key, {
      entry,
      expires: Math.min(now() + LOCAL_TTL_MS, expiresAt(entry)),
    });
  }

  function readLocal(key: string) {
    const saved = local.get(key);
    const entry =
      saved && saved.expires > now() ? usableEntry(saved.entry, now()) : null;
    if (!entry) local.delete(key);
    return entry;
  }

  async function readShared(key: string) {
    try {
      const entry = usableEntry(await cache.get(key), now());
      if (entry) {
        remember(key, entry);
        return entry;
      }
    } catch {}
    return readLocal(key);
  }

  async function refresh(
    episode: ChapterEpisode,
    key: string,
    known: ChapterCacheEntry | null,
    signal: AbortSignal,
  ) {
    const token = randomUUID();
    let acquired: boolean | undefined;
    try {
      try {
        acquired = await cache.acquire(key, token);
      } catch {}
      signal.throwIfAborted();
      const latest = await readShared(key);
      signal.throwIfAborted();
      const previous = latest ?? usableEntry(known, now());
      if (acquired === false || (previous && !needsRefresh(previous, now())))
        return previous;
      let result: ChapterFetchResult = { status: 'failed' };
      try {
        if (episode.file_url)
          result = await fetchChapters(
            episode.file_url,
            previous?.kind === 'embedded' ? previous.validators : undefined,
            signal,
          );
      } catch {}
      signal.throwIfAborted();
      let entry: ChapterCacheEntry;
      if (result.status === 'modified' && validTimeline(result.chapters)) {
        entry = {
          kind: 'embedded',
          checkedAt: now(),
          chapters: result.chapters,
          validators: result.validators,
        };
      } else if (result.status === 'modified' || !episode.file_url) {
        entry = { kind: 'absent', checkedAt: now() };
      } else if (previous?.kind === 'embedded') {
        entry =
          result.status === 'not-modified'
            ? {
                kind: 'embedded',
                chapters: previous.chapters,
                checkedAt: now(),
                validators: result.validators,
              }
            : { ...previous, retryAt: now() + FAILURE_TTL_MS };
      } else entry = { kind: 'failure', checkedAt: now() };
      if (acquired) {
        try {
          const stored = await cache.publish(
            key,
            token,
            entry,
            expiresAt(entry) - now(),
          );
          signal.throwIfAborted();
          if (!stored) return await readShared(key);
          remember(key, entry);
          return entry;
        } catch {
          signal.throwIfAborted();
        }
      }
      remember(key, entry);
      return entry;
    } finally {
      if (acquired !== false) {
        try {
          await cache.release(key, token);
        } catch {}
      }
    }
  }

  function begin(
    episode: ChapterEpisode,
    userId: string | null,
    key: string,
    entry: ChapterCacheEntry | null,
    background: boolean,
  ) {
    const running = pending.get(key);
    if (running) return running;
    if (pending.size >= MAX_IN_FLIGHT) return Promise.resolve(null);
    const signal = deadline();
    let finish: (entry: ChapterCacheEntry | null) => void = () => {};
    const promise = new Promise<ChapterCacheEntry | null>((resolve) => {
      finish = resolve;
    });
    const abort = () => finish(null);
    signal.addEventListener('abort', abort, { once: true });
    const completed = promise.finally(() => {
      signal.removeEventListener('abort', abort);
      if (pending.get(key) === completed) pending.delete(key);
    });
    pending.set(key, completed);
    const execute = async () => {
      try {
        signal.throwIfAborted();
        const current = background
          ? await authorized(episode.id, userId)
          : episode;
        signal.throwIfAborted();
        if (!current || chapterCacheKey(current) !== key) {
          finish(null);
          return;
        }
        const result = await refresh(current, key, entry, signal);
        signal.throwIfAborted();
        finish(result);
      } catch {
        finish(null);
      }
    };
    try {
      if (signal.aborted) abort();
      else if (background)
        schedule(() => {
          void execute();
          return completed.then(() => {});
        });
      else void execute();
    } catch {
      finish(null);
    }
    return completed;
  }

  return async (
    id: string,
    userId: string | null,
  ): Promise<EpisodeChapters | null> => {
    const episode = await authorized(id, userId);
    if (!episode) return null;
    const key = chapterCacheKey(episode);
    let entry = readLocal(key) ?? (await readShared(key));
    if (entry) {
      if (needsRefresh(entry, now()))
        void begin(episode, userId, key, entry, true);
    } else entry = await begin(episode, userId, key, null, false);
    if (entry?.kind === 'embedded' && expiresAt(entry) > now())
      return { chapters: entry.chapters, source: 'embedded' };
    const chapters = showNoteChapters(episode.summary ?? '');
    return { chapters, source: chapters.length ? 'shownotes' : 'none' };
  };
}
