import { getSession } from '@/server/auth/session';
import { sql } from '@/server/db';
import { privateImportAdmission } from '@/server/ingest/interactive-admission';
import { createFollowResolver } from '@/server/state/resolve';
import { createFollowResolutionHandler } from '@/server/state/resolve-response';

export const maxDuration = 60;
export const POST = createFollowResolutionHandler(
  createFollowResolver(sql),
  getSession,
  privateImportAdmission,
);
