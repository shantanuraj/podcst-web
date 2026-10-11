import type postgres from 'postgres';
import { captureSchemaInTransaction } from '../../../scripts/schema-catalog';
import { canonical, digest, JournalError } from './journal-contract';
import type { RecoveryPlan } from './recovery-control';
import { migrationChainHash } from './recovery-manifest';

export async function recoverySchema(sql: postgres.Sql) {
  return sql.begin(
    'isolation level repeatable read read only',
    recoverySchemaInTransaction,
  );
}
export async function recoverySchemaInTransaction(
  sql: postgres.TransactionSql,
) {
  const snapshot = await captureSchemaInTransaction(sql);
  const physicalTables = new Set(
    snapshot.objects
      .filter(
        (object) =>
          object.kind === 'relation' &&
          object.schema === 'public' &&
          object.definition.kind === 'r',
      )
      .map((object) => object.name),
  );
  const routines =
    await sql`SELECT n.nspname, p.proname, pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.prokind IN ('f','p') ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)`;
  const unsafe =
    await sql`SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND t.tgenabled <> 'O' UNION ALL SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public' AND NOT c.convalidated`;
  const unfenced =
    await sql`SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT EXISTS (
    SELECT 1 FROM pg_trigger t WHERE t.tgrelid = c.oid AND t.tgname = 'recovery_admission' AND t.tgtype = 62 AND t.tgenabled = 'O'
      AND t.tgfoid = 'public.require_recovery_admission()'::regprocedure
  )`;
  if (unsafe.length || unfenced.length) throw new JournalError(503);
  const rows = await sql<
    { name: string; checksum: string }[]
  >`SELECT name, checksum FROM podcst_migrations.history ORDER BY name`;
  return {
    schemaHash: migrationChainHash(rows),
    catalogHash: digest(
      canonical({
        environment: {
          major: Math.trunc(snapshot.database.serverVersion / 10000),
          encoding: snapshot.database.encoding,
          collation: snapshot.database.collation,
          ctype: snapshot.database.ctype,
          localeProvider: snapshot.database.localeProvider,
          locale: snapshot.database.locale,
          collationVersion: snapshot.database.collationVersion,
        },
        objects: snapshot.objects.map(
          ({ access: _a, manualReview: _m, ...object }) => {
            if (
              object.kind !== 'column' ||
              object.schema !== 'public' ||
              !physicalTables.has(object.parent)
            )
              return object;
            const { position: _position, ...definition } = object.definition;
            return { ...object, definition };
          },
        ),
        routines: Array.from(routines),
      }),
    ),
  };
}
const roleName = (role: string) => /^[a-z][a-z0-9_]{0,62}$/.test(role);
export async function fenceWriters(
  sql: postgres.Sql,
  retired: string[],
  serving: string,
  runId: string,
) {
  const tombstones = retired.map(
    (role) =>
      `_recovery_retired_${digest(canonical([runId, role])).slice(0, 40)}`,
  );
  const roles = [...retired, serving];
  if (
    !retired.length ||
    new Set(roles).size !== roles.length ||
    !roles.every(roleName)
  )
    throw new JournalError(503);
  const [operator] = await sql`SELECT current_user AS name`;
  if (roles.includes(operator.name)) throw new JournalError(503);
  const found =
    await sql`SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = ANY(${[...roles, ...tombstones]})`;
  if (
    found.length !== roles.length ||
    found.some(
      (r) =>
        r.rolsuper ||
        r.rolcreaterole ||
        r.rolcreatedb ||
        r.rolreplication ||
        r.rolbypassrls,
    )
  )
    throw new JournalError(503);
  const inherited =
    await sql`SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = ${serving}`;
  if (inherited.length) throw new JournalError(503);
  await sql.begin(async (tx) => {
    await tx`SET LOCAL synchronous_commit = on`;
    await tx`LOCK TABLE pg_catalog.pg_authid IN SHARE ROW EXCLUSIVE MODE`;
    for (let index = 0; index < retired.length; index++) {
      const role = retired[index];
      const tombstone = tombstones[index];
      if ((await tx`SELECT 1 FROM pg_roles WHERE rolname = ${role}`).length)
        await tx`ALTER ROLE ${tx(role)} RENAME TO ${tx(tombstone)}`;
      await tx`ALTER ROLE ${tx(tombstone)} NOLOGIN`;
    }
    await tx`ALTER ROLE ${tx(serving)} NOLOGIN`;
  });
  await sql`SELECT pg_terminate_backend(pid, 5000) FROM pg_stat_activity WHERE usename = ANY(${[...roles, ...tombstones]}) AND pid <> pg_backend_pid()`;
  await assertWritersFenced(sql, [...roles, ...tombstones]);
}
export async function assertWritersFenced(sql: postgres.ISql, roles: string[]) {
  const unexpected =
    await sql`SELECT 1 FROM pg_roles WHERE rolname <> current_user AND rolcanlogin AND has_database_privilege(oid, current_database(), 'CONNECT')`;
  const active =
    await sql`SELECT 1 FROM pg_stat_activity WHERE (datname = current_database() OR usename = ANY(${roles})) AND usename <> current_user AND backend_type = 'client backend'`;
  const open =
    await sql`SELECT 1 FROM pg_roles WHERE rolname = ANY(${roles}) AND rolcanlogin`;
  if (unexpected.length || active.length || open.length)
    throw new JournalError(503);
}
export async function assertServingPrivileges(
  sql: postgres.ISql,
  role: string,
) {
  const [rights] =
    await sql`SELECT has_database_privilege(${role}, current_database(), 'CREATE') OR has_schema_privilege(${role}, 'public', 'CREATE') OR has_parameter_privilege(${role}, 'session_replication_role', 'SET') AS ddl,
    has_table_privilege(${role}, 'public.recovery_state', 'INSERT,UPDATE,DELETE,TRUNCATE') OR has_table_privilege(${role}, 'public.state_generation', 'INSERT,UPDATE,DELETE,TRUNCATE') OR has_schema_privilege(${role}, 'podcst_migrations', 'USAGE') AS control,
    has_table_privilege(${role}, 'public.recovery_state', 'SELECT') AND has_table_privilege(${role}, 'public.state_generation', 'SELECT') AND has_function_privilege(${role}, 'pg_control_system()', 'EXECUTE') AND has_column_privilege(${role}, 'public.state_generation', 'singleton', 'UPDATE') AS probe`;
  const owned =
    await sql`SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = ${role}) UNION ALL SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proowner = (SELECT oid FROM pg_roles WHERE rolname = ${role})`;
  const writable =
    await sql`SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN ('recovery_state', 'state_generation') AND a.attnum > 0 AND NOT a.attisdropped
      AND (has_column_privilege(${role}, c.oid, a.attnum, 'INSERT') OR (has_column_privilege(${role}, c.oid, a.attnum, 'UPDATE') AND NOT (c.relname = 'state_generation' AND a.attname = 'singleton')))`;
  if (
    rights.ddl ||
    rights.control ||
    !rights.probe ||
    owned.length ||
    writable.length
  )
    throw new JournalError(503);
}
export async function enableServingRole(sql: postgres.Sql, plan: RecoveryPlan) {
  if (!roleName(plan.servingRole)) throw new JournalError(503);
  await sql.begin(async (tx) => {
    await tx`SET LOCAL synchronous_commit = on`;
    await tx`LOCK TABLE pg_catalog.pg_authid IN SHARE ROW EXCLUSIVE MODE`;
    if (
      (
        await tx`SELECT 1 FROM pg_roles WHERE rolname = ANY(${plan.retiredRoles})`
      ).length
    )
      throw new JournalError(503);
    await tx`ALTER ROLE ${tx(plan.servingRole)} LOGIN`;
  });
}
