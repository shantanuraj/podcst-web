import { sql } from '../src/server/db';
import { requireRuntimeAdmission } from '../src/server/erasure/admission';
import { evictWarm, recomputeEssential } from '../src/server/tiering';

const WARM_CAP_BYTES = 15 * 1024 * 1024 * 1024;

await requireRuntimeAdmission();
const changed = await recomputeEssential();
console.log(`is_essential updated for ${changed} podcasts`);

await requireRuntimeAdmission();
const evicted = await evictWarm(WARM_CAP_BYTES);
console.log(
  `warm eviction removed ${evicted} content rows (cap ${WARM_CAP_BYTES} bytes)`,
);

await sql.end();
