import { expect, mock, test } from 'bun:test';
import { createListLimiter } from './limits';

test('limits mutation requests and new streams with independent private keys', async () => {
  const evalScript = mock(async () => 1);
  const limit = createListLimiter({ eval: evalScript });
  await limit('private-account', 'changes');
  await limit('private-account', 'clients');
  expect(evalScript).toHaveBeenCalledTimes(2);
  const calls = evalScript.mock.calls as unknown as [
    string,
    number,
    string,
    number,
  ][];
  expect(calls[0][2]).toStartWith('lists:limit:changes:');
  expect(calls[1][2]).toStartWith('lists:limit:clients:');
  expect(calls[0][2]).not.toContain('private-account');
  expect(calls[0][3]).toBe(60);
  expect(calls[1][3]).toBe(3600);
});

test('refuses excess writes and streams without depending on wall-clock timestamps', async () => {
  const limit = createListLimiter({ eval: async () => 121 });
  await expect(limit('owner', 'changes')).rejects.toMatchObject({
    status: 429,
  });
  await expect(limit('owner', 'clients')).rejects.toMatchObject({
    status: 429,
  });
});

test('fails closed when the limiter cannot confirm a reservation', async () => {
  const limit = createListLimiter({ eval: async () => null });
  await expect(limit('owner', 'changes')).rejects.toThrow('unavailable');
});
