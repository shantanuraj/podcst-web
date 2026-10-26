import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { link, open, readdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type DeletionRecord,
  deletionSignature,
  parseDeletionRecord,
  verifyDeletionSignature,
} from '../../src/server/deletion/record';
import { readJsonBody } from '../../src/server/http/json-body';

export function deletionLog(directory: string, secret: string) {
  const parse = (source: string) => {
    const value = JSON.parse(source);
    const record = parseDeletionRecord(value.record);
    if (!verifyDeletionSignature(record, value.signature, secret))
      throw new Error('Deletion journal integrity failure');
    return { record, signature: value.signature as string };
  };
  return {
    async append(record: DeletionRecord) {
      record = parseDeletionRecord(record);
      const signature = deletionSignature(record, secret);
      const path = join(directory, `${record.operationId}.json`);
      const temporary = join(directory, `.${randomUUID()}.tmp`);
      const file = await open(temporary, 'wx', 0o600);
      try {
        await file.writeFile(JSON.stringify({ record, signature }));
        await file.sync();
      } finally {
        await file.close();
      }
      try {
        try {
          await link(temporary, path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
        const saved = parse(await readFile(path, 'utf8'));
        if (saved.signature !== signature)
          throw new Error('Deletion operation identity conflict');
        const parent = await open(directory, 'r');
        try {
          await parent.sync();
        } finally {
          await parent.close();
        }
        return { operationId: record.operationId, signature };
      } finally {
        await unlink(temporary);
      }
    },
    async records() {
      const entries = await readdir(directory);
      const records: DeletionRecord[] = [];
      for (const name of entries.sort()) {
        if (name.startsWith('.') && name.endsWith('.tmp')) continue;
        const value = parse(await readFile(join(directory, name), 'utf8'));
        if (name !== `${value.record.operationId}.json`)
          throw new Error('Deletion journal filename mismatch');
        records.push(value.record);
      }
      return records;
    },
  };
}

export function journalHandler(
  log: ReturnType<typeof deletionLog>,
  secret: string,
) {
  if (Buffer.byteLength(secret) < 32)
    throw new Error('Deletion journal key unavailable');
  const hash = (value: string) => createHash('sha256').update(value).digest();
  return async (request: Request) => {
    try {
      if (
        request.method !== 'POST' ||
        new URL(request.url).pathname !== '/deletions'
      )
        return new Response(null, { status: 404 });
      if (
        !timingSafeEqual(
          hash(request.headers.get('authorization') ?? ''),
          hash(`Bearer ${secret}`),
        )
      )
        return new Response(null, { status: 403 });
      const record = parseDeletionRecord(
        await readJsonBody(request, 2048, 5000, {}),
      );
      return Response.json(await log.append(record), {
        headers: { 'Cache-Control': 'no-store' },
      });
    } catch {
      return new Response(null, { status: 503 });
    }
  };
}
