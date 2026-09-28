import { afterEach, describe, expect, it } from 'bun:test';
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script = resolve(import.meta.dir, 'deploy-img-proxy.sh');
const directories: string[] = [];
const units = [
  'podcst-img-proxy.service',
  'podcst-img-proxy-prewarm.service',
  'podcst-img-proxy-prewarm.timer',
];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function command(args: string[], cwd?: string) {
  const result = Bun.spawnSync(args, { cwd, stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}

// No real privilege changes, service operations, network health checks or Bun
// installs/tests are performed by this harness. Git and filesystem operations
// are real, but confined to temporary repositories/releases.
const mock = `#!/usr/bin/env bash
set -euo pipefail
name=$(basename "$0")
printf '%s:%s:%s\\n' "$name" "\${MOCK_USER:-operator}" "$*" >>"$MOCK_LOG"
new=0
if [[ $(readlink -f "$IMG_PROXY_CURRENT") != "$MOCK_PREVIOUS" ]]; then new=1; fi
case "$name" in
  id)
    if [[ \${1:-} == -u ]]; then printf '%s\\n' "\${MOCK_ROOT:-1000}"; fi
    ;;
  sudo)
    if [[ \${1:-} == -v ]]; then exit 0; fi
    [[ $1 == /bin/bash && $3 == --activate ]] || exit 99
    export MOCK_ROOT=0
    exec "$@"
    ;;
  chown) : ;;
  install)
    args=()
    while (( $# )); do
      case "$1" in
        -o|-g) shift 2 ;;
        *) args+=("$1"); shift ;;
      esac
    done
    if [[ \${MOCK_FAIL:-} == unit-install && \${args[-1]} == "$IMG_PROXY_UNIT_DIR/podcst-img-proxy-prewarm.service" ]]; then exit 17; fi
    /usr/bin/install "\${args[@]}"
    ;;
  runuser)
    [[ $1 == -u && $2 == svc-podcst && $3 == -- ]] || exit 99
    shift 3
    export MOCK_USER=svc-podcst MOCK_ROOT=993
    exec "$@"
    ;;
  bun)
    printf 'bun-cwd:%s\\n' "$PWD" >>"$MOCK_LOG"
    case "$*" in
      install*)
        [[ \${MOCK_FAIL:-} != install ]] || exit 10
        mkdir -p node_modules
        printf 'installed' >node_modules/dependency
        ;;
      test)
        [[ \${MOCK_FAIL:-} != tests ]] || exit 11
        if [[ \${MOCK_FAIL:-} == external-switch ]]; then
          mkdir "$IMG_PROXY_RELEASES/other-deployment"
          ln -s "$IMG_PROXY_RELEASES/other-deployment" "$IMG_PROXY_CURRENT.other"
          mv -Tf "$IMG_PROXY_CURRENT.other" "$IMG_PROXY_CURRENT"
        fi
        ;;
      'run test:socket') [[ \${MOCK_FAIL:-} != socket ]] || exit 12 ;;
      *) exit 99 ;;
    esac
    ;;
  systemd-analyze) [[ \${MOCK_FAIL:-} != units ]] || exit 13 ;;
  systemctl)
    unit=\${!#}
    case "$1" in
      is-active)
        case "$unit" in
          podcst-img-proxy.service) test -e "$MOCK_STATE/main-active" ;;
          podcst-img-proxy-prewarm.timer) test -e "$MOCK_STATE/timer-active" ;;
          podcst-img-proxy-prewarm.service) test -e "$MOCK_STATE/prewarm-active" ;;
          *) exit 99 ;;
        esac
        ;;
      stop)
        case "$unit" in
          podcst-img-proxy-prewarm.timer) rm -f "$MOCK_STATE/timer-active" ;;
          podcst-img-proxy-prewarm.service) rm -f "$MOCK_STATE/prewarm-active" ;;
          *) exit 99 ;;
        esac
        ;;
      start)
        [[ $unit == podcst-img-proxy-prewarm.timer ]] || exit 99
        if (( new )) && [[ \${MOCK_FAIL:-} == timer ]]; then exit 14; fi
        touch "$MOCK_STATE/timer-active"
        ;;
      restart)
        [[ $unit == podcst-img-proxy.service ]] || exit 99
        rm -f "$MOCK_STATE/main-active"
        if [[ \${MOCK_FAIL:-} == rollback ]]; then exit 15; fi
        if (( new )); then
          if [[ \${MOCK_FAIL:-} == restart ]]; then exit 15; fi
          if [[ \${MOCK_FAIL:-} == interrupt ]]; then kill -TERM "$PPID"; exit 143; fi
        fi
        touch "$MOCK_STATE/main-active"
        ;;
      daemon-reload)
        if (( new )) && [[ \${MOCK_FAIL:-} == reload ]]; then exit 16; fi
        ;;
      *) exit 99 ;;
    esac
    ;;
  curl)
    url=\${!#}
    if (( new )); then
      if [[ \${MOCK_FAIL:-} == local-health && $url == http:* ]]; then exit 22; fi
      if [[ \${MOCK_FAIL:-} == public-health && $url == https:* ]]; then exit 22; fi
      if [[ \${MOCK_FAIL:-} == bad-health ]]; then printf '{"status":"cache unavailable"}'; exit 0; fi
    fi
    printf '{"status":"ok"}'
    ;;
  sleep) : ;;
  *) exit 99 ;;
esac
`;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'deploy-img-proxy-test-'));
  directories.push(root);
  const repo = join(root, 'checkout with spaces');
  const remote = join(root, 'remote.git');
  const releases = join(root, 'releases');
  const previous = join(releases, 'previous');
  const current = join(root, 'img_proxy');
  const unitDir = join(root, 'units');
  const state = join(root, 'state');
  const bin = join(root, 'bin');
  const log = join(root, 'commands.log');
  for (const path of [
    join(repo, 'src'),
    join(repo, 'systemd'),
    previous,
    unitDir,
    state,
    bin,
  ]) {
    await mkdir(path, { recursive: true });
  }
  await writeFile(
    join(repo, 'src/index.ts'),
    'export const release = "committed";\n',
  );
  await writeFile(join(repo, 'bun.lock'), '{}\n');
  await writeFile(join(repo, 'package.json'), '{"name":"img_proxy"}\n');
  for (const name of units) {
    await writeFile(join(repo, 'systemd', name), `new:${name}\n`);
    await writeFile(join(unitDir, name), `old:${name}\n`);
  }
  await mkdir(join(unitDir, `${units[0]}.d`));
  await writeFile(
    join(unitDir, `${units[0]}.d`, 'local.conf'),
    'operator override',
  );
  await mkdir(join(root, 'cache'));
  await writeFile(join(root, 'cache', 'keep.cache'), 'persistent artwork');
  await writeFile(join(previous, 'keep.txt'), 'previous release');
  await symlink(previous, current);
  await writeFile(join(state, 'main-active'), '');
  await writeFile(join(state, 'timer-active'), '');
  await writeFile(log, '');
  await writeFile(join(bin, 'mock'), mock);
  await chmod(join(bin, 'mock'), 0o755);
  for (const name of [
    'id',
    'sudo',
    'chown',
    'install',
    'runuser',
    'bun',
    'systemctl',
    'systemd-analyze',
    'curl',
    'sleep',
  ]) {
    await symlink('mock', join(bin, name));
  }
  await command(['git', 'init', '--bare', remote]);
  await command(['git', 'init', '-b', 'main', repo]);
  await command(['git', 'config', 'user.name', 'Deployment test'], repo);
  await command(
    ['git', 'config', 'user.email', 'deploy@example.invalid'],
    repo,
  );
  await command(['git', 'add', '.'], repo);
  await command(['git', 'commit', '-m', 'Fixture release'], repo);
  await command(['git', 'remote', 'add', 'origin', remote], repo);
  await command(['git', 'push', '-u', 'origin', 'main'], repo);
  const revision = await command(['git', 'rev-parse', 'HEAD'], repo);
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    IMG_PROXY_REPO: repo,
    IMG_PROXY_BUN: join(bin, 'bun'),
    IMG_PROXY_CURRENT: current,
    IMG_PROXY_RELEASES: releases,
    IMG_PROXY_UNIT_DIR: unitDir,
    IMG_PROXY_LOCK: join(root, 'deploy.lock'),
    IMG_PROXY_LOCAL_HEALTH: 'http://127.0.0.1:3102/health',
    IMG_PROXY_PUBLIC_HEALTH: 'https://assets.podcst.app/health',
    MOCK_PREVIOUS: previous,
    MOCK_LOG: log,
    MOCK_STATE: state,
    MOCK_ROOT: '1000',
    MOCK_FAIL: '',
  };
  return {
    root,
    repo,
    releases,
    previous,
    current,
    unitDir,
    state,
    log,
    revision,
    env,
    async run(args: string[] = [], overrides: Record<string, string> = {}) {
      const child = Bun.spawn(['/bin/bash', script, ...args], {
        cwd: root,
        env: { ...env, ...overrides },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      return { code, output: `${stdout}\n${stderr}` };
    },
  };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function expectPrevious(f: Fixture) {
  expect(await realpath(f.current)).toBe(f.previous);
  for (const name of units)
    expect(await readFile(join(f.unitDir, name), 'utf8')).toBe(`old:${name}\n`);
  expect(await readFile(join(f.previous, 'keep.txt'), 'utf8')).toBe(
    'previous release',
  );
  expect(await readFile(join(f.root, 'cache', 'keep.cache'), 'utf8')).toBe(
    'persistent artwork',
  );
  expect(
    await readFile(join(f.unitDir, `${units[0]}.d`, 'local.conf'), 'utf8'),
  ).toBe('operator override');
  expect(await Bun.file(join(f.state, 'main-active')).exists()).toBe(true);
  expect(await Bun.file(join(f.state, 'timer-active')).exists()).toBe(true);
}

describe.skipIf(process.platform !== 'linux')(
  'image proxy deployment script',
  () => {
    it('deploys the fetched commit, not dirty local files, and preserves cache/timer/drop-ins', async () => {
      const f = await fixture();
      await writeFile(join(f.repo, 'src/index.ts'), 'uncommitted local work');
      await writeFile(join(f.repo, '.env'), 'DO_NOT_DEPLOY=secret');
      const result = await f.run();
      expect(result.code, result.output).toBe(0);
      expect(result.output).toContain(`LIVE: ${f.revision}`);
      const installed = await realpath(f.current);
      expect(
        installed.startsWith(`${f.releases}/${f.revision.slice(0, 12)}.`),
      ).toBe(true);
      expect(await readFile(join(installed, 'src/index.ts'), 'utf8')).toBe(
        'export const release = "committed";\n',
      );
      expect(await readFile(join(installed, '.deploy-revision'), 'utf8')).toBe(
        `${f.revision}\n`,
      );
      expect(await Bun.file(join(installed, '.env')).exists()).toBe(false);
      expect(await readFile(join(f.repo, 'src/index.ts'), 'utf8')).toBe(
        'uncommitted local work',
      );
      for (const name of units) {
        expect(await readFile(join(f.unitDir, name), 'utf8')).toBe(
          `new:${name}\n`,
        );
        expect(
          await readFile(join(installed, '.deploy-state/units', name), 'utf8'),
        ).toBe(`old:${name}\n`);
      }
      expect(
        await readFile(
          join(installed, '.deploy-state/previous-release'),
          'utf8',
        ),
      ).toBe(`${f.previous}\n`);
      expect(await readFile(join(f.root, 'cache/keep.cache'), 'utf8')).toBe(
        'persistent artwork',
      );
      expect(
        await readFile(join(f.unitDir, `${units[0]}.d/local.conf`), 'utf8'),
      ).toBe('operator override');
      expect(await Bun.file(join(f.state, 'timer-active')).exists()).toBe(true);
      const logs = await readFile(f.log, 'utf8');
      expect(logs).toContain(
        'bun:operator:install --production --frozen-lockfile --ignore-scripts',
      );
      expect(logs).toContain('bun:svc-podcst:test');
      expect(logs).toContain('bun:svc-podcst:run test:socket');
      expect(logs).not.toContain('enable');
      expect(logs).not.toContain('start podcst-img-proxy-prewarm.service');
      const staging = logs.match(
        /bun-cwd:(\/tmp\/podcst-img-proxy-deploy\.[^\n]+)\/release/,
      )?.[1];
      if (!staging) throw new Error('Staging directory was not logged');
      expect(
        await Bun.file(join(staging, 'release/package.json')).exists(),
      ).toBe(false);
    });

    it('offers a check-only mode with no sudo or production changes', async () => {
      const f = await fixture();
      const result = await f.run(['--check']);
      expect(result.code, result.output).toBe(0);
      expect(result.output).toContain('CHECK PASSED');
      await expectPrevious(f);
      const logs = await readFile(f.log, 'utf8');
      expect(logs).toContain('bun:operator:run test:socket');
      expect(logs).not.toContain('sudo:');
      expect(logs).not.toContain('systemctl:');
      expect(await readdir(f.releases)).toEqual(['previous']);
    });

    for (const failure of ['install', 'units', 'tests', 'socket']) {
      it(`leaves production untouched when ${failure} fails`, async () => {
        const f = await fixture();
        const result = await f.run([], { MOCK_FAIL: failure });
        expect(result.code, result.output).not.toBe(0);
        await expectPrevious(f);
        expect(await readdir(f.releases)).toEqual(['previous']);
        expect(await readFile(f.log, 'utf8')).not.toContain(
          'restart podcst-img-proxy.service',
        );
      });
    }

    for (const failure of [
      'unit-install',
      'restart',
      'reload',
      'local-health',
      'public-health',
      'bad-health',
      'timer',
      'interrupt',
    ]) {
      it(`rolls back code and units after ${failure} fails`, async () => {
        const f = await fixture();
        const result = await f.run([], { MOCK_FAIL: failure });
        expect(result.code, result.output).not.toBe(0);
        expect(result.output).toContain(
          'Previous release restored and healthy.',
        );
        await expectPrevious(f);
        expect((await readdir(f.releases)).length).toBe(2); // Retain failure evidence.
      }, 20_000);
    }

    it('reports when rollback itself needs operator attention', async () => {
      const f = await fixture();
      const result = await f.run([], { MOCK_FAIL: 'rollback' });
      expect(result.code, result.output).not.toBe(0);
      expect(result.output).toContain('ROLLBACK NEEDS ATTENTION');
      expect(result.output).not.toContain(
        'Previous release restored and healthy.',
      );
      expect(await realpath(f.current)).toBe(f.previous);
      for (const name of units)
        expect(await readFile(join(f.unitDir, name), 'utf8')).toBe(
          `old:${name}\n`,
        );
    });

    it('does not overwrite an independent deployment that happens during testing', async () => {
      const f = await fixture();
      const result = await f.run([], { MOCK_FAIL: 'external-switch' });
      expect(result.code, result.output).not.toBe(0);
      expect(result.output).toContain(
        'Installed release changed during testing',
      );
      expect(await realpath(f.current)).toBe(
        join(f.releases, 'other-deployment'),
      );
      expect(await readFile(f.log, 'utf8')).not.toContain(
        'restart podcst-img-proxy.service',
      );
      for (const name of units)
        expect(await readFile(join(f.unitDir, name), 'utf8')).toBe(
          `old:${name}\n`,
        );
    });

    it('does not activate a previously stopped prewarm timer', async () => {
      const f = await fixture();
      await rm(join(f.state, 'timer-active'));
      const result = await f.run();
      expect(result.code, result.output).toBe(0);
      expect(await Bun.file(join(f.state, 'timer-active')).exists()).toBe(
        false,
      );
      expect(await readFile(f.log, 'utf8')).not.toContain(
        'start podcst-img-proxy-prewarm.timer',
      );
    });

    it('removes newly installed optional units during rollback', async () => {
      const f = await fixture();
      await rm(join(f.state, 'timer-active'));
      await rm(join(f.unitDir, units[1]));
      await rm(join(f.unitDir, units[2]));
      const result = await f.run([], { MOCK_FAIL: 'restart' });
      expect(result.code, result.output).not.toBe(0);
      expect(await realpath(f.current)).toBe(f.previous);
      expect(await readFile(join(f.unitDir, units[0]), 'utf8')).toBe(
        `old:${units[0]}\n`,
      );
      expect(await Bun.file(join(f.unitDir, units[1])).exists()).toBe(false);
      expect(await Bun.file(join(f.unitDir, units[2])).exists()).toBe(false);
    });

    it('refuses to overlap another activation', async () => {
      const f = await fixture();
      const holder = Bun.spawn(
        [
          'flock',
          '-n',
          f.env.IMG_PROXY_LOCK,
          '/bin/bash',
          '-c',
          'printf locked; read -r done',
        ],
        {
          stdin: 'pipe',
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      const reader = holder.stdout.getReader();
      try {
        const ready = await reader.read();
        expect(new TextDecoder().decode(ready.value)).toBe('locked');
        const result = await f.run();
        expect(result.code, result.output).not.toBe(0);
        expect(result.output).toContain(
          'Another image-proxy deployment is running',
        );
        await expectPrevious(f);
      } finally {
        reader.releaseLock();
        holder.stdin.write('done\n');
        holder.stdin.end();
        await holder.exited;
      }
    });

    it('fails a fetch without changing the installation', async () => {
      const f = await fixture();
      await command(
        ['git', 'remote', 'set-url', 'origin', join(f.root, 'missing.git')],
        f.repo,
      );
      const result = await f.run();
      expect(result.code, result.output).not.toBe(0);
      await expectPrevious(f);
      expect(await readdir(f.releases)).toEqual(['previous']);
    });
  },
);
