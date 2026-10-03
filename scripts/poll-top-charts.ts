#!/usr/bin/env bun

import postgres from 'postgres';
import { i18n } from '../src/i18.conf';
import { refreshTopCharts } from '../src/server/ingest/charts';
import { refreshFeed } from '../src/server/ingest/feed-refresh';

const POLL_CONCURRENCY = 10;
export function parseChartJobArgs(args: string[]) {
  if (
    args.some((arg) => !['--episodes-only', '--charts-only'].includes(arg)) ||
    new Set(args).size !== args.length ||
    args.length > 1
  )
    throw new Error('Choose at most one of --charts-only or --episodes-only');
  return {
    charts: !args.includes('--episodes-only'),
    episodes: !args.includes('--charts-only'),
  };
}

async function pollMissingEpisodes(sql: postgres.Sql, locales: string[]) {
  const podcasts = await sql<{ id: string | number }[]>`
    SELECT p.id FROM podcasts p
    WHERE p.id IN (
      SELECT podcast_id FROM top_podcasts WHERE country_id = ANY(${locales}::text[])
    )
      AND NOT EXISTS (SELECT 1 FROM episodes e WHERE e.podcast_id = p.id)
    ORDER BY p.id
  `;

  if (podcasts.length === 0) {
    console.log('All top podcasts have episodes');
    return;
  }

  let updated = 0;
  let failed = 0;
  let skipped = 0;
  for (let i = 0; i < podcasts.length; i += POLL_CONCURRENCY) {
    const batch = podcasts.slice(i, i + POLL_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async ({ id }) => {
        try {
          return await refreshFeed(sql, Number(id), 'rebuild');
        } catch (error) {
          console.error(
            `[episodes:${id}] ${error instanceof Error ? error.message : String(error)}`,
          );
          return 'error';
        }
      }),
    );
    for (const result of results) {
      if (result === 'updated') updated++;
      else if (result === 'error') failed++;
      else skipped++;
    }
    console.log(
      `[episodes] ${Math.min(i + batch.length, podcasts.length)}/${podcasts.length}: ${updated} updated, ${failed} failed, ${skipped} skipped`,
    );
  }
}

export async function runChartJob(
  sql: postgres.Sql,
  args: string[],
  jobs = { refreshCharts: refreshTopCharts, pollEpisodes: pollMissingEpisodes },
) {
  const mode = parseChartJobArgs(args);
  const locales = [...i18n.locales];
  let failedLocales: string[] = [];
  if (mode.charts) {
    const result = await jobs.refreshCharts(sql, locales);
    failedLocales = result.failedLocales;
    console.log(
      `Charts: ${result.stored} stored, ${result.newPodcasts} new, ${failedLocales.length} countries failed`,
    );
  }
  if (mode.episodes) await jobs.pollEpisodes(sql, locales);
  return { failedLocales };
}

async function main() {
  const args = process.argv.slice(2);
  parseChartJobArgs(args);
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL required');

  const sql = postgres(connectionString, {
    max: 20,
    idle_timeout: 20,
    ...(process.env.PGHOST && { host: process.env.PGHOST }),
  });

  try {
    const { failedLocales } = await runChartJob(sql, args);
    if (failedLocales.length > 0) process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

if (import.meta.main)
  main().catch((error) => {
    console.error(
      'Chart job failed:',
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  });
