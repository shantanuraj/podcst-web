#!/usr/bin/env bun

import postgres from 'postgres';
import { isCanonicalId } from '../src/shared/canonical-id';
import { DatabaseTargetError, openDatabase } from './lib/database';

export type EgressBlockChange =
  | { action: 'mark'; podcastId: string; evidence: string }
  | { action: 'unmark'; podcastId: string };

export class EgressBlockError extends Error {}

const usage =
  'Usage: mark-egress-blocked.ts mark <podcast-id> --evidence <text> [--apply] | unmark <podcast-id> [--apply]';

export function parseEgressBlockArgs(args: string[]) {
  const [action, podcastId, ...rest] = args;
  const apply = rest.at(-1) === '--apply';
  const options = apply ? rest.slice(0, -1) : rest;
  if (!isCanonicalId(podcastId)) throw new EgressBlockError(usage);
  if (action === 'mark' && options.length === 2 && options[0] === '--evidence')
    return {
      change: { action, podcastId, evidence: options[1] } as EgressBlockChange,
      apply,
    };
  if (action === 'unmark' && options.length === 0)
    return { change: { action, podcastId } as EgressBlockChange, apply };
  throw new EgressBlockError(usage);
}

export async function changeEgressBlock(
  sql: postgres.Sql,
  change: EgressBlockChange,
  apply = false,
) {
  const rolledBack = new Error('Egress block dry run');
  let result: postgres.Row | undefined;
  try {
    await sql.begin(async (tx) => {
      await tx`SET LOCAL statement_timeout = '5s'`;
      await tx`SET LOCAL lock_timeout = '3s'`;
      await tx`SET LOCAL idle_in_transaction_session_timeout = '30s'`;
      const [podcast] = await tx`
        SELECT id::text, title, owner_user_id IS NOT NULL AS private
        FROM podcasts WHERE id = ${change.podcastId} FOR UPDATE
      `;
      if (!podcast) throw new EgressBlockError('Podcast not found');
      if (podcast.private)
        throw new EgressBlockError('Private podcasts cannot be marked');
      const state = tx`
        egress_blocked_at, egress_block_evidence, failures,
        last_error_kind, last_error_status
      `;
      const [before] = await tx`
        SELECT ${state} FROM feed_poll_state
        WHERE podcast_id = ${change.podcastId} FOR UPDATE
      `;
      if (change.action === 'unmark' && !before?.egress_blocked_at)
        throw new EgressBlockError('Podcast is not marked egress blocked');
      const changed =
        change.action === 'mark'
          ? await tx`
            INSERT INTO feed_poll_state (podcast_id, egress_blocked_at, egress_block_evidence)
            VALUES (${change.podcastId}, now(), ${change.evidence})
            ON CONFLICT (podcast_id) DO UPDATE SET
              egress_blocked_at = EXCLUDED.egress_blocked_at,
              egress_block_evidence = EXCLUDED.egress_block_evidence
            RETURNING ${state}
          `
          : await tx`
            UPDATE feed_poll_state SET egress_blocked_at = NULL, egress_block_evidence = NULL
            WHERE podcast_id = ${change.podcastId}
            RETURNING ${state}
          `;
      if (changed.length !== 1)
        throw new EgressBlockError('Expected to change exactly one row');
      result = {
        status: apply ? 'committed' : 'rolled_back',
        action: change.action,
        podcast: { id: podcast.id, title: podcast.title },
        before: before ?? null,
        after: changed[0],
      };
      if (!apply) throw rolledBack;
    });
  } catch (error) {
    if (error === rolledBack) return result;
    if (
      error instanceof postgres.PostgresError &&
      error.constraint_name === 'feed_egress_block'
    )
      throw new EgressBlockError(
        'Evidence must be 1-200 characters on one line, trimmed, without URLs',
      );
    throw error;
  }
  return result;
}

export async function main(args: string[]) {
  const { change, apply } = parseEgressBlockArgs(args);
  const sql = openDatabase('EGRESS_DATABASE_URL');
  try {
    console.log(JSON.stringify(await changeEgressBlock(sql, change, apply)));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(
      error instanceof EgressBlockError || error instanceof DatabaseTargetError
        ? error.message
        : 'Egress block change failed; inspect feed_poll_state before retrying',
    );
    process.exitCode = 1;
  });
}
