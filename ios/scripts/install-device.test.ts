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
    case "\${!#}" in
        */AudioLab.app/Info.plist) printf 'app.podcst.fixture.audiolab\\n' ;;
        *) printf 'app.podcst.fixture\\n' ;;
    esac
elif [[ $1 == xcodebuild ]]; then
    [[ $MOCK_FAIL != build ]] || exit 23
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -scheme) scheme="$2"; shift ;;
            -derivedDataPath) derived_data="$2"; shift ;;
        esac
        shift
    done
    case "$scheme" in
        Podcst) product=Podcst ;;
        'Podcst Audio Lab') product=AudioLab ;;
        *) exit 99 ;;
    esac
    app="$derived_data/Build/Products/Release-iphoneos/$product.app"
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
  for (const { args, scheme, product, bundle } of [
    {
      args: [],
      scheme: 'Podcst',
      product: 'Podcst',
      bundle: 'app.podcst.fixture',
    },
    {
      args: ['--audio-lab'],
      scheme: 'Podcst Audio Lab',
      product: 'AudioLab',
      bundle: 'app.podcst.fixture.audiolab',
    },
  ]) {
    describe(scheme, () => {
      it('builds Release for the requested phone, installs, and launches without a debugger', async () => {
        const f = await fixture();
        const result = await f.run([...args, 'test-udid']);
        const derivedData = join(f.ios, 'build/device');
        const app = join(
          derivedData,
          `Build/Products/Release-iphoneos/${product}.app`,
        );
        expect(result.code, result.output).toBe(0);
        expect(result.commands).toEqual([
          [
            'xcrun',
            'xcodebuild',
            '-project',
            join(f.ios, 'Podcst.xcodeproj'),
            '-scheme',
            scheme,
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
            bundle,
          ],
        ]);
      });

      it('accepts a saved device and a signing team override', async () => {
        const f = await fixture();
        const result = await f.run(args, {
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
        const result = await f.run([...args, 'explicit-udid'], {
          IOS_DEVICE_ID: 'saved-udid',
        });
        expect(result.code, result.output).toBe(0);
        expect(result.commands[0]).toContain('platform=iOS,id=explicit-udid');
        expect(result.commands[2]).toContain('explicit-udid');
        expect(result.commands[3]).toContain('explicit-udid');
      });

      for (const [index, stage] of [
        'build',
        'plist',
        'install',
        'launch',
      ].entries()) {
        it(`stops immediately when ${stage} fails`, async () => {
          const f = await fixture();
          const result = await f.run([...args, 'test-udid'], {
            MOCK_FAIL: stage,
          });
          expect(result.code).toBe(23);
          expect(result.commands).toHaveLength(index + 1);
        });
      }
    });
  }

  for (const [args, code] of [
    [[], 1],
    [['--unknown'], 1],
    [['phone', 'Debug'], 1],
    [['--audio-lab'], 1],
    [['--audio-lab', '--unknown'], 1],
    [['--audio-lab', 'phone', 'Debug'], 1],
    [['phone', '--audio-lab'], 1],
    [['--audio-lab', 'phone', '--help'], 1],
    [['--audio-lab', '--audio-lab', 'phone'], 1],
    [['--help'], 0],
    [['-h'], 0],
    [['--audio-lab', '--help'], 0],
    [['--audio-lab', '-h'], 0],
  ] as const) {
    it(`prints usage without invoking Xcode for ${JSON.stringify(args)}`, async () => {
      const f = await fixture();
      const result = await f.run([...args]);
      expect(result.code).toBe(code);
      expect(result.output).toContain(
        'Usage: yarn ios:install [--audio-lab] [device-udid]',
      );
      expect(result.commands).toEqual([]);
    });
  }
});
