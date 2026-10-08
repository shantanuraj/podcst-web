import { expect, test } from 'bun:test';
import {
  emptyProgress,
  freezeProgress,
  queueProgress,
} from './progress-outbox';
import { progressSyncStatus } from './state-status';

const episodeId = '9007199254740993';
const otherId = '9007199254740994';

test('player status excludes failures and pending progress for other episodes', () => {
  const progress = emptyProgress();
  progress.failures = [otherId];
  expect(progressSyncStatus(progress, episodeId)).toBeUndefined();
  queueProgress(progress, otherId, 'played', 0);
  expect(progressSyncStatus(progress, episodeId)).toBeUndefined();
  progress.scope = {
    protocol: 1,
    accountId: 'account',
    generation: '17adbd84-d0e4-4e2d-ad9f-b084efee3211',
  };
  freezeProgress(progress);
  expect(progressSyncStatus(progress, episodeId)).toBeUndefined();
});

test('player identifies an unavailable current episode and clears the notice for new intent', () => {
  const progress = emptyProgress();
  progress.failures = [episodeId];
  expect(progressSyncStatus(progress, episodeId)).toBe(
    'Listening progress could not be saved because this episode is unavailable.',
  );
  queueProgress(progress, episodeId, 'checkpoint', 12);
  expect(progressSyncStatus(progress, episodeId)).toBe(
    'Saved on this device. Waiting to sync…',
  );
});

test('player preserves blocked streams and device errors without inventing progress for guest episodes', () => {
  const progress = emptyProgress();
  progress.blocked = 'Progress needs recovery';
  expect(progressSyncStatus(progress, episodeId)).toBe(progress.blocked);
  expect(progressSyncStatus(undefined, episodeId, 'Storage unavailable')).toBe(
    'Storage unavailable',
  );
  expect(progressSyncStatus(undefined, episodeId)).toBeUndefined();
  expect(progressSyncStatus(progress, undefined)).toBeUndefined();
});
