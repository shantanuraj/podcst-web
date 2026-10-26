import { createHmac, timingSafeEqual } from 'node:crypto';
import { isAccountOperationId } from '@/shared/account-erasure';
import { readJsonBody } from '../http/json-body';

export interface DeletionRecord {
  operationId: string;
  accountId: string;
  acceptedAt: string;
}

export function parseDeletionRecord(value: unknown): DeletionRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid deletion record');
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(',') !==
      'acceptedAt,accountId,operationId' ||
    !isAccountOperationId(record.operationId) ||
    typeof record.accountId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,256}$/.test(record.accountId) ||
    typeof record.acceptedAt !== 'string' ||
    !Number.isFinite(Date.parse(record.acceptedAt)) ||
    new Date(record.acceptedAt).toISOString() !== record.acceptedAt
  )
    throw new Error('Invalid deletion record');
  return {
    operationId: record.operationId,
    accountId: record.accountId,
    acceptedAt: record.acceptedAt,
  };
}

export function deletionSignature(record: DeletionRecord, secret: string) {
  if (Buffer.byteLength(secret) < 32)
    throw new Error('Deletion journal key unavailable');
  return createHmac('sha256', secret)
    .update(
      JSON.stringify(['podcst-account-deletion', parseDeletionRecord(record)]),
    )
    .digest('hex');
}

export function verifyDeletionSignature(
  record: DeletionRecord,
  signature: unknown,
  secret: string,
) {
  return (
    typeof signature === 'string' &&
    /^[a-f0-9]{64}$/.test(signature) &&
    timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(deletionSignature(record, secret), 'hex'),
    )
  );
}

export function deletionJournal(url: string, secret: string) {
  const target = new URL(url);
  if (
    target.protocol !== 'https:' ||
    target.username ||
    target.password ||
    target.search ||
    target.hash
  )
    throw new Error('Deletion journal requires an HTTPS endpoint');
  return async (record: DeletionRecord) => {
    const signature = deletionSignature(record, secret);
    const signal = AbortSignal.timeout(10_000);
    const response = await fetch(target, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(record),
      signal,
    });
    if (!response.ok) throw new Error('Deletion journal unavailable');
    const acknowledgement = (await readJsonBody(
      { headers: response.headers, body: response.body, signal },
      2048,
      5000,
      {},
    )) as { signature?: unknown; operationId?: unknown };
    if (
      acknowledgement?.signature !== signature ||
      acknowledgement?.operationId !== record.operationId
    )
      throw new Error('Deletion journal acknowledgement refused');
    return { signature };
  };
}
