#!/usr/bin/env bun

import { lstatSync } from 'node:fs';
import {
  ArtifactError,
  digest,
  protectedExternalPath,
  readProtected,
  writeProtected,
} from './lib/artifacts';
import { DatabaseTargetError, openDatabase } from './lib/database';
import { startPostgres } from './lib/postgres-sandbox';
import { loadMigrations, MigrationError, migrate } from './migrations';
import {
  artifactLimit,
  captureSchema,
  compareSchemas,
  InventoryError,
  inventoryArtifact,
  validateInventory,
} from './schema-catalog';

function argumentsFor(args: string[]) {
  const [command, ...rest] = args;
  const required =
    command === 'compare'
      ? ['--expected', '--actual', '--output']
      : ['--output'];
  if (
    !['capture', 'reference', 'compare'].includes(command) ||
    rest.length !== required.length * 2
  ) {
    throw new InventoryError(
      'Usage: schema-inventory.ts capture|reference --output FILE; compare --expected FILE --actual FILE --output FILE',
    );
  }
  const options = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) {
    if (
      !required.includes(rest[i]) ||
      options.has(rest[i]) ||
      !rest[i + 1] ||
      rest[i + 1].startsWith('--')
    ) {
      throw new InventoryError('Invalid or duplicate inventory argument');
    }
    options.set(rest[i], rest[i + 1]);
  }
  return { command, options };
}

function outsideRepository(path: string) {
  return protectedExternalPath(path, new URL('../', import.meta.url));
}

async function main(args: string[]) {
  const { command, options } = argumentsFor(args);
  const output = outsideRepository(options.get('--output') ?? '');
  if (lstatSync(output, { throwIfNoEntry: false }))
    throw new InventoryError(
      'Output already exists; choose a new protected path',
    );
  if (command === 'compare') {
    const expected = validateInventory(
      readProtected(
        outsideRepository(options.get('--expected') ?? ''),
        artifactLimit,
      ),
    );
    const actual = validateInventory(
      readProtected(
        outsideRepository(options.get('--actual') ?? ''),
        artifactLimit,
      ),
    );
    const comparison = compareSchemas(expected, actual);
    writeProtected(output, comparison, artifactLimit);
    console.log(
      JSON.stringify({
        digest: digest(comparison),
        schemaMatches: comparison.schemaMatches,
        missing: comparison.missing.length,
        extra: comparison.extra.length,
        changed: comparison.changed.length,
        accessChanges: comparison.accessChanges.length,
        environmentMatches: comparison.environment.matches,
        manualReview: comparison.manualReview.length,
        adoptionApproved: false,
      }),
    );
    return;
  }
  const migrations = command === 'reference' ? loadMigrations() : null;
  const sandbox = command === 'reference' ? startPostgres() : null;
  const sql = sandbox?.sql ?? openDatabase('SCHEMA_DATABASE_URL');
  try {
    if (migrations) await migrate(sql, migrations);
    const artifact = inventoryArtifact(
      await captureSchema(sql),
      migrations?.map(({ name, checksum }) => ({ name, checksum })) ?? null,
    );
    writeProtected(output, artifact, artifactLimit);
    console.log(
      JSON.stringify({
        kind: artifact.inventory.kind,
        digest: artifact.digest,
        objects: artifact.inventory.snapshot.objects.length,
        adoptionApproved: false,
      }),
    );
  } finally {
    if (sandbox) await sandbox.stop();
    else await sql.end({ timeout: 5 });
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(
      error instanceof InventoryError ||
        error instanceof ArtifactError ||
        error instanceof DatabaseTargetError ||
        error instanceof MigrationError
        ? error.message
        : 'Schema inventory failed; inspect protected diagnostics. No adoption was performed.',
    );
    process.exitCode = 1;
  });
}
