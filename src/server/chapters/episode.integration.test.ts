import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { createSchemaFixture } from '../../../scripts/lib/schema-fixture';
import { readChapterEpisode } from './episode';
import { createChapterService } from './service';

const databaseUrl = process.env.TEST_DATABASE_URL;
const schema = `chapters_${randomUUID().replaceAll('-', '')}`;

describe.skipIf(!databaseUrl)('chapter authorization with PostgreSQL', () => {
  let admin: postgres.Sql;
  let sql: postgres.Sql;
  beforeAll(async () => {
    if (!databaseUrl) throw new Error('TEST_DATABASE_URL required');
    admin = postgres(databaseUrl, { onnotice: () => {} });
    await admin`CREATE SCHEMA ${admin(schema)}`;
    sql = postgres(databaseUrl, {
      connection: { search_path: schema },
      onnotice: () => {},
    });
    await createSchemaFixture(sql);
    await sql`INSERT INTO users (id, email) VALUES ('owner', 'owner@example.invalid'), ('stranger', 'stranger@example.invalid')`;
    await sql`INSERT INTO authors (id, name) VALUES (1, 'Synthetic')`;
    await sql`INSERT INTO podcasts (id, feed_url, title, author_id, owner_user_id, cover) VALUES
      (1, 'https://example.invalid/public', 'Public', 1, NULL, ''),
      (2, 'https://example.invalid/private', 'Private', 1, 'owner', '')`;
    await sql`INSERT INTO episodes (id, podcast_id, guid, published) VALUES
      (101, 1, 'public', now()), (102, 2, 'private', now()), (103, 2, 'cold', now())`;
    await sql`INSERT INTO episode_content (episode_id, title, file_url, summary) VALUES
      (101, 'Public', 'https://example.invalid/public.mp3', '00:00 One<br>01:00 Two'),
      (102, 'Private', 'https://example.invalid/private.mp3?secret=token', '00:00 One<br>01:00 Two')`;
  });
  afterAll(async () => {
    await sql?.end();
    if (admin) {
      await admin`DROP SCHEMA ${admin(schema)} CASCADE`;
      await admin.end();
    }
  });
  test('authorizes public, private and cold episodes before cache access', async () => {
    let fetched = 0;
    const service = createChapterService(
      (id, user) => readChapterEpisode(sql, id, user),
      async () => {
        fetched++;
        return [
          { title: 'Start', start: 0 },
          { title: 'Finish', start: 60 },
        ];
      },
    );
    expect((await service(101, null))?.source).toBe('embedded');
    expect((await service(101, 'stranger'))?.source).toBe('embedded');
    expect(await service(102, null)).toBeNull();
    expect(await service(102, 'stranger')).toBeNull();
    expect(fetched).toBe(1);
    expect((await service(102, 'owner'))?.source).toBe('embedded');
    expect(await service(102, 'stranger')).toBeNull();
    expect(fetched).toBe(2);
    expect(await service(103, 'owner')).toEqual({
      source: 'none',
      chapters: [],
    });
    expect(await service(103, null)).toBeNull();
    expect(await service(999, 'owner')).toBeNull();
    await sql`UPDATE podcasts SET owner_user_id = 'stranger' WHERE id = 2`;
    expect(await service(102, 'owner')).toBeNull();
    expect((await service(102, 'stranger'))?.source).toBe('embedded');
    expect(fetched).toBe(3);
    await sql`UPDATE episode_content SET file_url = 'https://example.invalid/new.mp3' WHERE episode_id = 102`;
    await service(102, 'stranger');
    expect(fetched).toBe(4);
  });
});
