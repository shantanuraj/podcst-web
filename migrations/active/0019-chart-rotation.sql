ALTER TABLE countries
  ADD COLUMN chart_requested_at TIMESTAMPTZ,
  ADD COLUMN chart_attempted_at TIMESTAMPTZ;
