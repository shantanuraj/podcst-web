import { NextResponse } from 'next/server';
import { sql } from '@/server/db';

export async function GET() {
  try {
    const [stats] = await sql`
      SELECT
        (SELECT COUNT(*) FROM podcasts) as podcasts_total,
        (SELECT COUNT(*) FROM episodes) as episodes_total,
        (SELECT COALESCE(SUM(metric_value), 0) FROM poll_metrics
         WHERE metric_name = 'feeds_updated' AND recorded_at > now() - interval '24 hours') as feeds_updated_24h,
        (SELECT COALESCE(SUM(metric_value), 0) FROM poll_metrics
         WHERE metric_name = 'feeds_failed' AND recorded_at > now() - interval '24 hours') as feeds_failed_24h
    `;

    return NextResponse.json({
      podcasts: Number(stats.podcasts_total),
      episodes: Number(stats.episodes_total),
      polling: {
        updated_24h: Number(stats.feeds_updated_24h),
        failed_24h: Number(stats.feeds_failed_24h),
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: 'error',
        message: err instanceof Error ? err.message : 'Unknown error',
      },
      { status: 503 },
    );
  }
}
