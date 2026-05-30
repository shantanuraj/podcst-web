import { sql } from '../src/server/db';
import { recomputeEssential } from '../src/server/tiering';

const changed = await recomputeEssential();
console.log(`is_essential updated for ${changed} podcasts`);
await sql.end();
