import { listHandlers } from '@/server/lists';

export async function GET(
  request: Request,
  context: { params: Promise<{ listId: string }> },
) {
  const { listId } = await context.params;
  return listHandlers.items(request, listId);
}
