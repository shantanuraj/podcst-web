import { isAccountOperationId } from './account-erasure';

export interface DeletionPreparation {
  accountId: string;
  operationId: string;
  receipt: string;
  expiresAt: string;
  proofExpiresAt: string;
}
export const cleanupSteps = ['retire', 'credentials', 'media', 'data'] as const;
export type CleanupStep = (typeof cleanupSteps)[number];
export interface AccountDeletion {
  version: 1;
  accountId: string;
  operation?: Omit<DeletionPreparation, 'accountId' | 'receipt'> & {
    receipt?: string;
  };
  outcome: 'unsubmitted' | 'unknown' | 'pending' | 'completed';
  cleanup?: { reason: 'server' | 'local'; next: CleanupStep | 'complete' };
}
export interface DeletionStorage {
  read(account: string): Promise<unknown>;
  write(account: string, record: AccountDeletion | null): Promise<void>;
  exclusive<T>(account: string, work: () => Promise<T>): Promise<T>;
}
export interface DeletionEffects {
  verifiedAccount(): string | null | undefined;
  suspend(account: string): Promise<void>;
  resume(account: string): Promise<void>;
  prepare(account: string): Promise<unknown>;
  submit(account: string, operationId: string, code: string): Promise<unknown>;
  status(receipt: string): Promise<unknown>;
  cleanup: Record<CleanupStep, (account: string) => Promise<void>>;
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const accountID = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 256;
const instant = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));
const receipt = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const operationFields = [
  'operationId',
  'receipt',
  'expiresAt',
  'proofExpiresAt',
];
const fields = (value: Record<string, unknown>, names: string[]) =>
  Object.keys(value).every((key) => names.includes(key));
const operation = (
  value: unknown,
): value is NonNullable<AccountDeletion['operation']> =>
  object(value) &&
  isAccountOperationId(value.operationId) &&
  (value.receipt === undefined || receipt(value.receipt)) &&
  instant(value.expiresAt) &&
  instant(value.proofExpiresAt) &&
  Date.parse(value.proofExpiresAt) <= Date.parse(value.expiresAt);

export function parseDeletionPreparation(
  value: unknown,
  account: string,
): DeletionPreparation {
  if (
    !object(value) ||
    value.accountId !== account ||
    !fields(value, [...operationFields, 'accountId']) ||
    !operation(value) ||
    !receipt(value.receipt)
  )
    throw new Error('Invalid deletion preparation');
  return {
    accountId: account,
    operationId: value.operationId,
    receipt: value.receipt,
    expiresAt: value.expiresAt,
    proofExpiresAt: value.proofExpiresAt,
  };
}
export function parseAccountDeletion(
  value: unknown,
  account: string,
): AccountDeletion | null {
  if (value === null || value === undefined) return null;
  if (
    !object(value) ||
    !fields(value, [
      'version',
      'accountId',
      'operation',
      'outcome',
      'cleanup',
    ]) ||
    value.version !== 1 ||
    !accountID(account) ||
    value.accountId !== account ||
    !['unsubmitted', 'unknown', 'pending', 'completed'].includes(
      String(value.outcome),
    ) ||
    (value.operation !== undefined &&
      (!operation(value.operation) ||
        !fields(value.operation, operationFields))) ||
    (value.outcome === 'completed' && !value.cleanup) ||
    (!value.operation &&
      ['pending', 'completed'].includes(String(value.outcome))) ||
    (value.cleanup !== undefined &&
      (!object(value.cleanup) ||
        !fields(value.cleanup, ['reason', 'next']) ||
        !['server', 'local'].includes(String(value.cleanup.reason)) ||
        ![...cleanupSteps, 'complete'].includes(String(value.cleanup.next)) ||
        (value.cleanup.reason === 'server' && value.outcome !== 'completed')))
  )
    throw new Error('Deletion state unavailable; recovery required');
  return structuredClone(value) as unknown as AccountDeletion;
}

export class AccountDeletionCoordinator {
  constructor(
    private readonly storage: DeletionStorage,
    private readonly effects: DeletionEffects,
    private readonly now: () => number = Date.now,
  ) {}

  async read(account: string) {
    if (!accountID(account)) throw new Error('Invalid deletion account');
    return parseAccountDeletion(await this.storage.read(account), account);
  }

  private current(account: string) {
    if (this.effects.verifiedAccount() !== account)
      throw new Error('Account changed; same verified account required');
  }
  private save(value: AccountDeletion) {
    return this.storage.write(value.accountId, value);
  }
  private async clean(value: AccountDeletion): Promise<AccountDeletion> {
    let record = value;
    while (record.cleanup && record.cleanup.next !== 'complete') {
      const step = record.cleanup.next;
      await this.effects.cleanup[step](record.accountId);
      record = {
        ...record,
        cleanup: {
          ...record.cleanup,
          next: cleanupSteps[cleanupSteps.indexOf(step) + 1] ?? 'complete',
        },
      };
      await this.save(record);
    }
    return record;
  }
  private async outcome(
    record: AccountDeletion,
    value: unknown,
    submission = false,
  ) {
    if (
      !object(value) ||
      !fields(value, [
        'status',
        ...(submission ? ['operationId'] : []),
        ...(value.status === 'pending' ? ['message'] : []),
      ]) ||
      (value.message !== undefined && typeof value.message !== 'string') ||
      ![
        'pending',
        'completed',
        ...(submission ? ['rejected'] : ['unknown']),
      ].includes(String(value.status)) ||
      (submission && value.operationId !== record.operation?.operationId)
    )
      throw new Error('Invalid deletion outcome; confirmation required');
    const outcome =
      value.status === 'rejected'
        ? 'unsubmitted'
        : (value.status as 'pending' | 'completed' | 'unknown');
    const next: AccountDeletion = {
      ...record,
      outcome,
      ...(outcome === 'completed' && !record.cleanup
        ? { cleanup: { reason: 'server', next: 'retire' } }
        : {}),
    };
    if (outcome === 'completed' && next.operation) {
      const { receipt: _receipt, ...operation } = next.operation;
      next.operation = operation;
    }
    await this.save(next);
    return this.clean(next);
  }

  prepare(account: string) {
    return this.storage.exclusive(account, async () => {
      this.current(account);
      const saved = await this.read(account);
      if (
        saved &&
        ((saved.outcome === 'unsubmitted' && saved.operation) ||
          !['unsubmitted', 'unknown'].includes(saved.outcome) ||
          saved.cleanup)
      )
        throw new Error(
          'A deletion request is already retained for this account',
        );
      const record: AccountDeletion = saved ?? {
        version: 1,
        accountId: account,
        outcome: 'unsubmitted',
      };
      await this.effects.suspend(account);
      this.current(account);
      await this.save(record);
      const response = parseDeletionPreparation(
        await this.effects.prepare(account),
        account,
      );
      const { accountId: _account, ...operation } = response;
      const next: AccountDeletion = {
        ...record,
        operation,
        outcome: 'unsubmitted',
      };
      await this.save(next);
      return next;
    });
  }

  cancel(account: string) {
    return this.storage.exclusive(account, async () => {
      const record = await this.read(account);
      if (record?.outcome !== 'unsubmitted' || record.cleanup)
        throw new Error('Submitted deletion cannot be cancelled');
      await this.storage.write(account, null);
      if (this.effects.verifiedAccount() === account)
        await this.effects.resume(account);
    });
  }

  submit(account: string, code: string) {
    return this.storage.exclusive(account, async () => {
      const record = await this.read(account);
      this.current(account);
      if (
        !record?.operation?.receipt ||
        record.cleanup ||
        !['unsubmitted', 'unknown'].includes(record.outcome) ||
        !/^\d{6}$/.test(code) ||
        this.now() >= Date.parse(record.operation.proofExpiresAt)
      )
        throw new Error(
          'Usable deletion proof required; check the retained receipt',
        );
      await this.effects.suspend(account);
      const unknown: AccountDeletion = { ...record, outcome: 'unknown' };
      await this.save(unknown);
      this.current(account);
      return this.outcome(
        unknown,
        await this.effects.submit(account, record.operation.operationId, code),
        true,
      );
    });
  }

  check(account: string) {
    return this.storage.exclusive(account, async () => {
      const record = await this.read(account);
      if (!record) return null;
      if (record.outcome === 'completed') return this.clean(record);
      if (!record.operation?.receipt) return this.clean(record);
      if (this.now() >= Date.parse(record.operation.expiresAt)) {
        const { receipt: _receipt, ...operation } = record.operation;
        const expired: AccountDeletion = {
          ...record,
          operation,
          outcome: record.outcome === 'unsubmitted' ? 'unsubmitted' : 'unknown',
        };
        await this.save(expired);
        return this.clean(expired);
      }
      const response = await this.effects.status(record.operation.receipt);
      if (record.outcome === 'unsubmitted') {
        if (!object(response) || response.status !== 'unknown')
          throw new Error('Unsubmitted deletion has an unexpected outcome');
        return record;
      }
      return this.outcome(record, response);
    });
  }

  eraseLocal(account: string) {
    return this.storage.exclusive(account, async () => {
      const record = (await this.read(account)) ?? {
        version: 1 as const,
        accountId: account,
        outcome: 'unknown' as const,
      };
      const next: AccountDeletion = record.cleanup
        ? record
        : {
            ...record,
            cleanup: { reason: 'local', next: 'retire' },
          };
      await this.save(next);
      return this.clean(next);
    });
  }

  retryCleanup(account: string) {
    return this.storage.exclusive(account, async () => {
      const record = await this.read(account);
      if (!record?.cleanup)
        throw new Error('Explicit cleanup authority required');
      return this.clean(record);
    });
  }
}
