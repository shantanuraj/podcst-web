import {
  emptyProgress,
  type ProgressOutbox,
  validProgress,
} from '@/data/progress-outbox';
import { isCanonicalId, migrateStoredId } from '@/shared/canonical-id';
import { convertStoredEpisode } from '@/shared/player/persisted-session';
import { durableStorage } from '@/shared/storage/durable';
import {
  emptyFollows,
  type FollowOutbox,
  queueFollow,
  validFollows,
} from '@/shared/subscriptions/follow-outbox';
import type { ISubscriptionsMap } from '@/types';

export interface BrowserState {
  version: 1;
  accounts: Record<string, { progress: ProgressOutbox; follows: FollowOutbox }>;
  guest: {
    follows: string[];
    progress: ProgressOutbox;
    catalog?: ISubscriptionsMap;
    imports?: string[];
  };
  legacyFollows?: { source: unknown; unresolved: string[]; activated: true };
  erased: string[];
}
export function accountState(root: BrowserState, account: string) {
  if (root.erased.includes(account))
    throw new Error('Account was terminally erased');
  if (!Object.hasOwn(root.accounts, account))
    Object.defineProperty(root.accounts, account, {
      value: { progress: emptyProgress(), follows: emptyFollows() },
      enumerable: true,
      writable: true,
      configurable: true,
    });
  return root.accounts[account];
}
export function convertGuestFollows(root: BrowserState, source: unknown) {
  if (root.legacyFollows) return;
  if (!source || typeof source !== 'object' || Array.isArray(source))
    throw new Error('Unreadable guest follows; source retained');
  const unresolved: string[] = [];
  for (const [feed, value] of Object.entries(source)) {
    if (!value || typeof value !== 'object')
      throw new Error('Unreadable guest follow');
    if (value.isPrivate) continue;
    root.guest.catalog ??= {};
    const id = migrateStoredId(value.id);
    if ('canonicalId' in id) {
      root.guest.follows.push(id.canonicalId);
      root.guest.catalog[feed] = {
        ...value,
        id: id.canonicalId,
        episodes: (value.episodes ?? []).map(convertStoredEpisode),
      };
    } else unresolved.push(feed);
  }
  root.guest.follows = [...new Set(root.guest.follows)];
  root.legacyFollows = { source, unresolved, activated: true };
}
export function unionGuestFollows(root: BrowserState, account: string) {
  const target = accountState(root, account).follows;
  for (const id of root.guest.follows) queueFollow(target, id, true);
  root.guest.follows = [];
}
export const browserStateStorage = () =>
  durableStorage<BrowserState>(
    'podcst-durable-state',
    () => ({
      version: 1,
      accounts: {},
      guest: { follows: [], progress: emptyProgress() },
      erased: [],
    }),
    (value): value is BrowserState => {
      const root = value as BrowserState;
      return (
        !!root &&
        root.version === 1 &&
        !!root.accounts &&
        typeof root.accounts === 'object' &&
        !Array.isArray(root.accounts) &&
        Array.isArray(root.erased) &&
        root.erased.every(
          (account) =>
            typeof account === 'string' &&
            account.length > 0 &&
            account.length <= 128,
        ) &&
        !!root.guest &&
        Array.isArray(root.guest.follows) &&
        root.guest.follows.every(isCanonicalId) &&
        (root.guest.imports === undefined ||
          (Array.isArray(root.guest.imports) &&
            root.guest.imports.every((feed) => typeof feed === 'string'))) &&
        validProgress(root.guest.progress) &&
        Object.entries(root.accounts).every(
          ([account, state]) =>
            validProgress(state.progress) &&
            validFollows(state.follows) &&
            (!state.progress.scope ||
              state.progress.scope.accountId === account) &&
            (!state.follows.scope || state.follows.scope.accountId === account),
        )
      );
    },
  );
