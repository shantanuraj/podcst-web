import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deletionSignature } from '../../src/server/deletion/record';
import { deletionLog, journalHandler } from './store';

const secret = 's'.repeat(64);
const record = {
  operationId: '00000000-0000-4000-8000-000000000001',
  accountId: 'a',
  acceptedAt: '2030-01-01T00:00:00.000Z',
};
const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0))
    await rm(path, { recursive: true, force: true });
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'podcst-deletion-journal-'));
  directories.push(directory);
  return { directory, log: deletionLog(directory, secret) };
}

test('concurrent publication is immutable, idempotent and readable after restart', async () => {
  const { directory, log } = await fixture();
  const expected = {
    operationId: record.operationId,
    signature: deletionSignature(record, secret),
  };
  expect(await Promise.all([log.append(record), log.append(record)])).toEqual([
    expected,
    expected,
  ]);
  expect(await deletionLog(directory, secret).records()).toEqual([record]);
  await expect(log.append({ ...record, accountId: 'b' })).rejects.toThrow(
    'identity conflict',
  );
  expect(await log.records()).toEqual([record]);
});

test('corrupt evidence prevents replay and cannot be overwritten by retry', async () => {
  const { directory, log } = await fixture();
  await log.append(record);
  const path = join(directory, `${record.operationId}.json`);
  const content = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(
    path,
    JSON.stringify({ ...content, record: { ...record, accountId: 'b' } }),
  );
  await expect(log.records()).rejects.toThrow('integrity');
  await expect(log.append(record)).rejects.toThrow('integrity');
});

test('publisher accepts only authenticated bounded account-deletion records and offers no history endpoint', async () => {
  const { log } = await fixture();
  const handle = journalHandler(log, secret);
  const request = (value: unknown, token = secret) =>
    new Request('https://journal.example.test/deletions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(value),
    });
  expect((await handle(request(record, 'wrong'))).status).toBe(403);
  expect(
    (await handle(request({ ...record, email: 'private@example.test' })))
      .status,
  ).toBe(503);
  expect(
    (await handle(new Request('https://journal.example.test/deletions')))
      .status,
  ).toBe(404);
  const response = await handle(request(record));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    operationId: record.operationId,
    signature: deletionSignature(record, secret),
  });
  expect(await log.records()).toEqual([record]);
});
