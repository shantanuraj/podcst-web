import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = (name: string) =>
  readFileSync(new URL(`./recovery-services/${name}`, import.meta.url), 'utf8');
const properties = (text: string) =>
  Object.fromEntries(
    text
      .split('\n')
      .filter((line) => line.includes('='))
      .map((line) => {
        const at = line.indexOf('=');
        return [line.slice(0, at), line.slice(at + 1)];
      }),
  );

test.each([
  [
    'podcst-erasure-journal',
    'svc-podcst-journal',
    'podcst-journal',
    'erasure-journal/serve.js',
  ],
  [
    'podcst-recovery-gateway',
    'svc-podcst-gateway',
    'podcst-gateway',
    'recovery-gateway.js',
  ],
])('%s template requires the existing target cluster and a pinned nonprivileged release', (unit, user, state, entry) => {
  const config = properties(
    `${source('hardening.conf')}\n${source(`${unit}@.service`)}`,
  );
  expect(config).toMatchObject({
    Requisite: 'postgresql@16-main.service',
    User: user,
    Group: user,
    UMask: '0077',
    StateDirectory: state,
    StateDirectoryMode: '0700',
    WorkingDirectory: '/opt/podcst-recovery/%i',
    ExecStart: `/usr/local/bin/bun --no-env-file /opt/podcst-recovery/%i/scripts/${entry} /var/lib/${state}/config.json`,
    ReadOnlyPaths: `/var/lib/${state}`,
    NoNewPrivileges: 'yes',
    ProtectSystem: 'strict',
    ProtectHome: 'yes',
    PrivateTmp: 'yes',
    PrivateDevices: 'yes',
    ProtectKernelTunables: 'yes',
    ProtectKernelModules: 'yes',
    ProtectControlGroups: 'yes',
    RestrictSUIDSGID: 'yes',
    RestrictAddressFamilies: 'AF_UNIX AF_INET AF_INET6',
    CapabilityBoundingSet: '',
    AmbientCapabilities: '',
    MemoryMax: '512M',
    MemorySwapMax: '0',
    TasksMax: '128',
    LimitNOFILE: '4096',
    KillMode: 'control-group',
  });
  expect(config.Requires).toBeUndefined();
  expect(config.ExecStartPre).toBeUndefined();
  expect(config.MemoryDenyWriteExecute).toBeUndefined();
});

test('Caddy template exposes only HTTPS sites in front of fixed loopback listeners', () => {
  const config = source('Caddyfile');
  expect(config).toContain('https://{$RECOVERY_JOURNAL_HOST}');
  expect(config).toContain('https://{$RECOVERY_PUBLIC_HOST}');
  expect(config).toContain('reverse_proxy 127.0.0.1:4311');
  expect(config).toContain('reverse_proxy 127.0.0.1:4312');
  expect(config).not.toContain('tls_insecure_skip_verify');
});
