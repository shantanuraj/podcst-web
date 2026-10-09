export const ACCOUNT_OPERATION_PENDING =
  'Account operation pending; try again shortly.';

export const isAccountOperationId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

export function requireCompletedAccountOperation(value: unknown) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !('operationId' in value) ||
    !isAccountOperationId(value.operationId) ||
    !('status' in value) ||
    !['pending', 'completed'].includes(String(value.status))
  )
    throw new Error('Invalid account operation response');
  if (value.status === 'pending') throw new Error(ACCOUNT_OPERATION_PENDING);
}
