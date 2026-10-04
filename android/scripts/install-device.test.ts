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
name="$(basename "$0")"
printf '%s\\0' "$name" "$@" >> "$MOCK_LOG"
printf '\\n' >> "$MOCK_LOG"
if [[ $name == gradlew ]]; then
    [[ $MOCK_FAIL != build ]] || exit 23
elif [[ $1 == devices ]]; then
    printf 'List of devices attached\\n%b' "$MOCK_DEVICES"
elif [[ $1 == -s && $3 == install ]]; then
    [[ $MOCK_FAIL != install ]] || exit 23
elif [[ $1 == -s && $3 == shell ]]; then
    [[ $MOCK_FAIL != launch ]] || exit 23
else
    exit 99
fi
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
  await writeFile(join(android, 'gradlew'), mock);
  await chmod(join(android, 'gradlew'), 0o755);
  await writeFile(join(bin, 'adb'), mock);
  await chmod(join(bin, 'adb'), 0o755);
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
          MOCK_FAIL: '',
          MOCK_DEVICES: 'emulator-5554\\tdevice\\n',
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

const component = 'app.podcst.android/app.podcst.MainActivity';

describe('Android Release installation', () => {
  it('builds Release, installs, and relaunches on the first ready device', async () => {
    const f = await fixture();
    const result = await f.run([], {
      MOCK_DEVICES:
        'offline-1\\toffline\\nphone-2\\tunauthorized\\nemulator-5554\\tdevice\\npixel-9\\tdevice\\n',
    });
    const apk = join(
      f.android,
      'app/build/outputs/apk/release/app-release.apk',
    );
    expect(result.code, result.output).toBe(0);
    expect(result.commands).toEqual([
      ['adb', 'devices'],
      [
        'gradlew',
        '-p',
        f.android,
        '--console=plain',
        '-q',
        ':app:assembleRelease',
      ],
      ['adb', '-s', 'emulator-5554', 'install', '-r', apk],
      [
        'adb',
        '-s',
        'emulator-5554',
        'shell',
        'am',
        'start',
        '-S',
        '-n',
        component,
      ],
    ]);
  });

  it('uses the saved serial without listing devices', async () => {
    const f = await fixture();
    const result = await f.run([], { ANDROID_SERIAL: 'saved-serial' });
    expect(result.code, result.output).toBe(0);
    expect(result.commands[0][0]).toBe('gradlew');
    expect(result.commands[1]).toContain('saved-serial');
    expect(result.commands[2]).toContain('saved-serial');
  });

  it('prefers the explicit serial over the saved serial', async () => {
    const f = await fixture();
    const result = await f.run(['explicit-serial'], {
      ANDROID_SERIAL: 'saved-serial',
    });
    expect(result.code, result.output).toBe(0);
    expect(result.commands[1]).toContain('explicit-serial');
    expect(result.commands.flat()).not.toContain('saved-serial');
  });

  it('fails without a ready device and builds nothing', async () => {
    const f = await fixture();
    const result = await f.run([], { MOCK_DEVICES: 'phone\\tunauthorized\\n' });
    expect(result.code).toBe(1);
    expect(result.output).toContain('No ready device');
    expect(result.commands).toEqual([['adb', 'devices']]);
  });

  it('prints help and rejects unexpected arguments', async () => {
    const f = await fixture();
    const help = await f.run(['--help']);
    expect(help.code).toBe(0);
    expect(help.output).toContain('yarn android:install');
    for (const args of [['a', 'b'], ['--release']]) {
      const result = await f.run(args);
      expect(result.code).toBe(1);
      expect(result.commands).toEqual([]);
    }
  });

  for (const step of ['build', 'install', 'launch']) {
    it(`stops when ${step} fails`, async () => {
      const f = await fixture();
      const result = await f.run([], { MOCK_FAIL: step });
      expect(result.code).not.toBe(0);
      const last = result.commands.at(-1) ?? [];
      const expected = {
        build: ':app:assembleRelease',
        install: 'install',
        launch: 'am',
      }[step];
      expect(last).toContain(expected);
    });
  }
});
