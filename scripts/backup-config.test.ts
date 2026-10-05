import { afterEach, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const directories: string[] = [];
const scripts = ['podcst-backup.sh', 'podcst-identity-backup.sh'];
const configuration = {
  BACKUP_DATABASE_URL: 'postgres://example.invalid/backup_test',
  BACKUP_RECIPIENT: 'synthetic-recipient',
  BACKUP_BUCKET: 'synthetic-backups',
  BACKUP_MIN_PODCASTS: '2',
  BACKUP_MIN_EPISODES: '2',
  AWS_PROFILE: 'synthetic-profile',
};

function run(script: string, overrides: Record<string, string> = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'podcst-backup-config-'));
  directories.push(directory);
  const mock = join(directory, 'mock');
  writeFileSync(
    mock,
    `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const command = process.argv[2];
const args = process.argv.slice(3);
const value = (flag) => args[args.indexOf(flag) + 1];
const record = { command, args, profile: process.env.AWS_PROFILE };
if (command === 'age') record.mode = fs.statSync(args.at(-1)).mode & 0o777;
fs.appendFileSync(path.join(process.env.TEST_ROOT, 'calls'), JSON.stringify(record) + '\\n');
if (process.env.FAIL_COMMAND === command) process.exit(1);
switch (command) {
  case 'date': console.log(args.includes('+%d') ? '02' : '2030-01-02T000000Z'); break;
  case 'mktemp': console.log(fs.mkdtempSync(path.join(process.env.TEST_ROOT, 'dump-'))); break;
  case 'stat': console.log(fs.statSync(args.at(-1)).size); break;
  case 'pg_dump': process.stdout.write('synthetic dump'); break;
  case 'psql': process.stdout.write('1,synthetic\\n2,synthetic\\n'); break;
  case 'zstd':
    if (args.includes('-dc')) process.stdout.write(fs.readFileSync(args.at(-1)));
    else fs.writeFileSync(value('-o'), fs.readFileSync(0));
    break;
  case 'age': fs.writeFileSync(value('-o'), 'synthetic ciphertext'); break;
  case 'aws':
    if (!value('--body').endsWith('.age') || !fs.statSync(value('--body')).size) process.exit(1);
    break;
}
`,
  );
  chmodSync(mock, 0o700);
  for (const command of [
    'date',
    'mktemp',
    'stat',
    'pg_dump',
    'psql',
    'zstd',
    'age',
    'aws',
  ]) {
    writeFileSync(
      join(directory, command),
      `#!/bin/bash\nexec '${process.execPath}' '${mock}' '${command}' "$@"\n`,
      { mode: 0o700 },
    );
  }
  const result = Bun.spawnSync(['/bin/bash', resolve('scripts', script)], {
    env: {
      PATH: `${directory}:/usr/bin:/bin`,
      TEST_ROOT: directory,
      ...configuration,
      ...overrides,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const trace = join(directory, 'calls');
  const calls = existsSync(trace)
    ? readFileSync(trace, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    : [];
  return { result, calls };
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const script of scripts) {
  test.each([
    'BACKUP_DATABASE_URL',
    'BACKUP_RECIPIENT',
    'BACKUP_BUCKET',
  ])(`${script} refuses missing %s before running tools`, (variable) => {
    const { result, calls } = run(script, { [variable]: '' });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain(variable);
    expect(calls).toEqual([]);
  });

  test(`${script} uses explicit targets and uploads only encrypted artifacts`, () => {
    const { result, calls } = run(script);
    expect(result.exitCode).toBe(0);
    const database = calls.filter((call) =>
      ['psql', 'pg_dump'].includes(call.command),
    );
    expect(database.length).toBeGreaterThan(0);
    for (const call of database) {
      expect(call.args[0]).toBe(configuration.BACKUP_DATABASE_URL);
    }
    for (const call of calls.filter((call) => call.command === 'age')) {
      expect(call.args).toContain(configuration.BACKUP_RECIPIENT);
      expect(call.mode).toBe(0o600);
    }
    const uploads = calls.filter((call) => call.command === 'aws');
    expect(uploads).toHaveLength(script === 'podcst-backup.sh' ? 1 : 2);
    for (const call of uploads) {
      expect(call.args).toContain(configuration.BACKUP_BUCKET);
      expect(call.args).toContain('GOVERNANCE');
      expect(call.profile).toBe(configuration.AWS_PROFILE);
    }
  });

  test.each([
    'age',
    script === 'podcst-backup.sh' ? 'pg_dump' : 'psql',
  ])(`${script} does not upload after %s fails`, (command) => {
    const { result, calls } = run(script, { FAIL_COMMAND: command });
    expect(result.exitCode).not.toBe(0);
    expect(calls.some((call) => call.command === 'aws')).toBe(false);
  });
}

for (const variable of ['BACKUP_MIN_PODCASTS', 'BACKUP_MIN_EPISODES']) {
  test.each([
    '',
    '0',
    '-1',
    'invalid',
  ])(`identity backup rejects ${variable}=%s`, (value) => {
    const { result, calls } = run('podcst-identity-backup.sh', {
      [variable]: value,
    });
    expect(result.exitCode).not.toBe(0);
    expect(calls).toEqual([]);
  });
}

test('identity backup refuses a snapshot below the expected row count', () => {
  const { result, calls } = run('podcst-identity-backup.sh', {
    BACKUP_MIN_PODCASTS: '3',
  });
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr.toString()).toMatch(/produced\s+2 rows \(< 3\)/);
  expect(calls.some((call) => call.command === 'aws')).toBe(false);
});
