import { mkdtempSync, rmSync } from 'node:fs';
import { isIP } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isOperationId } from '../src/server/erasure/journal-contract';
import { writeProtected } from './lib/artifacts';
import {
  type GatewayConfiguration,
  startRecoveryGateway,
} from './recovery-gateway';

type FlyConfiguration = GatewayConfiguration & { journalId: string };
export function flyApplicationEnvironment(
  config: FlyConfiguration,
  environment: Record<string, string | undefined>,
) {
  const upstream = new URL(config.upstream);
  const primary = config.primary;
  if (
    upstream.protocol !== 'http:' ||
    upstream.hostname !== '127.0.0.1' ||
    !upstream.port ||
    Number(upstream.port) < 1024 ||
    Number(upstream.port) === config.port ||
    upstream.pathname !== '/' ||
    upstream.search ||
    upstream.hash ||
    upstream.username ||
    upstream.password ||
    new URL(config.publicOrigin).protocol !== 'https:' ||
    config.upstreamProtection !== undefined ||
    !isOperationId(config.journalId) ||
    !('host' in primary)
  )
    throw new Error('Fly recovery configuration refused');
  const database = new URL(
    `postgres://${isIP(primary.host) === 6 ? `[${primary.host}]` : primary.host}:${primary.port}/${primary.database}`,
  );
  database.username = primary.role;
  database.password = primary.password;
  const env = Object.fromEntries(
    Object.entries(environment).filter(
      ([key, value]) =>
        value !== undefined &&
        !/^(PG(?:_|[A-Z])|MTLS_|ERASURE_|RECOVERY_)/.test(key),
    ),
  ) as Record<string, string>;
  return {
    ...env,
    HOSTNAME: '127.0.0.1',
    PORT: upstream.port,
    VERCEL: '0',
    DATABASE_URL: database.toString(),
    MTLS_CA: primary.tls.ca,
    MTLS_CERT: primary.tls.cert,
    MTLS_KEY: primary.tls.key,
    RECOVERY_ADMISSION_REQUIRED: '1',
    ACCOUNT_ERASURE_ENABLED: '0',
    ERASURE_JOURNAL_URL: config.journal,
    ERASURE_JOURNAL_ID: config.journalId,
    ERASURE_JOURNAL_TOKEN: config.token,
    ERASURE_WRITER_EPOCH: config.epoch,
    ERASURE_VERIFICATION_KEYS: JSON.stringify(config.keys),
  };
}

export async function runFlyRecovery(
  path: string,
  environment = process.env,
  entrypoint = resolve('server.js'),
) {
  const gateway = await startRecoveryGateway(path, '0.0.0.0');
  let child: ReturnType<typeof Bun.spawn> | undefined;
  let stopped: (() => void) | undefined;
  const stop = () => stopped?.();
  try {
    const env = flyApplicationEnvironment(
      gateway.configuration as FlyConfiguration,
      environment,
    );
    const node = Bun.which('node');
    if (!node) throw new Error('Node required');
    child = Bun.spawn([node, entrypoint], {
      env,
      stdout: 'inherit',
      stderr: 'inherit',
    });
    const signal = new Promise<boolean>((resolve) => {
      stopped = () => resolve(true);
    });
    for (const name of ['SIGINT', 'SIGTERM'] as const) process.once(name, stop);
    if (!(await Promise.race([signal, child.exited.then(() => false)])))
      throw new Error('Fly upstream stopped');
  } finally {
    for (const name of ['SIGINT', 'SIGTERM'] as const)
      process.removeListener(name, stop);
    try {
      await gateway.close();
    } finally {
      if (child && child.exitCode === null) {
        child.kill('SIGTERM');
        const deadline = setTimeout(() => child?.kill('SIGKILL'), 5000);
        try {
          await child.exited;
        } finally {
          clearTimeout(deadline);
        }
      }
    }
  }
}

async function main() {
  const encoded = process.env.RECOVERY_GATEWAY_CONFIG;
  if (!encoded || Buffer.byteLength(encoded) > 64 * 1024)
    throw new Error('Protected Fly configuration required');
  const config = JSON.parse(encoded) as FlyConfiguration;
  if (config.port !== 3000 || config.upstream !== 'http://127.0.0.1:3001')
    throw new Error('Fly listener layout refused');
  const directory = mkdtempSync(join(tmpdir(), 'podcst-fly-gateway-'));
  try {
    const path = join(directory, 'config.json');
    writeProtected(path, config, 64 * 1024);
    delete process.env.RECOVERY_GATEWAY_CONFIG;
    await runFlyRecovery(path);
  } finally {
    rmSync(directory, { recursive: true });
  }
}
if (import.meta.main)
  void main().catch(() => {
    console.error('Fly recovery startup refused or upstream stopped');
    process.exitCode = 1;
  });
