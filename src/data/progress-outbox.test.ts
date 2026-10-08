import { expect, test } from 'bun:test';
import {
  type ProgressBatch,
  type StateScope,
  stateValidator,
} from '@/shared/state-contract';
import {
  emptyProgress,
  freezeProgress,
  installProgress,
  progressProjection,
  queueProgress,
  validProgress,
} from './progress-outbox';

const scope: StateScope = {
  protocol: 1,
  accountId: 'fixture-a',
  generation: '17adbd84-d0e4-4e2d-ad9f-b084efee3211',
};
const id = '9007199254740993';
const state = () => ({ ...emptyProgress(), scope });
const checkpoint = { episodeId: id, positionSeconds: 95, completed: null };

test('offline checkpoint preserves a concrete known played projection while freezing literal null', () => {
  const outbox = state();
  outbox.saved[id] = { episodeId: id, positionSeconds: 0, completed: true };
  queueProgress(outbox, id, 'checkpoint', 95);
  expect(progressProjection(outbox).get(id)).toEqual({
    ...checkpoint,
    completed: true,
  });
  freezeProgress(outbox);
  expect(outbox.flight?.batch.changes).toEqual([checkpoint]);
  expect(JSON.parse(JSON.stringify(outbox.flight?.batch)).changes[0]).toEqual(
    checkpoint,
  );
  expect(progressProjection(outbox).get(id)?.completed).toBe(true);
  expect(validProgress(structuredClone(outbox))).toBe(true);
});
test.each([
  true,
  false,
])('unsent checkpoints retain explicit completion %s while coalescing positions', (completed) => {
  const outbox = state();
  outbox.saved[id] = {
    episodeId: id,
    positionSeconds: 0,
    completed: !completed,
  };
  queueProgress(outbox, id, completed ? 'played' : 'replay', 0);
  queueProgress(outbox, id, 'checkpoint', 94);
  queueProgress(outbox, id, 'checkpoint', 95);
  expect(outbox.queued).toEqual([
    { episodeId: id, positionSeconds: 0, completed },
    checkpoint,
  ]);
  expect(progressProjection(outbox).get(id)).toEqual({
    ...checkpoint,
    completed,
  });
  freezeProgress(outbox);
  expect(outbox.flight?.batch.changes).toHaveLength(2);
  queueProgress(outbox, id, 'replay', 12);
  expect(outbox.queued).toEqual([
    { episodeId: id, positionSeconds: 12, completed: false },
  ]);
  expect(progressProjection(outbox).get(id)?.completed).toBe(false);
});
test('newer explicit work never coalesces into an in-flight null checkpoint', () => {
  const outbox = state();
  queueProgress(outbox, id, 'checkpoint', 95);
  freezeProgress(outbox);
  const frozen = JSON.stringify(outbox.flight?.batch);
  queueProgress(outbox, id, 'played', 0);
  queueProgress(outbox, id, 'checkpoint', 100);
  freezeProgress(outbox);
  expect(JSON.stringify(outbox.flight?.batch)).toBe(frozen);
  expect(outbox.queued).toEqual([
    { episodeId: id, positionSeconds: 0, completed: true },
    { ...checkpoint, positionSeconds: 100 },
  ]);
  expect(progressProjection(outbox).get(id)?.completed).toBe(true);
});
test.each([
  true,
  false,
])('already frozen boolean %s payload survives edits and snapshots verbatim', (completed) => {
  const outbox = state();
  const batch: ProgressBatch = {
    ...scope,
    clientId: outbox.clientId,
    sequence: '1',
    changes: [{ ...checkpoint, completed }],
  };
  outbox.sequence = '1';
  outbox.flight = { batch };
  const frozen = JSON.stringify(batch);
  queueProgress(outbox, id, 'checkpoint', 100);
  installProgress(
    outbox,
    {
      ...scope,
      revision: '1',
      items: [
        {
          episodeId: id,
          progress: {
            positionSeconds: 12,
            completed: !completed,
            revision: '1',
            updatedAtMs: null,
          },
        },
      ],
    },
    scope.accountId,
    [id],
    false,
  );
  freezeProgress(outbox);
  expect(JSON.stringify(outbox.flight.batch)).toBe(frozen);
  expect(outbox.queued[0].completed).toBeNull();
  expect(validProgress(outbox)).toBe(true);
});
test('completed is required: null round-trips, while omitted or malformed values cannot freeze', () => {
  const outbox = state();
  queueProgress(outbox, id, 'checkpoint', 95);
  freezeProgress(outbox);
  const batch = outbox.flight?.batch;
  expect(
    stateValidator('progressBatch')(JSON.parse(JSON.stringify(batch))),
  ).toBe(true);
  for (const completed of [undefined, 'false', 0, {}, []]) {
    const malformed = { ...batch, changes: [{ ...checkpoint, completed }] };
    expect(stateValidator('progressBatch')(malformed)).toBe(false);
    expect(
      stateValidator('progressBatch')(JSON.parse(JSON.stringify(malformed))),
    ).toBe(false);
    const stored = { ...state(), queued: [{ ...checkpoint, completed }] };
    expect(validProgress(stored)).toBe(false);
    expect(() => freezeProgress(stored as never)).toThrow();
  }
});
test('snapshots and stored concrete completion reject null or omitted completion', () => {
  for (const completed of [null, undefined]) {
    const outbox = state();
    const snapshot = {
      ...scope,
      revision: '1',
      items: [
        {
          episodeId: id,
          progress: {
            positionSeconds: 95,
            completed,
            revision: '1',
            updatedAtMs: null,
          },
        },
      ],
    };
    expect(stateValidator('progressSnapshot')(snapshot)).toBe(false);
    expect(() => installProgress(outbox, snapshot, scope.accountId)).toThrow();
    expect(
      validProgress({
        ...outbox,
        saved: { [id]: { ...checkpoint, completed } },
      }),
    ).toBe(false);
  }
});
