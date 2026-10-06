import { listHandlers } from '@/server/lists';

export async function POST(
  request: Request,
  context: { params: Promise<{ listId: string }> },
) {
  const { listId } = await context.params;
  return listHandlers.changes(request, listId);
}
