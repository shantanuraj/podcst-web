import { ApiError } from '@/data/api';
import {
  acknowledgeProgress,
  freezeProgress,
  installProgress,
  queueProgress,
} from '@/data/progress-outbox';
import {
  accountState,
  type BrowserState,
  unionGuestFollows,
} from '@/data/state-storage';
import type { ProgressEvent } from '@/shared/player/progress-intent';
import type { StateScope } from '@/shared/state-contract';
import { stateValidator } from '@/shared/state-contract';
import type { DurableStorage } from '@/shared/storage/durable';
import {
  acknowledgeFollows,
  freezeFollows,
  installFollows,
  queueFollow,
} from '@/shared/subscriptions/follow-outbox';

export class StateProtocolError extends Error {}
export interface StateView {
  account: string | null | undefined;
  state?: BrowserState;
  error?: string;
  syncing: boolean;
}
export interface StateTransport {
  request(path: string, method?: string, body?: unknown): Promise<unknown>;
}
export class StateRuntime {
  private epoch = 0;
  private running?: Promise<void>;
  private writes = new Set<Promise<unknown>>();
  private listeners = new Set<() => void>();
  private view: StateView = { account: undefined, syncing: false };
  private retryAt = 0;
  private failures = 0;
  constructor(
    readonly storage: DurableStorage<BrowserState>,
    private api: StateTransport,
    private lock: (work: () => Promise<void>) => Promise<void>,
    private publish = () => {},
  ) {}
  getSnapshot = () => this.view;
  storageFailure(message: string) {
    this.emit({ error: message });
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit(patch: Partial<StateView>) {
    this.view = { ...this.view, ...patch };
    for (const listener of this.listeners) listener();
  }
  async activate(account: StateView['account']) {
    const previous = this.view.account;
    const epoch = ++this.epoch;
    this.running = undefined;
    this.retryAt = 0;
    this.emit({ account, state: undefined, error: undefined, syncing: false });
    try {
      const root = previous
        ? await this.storage.update((root) => {
            const old = root.accounts[previous];
            if (old) {
              old.progress.saved = {};
              delete old.follows.snapshot;
            }
          })
        : await this.storage.load();
      if (account === undefined) return;
      if (epoch !== this.epoch) return;
      this.emit({ state: root });
      await this.refresh();
    } catch {
      if (epoch === this.epoch)
        this.emit({
          error: 'Unable to open durable state. Source data retained.',
        });
    }
  }
  reload = async () => {
    const epoch = this.epoch;
    try {
      const state = await this.storage.load();
      if (epoch === this.epoch && this.view.account !== undefined)
        this.emit({ state });
    } catch {
      if (epoch === this.epoch)
        this.emit({
          error: 'Unable to read durable state. Source data retained.',
        });
    }
  };
  private update(epoch: number, change: (root: BrowserState) => void) {
    const task = this.storage
      .update((root) => {
        if (epoch !== this.epoch) throw new Error('Session retired');
        change(root);
      })
      .then((root) => {
        this.publish();
        if (epoch !== this.epoch) throw new Error('Session retired');
        this.emit({ state: root });
        return root;
      });
    this.writes.add(task);
    void task.finally(() => this.writes.delete(task)).catch(() => {});
    return task;
  }
  async readProgress(ids: string[]) {
    const account = this.view.account;
    const epoch = this.epoch;
    if (!account) return [];
    const value = await this.api.request(
      `/progress?view=state&episodeIds=${ids.join(',')}`,
    );
    const root = await this.update(epoch, (root) =>
      this.protocol(() =>
        installProgress(
          accountState(root, account).progress,
          value,
          account,
          ids,
          false,
        ),
      ),
    );
    return ids
      .map((id) => root.accounts[account].progress.saved[id])
      .filter(Boolean)
      .map((item) => ({
        episodeId: item.episodeId,
        position: item.positionSeconds,
        completed: item.completed,
      }));
  }
  async progress(episodeId: string, event: ProgressEvent, position: number) {
    const account = this.view.account;
    const epoch = this.epoch;
    if (account === undefined) throw new Error('Account not verified');
    try {
      await this.update(epoch, (root) =>
        queueProgress(
          account === null
            ? root.guest.progress
            : accountState(root, account).progress,
          episodeId,
          event,
          position,
          account === null,
        ),
      );
      this.emit({ error: undefined });
      void this.refresh();
    } catch (error) {
      if (epoch === this.epoch)
        this.emit({ error: 'Progress could not be saved on this device.' });
      throw error;
    }
  }
  async follow(podcastId: string, followed: boolean) {
    const account = this.view.account;
    const epoch = this.epoch;
    if (account === undefined) throw new Error('Account not verified');
    try {
      await this.update(epoch, (root) => {
        if (account === null) {
          root.guest.follows = root.guest.follows.filter(
            (id) => id !== podcastId,
          );
          if (followed) root.guest.follows.push(podcastId);
        } else
          queueFollow(accountState(root, account).follows, podcastId, followed);
      });
      this.emit({ error: undefined });
      void this.refresh();
    } catch (error) {
      if (epoch === this.epoch)
        this.emit({ error: 'Follow could not be saved on this device.' });
      throw error;
    }
  }
  async checkpoint() {
    await Promise.all([...this.writes]);
  }
  async suspend() {
    await this.checkpoint();
    await this.activate(undefined);
    if (this.view.error) throw new Error(this.view.error);
  }
  async erase(account: string) {
    if (this.view.account === account) await this.suspend();
    await this.storage.update((root) => {
      delete root.accounts[account];
      if (!root.erased.includes(account)) root.erased.push(account);
    });
    this.publish();
  }
  private protocol(work: () => void) {
    try {
      work();
    } catch (error) {
      throw new StateProtocolError(
        error instanceof Error ? error.message : 'Invalid state protocol',
      );
    }
  }
  refresh = (): Promise<void> => {
    if (this.running) return this.running;
    const account = this.view.account;
    if (!account || Date.now() < this.retryAt) return Promise.resolve();
    const epoch = this.epoch;
    const active = () => {
      if (epoch !== this.epoch) throw new Error('Session retired');
    };
    let resource: 'progress' | 'follows' = 'progress';
    let hadError = false;
    const failure = async (
      error: unknown,
      resource: 'progress' | 'follows',
    ) => {
      if (epoch !== this.epoch) return;
      hadError = true;
      if (
        error instanceof StateProtocolError ||
        (error instanceof ApiError &&
          [400, 403, 404, 409, 413, 426].includes(error.status))
      ) {
        try {
          await this.update(epoch, (root) => {
            accountState(root, account)[resource].blocked = error.message;
          });
        } catch {}
      }
      this.retryAt =
        Date.now() +
        (error instanceof ApiError && error.retryAfter
          ? error.retryAfter * 1000
          : Math.min(60_000, 1000 * 2 ** Math.min(this.failures++, 6)));
      if (epoch === this.epoch)
        this.emit({
          error: 'Sync paused. Pending work is retained for this account.',
        });
    };
    const run = this.lock(async () => {
      active();
      this.emit({ syncing: true });
      let root = await this.update(epoch, (root) => {
        accountState(root, account);
      });
      try {
        if (!root.accounts[account].progress.blocked) {
          let progress = root.accounts[account].progress;
          if (!progress.scope) {
            const snapshot = await this.api.request(
              '/progress?view=state&recent=1',
            );
            active();
            root = await this.update(epoch, (root) =>
              this.protocol(() =>
                installProgress(
                  accountState(root, account).progress,
                  snapshot,
                  account,
                ),
              ),
            );
            progress = root.accounts[account].progress;
          }
          do {
            if (progress.needsCompletion.length) {
              const ids = progress.needsCompletion.slice(0, 200);
              const snapshot = await this.api.request(
                `/progress?view=state&episodeIds=${ids.join(',')}`,
              );
              active();
              root = await this.update(epoch, (root) =>
                this.protocol(() =>
                  installProgress(
                    accountState(root, account).progress,
                    snapshot,
                    account,
                    ids,
                    false,
                  ),
                ),
              );
              progress = root.accounts[account].progress;
            }
            root = await this.update(epoch, (root) =>
              this.protocol(() =>
                freezeProgress(accountState(root, account).progress),
              ),
            );
            progress = root.accounts[account].progress;
            if (!progress.flight) break;
            if (!progress.flight.ack) {
              const ack = await this.api.request(
                '/progress',
                'PUT',
                progress.flight.batch,
              );
              active();
              root = await this.update(epoch, (root) =>
                this.protocol(() =>
                  acknowledgeProgress(
                    accountState(root, account).progress,
                    ack,
                  ),
                ),
              );
              progress = root.accounts[account].progress;
            }
            const ids = [
              ...new Set(
                progress.flight!.batch.changes.map((item) => item.episodeId),
              ),
            ];
            const snapshot = await this.api.request(
              `/progress?view=state&episodeIds=${ids.join(',')}`,
            );
            active();
            root = await this.update(epoch, (root) =>
              this.protocol(() =>
                installProgress(
                  accountState(root, account).progress,
                  snapshot,
                  account,
                  ids,
                ),
              ),
            );
            progress = root.accounts[account].progress;
          } while (progress.queued.length);
        }
      } catch (error) {
        await failure(error, 'progress');
        active();
      }
      resource = 'follows';
      if (!root.accounts[account].follows.blocked) {
        let follows = root.accounts[account].follows;
        const snapshot = await this.api.request(
          '/subscriptions?view=membership',
        );
        active();
        root = await this.update(epoch, (root) => {
          this.protocol(() =>
            installFollows(
              accountState(root, account).follows,
              snapshot,
              account,
            ),
          );
          unionGuestFollows(root, account);
        });
        follows = root.accounts[account].follows;
        while (follows.flight || follows.queued.length) {
          root = await this.update(epoch, (root) =>
            this.protocol(() =>
              freezeFollows(accountState(root, account).follows),
            ),
          );
          follows = root.accounts[account].follows;
          if (!follows.flight!.ack) {
            const ack = await this.api.request(
              '/subscriptions',
              'POST',
              follows.flight!.batch,
            );
            active();
            await this.update(epoch, (root) =>
              this.protocol(() =>
                acknowledgeFollows(accountState(root, account).follows, ack),
              ),
            );
          }
          const snapshot = await this.api.request(
            '/subscriptions?view=membership',
          );
          active();
          root = await this.update(epoch, (root) =>
            this.protocol(() =>
              installFollows(
                accountState(root, account).follows,
                snapshot,
                account,
              ),
            ),
          );
          follows = root.accounts[account].follows;
        }
      }
      if (!hadError) {
        this.failures = 0;
        this.retryAt = 0;
        this.emit({ error: undefined });
      }
    })
      .catch(async (error) => {
        await failure(error, resource);
      })
      .finally(() => {
        if (epoch === this.epoch) {
          this.running = undefined;
          this.emit({ syncing: false });
        }
      });
    this.running = run;
    return run;
  };
  async resolveFeeds(feedUrls: string[], legacy = false) {
    await this.refresh();
    const account = this.view.account;
    const epoch = this.epoch;
    const scope = account
      ? this.view.state?.accounts[account]?.follows.scope
      : undefined;
    if (!account || !scope)
      throw new Error('Verified follow scope unavailable');
    await this.update(epoch, (root) => {
      const follows = accountState(root, account).follows;
      follows.importFailures = [
        ...new Set([...follows.importFailures, ...feedUrls]),
      ];
    });
    const failed: string[] = [];
    let succeeded = 0;
    for (let start = 0; start < feedUrls.length; start += 20) {
      const urls = feedUrls.slice(start, start + 20);
      try {
        const response = (await this.api.request(
          '/subscriptions/resolve',
          'POST',
          { ...scope, feedUrls: urls },
        )) as StateScope & {
          items: { index: number; podcastId: string | null; status: string }[];
        };
        if (epoch !== this.epoch) throw new Error('Session retired');
        if (
          response.protocol !== 1 ||
          response.accountId !== scope.accountId ||
          response.generation !== scope.generation ||
          !Array.isArray(response.items) ||
          response.items.length !== urls.length ||
          response.items.some(
            (item, index) =>
              item.index !== index ||
              (item.status === 'resolved'
                ? !stateValidator('id')(item.podcastId)
                : item.status !== 'unavailable' || item.podcastId !== null),
          )
        )
          throw new StateProtocolError('Invalid resolver response');
        await this.update(epoch, (root) => {
          for (const item of response.items) {
            if (item.status === 'resolved') {
              queueFollow(
                accountState(root, account).follows,
                item.podcastId!,
                true,
              );
              const follows = accountState(root, account).follows;
              follows.importFailures = follows.importFailures.filter(
                (url) => url !== urls[item.index],
              );
              if (legacy && root.legacyFollows)
                root.legacyFollows.unresolved =
                  root.legacyFollows.unresolved.filter(
                    (feed) => feed !== urls[item.index],
                  );
            }
          }
        });
        for (const item of response.items) {
          if (item.status === 'resolved') succeeded++;
          else failed.push(urls[item.index]);
        }
      } catch (error) {
        if (epoch !== this.epoch) throw error;
        failed.push(...urls);
        if (
          error instanceof StateProtocolError ||
          (error instanceof ApiError &&
            [400, 403, 404, 409, 413, 426].includes(error.status))
        ) {
          await this.update(epoch, (root) => {
            accountState(root, account).follows.blocked = error.message;
          });
          failed.push(...feedUrls.slice(start + 20));
          break;
        }
        this.emit({
          error: 'Some feed URLs could not be resolved. Retained for retry.',
        });
      }
    }
    void this.refresh();
    return { succeeded, failed };
  }
}
