import { describe, expect, test } from 'bun:test';
import type postgres from 'postgres';
import { i18n } from '../src/i18.conf';
import { parseChartJobArgs, runChartJob } from './poll-top-charts';

const sql = {} as postgres.Sql;

function jobs(failedLocales: string[] = []) {
  const calls: { name: string; locales: string[] }[] = [];
  return {
    calls,
    refreshCharts: async (_sql: postgres.Sql, locales: string[]) => {
      calls.push({ name: 'charts', locales });
      return { stored: 100, newPodcasts: 0, failedLocales };
    },
    pollEpisodes: async (_sql: postgres.Sql, locales: string[]) => {
      calls.push({ name: 'episodes', locales });
    },
  };
}

describe('bounded chart job modes', () => {
  test('scheduled chart-only mode never invokes episode backfills', async () => {
    const work = jobs();
    expect(await runChartJob(sql, ['--charts-only'], work)).toEqual({
      failedLocales: [],
    });
    expect(work.calls).toEqual([
      { name: 'charts', locales: [...i18n.locales] },
    ]);
  });

  test('surfaces country failures without triggering episode work', async () => {
    const work = jobs(['my']);
    expect(await runChartJob(sql, ['--charts-only'], work)).toEqual({
      failedLocales: ['my'],
    });
    expect(work.calls.map((c) => c.name)).toEqual(['charts']);
  });

  test('retains explicit episode-only mode and default combined mode', async () => {
    const only = jobs();
    await runChartJob(sql, ['--episodes-only'], only);
    expect(only.calls.map((c) => c.name)).toEqual(['episodes']);
    const combined = jobs();
    await runChartJob(sql, [], combined);
    expect(combined.calls.map((c) => c.name)).toEqual(['charts', 'episodes']);
  });

  for (const args of [
    ['--charts-only', '--episodes-only'],
    ['--charts-only', '--charts-only'],
    ['--unknown'],
  ]) {
    test(`rejects ambiguous or unknown modes: ${args.join(' ')}`, () => {
      expect(() => parseChartJobArgs(args)).toThrow('Choose at most one');
    });
  }
});
