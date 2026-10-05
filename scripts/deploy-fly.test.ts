import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test.each([
  0, 7,
])('Fly deployment forwards arguments and exit status %i without exporting secrets', (code) => {
  const directory = mkdtempSync(join(tmpdir(), 'podcst-fly-test-'));
  const args = join(directory, 'args');
  try {
    writeFileSync(
      join(directory, 'flyctl'),
      `#!/bin/sh
printf '%s\\n' "$@" > "$ARGUMENTS"
test "$FLY_API_TOKEN" = synthetic-token || exit 99
exit "$RESULT"
`,
      { mode: 0o700 },
    );
    const result = Bun.spawnSync(
      ['/bin/bash', 'scripts/deploy-fly.sh', '--config', 'fly.toml'],
      {
        env: {
          PATH: `${directory}:/usr/bin:/bin`,
          ARGUMENTS: args,
          RESULT: String(code),
          FLY_API_TOKEN: 'synthetic-token',
        },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    expect(result.exitCode).toBe(code);
    expect(readFileSync(args, 'utf8').trim().split('\n')).toEqual([
      'deploy',
      '--remote-only',
      '--config',
      'fly.toml',
    ]);
    expect(result.stdout.toString()).toBe('');
    expect(result.stderr.toString()).toBe('');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
