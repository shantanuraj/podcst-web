import {
  type ChapterCache,
  type ChapterCacheEntry,
  LOCK_TTL_MS,
} from '../cache';

export class MemoryChapterCache implements ChapterCache {
  readonly entries = new Map<
    string,
    { entry: ChapterCacheEntry; expires: number }
  >();
  readonly locks = new Map<string, { token: string; expires: number }>();
  readonly failures = new Set<keyof ChapterCache>();
  readonly calls: { operation: keyof ChapterCache; key: string }[] = [];

  constructor(private readonly now = Date.now) {}

  private call(operation: keyof ChapterCache, key: string) {
    this.calls.push({ operation, key });
    if (this.failures.has(operation)) throw new Error('Synthetic Redis outage');
  }

  private owner(key: string) {
    const lock = this.locks.get(key);
    return lock && lock.expires > this.now() ? lock.token : null;
  }

  async get(key: string) {
    this.call('get', key);
    const value = this.entries.get(key);
    return value && value.expires > this.now()
      ? structuredClone(value.entry)
      : null;
  }

  async acquire(key: string, token: string) {
    this.call('acquire', key);
    if (this.owner(key)) return false;
    this.locks.set(key, { token, expires: this.now() + LOCK_TTL_MS });
    return true;
  }

  async publish(
    key: string,
    token: string,
    entry: ChapterCacheEntry,
    ttl: number,
  ) {
    this.call('publish', key);
    if (this.owner(key) !== token || ttl <= 0) return false;
    this.entries.set(key, {
      entry: structuredClone(entry),
      expires: this.now() + ttl,
    });
    this.locks.delete(key);
    return true;
  }

  async release(key: string, token: string) {
    this.call('release', key);
    if (this.owner(key) === token) this.locks.delete(key);
  }
}
