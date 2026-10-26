import { sql } from '../../src/server/db';
import { eraseAccount } from '../../src/server/deletion/service';
import { deletionLog } from './store';

const directory = process.env.ACCOUNT_DELETION_JOURNAL_DIRECTORY;
const secret = process.env.ACCOUNT_DELETION_JOURNAL_SECRET;
if (!directory || !secret || !process.argv.includes('--closed-restore-target'))
  throw new Error(
    'A current deletion journal and --closed-restore-target are required',
  );

try {
  const records = await deletionLog(directory, secret).records();
  await sql.begin(async (tx) => {
    for (const record of records) await eraseAccount(tx, record.accountId);
    await tx`DELETE FROM sessions`;
    await tx`DELETE FROM passkeys`;
    await tx`DELETE FROM review_accounts`;
    await tx`DELETE FROM email_verifications`;
    await tx`DELETE FROM account_erasure_proofs`;
    await tx`DELETE FROM account_deletion_receipts`;
    await tx`UPDATE state_generation SET generation = gen_random_uuid()`;
  });
  console.log(
    `Applied ${records.length} deletion records and retired restored authentication.`,
  );
} finally {
  await sql.end();
}
