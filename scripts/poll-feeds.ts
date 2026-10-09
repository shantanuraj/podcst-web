#!/usr/bin/env bun

import postgres from 'postgres';
import { refreshFeed } from '../src/server/ingest/feed-refresh';
import { getDuePodcasts } from '../src/server/ingest/feed-schedule';
import { FEED_LIMITS } from '../src/shared/feed-contract';

const BATCH_SIZE = 500;
const CONCURRENCY = FEED_LIMITS.refresh.concurrencyGlobal;
const IDLE_SLEEP_MS = FEED_LIMITS.client.recheckSeconds * 1000;

const DAEMON_MODE = process.argv.includes('--daemon');

async function recordMetrics(
  sql: postgres.Sql,
  metrics: Record<string, number>,
) {
  for (const [name, value] of Object.entries(metrics)) {
    if (value > 0) {
      await sql`
        INSERT INTO poll_metrics (metric_name, metric_value)
        VALUES (${name}, ${value})
      `;
    }
  }
}

async function processBatch(sql: postgres.Sql): Promise<number> {
  const startTime = Date.now();
  let updated = 0;
  let unchanged = 0;
  let failed = 0;
  let processed = 0;

  async function processPodcast(podcast: { id: string }): Promise<void> {
    const result = await refreshFeed(sql, podcast.id, 'scheduled');
    if (result === 'updated') updated++;
    else if (result === 'not_modified') unchanged++;
    else if (result === 'error') failed++;

    processed++;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const rate = (processed / ((Date.now() - startTime) / 1000)).toFixed(1);
    process.stdout.write(
      `\r[${processed}/${BATCH_SIZE}] [${elapsed}s ${rate}/s] ✓${updated} ○${unchanged} ✗${failed}`,
    );
  }

  while (processed < BATCH_SIZE) {
    const demand = await getDuePodcasts(sql, CONCURRENCY - 2, 'demand');
    const scheduled = await getDuePodcasts(
      sql,
      CONCURRENCY - demand.length,
      'scheduled',
    );
    const batch = [...demand, ...scheduled];
    if (batch.length === 0) break;
    const completed = updated + unchanged + failed;
    await Promise.all(batch.map(processPodcast));
    if (updated + unchanged + failed === completed) break;
  }
  if (processed === 0) return 0;

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  const finalRate = (processed / ((Date.now() - startTime) / 1000)).toFixed(1);

  await recordMetrics(sql, {
    feeds_updated: updated,
    feeds_unchanged: unchanged,
    feeds_failed: failed,
  });

  console.log(
    `\n✓ ${totalTime}s (${finalRate}/s): ${updated} updated, ${unchanged} unchanged, ${failed} failed`,
  );

  return updated + unchanged + failed;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL required');

  const sql = postgres(connectionString, {
    max: 20,
    idle_timeout: 20,
    ...(process.env.PGHOST && { host: process.env.PGHOST }),
  });

  if (DAEMON_MODE) {
    console.log(
      `Daemon mode: polling continuously (batch=${BATCH_SIZE}, concurrency=${CONCURRENCY})`,
    );
    while (true) {
      const count = await processBatch(sql);
      if (count === 0) {
        process.stdout.write(
          `[${new Date().toISOString()}] No podcasts due, sleeping ${IDLE_SLEEP_MS / 1000}s...`,
        );
        await Bun.sleep(IDLE_SLEEP_MS);
        console.log('');
      }
    }
  } else {
    const count = await processBatch(sql);
    if (count === 0) console.log('No podcasts due for polling');
    await sql.end();
  }
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
