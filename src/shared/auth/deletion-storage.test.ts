import { expect, test } from 'bun:test';
import type { AccountDeletion } from '@/shared/account-deletion';
import {
  browserDeletionStorage,
  DELETION_STORAGE_PREFIX,
} from './deletion-storage';

class StorageFixture implements Storage {
  values = new Map<string, string>();
  deny = false;
  ignore = false;
  get length() {
    return this.values.size;
  }
  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.deny) throw new Error('Storage denied');
    if (!this.ignore) this.values.set(key, value);
  }
  removeItem(key: string) {
    if (this.deny) throw new Error('Storage denied');
    if (!this.ignore) this.values.delete(key);
  }
  clear() {
    this.values.clear();
  }
}
const record = (accountId = 'a'): AccountDeletion => ({
  version: 1,
  accountId,
  outcome: 'unknown',
});
const windowFor = (source: Storage) =>
  Object.assign(new EventTarget(), { localStorage: source });
const locks = () => {
  const tails = new Map<string, Promise<unknown>>();
  return {
    request<T>(name: string, work: () => Promise<T>): Promise<T> {
      const result = (tails.get(name) ?? Promise.resolve()).then(work);
      tails.set(
        name,
        result.catch(() => {}),
      );
      return result;
    },
  };
};

test('browser checkpoints are scoped and survive a reconstructed adapter', async () => {
  const source = new StorageFixture();
  source.setItem('guest-state', 'retained');
  const window = windowFor(source);
  const store = browserDeletionStorage(window, locks());
  await store.write('a', record());
  await store.write('a/b', record('a/b'));
  const restarted = browserDeletionStorage(window, locks());
  expect(await restarted.read('a')).toEqual(record());
  expect(restarted.records().map((entry) => entry.accountId)).toEqual([
    'a',
    'a/b',
  ]);
  await restarted.write('a', null);
  expect(await restarted.read('a')).toBeNull();
  expect(await restarted.read('a/b')).toEqual(record('a/b'));
  expect(source.getItem('guest-state')).toBe('retained');
});

test('storage failure and silent failed writes/removals are not acknowledged', async () => {
  const source = new StorageFixture();
  const store = browserDeletionStorage(windowFor(source), locks());
  source.deny = true;
  await expect(store.write('a', record())).rejects.toThrow('Storage denied');
  source.deny = false;
  source.ignore = true;
  await expect(store.write('a', record())).rejects.toThrow('not saved');
  source.ignore = false;
  await store.write('a', record());
  source.ignore = true;
  await expect(store.write('a', null)).rejects.toThrow('not saved');
  expect(await store.read('a')).toEqual(record());
});

test('corrupt, mis-scoped and oversized checkpoints remain refused and preserved', async () => {
  const source = new StorageFixture();
  const store = browserDeletionStorage(windowFor(source), locks());
  const key = `${DELETION_STORAGE_PREFIX}a`;
  for (const value of [
    '{',
    'null',
    JSON.stringify(record('b')),
    ' '.repeat(8193),
  ]) {
    source.setItem(key, value);
    await expect(store.read('a')).rejects.toThrow();
    await expect(store.write('a', record())).rejects.toThrow();
    await expect(store.write('a', null)).rejects.toThrow();
    expect(() => store.records()).toThrow();
    expect(source.getItem(key)).toBe(value);
  }
});

test('noncanonical keys and unavailable cross-tab locking refuse recovery work', async () => {
  const source = new StorageFixture();
  const store = browserDeletionStorage(windowFor(source), locks());
  source.setItem(`${DELETION_STORAGE_PREFIX}%61`, JSON.stringify(record()));
  expect(() => store.records()).toThrow('key is invalid');
  const previous = Object.getOwnPropertyDescriptor(navigator, 'locks');
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: undefined,
  });
  try {
    const unavailable = browserDeletionStorage(windowFor(source));
    await expect(unavailable.exclusive('a', async () => {})).rejects.toThrow(
      'serialization unavailable',
    );
  } finally {
    if (previous) Object.defineProperty(navigator, 'locks', previous);
    else Reflect.deleteProperty(navigator, 'locks');
  }
});

test('local and other-tab notifications carry only scope, not receipt capabilities', async () => {
  const source = new StorageFixture();
  const first = windowFor(source);
  const second = windowFor(source);
  const lock = locks();
  const a = browserDeletionStorage(first, lock);
  const b = browserDeletionStorage(second, lock);
  const seenA: unknown[] = [];
  const seenB: unknown[] = [];
  const stopA = a.subscribe((scope) => seenA.push(scope));
  const stopB = b.subscribe((scope) => seenB.push(scope));
  await a.write('a', record());
  second.dispatchEvent(
    Object.assign(new Event('storage'), { key: `${DELETION_STORAGE_PREFIX}a` }),
  );
  expect(seenA).toEqual(['a']);
  expect(seenB).toEqual(['a']);
  second.dispatchEvent(Object.assign(new Event('storage'), { key: null }));
  expect(seenB).toEqual(['a', undefined]);
  stopA();
  stopB();
  await a.write('a', null);
  expect(seenA).toEqual(['a']);
});

test('two browser adapters serialize same-account work without locking another account', async () => {
  const source = new StorageFixture();
  const lock = locks();
  const a = browserDeletionStorage(windowFor(source), lock);
  const b = browserDeletionStorage(windowFor(source), lock);
  const release = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  let entered = false;
  const first = a.exclusive('a', async () => {
    started.resolve();
    await release.promise;
    await a.write('a', record());
  });
  await started.promise;
  const second = b.exclusive('a', async () => {
    entered = true;
    expect(await b.read('a')).toEqual(record());
  });
  await b.exclusive('b', () => b.write('b', record('b')));
  expect(entered).toBe(false);
  release.resolve();
  await Promise.all([first, second]);
  expect(entered).toBe(true);
  expect(await b.read('b')).toEqual(record('b'));
});
