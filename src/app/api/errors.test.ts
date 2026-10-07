import { describe, expect, mock, test } from 'bun:test';
import { NextRequest } from 'next/server';

mock.module('@/server/db', () => ({ sql: () => Promise.resolve([]) }));

const { POST: emailLogin } = await import('./auth/email-login/route');
const { POST: login } = await import('./auth/login/route');
const { POST: verify } = await import('./auth/verify/route');

const request = (body: string) =>
  new NextRequest('http://localhost/api', { method: 'POST', body });

describe('error responses', () => {
  for (const [name, handler, message] of [
    ['verify', verify, 'Email required'],
    ['email login', emailLogin, 'Email and code required'],
    ['passkey login', login, 'Visitor ID required'],
  ] as const) {
    for (const body of ['not json', 'null', '{}']) {
      test(`${name} answers ${body} with a 400 message`, async () => {
        const response = await handler(request(body));
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          message:
            body === 'not json' && name !== 'passkey login'
              ? 'Invalid authentication request'
              : message,
        });
      });
    }
  }
});
