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
if [[ $name == plutil ]]; then
    [[ $MOCK_FAIL != plist ]] || exit 23
    [[ -f "\${!#}" ]] || exit 24
    printf 'app.podcst.fixture\\n'
elif [[ $1 == xcodebuild ]]; then
    [[ $MOCK_FAIL != build ]] || exit 23
    while [[ $1 != -derivedDataPath ]]; do shift; done
    app="$2/Build/Products/Release-iphoneos/Podcst.app"
    mkdir -p "$app"
    touch "$app/Info.plist"
elif [[ $1 == devicectl && $3 == install ]]; then
    [[ $MOCK_FAIL != install ]] || exit 23
elif [[ $1 == devicectl && $3 == process ]]; then
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
  const root = await mkdtemp(join(tmpdir(), 'ios install test '));
  directories.push(root);
  const ios = join(root, 'ios');
  const bin = join(root, 'bin');
  const script = join(ios, 'scripts/install-device.sh');
  const log = join(root, 'commands.log');
  await mkdir(join(ios, 'scripts'), { recursive: true });
  await mkdir(bin);
  await copyFile(join(import.meta.dir, 'install-device.sh'), script);
  await writeFile(log, '');
  for (const name of ['xcrun', 'plutil']) {
    await writeFile(join(bin, name), mock);
    await chmod(join(bin, name), 0o755);
  }
  return {
    ios,
    async run(args: string[] = [], env: Record<string, string> = {}) {
      const result = Bun.spawnSync(['/bin/bash', script, ...args], {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          IOS_DEVICE_ID: '',
          DEVELOPMENT_TEAM: '',
          MOCK_LOG: log,
          MOCK_FAIL: '',
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

describe('iOS Release installation', () => {
  it('builds Release for the requested phone, installs, and launches without a debugger', async () => {
    const f = await fixture();
    const result = await f.run(['test-udid']);
    const derivedData = join(f.ios, 'build/device');
    const app = join(derivedData, 'Build/Products/Release-iphoneos/Podcst.app');
    expect(result.code, result.output).toBe(0);
    expect(result.commands).toEqual([
      [
        'xcrun',
        'xcodebuild',
        '-project',
        join(f.ios, 'Podcst.xcodeproj'),
        '-scheme',
        'Podcst',
        '-configuration',
        'Release',
        '-sdk',
        'iphoneos',
        '-destination',
        'platform=iOS,id=test-udid',
        '-derivedDataPath',
        derivedData,
        '-allowProvisioningUpdates',
        '-allowProvisioningDeviceRegistration',
        '-quiet',
        'build',
      ],
      [
        'plutil',
        '-extract',
        'CFBundleIdentifier',
        'raw',
        '-o',
        '-',
        `${app}/Info.plist`,
      ],
      [
        'xcrun',
        'devicectl',
        'device',
        'install',
        'app',
        '--device',
        'test-udid',
        app,
      ],
      [
        'xcrun',
        'devicectl',
        'device',
        'process',
        'launch',
        '--device',
        'test-udid',
        '--terminate-existing',
        'app.podcst.fixture',
      ],
    ]);
  });

  it('accepts a saved device and a signing team override', async () => {
    const f = await fixture();
    const result = await f.run([], {
      IOS_DEVICE_ID: 'saved-udid',
      DEVELOPMENT_TEAM: 'TESTTEAM',
    });
    expect(result.code, result.output).toBe(0);
    expect(result.commands[0]).toContain('platform=iOS,id=saved-udid');
    expect(result.commands[0]).toContain('DEVELOPMENT_TEAM=TESTTEAM');
    expect(result.commands[2]).toContain('saved-udid');
    expect(result.commands[3]).toContain('saved-udid');
  });

  it('prefers the explicit device over the saved device', async () => {
    const f = await fixture();
    const result = await f.run(['explicit-udid'], {
      IOS_DEVICE_ID: 'saved-udid',
    });
    expect(result.code, result.output).toBe(0);
    expect(result.commands[0]).toContain('platform=iOS,id=explicit-udid');
    expect(result.commands[2]).toContain('explicit-udid');
    expect(result.commands[3]).toContain('explicit-udid');
  });

  for (const args of [
    [],
    ['--unknown'],
    ['phone', 'Debug'],
    ['--help'],
    ['-h'],
  ]) {
    it(`prints usage without invoking Xcode for ${JSON.stringify(args)}`, async () => {
      const f = await fixture();
      const result = await f.run(args);
      expect(result.code).toBe(
        args[0] === '--help' || args[0] === '-h' ? 0 : 1,
      );
      expect(result.output).toContain('Usage: yarn ios:install <device-udid>');
      expect(result.commands).toEqual([]);
    });
  }

  for (const [index, stage] of [
    'build',
    'plist',
    'install',
    'launch',
  ].entries()) {
    it(`stops immediately when ${stage} fails`, async () => {
      const f = await fixture();
      const result = await f.run(['test-udid'], { MOCK_FAIL: stage });
      expect(result.code).toBe(23);
      expect(result.commands).toHaveLength(index + 1);
    });
  }
});
