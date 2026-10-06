import type {
  ListAcknowledgement,
  ListBatch,
  ListChange,
  ListEpisodePage,
  ListMembership,
  ListSnapshot,
} from '@/shared/lists';
import type { IEpisodeInfo } from '@/types';

export interface Intent extends ListChange {
  at: number;
}
export interface StarScope {
  clientId: string;
  sequence: string;
  listId?: string;
  snapshot?: ListSnapshot;
  episodes: Record<number, IEpisodeInfo>;
  queued: Intent[];
  flight?: { batch: ListBatch; intents: Intent[]; ack?: ListAcknowledgement };
  blocked?: number;
  failures: number[];
}
export type StarRoot = Record<string, StarScope>;
export interface StarItem extends ListMembership {
  episode: IEpisodeInfo | null;
}
export const scopeKey = (account: string | null) =>
  account === null ? 'guest' : `account:${account}`;
export const validEpisodeId = (id: unknown): id is number =>
  Number.isSafeInteger(id) && Number(id) > 0;
export const emptyScope = (): StarScope => ({
  clientId: crypto.randomUUID(),
  sequence: '0',
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
    .sort((a, b) => b.addedAt - a.addedAt || b.episodeId - a.episodeId)
    .map((item) => ({
      ...item,
      episode:
        item.availability === 'unavailable'
          ? null
          : (state.episodes[item.episodeId] ?? null),
    }));
}

export function enqueue(
  state: StarScope,
  episodeId: number,
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
  if (!state.flight && state.queued.length && state.listId && !state.blocked) {
    const intents = state.queued.splice(0, 100);
    state.sequence = String(BigInt(state.sequence) + 1n);
    state.flight = {
      intents,
      batch: {
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
    ack.clientId !== flight.batch.clientId ||
    ack.sequence !== flight.batch.sequence ||
    ack.listId !== state.listId ||
    !/^\d+$/.test(ack.revision) ||
    ack.results.length !== flight.intents.length ||
    ack.results.some(
      (result, i) =>
        result.episodeId !== flight.intents[i].episodeId ||
        !['applied', 'unchanged', 'not_found'].includes(result.status),
    )
  )
    throw new Error('Invalid list acknowledgement');
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
    snapshot.listId !== state.listId ||
    !/^\d+$/.test(snapshot.revision) ||
    !Array.isArray(snapshot.items) ||
    new Set(snapshot.items.map((item) => item.episodeId)).size !==
      snapshot.items.length ||
    snapshot.items.some(
      (item) =>
        !validEpisodeId(item.episodeId) ||
        !Number.isSafeInteger(item.addedAt) ||
        !['available', 'content_missing', 'unavailable'].includes(
          item.availability,
        ),
    )
  )
    throw new Error('Invalid membership snapshot');
  if (
    BigInt(snapshot.revision) < BigInt(state.snapshot?.revision ?? '0') ||
    BigInt(snapshot.revision) < BigInt(state.flight?.ack?.revision ?? '0')
  )
    throw new Error('Stale membership snapshot');
  state.snapshot = snapshot;
  if (state.flight?.ack) delete state.flight;
  const visible = new Set(project(state).map(({ episodeId }) => episodeId));
  for (const id of Object.keys(state.episodes).map(Number))
    if (
      !visible.has(id) ||
      snapshot.items.some(
        (item) => item.episodeId === id && item.availability === 'unavailable',
      )
    )
      delete state.episodes[id];
}

export function hydratePage(state: StarScope, page: ListEpisodePage) {
  if (
    page.listId !== state.listId ||
    page.revision !== state.snapshot?.revision
  )
    return;
  for (const item of page.items) {
    const member = state.snapshot.items.find(
      ({ episodeId }) => episodeId === item.episodeId,
    );
    if (!member) continue;
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
  delete state.snapshot;
}
