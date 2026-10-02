import type postgres from 'postgres';
import { digest, stable } from './lib/artifacts';
import {
  createMigrationLedger,
  loadMigrations,
  lockMigrations,
} from './migrations';
import {
  captureSchemaInTransaction,
  compareSchemas,
  type InventoryArtifact,
  inventoryArtifact,
  type SchemaSnapshot,
  validateInventory,
} from './schema-catalog';

export class AdoptionError extends Error {}

interface Target {
  systemId: string;
  databaseOid: string;
  database: string;
  operatorOid: string;
  operator: string;
  serverVersion: number;
  inRecovery: boolean;
}

interface RuntimeRole {
  oid: string;
  name: string;
  superuser: boolean;
  createRole: boolean;
  assumesOperator: boolean;
}

interface Review {
  format: 'podcst-baseline-review/1';
  inspectedAt: string;
  target: Target;
  runtime: RuntimeRole;
  baseline: { name: string; checksum: string };
  recoveryEvidenceDigest: string;
  reference: InventoryArtifact;
  observed: InventoryArtifact;
}

export interface BaselineReview {
  review: Review;
  digest: string;
}

function baseline() {
  const { name, checksum } = loadMigrations()[0];
  if (name !== '0000-baseline.sql')
    throw new AdoptionError('Unsupported adoption baseline');
  return { name, checksum };
}

async function binding(sql: postgres.ISql, runtimeName: string) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(runtimeName))
    throw new AdoptionError('A simple, explicit runtime role name is required');
  const [target] = await sql<Target[]>`
    SELECT c.system_identifier::text AS "systemId", d.oid::text AS "databaseOid",
      d.datname AS database, r.oid::text AS "operatorOid", r.rolname AS operator,
      current_setting('server_version_num')::int AS "serverVersion", pg_is_in_recovery() AS "inRecovery"
    FROM pg_control_system() c, pg_database d, pg_roles r
    WHERE d.datname = current_database() AND r.rolname = current_user
  `;
  const [runtime] = await sql<RuntimeRole[]>`
    SELECT r.oid::text AS oid, r.rolname AS name, r.rolsuper AS superuser,
      r.rolcreaterole AS "createRole", pg_has_role(r.oid, ${target.operatorOid}::oid, 'MEMBER') AS "assumesOperator"
    FROM pg_roles r WHERE r.rolname = ${runtimeName}
  `;
  if (!runtime) throw new AdoptionError('Runtime role does not exist');
  if (
    target.inRecovery ||
    runtime.superuser ||
    runtime.createRole ||
    runtime.assumesOperator ||
    runtime.oid === target.operatorOid
  ) {
    throw new AdoptionError(
      'Adoption requires a writable primary and an operator role isolated from the runtime role',
    );
  }
  return { target, runtime };
}

function fingerprint(snapshot: SchemaSnapshot) {
  const { name, role, ledgerPresent, ...environment } = snapshot.database;
  return digest({ objects: snapshot.objects, environment });
}

export function reviewSummary(artifact: BaselineReview) {
  const review = validateReview(artifact).review;
  const comparison = compareSchemas(
    review.reference,
    review.observed,
    review.baseline.name,
  );
  const onlyColumnOrder = comparison.changed.every((change) => {
    const [kind, schema, parent] = JSON.parse(change.key) as string[];
    const { position: oldPosition, ...before } = change.expected;
    const { position: newPosition, ...after } = change.actual;
    return (
      kind === 'column' &&
      schema === 'public' &&
      parent === 'podcasts' &&
      Number.isInteger(oldPosition) &&
      Number.isInteger(newPosition) &&
      stable(before) === stable(after)
    );
  });
  const onlyOwners = comparison.accessChanges.every((change) => {
    const [kind, schema] = JSON.parse(change.key) as string[];
    if (
      !['relation', 'sequence'].includes(kind) ||
      schema !== 'public' ||
      !change.expected ||
      !change.actual
    )
      return false;
    const { owner: oldOwner, ...before } = change.expected;
    const { owner: newOwner, ...after } = change.actual;
    return (
      typeof oldOwner === 'string' &&
      typeof newOwner === 'string' &&
      stable(before) === stable(after)
    );
  });
  const applicationObjects = review.observed.inventory.snapshot.objects.filter(
    (object) =>
      object.schema === 'public' &&
      ['relation', 'sequence'].includes(object.kind),
  );
  const runtimeOwnsApplication =
    applicationObjects.length > 0 &&
    applicationObjects.every(
      (object) => object.access?.owner === review.runtime.name,
    );
  return {
    eligible:
      runtimeOwnsApplication &&
      !review.observed.inventory.snapshot.database.ledgerPresent &&
      !comparison.missing.length &&
      !comparison.extra.length &&
      !comparison.manualReview.length &&
      comparison.environment.matches &&
      onlyColumnOrder &&
      onlyOwners,
    missing: comparison.missing.length,
    extra: comparison.extra.length,
    columnOrderDifferences: comparison.changed.length,
    ownerDifferences: comparison.accessChanges.length,
    manualReview: comparison.manualReview.length,
    environmentMatches: comparison.environment.matches,
    runtimeOwnsApplication,
    adoptionApproved: false,
  };
}

export function validateReview(value: unknown): BaselineReview {
  const artifact = value as BaselineReview;
  const review = artifact?.review;
  if (
    review?.format !== 'podcst-baseline-review/1' ||
    artifact.digest !== digest(review) ||
    !/^[a-f0-9]{64}$/.test(review.recoveryEvidenceDigest) ||
    !Number.isFinite(Date.parse(review.inspectedAt)) ||
    stable(review.baseline) !== stable(baseline()) ||
    typeof review.target?.systemId !== 'string' ||
    typeof review.runtime?.name !== 'string'
  ) {
    throw new AdoptionError(
      'Invalid baseline review, evidence digest or baseline checksum',
    );
  }
  validateInventory(review.reference);
  validateInventory(review.observed);
  return artifact;
}

export async function inspectBaseline(
  sql: postgres.Sql,
  reference: InventoryArtifact,
  runtimeName: string,
  recoveryEvidenceDigest: string,
): Promise<BaselineReview> {
  validateInventory(reference);
  return sql.begin('isolation level repeatable read read only', async (tx) => {
    await tx`SET LOCAL search_path TO pg_catalog`;
    await tx`SET LOCAL statement_timeout TO '10s'`;
    await tx`SET LOCAL lock_timeout TO '1s'`;
    const identity = await binding(tx, runtimeName);
    const observed = inventoryArtifact(await captureSchemaInTransaction(tx));
    const review: Review = {
      format: 'podcst-baseline-review/1',
      inspectedAt: new Date().toISOString(),
      ...identity,
      baseline: baseline(),
      recoveryEvidenceDigest,
      reference,
      observed,
    };
    const artifact = validateReview({ review, digest: digest(review) });
    reviewSummary(artifact);
    return artifact;
  });
}

export async function adoptBaseline(
  sql: postgres.Sql,
  artifact: BaselineReview,
  reviewedDigest: string,
) {
  const { review } = validateReview(artifact);
  if (reviewedDigest !== artifact.digest)
    throw new AdoptionError('Exact reviewed inspection digest is required');
  const age = Date.now() - Date.parse(review.inspectedAt);
  if (age < -60_000 || age > 24 * 60 * 60_000)
    throw new AdoptionError('Review expired; inspect and review again');
  if (!reviewSummary(artifact).eligible)
    throw new AdoptionError(
      'Schema differences require reconciliation before adoption',
    );
  return sql.begin(async (tx) => {
    await lockMigrations(tx);
    await tx`SET LOCAL search_path TO pg_catalog`;
    await tx`SET LOCAL lock_timeout TO '5s'`;
    await tx`SET LOCAL statement_timeout TO '10s'`;
    const current = await binding(tx, review.runtime.name);
    if (
      stable(current.target) !== stable(review.target) ||
      stable(current.runtime) !== stable(review.runtime)
    ) {
      throw new AdoptionError(
        'Database target, operator or runtime role changed',
      );
    }
    const tables = review.observed.inventory.snapshot.objects.filter(
      (object) => object.kind === 'relation',
    );
    for (const table of tables) {
      await tx.unsafe(
        `LOCK TABLE ${quote(table.schema)}.${quote(table.name)} IN SHARE UPDATE EXCLUSIVE MODE`,
      );
    }
    const before = await captureSchemaInTransaction(tx);
    if (before.database.ledgerPresent)
      throw new AdoptionError(
        'Migration ledger already exists; inspect its state instead of retrying',
      );
    if (fingerprint(before) !== fingerprint(review.observed.inventory.snapshot))
      throw new AdoptionError('Reviewed catalog changed');
    await tx`SET LOCAL lock_timeout TO '5s'`;
    await tx`SET LOCAL statement_timeout TO '10s'`;
    await createMigrationLedger(tx);
    await tx.unsafe(
      `REVOKE ALL ON SCHEMA podcst_migrations FROM PUBLIC, ${quote(review.runtime.name)}`,
    );
    await tx.unsafe(
      `REVOKE ALL ON TABLE podcst_migrations.history FROM PUBLIC, ${quote(review.runtime.name)}`,
    );
    await tx`
      INSERT INTO podcst_migrations.history (name, checksum, method, review_digest)
      VALUES (${review.baseline.name}, ${review.baseline.checksum}, 'adopted', ${artifact.digest})
    `;
    const [permissions] = await tx`
      SELECT has_schema_privilege(${review.runtime.name}, 'podcst_migrations', 'USAGE,CREATE') AS schema_access,
        has_table_privilege(${review.runtime.name}, 'podcst_migrations.history', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS table_access
    `;
    if (permissions.schema_access || permissions.table_access)
      throw new AdoptionError('Runtime role can access the migration ledger');
    const after = await captureSchemaInTransaction(tx);
    if (fingerprint(after) !== fingerprint(before))
      throw new AdoptionError('Application catalog changed during adoption');
    const finalBinding = await binding(tx, review.runtime.name);
    if (stable(finalBinding) !== stable(current))
      throw new AdoptionError(
        'Database or role binding changed during adoption',
      );
    return {
      baseline: review.baseline,
      reviewDigest: artifact.digest,
      method: 'adopted',
      applicationTablesChanged: false,
    };
  });
}

function quote(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}
