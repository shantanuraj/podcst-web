import { deletionLog, journalHandler } from './store';

const directory = process.env.ACCOUNT_DELETION_JOURNAL_DIRECTORY;
const secret = process.env.ACCOUNT_DELETION_JOURNAL_SECRET;
if (!directory || !secret)
  throw new Error('Deletion journal configuration required');

Bun.serve({
  hostname: '127.0.0.1',
  port: Number(process.env.PORT || 8091),
  maxRequestBodySize: 2048,
  fetch: journalHandler(deletionLog(directory, secret), secret),
});
