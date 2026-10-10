import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type postgres from 'postgres';
import {
  canonical,
  digest,
  isDigest,
  isOperationId,
  JournalError,
  type JournalHead,
  type ReplayCursor,
  type Signed,
  signValue,
  verifyHead,
  verifyValue,
} from './journal-contract';
import { decryptEvidence, encryptEvidence } from './journal-crypto';
import type { createPostgresJournal, JournalKeys } from './journal-postgres';
import {
  type RecoveryManifest,
  verifyCheckpointManifest,
} from './recovery-manifest';

export interface DatabaseIdentity {
  database: string;
  oid: string;
  startedAt: string;
  cluster: string;
}
export interface RecoveryPlan {
  mode: 'bootstrap' | 'checkpoint' | 'auth-rotation';
  id: string;
  incarnation: string;
  artifactHash: string | null;
  base: ReplayCursor;
  originRun: string | null;
  schemaHash: string;
  catalogHash: string;
  database: Pick<DatabaseIdentity, 'database' | 'oid' | 'cluster'>;
  retiredRoles: string[];
  servingRole: string;
  provisionalEpoch: string;
  servingEpoch: string;
  authEpoch: string;
  generation: string;
}
export interface AdmissionBinding {
  artifactHash: string | null;
  runId: string;
  incarnation: string;
  database: DatabaseIdentity;
  role: string;
  writerEpoch: string;
  authEpoch: string;
  generation: string;
  base: ReplayCursor;
}
export interface AdmissionAttestation extends AdmissionBinding {
  version: 1;
  purpose: 'recovery-admission';
  redisIdentity: string;
  schemaHash: string;
  catalogHash: string;
  head: JournalHead;
}
export interface AdmissionResponse {
  purpose: 'admission-response';
  nonce: string;
  runId: string;
  incarnation: string;
  writerEpoch: string;
}
export interface RecoveryRun {
  id: string;
  plan: RecoveryPlan;
  runtime_digest: string;
  runtime_key: string;
  runtime_token: Buffer;
  attestation: Signed<AdmissionAttestation> | null;
  admitted: boolean;
  abandoned: boolean;
}
const LOCK = 784121;

export function createRecoveryControl(
  sql: postgres.Sql,
  journal: ReturnType<typeof createPostgresJournal>,
  keys: JournalKeys,
  now = () => new Date(),
) {
  const sign = <T>(value: T) => signValue(value, keys.current, keys.signing);
  const current = async (db: postgres.ISql = sql) => {
    const [row] = await db<
      RecoveryRun[]
    >`SELECT r.* FROM erasure_authority.recovery_gate g JOIN erasure_authority.recovery_runs r ON r.id = g.run_id WHERE g.singleton`;
    return row;
  };
  const verifyAdmission = async (run: RecoveryRun) => {
    if (!run?.admitted || run.abandoned || !run.attestation)
      throw new JournalError(503);
    const proof = verifyValue(run.attestation, keys.verification);
    if (
      proof.version !== 1 ||
      proof.purpose !== 'recovery-admission' ||
      proof.runId !== run.id
    )
      throw new JournalError(503);
    const [head] =
      await sql`SELECT journal_id, epoch, sealed, sequence::text, revision::text, hash FROM erasure_authority.head WHERE singleton`;
    if (
      !head ||
      head.journal_id !== proof.head.journalId ||
      head.epoch !== proof.writerEpoch ||
      head.sealed ||
      BigInt(head.revision) < BigInt(proof.head.revision) ||
      BigInt(head.sequence) < BigInt(proof.head.sequence) ||
      (head.sequence === proof.head.sequence && head.hash !== proof.head.hash)
    )
      throw new JournalError(503);
    return proof;
  };
  const check = async (binding: AdmissionBinding) => {
    const run = await current();
    const proof = await verifyAdmission(run);
    const {
      version: _v,
      purpose: _p,
      schemaHash: _s,
      catalogHash: _c,
      redisIdentity: _r,
      head: _h,
      ...expected
    } = proof;
    if (canonical(binding) !== canonical(expected)) throw new JournalError(503);
    if ((await current())?.id !== run.id || !(await current())?.admitted)
      throw new JournalError(503);
    return run.attestation as Signed<AdmissionAttestation>;
  };
  return {
    current,
    check,
    async runtime(hash: string) {
      const run = await current();
      return (
        !!run?.admitted &&
        !run.abandoned &&
        isDigest(hash) &&
        isDigest(run.runtime_digest) &&
        timingSafeEqual(
          Buffer.from(hash, 'hex'),
          Buffer.from(run.runtime_digest, 'hex'),
        )
      );
    },
    async credential(id: string) {
      const run = await current();
      if (!run?.admitted || run.id !== id || run.abandoned)
        throw new JournalError(503);
      await verifyAdmission(run);
      const token = decryptEvidence(
        Buffer.from(run.runtime_token),
        keys.encryption.get(run.runtime_key),
        ['runtime-credential', run.plan.base.journalId, id, run.runtime_key],
      ).toString();
      if (digest(`Bearer ${token}`) !== run.runtime_digest)
        throw new JournalError(503);
      return token;
    },
    async history(id: string) {
      const [run] = await sql<
        RecoveryRun[]
      >`SELECT * FROM erasure_authority.recovery_runs WHERE id = ${id}`;
      if (!run?.attestation) throw new JournalError(503);
      const proof = verifyValue(run.attestation, keys.verification);
      if (proof.version !== 1 || proof.purpose !== 'recovery-admission')
        throw new JournalError(503);
      return proof;
    },
    async probe(binding: AdmissionBinding, nonce: string) {
      if (!isOperationId(nonce)) throw new JournalError(400);
      const attestation = await check(binding);
      return sign({
        purpose: 'admission-probe' as const,
        nonce,
        attestation,
        response: sign<AdmissionResponse>({
          purpose: 'admission-response',
          nonce,
          runId: binding.runId,
          incarnation: binding.incarnation,
          writerEpoch: binding.writerEpoch,
        }),
      });
    },
    async publication(epoch: string) {
      const proof = await verifyAdmission(await current());
      if (proof.writerEpoch !== epoch) throw new JournalError(409);
    },
    async artifact(hash: string, schemaHash: string, journalId: string) {
      if (!isDigest(hash)) throw new JournalError(503);
      const [row] =
        await sql`SELECT manifest, origin_run, eligible FROM erasure_authority.recovery_artifacts WHERE digest = ${hash}`;
      if (!row?.eligible) throw new JournalError(503);
      const manifest = verifyCheckpointManifest(
        row.manifest,
        keys.verification,
        {
          artifactHash: hash,
          schemaHash,
          journalId,
          eligibleArtifacts: new Set([hash]),
          now: now(),
        },
      );
      const [origin] = await sql<
        RecoveryRun[]
      >`SELECT * FROM erasure_authority.recovery_runs WHERE id = ${row.origin_run}`;
      if (!origin?.attestation) throw new JournalError(503);
      const proof = verifyValue(origin.attestation, keys.verification);
      if (canonical(manifest.base) !== canonical(proof.base))
        throw new JournalError(503);
      return { manifest, origin: proof };
    },
    async register(
      manifest: RecoveryManifest,
      origin: Signed<AdmissionAttestation>,
    ) {
      const proof = verifyValue(origin, keys.verification);
      const envelope = sign(manifest);
      verifyCheckpointManifest(envelope, keys.verification, {
        artifactHash: manifest.artifactHash,
        schemaHash: proof.schemaHash,
        journalId: proof.base.journalId,
        eligibleArtifacts: new Set([manifest.artifactHash]),
        now: now(),
      });
      if (canonical(manifest.base) !== canonical(proof.base))
        throw new JournalError(503);
      await sql.begin(async (tx) => {
        await tx`SET LOCAL synchronous_commit = on`;
        await tx`SELECT singleton FROM erasure_authority.recovery_gate WHERE singleton FOR UPDATE`;
        const run = await current(tx);
        if (!run?.admitted || canonical(run.attestation) !== canonical(origin))
          throw new JournalError(503);
        await tx`INSERT INTO erasure_authority.recovery_artifacts (digest, manifest, origin_run) VALUES (${manifest.artifactHash}, ${tx.json(JSON.parse(canonical(envelope)))}, ${proof.runId})`;
      });
      return envelope;
    },
    async exclusive<T>(
      work: (lease: {
        assert: () => Promise<void>;
        current: () => Promise<RecoveryRun | undefined>;
        start: (plan: RecoveryPlan) => Promise<RecoveryRun>;
        close: () => Promise<void>;
        admit: (
          plan: RecoveryPlan,
          proof: AdmissionAttestation,
        ) => Promise<Signed<AdmissionAttestation>>;
        retireArtifact: (hash: string) => Promise<void>;
        abandon: (id: string) => Promise<void>;
      }) => Promise<T>,
    ) {
      const connection = await sql.reserve();
      await connection`SET synchronous_commit = on`;
      let locked = false;
      try {
        const [lock] =
          await connection`SELECT pg_try_advisory_lock(${LOCK}) AS held`;
        if (!lock.held) throw new JournalError(409);
        locked = true;
        const assert = async () => {
          const [lock] =
            await connection`SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND classid = 0 AND objid = ${LOCK} AND granted) AS held`;
          if (!lock.held) throw new JournalError(503);
        };
        const transaction = async <R>(
          action: (tx: postgres.ISql) => Promise<R>,
        ) => {
          await connection`BEGIN`;
          try {
            await assert();
            const result = await action(connection);
            await assert();
            await connection`COMMIT`;
            return result;
          } catch (error) {
            await connection`ROLLBACK`.catch(() => {});
            throw error;
          }
        };
        return await work({
          assert,
          current: () => current(connection),
          async close() {
            await transaction(async (tx) => {
              await tx`UPDATE erasure_authority.recovery_runs SET admitted = false WHERE id = (SELECT run_id FROM erasure_authority.recovery_gate WHERE singleton)`;
            });
          },
          async start(plan) {
            await assert();
            if (!isOperationId(plan.id)) throw new JournalError(503);
            return transaction(async (tx) => {
              await tx`SET LOCAL synchronous_commit = on`;
              const existing = await current(tx);
              if (existing?.id === plan.id) {
                if (
                  canonical(existing.plan) !== canonical(plan) ||
                  existing.abandoned
                )
                  throw new JournalError(409);
                return existing;
              }
              if (existing && !existing.attestation && !existing.abandoned)
                throw new JournalError(409);
              if (
                plan.mode === 'bootstrap' &&
                (
                  await tx`SELECT 1 FROM erasure_authority.recovery_runs LIMIT 1`
                ).length
              )
                throw new JournalError(409);
              if (
                (
                  await tx`SELECT 1 FROM erasure_authority.recovery_runs WHERE plan->>'servingRole' = ${plan.servingRole} OR plan->'retiredRoles' ? ${plan.servingRole} LIMIT 1`
                ).length
              )
                throw new JournalError(409);
              const token = randomBytes(32).toString('base64url');
              const encrypted = encryptEvidence(
                Buffer.from(token),
                keys.encryption.get(keys.current),
                [
                  'runtime-credential',
                  plan.base.journalId,
                  plan.id,
                  keys.current,
                ],
              );
              const [row] = await tx<
                RecoveryRun[]
              >`INSERT INTO erasure_authority.recovery_runs (id, plan, runtime_digest, runtime_key, runtime_token) VALUES (${plan.id}, ${tx.json(JSON.parse(canonical(plan)))}, ${digest(`Bearer ${token}`)}, ${keys.current}, ${encrypted}) RETURNING *`;
              await tx`INSERT INTO erasure_authority.recovery_gate (run_id) VALUES (${plan.id}) ON CONFLICT (singleton) DO UPDATE SET run_id = excluded.run_id`;
              return row;
            });
          },
          async admit(plan, proof) {
            await assert();
            const envelope = sign(proof);
            await transaction(async (tx) => {
              await tx`SET LOCAL synchronous_commit = on`;
              await tx`SELECT singleton FROM erasure_authority.recovery_gate WHERE singleton FOR UPDATE`;
              const run = await current(tx);
              if (
                run?.id !== plan.id ||
                run.abandoned ||
                canonical(run.plan) !== canonical(plan)
              )
                throw new JournalError(409);
              const head = verifyHead(await journal.head(), keys.verification);
              if (
                canonical(head) !== canonical(proof.head) ||
                head.epoch !== plan.servingEpoch ||
                head.sealed
              )
                throw new JournalError(503);
              await tx`UPDATE erasure_authority.recovery_runs SET attestation = ${tx.json(JSON.parse(canonical(envelope)))}, admitted = true WHERE id = ${plan.id}`;
            });
            return envelope;
          },
          async retireArtifact(hash) {
            await transaction(async (tx) => {
              await tx`UPDATE erasure_authority.recovery_artifacts SET eligible = false WHERE digest = ${hash}`;
            });
          },
          async abandon(id) {
            await transaction(async (tx) => {
              await tx`UPDATE erasure_authority.recovery_runs SET admitted = false, abandoned = true WHERE id = ${id}`;
            });
          },
        });
      } finally {
        if (locked)
          await connection`SELECT pg_advisory_unlock(${LOCK})`.catch(() => {});
        connection.release();
      }
    },
  };
}

export const recoveryIds = () => ({
  id: randomUUID(),
  incarnation: randomUUID(),
  provisionalEpoch: randomUUID(),
  servingEpoch: randomUUID(),
  authEpoch: randomUUID(),
  generation: randomUUID(),
});
