import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

test('externalized PostCSS loads without require(esm) interop', () => {
  const node = process.env.NODE_BINARY || Bun.which('node');
  if (!node)
    throw new Error('Node.js is required for runtime dependency checks');

  const result = Bun.spawnSync(
    [
      node,
      '--no-experimental-require-module',
      '-e',
      `
        const assert = require('node:assert/strict');
        const postcss = require('postcss');
        assert.equal(postcss.parse('a { color: red }').first.first.value, 'red');
      `,
    ],
    { cwd: resolve(import.meta.dir, '..'), stdout: 'pipe', stderr: 'pipe' },
  );

  expect(result.exitCode, result.stderr.toString()).toBe(0);
});
