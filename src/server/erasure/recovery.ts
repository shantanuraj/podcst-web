import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import type postgres from 'postgres';
import {
  canonical,
  entryHash,
  isDigest,
  isOperationId,
  JOURNAL_GENESIS,
  JournalError,
  verifyHead,
  verifyValue,
} from './journal-contract';
import type { createPostgresJournal, JournalKeys } from './journal-postgres';
import { assertAuthEpoch, authEpochKey, redisIdentity } from './recovery-auth';
import {
  type AdmissionBinding,
  type createRecoveryControl,
  type RecoveryPlan,
  recoveryIds,
} from './recovery-control';
import {
  assertServingPrivileges,
  assertWritersFenced,
  enableServingRole,
  fenceWriters,
  recoverySchema,
  recoverySchemaInTransaction,
} from './recovery-database';
import {
  CHECKPOINT_MAX_AGE_MS,
  type RecoveryManifest,
  readVerifiedReplay,
} from './recovery-manifest';
import {
  admissionBinding,
  databaseIdentity,
  recoveryRow,
  rowCursor,
} from './recovery-state';
import { createErasureService } from './service';

export function createRecoveryController({
  sql,
  journal,
  control,
  keys,
  redis,
  expected,
  now = () => new Date(),
  fault = async () => {},
}: {
  sql: postgres.Sql;
  journal: ReturnType<typeof createPostgresJournal>;
  control: ReturnType<typeof createRecoveryControl>;
  keys: JournalKeys;
  redis: Pick<Redis, 'get' | 'set' | 'scan' | 'info'>;
  expected: { schemaHash: string; catalogHash: string };
  now?: () => Date;
  fault?: (point: string) => Promise<void>;
}) {
  const schema = async () => {
    if (canonical(await recoverySchema(sql)) !== canonical(expected))
      throw new JournalError(503);
  };
  const service = (plan: RecoveryPlan) =>
    createErasureService(sql, {
      journal,
      journalId: plan.base.journalId,
      epoch: plan.provisionalEpoch,
      keys: keys.verification,
      proofSecret: randomBytes(32).toString('hex'),
      deliver: async () => {
        throw new JournalError(503);
      },
      now,
    });
  const runtimeProof = async (plan: RecoveryPlan, auth = true) => {
    if (
      plan.schemaHash !== expected.schemaHash ||
      plan.catalogHash !== expected.catalogHash
    )
      throw new JournalError(503);
    const binding = await admissionBinding(sql, plan.servingEpoch);
    binding.role = plan.servingRole;
    const proof = await control.check(binding);
    if (
      proof.value.schemaHash !== plan.schemaHash ||
      proof.value.catalogHash !== plan.catalogHash
    )
      throw new JournalError(503);
    if (auth)
      await assertAuthEpoch(
        redis,
        plan.authEpoch,
        plan.id,
        proof.value.redisIdentity,
      );
    return proof;
  };
  const captureManifest = async (
    binding: AdmissionBinding,
    exportArchive: (snapshot: string) => Promise<string>,
  ): Promise<RecoveryManifest> => {
    const createdAt = now();
    const capture = await sql.begin(
      'isolation level repeatable read read only',
      async (tx) => {
        const captured = await admissionBinding(tx, binding.writerEpoch);
        captured.role = binding.role;
        if (
          canonical(captured) !== canonical(binding) ||
          canonical(await recoverySchemaInTransaction(tx)) !==
            canonical(expected)
        )
          throw new JournalError(503);
        await tx`SET LOCAL idle_in_transaction_session_timeout = '1h'`;
        const [snapshot] = await tx`SELECT pg_export_snapshot() AS id`;
        return {
          artifactHash: await exportArchive(snapshot.id),
          base: captured.base,
        };
      },
    );
    return {
      version: 1,
      purpose: 'account-recovery-checkpoint',
      ...capture,
      schemaHash: expected.schemaHash,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(
        createdAt.getTime() + CHECKPOINT_MAX_AGE_MS,
      ).toISOString(),
    };
  };
  return {
    async recover(input: {
      id: string;
      mode?: RecoveryPlan['mode'];
      artifactHash: string | null;
      retiredRoles: string[];
      servingRole: string;
      restore?: () => Promise<void>;
      initialCheckpoint?: (snapshot: string) => Promise<string>;
    }) {
      if (
        !isOperationId(input.id) ||
        (input.artifactHash !== null && !isDigest(input.artifactHash))
      )
        throw new JournalError(400);
      const mode =
        input.mode ??
        (input.artifactHash === null ? 'bootstrap' : 'checkpoint');
      if (!['bootstrap', 'checkpoint', 'auth-rotation'].includes(mode))
        throw new JournalError(400);
      if (
        (mode === 'bootstrap') !==
        (typeof input.initialCheckpoint === 'function')
      )
        throw new JournalError(503);
      return control.exclusive(async (lease) => {
        const original = await lease.current();
        const target = await databaseIdentity(sql);
        if (original?.id === input.id && original.admitted) {
          if (
            original.plan.mode !== mode ||
            original.plan.artifactHash !== input.artifactHash ||
            original.plan.servingRole !== input.servingRole ||
            canonical(original.plan.retiredRoles) !==
              canonical(input.retiredRoles) ||
            original.plan.database.database !== target.database ||
            original.plan.database.oid !== target.oid ||
            original.plan.database.cluster !== target.cluster
          )
            throw new JournalError(409);
          const proof = await runtimeProof(original.plan);
          await enableServingRole(sql, original.plan);
          return proof;
        }
        await lease.close();
        await fenceWriters(
          sql,
          input.retiredRoles,
          input.servingRole,
          input.id,
        );
        await lease.assert();
        const head = verifyHead(await journal.head(), keys.verification);
        const artifact =
          mode === 'checkpoint' && input.artifactHash
            ? await control.artifact(
                input.artifactHash,
                expected.schemaHash,
                head.journalId,
              )
            : null;
        const previous =
          mode === 'auth-rotation'
            ? await control.history(
                (original?.id === input.id
                  ? original.plan.originRun
                  : original?.id) ?? '',
              )
            : null;
        const origin = artifact?.origin ?? previous;
        if (
          (previous &&
            (canonical(previous.database) !== canonical(target) ||
              previous.artifactHash !== input.artifactHash)) ||
          (origin &&
            (origin.schemaHash !== expected.schemaHash ||
              origin.catalogHash !== expected.catalogHash))
        )
          throw new JournalError(503);
        const plan: RecoveryPlan =
          original?.id === input.id
            ? original.plan
            : {
                ...recoveryIds(),
                id: input.id,
                mode,
                ...expected,
                artifactHash: input.artifactHash,
                base: artifact?.manifest.base ??
                  previous?.base ?? {
                    journalId: head.journalId,
                    sequence: '0',
                    hash: JOURNAL_GENESIS,
                  },
                originRun: origin?.runId ?? null,
                database: {
                  database: target.database,
                  oid: target.oid,
                  cluster: target.cluster,
                },
                retiredRoles: [...input.retiredRoles],
                servingRole: input.servingRole,
              };
        if (
          plan.mode !== mode ||
          plan.artifactHash !== input.artifactHash ||
          plan.servingRole !== input.servingRole ||
          canonical(plan.retiredRoles) !== canonical(input.retiredRoles) ||
          canonical({
            schemaHash: plan.schemaHash,
            catalogHash: plan.catalogHash,
          }) !== canonical(expected) ||
          plan.database.database !== target.database ||
          plan.database.oid !== target.oid ||
          plan.database.cluster !== target.cluster ||
          plan.base.journalId !== head.journalId ||
          (mode === 'bootstrap' &&
            original?.id !== plan.id &&
            head.sequence !== '0') ||
          (mode === 'checkpoint' && !artifact) ||
          (artifact &&
            artifact.origin.database.database === target.database &&
            artifact.origin.database.oid === target.oid &&
            artifact.origin.database.startedAt === target.startedAt)
        )
          throw new JournalError(503);
        await lease.start(plan);
        const [exists] =
          await sql`SELECT to_regclass('public.recovery_state') IS NOT NULL AS present`;
        const before = exists.present ? await recoveryRow(sql) : undefined;
        if (artifact && before?.artifact_hash !== plan.artifactHash) {
          if (!input.restore) throw new JournalError(503);
          await input.restore();
          await fault('after-restore');
        }
        await schema();
        await sql.begin(async (tx) => {
          await tx`SET LOCAL synchronous_commit = on`;
          const row = await recoveryRow(tx, true);
          if (artifact && row?.artifact_hash !== plan.artifactHash)
            throw new JournalError(503);
          if (row?.run_id === plan.id) {
            if (
              row.incarnation !== plan.incarnation ||
              row.journal_id !== plan.base.journalId ||
              BigInt(row.sequence) < BigInt(plan.base.sequence) ||
              (row.auth_epoch !== null &&
                (row.auth_epoch !== plan.authEpoch ||
                  row.generation !== plan.generation))
            )
              throw new JournalError(503);
            return;
          }
          if (
            origin
              ? !row ||
                row.run_id !== origin.runId ||
                row.incarnation !== origin.incarnation ||
                canonical(rowCursor(row)) !== canonical(plan.base) ||
                row.auth_epoch !== origin.authEpoch ||
                row.generation !== origin.generation ||
                (previous !== null &&
                  row.artifact_hash !== previous.artifactHash)
              : !!row
          )
            throw new JournalError(503);
          await tx`INSERT INTO recovery_state (run_id, incarnation, journal_id, sequence, hash) VALUES (${plan.id}, ${plan.incarnation}, ${plan.base.journalId}, ${plan.base.sequence}::bigint, ${plan.base.hash})
            ON CONFLICT (singleton) DO UPDATE SET run_id = excluded.run_id, incarnation = excluded.incarnation, journal_id = excluded.journal_id, sequence = excluded.sequence, hash = excluded.hash, auth_epoch = NULL, generation = NULL`;
        });
        const erasure = service(plan);
        const replay = async (
          sealed: Awaited<ReturnType<typeof journal.seal>>,
        ) => {
          for await (const page of readVerifiedReplay(
            journal,
            plan.base,
            sealed,
            keys.verification,
          )) {
            for (const raw of page.entries) {
              const envelope = structuredClone(raw);
              await lease.assert();
              await assertWritersFenced(sql, [
                ...plan.retiredRoles,
                plan.servingRole,
              ]);
              const entry = envelope.value;
              await sql.begin(async (tx) => {
                await tx`SET LOCAL synchronous_commit = on`;
                const state = await recoveryRow(tx, true);
                if (
                  state?.run_id !== plan.id ||
                  state.incarnation !== plan.incarnation
                )
                  throw new JournalError(503);
                const ahead = BigInt(entry.sequence) > BigInt(state.sequence);
                if (
                  ahead &&
                  (BigInt(entry.sequence) !== BigInt(state.sequence) + 1n ||
                    entry.previousHash !== state.hash)
                )
                  throw new JournalError(503);
                if (
                  entry.sequence === state.sequence &&
                  entryHash(entry) !== state.hash
                )
                  throw new JournalError(503);
                await erasure.replay(envelope, tx);
                const p = entry.payload;
                const survivors =
                  p.action === 'erase_account'
                    ? await tx`SELECT 1 FROM users WHERE id = ${p.accountId}`
                    : await tx`SELECT 1 FROM passkeys WHERE user_id = ${p.accountId} AND id = ${p.credentialId}`;
                if (survivors.length) throw new JournalError(503);
                await fault('after-apply');
                if (ahead)
                  await tx`UPDATE recovery_state SET sequence = ${entry.sequence}::bigint, hash = ${entryHash(entry)} WHERE singleton`;
                await fault('after-watermark');
              });
              await fault('after-replay-commit');
            }
          }
          const state = await recoveryRow(sql);
          if (
            !state ||
            state.sequence !== sealed.value.sequence ||
            state.hash !== sealed.value.hash
          )
            throw new JournalError(503);
        };
        let current = await journal.head();
        if (
          current.value.epoch !== plan.provisionalEpoch &&
          current.value.epoch !== plan.servingEpoch
        ) {
          await fault('before-initial-seal');
          await replay(await journal.seal(current.value.epoch));
          await lease.assert();
          current = await journal.openEpoch(
            verifyHead(await journal.head(), keys.verification),
            plan.provisionalEpoch,
          );
          await fault('after-provisional-open');
        }
        if (current.value.epoch === plan.provisionalEpoch) {
          if (!current.value.sealed) {
            await sql`UPDATE account_erasure_intents SET claim_token = NULL, claim_expires_at = NULL WHERE applied_at IS NULL`;
            for (;;) {
              await lease.assert();
              const rows =
                await sql`SELECT operation_id FROM account_erasure_intents WHERE applied_at IS NULL ORDER BY accepted_at, operation_id LIMIT 100`;
              if (!rows.length) break;
              for (const row of rows) {
                if (
                  (await erasure.reconcile(row.operation_id)).status !==
                  'completed'
                )
                  throw new JournalError(503);
                await fault('after-pending-intent');
              }
            }
            current = await journal.seal(plan.provisionalEpoch);
          }
          await replay(current);
        } else if (current.value.epoch !== plan.servingEpoch)
          throw new JournalError(503);
        await lease.assert();
        await assertWritersFenced(sql, [
          ...plan.retiredRoles,
          plan.servingRole,
        ]);
        if (
          (
            await sql`SELECT 1 FROM account_erasure_intents WHERE applied_at IS NULL LIMIT 1`
          ).length
        )
          throw new JournalError(503);
        await sql`UPDATE account_erasure_intents SET claim_token = NULL, claim_expires_at = NULL WHERE claim_token IS NOT NULL`;
        let scan = '0';
        do {
          const [next, flows] = await redis.scan(
            scan,
            'MATCH',
            `auth:flow:${plan.authEpoch}:*`,
            'COUNT',
            100,
          );
          if (flows.length) throw new JournalError(503);
          scan = next;
        } while (scan !== '0');
        await redis.set(authEpochKey(plan.authEpoch), plan.id, 'NX');
        const cacheIdentity = await redisIdentity(redis);
        await assertAuthEpoch(redis, plan.authEpoch, plan.id, cacheIdentity);
        await fault('after-redis-retirement');
        await sql.begin(async (tx) => {
          await tx`SET LOCAL synchronous_commit = on`;
          const state = await recoveryRow(tx, true);
          if (state?.run_id !== plan.id) throw new JournalError(503);
          if (!state.auth_epoch) {
            await tx`DELETE FROM sessions`;
            await tx`DELETE FROM email_verifications`;
            await tx`DELETE FROM account_erasure_proofs`;
            await tx`UPDATE oauth_accounts SET access_token = NULL, refresh_token = NULL, expires_at = NULL`;
            await tx`UPDATE state_generation SET generation = ${plan.generation} WHERE singleton`;
            await tx`UPDATE recovery_state SET auth_epoch = ${plan.authEpoch}, generation = ${plan.generation} WHERE singleton`;
          }
          await tx`UPDATE recovery_state SET database_oid = (SELECT oid FROM pg_database WHERE datname = current_database()),
            database_cluster = (SELECT system_identifier::text FROM pg_control_system()), database_started_at = pg_postmaster_start_time(), serving_role = ${plan.servingRole} WHERE singleton`;
          const unsafe =
            await tx`SELECT 1 FROM sessions UNION ALL SELECT 1 FROM email_verifications UNION ALL SELECT 1 FROM account_erasure_proofs UNION ALL SELECT 1 FROM oauth_accounts WHERE access_token IS NOT NULL OR refresh_token IS NOT NULL OR expires_at IS NOT NULL`;
          if (unsafe.length) throw new JournalError(503);
          await fault('before-auth-commit');
        });
        await fault('after-auth-commit');
        await schema();
        await assertServingPrivileges(sql, plan.servingRole);
        await lease.assert();
        current = await journal.head();
        if (
          current.value.epoch === plan.provisionalEpoch &&
          current.value.sealed
        ) {
          current = await journal.openEpoch(
            verifyHead(current, keys.verification),
            plan.servingEpoch,
          );
          await fault('after-serving-open');
        }
        const finalHead = verifyHead(current, keys.verification);
        const binding = await admissionBinding(sql, plan.servingEpoch);
        binding.role = plan.servingRole;
        if (
          finalHead.epoch !== plan.servingEpoch ||
          finalHead.sealed ||
          binding.base.sequence !== finalHead.sequence ||
          binding.base.hash !== finalHead.hash ||
          binding.artifactHash !== plan.artifactHash ||
          binding.authEpoch !== plan.authEpoch ||
          binding.generation !== plan.generation
        )
          throw new JournalError(503);
        let checkpoint: RecoveryManifest | undefined;
        if (input.initialCheckpoint) {
          await fault('before-initial-capture');
          checkpoint = await captureManifest(binding, input.initialCheckpoint);
          await fault('after-initial-capture');
          const captured = await admissionBinding(sql, plan.servingEpoch);
          captured.role = plan.servingRole;
          if (canonical(captured) !== canonical(binding))
            throw new JournalError(503);
        }
        await assertWritersFenced(sql, [
          ...plan.retiredRoles,
          plan.servingRole,
        ]);
        await assertAuthEpoch(redis, plan.authEpoch, plan.id, cacheIdentity);
        await fault('before-admit');
        const proof = await lease.admit(
          plan,
          {
            ...binding,
            version: 1,
            purpose: 'recovery-admission',
            artifactHash: plan.artifactHash,
            redisIdentity: cacheIdentity,
            ...expected,
            head: finalHead,
          },
          checkpoint,
        );
        await fault('after-admit');
        await lease.assert();
        await enableServingRole(sql, plan);
        return proof;
      });
    },
    async capture(exportArchive: (snapshot: string) => Promise<string>) {
      const run = await control.current();
      if (!run?.admitted || !run.attestation) throw new JournalError(503);
      const origin = await runtimeProof(run.plan, false);
      const {
        version: _v,
        purpose: _p,
        schemaHash: _s,
        catalogHash: _c,
        redisIdentity: _r,
        head: _h,
        ...binding
      } = verifyValue(origin, keys.verification);
      const manifest = await captureManifest(binding, exportArchive);
      await fault('before-manifest-register');
      return control.register(manifest, origin);
    },
  };
}
