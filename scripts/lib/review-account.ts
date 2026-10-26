import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { lockEmailIdentity } from '../../src/server/auth/email-service';
import { isEmail } from '../../src/server/auth/http';
import {
  normalizeEmailIdentity,
  type ReviewStore,
} from '../../src/server/auth/review-credential';
import { generateId } from '../../src/server/auth/session-record';
import { loadMigrations } from '../migrations';
import {
  captureSchemaInTransaction,
  compareSchemas,
  type InventoryArtifact,
  inventoryArtifact,
} from '../schema-catalog';
import { digest } from './artifacts';
import { accountInventory, ReviewAccountError } from './review-account-state';
import { applyReviewSeed, type ResolvedReviewSeed } from './review-seed';

export { ReviewAccountError } from './review-account-state';

export type ReviewAction = 'create' | 'reset' | 'rotate' | 'remove';

export interface ReviewIdentity {
  store: ReviewStore;
  email: string;
  target: 'production' | 'development';
}

export interface ReviewPlan {
  format: 'podcst-review-plan/1';
  identity: ReviewIdentity;
  action: ReviewAction;
  operationId: string;
  submission: string;
  expectedUserId: string | null;
  sourceDigest: string;
  schemaDigest: string;
  databaseDigest: string;
  account: Awaited<ReturnType<typeof accountInventory>>;
  seed: { revision: string; digest: string } | null;
  credentialDigest: string | null;
}

interface Registration {
  store: ReviewStore;
  user_id: string;
  email: string;
  code_digest: string;
  operation_id: string;
  operation_digest: string;
  operation_kind: 'create' | 'reset' | 'rotate';
  seed_revision: string | null;
  seed_digest: string | null;
  submission: string;
  completed_at: Date;
}

export async function readReviewRegistration(
  tx: postgres.ISql,
  store: ReviewStore,
  lock = false,
) {
  const [row] = await tx<Registration[]>`
    SELECT r.store, r.user_id, r.code_digest, r.operation_id, r.operation_digest,
      r.operation_kind, r.seed_revision, r.seed_digest, r.submission, r.completed_at, u.email
    FROM review_accounts r JOIN users u ON u.id = r.user_id
    WHERE r.store = ${store} ${lock ? tx`FOR UPDATE OF r` : tx``}
  `;
  return row;
}

export function reviewReceipt(row: Registration) {
  return {
    store: row.store,
    operationId: row.operation_id,
    action: row.operation_kind,
    userId: row.user_id,
    seedRevision: row.seed_revision,
    seedDigest: row.seed_digest,
    submission: row.submission,
    completedAt: row.completed_at.toISOString(),
  };
}

async function databaseDigest(tx: postgres.ISql) {
  const [server] = await tx`SELECT current_database() AS database,
    current_user AS role, inet_server_addr()::text AS address, inet_server_port() AS port,
    system_identifier::text AS cluster FROM pg_control_system()`;
  return digest(server);
}

async function schemaState(tx: postgres.TransactionSql) {
  const snapshot = await captureSchemaInTransaction(tx);
  await tx`SET LOCAL search_path = public`;
  await tx`SET LOCAL lock_timeout = '3s'`;
  await tx`SET LOCAL idle_in_transaction_session_timeout = '30s'`;
  const applied =
    await tx`SELECT name, checksum FROM podcst_migrations.history ORDER BY name`;
  if (
    digest(Array.from(applied)) !==
    digest(loadMigrations().map(({ name, checksum }) => ({ name, checksum })))
  )
    throw new ReviewAccountError(
      'Migration ledger differs from the active source',
    );
  return {
    snapshot,
    schemaDigest: digest(snapshot.objects),
    databaseDigest: await databaseDigest(tx),
  };
}

function assertIdentity(identity: ReviewIdentity) {
  if (
    !['apple', 'google'].includes(identity.store) ||
    !['production', 'development'].includes(identity.target) ||
    !isEmail(identity.email) ||
    identity.email !== normalizeEmailIdentity(identity.email)
  )
    throw new ReviewAccountError('Invalid normalized review account identity');
}

function validatePlan(plan: ReviewPlan) {
  if (plan?.format !== 'podcst-review-plan/1' || !plan.identity)
    throw new ReviewAccountError('Invalid review plan');
  assertIdentity(plan.identity);
  if (
    !['create', 'reset', 'rotate', 'remove'].includes(plan.action) ||
    !/^[a-f0-9-]{36}$/.test(plan.operationId) ||
    typeof plan.submission !== 'string' ||
    plan.submission.trim() !== plan.submission ||
    !plan.submission.length ||
    plan.submission.length > 200 ||
    /[\r\n]/.test(plan.submission) ||
    ![
      plan.sourceDigest,
      plan.schemaDigest,
      plan.databaseDigest,
      plan.account?.fingerprint,
    ].every((value) => /^[a-f0-9]{64}$/.test(value)) ||
    (plan.credentialDigest !== null &&
      !/^[a-f0-9]{64}$/.test(plan.credentialDigest)) ||
    (plan.action === 'create') !== (plan.expectedUserId === null) ||
    (['create', 'rotate'].includes(plan.action) &&
      plan.credentialDigest === null) ||
    ['create', 'reset'].includes(plan.action) !== (plan.seed !== null) ||
    (plan.action === 'remove' && plan.credentialDigest !== null)
  )
    throw new ReviewAccountError('Invalid review plan fields');
}

async function expectedAccount(
  tx: postgres.ISql,
  identity: ReviewIdentity,
  action: ReviewAction,
  registration?: Registration,
) {
  if (action === 'create') {
    if (registration) throw new ReviewAccountError('Store is already enrolled');
    const existing =
      await tx`SELECT id FROM users WHERE lower(email) = ${identity.email}`;
    if (existing.length)
      throw new ReviewAccountError('Refusing to adopt an existing account');
  } else if (!registration || registration.email !== identity.email) {
    throw new ReviewAccountError('Enrolled store and email do not match');
  }
}

export async function planReviewAccount(
  sql: postgres.Sql,
  input: {
    identity: ReviewIdentity;
    action: ReviewAction;
    submission: string;
    sourceDigest: string;
    credentialDigest: string | null;
  },
  reference: InventoryArtifact,
  seed: ResolvedReviewSeed | null,
): Promise<ReviewPlan> {
  assertIdentity(input.identity);
  return sql.begin('isolation level repeatable read read only', async (tx) => {
    const schema = await schemaState(tx);
    if (
      !compareSchemas(reference, inventoryArtifact(schema.snapshot))
        .schemaMatches
    )
      throw new ReviewAccountError(
        'Database schema differs from the active reference',
      );
    const registration = await readReviewRegistration(tx, input.identity.store);
    await expectedAccount(tx, input.identity, input.action, registration);
    if (
      input.credentialDigest !== null &&
      input.credentialDigest === registration?.code_digest
    )
      throw new ReviewAccountError('Rotation requires a different code');
    const expectedUserId = registration?.user_id ?? null;
    const plan: ReviewPlan = {
      format: 'podcst-review-plan/1',
      ...input,
      operationId: randomUUID(),
      expectedUserId,
      schemaDigest: schema.schemaDigest,
      databaseDigest: schema.databaseDigest,
      account: await accountInventory(tx, expectedUserId, input.identity.email),
      seed: seed ? { revision: seed.revision, digest: digest(seed) } : null,
    };
    validatePlan(plan);
    return plan;
  });
}

export async function inspectReviewOperation(
  sql: postgres.Sql,
  plan: ReviewPlan,
) {
  validatePlan(plan);
  if ((await databaseDigest(sql)) !== plan.databaseDigest)
    throw new ReviewAccountError('Database does not match the planned target');
  const registration = await readReviewRegistration(sql, plan.identity.store);
  if (registration?.operation_id === plan.operationId) {
    if (
      registration.operation_digest !== digest(plan) ||
      registration.email !== plan.identity.email
    )
      throw new ReviewAccountError(
        'Operation ID has different preparation inputs',
      );
    return reviewReceipt(registration);
  }
  return null;
}

export async function applyReviewAccount(
  sql: postgres.Sql,
  plan: ReviewPlan,
  current: {
    sourceDigest: string;
    credentialDigest: string | null;
    seed: ResolvedReviewSeed | null;
    target: ReviewIdentity['target'];
  },
) {
  validatePlan(plan);
  if (current.target !== plan.identity.target)
    throw new ReviewAccountError('Explicit target does not match the plan');
  return sql.begin(async (tx) => {
    await tx`SET LOCAL lock_timeout = '3s'`;
    await tx`SET LOCAL statement_timeout = '15s'`;
    await lockEmailIdentity(tx, plan.identity.email);
    if ((await databaseDigest(tx)) !== plan.databaseDigest)
      throw new ReviewAccountError(
        'Database does not match the planned target',
      );
    await tx`SELECT pg_advisory_xact_lock(hashtext('review-account'), hashtext(${plan.identity.store}))`;
    const registration = await readReviewRegistration(
      tx,
      plan.identity.store,
      true,
    );
    if (registration?.operation_id === plan.operationId) {
      if (registration.operation_digest !== digest(plan))
        throw new ReviewAccountError(
          'Operation ID has different preparation inputs',
        );
      return reviewReceipt(registration);
    }
    if (
      current.sourceDigest !== plan.sourceDigest ||
      current.credentialDigest !== plan.credentialDigest ||
      ((current.seed ? digest(current.seed) : null) !== plan.seed?.digest &&
        !(current.seed === null && plan.seed === null))
    )
      throw new ReviewAccountError(
        'Source, seed or credential changed; make a new plan',
      );
    await expectedAccount(tx, plan.identity, plan.action, registration);
    if ((registration?.user_id ?? null) !== plan.expectedUserId)
      throw new ReviewAccountError('Account identity changed; make a new plan');
    if (registration)
      await tx`SELECT id FROM users WHERE id = ${registration.user_id} FOR UPDATE`;
    const schema = await schemaState(tx);
    if (
      schema.schemaDigest !== plan.schemaDigest ||
      schema.databaseDigest !== plan.databaseDigest
    )
      throw new ReviewAccountError(
        'Database or schema changed; make a new plan',
      );
    const account = await accountInventory(
      tx,
      plan.expectedUserId,
      plan.identity.email,
      true,
    );
    if (digest(account) !== digest(plan.account))
      throw new ReviewAccountError('Account state changed; make a new plan');
    await tx`DELETE FROM email_verifications WHERE lower(email) = ${plan.identity.email}`;
    if (plan.action === 'remove') {
      await tx`DELETE FROM sessions WHERE user_id = ${plan.expectedUserId}`;
      await tx`DELETE FROM passkeys WHERE user_id = ${plan.expectedUserId}`;
      await tx`DELETE FROM review_accounts WHERE store = ${plan.identity.store}`;
      return {
        store: plan.identity.store,
        operationId: plan.operationId,
        action: 'remove' as const,
      };
    }
    let userId = registration?.user_id;
    if (plan.action === 'reset')
      await tx`DELETE FROM users WHERE id = ${plan.expectedUserId}`;
    if (plan.action === 'create' || plan.action === 'reset') {
      userId = generateId();
      await tx`INSERT INTO users (id, email) VALUES (${userId}, ${plan.identity.email})`;
      if (!current.seed) throw new ReviewAccountError('Resolved seed required');
      await applyReviewSeed(tx, userId, current.seed);
    } else {
      await tx`DELETE FROM sessions WHERE user_id = ${userId ?? ''}`;
      await tx`DELETE FROM passkeys WHERE user_id = ${userId ?? ''}`;
    }
    const codeDigest = plan.credentialDigest ?? registration?.code_digest;
    if (!userId || !codeDigest)
      throw new ReviewAccountError('Missing enrolled account credential');
    await tx`
      INSERT INTO review_accounts (store, user_id, code_digest, operation_id, operation_digest,
        operation_kind, seed_revision, seed_digest, submission)
      VALUES (${plan.identity.store}, ${userId}, ${codeDigest}, ${plan.operationId}, ${digest(plan)},
        ${plan.action}, ${plan.seed?.revision ?? registration?.seed_revision ?? null},
        ${plan.seed?.digest ?? registration?.seed_digest ?? null}, ${plan.submission})
      ON CONFLICT (store) DO UPDATE SET user_id = EXCLUDED.user_id, code_digest = EXCLUDED.code_digest,
        operation_id = EXCLUDED.operation_id, operation_digest = EXCLUDED.operation_digest,
        operation_kind = EXCLUDED.operation_kind, seed_revision = EXCLUDED.seed_revision,
        seed_digest = EXCLUDED.seed_digest, submission = EXCLUDED.submission, completed_at = clock_timestamp()
    `;
    await tx`SET CONSTRAINTS ALL IMMEDIATE`;
    const result = await readReviewRegistration(tx, plan.identity.store);
    if (!result) throw new ReviewAccountError('Preparation receipt missing');
    return reviewReceipt(result);
  });
}
