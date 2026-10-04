#!/usr/bin/env bun

import { artworkURL } from '../src/app/api/feed/parser';
import { openDatabase } from './lib/database';

const batchSize = 5000;

type Row = { episode_id: string; episode_art: string; cover: string };

export function proxiedEpisodeArt({ episode_art, cover }: Row) {
  const proxied = artworkURL(episode_art, null, true);
  if (!proxied) return episode_art;
  return proxied === cover ? null : proxied;
}

export async function main(args: string[]) {
  const mode = args[0] ?? 'plan';
  if (args.length > 1 || !['plan', 'up'].includes(mode)) {
    throw new Error('Usage: bun scripts/proxy-episode-art.ts [plan|up]');
  }
  const sql = openDatabase('MIGRATION_DATABASE_URL');
  const totals = { scanned: 0, proxied: 0, cleared: 0, updated: 0 };
  try {
    let after = '0';
    for (;;) {
      const rows = await sql<(Row & { public: boolean })[]>`
        SELECT ec.episode_id, ec.episode_art, p.cover,
          p.owner_user_id IS NULL AS public
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
      if (rows.length === 0) break;
      after = rows[rows.length - 1].episode_id;
      totals.scanned += rows.length;
      const changes = rows.flatMap((row) => {
        if (!row.public) return [];
        const next = proxiedEpisodeArt(row);
        return next === row.episode_art
          ? []
          : [{ episode_id: row.episode_id, art: row.episode_art, next }];
      });
      totals.proxied += changes.filter(({ next }) => next).length;
      totals.cleared += changes.filter(({ next }) => !next).length;
      if (mode === 'up' && changes.length > 0) {
        const updated = await sql`
          UPDATE episode_content ec
          SET episode_art = d.next
          FROM jsonb_to_recordset(${sql.json(changes)}::jsonb)
            AS d(episode_id bigint, art text, next text)
          WHERE ec.episode_id = d.episode_id
            AND ec.episode_art = d.art
        `;
        totals.updated += updated.count;
      }
    }
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
