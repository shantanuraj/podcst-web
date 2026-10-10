import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  createReadStream,
  createWriteStream,
  fsyncSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type postgres from 'postgres';
import {
  canonical,
  JournalError,
} from '../../src/server/erasure/journal-contract';
import { recoverySchema } from '../../src/server/erasure/recovery-database';
import { migrate } from '../migrations';
import { protectedExternalPath, protectedPath } from './artifacts';

export const selectedRecoveryTables = () =>
  [
    ...readFileSync(
      new URL('../podcst-backup.sh', import.meta.url),
      'utf8',
    ).matchAll(/\s-t\s+([a-z_][a-z_0-9]*\.[a-z_][a-z_0-9]*)/g),
  ].map((match) => match[1]);
export async function artifactHash(path: string) {
  const fd = openSync(
    protectedPath(path),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const hash = createHash('sha256');
    for await (const bytes of createReadStream('', { fd, autoClose: false }))
      hash.update(bytes);
    return hash.digest('hex');
  } finally {
    closeSync(fd);
  }
}
export interface ArchiveTools {
  pgBin: string;
  age: string;
  connection: string[];
}
const executable = (tools: ArchiveTools, name: string) =>
  join(tools.pgBin, name);
const toolEnvironment = () => ({
  PATH: process.env.PATH ?? '',
  LC_ALL: 'C',
  PGPASSFILE: '/dev/null',
  PGSERVICEFILE: '/dev/null',
  PGCONNECT_TIMEOUT: '5',
  PGAPPNAME: 'podcst-recovery-archive',
});
async function result(process: ReturnType<typeof Bun.spawn>) {
  if ((await process.exited) !== 0) throw new JournalError(503);
}
async function writeStream(
  path: string,
  stream: ReadableStream<Uint8Array>,
  created = () => {},
) {
  const fd = openSync(
    path,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  created();
  try {
    await pipeline(
      (async function* () {
        const reader = stream.getReader();
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) return;
            yield value;
          }
        } finally {
          reader.releaseLock();
        }
      })(),
      createWriteStream('', { fd, autoClose: false }),
    );
    fsyncSync(fd);
    const directory = openSync(dirname(path), constants.O_RDONLY);
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  } finally {
    closeSync(fd);
  }
}
export async function captureEncryptedArchive(
  tools: ArchiveTools,
  snapshot: string,
  recipient: string,
  path: string,
  kind: 'selected' | 'full',
) {
  const output = protectedExternalPath(
    path,
    new URL('../../', import.meta.url),
  );
  const dump = Bun.spawn(
    [
      executable(tools, 'pg_dump'),
      ...tools.connection,
      '-Fc',
      '--strict-names',
      '--no-owner',
      '--no-privileges',
      '--no-password',
      '--lock-wait-timeout=10s',
      `--snapshot=${snapshot}`,
      ...(kind === 'selected'
        ? selectedRecoveryTables().flatMap((table) => ['-t', table])
        : []),
    ],
    { stdout: 'pipe', stderr: 'ignore', env: toolEnvironment() },
  );
  const encryption = Bun.spawn([tools.age, '-r', recipient], {
    stdin: dump.stdout,
    stdout: 'pipe',
    stderr: 'ignore',
    env: toolEnvironment(),
  });
  try {
    await writeStream(output, encryption.stdout);
    await Promise.all([result(dump), result(encryption)]);
    return await artifactHash(output);
  } finally {
    dump.kill();
    encryption.kill();
    await Promise.all([dump.exited, encryption.exited]);
  }
}

export async function restoreEncryptedArchive(
  sql: postgres.Sql,
  tools: ArchiveTools,
  path: string,
  identity: string,
  expectedHash: string,
  scratch: string,
  expected: { schemaHash: string; catalogHash: string },
) {
  if ((await artifactHash(path)) !== expectedHash) throw new JournalError(503);
  const archive = protectedExternalPath(
    join(scratch, 'restoring.dump'),
    new URL('../../', import.meta.url),
  );
  const orderPath = protectedPath(join(scratch, 'restore.list'));
  const decryption = Bun.spawn([tools.age, '-d', '-i', identity, path], {
    stdout: 'pipe',
    stderr: 'ignore',
    env: toolEnvironment(),
  });
  let created = false;
  try {
    await writeStream(archive, decryption.stdout, () => {
      created = true;
    });
    await result(decryption);
    if ((await artifactHash(path)) !== expectedHash)
      throw new JournalError(503);
    const listing = Bun.spawn(
      [executable(tools, 'pg_restore'), '--list', archive],
      { stdout: 'pipe', stderr: 'ignore', env: toolEnvironment() },
    );
    const toc = await new Response(listing.stdout).text();
    await result(listing);
    const entries = new Map(
      [...toc.matchAll(/^(.+ TABLE DATA (\S+) (\S+) .+)$/gm)].map(
        ([, line, schema, name]) => [`${schema}.${name}`, line],
      ),
    );
    const sequences = [...toc.matchAll(/^(.+ SEQUENCE SET (\S+) (\S+) .+)$/gm)];
    await migrate(sql);
    if (canonical(await recoverySchema(sql)) !== canonical(expected))
      throw new JournalError(503);
    const tables = (
      await sql`SELECT n.nspname || '.' || c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname IN ('public','podcst_migrations') AND c.relkind = 'r' ORDER BY name`
    ).map((row) => row.name as string);
    const selected = selectedRecoveryTables();
    const names = [...entries.keys()].sort().join(',');
    if (
      names !== [...tables].sort().join(',') &&
      names !== [...selected].sort().join(',')
    )
      throw new JournalError(503);
    const edges =
      await sql`SELECT k.conrelid::regclass::text AS child, k.confrelid::regclass::text AS parent FROM pg_constraint k WHERE k.contype = 'f' AND k.conrelid <> k.confrelid`;
    const qualify = (name: string) =>
      name.includes('.') ? name : `public.${name}`;
    const remaining = new Set(entries.keys());
    const order: string[] = [];
    while (remaining.size) {
      const ready = [...remaining].filter(
        (name) =>
          !edges.some(
            (edge) =>
              qualify(edge.child) === name &&
              remaining.has(qualify(edge.parent)),
          ),
      );
      if (!ready.length) throw new JournalError(503);
      for (const name of ready) {
        remaining.delete(name);
        order.push(name);
      }
    }
    const owned =
      await sql`SELECT ns.nspname || '.' || seq.relname AS name FROM pg_class seq JOIN pg_namespace ns ON ns.oid = seq.relnamespace JOIN pg_depend d ON d.objid = seq.oid AND d.deptype IN ('a','i') JOIN pg_class p ON p.oid = d.refobjid JOIN pg_namespace pn ON pn.oid = p.relnamespace WHERE seq.relkind = 'S' AND pn.nspname || '.' || p.relname = ANY(${[...entries.keys()]}::text[]) ORDER BY name`;
    if (
      sequences
        .map(([, , schema, name]) => `${schema}.${name}`)
        .sort()
        .join(',') !==
      owned
        .map((row) => row.name)
        .sort()
        .join(',')
    )
      throw new JournalError(503);
    writeFileSync(
      orderPath,
      `${[
        ...order.map((name) => entries.get(name)),
        ...sequences.map(([line]) => line),
      ].join('\n')}\n`,
      { mode: 0o600, flag: 'wx' },
    );
    await sql.begin(async (tx) => {
      await tx`DELETE FROM podcst_migrations.history`;
      await tx`DELETE FROM public.genres`;
      await tx`DELETE FROM public.state_generation`;
      for (const table of tables) {
        if ((await tx`SELECT 1 FROM ${tx(table)} LIMIT 1`).length)
          throw new JournalError(503);
      }
    });
    const restore = Bun.spawn(
      [
        executable(tools, 'pg_restore'),
        ...tools.connection,
        '--data-only',
        '--exit-on-error',
        '--single-transaction',
        '--no-password',
        '--use-list',
        orderPath,
        archive,
      ],
      { stdout: 'ignore', stderr: 'ignore', env: toolEnvironment() },
    );
    await result(restore);
    await sql.begin(async (tx) => {
      await tx`SET LOCAL synchronous_commit = on`;
      const saved =
        await tx`UPDATE public.recovery_state SET artifact_hash = ${expectedHash} WHERE singleton RETURNING singleton`;
      if (saved.length !== 1) throw new JournalError(503);
    });
  } finally {
    decryption.kill();
    await decryption.exited;
    if (created) unlinkSync(archive);
  }
}
