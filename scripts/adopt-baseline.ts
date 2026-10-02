#!/usr/bin/env bun

import { lstatSync } from 'node:fs';
import {
  AdoptionError,
  adoptBaseline,
  inspectBaseline,
  reviewSummary,
  validateReview,
} from './baseline-adoption';
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
  InventoryError,
  inventoryArtifact,
  validateInventory,
} from './schema-catalog';

function argumentsFor(args: string[]) {
  const [command, ...rest] = args;
  const flags =
    command === 'reference'
      ? ['--output']
      : command === 'inspect'
        ? ['--reference', '--runtime-role', '--recovery-evidence', '--output']
        : command === 'apply'
          ? ['--review', '--reviewed', '--receipt']
          : [];
  if (!flags.length || rest.length !== flags.length * 2)
    throw new AdoptionError(
      'Usage: adopt-baseline.ts reference --output FILE | inspect --reference FILE --runtime-role ROLE --recovery-evidence SHA256 --output FILE | apply --review FILE --reviewed SHA256 --receipt FILE',
    );
  const options = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 2) {
    if (
      !flags.includes(rest[index]) ||
      options.has(rest[index]) ||
      !rest[index + 1] ||
      rest[index + 1].startsWith('--')
    )
      throw new AdoptionError('Invalid or duplicate adoption argument');
    options.set(rest[index], rest[index + 1]);
  }
  return { command, options };
}

function artifactPath(value: string) {
  return protectedExternalPath(value, new URL('../', import.meta.url));
}

function unused(path: string) {
  if (lstatSync(path, { throwIfNoEntry: false }))
    throw new AdoptionError(
      'Output already exists; choose a new protected path',
    );
}

async function main(args: string[]) {
  const { command, options } = argumentsFor(args);
  const output = artifactPath(
    options.get('--output') ?? options.get('--receipt') ?? '',
  );
  unused(output);
  if (command === 'reference') {
    const baseline = loadMigrations()[0];
    const sandbox = startPostgres();
    try {
      await migrate(sandbox.sql, [baseline]);
      const reference = inventoryArtifact(await captureSchema(sandbox.sql), [
        { name: baseline.name, checksum: baseline.checksum },
      ]);
      writeProtected(output, reference, artifactLimit);
      console.log(
        JSON.stringify({
          baseline: baseline.name,
          digest: reference.digest,
          productionChanged: false,
        }),
      );
    } finally {
      await sandbox.stop();
    }
    return;
  }
  const reference =
    command === 'inspect'
      ? validateInventory(
          readProtected(
            artifactPath(options.get('--reference') ?? ''),
            artifactLimit,
          ),
        )
      : null;
  const review =
    command === 'apply'
      ? validateReview(
          readProtected(
            artifactPath(options.get('--review') ?? ''),
            artifactLimit,
          ),
        )
      : null;
  const intent = artifactPath(`${output}.intent.json`);
  if (review) unused(intent);
  const sql = openDatabase('MIGRATION_DATABASE_URL');
  try {
    if (reference) {
      const inspected = await inspectBaseline(
        sql,
        reference,
        options.get('--runtime-role') ?? '',
        options.get('--recovery-evidence') ?? '',
      );
      writeProtected(output, inspected, artifactLimit);
      console.log(
        JSON.stringify({
          digest: inspected.digest,
          ...reviewSummary(inspected),
        }),
      );
    } else if (review) {
      const reviewed = options.get('--reviewed') ?? '';
      if (reviewed !== review.digest)
        throw new AdoptionError('Exact reviewed inspection digest is required');
      writeProtected(
        intent,
        {
          format: 'podcst-adoption-intent/1',
          reviewDigest: reviewed,
          requestedAt: new Date().toISOString(),
        },
        artifactLimit,
      );
      const result = await adoptBaseline(sql, review, reviewed);
      const receipt = {
        format: 'podcst-adoption-receipt/1',
        ...result,
        committedAt: new Date().toISOString(),
      };
      writeProtected(output, receipt, artifactLimit);
      console.log(
        JSON.stringify({ ...result, receiptDigest: digest(receipt) }),
      );
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(
      error instanceof AdoptionError ||
        error instanceof ArtifactError ||
        error instanceof DatabaseTargetError ||
        error instanceof MigrationError ||
        error instanceof InventoryError
        ? error.message
        : 'Adoption command failed; inspect protected diagnostics and ledger state before retrying.',
    );
    process.exitCode = 1;
  });
}
