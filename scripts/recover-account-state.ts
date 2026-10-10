import { lstatSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import {
  isDigest,
  isOperationId,
} from '../src/server/erasure/journal-contract';
import { createRecoveryController } from '../src/server/erasure/recovery';
import { recoverySchema } from '../src/server/erasure/recovery-database';
import { migrationChainHash } from '../src/server/erasure/recovery-manifest';
import { openJournalConfiguration } from './erasure-journal/configuration';
import {
  protectedExternalPath,
  readProtected,
  writeProtected,
} from './lib/artifacts';
import { startPostgres } from './lib/postgres-sandbox';
import {
  type ArchiveTools,
  artifactHash,
  captureEncryptedArchive,
  restoreEncryptedArchive,
} from './lib/recovery-artifact';
import { loadMigrations, migrate } from './migrations';

interface Configuration {
  pgBin: string;
  age: string;
  primary: { socket: string; port: number; database: string; role: string };
  journalConfiguration: string;
  redisUrl: string;
  reference: string;
  output: string;
  run: { id: string; retiredRoles: string[]; servingRole: string };
  artifact: {
    path: string;
    recipient: string;
    identity: string;
    scratch: string;
    kind: 'selected' | 'full';
    digest: string;
  };
}
const external = (path: string) =>
  protectedExternalPath(path, new URL('../', import.meta.url));
export async function runRecoveryCommand(
  command: string,
  configuration: string,
) {
  if (
    ![
      'reference',
      'bootstrap',
      'capture',
      'recover',
      'rotate-auth',
      'retire',
      'abandon',
    ].includes(command)
  )
    throw new Error('Recovery command refused');
  const config = readProtected(
    external(configuration),
    64 * 1024,
  ) as Configuration;
  const output = external(config.output);
  if (lstatSync(output, { throwIfNoEntry: false }))
    throw new Error('Output already exists');
  if (!isAbsolute(config.pgBin))
    throw new Error('Explicit PostgreSQL tools required');
  if (command === 'reference') {
    const previous = process.env.PG_BIN;
    process.env.PG_BIN = config.pgBin;
    const sandbox = startPostgres();
    try {
      await migrate(sandbox.sql);
      writeProtected(output, await recoverySchema(sandbox.sql));
    } finally {
      await sandbox.stop();
      if (previous === undefined) delete process.env.PG_BIN;
      else process.env.PG_BIN = previous;
    }
    return;
  }
  const expected = readProtected(external(config.reference), 4096) as {
    schemaHash: string;
    catalogHash: string;
  };
  if (
    expected.schemaHash !== migrationChainHash(loadMigrations()) ||
    !isDigest(expected.catalogHash)
  )
    throw new Error('Recovery reference refused');
  const opened = await openJournalConfiguration(
    external(config.journalConfiguration),
  );
  let sql: postgres.Sql | undefined;
  let redis: Redis | undefined;
  try {
    if (command === 'retire') {
      if (!isDigest(config.artifact.digest)) throw new Error();
      await opened.control.exclusive((lease) =>
        lease.retireArtifact(config.artifact.digest),
      );
      writeProtected(output, {
        eligible: false,
        artifactHash: config.artifact.digest,
      });
      return;
    }
    if (command === 'abandon') {
      if (!isOperationId(config.run.id)) throw new Error();
      await opened.control.exclusive((lease) => lease.abandon(config.run.id));
      writeProtected(output, { abandoned: config.run.id, admission: 'closed' });
      return;
    }
    const target = config.primary;
    if (
      !isAbsolute(target.socket) ||
      !Number.isInteger(target.port) ||
      target.port < 1 ||
      target.port > 65535 ||
      !target.database ||
      !target.role ||
      !config.redisUrl
    )
      throw new Error('Explicit recovery target required');
    sql = postgres({
      host: target.socket,
      port: target.port,
      database: target.database,
      username: target.role,
      password: '',
      ssl: false,
      max: 6,
      connect_timeout: 5,
      onnotice: () => {},
    });
    const [actual] =
      await sql`SELECT current_database() AS database, current_user AS role, current_setting('port')::int AS port, current_setting('fsync') AS fsync, current_setting('full_page_writes') AS writes`;
    if (
      actual.database !== target.database ||
      actual.role !== target.role ||
      actual.port !== target.port ||
      actual.fsync !== 'on' ||
      actual.writes !== 'on'
    )
      throw new Error('Recovery target refused');
    const cache = new URL(config.redisUrl);
    if (!['redis:', 'rediss:'].includes(cache.protocol) || !cache.hostname)
      throw new Error('Recovery cache refused');
    if (['capture', 'recover'].includes(command) && !isAbsolute(config.age))
      throw new Error('Explicit encryption tool required');
    redis = new Redis(config.redisUrl, {
      lazyConnect: true,
      connectTimeout: 1000,
      commandTimeout: 2000,
      maxRetriesPerRequest: 1,
    });
    redis.on('error', () => {});
    const controller = createRecoveryController({
      sql,
      redis,
      ...opened,
      expected,
    });
    const tools: ArchiveTools = {
      pgBin: config.pgBin,
      age: config.age,
      connection: [
        '-h',
        target.socket,
        '-p',
        String(target.port),
        '-U',
        target.role,
        '-d',
        target.database,
      ],
    };
    let result: unknown;
    if (command === 'capture') {
      if (
        !['selected', 'full'].includes(config.artifact.kind) ||
        !config.artifact.recipient
      )
        throw new Error();
      result = await controller.capture((snapshot) =>
        captureEncryptedArchive(
          tools,
          snapshot,
          config.artifact.recipient,
          external(config.artifact.path),
          config.artifact.kind,
        ),
      );
    } else {
      if (
        !isOperationId(config.run.id) ||
        !Array.isArray(config.run.retiredRoles) ||
        !config.run.servingRole
      )
        throw new Error();
      const current =
        command === 'rotate-auth' ? await opened.control.current() : null;
      if (command === 'rotate-auth' && !current) throw new Error();
      const hash =
        command === 'recover'
          ? await artifactHash(external(config.artifact.path))
          : (current?.plan.artifactHash ?? null);
      if (['bootstrap', 'rotate-auth'].includes(command) && config.artifact)
        throw new Error('This operation cannot restore an artifact');
      const primary = sql;
      const attestation = await controller.recover({
        ...config.run,
        mode:
          command === 'rotate-auth'
            ? 'auth-rotation'
            : command === 'recover'
              ? 'checkpoint'
              : 'bootstrap',
        artifactHash: hash,
        ...(command === 'recover' && hash
          ? {
              restore: () =>
                restoreEncryptedArchive(
                  primary,
                  tools,
                  external(config.artifact.path),
                  external(config.artifact.identity),
                  hash,
                  config.artifact.scratch,
                  expected,
                ),
            }
          : {}),
      });
      result = {
        attestation,
        runtimeToken: await opened.control.credential(attestation.value.runId),
      };
    }
    writeProtected(output, result, 64 * 1024);
  } finally {
    redis?.disconnect();
    await sql?.end({ timeout: 5 });
    await opened.close();
  }
}
if (import.meta.main) {
  const [command, flag, path, ...extra] = process.argv.slice(2);
  if (flag !== '--config' || !path || extra.length) {
    console.error(
      'Usage: recover-account-state.ts reference|bootstrap|capture|recover|rotate-auth|retire|abandon --config FILE',
    );
    process.exitCode = 1;
  } else
    void runRecoveryCommand(command, path)
      .then(() =>
        console.log('Recovery command completed; inspect the protected result'),
      )
      .catch(() => {
        console.error(
          'Recovery command refused or outcome unknown; inspect protected state before retrying',
        );
        process.exitCode = 1;
      });
}
