#!/usr/bin/env bun

import postgres from 'postgres';
import {
  type FeedFailure,
  isTransientFeedError,
} from '../src/server/ingest/feed-errors';
import { shouldAbortPollBatch } from '../src/server/ingest/feed-poll';
import {
  recordPollFailure,
  refreshFeedForPoller,
} from '../src/server/ingest/feed-refresh';
import { getDuePodcasts } from '../src/server/ingest/feed-schedule';
import { FEED_LIMITS } from '../src/shared/feed-contract';

const BATCH_SIZE = 500;
const CONCURRENCY = FEED_LIMITS.refresh.concurrencyGlobal;
const IDLE_SLEEP_MS = FEED_LIMITS.client.recheckSeconds * 1000;

const DAEMON_MODE = process.argv.includes('--daemon');

type Attempt = { id: string; failure?: FeedFailure };
type BatchResult = { processed: number; aborted: boolean };

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

async function processBatch(sql: postgres.Sql): Promise<BatchResult> {
  const startTime = Date.now();
  let updated = 0;
  let unchanged = 0;
  let failed = 0;
  let processed = 0;
  const attempts: Attempt[] = [];
  const attemptedIds = new Set<string>();

  async function processPodcast(podcast: { id: string }): Promise<void> {
    if (attemptedIds.has(podcast.id)) return;
    attemptedIds.add(podcast.id);
    let failure: FeedFailure | undefined;
    const result = await refreshFeedForPoller(sql, podcast.id, {
      deferFailure: true,
      onFailure: (value) => {
        failure = value;
      },
    });
    if (result === 'updated') updated++;
    else if (result === 'not_modified') unchanged++;
    else if (result === 'error') failed++;

    attempts.push({ id: podcast.id, failure });
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
    const batch = [...demand, ...scheduled].filter(
      ({ id }) => !attemptedIds.has(id),
    );
    if (batch.length === 0) break;
    const before = processed;
    await Promise.all(batch.map(processPodcast));
    if (processed === before) break;
  }
  if (processed === 0) return { processed: 0, aborted: false };

  const transientFailures = attempts.filter(
    ({ failure }) => failure && isTransientFeedError(failure.kind),
  ).length;
  const aborted = shouldAbortPollBatch(processed, transientFailures);
  for (const { id, failure } of attempts) {
    if (!failure || (aborted && isTransientFeedError(failure.kind))) continue;
    await recordPollFailure(sql, id, failure);
  }
  if (aborted) await recordMetrics(sql, { poll_batch_aborted: 1 });

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  const finalRate = (processed / ((Date.now() - startTime) / 1000)).toFixed(1);

  await recordMetrics(sql, {
    feeds_updated: updated,
    feeds_unchanged: unchanged,
    feeds_failed: failed,
  });

  console.log(
    `\n✓ ${totalTime}s (${finalRate}/s): ${updated} updated, ${unchanged} unchanged, ${failed} failed${aborted ? ' · batch aborted' : ''}`,
  );

  return { processed, aborted };
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
      const result = await processBatch(sql);
      if (result.processed === 0 || result.aborted) {
        process.stdout.write(
          `[${new Date().toISOString()}] ${result.aborted ? 'Batch aborted, ' : 'No podcasts due, '}sleeping ${IDLE_SLEEP_MS / 1000}s...`,
        );
        await Bun.sleep(IDLE_SLEEP_MS);
        console.log('');
      }
    }
  } else {
    const result = await processBatch(sql);
    if (result.processed === 0) console.log('No podcasts due for polling');
    await sql.end();
  }
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
