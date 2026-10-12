import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';
import { AccountSession } from '@/shared/auth/account-session';
import type { IEpisodeInfo } from '@/types';
import AudioUtils from './AudioUtils';
import { erasedQueueKey, readSession, writeSession } from './persisted-session';
import { connectQueueSession } from './queue-lifecycle';
import { usePlayer } from './usePlayer';

const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
const initial = usePlayer.getState();
const user = {
  id: 'a',
  email: 'fixture@example.invalid',
  name: null,
  image: null,
  hasPasskey: false,
};
const episode = {
  id: '12',
  guid: 'fixture',
  feed: 'https://fixture.invalid',
  file: { url: 'https://fixture.invalid/audio' },
} as IEpisodeInfo;
let values: Map<string, string>;
let session: AccountSession;
let disconnect: () => void;
let failWrite: boolean;
beforeEach(async () => {
  values = new Map();
  failWrite = false;
  let tail = Promise.resolve();
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: (_name: string, work: () => void) => {
        const task = tail.then(work);
        tail = task.catch(() => {});
        return task;
      },
    },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: Object.assign(new EventTarget(), {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          if (failWrite) throw new Error('Denied');
          values.set(key, value);
        },
        removeItem: (key: string) => {
          values.delete(key);
        },
      },
    }),
  });
  spyOn(AudioUtils, 'stop').mockImplementation(() => {});
  await writeSession({
    scope: 'a',
    queue: [episode],
    current: 0,
    position: 10,
  });
  session = new AccountSession(new QueryClient(), user, {
    resetPlayer: (scope, revision) =>
      usePlayer.getState().setAccount(scope, revision),
    reload() {},
    publish() {},
  });
  disconnect = connectQueueSession(session);
  session.synchronizePlayer();
});
afterEach(async () => {
  disconnect();
  session.client.clear();
  Reflect.deleteProperty(globalThis, 'window');
  usePlayer.setState(initial, true);
  if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks);
  else Reflect.deleteProperty(navigator, 'locks');
  mock.restore();
});
test('ordinary suspend checkpoints the current position and logout never erases queues or sources', async () => {
  usePlayer.setState({ seekPosition: 11 });
  await session.checkpointAndSuspend();
  session.beginAuthChange();
  expect(readSession('a')?.position).toBe(11);
  expect(values.has(erasedQueueKey('a'))).toBe(false);
  expect(usePlayer.getState().queue).toEqual([]);
});
test('confirmed erasure is registered, acknowledged and hides the active player before fencing late writes', async () => {
  const old = usePlayer.getState();
  await session.eraseConfirmedAccount('a');
  expect(usePlayer.getState().accountScope).toBeUndefined();
  expect(usePlayer.getState().queue).toEqual([]);
  expect(readSession('a')).toBeNull();
  await expect(
    writeSession({
      scope: 'a',
      queue: old.queue,
      current: old.currentTrackIndex,
      position: old.seekPosition,
    }),
  ).rejects.toThrow('terminally erased');
});
test('erasing A while B is active cannot clear B queue or its projection', async () => {
  await writeSession({
    scope: 'b',
    queue: [{ ...episode, id: '13' }],
    current: 0,
    position: 40,
  });
  usePlayer.getState().setAccount('b', 1);
  await session.eraseConfirmedAccount('a');
  expect(usePlayer.getState().accountScope).toBe('b');
  expect(usePlayer.getState().queue[0].id).toBe('13');
  expect(readSession('b')?.position).toBe(40);
});
test('incomplete erase preserves unknown source, exposes failure and permits a cleanup retry', async () => {
  values.set('player-session@1', '{unknown');
  await expect(session.eraseConfirmedAccount('a')).rejects.toThrow(
    'incomplete',
  );
  expect(values.get('player-session@1')).toBe('{unknown');
  expect(usePlayer.getState().storageError).toContain('incomplete');
  values.set(
    'player-session@1',
    JSON.stringify({ scope: 'a', queue: [episode], current: 0, position: 10 }),
  );
  await session.eraseConfirmedAccount('a');
  expect(values.has('player-session@1')).toBe(false);
});
test('a failed checkpoint cannot acknowledge a successful suspend', async () => {
  failWrite = true;
  await expect(session.checkpointAndSuspend()).rejects.toThrow('Denied');
  expect(readSession('a')?.position).toBe(10);
});
test('a cross-tab erasure notification hides the same-account in-memory queue', () => {
  values.set(erasedQueueKey('a'), 'true');
  window.dispatchEvent(
    Object.assign(new Event('storage'), {
      key: erasedQueueKey('a'),
      newValue: 'true',
    }),
  );
  expect(usePlayer.getState().queue).toEqual([]);
  expect(usePlayer.getState().accountScope).toBeUndefined();
});
