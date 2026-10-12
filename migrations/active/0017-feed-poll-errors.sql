ALTER TABLE feed_poll_state
  ADD COLUMN last_error_kind TEXT,
  ADD COLUMN last_error_status SMALLINT,
  ADD COLUMN last_error_at TIMESTAMPTZ,
  ADD COLUMN failing_since TIMESTAMPTZ,
  ADD CONSTRAINT feed_poll_error_kind CHECK (
    last_error_kind IS NULL OR last_error_kind IN (
      'http_client', 'http_auth', 'http_gone', 'http_rate_limit',
      'http_server', 'network', 'timeout', 'redirect', 'too_large',
      'invalid_feed'
    )
  ),
  ADD CONSTRAINT feed_poll_error_status CHECK (
    last_error_status IS NULL OR last_error_status BETWEEN 100 AND 599
  );

DROP INDEX idx_feed_poll_state_due;
CREATE INDEX idx_feed_poll_state_due
  ON feed_poll_state(next_poll_at ASC NULLS FIRST);
