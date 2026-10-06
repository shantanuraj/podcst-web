import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const android = fileURLToPath(new URL('..', import.meta.url));

test('every declared Android module has a build definition', () => {
  const settings = readFileSync(join(android, 'settings.gradle.kts'), 'utf8');
  const modules = [...settings.matchAll(/"(:[\w:-]+)"/g)].map(
    ([, name]) => name,
  );
  expect(modules.length).toBeGreaterThan(0);
  expect(
    modules.filter(
      (name) =>
        !existsSync(
          join(android, ...name.slice(1).split(':'), 'build.gradle.kts'),
        ),
    ),
  ).toEqual([]);
});
