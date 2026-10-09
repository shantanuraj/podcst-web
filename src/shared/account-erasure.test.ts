import { expect, test } from 'bun:test';
import pending from '../../contracts/fixtures/api/account-passkey-remove.pending.json';
import completed from '../../contracts/fixtures/api/account-passkey-remove.success.json';
import {
  ACCOUNT_OPERATION_PENDING,
  requireCompletedAccountOperation,
} from './account-erasure';

test('only an explicit completed account operation permits client removal', () => {
  expect(() => requireCompletedAccountOperation(completed)).not.toThrow();
  expect(() => requireCompletedAccountOperation(pending)).toThrow(
    ACCOUNT_OPERATION_PENDING,
  );
  for (const body of [
    null,
    {},
    { success: true },
    { status: 'completed' },
    { ...completed, status: 'unknown' },
    { ...completed, operationId: 1 },
  ])
    expect(() => requireCompletedAccountOperation(body)).toThrow();
});
