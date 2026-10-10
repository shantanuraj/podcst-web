import type postgres from 'postgres';

export const journalStorePermissions = {
  journal: {
    schema: 'erasure_journal',
    tables: {
      head: ['SELECT', 'UPDATE'],
      epochs: ['SELECT', 'INSERT'],
      entries: ['SELECT', 'INSERT'],
    },
  },
  authority: {
    schema: 'erasure_authority',
    tables: {
      head: ['SELECT', 'UPDATE'],
      recovery_runs: ['SELECT', 'INSERT', 'UPDATE'],
      recovery_gate: ['SELECT', 'INSERT', 'UPDATE'],
      recovery_artifacts: ['SELECT', 'INSERT', 'UPDATE'],
    },
  },
  receipts: {
    schema: 'erasure_receipts',
    tables: { receipts: ['SELECT', 'INSERT', 'DELETE'] },
  },
} as const;

export async function grantJournalStore(
  sql: postgres.Sql,
  store: keyof typeof journalStorePermissions,
  expected: { database: string; role: string },
) {
  const permissions = journalStorePermissions[store];
  if (
    !permissions ||
    ![expected.database, expected.role].every((name) =>
      /^[a-z][a-z0-9_]{0,62}$/.test(name),
    )
  )
    throw new Error('Journal grant target refused');
  await sql.begin(async (tx) => {
    const [identity] =
      await tx`SELECT current_database() AS database, current_user AS operator`;
    const [role] =
      await tx`SELECT oid, rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls, rolinherit FROM pg_roles WHERE rolname = ${expected.role}`;
    if (
      identity.database !== expected.database ||
      identity.operator === expected.role ||
      !role ||
      role.rolsuper ||
      role.rolcreaterole ||
      role.rolcreatedb ||
      role.rolreplication ||
      role.rolbypassrls ||
      role.rolinherit
    )
      throw new Error('Journal grant identity refused');
    const owners =
      await tx`SELECT 1 FROM pg_database WHERE datname = current_database() AND datdba = ${role.oid}
      UNION ALL SELECT 1 FROM pg_namespace WHERE nspowner = ${role.oid}
      UNION ALL SELECT 1 FROM pg_class WHERE relowner = ${role.oid}
      UNION ALL SELECT 1 FROM pg_proc WHERE proowner = ${role.oid}
      UNION ALL SELECT 1 FROM pg_auth_members WHERE member = ${role.oid}`;
    if (owners.length) throw new Error('Journal role isolation refused');
    await tx`REVOKE ALL ON DATABASE ${tx(expected.database)} FROM PUBLIC`;
    await tx`REVOKE CREATE ON SCHEMA public FROM PUBLIC`;
    await tx`GRANT CONNECT ON DATABASE ${tx(expected.database)} TO ${tx(expected.role)}`;
    await tx`GRANT USAGE ON SCHEMA ${tx(permissions.schema)} TO ${tx(expected.role)}`;
    const [unsafe] =
      await tx`SELECT has_database_privilege(${expected.role}, current_database(), 'CREATE')
      OR has_schema_privilege(${expected.role}, 'public', 'CREATE')
      OR has_schema_privilege(${expected.role}, ${permissions.schema}, 'CREATE')
      OR has_parameter_privilege(${expected.role}, 'session_replication_role', 'SET') AS allowed`;
    if (unsafe.allowed) throw new Error('Journal role isolation refused');
    for (const [table, privileges] of Object.entries(permissions.tables)) {
      const relation = `${permissions.schema}.${table}`;
      const extra =
        await tx`SELECT privilege FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege
        WHERE (has_table_privilege(${expected.role}, ${relation}, privilege)
          OR CASE WHEN privilege IN ('SELECT','INSERT','UPDATE','REFERENCES')
            THEN has_any_column_privilege(${expected.role}, ${relation}, privilege) ELSE false END)
          AND NOT privilege = ANY(${privileges}::text[])`;
      if (extra.length) throw new Error('Unexpected journal role privileges');
      await tx`GRANT ${tx.unsafe(privileges.join(', '))} ON TABLE ${tx(relation)} TO ${tx(expected.role)}`;
    }
  });
}
