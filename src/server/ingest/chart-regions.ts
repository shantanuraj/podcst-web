import type postgres from 'postgres';
import { i18n } from '@/i18.conf';

export const MAIN_CHART_REGIONS: readonly string[] = i18n.locales;
export const CHART_ROTATION_BATCH = 10;
export const CHART_STALE_HOURS = 24;
const REQUEST_INTERVAL_HOURS = 1;

export const isChartRegion = (locale: string) => /^[a-z]{2}$/.test(locale);

export const isMainChartRegion = (locale: string) =>
  MAIN_CHART_REGIONS.includes(locale);

export async function requestChartRefresh(
  sql: postgres.Sql,
  locale: string,
): Promise<boolean> {
  if (!isChartRegion(locale) || isMainChartRegion(locale)) return false;
  const rows = await sql`
    UPDATE countries c SET chart_requested_at = now()
    WHERE c.id = ${locale}
      AND (c.chart_requested_at IS NULL
        OR c.chart_requested_at < now() - interval '1 hour' * ${REQUEST_INTERVAL_HOURS})
      AND coalesce(
        (SELECT max(t.fetched_at) FROM top_podcasts t WHERE t.country_id = c.id AND t.genre_id = 0),
        '-infinity'
      ) < now() - interval '1 hour' * ${CHART_STALE_HOURS}
    RETURNING 1
  `;
  return rows.length > 0;
}

export async function claimRotationRegions(
  sql: postgres.Sql,
  limit = CHART_ROTATION_BATCH,
): Promise<string[]> {
  const rows = await sql<{ id: string }[]>`
    UPDATE countries c SET chart_attempted_at = now()
    WHERE c.id IN (
      SELECT id FROM countries
      WHERE id <> ALL(${[...MAIN_CHART_REGIONS]}::text[])
      ORDER BY
        (chart_requested_at IS NOT NULL
          AND (chart_attempted_at IS NULL OR chart_requested_at > chart_attempted_at)) DESC,
        chart_attempted_at ASC NULLS FIRST,
        id
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING c.id
  `;
  return rows.map(({ id }) => id).sort();
}
