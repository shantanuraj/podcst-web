import { ApiError } from '@/data/api';
import type {
  EpisodeList,
  ListAcknowledgement,
  ListBatch,
  ListEpisodePage,
  ListSnapshot,
} from '@/shared/lists';
import type { IEpisodeInfo } from '@/types';
import {
  acknowledge,
  enqueue,
  freeze,
  hydratePage,
  installSnapshot,
  mergeGuest,
  project,
  purgeMetadata,
  type StarRoot,
  type StarScope,
  scopeIn,
  scopeKey,
} from './state';

export interface StarStorage {
  load(): Promise<StarRoot>;
  update(change: (root: StarRoot) => void): Promise<StarRoot>;
}
export interface StarAPI {
  lists(): Promise<EpisodeList[]>;
  membership(id: string): Promise<ListSnapshot>;
  changes(id: string, batch: ListBatch): Promise<ListAcknowledgement>;
  episodes(id: string, cursor?: string): Promise<ListEpisodePage>;
}
export interface StarView {
  scope: string | null | undefined;
  state?: StarScope;
  error?: string;
  syncing: boolean;
}

export class StarSync {
  private generation = 0;
  private running?: Promise<void>;
  private listeners = new Set<() => void>();
  private view: StarView = { scope: undefined, syncing: false };
  private nextAttempt = 0;
  private failures = 0;
  constructor(
    private storage: StarStorage,
    private api: StarAPI,
    private lock: (work: () => Promise<void>) => Promise<void>,
    private publish: () => void = () => {},
  ) {}
  getSnapshot = () => this.view;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit(patch: Partial<StarView>) {
    this.view = { ...this.view, ...patch };
    for (const listener of this.listeners) listener();
  }

  async activate(account: string | null | undefined) {
    const old = this.view.scope;
    const generation = ++this.generation;
    this.running = undefined;
    this.nextAttempt = 0;
    this.emit({
      scope: account,
      state: undefined,
      error: undefined,
      syncing: false,
    });
    try {
      const root = await this.storage.update((root) => {
        if (old) purgeMetadata(scopeIn(root, old));
        if (generation !== this.generation || account === undefined) return;
        if (account !== null) mergeGuest(root, account);
        scopeIn(root, account);
      });
      this.publish();
      if (generation === this.generation && account !== undefined) {
        this.emit({ state: root[scopeKey(account)] });
        await this.refresh();
      }
    } catch {
      if (generation === this.generation)
        this.emit({ error: 'Unable to open saved episodes on this device.' });
    }
  }

  reload = async () => {
    const generation = this.generation;
    const scope = this.view.scope;
    if (scope === undefined) return;
    try {
      const root = await this.storage.load();
      if (generation === this.generation)
        this.emit({ state: root[scopeKey(scope)] });
    } catch {
      if (generation === this.generation)
        this.emit({ error: 'Unable to read saved episodes on this device.' });
    }
  };

  async edit(episodeId: number, op?: 'add' | 'remove', episode?: IEpisodeInfo) {
    const generation = this.generation;
    const scope = this.view.scope;
    if (scope === undefined || !this.view.state) return;
    try {
      await this.update(generation, scope, (state) => {
        enqueue(
          state,
          episodeId,
          op ??
            (project(state).some((item) => item.episodeId === episodeId)
              ? 'remove'
              : 'add'),
          Date.now(),
          episode,
        );
        if (scope === null) {
          const items = project(state);
          state.queued = items.map(({ episodeId, addedAt }) => ({
            episodeId,
            at: addedAt,
            op: 'add',
          }));
          state.episodes = Object.fromEntries(
            items.flatMap(({ episodeId, episode }) =>
              episode ? [[episodeId, episode]] : [],
            ),
          );
        }
      });
      await this.refresh();
    } catch {
      if (generation === this.generation)
        this.emit({ error: 'Unable to save this change on your device.' });
    }
  }

  private async update(
    generation: number,
    scope: string | null,
    change: (state: StarScope) => void,
  ) {
    const root = await this.storage.update((root) => {
      if (generation !== this.generation) throw new Error('Session changed');
      change(scopeIn(root, scope));
    });
    this.publish();
    if (generation !== this.generation) throw new Error('Session changed');
    const state = root[scopeKey(scope)];
    this.emit({ state });
    return state;
  }

  refresh = (): Promise<void> => {
    if (this.running) return this.running;
    const scope = this.view.scope;
    if (!scope || !this.view.state || Date.now() < this.nextAttempt)
      return Promise.resolve();
    const generation = this.generation;
    const active = () => {
      if (generation !== this.generation) throw new Error('Session changed');
    };
    const update = (change: (state: StarScope) => void) =>
      this.update(generation, scope, change);
    const work = this.lock(async () => {
      active();
      this.emit({ syncing: true, error: undefined });
      let state = await update(() => {});
      if (state.blocked) return;
      if (!state.listId) {
        const list = (await this.api.lists()).find(
          ({ kind }) => kind === 'starred',
        );
        active();
        if (!list) throw new Error('Starred list missing');
        state = await update((state) => {
          state.listId = list.id;
        });
      }
      const id = state.listId as string;
      do {
        state = await update(freeze);
        if (state.flight && !state.flight.ack) {
          try {
            const ack = await this.api.changes(id, state.flight.batch);
            active();
            await update((state) => acknowledge(state, ack));
          } catch (error) {
            active();
            if (
              error instanceof ApiError &&
              [400, 404, 409, 413].includes(error.status)
            )
              await update((state) => {
                state.blocked = error.status;
              });
            throw error;
          }
        }
        active();
        const snapshot = await this.api.membership(id);
        active();
        state = await update((state) => installSnapshot(state, snapshot));
      } while (state.queued.length);
      let cursor: string | undefined;
      const cursors = new Set<string>();
      do {
        active();
        const page = await this.api.episodes(id, cursor);
        active();
        await update((state) => hydratePage(state, page));
        cursor = page.nextCursor ?? undefined;
        if (cursor && cursors.has(cursor))
          throw new Error('Invalid display cursor');
        if (cursor) cursors.add(cursor);
      } while (cursor);
      this.failures = 0;
      this.nextAttempt = 0;
    })
      .catch(() => {
        if (generation !== this.generation) return;
        this.nextAttempt =
          Date.now() +
          Math.min(60_000, 1000 * 2 ** Math.min(this.failures++, 6));
        this.emit({
          error: 'Star sync paused. Changes remain saved on this device.',
        });
      })
      .finally(() => {
        if (generation === this.generation) {
          this.running = undefined;
          this.emit({ syncing: false });
        }
      });
    this.running = work;
    return work;
  };
}
