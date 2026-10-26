import { expect, test } from 'bun:test';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('credential generation persists private files without exposing secrets or overwriting custody', () => {
  const directory = mkdtempSync(join(tmpdir(), 'podcst-review-custody-'));
  chmodSync(directory, 0o700);
  try {
    const config = join(directory, 'config.json');
    const output = join(directory, 'credential.json');
    writeFileSync(
      config,
      JSON.stringify({
        store: 'apple',
        email: 'synthetic@example.invalid',
        target: 'development',
        apiOrigin: 'https://example.invalid',
        feeds: {
          public: 'https://example.invalid/public',
          private: 'https://example.invalid/private',
        },
      }),
      { mode: 0o600 },
    );
    const run = (args: string[]) =>
      Bun.spawnSync(
        [
          process.execPath,
          '--no-env-file',
          new URL('./review-account.ts', import.meta.url).pathname,
          ...args,
        ],
        {
          env: { PATH: process.env.PATH, HOME: directory },
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
    const generated = run([
      'credential',
      '--config',
      config,
      '--output',
      output,
    ]);
    expect(generated.exitCode).toBe(0);
    const stored = JSON.parse(readFileSync(output, 'utf8'));
    expect(stored.code).toMatch(/^\d{6}$/);
    expect(statSync(output).mode & 0o777).toBe(0o600);
    expect(
      generated.stdout.toString() + generated.stderr.toString(),
    ).not.toContain(stored.code);
    const repeated = run([
      'credential',
      '--config',
      config,
      '--output',
      output,
    ]);
    expect(repeated.exitCode).toBe(1);
    expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual(stored);
    const token = join(directory, 'token.json');
    const created = run(['sampler-token', '--output', token]);
    expect(created.exitCode).toBe(0);
    const secret = JSON.parse(readFileSync(token, 'utf8')).token;
    expect(secret).toMatch(/^[a-f0-9]{64}$/);
    expect(created.stdout.toString() + created.stderr.toString()).not.toContain(
      secret,
    );
    chmodSync(config, 0o644);
    expect(
      run([
        'credential',
        '--config',
        config,
        '--output',
        join(directory, 'refused.json'),
      ]).exitCode,
    ).toBe(1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 15_000);
