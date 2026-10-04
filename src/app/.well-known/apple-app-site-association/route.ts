import { appleAppSiteAssociation } from '@/server/auth/native-apps';

export const dynamic = 'force-static';

export function GET() {
  return Response.json(appleAppSiteAssociation);
}
