ALTER TABLE ledger_transactions DROP CONSTRAINT ledger_transactions_reference_type_check;
ALTER TABLE ledger_transactions ADD CONSTRAINT ledger_transactions_reference_type_check CHECK (
  reference_type IN ('account', 'deposit', 'funding_attestation', 'issuance_authorization',
    'withdrawal', 'bet', 'reservation', 'settlement', 'manual_adjustment', 'internal_transfer')
);

CREATE TABLE nines_issuance_authorization_consumptions (
  consumption_id UUID PRIMARY KEY,
  authorization_id UUID NOT NULL UNIQUE,
  authorization_payload_hash TEXT NOT NULL CHECK (authorization_payload_hash ~ '^[0-9a-f]{64}$'),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  event_type TEXT NOT NULL CHECK (event_type = 'nines_issuance_authorized'),
  issuer TEXT NOT NULL CHECK (issuer = 'nines-api'),
  audience TEXT NOT NULL CHECK (audience = 'nines-financial'),
  environment TEXT NOT NULL CHECK (environment IN ('development', 'test', 'production')),
  player_id UUID NOT NULL,
  funding_intent_id UUID NOT NULL UNIQUE,
  confirmation_event_id UUID NOT NULL UNIQUE,
  funding_evidence_identity TEXT NOT NULL UNIQUE,
  funding_request_hash TEXT NOT NULL CHECK (funding_request_hash ~ '^[0-9a-f]{64}$'),
  confirmation_payload_hash TEXT NOT NULL CHECK (confirmation_payload_hash ~ '^[0-9a-f]{64}$'),
  provider_name TEXT NOT NULL,
  provider_payment_reference TEXT NOT NULL,
  completed_valuation_id UUID NOT NULL UNIQUE,
  valuation_completion_key TEXT NOT NULL UNIQUE,
  valuation_evidence_fingerprint TEXT NOT NULL CHECK (valuation_evidence_fingerprint ~ '^[0-9a-f]{64}$'),
  valued_at TIMESTAMPTZ NOT NULL,
  final_nzd_amount TEXT NOT NULL CHECK (final_nzd_amount ~ '^(0|[1-9][0-9]*)\.[0-9]{2}$'),
  final_nzd_minor_units NUMERIC(96,0) NOT NULL CHECK (final_nzd_minor_units > 0),
  valuation_profile_version TEXT NOT NULL,
  calculation_policy_version TEXT NOT NULL,
  rounding_policy_version TEXT NOT NULL,
  issuance_policy_version TEXT NOT NULL CHECK (issuance_policy_version = 'nzd-valuation-to-nines-par-v1'),
  issued_currency TEXT NOT NULL CHECK (issued_currency = 'NINES'),
  issued_scale INTEGER NOT NULL CHECK (issued_scale = 6),
  issued_minor_units NUMERIC(20,0) NOT NULL CHECK (
    issued_minor_units > 0 AND issued_minor_units <= 99999999999999999999::NUMERIC
  ),
  authorized_at TIMESTAMPTZ NOT NULL,
  correlation_id TEXT NOT NULL CHECK (BTRIM(correlation_id) <> '' AND LENGTH(correlation_id) <= 256),
  causation_id TEXT NOT NULL CHECK (BTRIM(causation_id) <> '' AND LENGTH(causation_id) <= 256),
  authorization_payload JSONB NOT NULL CHECK (JSONB_TYPEOF(authorization_payload) = 'object'),
  ledger_transaction_id TEXT NOT NULL UNIQUE REFERENCES ledger_transactions (transaction_id) ON DELETE RESTRICT,
  processed_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT nines_issuance_provider_payment_unique UNIQUE (provider_name, provider_payment_reference),
  CONSTRAINT nines_issuance_exact_policy_check CHECK (
    issued_minor_units = final_nzd_minor_units * 10000
  ),
  CONSTRAINT nines_issuance_time_order_check CHECK (processed_at >= authorized_at)
);

ALTER TABLE security_evidence_outbox
  ALTER COLUMN funding_attestation_id DROP NOT NULL,
  ADD COLUMN issuance_authorization_id UUID NULL
    REFERENCES nines_issuance_authorization_consumptions (authorization_id) ON DELETE RESTRICT;

ALTER TABLE security_evidence_outbox DROP CONSTRAINT security_evidence_outbox_event_type_check;
ALTER TABLE security_evidence_outbox ADD CONSTRAINT security_evidence_outbox_event_type_check CHECK (
  event_type IN ('financial.nines_issuance_decided.v1', 'financial.nines_issuance_consumed.v1')
);
ALTER TABLE security_evidence_outbox ADD CONSTRAINT security_evidence_outbox_source_check CHECK (
  (funding_attestation_id IS NOT NULL)::INTEGER +
  (issuance_authorization_id IS NOT NULL)::INTEGER = 1
);

CREATE OR REPLACE FUNCTION protect_nines_issuance_consumption()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'NINES issuance authorization consumptions are immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER nines_issuance_authorization_consumption_immutable
  BEFORE UPDATE OR DELETE ON nines_issuance_authorization_consumptions
  FOR EACH ROW EXECUTE FUNCTION protect_nines_issuance_consumption();

CREATE OR REPLACE FUNCTION enforce_nines_issuance_authorization_evidence()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NOT (
    NEW.authorization_payload->>'schemaVersion' = NEW.schema_version::TEXT AND
    NEW.authorization_payload->>'eventType' = NEW.event_type AND
    NEW.authorization_payload->>'authorizationId' = NEW.authorization_id::TEXT AND
    NEW.authorization_payload->>'issuer' = NEW.issuer AND
    NEW.authorization_payload->>'audience' = NEW.audience AND
    NEW.authorization_payload->>'environment' = NEW.environment AND
    NEW.authorization_payload->>'playerId' = NEW.player_id::TEXT AND
    NEW.authorization_payload#>>'{funding,intentId}' = NEW.funding_intent_id::TEXT AND
    NEW.authorization_payload#>>'{funding,confirmationEventId}' = NEW.confirmation_event_id::TEXT AND
    NEW.authorization_payload#>>'{funding,evidenceIdentity}' = NEW.funding_evidence_identity AND
    NEW.authorization_payload#>>'{funding,requestHash}' = NEW.funding_request_hash AND
    NEW.authorization_payload#>>'{funding,confirmationPayloadHash}' = NEW.confirmation_payload_hash AND
    NEW.authorization_payload#>>'{funding,provider}' = NEW.provider_name AND
    NEW.authorization_payload#>>'{funding,paymentReference}' = NEW.provider_payment_reference AND
    NEW.authorization_payload#>>'{valuation,completedValuationId}' = NEW.completed_valuation_id::TEXT AND
    NEW.authorization_payload#>>'{valuation,completionKey}' = NEW.valuation_completion_key AND
    NEW.authorization_payload#>>'{valuation,evidenceFingerprint}' = NEW.valuation_evidence_fingerprint AND
    NEW.authorization_payload#>>'{valuation,valuedAt}' = TO_CHAR(NEW.valued_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AND
    NEW.authorization_payload#>>'{valuation,finalNzdAmount}' = NEW.final_nzd_amount AND
    NEW.authorization_payload#>>'{valuation,finalNzdMinorUnits}' = NEW.final_nzd_minor_units::TEXT AND
    NEW.authorization_payload#>>'{valuation,profileVersion}' = NEW.valuation_profile_version AND
    NEW.authorization_payload#>>'{valuation,calculationPolicyVersion}' = NEW.calculation_policy_version AND
    NEW.authorization_payload#>>'{valuation,roundingPolicyVersion}' = NEW.rounding_policy_version AND
    NEW.authorization_payload#>>'{issuance,policyVersion}' = NEW.issuance_policy_version AND
    NEW.authorization_payload#>>'{issuance,currency}' = NEW.issued_currency AND
    NEW.authorization_payload#>>'{issuance,scale}' = NEW.issued_scale::TEXT AND
    NEW.authorization_payload#>>'{issuance,minorUnits}' = NEW.issued_minor_units::TEXT AND
    NEW.authorization_payload->>'authorizedAt' = TO_CHAR(NEW.authorized_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AND
    NEW.authorization_payload->>'correlationId' = NEW.correlation_id AND
    NEW.authorization_payload->>'causationId' = NEW.causation_id
  ) THEN
    RAISE EXCEPTION 'NINES issuance consumption must match immutable authorization payload'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER nines_issuance_authorization_evidence_required
  AFTER INSERT ON nines_issuance_authorization_consumptions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_nines_issuance_authorization_evidence();

CREATE TABLE funding_economic_consumption_claims (
  funding_intent_id UUID PRIMARY KEY,
  provider_name TEXT NOT NULL,
  provider_payment_reference TEXT NOT NULL,
  consumption_path TEXT NOT NULL CHECK (consumption_path IN ('legacy_v1', 'valuation_authorization_v1')),
  source_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT funding_economic_consumption_source_unique UNIQUE
    (provider_name, provider_payment_reference)
);

INSERT INTO funding_economic_consumption_claims
  (funding_intent_id,provider_name,provider_payment_reference,consumption_path,source_id,created_at)
SELECT funding_intent_id,provider_name,provider_payment_reference,'legacy_v1',
  funding_attestation_id,processed_at
FROM funding_attestation_consumptions;

CREATE OR REPLACE FUNCTION claim_cross_version_funding_consumption()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'funding_attestation_consumptions' THEN
    INSERT INTO funding_economic_consumption_claims
      (funding_intent_id,provider_name,provider_payment_reference,consumption_path,source_id,created_at)
    VALUES (NEW.funding_intent_id,NEW.provider_name,NEW.provider_payment_reference,
      'legacy_v1',NEW.funding_attestation_id,NEW.processed_at);
  ELSE
    INSERT INTO funding_economic_consumption_claims
      (funding_intent_id,provider_name,provider_payment_reference,consumption_path,source_id,created_at)
    VALUES (NEW.funding_intent_id,NEW.provider_name,NEW.provider_payment_reference,
      'valuation_authorization_v1',NEW.authorization_id,NEW.processed_at);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER legacy_funding_cross_version_consumption
  BEFORE INSERT ON funding_attestation_consumptions
  FOR EACH ROW EXECUTE FUNCTION claim_cross_version_funding_consumption();

CREATE TRIGGER valuation_funding_cross_version_consumption
  BEFORE INSERT ON nines_issuance_authorization_consumptions
  FOR EACH ROW EXECUTE FUNCTION claim_cross_version_funding_consumption();

CREATE TRIGGER funding_economic_consumption_claims_immutable
  BEFORE UPDATE OR DELETE ON funding_economic_consumption_claims
  FOR EACH ROW EXECUTE FUNCTION protect_nines_issuance_consumption();

CREATE OR REPLACE FUNCTION validate_funding_attestation_consumption_ledger()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  target_id UUID;
  valid_coupling BOOLEAN;
  valuation_path BOOLEAN;
BEGIN
  IF TG_TABLE_NAME = 'funding_attestation_consumptions' THEN
    target_id := NEW.funding_attestation_id;
    valuation_path := FALSE;
  ELSIF TG_TABLE_NAME = 'nines_issuance_authorization_consumptions' THEN
    target_id := NEW.authorization_id;
    valuation_path := TRUE;
  ELSE
    IF NEW.transaction_type <> 'token_purchase_issuance' THEN
      RETURN NEW;
    END IF;
    target_id := NEW.reference_id::UUID;
    valuation_path := NEW.reference_type = 'issuance_authorization';
  END IF;

  IF valuation_path THEN
    SELECT EXISTS (
      SELECT 1 FROM nines_issuance_authorization_consumptions c
      JOIN ledger_transactions t ON t.transaction_id=c.ledger_transaction_id
      JOIN ledger_entries debit ON debit.transaction_id=t.transaction_id AND debit.direction='debit'
      JOIN accounts da ON da.account_id=debit.account_id
      JOIN ledger_entries credit ON credit.transaction_id=t.transaction_id AND credit.direction='credit'
      JOIN accounts ca ON ca.account_id=credit.account_id
      WHERE c.authorization_id=target_id AND t.transaction_type='token_purchase_issuance'
        AND t.reference_type='issuance_authorization' AND t.reference_id=c.authorization_id::TEXT
        AND t.status='posted' AND da.account_type='token_purchase_clearing'
        AND da.owner_type='platform' AND da.currency='NINES'
        AND ca.account_type='user_available' AND ca.owner_type='user'
        AND ca.owner_id=c.player_id::TEXT AND ca.currency='NINES'
        AND debit.amount_minor=c.issued_minor_units AND credit.amount_minor=c.issued_minor_units
        AND debit.currency='NINES' AND credit.currency='NINES'
        AND (SELECT COUNT(*) FROM ledger_entries e WHERE e.transaction_id=t.transaction_id)=2
    ) INTO valid_coupling;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM funding_attestation_consumptions c
      JOIN ledger_transactions t ON t.transaction_id=c.ledger_transaction_id
      JOIN ledger_entries debit ON debit.transaction_id=t.transaction_id AND debit.direction='debit'
      JOIN accounts da ON da.account_id=debit.account_id
      JOIN ledger_entries credit ON credit.transaction_id=t.transaction_id AND credit.direction='credit'
      JOIN accounts ca ON ca.account_id=credit.account_id
      WHERE c.funding_attestation_id=target_id AND c.outcome='accepted'
        AND t.transaction_type='token_purchase_issuance'
        AND t.reference_type='funding_attestation' AND t.reference_id=c.funding_attestation_id::TEXT
        AND t.status='posted' AND da.account_type='token_purchase_clearing'
        AND da.currency='NINES' AND ca.account_type='user_available'
        AND ca.owner_type='user' AND ca.owner_id=c.player_id::TEXT AND ca.currency='NINES'
        AND debit.amount_minor=c.issued_minor_units AND credit.amount_minor=c.issued_minor_units
        AND debit.currency='NINES' AND credit.currency='NINES'
        AND (SELECT COUNT(*) FROM ledger_entries e WHERE e.transaction_id=t.transaction_id)=2
    ) INTO valid_coupling;
  END IF;
  IF NOT valid_coupling THEN
    RAISE EXCEPTION 'token purchase authorization and ledger posting are not exactly coupled'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER nines_issuance_consumption_ledger_coupling
  AFTER INSERT ON nines_issuance_authorization_consumptions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION validate_funding_attestation_consumption_ledger();
