-- Phase 4: Operator Review Workflow and Cryptographic Audit Ledger Schema
-- Tables for analyst review justifications and immutable hash-chained audit ledger.

-- 1. Ensure review_status constraint supports all valid operational review states
ALTER TABLE conjunction_events DROP CONSTRAINT IF EXISTS conjunction_events_review_status_check;
ALTER TABLE conjunction_events ADD CONSTRAINT conjunction_events_review_status_check
    CHECK (review_status IN ('UNREVIEWED', 'UNDER_REVIEW', 'ESCALATED', 'ACTION_TAKEN', 'REQUIRES_RE_REVIEW', 'DISMISSED'));

-- 2. Event Reviews: Preserved historical operational reviews and analyst decisions
CREATE TABLE IF NOT EXISTS event_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES conjunction_events(id) ON DELETE RESTRICT,
    observation_id UUID NULL REFERENCES raw_observations(id) ON DELETE RESTRICT,
    assessment_id UUID NULL REFERENCES event_assessments(id) ON DELETE RESTRICT,
    action VARCHAR(30) NOT NULL CHECK (action IN ('ACKNOWLEDGE', 'ESCALATE', 'DISMISS', 'REQUEST_REASSESSMENT')),
    justification TEXT NOT NULL,
    actor_id VARCHAR(100) NOT NULL,
    previous_review_status VARCHAR(30) NOT NULL,
    new_review_status VARCHAR(30) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reviews_event_id ON event_reviews(event_id);
CREATE INDEX IF NOT EXISTS idx_reviews_created_at ON event_reviews(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_actor ON event_reviews(actor_id);

-- 3. Audit Ledger: Append-only hash-chained ledger of system and user actions
CREATE TABLE IF NOT EXISTS audit_ledger (
    sequence_number BIGSERIAL PRIMARY KEY,
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    event_id UUID NULL REFERENCES conjunction_events(id) ON DELETE RESTRICT,
    action_type VARCHAR(50) NOT NULL,
    actor_type VARCHAR(20) NOT NULL CHECK (actor_type IN ('SYSTEM', 'OPERATOR')),
    actor_id VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    prev_hash VARCHAR(64) NOT NULL,
    entry_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_event_id ON audit_ledger(event_id);
CREATE INDEX IF NOT EXISTS idx_audit_action_type ON audit_ledger(action_type);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_ledger(created_at ASC);

-- 4. Database-level anti-tampering trigger preventing UPDATE or DELETE on audit_ledger
CREATE OR REPLACE FUNCTION prevent_audit_ledger_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Audit ledger is strictly append-only: UPDATE and DELETE operations are prohibited.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_ledger_no_mutation ON audit_ledger;
CREATE TRIGGER trg_audit_ledger_no_mutation
BEFORE UPDATE OR DELETE ON audit_ledger
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_ledger_mutation();
