import { accountDeletionHandlers } from '@/server/deletion/runtime';

export const POST = accountDeletionHandlers.prepare;
export const DELETE = accountDeletionHandlers.submit;
