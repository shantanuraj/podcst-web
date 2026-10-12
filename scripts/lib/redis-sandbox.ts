import { Redis } from 'ioredis';

export async function startRedis() {
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
      String(port),
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
  return { port, url: `redis://127.0.0.1:${port}`, redis, close };
}
