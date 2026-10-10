import type postgres from 'postgres';
import { JournalError, type ReplayCursor } from './journal-contract';
import type { AdmissionBinding, DatabaseIdentity } from './recovery-control';

export interface RecoveryRow {
  run_id: string;
  incarnation: string;
  journal_id: string;
  sequence: string;
  hash: string;
  artifact_hash: string | null;
  auth_epoch: string | null;
  generation: string | null;
}
export const rowCursor = (row: RecoveryRow): ReplayCursor => ({
  journalId: row.journal_id,
  sequence: String(row.sequence),
  hash: row.hash,
});
export async function databaseIdentity(
  sql: postgres.ISql,
): Promise<DatabaseIdentity> {
  const [row] =
    await sql`SELECT current_database() AS database, oid::text, pg_postmaster_start_time() AS started_at, (SELECT system_identifier::text FROM pg_control_system()) AS cluster FROM pg_database WHERE datname = current_database()`;
  return {
    database: row.database,
    oid: row.oid,
    startedAt: row.started_at.toISOString(),
    cluster: row.cluster,
  };
}
export async function recoveryRow(sql: postgres.ISql, lock = false) {
  const [row] = await sql<
    RecoveryRow[]
  >`SELECT run_id, incarnation, journal_id, sequence::text, hash, artifact_hash, auth_epoch, generation FROM public.recovery_state WHERE singleton ${lock ? sql`FOR UPDATE` : sql``}`;
  return row;
}
export async function admissionBinding(
  sql: postgres.ISql,
  writerEpoch: string,
): Promise<AdmissionBinding> {
  const row = await recoveryRow(sql);
  const [state] =
    await sql`SELECT generation FROM public.state_generation WHERE singleton`;
  const [role] = await sql`SELECT current_user AS name`;
  if (
    !row?.auth_epoch ||
    !row.generation ||
    state?.generation !== row.generation
  )
    throw new JournalError(503);
  return {
    artifactHash: row.artifact_hash,
    runId: row.run_id,
    incarnation: row.incarnation,
    database: await databaseIdentity(sql),
    role: role.name,
    writerEpoch,
    authEpoch: row.auth_epoch,
    generation: row.generation,
    base: rowCursor(row),
  };
}
