import { mkdtempSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

export async function extractPodcastIndexArchive(
  archivePath: string,
  dbPath: string,
): Promise<string> {
  // Publish only a complete extraction. An ingestion failure can then retain the
  // published snapshot without making the next run trust a partial tar output.
  const staging = mkdtempSync(join(dirname(dbPath), '.podcast-index-extract-'));
  try {
    const proc = Bun.spawn(['tar', '-xzf', archivePath, '-C', staging], {
      stdout: 'inherit',
      stderr: 'inherit',
    });
    if ((await proc.exited) !== 0) throw new Error('Failed to extract archive');
    renameSync(join(staging, 'podcastindex_feeds.db'), dbPath);
    return dbPath;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
