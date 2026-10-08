import type postgres from 'postgres';
import { isCanonicalId } from '@/shared/canonical-id';
import { feedUrl } from '@/shared/feed-url';
import {
  type FollowResolution,
  type StateScope,
  stateValidator,
} from '@/shared/state-contract';
import { indexPrivatePodcast } from '../ingest/index-podcast';
import { readGeneration } from './generation';
import { assertStateScope, StateError } from './protocol';

export const IMPORT_DEADLINE_MS = 10_000;

export function parseFollowResolution(value: unknown) {
  if (!stateValidator('followResolutionRequest')(value)) return null;
  const { feedUrls, ...scope } = value;
  return { scope, feedUrls };
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
  ): Promise<FollowResolution> => {
    if (!parseFollowResolution({ ...scope, feedUrls: urls }))
      throw new StateError('invalid_request', 'Invalid follow resolution');
    const current = await readGeneration(sql, accountId);
    assertStateScope(accountId, current.scope.generation, scope);
    const deadline = AbortSignal.timeout(deadlineMs);
    const signal = callerSignal
      ? AbortSignal.any([callerSignal, deadline])
      : deadline;
    const items: FollowResolution['items'] = urls.map((_, index) => ({
      index,
      podcastId: null,
      status: 'unavailable',
    }));
    let next = 0;
    const worker = async () => {
      while (!signal.aborted) {
        const index = next++;
        if (index >= urls.length) return;
        try {
          const id = await resolve(
            sql,
            feedUrl(urls[index]),
            accountId,
            signal,
          );
          if (!isCanonicalId(id)) throw new Error('Invalid resolved identity');
          items[index] = { index, podcastId: id, status: 'resolved' };
        } catch {
          items[index] = { index, podcastId: null, status: 'unavailable' };
        }
      }
    };
    await Promise.all([worker(), worker()]);
    const after = await readGeneration(sql, accountId);
    assertStateScope(accountId, after.scope.generation, scope);
    const result = { ...after.scope, items };
    if (!stateValidator('followResolution')(result))
      throw new StateError('unavailable', 'State unavailable');
    return result;
  };
}
