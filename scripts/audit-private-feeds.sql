\set ON_ERROR_STOP on
\if :{?min_id}
\else
\set min_id 0
\endif
\if :{?max_id}
\else
\set max_id 100000
\endif

BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '1s';
SET LOCAL max_parallel_workers_per_gather = 0;
SET LOCAL idle_in_transaction_session_timeout = '20s';

SELECT 1 / ((:'min_id'::bigint >= 0
  AND :'max_id'::bigint - :'min_id'::bigint BETWEEN 1 AND 100000)::integer)
  AS audit_range_valid
\gset

WITH subscriptions_by_podcast AS (
  SELECT podcast_id, count(*) AS subscribers
  FROM subscriptions
  GROUP BY podcast_id
), progress_by_podcast AS (
  SELECT e.podcast_id, count(DISTINCT pp.user_id) AS listeners
  FROM playback_progress pp
  JOIN episodes e ON e.id = pp.episode_id
  GROUP BY e.podcast_id
), source_rows AS (
  SELECT
    p.id,
    lower(p.feed_url) AS url,
    CASE
      WHEN p.itunes_id IS NOT NULL AND p.podcast_index_id IS NOT NULL THEN 'both'
      WHEN p.itunes_id IS NOT NULL THEN 'apple_only'
      WHEN p.podcast_index_id IS NOT NULL THEN 'index_only'
      ELSE 'neither'
    END AS directory_ids,
    coalesce(s.subscribers, 0) AS subscribers,
    coalesce(r.listeners, 0) AS listeners
  FROM podcasts p
  LEFT JOIN subscriptions_by_podcast s ON s.podcast_id = p.id
  LEFT JOIN progress_by_podcast r ON r.podcast_id = p.id
  WHERE p.id > :'min_id'::bigint AND p.id <= :'max_id'::bigint
), signals AS (
  SELECT
    directory_ids,
    CASE WHEN subscribers = 0 THEN 'zero' WHEN subscribers = 1 THEN 'one' ELSE 'multiple' END AS subscriber_bucket,
    subscribers,
    listeners,
    url ~ '^https?://[^/?#]*@' AS userinfo,
    url ~ '[?&;](auth|authorization|auth_token|access_token|token|api_key|apikey|key|secret|signature|sig|password|pass|private_token|jwt|credential|subscriber_token)=' AS credential_parameter,
    url ~ '^https?://([^/?#@]+\.)?(patreon\.com|supercast\.com|supportingcast\.fm|supportingcast\.com|memberfulcontent\.com|glow\.fm|steadyhq\.com)([:/?#]|$)' AS membership_provider,
    split_part(split_part(url, '?', 1), '#', 1) ~ '/([0-9a-f]{24,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})([/.]|$)' AS opaque_path,
    split_part(split_part(url, '?', 1), '#', 1) ~ '/(private|premium|members|subscriber|exclusive)([/_.-]|$)' AS private_path_label,
    position('?' IN url) > 0 AS has_query
  FROM source_rows
)
SELECT json_build_object(
  'minExclusive', :'min_id'::bigint,
  'maxInclusive', :'max_id'::bigint,
  'directoryIds', directory_ids,
  'subscriberBucket', subscriber_bucket,
  'userinfo', userinfo,
  'credentialParameter', credential_parameter,
  'membershipProvider', membership_provider,
  'opaquePath', opaque_path,
  'privatePathLabel', private_path_label,
  'hasQuery', has_query,
  'feeds', count(*),
  'subscriptionEdges', sum(subscribers),
  'listenerFeedEdges', sum(listeners),
  'feedsWithProgress', count(*) FILTER (WHERE listeners > 0)
)
FROM signals
GROUP BY directory_ids, subscriber_bucket, userinfo, credential_parameter,
  membership_provider, opaque_path, private_path_label, has_query
ORDER BY directory_ids, subscriber_bucket, userinfo, credential_parameter,
  membership_provider, opaque_path, private_path_label, has_query;

COMMIT;
