import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import postgres from 'postgres';
import {
  canonical,
  digest,
  isDigest,
  isOperationId,
  JOURNAL_GENESIS,
  signValue,
} from '../../src/server/erasure/journal-contract';
import {
  createPostgresJournal,
  initializeAuthorityHead,
  initializeJournalHead,
} from '../../src/server/erasure/journal-postgres';
import {
  protectedExternalPath,
  readProtected,
  writeProtected,
} from '../lib/artifacts';
import { startPostgres } from '../lib/postgres-sandbox';
import { captureSchemaInTransaction } from '../schema-catalog';
import {
  type JournalConfiguration,
  journalConfigurationKeys,
} from './configuration';
import { assertJournalStore, journalStorePermissions } from './permissions';

const names = ['journal', 'authority', 'receipts'] as const;
const external = (path: string) =>
  protectedExternalPath(path, new URL('../../', import.meta.url));
const schemaSource = (name: (typeof names)[number]) =>
  readFileSync(new URL(`./${name}.sql`, import.meta.url), 'utf8');
const sourceHashes = () => names.map((name) => digest(schemaSource(name)));
const fingerprint = async (tx: postgres.TransactionSql) =>
  digest(
    canonical(
      (await captureSchemaInTransaction(tx)).objects.map(
        ({ access: _access, ...object }) => object,
      ),
    ),
  );

export interface InitializationConfiguration {
  journalConfiguration: string;
  target: { socket: string; port: number; operator: string; cluster: string };
  epoch: string;
  reference: string;
  intent: string;
  inspection?: string;
  output: string;
}
interface Reference {
  version: 1;
  sources: string[];
  catalogs: string[];
}
interface Observation {
  version: 1;
  configuration: string;
  identities: { database: string; oid: string; cluster: string }[];
  state: 'empty' | 'journal-only' | 'initialized';
}

export async function runInitializationCommand(
  command: string,
  configuration: string,
  fault: (point: string) => Promise<void> = async () => {},
) {
  if (
    !['reference', 'inspect', 'initialize', 'complete-authority'].includes(
      command,
    )
  )
    throw new Error('Initialization command refused');
  const config = readProtected(
    external(configuration),
    16 * 1024,
  ) as InitializationConfiguration & { pgBin: string };
  const output = external(config.output);
  if (lstatSync(output, { throwIfNoEntry: false }))
    throw new Error('Initialization output already exists');
  if (command === 'reference') {
    if (!isAbsolute(config.pgBin)) throw new Error('Explicit tools required');
    const previous = process.env.PG_BIN;
    process.env.PG_BIN = config.pgBin;
    const sandbox = startPostgres();
    try {
      const [version] =
        await sandbox.sql`SELECT current_setting('server_version_num')::int AS version`;
      if (Math.trunc(version.version / 10000) !== 16)
        throw new Error('PostgreSQL 16 required');
      const catalogs = [];
      for (const name of names) {
        await sandbox.sql.unsafe(schemaSource(name));
        catalogs.push(await sandbox.sql.begin('read only', fingerprint));
        await sandbox.sql`DROP SCHEMA ${sandbox.sql(journalStorePermissions[name].schema)} CASCADE`;
      }
      writeProtected(output, { version: 1, sources: sourceHashes(), catalogs });
    } finally {
      await sandbox.stop();
      if (previous === undefined) delete process.env.PG_BIN;
      else process.env.PG_BIN = previous;
    }
    return;
  }
  const reference = readProtected(
    external(config.reference),
    4096,
  ) as Reference;
  const service = readProtected(
    external(config.journalConfiguration),
    128 * 1024,
  ) as JournalConfiguration;
  const target = config.target;
  if (
    reference.version !== 1 ||
    canonical(reference.sources) !== canonical(sourceHashes()) ||
    reference.catalogs.length !== 3 ||
    !reference.catalogs.every(isDigest) ||
    !isAbsolute(target.socket) ||
    !Number.isInteger(target.port) ||
    target.port < 1 ||
    target.port > 65535 ||
    !/^[a-z][a-z0-9_]{0,62}$/.test(target.operator) ||
    !/^[0-9]+$/.test(target.cluster) ||
    !isOperationId(service.journalId) ||
    !isOperationId(config.epoch) ||
    !Number.isInteger(service.port) ||
    service.port < 1024 ||
    service.port > 65535 ||
    service.keys.versions.length !== 1 ||
    Object.keys(service.tokens).sort().join(',') !== 'admission,recovery' ||
    Object.values(service.tokens).some(
      (token) => typeof token !== 'string' || token.length < 43,
    ) ||
    service.tokens.admission === service.tokens.recovery ||
    Object.keys(service.databases).sort().join(',') !==
      'authority,journal,receipts'
  )
    throw new Error('Initialization configuration refused');
  const targets = names.map((name) => {
    const url = new URL(service.databases[name]);
    const database = url.pathname.slice(1);
    const role = url.username;
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      url.hostname !== 'localhost' ||
      Number(url.port) !== target.port ||
      url.password ||
      url.hash ||
      [...url.searchParams.keys()].join(',') !== 'host' ||
      url.searchParams.get('host') !== target.socket ||
      ![database, role].every((value) =>
        /^[a-z][a-z0-9_]{0,62}$/.test(value),
      ) ||
      role === target.operator
    )
      throw new Error('Initialization socket target refused');
    return { database, role };
  });
  if (
    new Set(targets.map((value) => value.database)).size !== 3 ||
    new Set(targets.map((value) => value.role)).size !== 3
  )
    throw new Error('Initialization stores must be distinct');
  const intent = external(config.intent);
  const binding = digest(
    canonical({ service, target, epoch: config.epoch, reference, intent }),
  );
  const databases = targets.map(({ database }) =>
    postgres({
      host: target.socket,
      port: target.port,
      username: target.operator,
      database,
      password: '',
      ssl: false,
      max: 1,
      connect_timeout: 5,
      onnotice: () => {},
    }),
  );
  try {
    const keys = journalConfigurationKeys(service);
    createPostgresJournal(
      databases[0],
      databases[1],
      databases[2],
      service.journalId,
      keys,
    );
    const head = {
      journalId: service.journalId,
      epoch: config.epoch,
      sequence: '0',
      revision: '0',
      hash: JOURNAL_GENESIS,
      sealed: false,
    };
    const inspect = async (
      transactions: postgres.TransactionSql[],
    ): Promise<Observation> => {
      const identities = [];
      for (const [index, tx] of transactions.entries()) {
        const expected = targets[index];
        const [identity] =
          await tx`SELECT current_database() AS database, d.oid::text, current_user AS operator,
          (SELECT system_identifier::text FROM pg_control_system()) AS cluster,
          current_setting('port')::int AS port, current_setting('server_version_num')::int AS version,
          current_setting('fsync') AS fsync, current_setting('full_page_writes') AS writes,
          pg_get_userbyid(d.datdba) AS owner FROM pg_database d WHERE datname = current_database()`;
        if (
          identity.database !== expected.database ||
          identity.operator !== target.operator ||
          identity.owner !== target.operator ||
          identity.cluster !== target.cluster ||
          identity.port !== target.port ||
          Math.trunc(identity.version / 10000) !== 16 ||
          identity.fsync !== 'on' ||
          identity.writes !== 'on'
        )
          throw new Error('Initialization database identity refused');
        identities.push({
          database: identity.database,
          oid: identity.oid,
          cluster: identity.cluster,
        });
        await assertJournalStore(tx, names[index], expected);
        const unsafe =
          await tx`SELECT 1 FROM pg_authid WHERE rolname = ${expected.role} AND (rolcanlogin OR rolpassword IS NOT NULL)
          UNION ALL SELECT 1 FROM pg_roles WHERE rolname <> current_user AND rolcanlogin AND has_database_privilege(oid, current_database(), 'CONNECT')
          UNION ALL SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND usename <> current_user AND backend_type = 'client backend'
          UNION ALL SELECT 1 FROM pg_namespace WHERE nspname = ${journalStorePermissions[names[index]].schema} AND nspowner <> current_user::regrole
          UNION ALL SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = ${journalStorePermissions[names[index]].schema} AND c.relowner <> current_user::regrole`;
        if (unsafe.length)
          throw new Error(
            'Initialization requires dormant operator-owned stores',
          );
        const acl = await tx`WITH permissions AS (
          SELECT datacl AS acl FROM pg_database WHERE datname = current_database()
          UNION ALL SELECT nspacl FROM pg_namespace WHERE nspname = ${journalStorePermissions[names[index]].schema}
          UNION ALL SELECT relacl FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = ${journalStorePermissions[names[index]].schema}
          UNION ALL SELECT attacl FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = ${journalStorePermissions[names[index]].schema}
        ) SELECT 1 FROM permissions p CROSS JOIN LATERAL aclexplode(p.acl) a
        WHERE a.grantee <> current_user::regrole AND (a.grantee <> ${expected.role}::regrole OR a.is_grantable)`;
        if (acl.length) throw new Error('Initialization store ACL refused');
        for (const sibling of targets.filter(
          (_, siblingIndex) => siblingIndex !== index,
        )) {
          const [access] =
            await tx`SELECT has_database_privilege(${expected.role}, ${sibling.database}, 'CONNECT') AS allowed`;
          if (access.allowed)
            throw new Error('Initialization sibling access refused');
        }
        if ((await fingerprint(tx)) !== reference.catalogs[index])
          throw new Error('Initialization schema refused');
        for (const table of Object.keys(
          journalStorePermissions[names[index]].tables,
        )) {
          if (table === 'head' || table === 'epochs') continue;
          const relation = `${journalStorePermissions[names[index]].schema}.${table}`;
          if ((await tx`SELECT 1 FROM ${tx(relation)} LIMIT 1`).length)
            throw new Error('Initialization evidence already exists');
        }
      }
      const heads = [];
      for (const index of [0, 1]) {
        const tx = transactions[index];
        const relation = `${journalStorePermissions[names[index]].schema}.head`;
        const rows =
          await tx`SELECT journal_id AS "journalId", epoch, sequence::text, revision::text, hash, sealed FROM ${tx(relation)} LIMIT 2`;
        if (
          rows.length > 1 ||
          (rows.length === 1 && canonical(rows[0]) !== canonical(head))
        )
          throw new Error('Initialization head refused');
        heads.push(rows.length);
      }
      const epochs =
        await transactions[0]`SELECT epoch FROM erasure_journal.epochs LIMIT 2`;
      if (
        epochs.length !== heads[0] ||
        (epochs.length === 1 && epochs[0].epoch !== config.epoch) ||
        heads[1] > heads[0]
      )
        throw new Error('Initialization history refused');
      return {
        version: 1,
        configuration: binding,
        identities,
        state: heads[1] ? 'initialized' : heads[0] ? 'journal-only' : 'empty',
      };
    };
    const read = () =>
      databases[1].begin('read only', (authority) =>
        databases[2].begin('read only', (receipts) =>
          databases[0].begin('read only', (journal) =>
            inspect([journal, authority, receipts]),
          ),
        ),
      );
    if (command === 'inspect') {
      writeProtected(output, await read());
      return;
    }
    if (!config.inspection) throw new Error('Protected inspection required');
    const observed = readProtected(
      external(config.inspection),
      8192,
    ) as Observation;
    if (
      observed.version !== 1 ||
      observed.configuration !== binding ||
      (command === 'initialize'
        ? observed.state !== 'empty'
        : !['journal-only', 'initialized'].includes(observed.state))
    )
      throw new Error('Initialization inspection refused');
    if (command === 'complete-authority') {
      const original = readProtected(intent, 8192) as Observation;
      if (canonical({ ...observed, state: 'empty' }) !== canonical(original))
        throw new Error('Initialization intent refused');
    }
    await databases[1].begin(async (authority) => {
      await authority`SET LOCAL lock_timeout = '2s'`;
      await authority`LOCK TABLE pg_catalog.pg_authid IN SHARE MODE`;
      await databases[2].begin(async (receipts) => {
        await databases[0].begin(async (journal) => {
          const transactions = [journal, authority, receipts];
          for (const [index, tx] of transactions.entries()) {
            await tx`SET LOCAL lock_timeout = '2s'`;
            await tx`SET LOCAL statement_timeout = '10s'`;
            const store = journalStorePermissions[names[index]];
            for (const table of Object.keys(store.tables))
              await tx`LOCK TABLE ${tx(`${store.schema}.${table}`)} IN ACCESS EXCLUSIVE MODE`;
          }
          if (canonical(await inspect(transactions)) !== canonical(observed))
            throw new Error('Initialization inspection changed');
          if (command === 'initialize') writeProtected(intent, observed);
          writeProtected(`${output}.attempt`, observed);
          await fault('before-journal-commit');
          if (command === 'initialize')
            await initializeJournalHead(
              journal,
              service.journalId,
              config.epoch,
            );
        });
        await fault('after-journal-commit');
        if (observed.state !== 'initialized')
          await initializeAuthorityHead(
            authority,
            service.journalId,
            config.epoch,
          );
        await fault('before-authority-commit');
      });
    });
    await fault('after-authority-commit');
    const completed = await read();
    if (completed.state !== 'initialized')
      throw new Error('Initialization outcome unknown');
    writeProtected(output, {
      ...completed,
      head: signValue(head, keys.current, keys.signing),
    });
  } finally {
    await Promise.all(databases.map((sql) => sql.end({ timeout: 5 })));
  }
}

if (import.meta.main) {
  const [command, flag, path, ...extra] = process.argv.slice(2);
  if (flag !== '--config' || !path || extra.length) {
    console.error(
      'Usage: initialize.ts reference|inspect|initialize|complete-authority --config FILE',
    );
    process.exitCode = 1;
  } else
    void runInitializationCommand(command, path)
      .then(() =>
        console.log(
          'Initialization command completed; inspect the protected result',
        ),
      )
      .catch(() => {
        console.error(
          'Initialization refused or outcome unknown; inspect before any new attempt',
        );
        process.exitCode = 1;
      });
}
