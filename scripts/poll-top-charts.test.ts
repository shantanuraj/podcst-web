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
      return {
        stored: locales.length === failedLocales.length ? 0 : 100,
        newPodcasts: 0,
        skipped: 0,
        failedLocales,
      };
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
      exitCode: 0,
    });
    expect(work.calls).toEqual([
      { name: 'charts', locales: [...i18n.locales] },
    ]);
  });

  test('reports partial failure without failing the service or backfilling episodes', async () => {
    const work = jobs(['my']);
    expect(await runChartJob(sql, ['--charts-only'], work)).toEqual({
      failedLocales: ['my'],
      exitCode: 0,
    });
    expect(work.calls.map((c) => c.name)).toEqual(['charts']);
  });

  test('fails the service when every country fails', async () => {
    const work = jobs([...i18n.locales]);
    expect(await runChartJob(sql, ['--charts-only'], work)).toEqual({
      failedLocales: [...i18n.locales],
      exitCode: 1,
    });
    expect(work.calls.map((c) => c.name)).toEqual(['charts']);
  });

  test('fails the service when no chart entries were stored', async () => {
    const work = jobs();
    work.refreshCharts = async () => ({
      stored: 0,
      newPodcasts: 0,
      skipped: 0,
      failedLocales: [],
    });
    expect((await runChartJob(sql, ['--charts-only'], work)).exitCode).toBe(1);
  });

  test('does not suppress infrastructure errors', async () => {
    const work = jobs();
    work.refreshCharts = async () => {
      throw new Error('Database unavailable');
    };
    await expect(runChartJob(sql, ['--charts-only'], work)).rejects.toThrow(
      'Database unavailable',
    );
    expect(work.calls).toEqual([]);
  });

  test('accepts a chart with quarantined entries', async () => {
    const work = jobs();
    work.refreshCharts = async () => ({
      stored: 98,
      newPodcasts: 0,
      skipped: 2,
      failedLocales: [],
    });
    expect((await runChartJob(sql, ['--charts-only'], work)).exitCode).toBe(0);
  });

  test('retains explicit episode-only mode and default combined mode', async () => {
    const only = jobs();
    expect(await runChartJob(sql, ['--episodes-only'], only)).toEqual({
      failedLocales: [],
      exitCode: 0,
    });
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
