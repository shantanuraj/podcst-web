import { sameScope, validStateScope } from '@/data/progress-outbox';
import { isCanonicalId } from '@/shared/canonical-id';
import {
  type FollowAcknowledgement,
  type FollowBatch,
  type FollowChange,
  type FollowSnapshot,
  type StateScope,
  stateValidator,
} from '@/shared/state-contract';

export interface FollowOutbox {
  scope?: StateScope;
  clientId: string;
  sequence: string;
  revision: string;
  snapshot?: FollowSnapshot;
  queued: FollowChange[];
  flight?: { batch: FollowBatch; ack?: FollowAcknowledgement };
  blocked?: string;
  failures: string[];
  importFailures: string[];
  importRetryAt?: Record<string, number>;
}
export const emptyFollows = (): FollowOutbox => ({
  clientId: crypto.randomUUID(),
  sequence: '0',
  revision: '0',
  queued: [],
  failures: [],
  importFailures: [],
});
export function followProjection(state: FollowOutbox) {
  const items = new Map(
    (state.snapshot?.items ?? []).map((item) => [
      item.podcastId,
      item.availability,
    ]),
  );
  for (const change of [
    ...(state.flight?.batch.changes.filter(
      (_, i) => state.flight?.ack?.results[i].status !== 'not_found',
    ) ?? []),
    ...state.queued,
  ]) {
    if (change.followed)
      items.set(change.podcastId, items.get(change.podcastId) ?? 'available');
    else items.delete(change.podcastId);
  }
  return items;
}
export function queueFollow(
  state: FollowOutbox,
  podcastId: string,
  followed: boolean,
) {
  if (!isCanonicalId(podcastId))
    throw new Error('Canonical podcast ID required');
  state.queued = state.queued.filter((item) => item.podcastId !== podcastId);
  state.queued.push({ podcastId, followed });
  state.failures = state.failures.filter((id) => id !== podcastId);
}
export function freezeFollows(state: FollowOutbox) {
  if (!state.flight && state.scope && state.queued.length && !state.blocked) {
    const batch: FollowBatch = {
      ...state.scope,
      clientId: state.clientId,
      sequence: String(BigInt(state.sequence) + 1n),
      changes: state.queued.slice(0, 100),
    };
    if (!stateValidator('followBatch')(batch))
      throw new Error('Follow stream exhausted or invalid');
    state.sequence = batch.sequence;
    state.queued.splice(0, batch.changes.length);
    state.flight = { batch };
  }
}
export function acknowledgeFollows(state: FollowOutbox, value: unknown) {
  const batch = state.flight?.batch;
  if (
    !batch ||
    !stateValidator('followAcknowledgement')(value) ||
    !sameScope(batch, value) ||
    value.clientId !== batch.clientId ||
    value.sequence !== batch.sequence ||
    value.results.length !== batch.changes.length ||
    value.results.some(
      (item, i) => item.podcastId !== batch.changes[i].podcastId,
    )
  )
    throw new Error('Invalid follow acknowledgement');
  state.flight!.ack = value;
  state.failures = value.results
    .filter((item) => item.status === 'not_found')
    .map((item) => item.podcastId);
}
export function installFollows(
  state: FollowOutbox,
  value: unknown,
  account: string,
) {
  if (
    !stateValidator('followSnapshot')(value) ||
    value.accountId !== account ||
    (state.scope && !sameScope(state.scope, value)) ||
    BigInt(value.revision) < BigInt(state.revision) ||
    BigInt(value.revision) < BigInt(state.flight?.ack?.revision ?? '0') ||
    new Set(value.items.map((item) => item.podcastId)).size !==
      value.items.length ||
    value.items.some((item) => BigInt(item.revision) > BigInt(value.revision))
  )
    throw new Error('Invalid or stale follow snapshot');
  state.scope ??= {
    protocol: 1,
    accountId: account,
    generation: value.generation,
  };
  state.snapshot = value;
  state.revision = value.revision;
  if (state.flight?.ack) delete state.flight;
}
export function validFollows(value: unknown): value is FollowOutbox {
  const state = value as FollowOutbox;
  return (
    !!state &&
    stateValidator('uuid')(state.clientId) &&
    stateValidator('revision')(state.sequence) &&
    stateValidator('revision')(state.revision) &&
    Array.isArray(state.queued) &&
    state.queued.every(
      (item) =>
        isCanonicalId(item.podcastId) && typeof item.followed === 'boolean',
    ) &&
    Array.isArray(state.failures) &&
    Array.isArray(state.importFailures) &&
    state.importFailures.every((url) => typeof url === 'string') &&
    (state.importRetryAt === undefined ||
      (!!state.importRetryAt &&
        typeof state.importRetryAt === 'object' &&
        !Array.isArray(state.importRetryAt) &&
        Object.values(state.importRetryAt).every(
          (time) => Number.isSafeInteger(time) && time >= 0,
        ))) &&
    (!state.scope || validStateScope(state.scope)) &&
    (!state.snapshot ||
      (stateValidator('followSnapshot')(state.snapshot) &&
        !!state.scope &&
        sameScope(state.scope, state.snapshot))) &&
    (!state.flight ||
      (stateValidator('followBatch')(state.flight.batch) &&
        state.flight.batch.clientId === state.clientId &&
        state.flight.batch.sequence === state.sequence &&
        !!state.scope &&
        sameScope(state.scope, state.flight.batch) &&
        (!state.flight.ack ||
          (stateValidator('followAcknowledgement')(state.flight.ack) &&
            sameScope(state.flight.batch, state.flight.ack) &&
            state.flight.ack.clientId === state.clientId &&
            state.flight.ack.sequence === state.sequence &&
            state.flight.ack.results.length ===
              state.flight.batch.changes.length &&
            state.flight.ack.results.every(
              (item, i) =>
                item.podcastId === state.flight!.batch.changes[i].podcastId,
            )))))
  );
}
