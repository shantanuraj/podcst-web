ALTER TABLE feed_poll_state
  ADD COLUMN egress_blocked_at TIMESTAMPTZ,
  ADD COLUMN egress_block_evidence TEXT,
  ADD CONSTRAINT feed_egress_block CHECK (
    (egress_blocked_at IS NULL AND egress_block_evidence IS NULL)
    OR (
      egress_blocked_at IS NOT NULL
      AND egress_block_evidence IS NOT NULL
      AND length(egress_block_evidence) BETWEEN 1 AND 200
      AND egress_block_evidence = btrim(egress_block_evidence)
      AND egress_block_evidence !~ '[[:cntrl:]]'
      AND egress_block_evidence !~* '[a-z][a-z0-9+.-]*://'
    )
  );

CREATE INDEX feed_egress_blocked ON feed_poll_state (podcast_id)
  WHERE egress_blocked_at IS NOT NULL;
