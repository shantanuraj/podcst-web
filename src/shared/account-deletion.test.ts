import { expect, test } from 'bun:test';
import fixtures from '../../contracts/deletion/fixtures.json';
import {
  type AccountDeletion,
  AccountDeletionCoordinator,
  cleanupSteps,
  type DeletionEffects,
  type DeletionStorage,
  parseAccountDeletion,
} from './account-deletion';

const preparation = fixtures.prepared;
function fixture() {
  const records = new Map<string, string>();
  let tail = Promise.resolve();
  const state = {
    account: 'a' as string | null,
    time: Date.parse('2030-01-01T00:00:00.000Z'),
    prepare: 0,
    submit: 0,
    status: 0,
    resume: [] as string[],
    cleanup: [] as string[],
    suspended: [] as string[],
    server: 'completed',
    fail: '',
    failWrite: '',
  };
  const storage: DeletionStorage = {
    async read(account) {
      const value = records.get(account);
      return value ? JSON.parse(value) : null;
    },
    async write(account, record) {
      if (
        state.failWrite &&
        (record?.cleanup?.next ?? record?.outcome ?? 'removed') ===
          state.failWrite
      )
        throw new Error('Storage denied');
      if (record) records.set(account, JSON.stringify(record));
      else records.delete(account);
    },
    async exclusive<T>(_account: string, work: () => Promise<T>): Promise<T> {
      const result = tail.then(work);
      tail = result.then(
        () => {},
        () => {},
      );
      return result;
    },
  };
  const effects: DeletionEffects = {
    verifiedAccount: () => state.account,
    async suspend(account) {
      state.suspended.push(account);
    },
    async resume(account) {
      state.resume.push(account);
    },
    async prepare() {
      state.prepare++;
      return preparation;
    },
    async submit() {
      state.submit++;
      if (state.fail === 'submit') throw new Error('Response lost');
      return {
        operationId: preparation.operationId,
        status: state.server,
        ...(state.server === 'pending' ? { message: 'Pending' } : {}),
      };
    },
    async status() {
      state.status++;
      if (state.fail === 'status') throw new Error('401');
      return {
        status: state.server,
        ...(state.server === 'pending' ? { message: 'Pending' } : {}),
      };
    },
    cleanup: Object.fromEntries(
      cleanupSteps.map((step) => [
        step,
        async (account: string) => {
          state.cleanup.push(`${account}:${step}`);
          if (state.fail === step) throw new Error(`${step} unavailable`);
        },
      ]),
    ) as DeletionEffects['cleanup'],
  };
  const restart = () =>
    new AccountDeletionCoordinator(storage, effects, () => state.time);
  return { records, state, storage, effects, restart, controller: restart() };
}

test('persist preparation and unknown submission before network; never persist the proof code', async () => {
  const f = fixture();
  f.effects.prepare = async () => {
    expect((await f.controller.read('a'))?.outcome).toBe('unsubmitted');
    return preparation;
  };
  f.effects.submit = async () => {
    expect((await f.controller.read('a'))?.outcome).toBe('unknown');
    expect(f.records.get('a')).not.toContain('123456');
    return { status: 'completed', operationId: preparation.operationId };
  };
  await f.controller.prepare('a');
  const result = await f.controller.submit('a', '123456');
  expect(result.outcome).toBe('completed');
  expect(result.cleanup).toEqual({ reason: 'server', next: 'complete' });
  expect(result.operation?.receipt).toBeUndefined();
  expect(f.state.cleanup).toEqual(cleanupSteps.map((step) => `a:${step}`));
});

test('shared wire fixtures distinguish pending, unknown and canonical completion', async () => {
  const f = fixture();
  await f.controller.prepare('a');
  f.effects.submit = async () => fixtures.pending;
  expect((await f.controller.submit('a', '123456')).outcome).toBe('pending');
  f.effects.status = async () => fixtures.statusUnknown;
  expect((await f.controller.check('a'))?.outcome).toBe('unknown');
  f.effects.status = async () => fixtures.statusPending;
  expect((await f.controller.check('a'))?.outcome).toBe('pending');
  expect(f.state.cleanup).toEqual([]);
  f.effects.status = async () => fixtures.statusCompleted;
  expect((await f.controller.check('a'))?.cleanup?.next).toBe('complete');
  const direct = fixture();
  await direct.controller.prepare('a');
  direct.effects.submit = async () => fixtures.completed;
  expect((await direct.controller.submit('a', '123456')).cleanup?.next).toBe(
    'complete',
  );
});

test('a failed durable write prevents preparation or destructive submission', async () => {
  const f = fixture();
  f.state.failWrite = 'unsubmitted';
  await expect(f.controller.prepare('a')).rejects.toThrow('Storage denied');
  expect(f.state.prepare).toBe(0);
  f.state.failWrite = '';
  await f.controller.prepare('a');
  f.state.failWrite = 'unknown';
  await expect(f.controller.submit('a', '123456')).rejects.toThrow(
    'Storage denied',
  );
  expect(f.state.submit).toBe(0);
  expect(f.state.cleanup).toEqual([]);
});

test('only the same account can prepare/submit; an A-to-B response is not another account proof', async () => {
  const f = fixture();
  f.effects.prepare = async () => ({ ...preparation, accountId: 'b' });
  await expect(f.controller.prepare('a')).rejects.toThrow(
    'Invalid deletion preparation',
  );
  f.effects.prepare = async () => preparation;
  await f.controller.prepare('a');
  f.state.account = 'b';
  await expect(f.controller.submit('a', '123456')).rejects.toThrow(
    'Account changed',
  );
  expect(f.state.submit).toBe(0);
  await f.controller.cancel('a');
  expect(f.state.resume).toEqual([]);
});

test('cancellation is only pre-submission and resumes the same current scope', async () => {
  const f = fixture();
  await f.controller.prepare('a');
  await f.controller.cancel('a');
  expect(f.state.resume).toEqual(['a']);
  expect(await f.controller.read('a')).toBeNull();
  await f.controller.prepare('a');
  f.state.fail = 'submit';
  await expect(f.controller.submit('a', '123456')).rejects.toThrow(
    'Response lost',
  );
  await expect(f.controller.cancel('a')).rejects.toThrow('cannot be cancelled');
  f.effects.prepare = async () => {
    throw new Error('401');
  };
  await expect(f.controller.prepare('a')).rejects.toThrow('401');
  expect((await f.controller.read('a'))?.outcome).toBe('unknown');
});

test('a new same-account proof can replace unknown only after the server accepts preparation', async () => {
  const f = fixture();
  await f.controller.prepare('a');
  f.state.fail = 'submit';
  await expect(f.controller.submit('a', '123456')).rejects.toThrow();
  const operationId = '00000000-0000-4000-8000-000000000002';
  f.effects.prepare = async () => {
    expect((await f.controller.read('a'))?.outcome).toBe('unknown');
    return { ...preparation, operationId };
  };
  const next = await f.controller.prepare('a');
  expect(next.outcome).toBe('unsubmitted');
  expect(next.operation?.operationId).toBe(operationId);
  expect(f.state.cleanup).toEqual([]);
  await f.controller.cancel('a');
  expect(await f.controller.read('a')).toBeNull();
});

test.each([
  'unknown',
  'pending',
])('lost response and %s receipt status retain work across process restart', async (status) => {
  const f = fixture();
  await f.controller.prepare('a');
  f.state.fail = 'submit';
  await expect(f.controller.submit('a', '123456')).rejects.toThrow();
  f.state.fail = '';
  f.state.server = status;
  expect((await f.restart().check('a'))?.outcome).toBe(status);
  expect(f.state.cleanup).toEqual([]);
  f.state.server = 'completed';
  f.state.account = 'b';
  f.records.set('b', 'other-account-data');
  f.records.set('guest', 'guest-data');
  expect((await f.restart().check('a'))?.cleanup?.next).toBe('complete');
  expect(f.records.get('b')).toBe('other-account-data');
  expect(f.records.get('guest')).toBe('guest-data');
  expect(f.state.cleanup.every((step) => step.startsWith('a:'))).toBe(true);
});

test('a receipt 401 or expiry cannot authorize deletion, remove retained work or extend capability lifetime', async () => {
  const f = fixture();
  await f.controller.prepare('a');
  f.state.server = 'pending';
  await f.controller.submit('a', '123456');
  f.state.fail = 'status';
  await expect(f.restart().check('a')).rejects.toThrow('401');
  expect(f.state.cleanup).toEqual([]);
  f.state.time = Date.parse(preparation.expiresAt);
  const expired = await f.restart().check('a');
  expect(expired?.outcome).toBe('unknown');
  expect(expired?.operation?.receipt).toBeUndefined();
  expect(f.state.status).toBe(1);
  expect(f.state.cleanup).toEqual([]);
  await expect(f.controller.retryCleanup('a')).rejects.toThrow(
    'authority required',
  );
});

test('proof expiry refuses submission without confusing it with receipt expiry', async () => {
  const f = fixture();
  await f.controller.prepare('a');
  f.state.time = Date.parse(preparation.proofExpiresAt);
  await expect(f.controller.submit('a', '123456')).rejects.toThrow(
    'Usable deletion proof required',
  );
  expect(f.state.submit).toBe(0);
  expect((await f.controller.read('a'))?.operation?.receipt).toBe(
    preparation.receipt,
  );
});

test.each([
  ...cleanupSteps,
])('a crash or cleanup failure at %s resumes only after acknowledgement', async (step) => {
  const f = fixture();
  await f.controller.prepare('a');
  f.state.fail = step;
  await expect(f.controller.submit('a', '123456')).rejects.toThrow(
    'unavailable',
  );
  expect((await f.controller.read('a'))?.outcome).toBe('completed');
  expect((await f.controller.read('a'))?.cleanup?.next).toBe(step);
  f.state.fail = '';
  f.state.account = null;
  f.state.time = Date.parse(preparation.expiresAt) + 1;
  expect((await f.restart().check('a'))?.cleanup?.next).toBe('complete');
  expect(f.state.status).toBe(0);
  expect(f.state.cleanup.filter((item) => item === `a:${step}`)).toHaveLength(
    2,
  );
});

test.each([
  'retire',
  'media',
  'data',
  'credentials',
  'complete',
])('a failed %s checkpoint cannot report acknowledged local completion', async (next) => {
  const f = fixture();
  await f.controller.prepare('a');
  f.state.failWrite = next;
  await expect(f.controller.submit('a', '123456')).rejects.toThrow(
    'Storage denied',
  );
  expect((await f.controller.read('a'))?.cleanup?.next).not.toBe('complete');
  if (next === 'retire') expect(f.state.cleanup).toEqual([]);
  f.state.failWrite = '';
  const result = await f.restart().check('a');
  expect(result?.cleanup?.next).toBe('complete');
});

test('explicit local erasure is separate from server completion and works without a receipt', async () => {
  const f = fixture();
  f.state.account = 'b';
  const result = await f.controller.eraseLocal('a');
  expect(result.outcome).toBe('unknown');
  expect(result.cleanup).toEqual({ reason: 'local', next: 'complete' });
  expect(f.state.submit).toBe(0);
  expect(f.state.status).toBe(0);
  expect(f.state.cleanup).toEqual(cleanupSteps.map((step) => `a:${step}`));
});

test('two coordinators sharing durable storage serialize preparation and completed cleanup', async () => {
  const f = fixture();
  const other = f.restart();
  const prepared = await Promise.allSettled([
    f.controller.prepare('a'),
    other.prepare('a'),
  ]);
  expect(
    prepared.filter((result) => result.status === 'fulfilled'),
  ).toHaveLength(1);
  expect(f.state.prepare).toBe(1);
  await f.controller.submit('a', '123456');
  await Promise.all([other.check('a'), f.controller.retryCleanup('a')]);
  expect(f.state.cleanup).toHaveLength(cleanupSteps.length);
});

test('malformed, mismatched or missing outcomes cannot acknowledge cleanup', async () => {
  for (const value of [
    null,
    {},
    { status: 'completed' },
    {
      status: 'completed',
      operationId: '00000000-0000-4000-8000-000000000002',
    },
    { status: 'unknown', operationId: preparation.operationId },
  ]) {
    const f = fixture();
    await f.controller.prepare('a');
    f.effects.submit = async () => value;
    await expect(f.controller.submit('a', '123456')).rejects.toThrow(
      'Invalid deletion outcome',
    );
    expect((await f.controller.read('a'))?.outcome).toBe('unknown');
    expect(f.state.cleanup).toEqual([]);
  }
});

test('corrupt and wrongly scoped journals are preserved instead of replaced or trusted', async () => {
  const f = fixture();
  const base: AccountDeletion = {
    version: 1,
    accountId: 'a',
    outcome: 'unknown',
  };
  for (const value of [
    {},
    { ...base, accountId: 'b' },
    { ...base, code: '123456' },
    { ...base, outcome: 'completed' },
    { ...base, cleanup: { reason: 'server', next: 'data' } },
    { ...base, cleanup: { reason: 'local', next: 'unrecognized' } },
  ]) {
    f.records.set('a', JSON.stringify(value));
    expect(() => parseAccountDeletion(value, 'a')).toThrow();
    await expect(f.controller.eraseLocal('a')).rejects.toThrow();
    expect(f.records.get('a')).toBe(JSON.stringify(value));
  }
  expect(f.state.cleanup).toEqual([]);
});

test('a definite proof rejection permits correcting the code or cancelling without erasure', async () => {
  const f = fixture();
  await f.controller.prepare('a');
  f.state.server = 'rejected';
  const record = await f.controller.submit('a', '123456');
  expect(record.outcome).toBe('unsubmitted');
  expect(f.state.cleanup).toEqual([]);
  await f.controller.cancel('a');
  expect(await f.controller.read('a')).toBeNull();
});
