import { lstatSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import postgres from 'postgres';
import { canonical } from '../src/server/erasure/journal-contract';
import {
  assertServingPrivileges,
  recoverySchemaInTransaction,
} from '../src/server/erasure/recovery-database';
import { migrationChainHash } from '../src/server/erasure/recovery-manifest';
import { selectedRecoveryTables } from './backup-selection';
import {
  protectedExternalPath,
  readProtected,
  writeProtected,
} from './lib/artifacts';
import { loadMigrations } from './migrations';

export const servingTablePermissions = {
  account_erasure_intents: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  account_erasure_proofs: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  account_preferences: ['SELECT', 'INSERT', 'UPDATE'],
  authors: ['SELECT', 'INSERT', 'DELETE'],
  chart_history: ['SELECT', 'INSERT', 'UPDATE'],
  countries: ['SELECT', 'INSERT'],
  email_verifications: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  episode_content: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  episode_list_clients: ['SELECT', 'INSERT', 'UPDATE'],
  episode_list_items: ['SELECT', 'INSERT', 'DELETE'],
  episode_lists: ['SELECT', 'INSERT', 'UPDATE'],
  episodes: ['SELECT', 'INSERT'],
  feed_poll_state: ['SELECT', 'INSERT', 'UPDATE'],
  follow_clients: ['SELECT', 'INSERT', 'UPDATE'],
  follow_revision_heads: ['SELECT', 'INSERT', 'UPDATE'],
  genres: ['SELECT', 'INSERT', 'UPDATE'],
  oauth_accounts: [],
  passkeys: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  playback_progress: ['SELECT', 'INSERT', 'UPDATE'],
  podcast_apple_aliases: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  podcast_feed_aliases: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  podcasts: ['SELECT', 'INSERT', 'UPDATE'],
  podcasts_genres: ['SELECT', 'INSERT', 'DELETE'],
  poll_metrics: ['SELECT', 'INSERT'],
  progress_clients: ['SELECT', 'INSERT', 'UPDATE'],
  progress_revision_heads: ['SELECT', 'INSERT', 'UPDATE'],
  recovery_state: ['SELECT'],
  sessions: ['SELECT', 'INSERT', 'DELETE'],
  state_generation: ['SELECT'],
  subscriptions: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  top_podcasts: ['SELECT', 'INSERT', 'DELETE'],
  transcripts: [],
  users: ['SELECT', 'INSERT', 'DELETE'],
} as const;
export const servingLockColumns: Readonly<Record<string, readonly string[]>> = {
  countries: ['id'],
  episodes: ['id'],
  sessions: ['id'],
  state_generation: ['singleton'],
  users: ['id'],
};
export type PrimaryRoleProfile = 'serving' | 'backup';
interface GrantTarget {
  database: string;
  role: string;
  reference: { schemaHash: string; catalogHash: string };
}
const identifier = (name: string) => /^[a-z][a-z0-9_]{0,62}$/.test(name);

async function primaryRoleAccess(
  tx: postgres.TransactionSql,
  profile: PrimaryRoleProfile,
  expected: GrantTarget,
  grant: boolean,
) {
  if (
    !['serving', 'backup'].includes(profile) ||
    ![expected.database, expected.role].every(identifier)
  )
    throw new Error('Primary grant target refused');
  const [identity] =
    await tx`SELECT current_database() AS database, current_user AS operator`;
  const [role] =
    await tx`SELECT oid, rolcanlogin, rolinherit, rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = ${expected.role}`;
  if (
    identity.database !== expected.database ||
    identity.operator === expected.role ||
    !role ||
    role.rolinherit ||
    role.rolsuper ||
    role.rolcreaterole ||
    role.rolcreatedb ||
    role.rolreplication ||
    role.rolbypassrls ||
    (grant && role.rolcanlogin)
  )
    throw new Error('Primary grant role refused');
  const unsafe =
    await tx`SELECT 1 FROM pg_auth_members WHERE member = ${role.oid} OR roleid = ${role.oid}
    UNION ALL SELECT 1 FROM pg_shdepend WHERE refclassid = 'pg_authid'::regclass AND refobjid = ${role.oid} AND deptype = 'o'
    UNION ALL SELECT 1 FROM pg_stat_activity WHERE usename = ${expected.role} AND ${grant}::boolean
    UNION ALL SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND has_function_privilege(${role.oid}::oid, p.oid, 'EXECUTE WITH GRANT OPTION')
    UNION ALL SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE a.grantee = ${role.oid} AND (a.is_grantable OR NOT (${profile} = 'serving' AND p.oid = 'pg_control_system()'::regprocedure AND a.privilege_type = 'EXECUTE'))
    UNION ALL SELECT 1 WHERE has_database_privilege(${role.oid}::oid, current_database(), 'CREATE,TEMPORARY,CONNECT WITH GRANT OPTION')
      OR has_schema_privilege(${role.oid}::oid, 'public', 'CREATE,USAGE WITH GRANT OPTION')
      OR has_parameter_privilege(${role.oid}::oid, 'session_replication_role', 'SET')`;
  if (unsafe.length) throw new Error('Primary role isolation refused');
  if (
    expected.reference.schemaHash !== migrationChainHash(loadMigrations()) ||
    canonical(await recoverySchemaInTransaction(tx)) !==
      canonical(expected.reference)
  )
    throw new Error('Primary grant schema refused');
  const tables =
    await tx`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname`;
  if (
    canonical(tables.map((row) => row.relname)) !==
    canonical(Object.keys(servingTablePermissions).sort())
  )
    throw new Error('Primary table inventory refused');
  const backup = selectedRecoveryTables();
  const definitions: Record<string, readonly string[]> = Object.fromEntries([
    ...Object.entries(servingTablePermissions).map(([name, privileges]) => [
      `public.${name}`,
      profile === 'serving'
        ? privileges
        : backup.includes(`public.${name}`)
          ? ['SELECT']
          : [],
    ]),
    ['podcst_migrations.history', profile === 'backup' ? ['SELECT'] : []],
  ]);
  if (backup.some((name) => !(name in definitions)))
    throw new Error('Backup table inventory refused');
  for (const [relation, allowed] of Object.entries(definitions)) {
    const columnUpdates =
      profile === 'serving'
        ? (servingLockColumns[relation.slice('public.'.length)] ?? [])
        : [];
    const privileges = await tx`SELECT privilege,
      has_table_privilege(${role.oid}::oid, ${relation}, privilege) AS allowed,
      has_table_privilege(${role.oid}::oid, ${relation}, privilege || ' WITH GRANT OPTION') AS grantable,
      CASE WHEN privilege IN ('SELECT','INSERT','UPDATE','REFERENCES') THEN
        ARRAY(SELECT attname FROM pg_attribute WHERE attrelid = ${relation}::regclass AND attnum > 0 AND NOT attisdropped AND has_column_privilege(${role.oid}::oid, attrelid, attnum, privilege))
      ELSE ARRAY[]::name[] END AS columns,
      CASE WHEN privilege IN ('SELECT','INSERT','UPDATE','REFERENCES') THEN has_any_column_privilege(${role.oid}::oid, ${relation}, privilege || ' WITH GRANT OPTION') ELSE false END AS column_grantable
      FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege`;
    for (const privilege of privileges) {
      if (
        privilege.grantable ||
        privilege.column_grantable ||
        (!allowed.includes(privilege.privilege) &&
          (privilege.allowed ||
            privilege.columns.some(
              (column: string) =>
                privilege.privilege !== 'UPDATE' ||
                !columnUpdates.includes(column),
            )))
      )
        throw new Error('Excess primary table privileges');
      if (!grant && allowed.includes(privilege.privilege) && !privilege.allowed)
        throw new Error('Missing primary table privileges');
      if (
        !grant &&
        privilege.privilege === 'UPDATE' &&
        columnUpdates.some((column) => !privilege.columns.includes(column))
      )
        throw new Error('Missing primary lock privileges');
    }
    if (grant) {
      if (allowed.length)
        await tx`GRANT ${tx.unsafe(allowed.join(', '))} ON TABLE ${tx(relation)} TO ${tx(expected.role)}`;
      if (columnUpdates.length)
        await tx`GRANT UPDATE (${tx(columnUpdates)}) ON TABLE ${tx(relation)} TO ${tx(expected.role)}`;
    }
  }
  const sequences =
    await tx`SELECT n.nspname || '.' || c.relname AS sequence, pn.nspname || '.' || p.relname AS parent
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_depend d ON d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype IN ('a','i')
    LEFT JOIN pg_class p ON p.oid = d.refobjid LEFT JOIN pg_namespace pn ON pn.oid = p.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'S' ORDER BY c.relname`;
  for (const sequence of sequences) {
    if (!sequence.parent || !(sequence.parent in definitions))
      throw new Error('Primary sequence ownership refused');
    const allowed =
      profile === 'serving'
        ? definitions[sequence.parent].includes('INSERT')
          ? ['USAGE']
          : []
        : definitions[sequence.parent].includes('SELECT')
          ? ['SELECT']
          : [];
    const privileges = await tx`SELECT privilege,
      has_sequence_privilege(${role.oid}::oid, ${sequence.sequence}, privilege) AS allowed,
      has_sequence_privilege(${role.oid}::oid, ${sequence.sequence}, privilege || ' WITH GRANT OPTION') AS grantable
      FROM unnest(ARRAY['USAGE','SELECT','UPDATE']) privilege`;
    if (
      privileges.some(
        (row) =>
          row.grantable || (row.allowed && !allowed.includes(row.privilege)),
      )
    )
      throw new Error('Excess primary sequence privileges');
    if (
      !grant &&
      privileges.some((row) => allowed.includes(row.privilege) && !row.allowed)
    )
      throw new Error('Missing primary sequence privileges');
    if (grant && allowed.length)
      await tx`GRANT ${tx.unsafe(allowed.join(', '))} ON SEQUENCE ${tx(sequence.sequence)} TO ${tx(expected.role)}`;
  }
  const [control] = await tx`SELECT
    has_schema_privilege(${role.oid}::oid, 'podcst_migrations', 'USAGE') AS ledger,
    has_schema_privilege(${role.oid}::oid, 'podcst_migrations', 'CREATE,USAGE WITH GRANT OPTION') AS ledger_unsafe,
    has_function_privilege(${role.oid}::oid, 'pg_control_system()', 'EXECUTE WITH GRANT OPTION') AS probe_grantable`;
  if (
    control.ledger_unsafe ||
    control.probe_grantable ||
    (profile === 'serving' && control.ledger)
  )
    throw new Error('Primary control privileges refused');
  if (grant) {
    await tx`GRANT CONNECT ON DATABASE ${tx(expected.database)} TO ${tx(expected.role)}`;
    await tx`GRANT USAGE ON SCHEMA public TO ${tx(expected.role)}`;
    if (profile === 'serving')
      await tx`GRANT EXECUTE ON FUNCTION pg_control_system() TO ${tx(expected.role)}`;
    else
      await tx`GRANT USAGE ON SCHEMA podcst_migrations TO ${tx(expected.role)}`;
  } else {
    const [access] =
      await tx`SELECT has_database_privilege(${role.oid}::oid, current_database(), 'CONNECT') AND has_schema_privilege(${role.oid}::oid, 'public', 'USAGE') AS allowed`;
    if (!access.allowed || (profile === 'backup' && !control.ledger))
      throw new Error('Missing primary connection privileges');
    if (profile === 'serving') await assertServingPrivileges(tx, expected.role);
  }
}

export async function grantPrimaryRole(
  sql: postgres.Sql,
  profile: PrimaryRoleProfile,
  expected: GrantTarget,
) {
  await sql.begin(async (tx) => {
    await tx`SET LOCAL lock_timeout = '2s'`;
    await tx`SET LOCAL statement_timeout = '10s'`;
    await tx`LOCK TABLE pg_catalog.pg_authid, pg_catalog.pg_auth_members IN SHARE MODE`;
    await primaryRoleAccess(tx, profile, expected, true);
    await primaryRoleAccess(tx, profile, expected, false);
  });
}
export async function inspectPrimaryRole(
  sql: postgres.Sql,
  profile: PrimaryRoleProfile,
  expected: GrantTarget,
) {
  await sql.begin('read only', (tx) =>
    primaryRoleAccess(tx, profile, expected, false),
  );
}

export async function runPrimaryGrantCommand(command: string, path: string) {
  if (!['inspect', 'grant'].includes(command))
    throw new Error('Primary grant command refused');
  const external = (value: string) =>
    protectedExternalPath(value, new URL('../', import.meta.url));
  const config = readProtected(external(path), 16 * 1024) as {
    target: {
      socket: string;
      port: number;
      database: string;
      operator: string;
      cluster: string;
    };
    profile: PrimaryRoleProfile;
    role: string;
    reference: string;
    output: string;
  };
  const target = config.target;
  const output = external(config.output);
  if (lstatSync(output, { throwIfNoEntry: false }))
    throw new Error('Primary grant output exists');
  if (
    !isAbsolute(target.socket) ||
    !Number.isInteger(target.port) ||
    target.port < 1 ||
    target.port > 65535 ||
    ![target.database, target.operator, config.role].every(identifier) ||
    !/^\d+$/.test(target.cluster)
  )
    throw new Error('Explicit primary grant target required');
  const sql = postgres({
    host: target.socket,
    port: target.port,
    database: target.database,
    username: target.operator,
    password: '',
    ssl: false,
    max: 1,
    connect_timeout: 5,
    onnotice: () => {},
  });
  try {
    await sql.begin('read only', async (tx) => {
      const [actual] =
        await tx`SELECT current_database() AS database, current_user AS operator, current_setting('port')::int AS port,
        current_setting('server_version_num')::int AS version, (SELECT system_identifier::text FROM pg_control_system()) AS cluster`;
      if (
        actual.database !== target.database ||
        actual.operator !== target.operator ||
        actual.port !== target.port ||
        actual.cluster !== target.cluster ||
        Math.trunc(actual.version / 10000) !== 16
      )
        throw new Error('Primary grant identity refused');
    });
    const expected = {
      database: target.database,
      role: config.role,
      reference: readProtected(
        external(config.reference),
        4096,
      ) as GrantTarget['reference'],
    };
    await (command === 'grant' ? grantPrimaryRole : inspectPrimaryRole)(
      sql,
      config.profile,
      expected,
    );
    writeProtected(output, {
      version: 1,
      profile: config.profile,
      database: target.database,
      role: config.role,
      reference: expected.reference,
      verified: true,
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (import.meta.main) {
  const [command, flag, path, ...extra] = process.argv.slice(2);
  if (flag !== '--config' || !path || extra.length) {
    console.error('Usage: recovery-permissions.ts inspect|grant --config FILE');
    process.exitCode = 1;
  } else
    void runPrimaryGrantCommand(command, path)
      .then(() =>
        console.log(
          'Primary grant command completed; inspect the protected result',
        ),
      )
      .catch(() => {
        console.error(
          'Primary grant refused or outcome unknown; inspect before retrying',
        );
        process.exitCode = 1;
      });
}
