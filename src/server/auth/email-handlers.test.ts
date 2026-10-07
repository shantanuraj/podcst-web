import { describe, expect, test } from 'bun:test';
import { createCodeDelivery } from './email-delivery';
import { createEmailHandlers } from './email-handlers';
import { AuthError } from './error';
import { AUTH_BODY_LIMIT } from './http';

const email = 'synthetic@example.invalid';
const session = { id: 'synthetic-session', expiresAt: new Date() };
const request = (body: unknown) =>
  new Request('https://example.invalid/api/auth', {
    method: 'POST',
    body: JSON.stringify(body),
  });

function fixture() {
  const events: unknown[] = [];
  const service = {
    send: async (email: string) => {
      events.push(['send', email]);
    },
    verify: async () => false,
    login: async () => session,
  };
  const handlers = createEmailHandlers(
    () => service,
    async (_, kind, email) => {
      events.push(['limit', kind, email]);
    },
    async (session) => {
      events.push(['cookie', session]);
    },
  );
  return { ...handlers, service, events };
}

describe('email authentication handlers', () => {
  test('issuance and login are limited before any auth operation', async () => {
    const f = fixture();
    const sent = await f.verify(request({ email }));
    expect(await sent.json()).toEqual({ sent: true });
    expect(f.events).toEqual([
      ['limit', 'send', email],
      ['send', email],
    ]);
    const loggedIn = await f.login(request({ email, code: '012345' }));
    expect(await loggedIn.json()).toEqual({ verified: true });
    expect(f.events.slice(2)).toEqual([
      ['limit', 'verify', email],
      ['cookie', session],
    ]);
    for (const response of [sent, loggedIn])
      expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  test('invalid types and explicit empty codes never trigger email delivery', async () => {
    for (const body of [
      null,
      [],
      { email: {} },
      { email: email.repeat(30) },
      { email, code: '' },
      { email, code: 123456 },
      { email: `${email}\n`, code: '123456' },
    ]) {
      const f = fixture();
      expect((await f.verify(request(body))).status).toBe(400);
      expect((await f.login(request(body))).status).toBe(400);
      expect(f.events).toEqual([]);
    }
  });

  test('bounds streamed bytes even without Content-Length', async () => {
    let cancelled = false;
    const body = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(AUTH_BODY_LIMIT + 1));
      },
      cancel() {
        cancelled = true;
      },
    });
    const f = fixture();
    const response = await f.verify(
      new Request('https://example.invalid', {
        method: 'POST',
        body,
        duplex: 'half',
      } as RequestInit),
    );
    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(f.events).toEqual([]);
  });

  test('dependency failures are redacted and throttles expose Retry-After', async () => {
    for (const error of [
      new Error('private provider/account data'),
      new AuthError(429, 'Too many authentication requests', 60),
    ]) {
      const f = fixture();
      const handlers = createEmailHandlers(
        () => f.service,
        async () => {
          throw error;
        },
        async () => {
          throw new Error('must not set cookie');
        },
      );
      for (const response of [
        await handlers.verify(request({ email })),
        await handlers.login(request({ email, code: '123456' })),
      ]) {
        expect(response.status).toBe(error instanceof AuthError ? 429 : 503);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(response.headers.get('retry-after')).toBe(
          error instanceof AuthError ? '60' : null,
        );
        expect(await response.text()).not.toContain('private provider');
      }
      expect(f.events).toEqual([]);
    }
  });

  test('bad code does not set a cookie', async () => {
    const f = fixture();
    f.service.login = async () => null as never;
    const response = await f.login(request({ email, code: '123456' }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      message: 'Invalid or expired code',
    });
    expect(f.events).toEqual([['limit', 'verify', email]]);
  });
});

describe('email provider failures', () => {
  test('checks returned errors, missing acknowledgements, thrown errors and deadlines', async () => {
    for (const send of [
      async () => ({ data: null, error: { message: 'private' } }),
      async () => ({ data: null, error: null }),
      async () => {
        throw new Error('private');
      },
      () => new Promise<never>(() => {}),
    ]) {
      const deliver = createCodeDelivery(send, 'sender@example.invalid', 10);
      await expect(deliver(email, '123456')).rejects.toMatchObject({
        status: 503,
        message: 'Authentication unavailable',
      });
    }
  });
});
