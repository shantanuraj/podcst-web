\set ON_ERROR_STOP on

BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';
SET LOCAL max_parallel_workers_per_gather = 0;

WITH user_refs AS (
  SELECT podcast_id, user_id, true AS subscription, false AS progress FROM subscriptions
  UNION ALL
  SELECT e.podcast_id, pp.user_id, false, true
  FROM playback_progress pp JOIN episodes e ON e.id = pp.episode_id
), linked AS (
  SELECT podcast_id, count(DISTINCT user_id) AS distinct_accounts,
    count(DISTINCT user_id) FILTER (WHERE subscription) AS subscribers,
    count(DISTINCT user_id) FILTER (WHERE progress) AS listeners
  FROM user_refs GROUP BY podcast_id
), inspected AS (
  SELECT p.id, l.*, p.itunes_id IS NOT NULL AS apple_id,
    p.podcast_index_id IS NOT NULL AS index_id,
    CASE
      WHEN lower(p.feed_url) ~ '^https?://([^/?#@]+\.)?supercast\.com([:/?#]|$)' THEN 'supercast'
      WHEN lower(p.feed_url) ~ '^https?://([^/?#@]+\.)?supportingcast\.(com|fm)([:/?#]|$)' THEN 'supportingcast'
      WHEN lower(p.feed_url) ~ '^https?://([^/?#@]+\.)?patreon\.com([:/?#]|$)' THEN 'patreon'
      WHEN lower(p.feed_url) ~ '^https?://([^/?#@]+\.)?substack\.com([:/?#]|$)' THEN 'substack'
      WHEN lower(p.feed_url) ~ '^https?://([^/?#@]+\.)?acast\.com([:/?#]|$)' THEN 'acast'
      WHEN lower(p.feed_url) ~ '^https?://([^/?#@]+\.)?transistor\.fm([:/?#]|$)' THEN 'transistor'
      WHEN lower(p.feed_url) ~ '^https?://([^/?#@]+\.)?megaphone\.fm([:/?#]|$)' THEN 'megaphone'
      ELSE 'unclassified_provider'
    END AS provider_family,
    p.feed_url LIKE '%?%' AS has_query
  FROM linked l JOIN podcasts p ON p.id = l.podcast_id
)
SELECT json_build_object(
  'scope', 'user-referenced, no directory ID',
  'label', 'unlisted-' || row_number() OVER (ORDER BY id),
  'accounts', distinct_accounts,
  'subscribers', subscribers,
  'listeners', listeners,
  'providerFamily', provider_family,
  'hasQuery', has_query
)
FROM inspected WHERE NOT apple_id AND NOT index_id ORDER BY id;

WITH user_refs AS (
  SELECT podcast_id, user_id FROM subscriptions
  UNION
  SELECT e.podcast_id, pp.user_id
  FROM playback_progress pp JOIN episodes e ON e.id = pp.episode_id
)
SELECT json_build_object(
  'scope', 'all user references',
  'podcasts', count(DISTINCT r.podcast_id),
  'accounts', count(DISTINCT r.user_id),
  'unlistedPodcasts', count(DISTINCT r.podcast_id) FILTER (WHERE p.itunes_id IS NULL AND p.podcast_index_id IS NULL),
  'unlistedAccounts', count(DISTINCT r.user_id) FILTER (WHERE p.itunes_id IS NULL AND p.podcast_index_id IS NULL)
)
FROM user_refs r JOIN podcasts p ON p.id = r.podcast_id;

COMMIT;
