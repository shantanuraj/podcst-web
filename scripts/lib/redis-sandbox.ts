import { readFileSync } from 'node:fs';
import { Redis } from 'ioredis';
import type { createTLSFixture } from './tls-fixture';

export async function startRedis({
  tls,
}: {
  tls?: ReturnType<typeof createTLSFixture>;
} = {}) {
  const executable = Bun.which('redis-server');
  if (!executable) throw new Error('redis-server required');
  const listener = Bun.listen({
    hostname: '127.0.0.1',
    port: 0,
    socket: { data() {} },
  });
  const port = listener.port;
  listener.stop(true);
  const server = Bun.spawn(
    [
      executable,
      '--bind',
      '127.0.0.1',
      '--port',
      tls ? '0' : String(port),
      ...(tls
        ? [
            '--tls-port',
            String(port),
            '--tls-cert-file',
            tls.server.cert,
            '--tls-key-file',
            tls.server.key,
            '--tls-ca-cert-file',
            tls.ca,
            '--tls-auth-clients',
            'yes',
          ]
        : []),
      '--save',
      '',
      '--appendonly',
      'no',
    ],
    { stdout: 'ignore', stderr: 'ignore' },
  );
  const redis = new Redis({
    host: '127.0.0.1',
    port,
    connectTimeout: 1000,
    ...(tls && {
      tls: {
        ca: readFileSync(tls.ca),
        cert: readFileSync(tls.client.cert),
        key: readFileSync(tls.client.key),
        rejectUnauthorized: true,
      },
    }),
    retryStrategy: (attempt) => (attempt <= 50 ? 50 : null),
    maxRetriesPerRequest: 50,
  });
  redis.on('error', () => {});
  const close = async () => {
    redis.disconnect();
    server.kill();
    await server.exited;
  };
  try {
    await redis.ping();
  } catch (error) {
    await close();
    throw error;
  }
  return {
    port,
    url: `${tls ? 'rediss' : 'redis'}://127.0.0.1:${port}`,
    redis,
    close,
  };
}
