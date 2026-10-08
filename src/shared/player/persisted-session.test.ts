import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { IEpisodeInfo } from '@/types';
import { sameEpisode } from './episode-identity';
import { readSession, writeSession } from './persisted-session';

let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    },
  });
});
afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window');
});
const episode = (id: unknown, feed = 'https://one.invalid') => ({
  id,
  podcastId: 2,
  feed,
  guid: 'same',
  file: { url: 'https://media.invalid/file' },
});
test('one-time queue conversion retains original bytes and unsafe local media references', () => {
  const source = JSON.stringify({
    scope: null,
    queue: [episode(12), episode(9007199254740992)],
    current: 1,
    position: 30,
  });
  values.set('player-session@1', source);
  const saved = readSession(null)!;
  expect(saved.queue[0].id).toBe('12');
  expect(saved.queue[1].id).toBeUndefined();
  expect(saved.queue[1].file.url).toBe('https://media.invalid/file');
  expect(saved.recoveryNotice).toContain('remain local');
  writeSession({ ...saved, position: 40 });
  expect(values.get('player-session@1')).toBe(source);
  expect(JSON.parse(values.get('player-session@2')!).source).toBe(source);
  expect(readSession(null)?.position).toBe(40);
});
test('failed conversion activation and corrupt source never erase or overwrite the source', () => {
  const source = '{broken';
  values.set('player-session@1', source);
  expect(() => readSession(null)).toThrow();
  expect(values.has('player-session@2')).toBe(false);
  expect(values.get('player-session@1')).toBe(source);
});
test('canonical identity survives moves and never aliases a local GUID or another show', () => {
  const first = {
    ...episode('9007199254740993'),
    podcastId: '2',
  } as IEpisodeInfo;
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

test('a failed source decode also prevents a later empty-player write from activating conversion', () => {
  values.set('player-session@1', '{broken');
  expect(() =>
    writeSession({ scope: null, queue: [], current: 0, position: 0 }),
  ).toThrow();
  expect(values.has('player-session@2')).toBe(false);
  expect(values.get('player-session@1')).toBe('{broken');
});
