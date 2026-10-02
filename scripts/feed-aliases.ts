#!/usr/bin/env bun

import type postgres from 'postgres';
import {
  claimPublicAliases,
  type PublicAliasClaim,
  publicAliasUrl,
} from '../src/server/ingest/feed-aliases';
import { lockPodcastIdentities } from '../src/server/ingest/podcast-identity';
import { verifyPublicFeedMove } from '../src/server/ingest/public-feed-moves';
import { readProtected, writeProtected } from './lib/artifacts';
import { openDatabase } from './lib/database';

export function parseAliasPlan(input: unknown): PublicAliasClaim[] {
  if (
    !input ||
    typeof input !== 'object' ||
    !('claims' in input) ||
    !Array.isArray(input.claims) ||
    input.claims.length === 0 ||
    input.claims.length > 100
  )
    throw new TypeError('Expected a bounded alias plan');
  const claims = input.claims as PublicAliasClaim[];
  for (const claim of claims) {
    if (
      !Number.isSafeInteger(claim?.podcastId) ||
      claim.podcastId <= 0 ||
      typeof claim.expectedFeedUrl !== 'string' ||
      !Array.isArray(claim.aliases) ||
      claim.aliases.length > 32 ||
      claim.aliases.some((value) => typeof value !== 'string') ||
      !claim.evidence ||
      !['reviewed', 'permanent_redirect'].includes(claim.evidence.type) ||
      typeof claim.evidence.reference !== 'string' ||
      !claim.evidence.reference.trim() ||
      claim.evidence.reference.length > 512
    )
      throw new TypeError('Invalid alias claim');
    publicAliasUrl(claim.expectedFeedUrl);
    if (claim.canonicalFeedUrl !== undefined)
      publicAliasUrl(claim.canonicalFeedUrl);
    claim.aliases.forEach(publicAliasUrl);
  }
  return claims;
}

export async function runAliasPlan(
  sql: postgres.Sql,
  claims: PublicAliasClaim[],
  receiptPath: string,
  apply = false,
) {
  parseAliasPlan({ claims });
  const rolledBack = new Error('Alias review rollback');
  const ids = [...new Set(claims.map((claim) => claim.podcastId))].sort(
    (a, b) => a - b,
  );
  let changed = 0;
  try {
    await sql.begin(async (tx) => {
      await tx`SET LOCAL statement_timeout = '15s'`;
      await tx`SET LOCAL lock_timeout = '3s'`;
      await tx`SET LOCAL idle_in_transaction_session_timeout = '30s'`;
      await lockPodcastIdentities(
        tx,
        claims.flatMap((claim) =>
          [
            claim.expectedFeedUrl,
            claim.canonicalFeedUrl ?? claim.expectedFeedUrl,
            ...claim.aliases,
          ].map((feedUrl) => ({ feedUrl: publicAliasUrl(feedUrl) })),
        ),
      );
      const sources =
        await tx`SELECT p.id, p.owner_user_id, to_jsonb(p) AS data FROM podcasts p WHERE id = ANY(${ids}::bigint[]) ORDER BY id FOR UPDATE`;
      if (
        sources.length !== ids.length ||
        sources.some((source) => source.owner_user_id !== null)
      )
        throw new Error('All alias targets must be public existing sources');
      const aliases =
        await tx`SELECT to_jsonb(a) AS data FROM podcast_feed_aliases a WHERE podcast_id = ANY(${ids}::bigint[]) ORDER BY feed_url FOR UPDATE`;
      const polling =
        await tx`SELECT to_jsonb(p) AS data FROM feed_poll_state p WHERE podcast_id = ANY(${ids}::bigint[]) ORDER BY podcast_id FOR UPDATE`;
      writeProtected(
        receiptPath,
        {
          version: 1,
          requestedMode: apply ? 'apply' : 'review',
          capturedAt: new Date().toISOString(),
          claims,
          before: {
            sources: sources.map((row) => row.data),
            aliases: aliases.map((row) => row.data),
            polling: polling.map((row) => row.data),
          },
        },
        4 * 1024 * 1024,
      );
      for (const claim of claims) {
        const result = await claimPublicAliases(tx, claim);
        if (result.canonicalChanged) changed++;
      }
      if (!apply) throw rolledBack;
    });
  } catch (error) {
    if (error !== rolledBack) throw error;
  }
  const result = {
    status: apply ? 'committed' : 'rolled_back',
    sources: ids.length,
    canonicalChanges: changed,
  };
  writeProtected(`${receiptPath}.result.json`, result);
  return result;
}

export async function main(args: string[]) {
  const [mode, input, output] = args;
  if (args.length !== 3 || !['verify', 'review', 'apply'].includes(mode))
    throw new TypeError(
      'Usage: feed-aliases.ts verify <podcast-id> <protected-plan> | review|apply <protected-plan> <protected-receipt>',
    );
  const sql = openDatabase('ALIAS_DATABASE_URL');
  try {
    if (mode === 'verify') {
      if (!/^[1-9]\d*$/.test(input) || !Number.isSafeInteger(Number(input)))
        throw new TypeError('Invalid podcast ID');
      const [source] =
        await sql`SELECT feed_url FROM podcasts WHERE id=${Number(input)} AND owner_user_id IS NULL`;
      if (!source) throw new Error('Public source unavailable');
      const result = await verifyPublicFeedMove(source.feed_url);
      if (result.status === 'verified') {
        const evidence = result.evidence;
        writeProtected(output, {
          claims: [
            {
              podcastId: Number(input),
              expectedFeedUrl: source.feed_url,
              canonicalFeedUrl: evidence.canonicalFeedUrl,
              aliases: evidence.aliases,
              evidence: {
                type: 'permanent_redirect',
                reference: evidence.reference,
                details: evidence.details,
              },
            },
          ],
        });
      } else writeProtected(output, result);
      console.log(JSON.stringify({ status: result.status }));
    } else
      console.log(
        JSON.stringify(
          await runAliasPlan(
            sql,
            parseAliasPlan(readProtected(input, 1024 * 1024)),
            output,
            mode === 'apply',
          ),
        ),
      );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch(() => {
    console.error(
      'Alias operation failed; inspect protected evidence and database state before retrying',
    );
    process.exitCode = 1;
  });
}
