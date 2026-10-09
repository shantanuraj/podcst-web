import { validateCatalogue } from '@/data/catalogue';
import { sameScope, validStateScope } from '@/data/progress-outbox';
import { StateProtocolError } from '@/data/state-runtime';
import { compareCanonicalIds, isCanonicalId } from '@/shared/canonical-id';
import type { FeedFreshness } from '@/shared/feed-contract';
import type {
  LegacyListBatch,
  ListAcknowledgement,
  ListBatch,
  ListChange,
  ListEpisodePage,
  ListMembership,
  ListSnapshot,
} from '@/shared/lists';
import { type StateScope, stateValidator } from '@/shared/state-contract';
import type { IEpisodeInfo } from '@/types';

export interface Intent extends ListChange {
  at: number;
}
export interface StarScope {
  wire?: StateScope;
  legacy?: { batch: LegacyListBatch; ack?: unknown };
  unresolved?: unknown[];
  clientId: string;
  sequence: string;
  revision: string;
  listId?: string;
  snapshot?: ListSnapshot;
  episodes: Record<string, IEpisodeInfo>;
  freshness?: Record<string, FeedFreshness | null>;
  queued: Intent[];
  flight?: { batch: ListBatch; intents: Intent[]; ack?: ListAcknowledgement };
  blocked?: number;
  failures: string[];
}
export type StarRoot = Record<string, StarScope>;
export interface StarItem extends ListMembership {
  freshness?: FeedFreshness | null;
  episode: IEpisodeInfo | null;
}
export const scopeKey = (account: string | null) =>
  account === null ? 'guest' : `account:${account}`;
export const validEpisodeId = isCanonicalId;
export const emptyScope = (): StarScope => ({
  clientId: crypto.randomUUID(),
  sequence: '0',
  revision: '0',
  episodes: {},
  queued: [],
  failures: [],
});
export const scopeIn = (root: StarRoot, account: string | null) =>
  (root[scopeKey(account)] ??= emptyScope());

export function project(state: StarScope): StarItem[] {
  const items = new Map(
    state.snapshot?.items.map((item) => [item.episodeId, item]),
  );
  const flight = state.flight;
  const pending = [
    ...(!flight && state.legacy
      ? state.legacy.batch.changes.map((item) => ({
          ...item,
          episodeId: String(item.episodeId),
          at: 0,
        }))
      : []),
    ...(flight?.intents.filter(
      (_, i) => flight.ack?.results[i].status !== 'not_found',
    ) ?? []),
    ...state.queued,
  ];
  for (const action of pending) {
    if (action.op === 'remove') items.delete(action.episodeId);
    else if (!items.has(action.episodeId))
      items.set(action.episodeId, {
        episodeId: action.episodeId,
        addedAt: action.at,
        availability: 'content_missing',
      });
  }
  return [...items.values()]
    .sort(
      (a, b) =>
        b.addedAt - a.addedAt || compareCanonicalIds(b.episodeId, a.episodeId),
    )
    .map((item) => ({
      ...item,
      freshness:
        item.availability === 'unavailable'
          ? null
          : state.freshness?.[item.episodeId],
      episode:
        item.availability === 'unavailable'
          ? null
          : (state.episodes[item.episodeId] ?? null),
    }));
}

export function enqueue(
  state: StarScope,
  episodeId: string,
  op: ListChange['op'],
  at: number,
  episode?: IEpisodeInfo,
) {
  if (!validEpisodeId(episodeId))
    throw new Error('A canonical episode ID is required');
  if (episode) state.episodes[episodeId] = episode;
  state.failures = state.failures.filter((id) => id !== episodeId);
  state.queued.push({ op, episodeId, at });
}

export function mergeGuest(root: StarRoot, account: string) {
  const guest = root.guest;
  if (!guest) return;
  const target = scopeIn(root, account);
  for (const item of project(guest).reverse())
    enqueue(
      target,
      item.episodeId,
      'add',
      item.addedAt,
      item.episode ?? undefined,
    );
  delete root.guest;
}

export function freeze(state: StarScope) {
  if (state.legacy && !state.flight && state.wire && !state.blocked) {
    const batch = state.legacy.batch;
    state.flight = {
      batch: {
        ...state.wire,
        ...batch,
        changes: batch.changes.map((item) => ({
          ...item,
          episodeId: String(item.episodeId),
        })),
      },
      intents: batch.changes.map((item) => ({
        ...item,
        episodeId: String(item.episodeId),
        at: 0,
      })),
    };
  }
  if (
    !state.flight &&
    state.queued.length &&
    state.listId &&
    state.wire &&
    !state.blocked
  ) {
    const intents = state.queued.splice(0, 100);
    const sequence = String(BigInt(state.sequence) + 1n);
    if (!stateValidator('id')(sequence))
      throw new StateProtocolError('Starred sequence exhausted');
    state.sequence = sequence;
    state.flight = {
      intents,
      batch: {
        ...state.wire,
        clientId: state.clientId,
        sequence: state.sequence,
        changes: intents.map(({ op, episodeId }) => ({ op, episodeId })),
      },
    };
  }
  return state.flight;
}

export function acknowledge(state: StarScope, ack: ListAcknowledgement) {
  const flight = state.flight;
  if (
    !flight ||
    !state.wire ||
    !sameScope(state.wire, ack) ||
    ack.clientId !== flight.batch.clientId ||
    ack.sequence !== flight.batch.sequence ||
    ack.listId !== state.listId ||
    !stateValidator('revision')(ack.revision) ||
    !Array.isArray(ack.results) ||
    ack.results.length !== flight.intents.length ||
    ack.results.some(
      (result, i) =>
        result.episodeId !== flight.intents[i].episodeId ||
        !['applied', 'unchanged', 'not_found'].includes(result.status),
    )
  )
    throw new StateProtocolError('Invalid list acknowledgement');
  flight.ack = ack;
  for (const result of ack.results) {
    state.failures = state.failures.filter((id) => id !== result.episodeId);
    if (result.status === 'not_found') {
      state.failures.push(result.episodeId);
      delete state.episodes[result.episodeId];
      const member = state.snapshot?.items.find(
        (item) => item.episodeId === result.episodeId,
      );
      if (member) member.availability = 'unavailable';
    }
  }
}

export function installSnapshot(state: StarScope, snapshot: ListSnapshot) {
  if (
    !state.wire ||
    !sameScope(state.wire, snapshot) ||
    snapshot.listId !== state.listId ||
    !stateValidator('revision')(snapshot.revision) ||
    !Array.isArray(snapshot.items) ||
    new Set(snapshot.items.map((item) => item.episodeId)).size !==
      snapshot.items.length ||
    snapshot.items.some(
      (item) =>
        !validEpisodeId(item.episodeId) ||
        !Number.isSafeInteger(item.addedAt) ||
        item.addedAt < 0 ||
        !['available', 'content_missing', 'unavailable'].includes(
          item.availability,
        ),
    )
  )
    throw new StateProtocolError('Invalid membership snapshot');
  if (
    BigInt(snapshot.revision) < BigInt(state.revision) ||
    BigInt(snapshot.revision) < BigInt(state.flight?.ack?.revision ?? '0')
  )
    throw new StateProtocolError('Stale membership snapshot');
  state.snapshot = snapshot;
  state.revision = snapshot.revision;
  if (state.flight?.ack) {
    delete state.flight;
    delete state.legacy;
  }
  const visible = new Set(project(state).map(({ episodeId }) => episodeId));
  for (const id of Object.keys(state.episodes))
    if (
      !visible.has(id) ||
      snapshot.items.some(
        (item) => item.episodeId === id && item.availability === 'unavailable',
      )
    )
      delete state.episodes[id];
}

export function hydratePage(state: StarScope, page: ListEpisodePage) {
  validateCatalogue(page);
  if (
    !Array.isArray(page.items) ||
    (page.nextCursor !== null && typeof page.nextCursor !== 'string')
  )
    throw new StateProtocolError('Invalid list page');
  if (
    !state.wire ||
    !sameScope(state.wire, page) ||
    page.listId !== state.listId ||
    page.revision !== state.snapshot?.revision
  )
    return;
  for (const item of page.items) {
    const member = state.snapshot.items.find(
      ({ episodeId }) => episodeId === item.episodeId,
    );
    if (!member) continue;
    state.freshness ??= {};
    state.freshness[item.episodeId] =
      item.availability === 'unavailable' ? null : (item.freshness ?? null);
    if (item.availability === 'unavailable') {
      member.availability = 'unavailable';
      delete state.episodes[item.episodeId];
    } else if (
      member.availability !== 'unavailable' &&
      item.episode?.id === item.episodeId
    )
      state.episodes[item.episodeId] = item.episode;
  }
}

export function purgeMetadata(state: StarScope) {
  state.episodes = {};
  delete state.freshness;
  delete state.snapshot;
}

export function validStarScope(value: unknown): value is StarScope {
  const state = value as StarScope;
  const validIntent = (item: Intent) =>
    !!item &&
    isCanonicalId(item.episodeId) &&
    ['add', 'remove'].includes(item.op) &&
    Number.isSafeInteger(item.at) &&
    item.at >= 0;
  if (
    !state ||
    !stateValidator('uuid')(state.clientId) ||
    !stateValidator('revision')(state.sequence) ||
    !stateValidator('revision')(state.revision) ||
    !Array.isArray(state.queued) ||
    !state.queued.every(validIntent) ||
    !Array.isArray(state.failures) ||
    !state.failures.every(isCanonicalId) ||
    !state.episodes ||
    (state.wire && !validStateScope(state.wire)) ||
    (state.listId && !stateValidator('uuid')(state.listId))
  )
    return false;
  if (
    Object.entries(state.episodes).some(
      ([id, episode]) => !isCanonicalId(id) || episode.id !== id,
    )
  )
    return false;
  try {
    const clone = structuredClone(state);
    if (state.flight) {
      const batch = state.flight.batch;
      if (
        !state.wire ||
        !sameScope(state.wire, batch) ||
        batch.clientId !== state.clientId ||
        batch.sequence !== state.sequence ||
        !stateValidator('id')(batch.sequence) ||
        !Array.isArray(batch.changes) ||
        !batch.changes.length ||
        batch.changes.length > 100 ||
        !Array.isArray(state.flight.intents) ||
        state.flight.intents.length !== batch.changes.length ||
        state.flight.intents.some(
          (item, index) =>
            !validIntent(item) ||
            item.episodeId !== batch.changes[index].episodeId ||
            item.op !== batch.changes[index].op,
        )
      )
        return false;
      if (state.flight.ack) acknowledge(clone, state.flight.ack);
    }
    if (state.snapshot) {
      delete clone.flight;
      installSnapshot(clone, state.snapshot);
    }
    if (
      state.legacy &&
      (!Array.isArray(state.legacy.batch.changes) ||
        state.legacy.batch.clientId !== state.clientId ||
        state.legacy.batch.sequence !== state.sequence ||
        state.legacy.batch.changes.some(
          (item) =>
            !Number.isSafeInteger(item.episodeId) ||
            item.episodeId <= 0 ||
            !['add', 'remove'].includes(item.op),
        ))
    )
      return false;
  } catch {
    return false;
  }
  return true;
}
