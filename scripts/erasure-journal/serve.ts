import { createPrivateKey, createPublicKey } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import postgres from 'postgres';
import { createJournalHandler } from '../../src/server/erasure/journal-http';
import { createPostgresJournal } from '../../src/server/erasure/journal-postgres';

interface Configuration {
  port: number;
  journalId: string;
  databases: { journal: string; authority: string; receipts: string };
  tokens: { runtime: string; recovery: string; admission: string };
  keys: {
    current: string;
    signing: string;
    versions: { id: string; encryption: string; verification: string }[];
  };
}

async function main() {
  const [path, ...extra] = process.argv.slice(2);
  if (!path || extra.length || (statSync(path).mode & 0o077) !== 0)
    throw new Error();
  const config = JSON.parse(readFileSync(path, 'utf8')) as Configuration;
  if (
    !Number.isInteger(config.port) ||
    config.port < 1024 ||
    config.port > 65535
  )
    throw new Error();
  const urls = Object.values(config.databases).map((value) => new URL(value));
  if (
    urls.length !== 3 ||
    urls.some(
      (url) =>
        !['postgres:', 'postgresql:'].includes(url.protocol) ||
        !url.hostname ||
        !url.username ||
        url.pathname.length < 2,
    ) ||
    new Set(
      urls.map(
        (url) =>
          `${url.hostname}:${url.port || '5432'}${url.pathname}${url.search}`,
      ),
    ).size !== 3
  )
    throw new Error();
  const databases = [
    config.databases.journal,
    config.databases.authority,
    config.databases.receipts,
  ].map((url) => postgres(url, { max: 4, onnotice: () => {} }));
  try {
    for (const sql of databases) {
      const [settings] =
        await sql`SELECT current_setting('fsync') AS fsync, current_setting('full_page_writes') AS full_page_writes`;
      if (settings.fsync !== 'on' || settings.full_page_writes !== 'on')
        throw new Error();
    }
    const keys = {
      current: config.keys.current,
      signing: createPrivateKey(config.keys.signing),
      encryption: new Map(
        config.keys.versions.map((key) => [
          key.id,
          Buffer.from(key.encryption, 'base64'),
        ]),
      ),
      verification: new Map(
        config.keys.versions.map((key) => [
          key.id,
          createPublicKey(key.verification),
        ]),
      ),
    };
    const service = createPostgresJournal(
      databases[0],
      databases[1],
      databases[2],
      config.journalId,
      keys,
    );
    await service.head();
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: config.port,
      fetch: createJournalHandler(
        service,
        new Map([
          ['runtime', config.tokens.runtime],
          ['recovery', config.tokens.recovery],
          ['admission', config.tokens.admission],
        ]),
      ),
    });
    const timer = setInterval(() => {
      void service
        .purgeReceipts()
        .catch(() => console.error('Receipt expiry unavailable'));
    }, 60_000);
    const stop = async () => {
      clearInterval(timer);
      await server.stop(true);
      await Promise.all(databases.map((sql) => sql.end({ timeout: 5 })));
    };
    process.once('SIGTERM', () => {
      void stop();
    });
    process.once('SIGINT', () => {
      void stop();
    });
    console.log(`Journal listening on loopback port ${server.port}`);
  } catch {
    await Promise.all(databases.map((sql) => sql.end({ timeout: 5 })));
    throw new Error();
  }
}

if (import.meta.main)
  void main().catch(() => {
    console.error('Journal startup refused');
    process.exitCode = 1;
  });
