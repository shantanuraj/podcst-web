#!/usr/bin/env bun

import postgres from 'postgres';
import { i18n } from '../src/i18.conf';
import { refreshTopCharts } from '../src/server/ingest/charts';
import { refreshFeed } from '../src/server/ingest/feed-refresh';

const POLL_CONCURRENCY = 10;
const EPISODES_ONLY = process.argv.includes('--episodes-only');

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

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL required');

  const sql = postgres(connectionString, {
    max: 20,
    idle_timeout: 20,
    ...(process.env.PGHOST && { host: process.env.PGHOST }),
  });
  const locales = [...i18n.locales];

  try {
    if (!EPISODES_ONLY) {
      const { stored, newPodcasts, failedLocales } = await refreshTopCharts(
        sql,
        locales,
      );
      console.log(
        `Charts: ${stored} stored, ${newPodcasts} new, ${failedLocales.length} countries failed`,
      );
      if (failedLocales.length > 0) process.exitCode = 1;
    }
    await pollMissingEpisodes(sql, locales);
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(
    'Chart job failed:',
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
