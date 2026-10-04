import { createHash } from 'node:crypto';
import {
  type Chapter,
  type EpisodeChapters,
  showNoteChapters,
  validTimeline,
} from '@/shared/chapters';
import type { ChapterEpisode } from './episode';
import { fetchEmbeddedChapters } from './http';

export const CHAPTER_TTL_MS = 5 * 60_000;
export const FALLBACK_TTL_MS = 60_000;
export const MAX_CACHE_ENTRIES = 128;
export const MAX_IN_FLIGHT = 16;

type ResolveEpisode = (
  id: number,
  userId: string | null,
) => Promise<ChapterEpisode | null>;

export function createChapterService(
  resolveEpisode: ResolveEpisode,
  fetchChapters: (url: string) => Promise<Chapter[]> = fetchEmbeddedChapters,
  now = Date.now,
) {
  const cache = new Map<string, { expires: number; data: EpisodeChapters }>();
  const pending = new Map<string, Promise<EpisodeChapters>>();
  return async (
    id: number,
    userId: string | null,
  ): Promise<EpisodeChapters | null> => {
    const episode = await resolveEpisode(id, userId);
    if (
      !episode ||
      (episode.owner_user_id !== null && episode.owner_user_id !== userId)
    )
      return null;
    const key = createHash('sha256')
      .update(JSON.stringify(episode))
      .digest('hex');
    for (const [key, entry] of cache)
      if (entry.expires <= now()) cache.delete(key);
    const cached = cache.get(key);
    if (cached) return cached.data;
    const active = pending.get(key);
    if (active) return active;
    const chapters = showNoteChapters(episode.summary ?? '');
    const fallback: EpisodeChapters = {
      chapters,
      source: chapters.length ? 'shownotes' : 'none',
    };
    if (pending.size >= MAX_IN_FLIGHT) return fallback;
    const promise = Promise.resolve()
      .then(async () => {
        let embedded: Chapter[] = [];
        try {
          if (episode.file_url)
            embedded = await fetchChapters(episode.file_url);
        } catch {}
        const data: EpisodeChapters = validTimeline(embedded)
          ? { chapters: embedded, source: 'embedded' }
          : fallback;
        if (cache.size >= MAX_CACHE_ENTRIES) {
          const oldest = cache.keys().next().value;
          if (oldest !== undefined) cache.delete(oldest);
        }
        cache.set(key, {
          data,
          expires:
            now() +
            (data.source === 'embedded' ? CHAPTER_TTL_MS : FALLBACK_TTL_MS),
        });
        return data;
      })
      .finally(() => pending.delete(key));
    pending.set(key, promise);
    return promise;
  };
}
