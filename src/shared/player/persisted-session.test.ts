import { expect, test } from 'bun:test';
import type { IEpisodeInfo } from '@/types';
import { sameEpisode } from './episode-identity';
import {
  erasedQueueKey,
  type PersistedSession,
  PlayerSessionStorage,
  queueSessionKey,
} from './persisted-session';

function fixture() {
  const values = new Map<string, string>();
  let failWrite = false;
  let failRemove = false;
  const local = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (failWrite) throw new Error('Quota');
      values.set(key, value);
    },
    removeItem: (key: string) => {
      if (failRemove) throw new Error('Denied');
      values.delete(key);
    },
  };
  let tail = Promise.resolve();
  const serialize = (work: () => void) => {
    const task = tail.then(work);
    tail = task.catch(() => {});
    return task;
  };
  return {
    values,
    local,
    store: new PlayerSessionStorage(local, serialize),
    second: () => new PlayerSessionStorage(local, serialize),
    serialize,
    failWrite: (value: boolean) => {
      failWrite = value;
    },
    failRemove: (value: boolean) => {
      failRemove = value;
    },
  };
}
const episode = (id: unknown, feed = 'https://one.invalid') => ({
  id,
  podcastId: '2',
  feed,
  guid: 'same',
  file: { url: 'https://media.invalid/file' },
});
const session = (scope: string | null, id = '12'): PersistedSession => ({
  scope,
  queue: [episode(id) as IEpisodeInfo],
  current: 0,
  position: 30,
});

test('A to B to A and guest queues remain distinct across independent writers and restart', async () => {
  const f = fixture();
  const a = session('a');
  const b = session('b', '13');
  const guest = session(null, '14');
  await Promise.all([
    f.store.write(a),
    f.second().write(b),
    f.second().write(guest),
  ]);
  expect(f.second().read('a')).toMatchObject(a);
  expect(f.second().read('b')).toMatchObject(b);
  expect(f.second().read(null)).toMatchObject(guest);
  expect(f.values.has('player-session@2')).toBe(false);
});
test('validated conversion keeps @1 and @2 bytes and both scoped queues including embedded sources', async () => {
  const f = fixture();
  const old = {
    ...session('a'),
    queue: [episode(12), episode(9007199254740992)],
    current: 1,
  };
  const raw1 = JSON.stringify(old);
  const raw2 = JSON.stringify({
    version: 2,
    source: raw1,
    session: session('b'),
  });
  f.values.set('player-session@1', raw1);
  f.values.set('player-session@2', raw2);
  const a = f.store.read('a')!;
  expect(a.queue[0].id).toBe('12');
  expect(a.queue[1].id).toBeUndefined();
  expect(a.queue[1].file.url).toBe('https://media.invalid/file');
  expect(a.recoveryNotice).toContain('remain local');
  await f.store.write(a);
  await f.store.write(f.store.read('b')!);
  expect(f.values.get('player-session@1')).toBe(raw1);
  expect(f.values.get('player-session@2')).toBe(raw2);
  expect(f.second().read('a')?.current).toBe(1);
  expect(f.second().read('b')?.queue[0].id).toBe('12');
});
test('failed activation preserves source bytes and permits idempotent retry', async () => {
  const f = fixture();
  const source = JSON.stringify(session('a'));
  f.values.set('player-session@1', source);
  f.failWrite(true);
  await expect(f.store.write(f.store.read('a')!)).rejects.toThrow('Quota');
  expect(f.values.has(queueSessionKey('a'))).toBe(false);
  expect(f.values.get('player-session@1')).toBe(source);
  await expect(f.store.checkpoint('a')).rejects.toThrow('Quota');
  f.failWrite(false);
  await f.store.write(f.store.read('a')!);
  await f.store.checkpoint('a');
  expect(f.second().read('a')).toMatchObject(session('a'));
});
test.each([
  'player-session@1',
  'player-session@2',
  queueSessionKey('a'),
])('corrupt %s is never turned into an empty successful activation', async (key) => {
  const f = fixture();
  f.values.set(key, '{broken');
  expect(() => f.store.read('a')).toThrow();
  await expect(
    f.store.write({ scope: 'a', queue: [], current: 0, position: 0 }),
  ).rejects.toThrow();
  expect(f.values.get(key)).toBe('{broken');
  if (key !== queueSessionKey('a'))
    expect(f.values.has(queueSessionKey('a'))).toBe(false);
});
test('write failure retains a meaningful scoped queue and reports failed checkpoint', async () => {
  const f = fixture();
  await f.store.write(session('a'));
  const source = f.values.get(queueSessionKey('a'));
  f.failWrite(true);
  await expect(f.store.write(session('a', '13'))).rejects.toThrow();
  await expect(f.store.checkpoint('a')).rejects.toThrow();
  expect(f.values.get(queueSessionKey('a'))).toBe(source);
});
test('pending local write is not lost by immediate A to B to A restoration', async () => {
  const f = fixture();
  await f.store.write(session('a'));
  const pending = f.store.write({ ...session('a'), position: 91 });
  expect(f.store.read('b')).toBeNull();
  expect(f.store.read('a')?.position).toBe(91);
  await pending;
  expect(f.second().read('a')?.position).toBe(91);
});
test('targeted erase deletes only matching scoped/legacy data and preserves a foreign embedded source', async () => {
  const f = fixture();
  const bSource = JSON.stringify(session('b'));
  f.values.set('player-session@1', JSON.stringify(session('a')));
  f.values.set(
    'player-session@2',
    JSON.stringify({ version: 2, session: session('a'), source: bSource }),
  );
  await f.store.write(session('a'));
  await f.store.write(session('b'));
  const bScoped = f.values.get(queueSessionKey('b'));
  await f.store.erase('a');
  expect(f.values.get(erasedQueueKey('a'))).toBe('true');
  expect(f.values.has(queueSessionKey('a'))).toBe(false);
  expect(f.values.has('player-session@1')).toBe(false);
  expect(JSON.parse(f.values.get('player-session@2')!)).toEqual({
    version: 2,
    session: null,
    source: bSource,
  });
  expect(f.values.get(queueSessionKey('b'))).toBe(bScoped);
  expect(f.second().read('b')).toMatchObject(session('b'));
});
test('erase matching embedded @2 source keeps the unrelated current session untouched', async () => {
  const f = fixture();
  const b = session('b');
  f.values.set(
    'player-session@2',
    JSON.stringify({
      version: 2,
      session: b,
      source: JSON.stringify(session('a')),
    }),
  );
  await f.store.erase('a');
  expect(JSON.parse(f.values.get('player-session@2')!)).toEqual({
    version: 2,
    session: b,
    source: null,
  });
});
test('unattributable legacy data causes acknowledged erase to fail without wiping it; retry finishes cleanup', async () => {
  const f = fixture();
  await f.store.write(session('a'));
  f.values.set('player-session@1', '{unknown owner');
  await expect(f.store.erase('a')).rejects.toThrow('incomplete');
  expect(f.values.get('player-session@1')).toBe('{unknown owner');
  expect(f.store.read('a')).toBeNull();
  await expect(f.second().write(session('a'))).rejects.toThrow(
    'terminally erased',
  );
  f.values.set('player-session@1', JSON.stringify(session('a')));
  await f.store.erase('a');
  expect(f.values.has('player-session@1')).toBe(false);
});
test('erase retains unreadable scoped bytes and malformed embedded legacy source while scrubbing attributable data', async () => {
  const f = fixture();
  f.values.set(queueSessionKey('a'), '{bad');
  f.values.set(
    'player-session@2',
    JSON.stringify({ version: 2, session: session('a'), source: '{unknown' }),
  );
  await expect(f.store.erase('a')).rejects.toThrow('incomplete');
  expect(f.values.get(queueSessionKey('a'))).toBe('{bad');
  expect(JSON.parse(f.values.get('player-session@2')!)).toEqual({
    version: 2,
    session: null,
    source: '{unknown',
  });
});
test('failed cleanup leaves a durable tombstone, retries despite it, and fences queued and late writers', async () => {
  const f = fixture();
  await f.store.write(session('a'));
  f.failRemove(true);
  await expect(f.store.erase('a')).rejects.toThrow();
  expect(f.values.get(erasedQueueKey('a'))).toBe('true');
  expect(f.store.read('a')).toBeNull();
  f.failRemove(false);
  await f.store.erase('a');
  await expect(f.second().write(session('a'))).rejects.toThrow();
  const g = fixture();
  await g.store.write(session('a'));
  const erase = g.store.erase('a');
  const queued = g.second().write(session('a', '13'));
  await erase;
  await expect(queued).rejects.toThrow('terminally erased');
  expect(g.values.has(queueSessionKey('a'))).toBe(false);
});
test('canonical identity survives moves and never aliases a local GUID or another show', () => {
  const first = episode('9007199254740993') as IEpisodeInfo;
  expect(
    sameEpisode(first, {
      ...first,
      feed: 'https://moved.invalid',
      file: { ...first.file, url: 'https://moved.invalid/audio' },
    }),
  ).toBe(true);
  expect(sameEpisode(first, { ...first, id: '9007199254740994' })).toBe(false);
  expect(sameEpisode(first, { ...first, id: undefined })).toBe(false);
  expect(
    sameEpisode(
      { ...first, id: undefined },
      { ...first, id: undefined, feed: 'https://other.invalid' },
    ),
  ).toBe(false);
});
