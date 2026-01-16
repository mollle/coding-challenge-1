CREATE TABLE IF NOT EXISTS executions (
  id BIGSERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  commands INTEGER NOT NULL,
  result BIGINT NOT NULL,
  duration DOUBLE PRECISION NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_executions_timestamp_desc
  ON executions (timestamp DESC);