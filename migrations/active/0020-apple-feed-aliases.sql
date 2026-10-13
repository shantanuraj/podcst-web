ALTER TABLE podcast_feed_aliases
  DROP CONSTRAINT podcast_feed_aliases_evidence_type_check,
  ADD CONSTRAINT podcast_feed_aliases_evidence_type_check
    CHECK (evidence_type IN ('reviewed', 'permanent_redirect', 'apple_lookup'));
