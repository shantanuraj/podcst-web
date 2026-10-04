UPDATE episode_content AS ec
SET episode_art = NULLIF(
  (
    SELECT 'https://assets.podcst.app/?p=' || string_agg(
      CASE
        WHEN b BETWEEN 48 AND 57
          OR b BETWEEN 65 AND 90
          OR b BETWEEN 97 AND 122
          OR b IN (42, 45, 46, 95) THEN chr(b)
        WHEN b = 32 THEN '+'
        ELSE '%' || upper(lpad(to_hex(b), 2, '0'))
      END,
      '' ORDER BY i
    )
    FROM convert_to(ec.episode_art, 'UTF8') AS raw(bytes),
      generate_series(0, octet_length(raw.bytes) - 1) AS i,
      get_byte(raw.bytes, i) AS b
  ),
  p.cover
)
FROM episodes AS e
JOIN podcasts AS p ON p.id = e.podcast_id
WHERE ec.episode_id = e.id
  AND p.owner_user_id IS NULL
  AND ec.episode_art ~* '^https?://'
  AND ec.episode_art !~* '^https?://assets\.podcst\.app/';
