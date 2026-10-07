import { expect, test } from 'bun:test';
import {
  type ProgressEvent,
  progressIntent,
} from '@/shared/player/progress-intent';
import {
  type FollowBatch,
  type ProgressBatch,
  STATE_BATCH_LIMIT,
  STATE_BODY_LIMIT,
  stateErrorStatus,
  stateValidator,
} from '@/shared/state-contract';
import fixtures from '../../../contracts/state/fixtures.json';
import schema from '../../../contracts/state/schema.json';
import {
  assertStateScope,
  readStateBatch,
  stateReplay,
  stateRequestHash,
} from './protocol';

const progress = fixtures.progressBatch as ProgressBatch;
const follows = fixtures.followBatch as FollowBatch;
const request = (body: unknown) =>
  new Request('https://example.invalid/api/progress', {
    method: 'PUT',
    body: JSON.stringify(body),
  });

test('validates exact decimal IDs and revisions without coercion', () => {
  for (const vector of fixtures.scalars) {
    expect(stateValidator('id')(vector.value)).toBe(vector.id);
    expect(stateValidator('revision')(vector.value)).toBe(vector.revision);
  }
  const maximum = 9223372036854775807n;
  for (let delta = -100n; delta <= 100n; delta++)
    expect(stateValidator('id')(String(maximum + delta))).toBe(delta <= 0);
  for (let digits = 1n; digits < 19n; digits++) {
    expect(stateValidator('id')(String(10n ** digits))).toBe(true);
    expect(stateValidator('id')(String(10n ** digits - 1n))).toBe(true);
  }
  expect(stateValidator('uuid')(`${progress.clientId}\n`)).toBe(false);
  expect(stateValidator('uuid')(progress.clientId.toUpperCase())).toBe(false);
});

test('validates every request and response fixture against ordinary JSON Schema', () => {
  for (const shape of [
    'progressBatch',
    'followBatch',
    'progressAcknowledgement',
    'followAcknowledgement',
    'progressSnapshot',
    'followSnapshot',
    'error',
  ] as const) {
    const validate = stateValidator(shape);
    expect(validate(fixtures[shape])).toBe(true);
    expect(validate({ ...fixtures[shape], unexpected: true })).toBe(false);
  }
  expect(Object.keys(stateErrorStatus).sort()).toEqual(
    [...schema.definitions.error.properties.code.enum].sort(),
  );
  expect(schema.definitions.followBatch.properties.changes.maxItems).toBe(
    STATE_BATCH_LIMIT,
  );
});

test('requires explicit nullable progress rather than omitted state', () => {
  const snapshot = fixtures.progressSnapshot;
  expect(
    stateValidator('progressSnapshot')({
      ...snapshot,
      items: [{ episodeId: '1' }],
    }),
  ).toBe(false);
  expect(
    stateValidator('progressSnapshot')({
      ...snapshot,
      items: [{ episodeId: '1', progress: null }],
    }),
  ).toBe(true);
});

test('bounds every progress input and refuses ambiguous or partial intent', async () => {
  for (const positionSeconds of [-1, 0.5, 2147483648, '1', null])
    await expect(
      readStateBatch(
        request({
          ...progress,
          changes: [{ ...progress.changes[0], positionSeconds }],
        }),
        'progress',
      ),
    ).rejects.toMatchObject({ code: 'invalid_request' });
  for (const body of [
    null,
    {},
    [],
    { ...progress, changes: [] },
    {
      ...progress,
      changes: Array(STATE_BATCH_LIMIT + 1).fill(progress.changes[0]),
    },
    { ...progress, changes: [{ episodeId: '1', positionSeconds: 0 }] },
    {
      ...progress,
      changes: [{ episodeId: '1', positionSeconds: 0, completed: 'true' }],
    },
    { ...progress, changes: [{ ...progress.changes[0], episodeId: 1 }] },
    { ...progress, changes: [{ ...progress.changes[0], duration: 100 }] },
    { ...progress, sequence: '0' },
    { ...progress, accountId: '' },
    { ...progress, extra: true },
  ])
    await expect(
      readStateBatch(request(body), 'progress'),
    ).rejects.toMatchObject({
      code: 'invalid_request',
    });
  expect(await readStateBatch(request(progress), 'progress')).toEqual(progress);
  expect(await readStateBatch(request(follows), 'follows')).toEqual(follows);
  await expect(
    readStateBatch(
      request({ ...follows, changes: [{ podcastId: '1', op: 'toggle' }] }),
      'follows',
    ),
  ).rejects.toMatchObject({ code: 'invalid_request' });
  await expect(
    readStateBatch(request({ ...progress, protocol: 0 }), 'progress'),
  ).rejects.toMatchObject({ code: 'update_required' });
});

test('bounds request bytes and rejects malformed UTF-8, JSON and stalled streams', async () => {
  for (const body of ['x'.repeat(STATE_BODY_LIMIT + 1), new Uint8Array([0xff])])
    await expect(
      readStateBatch(
        new Request('https://example.invalid', { method: 'PUT', body }),
        'progress',
      ),
    ).rejects.toMatchObject({
      code: typeof body === 'string' ? 'request_too_large' : 'invalid_request',
    });
  await expect(
    readStateBatch(
      new Request('https://example.invalid', { method: 'PUT', body: '{' }),
      'progress',
    ),
  ).rejects.toMatchObject({ code: 'invalid_request' });
  await expect(
    readStateBatch(
      new Request('https://example.invalid', {
        method: 'PUT',
        body: new ReadableStream(),
      }),
      'progress',
      5,
    ),
  ).rejects.toMatchObject({ code: 'request_timeout' });
  await expect(
    readStateBatch(
      new Request('https://example.invalid', {
        method: 'PUT',
        headers: { 'content-length': String(STATE_BODY_LIMIT + 1) },
      }),
      'progress',
    ),
  ).rejects.toMatchObject({ code: 'request_too_large' });
});

test('hashes semantic key order but preserves action order, account and exact identities', () => {
  const hash = stateRequestHash('progress', progress);
  expect(hash).toBe(fixtures.hashes.progress);
  expect(stateRequestHash('follows', follows)).toBe(fixtures.hashes.follows);
  expect(
    stateRequestHash('progress', {
      ...progress,
      changes: progress.changes.map(
        ({ completed, episodeId, positionSeconds }) => ({
          completed,
          positionSeconds,
          episodeId,
        }),
      ),
    }),
  ).toBe(hash);
  for (const changed of [
    { ...progress, accountId: 'fixture-account-b' },
    { ...progress, generation: '00000000-0000-0000-0000-000000000000' },
    { ...progress, sequence: '9007199254740994' },
    { ...progress, changes: [...progress.changes].reverse() },
    {
      ...progress,
      changes: [{ ...progress.changes[0], episodeId: '9007199254740992' }],
    },
  ])
    expect(stateRequestHash('progress', changed)).not.toBe(hash);
  expect(stateRequestHash('follows', follows)).not.toBe(hash);
});

test('classifies retries without converting them to new intent', () => {
  for (const vector of fixtures.replay) {
    const replay = () =>
      stateReplay(vector.sequence, vector.hash, {
        sequence: vector.previousSequence,
        hash: vector.previousHash,
      });
    if (vector.expected === 'sequence_conflict')
      expect(replay).toThrow('State stream is blocked');
    else expect(replay()).toBe(vector.expected === 'replay');
  }
});

test('fences A to B to A and recovery generations before replay checks', () => {
  expect(() =>
    assertStateScope(progress.accountId, progress.generation, progress),
  ).not.toThrow();
  expect(() =>
    assertStateScope('fixture-account-b', progress.generation, progress),
  ).toThrow('Account changed');
  expect(() =>
    assertStateScope(
      progress.accountId,
      '00000000-0000-0000-0000-000000000000',
      progress,
    ),
  ).toThrow('State reconciliation required');
  expect(() =>
    assertStateScope(progress.accountId, progress.generation, progress),
  ).not.toThrow();
});

test('uses explicit completion and source-time positions', () => {
  for (const vector of fixtures.completion)
    expect(
      progressIntent(
        vector.event as ProgressEvent,
        vector.positionSeconds,
        vector.previousCompleted,
      ),
    ).toEqual({
      positionSeconds: vector.expectedPositionSeconds,
      completed: vector.expectedCompleted,
    });
  for (const position of [
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    2147483648,
  ])
    expect(() => progressIntent('checkpoint', position, false)).toThrow(
      'Invalid source position',
    );
});
