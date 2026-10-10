import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type postgres from 'postgres';
import { writeProtected } from './lib/artifacts';
import {
  createGatewayDatabase,
  type GatewayDatabaseConfiguration,
} from './lib/gateway-database';
import { startPostgres } from './lib/postgres-sandbox';
import { createTLSFixture } from './lib/tls-fixture';

const required = !!process.env.PG_BIN && !!Bun.which('openssl');
if (process.env.REQUIRE_ERASURE_TESTS === '1' && !required)
  throw new Error('PG_BIN and openssl required for gateway database tests');

describe.skipIf(!required)(
  'gateway primary peer and verified mutual TLS',
  () => {
    let cluster: ReturnType<typeof startPostgres>;
    let remote: Extract<GatewayDatabaseConfiguration, { host: string }>;
    let local: Extract<GatewayDatabaseConfiguration, { socket: string }>;
    const clients: postgres.Sql[] = [];
    const connect = (config: GatewayDatabaseConfiguration = remote) => {
      const sql = createGatewayDatabase(config);
      clients.push(sql);
      return sql;
    };
    beforeAll(async () => {
      cluster = startPostgres({ tcp: true });
      const tls = createTLSFixture(
        cluster.directory,
        'IP:127.0.0.1',
        'gateway',
      );
      chmodSync(tls.server.key, 0o600);
      const password = randomUUID();
      await cluster.sql`SET password_encryption = 'scram-sha-256'`;
      for (const role of ['gateway', 'unmapped']) {
        const [statement] =
          await cluster.sql`SELECT format('CREATE ROLE %I LOGIN NOINHERIT PASSWORD %L', ${role}::text, ${password}::text) AS sql`;
        await cluster.sql.unsafe(statement.sql);
      }
      await cluster.sql`CREATE TABLE kept (id int PRIMARY KEY)`;
      await cluster.sql`INSERT INTO kept VALUES (1)`;
      await cluster.sql`GRANT SELECT, UPDATE ON kept TO gateway`;
      appendFileSync(
        join(cluster.directory, 'data', 'postgresql.conf'),
        `
ssl = on
ssl_ca_file = '${tls.ca}'
ssl_cert_file = '${tls.server.cert}'
ssl_key_file = '${tls.server.key}'
`,
      );
      writeFileSync(
        join(cluster.directory, 'data', 'pg_hba.conf'),
        `local all postgres trust
local all all peer map=synthetic_peer
hostssl postgres gateway,unmapped 127.0.0.1/32 scram-sha-256 clientcert=verify-full
host all all 0.0.0.0/0 reject
host all all ::/0 reject
`,
      );
      const identity = Bun.spawnSync(['id', '-un'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      if (identity.exitCode !== 0)
        throw new Error('Synthetic peer identity unavailable');
      writeFileSync(
        join(cluster.directory, 'data', 'pg_ident.conf'),
        `synthetic_peer ${identity.stdout.toString().trim()} gateway\n`,
      );
      await cluster.sql`SELECT pg_reload_conf()`;
      for (let attempt = 0; attempt < 50; attempt++) {
        const [settings] =
          await cluster.sql`SELECT current_setting('ssl') AS ssl`;
        if (settings.ssl === 'on') break;
        await Bun.sleep(50);
      }
      expect(
        (await cluster.sql`SELECT current_setting('ssl') AS ssl`)[0].ssl,
      ).toBe('on');
      expect(
        Array.from(
          await cluster.sql`SELECT error FROM pg_hba_file_rules WHERE error IS NOT NULL`,
        ),
      ).toEqual([]);
      expect(
        Array.from(
          await cluster.sql`SELECT error FROM pg_ident_file_mappings WHERE error IS NOT NULL`,
        ),
      ).toEqual([]);
      local = {
        socket: cluster.directory,
        port: cluster.options.port,
        role: 'gateway',
        database: 'postgres',
      };
      remote = {
        host: '127.0.0.1',
        port: cluster.options.port,
        role: 'gateway',
        database: 'postgres',
        password,
        tls: {
          ca: readFileSync(tls.ca, 'utf8'),
          cert: readFileSync(tls.client.cert, 'utf8'),
          key: readFileSync(tls.client.key, 'utf8'),
        },
      };
    }, 30_000);
    afterAll(async () => {
      await Promise.all(clients.map((sql) => sql.end({ timeout: 1 })));
      await cluster?.stop();
    });

    test('explicit local peer mapping works without a password or TCP fallback', async () => {
      const sql = connect(local);
      const [identity] =
        await sql`SELECT current_user AS role, current_database() AS database, current_setting('transaction_read_only') AS read_only`;
      expect(identity).toEqual({
        role: 'gateway',
        database: 'postgres',
        read_only: 'on',
      });
      expect(await sql`SELECT id FROM kept`).toHaveLength(1);
      await expect(
        connect({ ...local, role: 'unmapped' })`SELECT 1`.execute(),
      ).rejects.toThrow();
      await expect(
        connect({
          ...local,
          socket: join(cluster.directory, 'absent'),
        })`SELECT 1`.execute(),
      ).rejects.toThrow();
    });

    test('SCRAM plus client-certificate authentication verifies CA and IP identity with read-only sessions', async () => {
      const sql = connect();
      const [identity] =
        await sql`SELECT current_user AS role, ssl, client_dn FROM pg_stat_ssl WHERE pid = pg_backend_pid()`;
      expect(identity).toMatchObject({
        role: 'gateway',
        ssl: true,
        client_dn: '/CN=gateway',
      });
      expect(await sql`SELECT id FROM kept`).toHaveLength(1);
      await expect(sql`UPDATE kept SET id = 2`.execute()).rejects.toThrow(
        'read-only',
      );
      expect(await cluster.sql`SELECT id FROM kept WHERE id = 1`).toHaveLength(
        1,
      );
    });

    test('wrong hostname, password and certificate-to-role mapping are refused', async () => {
      await expect(
        connect({ ...remote, host: 'localhost' })`SELECT 1`.execute(),
      ).rejects.toMatchObject({ code: 'ERR_TLS_CERT_ALTNAME_INVALID' });
      await expect(
        connect({ ...remote, password: randomUUID() })`SELECT 1`.execute(),
      ).rejects.toThrow('password authentication failed');
      await expect(
        connect({ ...remote, role: 'unmapped' })`SELECT 1`.execute(),
      ).rejects.toThrow();
    }, 15_000);

    test('wrong CA and foreign client certificates refuse without a plaintext retry', async () => {
      const directory = join(cluster.directory, 'foreign');
      mkdirSync(directory, { mode: 0o700 });
      const tls = createTLSFixture(directory);
      for (const material of [
        { ...remote.tls, ca: readFileSync(tls.ca, 'utf8') },
        {
          ...remote.tls,
          cert: readFileSync(tls.client.cert, 'utf8'),
          key: readFileSync(tls.client.key, 'utf8'),
        },
      ])
        await expect(
          connect({ ...remote, tls: material })`SELECT 1`.execute(),
        ).rejects.toThrow();
    }, 15_000);

    test('a server without TLS cannot accept an mTLS-configured client', async () => {
      const plaintext = startPostgres({ tcp: true });
      try {
        await expect(
          connect({
            ...remote,
            port: plaintext.options.port,
          })`SELECT 1`.execute(),
        ).rejects.toThrow();
      } finally {
        await plaintext.stop();
      }
    }, 15_000);

    test('a silent TLS negotiation times out without credentials or an automatic retry', async () => {
      const bytes: Buffer[] = [];
      let connections = 0;
      const listener = Bun.listen({
        hostname: '127.0.0.1',
        port: 0,
        socket: {
          open() {
            connections++;
          },
          data(_socket, data) {
            bytes.push(Buffer.from(data));
          },
        },
      });
      try {
        await expect(
          connect({ ...remote, port: listener.port })`SELECT 1`.execute(),
        ).rejects.toThrow('TLS unavailable');
        expect(connections).toBe(1);
        expect(Buffer.concat(bytes).toString('hex')).toBe('0000000804d2162f');
      } finally {
        listener.stop(true);
      }
    }, 15_000);

    test('the actual gateway command returns private 503 without forwarding after database authentication refusal', async () => {
      let forwarded = 0;
      const upstream = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch() {
          forwarded++;
          return new Response('private');
        },
      });
      const reservation = Bun.listen({
        hostname: '127.0.0.1',
        port: 0,
        socket: { data() {} },
      });
      const port = reservation.port;
      reservation.stop(true);
      const path = join(cluster.directory, 'gateway.json');
      const pair = generateKeyPairSync('ed25519');
      writeProtected(path, {
        port,
        primary: { ...remote, password: randomUUID() },
        journal: 'https://example.invalid',
        token: randomBytes(32).toString('base64url'),
        epoch: randomUUID(),
        keys: {
          synthetic: pair.publicKey
            .export({ type: 'spki', format: 'pem' })
            .toString(),
        },
        upstream: `http://127.0.0.1:${upstream.port}`,
        publicOrigin: 'https://example.invalid',
      });
      const child = Bun.spawn(
        [
          process.execPath,
          '--no-env-file',
          new URL('./recovery-gateway.ts', import.meta.url).pathname,
          path,
        ],
        {
          env: { PATH: process.env.PATH, HOME: cluster.directory },
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      try {
        let response: Response | undefined;
        for (let attempt = 0; attempt < 50; attempt++) {
          response = await fetch(`http://127.0.0.1:${port}/api/private`, {
            signal: AbortSignal.timeout(1000),
          }).catch(() => undefined);
          if (response) break;
          await Bun.sleep(50);
        }
        expect(response?.status).toBe(503);
        expect(response?.headers.get('cache-control')).toBe(
          'private, no-store',
        );
        expect(await response?.json()).toEqual({
          message: 'Service unavailable',
        });
        expect(forwarded).toBe(0);
      } finally {
        child.kill('SIGTERM');
        await child.exited;
        await upstream.stop(true);
      }
    }, 15_000);

    test('remote plaintext, missing identity and configuration overrides refuse before connecting', () => {
      for (const config of [
        'postgres://gateway@127.0.0.1/postgres',
        { ...remote, tls: undefined },
        { ...remote, tls: { ca: remote.tls.ca } },
        { ...remote, tls: { ...remote.tls, rejectUnauthorized: false } },
        {
          ...remote,
          tls: { ...remote.tls, servername: 'trusted.example.invalid' },
        },
        { ...remote, ssl: false },
        { ...remote, host: '127.0.0.1?sslmode=disable' },
        { ...remote, host: 'first.invalid,second.invalid' },
        { ...remote, socket: cluster.directory },
        { ...local, password: 'unapproved' },
        { ...local, socket: 'relative' },
        { ...local, port: 0 },
      ])
        expect(() =>
          createGatewayDatabase(config as GatewayDatabaseConfiguration),
        ).toThrow();
    });
  },
);
