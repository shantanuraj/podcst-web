import type { AccountScope } from '@/shared/auth/account';
import { isCanonicalId, migrateStoredId } from '@/shared/canonical-id';
import type { IEpisodeInfo } from '@/types';

export interface PersistedSession {
  scope: AccountScope;
  queue: readonly IEpisodeInfo[];
  current: number;
  position: number;
  recoveryNotice?: string;
}
export function convertStoredEpisode(value: unknown): IEpisodeInfo {
  if (!value || typeof value !== 'object')
    throw new Error('Invalid saved episode');
  const episode = value as IEpisodeInfo;
  if (
    typeof episode.feed !== 'string' ||
    typeof episode.guid !== 'string' ||
    !episode.file ||
    typeof episode.file.url !== 'string'
  )
    throw new Error('Invalid saved episode');
  const id = migrateStoredId(episode.id);
  const podcast = migrateStoredId(episode.podcastId);
  return {
    ...episode,
    id: 'canonicalId' in id ? id.canonicalId : undefined,
    podcastId: 'canonicalId' in podcast ? podcast.canonicalId : undefined,
  };
}

const LEGACY_KEYS = ['player-session@1', 'player-session@2'] as const;
export const queueSessionKey = (scope: AccountScope) =>
  `player-session@3:${scope === null ? 'guest' : `account:${encodeURIComponent(scope)}`}`;
export const erasedQueueKey = (account: string) =>
  `${queueSessionKey(account)}:erased`;
type QueueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type QueueEnvelope = { version: 3; session: PersistedSession };

function decodeSession(value: unknown, legacy: boolean): PersistedSession {
  const saved = value as PersistedSession;
  if (
    !saved ||
    (saved.scope !== null &&
      (typeof saved.scope !== 'string' || !saved.scope)) ||
    !Array.isArray(saved.queue) ||
    !Number.isInteger(saved.current) ||
    saved.current < 0 ||
    (saved.queue.length > 0 && saved.current >= saved.queue.length) ||
    !Number.isFinite(saved.position) ||
    saved.position < 0
  )
    throw new Error('Unreadable queue; source retained');
  let unresolved = false;
  const queue = saved.queue.map((episode) => {
    if (legacy) {
      const converted = convertStoredEpisode(episode);
      unresolved ||=
        (episode.id !== undefined && converted.id === undefined) ||
        (episode.podcastId !== undefined && converted.podcastId === undefined);
      return converted;
    }
    if (
      !episode ||
      typeof episode !== 'object' ||
      typeof episode.guid !== 'string' ||
      !episode.file ||
      typeof episode.file.url !== 'string' ||
      (episode.id !== undefined && !isCanonicalId(episode.id)) ||
      (episode.podcastId !== undefined && !isCanonicalId(episode.podcastId))
    )
      throw new Error('Unreadable queue; source retained');
    return episode;
  });
  return {
    ...saved,
    queue,
    recoveryNotice: unresolved
      ? 'Older queue identities remain local and need resolution. Source retained.'
      : saved.recoveryNotice,
  };
}

function legacySessions(
  key: (typeof LEGACY_KEYS)[number],
  raw: string,
): PersistedSession[] {
  const value = JSON.parse(raw);
  if (key === 'player-session@1') return [decodeSession(value, true)];
  if (
    value?.version !== 2 ||
    (value.session !== null && typeof value.session !== 'object')
  )
    throw new Error('Unreadable queue; source retained');
  const sessions =
    value.session === null ? [] : [decodeSession(value.session, false)];
  if (value.unresolved && sessions[0])
    sessions[0].recoveryNotice =
      'Older queue identities remain local and need resolution. Source retained.';
  if (value.source !== undefined && value.source !== null) {
    if (typeof value.source !== 'string')
      throw new Error('Unreadable queue source; retained');
    sessions.push(decodeSession(JSON.parse(value.source), true));
  }
  return sessions;
}

export class PlayerSessionStorage {
  private pending = new Map<
    AccountScope,
    { session: PersistedSession; task: Promise<void> }
  >();
  private failures = new Map<AccountScope, unknown>();
  constructor(
    private local: QueueStorage,
    private serialize: (work: () => void) => Promise<void>,
  ) {}
  private erased(scope: AccountScope) {
    return scope !== null && this.local.getItem(erasedQueueKey(scope)) !== null;
  }
  private stored(scope: AccountScope): PersistedSession | null {
    const raw = this.local.getItem(queueSessionKey(scope));
    if (raw !== null) {
      const envelope = JSON.parse(raw) as QueueEnvelope;
      if (envelope.version !== 3)
        throw new Error('Unreadable scoped queue; source retained');
      const session = decodeSession(envelope.session, false);
      if (session.scope !== scope)
        throw new Error('Queue scope mismatch; source retained');
      return session;
    }
    const sources = LEGACY_KEYS.map((key) => {
      const raw = this.local.getItem(key);
      return raw === null ? [] : legacySessions(key, raw);
    });
    return (
      sources[1].find((session) => session.scope === scope) ??
      sources[0].find((session) => session.scope === scope) ??
      null
    );
  }
  read(scope: AccountScope): PersistedSession | null {
    if (this.erased(scope)) return null;
    const saved = this.pending.get(scope)?.session ?? this.stored(scope);
    return saved?.queue.length ? structuredClone(saved) : null;
  }
  write(value: PersistedSession): Promise<void> {
    let session: PersistedSession;
    try {
      session = decodeSession(structuredClone(value), false);
      if (this.erased(session.scope))
        throw new Error('Account queue was terminally erased');
      this.stored(session.scope);
    } catch (error) {
      this.failures.set(value.scope, error);
      return Promise.reject(error);
    }
    const task = this.serialize(() => {
      if (this.erased(session.scope))
        throw new Error('Account queue was terminally erased');
      this.stored(session.scope);
      this.local.setItem(
        queueSessionKey(session.scope),
        JSON.stringify({ version: 3, session } satisfies QueueEnvelope),
      );
    }).then(
      () => {
        this.failures.delete(session.scope);
      },
      (error) => {
        this.failures.set(session.scope, error);
        throw error;
      },
    );
    this.pending.set(session.scope, { session, task });
    void task
      .finally(() => {
        if (this.pending.get(session.scope)?.task === task)
          this.pending.delete(session.scope);
      })
      .catch(() => {});
    return task;
  }
  async checkpoint(scope: AccountScope) {
    await this.pending.get(scope)?.task;
    if (this.failures.has(scope)) throw this.failures.get(scope);
  }
  erase(account: string): Promise<void> {
    return this.serialize(() => {
      this.local.setItem(erasedQueueKey(account), 'true');
      this.pending.delete(account);
      const errors: unknown[] = [];
      const attempt = (work: () => void) => {
        try {
          work();
        } catch (error) {
          errors.push(error);
        }
      };
      attempt(() => {
        const raw = this.local.getItem(queueSessionKey(account));
        if (raw === null) return;
        const value = JSON.parse(raw);
        if (
          value?.version !== 3 ||
          decodeSession(value.session, false).scope !== account
        )
          throw new Error('Unattributable scoped queue retained');
        this.local.removeItem(queueSessionKey(account));
      });
      attempt(() => {
        const raw = this.local.getItem('player-session@1');
        if (
          raw !== null &&
          decodeSession(JSON.parse(raw), true).scope === account
        )
          this.local.removeItem('player-session@1');
      });
      attempt(() => {
        const raw = this.local.getItem('player-session@2');
        if (raw === null) return;
        const value = JSON.parse(raw);
        if (value?.version !== 2)
          throw new Error('Unattributable legacy queue retained');
        let changed = false;
        if (
          value.session !== null &&
          decodeSession(value.session, false).scope === account
        ) {
          value.session = null;
          changed = true;
        }
        if (value.source !== null && value.source !== undefined) {
          attempt(() => {
            if (typeof value.source !== 'string')
              throw new Error('Unattributable legacy source retained');
            if (
              decodeSession(JSON.parse(value.source), true).scope === account
            ) {
              value.source = null;
              changed = true;
            }
          });
        }
        if (changed) {
          if (value.session === null && value.source == null)
            this.local.removeItem('player-session@2');
          else this.local.setItem('player-session@2', JSON.stringify(value));
        }
      });
      if (errors.length)
        throw new Error(
          'Queue erasure incomplete. Unreadable or unwritable sources retained.',
        );
      this.failures.delete(account);
    });
  }
}

const stores = new WeakMap<Storage, PlayerSessionStorage>();
function storage() {
  if (typeof window === 'undefined') return null;
  const local = window.localStorage;
  let store = stores.get(local);
  if (!store) {
    store = new PlayerSessionStorage(local, async (work) => {
      if (!navigator.locks)
        throw new Error('Queue storage serialization unavailable');
      await navigator.locks.request('podcst-player-storage', work);
    });
    stores.set(local, store);
  }
  return store;
}
export const readSession = (scope: AccountScope) =>
  storage()?.read(scope) ?? null;
export async function writeSession(session: PersistedSession) {
  await storage()?.write(session);
}
export async function checkpointSession(scope: AccountScope) {
  await storage()?.checkpoint(scope);
}
export async function eraseSession(account: string) {
  const store = storage();
  if (!store) throw new Error('Queue storage unavailable');
  await store.erase(account);
}
