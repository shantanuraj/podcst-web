import {
  CancelledError,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { isAccessDenied, responseData } from '@/data/api';
import {
  type AccountScope,
  type AccountUser,
  accountQueryKey,
} from './account';

export interface AccountSnapshot {
  user: AccountUser | null;
  ready: boolean;
  revision: number;
  denied: ReadonlySet<string | number>;
}

export interface AccountToken {
  scope: AccountScope;
  revision: number;
  signal: AbortSignal;
}

interface Effects {
  resetPlayer: (scope: AccountScope | undefined, revision: number) => void;
  reload: () => void;
  publish: () => void;
  readSession?: (signal: AbortSignal) => Promise<AccountUser | null>;
}

export class AccountSession {
  private state: AccountSnapshot;
  private readonly listeners = new Set<() => void>();
  private requests = new AbortController();
  private checking?: { controller: AbortController; promise: Promise<void> };
  private tokenState?: AccountSnapshot;
  private cachedToken?: AccountToken;
  private lifecycle = new Set<{
    suspend: () => Promise<void>;
    erase: (account: string) => Promise<void>;
  }>();
  private checkpoints = new Set<() => Promise<void>>();

  registerCheckpoint(checkpoint: () => Promise<void>) {
    this.checkpoints.add(checkpoint);
    return () => {
      this.checkpoints.delete(checkpoint);
    };
  }

  registerLifecycle(hooks: {
    suspend: () => Promise<void>;
    erase: (account: string) => Promise<void>;
  }) {
    this.lifecycle.add(hooks);
    return () => {
      this.lifecycle.delete(hooks);
    };
  }

  async checkpointAndSuspend() {
    await Promise.all([...this.checkpoints].map((checkpoint) => checkpoint()));
    await Promise.all([...this.lifecycle].map((hooks) => hooks.suspend()));
  }

  async eraseConfirmedAccount(account: string) {
    await Promise.all([...this.lifecycle].map((hooks) => hooks.erase(account)));
  }

  constructor(
    readonly client: QueryClient,
    user: AccountUser | null,
    private readonly effects: Effects,
  ) {
    this.state = { user, ready: true, revision: 0, denied: new Set() };
  }

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  get scope(): AccountScope {
    return this.state.user?.id ?? null;
  }

  token(): AccountToken {
    if (!this.cachedToken || this.tokenState !== this.state) {
      this.tokenState = this.state;
      this.cachedToken = {
        scope: this.scope,
        revision: this.state.revision,
        signal: this.requests.signal,
      };
    }
    return this.cachedToken;
  }

  current(token: AccountToken, resource?: string | number) {
    return (
      this.state.ready &&
      token.scope === this.scope &&
      token.revision === this.state.revision &&
      !token.signal.aborted &&
      (resource === undefined || !this.state.denied.has(resource))
    );
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }

  private purge(scope: AccountScope) {
    const matches = (key?: QueryKey) =>
      key?.[0] === 'account' && key[1] === scope;
    const filter = {
      predicate: (query: { queryKey: QueryKey }) => matches(query.queryKey),
    };
    void this.client.cancelQueries(filter, { revert: false });
    for (const query of this.client.getQueryCache().findAll(filter))
      query.setState({ data: undefined, dataUpdatedAt: 0 });
    this.client.removeQueries(filter);
    const mutations = this.client.getMutationCache();
    for (const mutation of mutations.getAll())
      if (matches(mutation.options.mutationKey)) mutations.remove(mutation);
  }

  private retire(denied: ReadonlySet<string | number> = new Set()) {
    const previous = this.scope;
    this.state = {
      ...this.state,
      ready: false,
      revision: this.state.revision + 1,
      denied,
    };
    this.checking?.controller.abort();
    this.checking = undefined;
    this.requests.abort();
    this.requests = new AbortController();
    this.purge(previous);
    this.effects.resetPlayer(undefined, this.state.revision);
    this.emit();
  }

  synchronizePlayer() {
    this.effects.resetPlayer(
      this.state.ready ? this.scope : undefined,
      this.state.revision,
    );
  }

  beginAuthChange() {
    this.retire();
    this.effects.publish();
  }

  finishAuthChange = async (succeeded: boolean) => {
    this.retire();
    this.effects.publish();
    await this.refresh(succeeded);
  };

  externalChange = () => {
    this.retire();
    void this.refresh(true);
  };

  stopChecking() {
    this.checking?.controller.abort();
    this.checking = undefined;
  }

  refresh = (forceReload = false): Promise<void> => {
    if (this.checking) return this.checking.promise;
    const controller = new AbortController();
    const revision = this.state.revision;
    const read =
      this.effects.readSession ??
      (async (signal: AbortSignal) => {
        const response = await fetch('/api/auth/session', {
          signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
          cache: 'no-store',
        });
        if ([401, 403].includes(response.status)) return null;
        return (await responseData<{ user: AccountUser | null }>(response))
          .user;
      });
    const promise = Promise.resolve()
      .then(() => read(controller.signal))
      .then((user) => {
        if (controller.signal.aborted || revision !== this.state.revision)
          return;
        if (user !== null && (!user || typeof user.id !== 'string' || !user.id))
          throw new Error('Invalid session response');
        const changed = (user?.id ?? null) !== this.scope;
        if (changed && this.state.ready) {
          this.checking = undefined;
          this.retire();
        }
        this.state = {
          ...this.state,
          user,
          ready: true,
          denied: changed ? new Set() : this.state.denied,
        };
        this.synchronizePlayer();
        this.emit();
        if (changed || forceReload) this.effects.reload();
      })
      .catch(() => {})
      .finally(() => {
        if (this.checking?.controller === controller) this.checking = undefined;
      });
    this.checking = { controller, promise };
    return promise;
  };

  async run<T>(
    token: AccountToken,
    resource: string | number,
    operation: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (!this.current(token, resource)) throw new CancelledError();
    const combined = signal
      ? AbortSignal.any([token.signal, signal])
      : token.signal;
    try {
      const data = await operation(combined);
      if (!this.current(token, resource) || combined.aborted)
        throw new CancelledError();
      return data;
    } catch (error) {
      if (this.current(token) && isAccessDenied(error)) {
        this.retire(new Set([...this.state.denied, resource]));
        void this.refresh();
      }
      throw error;
    }
  }

  query<T>(
    kind: string,
    resource: string | number,
    operation: (signal: AbortSignal, cursor?: number) => Promise<T>,
  ) {
    const token = this.token();
    return {
      queryKey: accountQueryKey(token.scope, kind, resource),
      queryFn: ({
        signal,
        pageParam,
      }: {
        signal: AbortSignal;
        pageParam?: unknown;
      }) => {
        if (pageParam !== undefined && typeof pageParam !== 'number')
          throw new TypeError('Invalid episode cursor');
        return this.run(
          token,
          resource,
          (active) => operation(active, pageParam),
          signal,
        );
      },
      enabled: this.current(token, resource),
      retry: (count: number, error: Error) =>
        !isAccessDenied(error) &&
        !(error instanceof CancelledError) &&
        count < 1,
    };
  }
}
