\set ON_ERROR_STOP on

UPDATE podcasts p SET is_essential = true
WHERE p.id IN (
  SELECT podcast_id FROM subscriptions
  UNION SELECT podcast_id FROM top_podcasts
  UNION SELECT e.podcast_id FROM playback_progress pp JOIN episodes e ON e.id = pp.episode_id
        WHERE pp.updated_at > now() - interval '90 days'
);

INSERT INTO episode_content (episode_id, title, summary, duration, episode_art, file_url, file_length, file_type)
  SELECT e.id, e.title, e.summary, e.duration, e.episode_art, e.file_url, e.file_length, e.file_type
  FROM episodes e
  WHERE e.podcast_id IN (SELECT id FROM podcasts WHERE is_essential)
  ON CONFLICT (episode_id) DO NOTHING;
