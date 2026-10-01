import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';

export function startPostgres({ tcp = false }: { tcp?: boolean } = {}) {
  const bin = process.env.PG_BIN;
  if (!bin) throw new Error('PG_BIN required');
  const directory = mkdtempSync(join(tmpdir(), 'podcst-pg-'));
  chmodSync(directory, 0o700);
  const data = join(directory, 'data');
  const run = (program: string, args: string[]) =>
    Bun.spawnSync([join(bin, program), ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
  const init = run('initdb', [
    '-D',
    data,
    '-U',
    'postgres',
    '--auth=trust',
    '--no-instructions',
  ]);
  if (init.exitCode !== 0) {
    rmSync(directory, { recursive: true, force: true });
    throw new Error(init.stderr.toString());
  }
  let port = 5432;
  if (tcp) {
    const listener = Bun.listen({
      hostname: '127.0.0.1',
      port: 0,
      socket: { data() {} },
    });
    port = listener.port;
    listener.stop(true);
  }
  const start = run('pg_ctl', [
    '-D',
    data,
    '-l',
    join(directory, 'server.log'),
    '-o',
    `-k ${directory} -p ${port} -h '${tcp ? '127.0.0.1' : ''}'`,
    '-w',
    'start',
  ]);
  if (start.exitCode !== 0) {
    run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']);
    throw new Error(
      `Isolated PostgreSQL failed to start; inspect ${directory}`,
    );
  }
  const options = {
    host: directory,
    port,
    username: 'postgres',
    database: 'postgres',
    max: 1,
    onnotice: () => {},
  };
  const sql = postgres(options);
  return {
    directory,
    options,
    sql,
    url: tcp
      ? `postgres://postgres@127.0.0.1:${port}/postgres`
      : `postgres://postgres@localhost:${port}/postgres?host=${encodeURIComponent(directory)}`,
    async stop() {
      await sql.end({ timeout: 5 });
      const stopped = run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
      if (stopped.exitCode !== 0)
        throw new Error(
          `Isolated PostgreSQL did not stop; retained ${directory}`,
        );
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
