import { NextResponse } from 'next/server';
import { sql } from '@/server/db';

export async function GET() {
  try {
    const [stats] = await sql`
      SELECT
        (SELECT COALESCE(SUM(metric_value), 0) FROM poll_metrics
         WHERE metric_name = 'feeds_updated' AND recorded_at > now() - interval '24 hours') as feeds_updated_24h,
        (SELECT COALESCE(SUM(metric_value), 0) FROM poll_metrics
         WHERE metric_name = 'feeds_failed' AND recorded_at > now() - interval '24 hours') as feeds_failed_24h
    `;

    return NextResponse.json({
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
