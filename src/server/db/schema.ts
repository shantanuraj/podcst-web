import { relations } from 'drizzle-orm';
import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  primaryKey,
  varchar,
} from 'drizzle-orm/pg-core';

export const genres = pgTable('genres', {
  id: integer('id').primaryKey(),
  parentId: integer('parent_id'),
  name: text('name').notNull(),

  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const genreRelations = relations(genres, ({ one }) => ({
  parentGenre: one(genres, {
    fields: [genres.parentId],
    references: [genres.id],
  }),
}));

export const authors = pgTable('authors', {
  id: uuid('id').defaultRandom().primaryKey(),
  itunesId: integer('itunes_id'),
  name: text('name').notNull(),

  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  deletedAt: timestamp('deleted_at'),
});

export const podcasts = pgTable('podcasts', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: text('title').notNull(),
  itunesId: integer('itunes_id').notNull(),
  link: text('link'),
  description: text('description').notNull(),
  feedUrl: text('feed_url').notNull().unique(),
  explicit: boolean('explicit').notNull(),
  cover: text('cover').notNull(),
  thumbnail: text('thumbnail'),
  public: boolean('public').notNull().default(true),
  authorId: uuid('author_id').references(() => authors.id),
  genres: integer('genres').array(),

  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  deletedAt: timestamp('deleted_at'),
});

export const episodes = pgTable('episodes', {
  id: uuid('id').defaultRandom().primaryKey(),
  podcastId: uuid('podcast_id').references(() => podcasts.id),
  authorId: uuid('author_id').references(() => authors.id),
  title: text('title').notNull(),
  summary: text('summary'),
  published: integer('published'),
  duration: integer('duration'),
  episodeArt: text('episode_art'),
  showNotes: text('show_notes').notNull(),

  // Enclosure/media file data
  fileUrl: text('file_url').notNull(),
  fileLength: integer('file_length'),
  fileType: text('file_type'),

  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  deletedAt: timestamp('deleted_at'),
});

export const topLists = pgTable(
  'top_lists',
  {
    country: varchar('country', { length: 4 }).notNull(),
    genreId: integer('genre_id'),
    podcasts: integer('podcasts').array(),

    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => {
    return {
      pk: primaryKey(table.country, table.genreId),
    };
  },
);
