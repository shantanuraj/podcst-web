import { expect, test } from 'bun:test';
import { createServer, type Socket } from 'node:net';
import { Redis } from 'ioredis';
import { fingerprint } from './cache';
import { chapterRedisOptions, createRedisChapterCache } from './redis';
import { createChapterService } from './service';

async function endpoint() {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.pause();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing port');
  return { server, sockets, url: `redis://127.0.0.1:${address.port}` };
}

for (const stalled of [false, true]) {
  test(`Redis ${stalled ? 'stalls' : 'connection refusals'} terminate and fall back without queued commands`, async () => {
    const fixture = await endpoint();
    if (!stalled)
      await new Promise<void>((resolve) =>
        fixture.server.close(() => resolve()),
      );
    const redis = new Redis(fixture.url, chapterRedisOptions);
    const cache = createRedisChapterCache(redis);
    try {
      const before = Date.now();
      await expect(
        cache.get(`chapters:{${fingerprint('synthetic')}}`),
      ).rejects.toThrow('Chapter cache unavailable');
      expect(Date.now() - before).toBeLessThan(2500);
      if (redis.status !== 'end')
        await new Promise<void>((resolve) => redis.once('end', resolve));
      expect(redis.status).toBe('end');
      let fetched = 0;
      const service = createChapterService(
        async (id) => ({
          id,
          owner_user_id: null,
          file_url: 'https://example.invalid/private?token=synthetic',
          file_type: 'audio/mpeg',
          file_length: 10,
          summary: '00:00 One<br>01:00 Two',
        }),
        {
          cache,
          schedule() {},
          fetchChapters: async () => {
            fetched++;
            throw new Error('Synthetic private enclosure URL');
          },
        },
      );
      expect((await service(42, null))?.source).toBe('shownotes');
      expect((await service(42, null))?.source).toBe('shownotes');
      expect(fetched).toBe(1);
      expect(redis.options.enableOfflineQueue).toBe(false);
      expect(redis.options.autoResendUnfulfilledCommands).toBe(false);
    } finally {
      redis.disconnect();
      for (const socket of fixture.sockets) socket.destroy();
      if (stalled)
        await new Promise<void>((resolve) =>
          fixture.server.close(() => resolve()),
        );
    }
  });
}
