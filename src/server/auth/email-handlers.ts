import type { createEmailService } from './email-service';
import { AuthError } from './error';
import { authResponse, isCode, isEmail, readAuthBody } from './http';

type EmailService = ReturnType<typeof createEmailService>;

export function createEmailHandlers(
  service: () => EmailService,
  limit: (
    request: Request,
    kind: 'send' | 'verify',
    email: string,
  ) => Promise<void>,
  setSession: (session: { id: string; expiresAt: Date }) => Promise<void>,
) {
  return {
    verify: (request: Request) =>
      authResponse(async () => {
        const { email, code } = await readAuthBody(request);
        if (!isEmail(email)) throw new AuthError(400, 'Email required');
        if (code === undefined) {
          await limit(request, 'send', email);
          await service().send(email);
          return { sent: true };
        }
        if (!isCode(code)) throw new AuthError(400, 'Invalid or expired code');
        await limit(request, 'verify', email);
        if (!(await service().verify(email, code)))
          throw new AuthError(400, 'Invalid or expired code');
        return { verified: true };
      }),
    login: (request: Request) =>
      authResponse(async () => {
        const { email, code } = await readAuthBody(request);
        if (!isEmail(email) || !isCode(code))
          throw new AuthError(400, 'Email and code required');
        await limit(request, 'verify', email);
        const session = await service().login(email, code);
        if (!session) throw new AuthError(400, 'Invalid or expired code');
        await setSession(session);
        return { verified: true };
      }),
  };
}
