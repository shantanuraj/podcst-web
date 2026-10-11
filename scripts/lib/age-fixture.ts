import { join } from 'node:path';

export function createAgeFixture(directory: string) {
  const executable = Bun.which('age-keygen');
  if (!executable) throw new Error('age-keygen required');
  const identity = join(directory, 'synthetic.agekey');
  const result = Bun.spawnSync([executable, '-o', identity], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const recipient = result.stderr.toString().match(/age1[a-z0-9]+/)?.[0];
  if (result.exitCode !== 0 || !recipient)
    throw new Error('Synthetic encryption identity unavailable');
  return { identity, recipient };
}
