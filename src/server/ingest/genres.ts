import { join } from 'path';
import { readFileSync } from 'fs';
import { sql } from '../db';

/**
 * Simple CSV parser that handles quoted fields.
 * Does not handle escaped quotes (e.g. "") or multi-line fields.
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

async function ingestGenres() {
  const csvPath = join(process.cwd(), 'src/server/ingest/podcast-genres.csv');

  console.log(`Reading genres from ${csvPath}...`);

  let content: string;
  try {
    content = readFileSync(csvPath, 'utf-8');
  } catch (error) {
    console.error(`Error: Could not read file at ${csvPath}`);
    process.exit(1);
  }

  const lines = content.split(/\r?\n/).filter((line) => line.trim() !== '');

  // Skip header: category,genre,subgenre,name
  const dataLines = lines.slice(1);

  console.log(`Ingesting ${dataLines.length} genres...`);

  let successCount = 0;
  let failCount = 0;

  for (const line of dataLines) {
    const fields = parseCSVLine(line);
    if (fields.length < 4) continue;

    const [category, genre, subgenre, name] = fields;

    const idStr = subgenre || genre || category;
    const parentIdStr = subgenre ? genre : genre ? category : null;

    const id = parseInt(idStr);
    const parentId = parentIdStr ? parseInt(parentIdStr) : null;

    if (isNaN(id)) {
      console.warn(`Skipping invalid line: ${line}`);
      continue;
    }

    try {
      await sql`
        INSERT INTO genres (id, parent_id, name)
        VALUES (${id}, ${parentId}, ${name})
        ON CONFLICT (id) DO UPDATE
        SET parent_id = EXCLUDED.parent_id,
            name = EXCLUDED.name
      `;
      successCount++;
    } catch (error) {
      console.error(`Failed to insert genre ${id} (${name}):`, error);
      failCount++;
    }
  }

  console.log(`Ingestion complete. Success: ${successCount}, Failed: ${failCount}`);
  await sql.end();
}

ingestGenres().catch((err) => {
  console.error('Ingestion failed:', err);
  process.exit(1);
});
