import { erasureHandlers } from '@/server/erasure/runtime';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ passkeyId: string }> },
) {
  return erasureHandlers.revoke(request, (await params).passkeyId);
}
