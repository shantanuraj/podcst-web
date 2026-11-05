import { afterEach, describe, expect, it } from 'bun:test';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directories: string[] = [];
const phoneType = 'com.apple.CoreSimulator.SimDeviceType.iPhone-Duo';
const tabletType = 'com.apple.CoreSimulator.SimDeviceType.iPad-Pro';

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

function runtime(
  identifier: string,
  version: string,
  isAvailable = true,
  platform = 'iOS',
) {
  return { identifier, version, isAvailable, platform };
}

function device(
  udid: string,
  name = 'iPhone Duo',
  isAvailable = true,
  deviceTypeIdentifier = phoneType,
) {
  return { udid, name, isAvailable, deviceTypeIdentifier };
}

async function select(
  runtimes: ReturnType<typeof runtime>[],
  devices: Record<string, ReturnType<typeof device>[]>,
  status = 0,
) {
  const directory = await mkdtemp(join(tmpdir(), 'ios simulator test '));
  directories.push(directory);
  const environment = join(directory, 'environment');
  const inventory = join(directory, 'inventory.json');
  const xcrun = join(directory, 'xcrun');
  await writeFile(environment, 'EXISTING=value\n');
  await writeFile(
    inventory,
    JSON.stringify({
      runtimes,
      devices,
      devicetypes: [
        { identifier: phoneType, productFamily: 'iPhone' },
        { identifier: tabletType, productFamily: 'iPad' },
      ],
    }),
  );
  await writeFile(
    xcrun,
    `#!/bin/sh
[ "$*" = 'simctl list --json' ] || exit 99
[ "$SIMCTL_STATUS" = 0 ] || exit "$SIMCTL_STATUS"
cat "$SIMCTL_INVENTORY"
`,
  );
  await chmod(xcrun, 0o755);
  const result = Bun.spawnSync(
    ['python3', join(import.meta.dir, 'select-test-simulator.py')],
    {
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        GITHUB_ENV: environment,
        SIMCTL_INVENTORY: inventory,
        SIMCTL_STATUS: String(status),
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  return {
    code: result.exitCode,
    output: result.stdout.toString() + result.stderr.toString(),
    environment: await readFile(environment, 'utf8'),
  };
}

describe('iOS CI simulator selection', () => {
  it('uses runtime versions and device families for hardware-specific runtimes and renamed phones', async () => {
    const identifier = 'com.apple.CoreSimulator.SimRuntime.iOS-27-2-iPhone19-4';
    const result = await select([runtime(identifier, '27.2')], {
      [identifier]: [device('foldable-udid', 'Podcst Continue Regression')],
    });
    expect(result.code, result.output).toBe(0);
    expect(result.environment).toBe(
      'EXISTING=value\nPODCST_TEST_DEVICE=foldable-udid\n',
    );
    expect(result.output).toContain('iOS 27.2');
    expect(result.output).toContain(identifier);
  });

  it('orders runtime versions numerically including minor and patch versions', async () => {
    const result = await select(
      [
        runtime('older', '18.9'),
        runtime('newer', '18.10'),
        runtime('latest', '18.10.1'),
      ],
      {
        older: [device('older-udid')],
        newer: [device('newer-udid')],
        latest: [device('latest-udid')],
      },
    );
    expect(result.code, result.output).toBe(0);
    expect(result.environment).toContain('PODCST_TEST_DEVICE=latest-udid\n');
  });

  it('ignores unavailable devices and runtimes, missing runtimes, and other platforms or device families', async () => {
    const result = await select(
      [
        runtime('available', '18.0'),
        runtime('unavailable', '27.2', false),
        runtime('watch', '27.2', true, 'watchOS'),
        runtime('tablet', '27.2'),
      ],
      {
        available: [
          device('available-udid'),
          device('unavailable-udid', 'iPhone Duo', false),
        ],
        unavailable: [device('runtime-unavailable-udid')],
        missing: [device('missing-runtime-udid')],
        watch: [device('wrong-platform-udid')],
        tablet: [
          device('tablet-udid', 'iPhone named tablet', true, tabletType),
        ],
      },
    );
    expect(result.code, result.output).toBe(0);
    expect(result.environment).toContain('PODCST_TEST_DEVICE=available-udid\n');
  });

  it('fails without publishing a destination when no iPhone is available', async () => {
    const result = await select([runtime('ios', '27.2')], {
      ios: [device('unavailable-udid', 'iPhone Duo', false)],
    });
    expect(result.code).not.toBe(0);
    expect(result.output).toContain('No available iPhone simulator');
    expect(result.environment).toBe('EXISTING=value\n');
  });

  it('requires iOS 18 or later', async () => {
    const result = await select([runtime('old', '17.9')], {
      old: [device('old-udid')],
    });
    expect(result.code).not.toBe(0);
    expect(result.output).toContain('An iOS 18 or later simulator is required');
    expect(result.environment).toBe('EXISTING=value\n');
  });

  it('fails without publishing a destination when simctl fails', async () => {
    const result = await select([], {}, 23);
    expect(result.code).not.toBe(0);
    expect(result.environment).toBe('EXISTING=value\n');
  });
});
