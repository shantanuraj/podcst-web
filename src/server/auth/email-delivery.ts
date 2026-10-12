import { CODE_EXPIRY_MINUTES } from './email-service';
import { AuthError } from './error';

interface EmailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
}

export function createCodeDelivery(
  send: (
    message: EmailMessage,
  ) => Promise<{ error: unknown; data: { id: string } | null }>,
  from: string,
  timeoutMs = 10_000,
) {
  return async (email: string, code: string) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        send({
          from,
          to: email,
          subject: 'Your Podcst verification code',
          text: `Your verification code is: ${code}\n\nThis code expires in ${CODE_EXPIRY_MINUTES} minutes.`,
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error()), timeoutMs);
        }),
      ]);
      if (result.error || !result.data?.id) throw new Error();
    } catch {
      throw new AuthError(503, 'Authentication unavailable');
    } finally {
      clearTimeout(timer);
    }
  };
}
