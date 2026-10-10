import { createJournalHandler } from '../../src/server/erasure/journal-http';
import { openJournalConfiguration } from './configuration';

async function main() {
  const [path, ...extra] = process.argv.slice(2);
  if (!path || extra.length) throw new Error();
  const opened = await openJournalConfiguration(path);
  const { config, journal, control } = opened;
  try {
    if (
      !Number.isInteger(config.port) ||
      config.port < 1024 ||
      config.port > 65535
    )
      throw new Error();
    await journal.head();
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: config.port,
      fetch: createJournalHandler(
        journal,
        new Map([
          ['recovery', config.tokens.recovery],
          ['admission', config.tokens.admission],
        ]),
        control,
      ),
    });
    const timer = setInterval(() => {
      void journal
        .purgeReceipts()
        .catch(() => console.error('Receipt expiry unavailable'));
    }, 60_000);
    const stop = async () => {
      clearInterval(timer);
      await server.stop(true);
      await opened.close();
    };
    process.once('SIGTERM', () => {
      void stop();
    });
    process.once('SIGINT', () => {
      void stop();
    });
    console.log(`Journal listening on loopback port ${server.port}`);
  } catch {
    await opened.close();
    throw new Error();
  }
}
if (import.meta.main)
  void main().catch(() => {
    console.error('Journal startup refused');
    process.exitCode = 1;
  });
