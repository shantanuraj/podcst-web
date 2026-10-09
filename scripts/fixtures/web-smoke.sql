INSERT INTO countries (id, name) VALUES ('us', 'United States');
INSERT INTO genres (id, name) VALUES (0, 'All');

INSERT INTO authors (id, name)
SELECT id, 'Synthetic Author ' || id FROM generate_series(1, 8) AS id;

INSERT INTO podcasts (id, author_id, feed_url, title, description, cover, episode_count, last_published, primary_genre_id)
SELECT id, id, 'https://example.invalid/feed-' || id || '.xml',
  'Synthetic Podcast ' || id, 'A synthetic podcast for rendering tests.',
  'https://example.invalid/cover.png', 25, now(), 1487
FROM generate_series(1, 8) AS id;

INSERT INTO episodes (id, podcast_id, guid, published)
SELECT 282272718 + (podcast - 1) * 25 + episode, podcast,
  'synthetic-' || episode, now() - episode * interval '1 hour'
FROM generate_series(1, 8) AS podcast CROSS JOIN generate_series(1, 25) AS episode;

INSERT INTO episode_content (episode_id, title, summary, duration, file_url, file_type)
SELECT id, 'Synthetic Episode ' || guid, '<p>Synthetic show notes for rendering tests.</p>',
  600, 'https://example.invalid/episode.mp3', 'audio/mpeg'
FROM episodes;

INSERT INTO feed_poll_state (podcast_id, last_polled_at, next_poll_at, last_success_at, last_rebuilt_at)
SELECT id, now(), now() + interval '1 day', now(), now() FROM podcasts;

INSERT INTO top_podcasts (country_id, genre_id, rank, podcast_id)
SELECT 'us', 0, id, id FROM podcasts;

INSERT INTO podcasts (id, author_id, feed_url, title, description, cover, episode_count)
VALUES (9, 1, 'https://example.invalid/cold.xml', 'Synthetic Cold Podcast', 'Retained identity awaiting content.', '', 1),
       (10, 1, 'https://example.invalid/empty.xml', 'Synthetic Empty Podcast', 'A validated empty feed.', '', 0),
       (11, 1, 'https://example.invalid/removed.xml', 'Synthetic Rebuilt Podcast', 'Retained episode not returned by publisher.', '', 1);
INSERT INTO episodes (id, podcast_id, guid, published)
VALUES (990001, 9, 'cold-episode', now()), (990002, 11, 'removed-episode', now());
INSERT INTO feed_poll_state (podcast_id, last_success_at, last_rebuilt_at)
VALUES (9, NULL, NULL), (10, now(), now()), (11, now(), now());
