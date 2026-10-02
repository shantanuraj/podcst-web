import type postgres from 'postgres';
import { digest, stable } from './lib/artifacts';
import { loadMigrations } from './migrations';

export const artifactLimit = 16 * 1024 * 1024;
const objectLimit = 10_000;
export class InventoryError extends Error {}

type Definition = Record<string, unknown>;
interface CatalogObject {
  kind: string;
  schema: string;
  parent: string;
  name: string;
  definition: Definition;
  access: Definition | null;
  manualReview: boolean;
}

export interface SchemaSnapshot {
  database: {
    name: string;
    serverVersion: number;
    encoding: string;
    collation: string;
    ctype: string;
    localeProvider: string;
    locale: string | null;
    collationVersion: string | null;
    role: string;
    ledgerPresent: boolean;
  };
  objects: CatalogObject[];
  estimates: Definition[];
}

interface Inventory {
  format: 'podcst-schema-inventory/1';
  kind: 'capture' | 'reference';
  capturedAt: string;
  migrations: { name: string; checksum: string }[] | null;
  snapshot: SchemaSnapshot;
}

export interface InventoryArtifact {
  inventory: Inventory;
  digest: string;
}

const scope = `WITH namespaces AS (
  SELECT * FROM pg_namespace WHERE nspname !~ '^pg_'
    AND nspname NOT IN ('information_schema', 'podcst_migrations')
), relations AS (
  SELECT c.*, n.nspname FROM pg_class c JOIN namespaces n ON n.oid = c.relnamespace
)`;

const queries: Record<string, string> = {
  schema: `SELECT nspname AS schema, '' AS parent, nspname AS name,
    '{}'::jsonb AS definition,
    jsonb_build_object('owner', pg_get_userbyid(nspowner), 'acl', nspacl::text[]) AS access
    FROM namespaces`,
  relation: `SELECT c.nspname AS schema, '' AS parent, c.relname AS name,
    jsonb_build_object('kind', c.relkind, 'persistence', c.relpersistence,
      'rowSecurity', c.relrowsecurity, 'forceRowSecurity', c.relforcerowsecurity,
      'replicaIdentity', c.relreplident, 'accessMethod', a.amname,
      'tablespace', t.spcname, 'options', ARRAY(SELECT unnest(c.reloptions) ORDER BY 1),
      'partition', pg_get_expr(c.relpartbound, c.oid),
      'parents', ARRAY(SELECT format('%I.%I', n.nspname, p.relname)
        FROM pg_inherits i JOIN pg_class p ON p.oid = i.inhparent
        JOIN pg_namespace n ON n.oid = p.relnamespace
        WHERE i.inhrelid = c.oid ORDER BY i.inhseqno)) AS definition,
    jsonb_build_object('owner', pg_get_userbyid(c.relowner), 'acl', c.relacl::text[]) AS access,
    c.relkind <> 'r' AS manual_review
    FROM relations c LEFT JOIN pg_am a ON a.oid = c.relam
    LEFT JOIN pg_tablespace t ON t.oid = c.reltablespace
    WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')`,
  column: `SELECT c.nspname AS schema, c.relname AS parent, a.attname AS name,
    jsonb_build_object('position', a.attnum, 'type', format_type(a.atttypid, a.atttypmod),
      'notNull', a.attnotnull, 'identity', a.attidentity, 'generated', a.attgenerated,
      'default', pg_get_expr(d.adbin, d.adrelid), 'storage', a.attstorage,
      'compression', a.attcompression, 'collation', CASE WHEN co.oid IS NOT NULL
        THEN format('%I.%I', cn.nspname, co.collname) END) AS definition,
    jsonb_build_object('acl', a.attacl::text[]) AS access
    FROM relations c JOIN pg_attribute a ON a.attrelid = c.oid
    LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
    LEFT JOIN pg_collation co ON co.oid = a.attcollation
    LEFT JOIN pg_namespace cn ON cn.oid = co.collnamespace
    WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f') AND a.attnum > 0 AND NOT a.attisdropped`,
  constraint: `SELECT c.nspname AS schema, c.relname AS parent, k.conname AS name,
    jsonb_build_object('definition', pg_get_constraintdef(k.oid, false),
      'validated', k.convalidated, 'deferrable', k.condeferrable,
      'deferred', k.condeferred, 'local', k.conislocal, 'noInherit', k.connoinherit,
      'enforced', to_jsonb(k)->'conenforced') AS definition
    FROM relations c JOIN pg_constraint k ON k.conrelid = c.oid`,
  index: `SELECT c.nspname AS schema, c.relname AS parent, i.relname AS name,
    jsonb_build_object('definition', pg_get_indexdef(i.oid, 0, false),
      'valid', x.indisvalid, 'ready', x.indisready, 'live', x.indislive,
      'replicaIdentity', x.indisreplident, 'clustered', x.indisclustered,
      'tablespace', t.spcname, 'options', ARRAY(SELECT unnest(i.reloptions) ORDER BY 1)) AS definition
    FROM relations c JOIN pg_index x ON x.indrelid = c.oid
    JOIN pg_class i ON i.oid = x.indexrelid LEFT JOIN pg_tablespace t ON t.oid = i.reltablespace`,
  sequence: `SELECT c.nspname AS schema, '' AS parent, c.relname AS name,
    jsonb_build_object('type', format_type(s.seqtypid, NULL), 'start', s.seqstart::text,
      'increment', s.seqincrement::text, 'min', s.seqmin::text, 'max', s.seqmax::text,
      'cache', s.seqcache::text, 'cycle', s.seqcycle,
      'ownedBy', (SELECT jsonb_build_object('schema', n.nspname, 'table', p.relname,
        'column', a.attname, 'dependency', d.deptype)
        FROM pg_depend d JOIN pg_class p ON p.oid = d.refobjid
        JOIN pg_namespace n ON n.oid = p.relnamespace
        JOIN pg_attribute a ON a.attrelid = p.oid AND a.attnum = d.refobjsubid
        WHERE d.classid = 'pg_class'::regclass AND d.refclassid = 'pg_class'::regclass
          AND d.objid = c.oid AND d.deptype IN ('a', 'i'))) AS definition,
    jsonb_build_object('owner', pg_get_userbyid(c.relowner), 'acl', c.relacl::text[]) AS access
    FROM relations c JOIN pg_sequence s ON s.seqrelid = c.oid`,
  type: `SELECT n.nspname AS schema, '' AS parent, t.typname AS name,
    jsonb_build_object('kind', t.typtype, 'base', format_type(t.typbasetype, t.typtypmod),
      'notNull', t.typnotnull, 'default', t.typdefault,
      'labels', ARRAY(SELECT enumlabel FROM pg_enum e WHERE e.enumtypid = t.oid ORDER BY enumsortorder)) AS definition,
    jsonb_build_object('owner', pg_get_userbyid(t.typowner), 'acl', t.typacl::text[]) AS access,
    true AS manual_review
    FROM pg_type t JOIN namespaces n ON n.oid = t.typnamespace
    LEFT JOIN pg_class c ON c.oid = t.typrelid
    WHERE t.typtype IN ('d', 'e', 'r', 'm') OR (t.typtype = 'c' AND c.relkind = 'c')
      OR (t.typtype = 'b' AND t.typelem = 0)`,
  routine: `SELECT n.nspname AS schema, '' AS parent,
    p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS name,
    jsonb_build_object('kind', p.prokind, 'result', pg_get_function_result(p.oid),
      'language', l.lanname, 'securityDefiner', p.prosecdef, 'volatility', p.provolatile,
      'strict', p.proisstrict, 'parallel', p.proparallel) AS definition,
    jsonb_build_object('owner', pg_get_userbyid(p.proowner), 'acl', p.proacl::text[]) AS access,
    true AS manual_review
    FROM pg_proc p JOIN namespaces n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang`,
  trigger: `SELECT c.nspname AS schema, c.relname AS parent, t.tgname AS name,
    jsonb_build_object('definition', pg_get_triggerdef(t.oid, false), 'enabled', t.tgenabled) AS definition,
    true AS manual_review FROM relations c JOIN pg_trigger t ON t.tgrelid = c.oid WHERE NOT t.tgisinternal`,
  policy: `SELECT c.nspname AS schema, c.relname AS parent, p.polname AS name,
    jsonb_build_object('command', p.polcmd, 'permissive', p.polpermissive,
      'using', pg_get_expr(p.polqual, p.polrelid), 'check', pg_get_expr(p.polwithcheck, p.polrelid),
      'roles', ARRAY(SELECT CASE WHEN role = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(role) END
        FROM unnest(p.polroles) role ORDER BY 1)) AS definition,
    true AS manual_review FROM relations c JOIN pg_policy p ON p.polrelid = c.oid`,
  rule: `SELECT c.nspname AS schema, c.relname AS parent, r.rulename AS name,
    jsonb_build_object('definition', pg_get_ruledef(r.oid, false), 'enabled', r.ev_enabled) AS definition,
    true AS manual_review FROM relations c JOIN pg_rewrite r ON r.ev_class = c.oid WHERE r.rulename <> '_RETURN'`,
  extension: `SELECT n.nspname AS schema, '' AS parent, e.extname AS name,
    jsonb_build_object('version', e.extversion, 'relocatable', e.extrelocatable) AS definition,
    jsonb_build_object('owner', pg_get_userbyid(e.extowner)) AS access,
    e.extname <> 'plpgsql' AS manual_review FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace`,
  manual: `SELECT '' AS schema, 'event-trigger' AS parent, evtname AS name, '{}'::jsonb AS definition,
      true AS manual_review FROM pg_event_trigger
    UNION ALL SELECT '', 'foreign-server', srvname, '{}'::jsonb, true FROM pg_foreign_server
    UNION ALL SELECT '', 'foreign-wrapper', fdwname, '{}'::jsonb, true FROM pg_foreign_data_wrapper
    UNION ALL SELECT '', 'user-mapping', json_build_array(usename, srvname)::text, '{}'::jsonb, true FROM pg_user_mappings
    UNION ALL SELECT '', 'publication', pubname, '{}'::jsonb, true FROM pg_publication
    UNION ALL SELECT '', 'subscription', subname, '{}'::jsonb, true FROM pg_subscription
      WHERE subdbid = (SELECT oid FROM pg_database WHERE datname = current_database())
    UNION ALL SELECT coalesce(n.nspname, ''), 'default-acl',
      pg_get_userbyid(d.defaclrole) || ':' || d.defaclobjtype::text,
      jsonb_build_object('acl', d.defaclacl::text[]), true
      FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
    UNION ALL SELECT n.nspname, 'collation', c.collname, '{}'::jsonb, true FROM pg_collation c JOIN namespaces n ON n.oid = c.collnamespace
    UNION ALL SELECT n.nspname, 'operator-class', json_build_array(c.opcname, a.amname)::text, '{}'::jsonb, true FROM pg_opclass c JOIN namespaces n ON n.oid = c.opcnamespace JOIN pg_am a ON a.oid = c.opcmethod
    UNION ALL SELECT n.nspname, 'operator-family', json_build_array(c.opfname, a.amname)::text, '{}'::jsonb, true FROM pg_opfamily c JOIN namespaces n ON n.oid = c.opfnamespace JOIN pg_am a ON a.oid = c.opfmethod
    UNION ALL SELECT n.nspname, 'operator', c.oprname || '(' || format_type(c.oprleft, NULL) || ',' || format_type(c.oprright, NULL) || ')', '{}'::jsonb, true FROM pg_operator c JOIN namespaces n ON n.oid = c.oprnamespace
    UNION ALL SELECT n.nspname, 'conversion', c.conname, '{}'::jsonb, true FROM pg_conversion c JOIN namespaces n ON n.oid = c.connamespace
    UNION ALL SELECT n.nspname, 'text-search-config', c.cfgname, '{}'::jsonb, true FROM pg_ts_config c JOIN namespaces n ON n.oid = c.cfgnamespace
    UNION ALL SELECT n.nspname, 'text-search-dictionary', c.dictname, '{}'::jsonb, true FROM pg_ts_dict c JOIN namespaces n ON n.oid = c.dictnamespace
    UNION ALL SELECT n.nspname, 'text-search-parser', c.prsname, '{}'::jsonb, true FROM pg_ts_parser c JOIN namespaces n ON n.oid = c.prsnamespace
    UNION ALL SELECT n.nspname, 'text-search-template', c.tmplname, '{}'::jsonb, true FROM pg_ts_template c JOIN namespaces n ON n.oid = c.tmplnamespace`,
};

function objectKey(object: CatalogObject) {
  return stable([object.kind, object.schema, object.parent, object.name]);
}

function ordered(objects: CatalogObject[]) {
  return objects.toSorted((a, b) =>
    objectKey(a) < objectKey(b) ? -1 : objectKey(a) > objectKey(b) ? 1 : 0,
  );
}

export async function captureSchema(
  sql: postgres.Sql,
): Promise<SchemaSnapshot> {
  return sql.begin(
    'isolation level repeatable read read only',
    captureSchemaInTransaction,
  );
}

export async function captureSchemaInTransaction(
  tx: postgres.TransactionSql,
): Promise<SchemaSnapshot> {
  await tx`SET LOCAL search_path TO pg_catalog`;
  await tx`SET LOCAL statement_timeout TO '10s'`;
  await tx`SET LOCAL lock_timeout TO '1s'`;
  await tx`SET LOCAL idle_in_transaction_session_timeout TO '15s'`;
  const [database] = await tx`
      SELECT current_database() AS name, current_user AS role,
        current_setting('server_version_num')::int AS "serverVersion",
        pg_encoding_to_char(d.encoding) AS encoding, d.datcollate AS collation, d.datctype AS ctype,
        d.datlocprovider AS "localeProvider", d.datcollversion AS "collationVersion",
        coalesce(to_jsonb(d)->>'datlocale', to_jsonb(d)->>'daticulocale') AS locale,
        to_regnamespace('podcst_migrations') IS NOT NULL AS "ledgerPresent"
      FROM pg_database d WHERE d.datname = current_database()
    `;
  if (database.serverVersion < 160000)
    throw new InventoryError(
      'Schema inventory requires PostgreSQL 16 or newer',
    );
  const objects: CatalogObject[] = [];
  for (const [kind, query] of Object.entries(queries)) {
    const rows = await tx.unsafe(`${scope} ${query} LIMIT $1`, [
      objectLimit + 1,
    ]);
    for (const row of rows) {
      if (row.access?.acl) row.access.acl.sort();
      objects.push({
        kind,
        schema: row.schema,
        parent: row.parent,
        name: row.name,
        definition: row.definition,
        access: row.access ?? null,
        manualReview: row.manual_review ?? false,
      });
    }
    if (objects.length > objectLimit)
      throw new InventoryError('Schema inventory exceeds the object limit');
    if (Buffer.byteLength(stable(objects)) > artifactLimit)
      throw new InventoryError('Schema inventory exceeds the size limit');
  }
  const estimates = await tx.unsafe(
    `${scope}
      SELECT c.nspname AS schema, c.relname AS name, c.relkind AS kind,
        CASE WHEN c.reltuples >= 0 THEN c.reltuples::text END AS "estimatedRows",
        (c.relpages::bigint * current_setting('block_size')::bigint)::text AS "estimatedRelationBytes",
        (t.relpages::bigint * current_setting('block_size')::bigint)::text AS "estimatedToastBytes"
      FROM relations c LEFT JOIN pg_class t ON t.oid = c.reltoastrelid
      WHERE c.relkind IN ('r', 'p', 'm', 'i', 'S') ORDER BY c.nspname, c.relname LIMIT $1`,
    [objectLimit + 1],
  );
  if (estimates.length > objectLimit)
    throw new InventoryError('Schema estimates exceed the object limit');
  return {
    database: database as SchemaSnapshot['database'],
    objects: ordered(objects),
    estimates: Array.from(estimates),
  };
}

export function inventoryArtifact(
  snapshot: SchemaSnapshot,
  migrations: Inventory['migrations'] = null,
): InventoryArtifact {
  const inventory: Inventory = {
    format: 'podcst-schema-inventory/1',
    kind: migrations ? 'reference' : 'capture',
    capturedAt: new Date().toISOString(),
    migrations,
    snapshot,
  };
  return validateInventory({ inventory, digest: digest(inventory) });
}

export function validateInventory(value: unknown): InventoryArtifact {
  const artifact = value as InventoryArtifact;
  const inventory = artifact?.inventory;
  if (
    inventory?.format !== 'podcst-schema-inventory/1' ||
    !['reference', 'capture'].includes(inventory.kind) ||
    artifact.digest !== digest(inventory) ||
    !Array.isArray(inventory.snapshot?.objects) ||
    inventory.snapshot.objects.length > objectLimit ||
    !Array.isArray(inventory.snapshot.estimates) ||
    inventory.snapshot.estimates.length > objectLimit ||
    typeof inventory.capturedAt !== 'string' ||
    (inventory.kind === 'reference'
      ? !Array.isArray(inventory.migrations)
      : inventory.migrations !== null) ||
    !Number.isInteger(inventory.snapshot.database?.serverVersion)
  ) {
    throw new InventoryError('Invalid schema inventory or digest');
  }
  const database = inventory.snapshot.database;
  if (
    ![
      database.name,
      database.role,
      database.encoding,
      database.collation,
      database.ctype,
      database.localeProvider,
    ].every((value) => typeof value === 'string') ||
    ![database.locale, database.collationVersion].every(
      (value) => value === null || typeof value === 'string',
    ) ||
    typeof database.ledgerPresent !== 'boolean'
  ) {
    throw new InventoryError('Invalid database metadata');
  }
  const keys = new Set<string>();
  for (const object of inventory.snapshot.objects) {
    if (
      !object ||
      !Object.hasOwn(queries, object.kind) ||
      ![object.kind, object.schema, object.parent, object.name].every(
        (part) => typeof part === 'string',
      ) ||
      !object.definition ||
      typeof object.definition !== 'object' ||
      Array.isArray(object.definition) ||
      (object.access !== null &&
        (!object.access ||
          typeof object.access !== 'object' ||
          Array.isArray(object.access))) ||
      typeof object.manualReview !== 'boolean' ||
      keys.has(objectKey(object))
    ) {
      throw new InventoryError('Invalid or duplicate schema object');
    }
    keys.add(objectKey(object));
  }
  return artifact;
}

export function compareSchemas(
  expected: InventoryArtifact,
  actual: InventoryArtifact,
  through?: string,
) {
  validateInventory(expected);
  validateInventory(actual);
  const active = loadMigrations();
  const end =
    through === undefined
      ? active.length - 1
      : active.findIndex((migration) => migration.name === through);
  if (end < 0) throw new InventoryError('Unknown migration reference boundary');
  const migrations = active.slice(0, end + 1).map(({ name, checksum }) => ({
    name,
    checksum,
  }));
  if (
    expected.inventory.kind !== 'reference' ||
    stable(expected.inventory.migrations) !== stable(migrations)
  ) {
    throw new InventoryError(
      'Expected inventory must be a reference for the current active migrations',
    );
  }
  if (actual.inventory.kind !== 'capture')
    throw new InventoryError('Actual inventory must be a target capture');
  const reference = new Map(
    expected.inventory.snapshot.objects.map((object) => [
      objectKey(object),
      object,
    ]),
  );
  const target = new Map(
    actual.inventory.snapshot.objects.map((object) => [
      objectKey(object),
      object,
    ]),
  );
  const missing: CatalogObject[] = [];
  const extra: CatalogObject[] = [];
  const changed: { key: string; expected: Definition; actual: Definition }[] =
    [];
  const accessChanges: {
    key: string;
    expected: Definition | null;
    actual: Definition | null;
  }[] = [];
  for (const object of ordered([...reference.values()])) {
    const key = objectKey(object);
    const other = target.get(key);
    if (!other) missing.push(object);
    else {
      if (stable(object.definition) !== stable(other.definition))
        changed.push({
          key,
          expected: object.definition,
          actual: other.definition,
        });
      if (stable(object.access) !== stable(other.access))
        accessChanges.push({
          key,
          expected: object.access,
          actual: other.access,
        });
    }
  }
  for (const object of ordered([...target.values()]))
    if (!reference.has(objectKey(object))) extra.push(object);
  const environment = (snapshot: SchemaSnapshot) => {
    const {
      serverVersion,
      encoding,
      collation,
      ctype,
      localeProvider,
      locale,
      collationVersion,
    } = snapshot.database;
    return {
      majorVersion: Math.floor(serverVersion / 10000),
      encoding,
      collation,
      ctype,
      localeProvider,
      locale,
      collationVersion,
    };
  };
  const expectedEnvironment = environment(expected.inventory.snapshot);
  const actualEnvironment = environment(actual.inventory.snapshot);
  return {
    format: 'podcst-schema-comparison/1',
    expectedDigest: expected.digest,
    actualDigest: actual.digest,
    expectedSchemaDigest: digest(
      ordered([...reference.values()]).map(
        ({ access: _, ...object }) => object,
      ),
    ),
    actualSchemaDigest: digest(
      ordered([...target.values()]).map(({ access: _, ...object }) => object),
    ),
    schemaMatches: !missing.length && !extra.length && !changed.length,
    missing,
    extra,
    changed,
    accessChanges,
    environment: {
      matches: stable(expectedEnvironment) === stable(actualEnvironment),
      expected: expectedEnvironment,
      actual: actualEnvironment,
    },
    manualReview: [
      ...new Set(
        [...reference.values(), ...target.values()]
          .filter((object) => object.manualReview)
          .map(objectKey),
      ),
    ].sort(),
    adoptionApproved: false,
  };
}
