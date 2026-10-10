import { createPrivateKey, createPublicKey } from 'node:crypto';
import postgres from 'postgres';
import { createPostgresJournal } from '../../src/server/erasure/journal-postgres';
import { createRecoveryControl } from '../../src/server/erasure/recovery-control';
import { protectedExternalPath, readProtected } from '../lib/artifacts';

export interface JournalConfiguration {
  port: number;
  journalId: string;
  databases: { journal: string; authority: string; receipts: string };
  tokens: { recovery: string; admission: string };
  keys: {
    current: string;
    signing: string;
    versions: { id: string; encryption: string; verification: string }[];
  };
}
export function journalConfigurationKeys(config: JournalConfiguration) {
  if (
    !config.keys.versions.length ||
    new Set(config.keys.versions.map((key) => key.id)).size !==
      config.keys.versions.length ||
    config.keys.versions.some(
      (key) =>
        !/^[A-Za-z0-9_-]{1,128}$/.test(key.id) ||
        Buffer.from(key.encryption, 'base64').length !== 32 ||
        Buffer.from(key.encryption, 'base64').toString('base64') !==
          key.encryption,
    )
  )
    throw new Error('Journal keys refused');
  return {
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
}
export async function openJournalConfiguration(path: string) {
  const config = readProtected(
    protectedExternalPath(path, new URL('../../', import.meta.url)),
    128 * 1024,
  ) as JournalConfiguration;
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
          `${url.searchParams.get('host') ?? url.hostname}:${url.port || '5432'}${url.pathname}`,
      ),
    ).size !== 3
  )
    throw new Error('Journal configuration refused');
  const databases = [
    config.databases.journal,
    config.databases.authority,
    config.databases.receipts,
  ].map((url) => {
    const parsed = new URL(url);
    const host = parsed.searchParams.get('host');
    parsed.searchParams.delete('host');
    return postgres(parsed.toString(), {
      ...(host ? { host } : {}),
      max: 6,
      connect_timeout: 5,
      onnotice: () => {},
    });
  });
  const close = () =>
    Promise.all(databases.map((sql) => sql.end({ timeout: 5 })));
  try {
    for (const sql of databases) {
      const [settings] =
        await sql`SELECT current_setting('fsync') AS fsync, current_setting('full_page_writes') AS full_page_writes`;
      if (settings.fsync !== 'on' || settings.full_page_writes !== 'on')
        throw new Error('Journal durability unavailable');
    }
    const keys = journalConfigurationKeys(config);
    const journal = createPostgresJournal(
      databases[0],
      databases[1],
      databases[2],
      config.journalId,
      keys,
    );
    return {
      config,
      journal,
      keys,
      control: createRecoveryControl(databases[1], journal, keys),
      close,
    };
  } catch {
    await close();
    throw new Error('Journal configuration refused');
  }
}
