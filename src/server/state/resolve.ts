import type postgres from 'postgres';
import { isCanonicalId } from '@/shared/canonical-id';
import { FEED_LIMITS } from '@/shared/feed-contract';
import { feedUrl } from '@/shared/feed-url';
import {
  type FollowResolution,
  type StateScope,
  stateValidator,
} from '@/shared/state-contract';
import { FeedAdmissionError } from '../ingest/feed-demand';
import { FeedUnavailableError } from '../ingest/feed-errors';
import { assertImportScope } from '../ingest/import-scope';
import {
  indexPrivatePodcast,
  PodcastAccessDenied,
  PodcastIdentityConflict,
  type PrivateImportScope,
} from '../ingest/index-podcast';
import { StateError } from './protocol';

export const IMPORT_DEADLINE_MS = FEED_LIMITS.imports.deadlineMs;

export function parseFollowResolution(value: unknown) {
  if (!stateValidator('followResolutionRequest')(value)) return null;
  const { feedUrls, ...scope } = value;
  return { scope, feedUrls };
}

function unresolved(error: unknown) {
  if (
    error instanceof FeedUnavailableError ||
    error instanceof PodcastAccessDenied ||
    error instanceof PodcastIdentityConflict
  )
    return {
      podcastId: null,
      status: 'unavailable',
      retryAfterSeconds: null,
    } as const;
  return {
    podcastId: null,
    status: 'retry',
    retryAfterSeconds:
      error instanceof FeedAdmissionError
        ? Math.min(86400, Math.max(1, error.retryAfterSeconds))
        : FEED_LIMITS.imports.retrySeconds,
  } as const;
}

export function createFollowResolver(
  sql: postgres.Sql,
  resolve = indexPrivatePodcast,
  deadlineMs = IMPORT_DEADLINE_MS,
) {
  return async (
    accountId: string,
    scope: StateScope,
    urls: string[],
    callerSignal?: AbortSignal,
    context: Omit<PrivateImportScope, 'generation'> = {},
  ): Promise<FollowResolution> => {
    if (!parseFollowResolution({ ...scope, feedUrls: urls }))
      throw new StateError('invalid_request', 'Invalid follow resolution');
    if (scope.accountId !== accountId)
      throw new StateError('account_mismatch', 'Account changed');
    const expected = { ...context, generation: scope.generation };
    await assertImportScope(sql, accountId, expected);
    const stop = new AbortController();
    const signal = AbortSignal.any([
      stop.signal,
      AbortSignal.timeout(deadlineMs),
      ...(callerSignal ? [callerSignal] : []),
    ]);
    const items: FollowResolution['items'] = urls.map((_, index) => ({
      index,
      podcastId: null,
      status: 'retry',
      retryAfterSeconds: FEED_LIMITS.imports.retrySeconds,
    }));
    const resolving = new Map<string, Promise<string>>();
    let next = 0;
    let fatal: StateError | undefined;
    const worker = async () => {
      while (!signal.aborted) {
        const index = next++;
        if (index >= urls.length) return;
        try {
          let url: string;
          try {
            url = feedUrl(urls[index]);
          } catch {
            throw new FeedUnavailableError('Invalid feed URL');
          }
          let pending = resolving.get(url);
          if (!pending) {
            pending = resolve(sql, url, accountId, signal, expected);
            resolving.set(url, pending);
          }
          const id = await pending;
          if (!isCanonicalId(id)) throw new Error('Invalid resolved identity');
          items[index] = {
            index,
            podcastId: id,
            status: 'resolved',
            retryAfterSeconds: null,
          };
        } catch (error) {
          if (
            error instanceof StateError &&
            [
              'unauthenticated',
              'account_mismatch',
              'recovery_required',
            ].includes(error.code)
          ) {
            fatal ??= error;
            stop.abort();
          } else items[index] = { index, ...unresolved(error) };
        }
      }
    };
    await Promise.all(
      Array.from({ length: FEED_LIMITS.imports.workers }, worker),
    );
    if (fatal) throw fatal;
    const after = await assertImportScope(sql, accountId, expected);
    const result = { ...after, items };
    if (!stateValidator('followResolution')(result))
      throw new StateError('unavailable', 'State unavailable');
    return result;
  };
}
