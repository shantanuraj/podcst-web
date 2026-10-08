import { migrateStoredId } from '@/shared/canonical-id';
import type { LegacyListBatch } from '@/shared/lists';
import { convertStoredEpisode } from '@/shared/player/persisted-session';
import { stateValidator } from '@/shared/state-contract';
import { emptyScope, type StarRoot, type StarScope } from './state';

export function convertStars(source: unknown): StarRoot {
  if (!source || typeof source !== 'object' || Array.isArray(source))
    throw new Error('Unreadable Starred source');
  const result: StarRoot = {};
  for (const [key, value] of Object.entries(source)) {
    const old = value as {
      clientId: string;
      sequence: string;
      listId?: string;
      blocked?: number;
      queued: { episodeId: unknown; op: 'add' | 'remove'; at: number }[];
      episodes: Record<string, unknown>;
      flight?: { batch: LegacyListBatch; ack?: unknown };
    };
    if (
      !old ||
      !stateValidator('uuid')(old.clientId) ||
      !stateValidator('revision')(old.sequence) ||
      !Array.isArray(old.queued) ||
      !old.episodes
    )
      throw new Error('Unreadable Starred scope');
    const state: StarScope & { unresolved: unknown[] } = {
      ...emptyScope(),
      clientId: old.clientId,
      sequence: old.sequence,
      listId: old.listId,
      unresolved: [],
    };
    result[key] = state;
    for (const action of old.queued) {
      const id = migrateStoredId(action.episodeId);
      if (
        'canonicalId' in id &&
        ['add', 'remove'].includes(action.op) &&
        Number.isSafeInteger(action.at)
      )
        state.queued.push({ ...action, episodeId: id.canonicalId });
      else state.unresolved.push(action);
    }
    for (const episode of Object.values(old.episodes)) {
      const converted = convertStoredEpisode(episode);
      if (converted.id) state.episodes[converted.id] = converted;
      else state.unresolved.push(episode);
    }
    if (old.flight) {
      const batch = old.flight.batch as LegacyListBatch;
      const safe =
        batch &&
        batch.clientId === state.clientId &&
        batch.sequence === state.sequence &&
        stateValidator('id')(batch.sequence) &&
        Array.isArray(batch.changes) &&
        batch.changes.length > 0 &&
        batch.changes.length <= 100 &&
        batch.changes.every(
          (item) =>
            Number.isSafeInteger(item.episodeId) &&
            item.episodeId > 0 &&
            ['add', 'remove'].includes(item.op),
        );
      if (safe) state.legacy = { batch, ack: old.flight.ack };
      else {
        state.blocked = 409;
        state.unresolved.push(old.flight);
      }
    }
    if (old.blocked) state.blocked = old.blocked;
  }
  return result;
}
