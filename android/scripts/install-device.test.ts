import { afterEach, describe, expect, it } from 'bun:test';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directories: string[] = [];

const mock = `#!/bin/bash
set -euo pipefail
printf '%s\\0' android "$@" >> "$MOCK_LOG"
printf '\\n' >> "$MOCK_LOG"
exit "$MOCK_EXIT_CODE"
`;

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'android install test '));
  directories.push(root);
  const android = join(root, 'android');
  const bin = join(root, 'bin');
  const script = join(android, 'scripts/install-device.sh');
  const log = join(root, 'commands.log');
  await mkdir(join(android, 'scripts'), { recursive: true });
  await mkdir(bin);
  await copyFile(join(import.meta.dir, 'install-device.sh'), script);
  await writeFile(log, '');
  await writeFile(join(bin, 'android'), mock);
  await chmod(join(bin, 'android'), 0o755);
  return {
    android,
    async run(args: string[] = [], env: Record<string, string> = {}) {
      const result = Bun.spawnSync(['/bin/bash', script, ...args], {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          ANDROID_SERIAL: '',
          MOCK_LOG: log,
          MOCK_EXIT_CODE: '0',
          ...env,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const commands = (await readFile(log, 'utf8'))
        .split('\n')
        .filter(Boolean)
        .map((line) => line.split('\0').slice(0, -1));
      return {
        code: result.exitCode,
        output: result.stdout.toString() + result.stderr.toString(),
        commands,
      };
    },
  };
}

describe('Android Release installation', () => {
  it('delegates the Release build, install, launch, and device selection to Android CLI', async () => {
    const f = await fixture();
    const result = await f.run();
    expect(result.code, result.output).toBe(0);
    expect(result.commands).toEqual([
      [
        'android',
        'run',
        `${f.android}?:app@release`,
        '--',
        '--console=plain',
        '-q',
      ],
    ]);
  });

  it('passes the saved serial to Android CLI', async () => {
    const f = await fixture();
    const result = await f.run([], { ANDROID_SERIAL: 'saved-serial' });
    expect(result.code, result.output).toBe(0);
    expect(result.commands).toEqual([
      [
        'android',
        'run',
        `${f.android}?:app@release`,
        '--device=saved-serial',
        '--',
        '--console=plain',
        '-q',
      ],
    ]);
  });

  it('prefers the explicit serial over the saved serial', async () => {
    const f = await fixture();
    const result = await f.run(['explicit-serial'], {
      ANDROID_SERIAL: 'saved-serial',
    });
    expect(result.code, result.output).toBe(0);
    expect(result.commands[0]).toContain('--device=explicit-serial');
    expect(result.commands.flat()).not.toContain('--device=saved-serial');
  });

  it('prints help and rejects unexpected arguments', async () => {
    const f = await fixture();
    for (const flag of ['--help', '-h']) {
      const help = await f.run([flag]);
      expect(help.code).toBe(0);
      expect(help.output).toContain('yarn android:install');
      expect(help.commands).toEqual([]);
    }
    for (const args of [['a', 'b'], ['--release'], ['--help', 'serial']]) {
      const result = await f.run(args);
      expect(result.code).toBe(1);
      expect(result.commands).toEqual([]);
    }
  });

  it('propagates Android CLI failures', async () => {
    const f = await fixture();
    const result = await f.run([], { MOCK_EXIT_CODE: '23' });
    expect(result.code).toBe(23);
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0]).toContain('run');
  });
});
