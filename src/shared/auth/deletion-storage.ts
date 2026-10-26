import {
  type AccountDeletion,
  type DeletionStorage,
  parseAccountDeletion,
} from '@/shared/account-deletion';

export const DELETION_STORAGE_PREFIX = 'podcst-account-deletion@1:';
const changed = 'podcst-account-deletion-changed';
const key = (account: string) =>
  `${DELETION_STORAGE_PREFIX}${encodeURIComponent(account)}`;
const decode = (value: string | null, account: string) => {
  if (value === null) return null;
  if (value.length > 8192) throw new Error('Deletion checkpoint is invalid');
  const record = parseAccountDeletion(JSON.parse(value), account);
  if (!record) throw new Error('Deletion checkpoint is invalid');
  return record;
};

type Browser = Pick<
  Window,
  'localStorage' | 'addEventListener' | 'removeEventListener' | 'dispatchEvent'
>;
interface Locks {
  request<T>(name: string, work: () => Promise<T>): Promise<T>;
}
export function deletionBlocked(account: string) {
  if (typeof window === 'undefined') return false;
  return decode(window.localStorage.getItem(key(account)), account) !== null;
}

export function browserDeletionStorage(target?: Browser, locks?: Locks) {
  const browser = () => target ?? window;
  const storage: DeletionStorage & {
    records(): AccountDeletion[];
    subscribe(listener: (account?: string) => void): () => void;
  } = {
    async read(account) {
      return decode(browser().localStorage.getItem(key(account)), account);
    },
    async write(account, record) {
      const parsed = parseAccountDeletion(record, account);
      if (record !== null && !parsed)
        throw new Error('Deletion checkpoint is invalid');
      const value = parsed === null ? null : JSON.stringify(parsed);
      const source = browser().localStorage;
      decode(source.getItem(key(account)), account);
      if (value !== null && value.length > 8192)
        throw new Error('Deletion checkpoint is invalid');
      if (value === null) source.removeItem(key(account));
      else source.setItem(key(account), value);
      if (source.getItem(key(account)) !== value)
        throw new Error('Deletion checkpoint was not saved; retry required');
      browser().dispatchEvent(new CustomEvent(changed, { detail: account }));
    },
    async exclusive(account, work) {
      const lock = locks ?? navigator.locks;
      if (!lock)
        throw new Error(
          'Cross-tab serialization unavailable; submission refused',
        );
      return lock.request(key(account), work);
    },
    records() {
      const source = browser().localStorage;
      const records: AccountDeletion[] = [];
      for (let index = 0; index < source.length; index++) {
        const name = source.key(index);
        if (!name?.startsWith(DELETION_STORAGE_PREFIX)) continue;
        const account = decodeURIComponent(
          name.slice(DELETION_STORAGE_PREFIX.length),
        );
        if (key(account) !== name)
          throw new Error('Deletion checkpoint key is invalid');
        const record = decode(source.getItem(name), account);
        if (record) records.push(record);
      }
      return records;
    },
    subscribe(listener) {
      const local = (event: Event) => {
        if (event instanceof CustomEvent && typeof event.detail === 'string')
          listener(event.detail);
      };
      const remote = (event: Event) => {
        const name = (event as StorageEvent).key;
        if (name?.startsWith(DELETION_STORAGE_PREFIX))
          listener(
            decodeURIComponent(name.slice(DELETION_STORAGE_PREFIX.length)),
          );
        else if (name === null) listener();
      };
      const scope = browser();
      scope.addEventListener(changed, local);
      scope.addEventListener('storage', remote);
      return () => {
        scope.removeEventListener(changed, local);
        scope.removeEventListener('storage', remote);
      };
    },
  };
  return storage;
}
