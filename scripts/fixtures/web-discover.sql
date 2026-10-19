-- Synthetic identities exercise public cache isolation and private SSR together.
INSERT INTO users (id, email, name) VALUES
  ('ssr-owner-a', 'ssr-a@example.invalid', 'Synthetic Account A'),
  ('ssr-owner-b', 'ssr-b@example.invalid', 'Synthetic Account B');
INSERT INTO sessions (id, user_id, expires_at) VALUES
  ('synthetic-session-a', 'ssr-owner-a', now() + interval '1 day'),
  ('synthetic-session-b', 'ssr-owner-b', now() + interval '1 day');

INSERT INTO podcasts (id, author_id, owner_user_id, feed_url, title, description, cover, episode_count)
VALUES (12, 1, 'ssr-owner-a', 'https://example.invalid/private.xml',
  'Synthetic Private Podcast', 'Private description for isolation tests.', '', 1);
INSERT INTO episodes (id, podcast_id, guid, published)
VALUES (990003, 12, 'private-episode', now());
INSERT INTO episode_content (episode_id, title, summary, file_url)
VALUES (990003, 'Synthetic Private Episode', '<p>Private show notes.</p>',
  'https://example.invalid/private.mp3');
INSERT INTO feed_poll_state (podcast_id, last_polled_at, next_poll_at, last_success_at, last_rebuilt_at)
VALUES (12, now(), now() + interval '1 day', now(), now());

-- An accidental private chart row must never enter shared output.
INSERT INTO top_podcasts (country_id, genre_id, rank, podcast_id)
VALUES ('us', 0, 9, 12);
INSERT INTO countries (id, name) VALUES ('nl', 'Netherlands');
INSERT INTO top_podcasts (country_id, genre_id, rank, podcast_id)
VALUES ('nl', 0, 1, 8), ('nl', 0, 2, 7);
