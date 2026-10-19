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

export async function main(args: string[]) {
  const mode = args[0] ?? 'plan';
  if (args.length > 1 || !['plan', 'up'].includes(mode)) {
    throw new Error('Usage: bun scripts/proxy-podcast-art.ts [plan|up]');
  }
  const sql = openDatabase('MIGRATION_DATABASE_URL');
  const totals = { scanned: 0, changed: 0, updated: 0, episodesCleared: 0 };
  try {
    let after = '0';
    for (;;) {
      const rows = await sql<Row[]>`
        SELECT id, cover, thumbnail
        FROM podcasts
        WHERE id > ${after} AND owner_user_id IS NULL
        ORDER BY id
        LIMIT ${batchSize}
      `;
      if (rows.length === 0) break;
      after = rows[rows.length - 1].id;
      totals.scanned += rows.length;
      const changes = rows.flatMap((row) => {
        const next = proxiedPodcastArt(row);
        return next.cover === row.cover && next.thumbnail === row.thumbnail
          ? []
          : [
              {
                ...row,
                next_cover: next.cover,
                next_thumbnail: next.thumbnail,
              },
            ];
      });
      totals.changed += changes.length;
      if (mode === 'up' && changes.length > 0) {
        await sql.begin(async (tx) => {
          const updated = await tx`
            UPDATE podcasts p
            SET cover = d.next_cover, thumbnail = d.next_thumbnail
            FROM jsonb_to_recordset(${tx.json(changes)}::jsonb)
              AS d(id bigint, cover text, thumbnail text,
                   next_cover text, next_thumbnail text)
            WHERE p.id = d.id
              AND p.owner_user_id IS NULL
              AND p.cover = d.cover
              AND p.thumbnail IS NOT DISTINCT FROM d.thumbnail
            RETURNING p.id, p.cover
          `;
          totals.updated += updated.count;
          if (updated.count === 0) return;
          const cleared = await tx`
            UPDATE episode_content ec
            SET episode_art = NULL
            FROM episodes e
            JOIN jsonb_to_recordset(${tx.json(updated.map(({ id, cover }) => ({ id, cover })))}::jsonb)
              AS d(id bigint, cover text) ON d.id = e.podcast_id
            WHERE ec.episode_id = e.id AND ec.episode_art = d.cover
          `;
          totals.episodesCleared += cleared.count;
        });
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
