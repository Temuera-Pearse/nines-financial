CREATE TABLE IF NOT EXISTS operational_discrepancies (
  discrepancy_id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  related_ids JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary TEXT NOT NULL,
  details_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_detected_at TIMESTAMPTZ NOT NULL,
  last_detected_at TIMESTAMPTZ NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  assigned_to_operator_id TEXT,
  resolution_reason TEXT,
  resolved_at TIMESTAMPTZ,
  CONSTRAINT operational_discrepancies_category_not_blank CHECK (btrim(category) <> ''),
  CONSTRAINT operational_discrepancies_dedupe_not_blank CHECK (btrim(dedupe_key) <> ''),
  CONSTRAINT operational_discrepancies_entity_not_blank CHECK (btrim(entity_type) <> '' AND btrim(entity_id) <> ''),
  CONSTRAINT operational_discrepancies_severity_check CHECK (severity IN ('info', 'warning', 'incident')),
  CONSTRAINT operational_discrepancies_status_check CHECK (status IN ('open', 'acknowledged', 'in_progress', 'resolved', 'suppressed')),
  CONSTRAINT operational_discrepancies_detected_order CHECK (last_detected_at >= first_detected_at),
  CONSTRAINT operational_discrepancies_resolved_check CHECK (
    (status IN ('resolved', 'suppressed') AND resolved_at IS NOT NULL AND resolution_reason IS NOT NULL AND btrim(resolution_reason) <> '')
    OR (status NOT IN ('resolved', 'suppressed'))
  )
);

CREATE INDEX IF NOT EXISTS operational_discrepancies_status_idx
  ON operational_discrepancies (status, severity, updated_at DESC);

CREATE INDEX IF NOT EXISTS operational_discrepancies_entity_idx
  ON operational_discrepancies (entity_type, entity_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS operational_discrepancies_category_idx
  ON operational_discrepancies (category, updated_at DESC);

CREATE TABLE IF NOT EXISTS operational_discrepancy_history (
  discrepancy_history_id TEXT PRIMARY KEY,
  discrepancy_id TEXT NOT NULL REFERENCES operational_discrepancies (discrepancy_id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  operator_user_id TEXT NOT NULL,
  operator_role TEXT NOT NULL,
  reason TEXT,
  previous_status TEXT NOT NULL,
  new_status TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT operational_discrepancy_history_action_not_blank CHECK (btrim(action) <> ''),
  CONSTRAINT operational_discrepancy_history_operator_not_blank CHECK (btrim(operator_user_id) <> '' AND btrim(operator_role) <> ''),
  CONSTRAINT operational_discrepancy_history_status_check CHECK (
    previous_status IN ('open', 'acknowledged', 'in_progress', 'resolved', 'suppressed')
    AND new_status IN ('open', 'acknowledged', 'in_progress', 'resolved', 'suppressed')
  )
);

CREATE INDEX IF NOT EXISTS operational_discrepancy_history_discrepancy_idx
  ON operational_discrepancy_history (discrepancy_id, created_at DESC);
