#!/usr/bin/env bun

import { artworkURL } from '../src/app/api/feed/parser';
import { openDatabase } from './lib/database';

const batchSize = 5000;
const placeholder = 'https://podcst.app/placeholder.png';

type Row = { id: string; cover: string; thumbnail: string | null };

export function proxiedPodcastArt({ cover, thumbnail }: Row) {
  return {
    cover:
      cover === placeholder
        ? cover
        : (artworkURL(cover, null, true) ?? placeholder),
    thumbnail: thumbnail && artworkURL(thumbnail, null, true),
  };
}

type Sql = ReturnType<typeof openDatabase>;
type Totals = Record<string, number>;

async function proxyPodcasts(sql: Sql, apply: boolean, totals: Totals) {
  let after = '0';
  for (;;) {
    const rows = await sql<Row[]>`
      SELECT id, cover, thumbnail
      FROM podcasts
      WHERE id > ${after} AND owner_user_id IS NULL
      ORDER BY id
      LIMIT ${batchSize}
    `;
    if (rows.length === 0) return;
    after = rows[rows.length - 1].id;
    totals.podcastsScanned += rows.length;
    const changes = rows.flatMap((row) => {
      const next = proxiedPodcastArt(row);
      return next.cover === row.cover && next.thumbnail === row.thumbnail
        ? []
        : [{ ...row, next_cover: next.cover, next_thumbnail: next.thumbnail }];
    });
    totals.podcastsChanged += changes.length;
    if (!apply || changes.length === 0) continue;
    const updated = await sql`
      UPDATE podcasts p
      SET cover = d.next_cover, thumbnail = d.next_thumbnail
      FROM jsonb_to_recordset(${sql.json(changes)}::jsonb)
        AS d(id bigint, cover text, thumbnail text,
             next_cover text, next_thumbnail text)
      WHERE p.id = d.id
        AND p.owner_user_id IS NULL
        AND p.cover = d.cover
        AND p.thumbnail IS NOT DISTINCT FROM d.thumbnail
    `;
    totals.podcastsUpdated += updated.count;
  }
}

async function clearCoverEpisodeArt(sql: Sql, apply: boolean, totals: Totals) {
  let after = '0';
  for (;;) {
    const rows = await sql<
      { episode_id: string; episode_art: string; cover: string | null }[]
    >`
      SELECT ec.episode_id, ec.episode_art,
        CASE WHEN p.owner_user_id IS NULL THEN p.cover END AS cover
      FROM (
        SELECT episode_id, episode_art
        FROM episode_content
        WHERE episode_id > ${after} AND episode_art IS NOT NULL
        ORDER BY episode_id
        LIMIT ${batchSize}
      ) ec
      JOIN episodes e ON e.id = ec.episode_id
      JOIN podcasts p ON p.id = e.podcast_id
      ORDER BY ec.episode_id
    `;
    if (rows.length === 0) return;
    after = rows[rows.length - 1].episode_id;
    totals.episodesScanned += rows.length;
    const cleared = rows
      .filter(({ episode_art, cover }) => episode_art === cover)
      .map(({ episode_id, episode_art }) => ({ episode_id, episode_art }));
    totals.episodesMatched += cleared.length;
    if (!apply || cleared.length === 0) continue;
    const updated = await sql`
      UPDATE episode_content ec
      SET episode_art = NULL
      FROM jsonb_to_recordset(${sql.json(cleared)}::jsonb)
        AS d(episode_id bigint, episode_art text)
      WHERE ec.episode_id = d.episode_id
        AND ec.episode_art = d.episode_art
    `;
    totals.episodesCleared += updated.count;
  }
}

export async function main(args: string[]) {
  const mode = args[0] ?? 'plan';
  if (args.length > 1 || !['plan', 'up'].includes(mode)) {
    throw new Error('Usage: bun scripts/proxy-podcast-art.ts [plan|up]');
  }
  const sql = openDatabase('MIGRATION_DATABASE_URL');
  const totals: Totals = {
    podcastsScanned: 0,
    podcastsChanged: 0,
    podcastsUpdated: 0,
    episodesScanned: 0,
    episodesMatched: 0,
    episodesCleared: 0,
  };
  try {
    await proxyPodcasts(sql, mode === 'up', totals);
    await clearCoverEpisodeArt(sql, mode === 'up', totals);
    console.log(JSON.stringify({ mode, ...totals }));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
