import { isCanonicalId } from '@/shared/canonical-id';
import {
  type ProgressEvent,
  progressIntent,
} from '@/shared/player/progress-intent';
import {
  type ProgressAcknowledgement,
  type ProgressBatch,
  type ProgressChange,
  type StateScope,
  stateValidator,
} from '@/shared/state-contract';

export interface ProgressPosition extends Omit<ProgressChange, 'completed'> {
  completed: boolean;
}

export interface ProgressOutbox {
  scope?: StateScope;
  clientId: string;
  sequence: string;
  revision: string;
  saved: Record<string, ProgressPosition>;
  queued: ProgressChange[];
  flight?: { batch: ProgressBatch; ack?: ProgressAcknowledgement };
  blocked?: string;
  failures: string[];
}
export const emptyProgress = (): ProgressOutbox => ({
  clientId: crypto.randomUUID(),
  sequence: '0',
  revision: '0',
  saved: {},
  queued: [],
  failures: [],
});
export function progressProjection(state: ProgressOutbox) {
  const rows = new Map(Object.entries(state.saved));
  for (const change of [
    ...(state.flight?.batch.changes.filter(
      (_, i) => state.flight?.ack?.results[i].status !== 'not_found',
    ) ?? []),
    ...state.queued,
  ])
    rows.set(change.episodeId, {
      ...change,
      completed:
        change.completed ?? rows.get(change.episodeId)?.completed ?? false,
    });
  return rows;
}
export function queueProgress(
  state: ProgressOutbox,
  episodeId: string,
  event: ProgressEvent,
  position: number,
) {
  if (!isCanonicalId(episodeId))
    throw new Error('Canonical episode ID required');
  const change: ProgressChange = {
    episodeId,
    ...progressIntent(event, position),
  };
  state.queued = state.queued.filter(
    (item) =>
      item.episodeId !== episodeId ||
      (change.completed === null && item.completed !== null),
  );
  state.queued.push(change);
  state.failures = state.failures.filter((id) => id !== episodeId);
}
export function freezeProgress(state: ProgressOutbox) {
  if (!state.flight && state.scope && state.queued.length && !state.blocked) {
    const batch: ProgressBatch = {
      ...state.scope,
      clientId: state.clientId,
      sequence: String(BigInt(state.sequence) + 1n),
      changes: state.queued.slice(0, 100),
    };
    if (!stateValidator('progressBatch')(batch))
      throw new Error('Progress stream exhausted or invalid');
    state.sequence = batch.sequence;
    state.queued.splice(0, batch.changes.length);
    state.flight = { batch };
  }
}
export function acknowledgeProgress(state: ProgressOutbox, value: unknown) {
  const batch = state.flight?.batch;
  if (
    !batch ||
    !stateValidator('progressAcknowledgement')(value) ||
    !sameScope(batch, value) ||
    value.clientId !== batch.clientId ||
    value.sequence !== batch.sequence ||
    value.results.length !== batch.changes.length ||
    value.results.some(
      (item, i) => item.episodeId !== batch.changes[i].episodeId,
    )
  )
    throw new Error('Invalid progress acknowledgement');
  state.flight!.ack = value;
  state.failures = value.results
    .filter((item) => item.status === 'not_found')
    .map((item) => item.episodeId);
}
export function sameScope(a: StateScope, b: StateScope) {
  return (
    a.protocol === b.protocol &&
    a.accountId === b.accountId &&
    a.generation === b.generation
  );
}
export function installProgress(
  state: ProgressOutbox,
  value: unknown,
  account: string,
  requested?: string[],
  retire = true,
) {
  if (
    !stateValidator('progressSnapshot')(value) ||
    value.accountId !== account ||
    (state.scope && !sameScope(state.scope, value)) ||
    BigInt(value.revision) < BigInt(state.revision) ||
    BigInt(value.revision) < BigInt(state.flight?.ack?.revision ?? '0') ||
    new Set(value.items.map((item) => item.episodeId)).size !==
      value.items.length ||
    value.items.some(
      (item) =>
        item.progress &&
        BigInt(item.progress.revision) > BigInt(value.revision),
    ) ||
    (requested &&
      (requested.length !== value.items.length ||
        value.items.some((item) => !requested.includes(item.episodeId))))
  )
    throw new Error('Invalid or stale progress snapshot');
  state.scope ??= {
    protocol: 1,
    accountId: account,
    generation: value.generation,
  };
  state.revision = value.revision;
  for (const item of value.items) {
    if (item.progress)
      state.saved[item.episodeId] = {
        episodeId: item.episodeId,
        positionSeconds: item.progress.positionSeconds,
        completed: item.progress.completed,
      };
    else
      state.saved[item.episodeId] = {
        episodeId: item.episodeId,
        positionSeconds: 0,
        completed: false,
      };
  }
  if (
    retire &&
    state.flight?.ack &&
    requested &&
    state.flight.batch.changes.every((item) =>
      requested.includes(item.episodeId),
    )
  )
    delete state.flight;
}
export function validStateScope(value: StateScope) {
  return (
    !!value &&
    value.protocol === 1 &&
    typeof value.accountId === 'string' &&
    value.accountId.length > 0 &&
    value.accountId.length <= 128 &&
    stateValidator('uuid')(value.generation)
  );
}
export function validProgress(value: unknown): value is ProgressOutbox {
  const state = value as ProgressOutbox;
  if (
    !state ||
    !stateValidator('uuid')(state.clientId) ||
    !stateValidator('revision')(state.sequence) ||
    !stateValidator('revision')(state.revision) ||
    !Array.isArray(state.queued) ||
    !Array.isArray(state.failures) ||
    !state.saved ||
    typeof state.saved !== 'object'
  )
    return false;
  const changeValid = (change: ProgressChange) =>
    !!change &&
    isCanonicalId(change.episodeId) &&
    Number.isInteger(change.positionSeconds) &&
    change.positionSeconds >= 0 &&
    change.positionSeconds <= 2147483647 &&
    (change.completed === null || typeof change.completed === 'boolean');
  return (
    (!state.scope || validStateScope(state.scope)) &&
    state.queued.every(changeValid) &&
    Object.values(state.saved).every(
      (item) => changeValid(item) && typeof item.completed === 'boolean',
    ) &&
    Object.entries(state.saved).every(([id, item]) => id === item.episodeId) &&
    (!state.flight ||
      (stateValidator('progressBatch')(state.flight.batch) &&
        state.flight.batch.clientId === state.clientId &&
        state.flight.batch.sequence === state.sequence &&
        !!state.scope &&
        sameScope(state.scope, state.flight.batch) &&
        (!state.flight.ack ||
          (stateValidator('progressAcknowledgement')(state.flight.ack) &&
            sameScope(state.flight.batch, state.flight.ack) &&
            state.flight.ack.clientId === state.clientId &&
            state.flight.ack.sequence === state.sequence &&
            state.flight.ack.results.length ===
              state.flight.batch.changes.length &&
            state.flight.ack.results.every(
              (item, i) =>
                item.episodeId === state.flight!.batch.changes[i].episodeId,
            )))))
  );
}
