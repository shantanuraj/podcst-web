BEGIN;

UPDATE episodes e
SET episode_art = NULL
FROM podcasts p
WHERE e.podcast_id = p.id
  AND e.episode_art IS NOT NULL
  AND e.episode_art = p.cover;

COMMIT;
