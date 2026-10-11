import { readFileSync } from 'node:fs';

export const selectedRecoveryTables = () =>
  [
    ...readFileSync(
      new URL('./podcst-backup.sh', import.meta.url),
      'utf8',
    ).matchAll(/\s-t\s+([a-z_][a-z_0-9]*\.[a-z_][a-z_0-9]*)/g),
  ].map((match) => match[1]);
