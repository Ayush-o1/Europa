-- Phase 2: Event Correlation and Lifecycle Schema
-- Tables for canonical conjunction events, event observation associations, and auditable correlation decisions.

-- 1. Conjunction Events: Discrete correlated encounters between two space objects
CREATE TABLE IF NOT EXISTS conjunction_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    primary_object_id INT NOT NULL REFERENCES space_objects(norad_cat_id) ON DELETE RESTRICT,
    secondary_object_id INT NOT NULL REFERENCES space_objects(norad_cat_id) ON DELETE RESTRICT,
    canonical_pair_key VARCHAR(50) NOT NULL,
    initial_tca TIMESTAMPTZ NOT NULL,
    initial_captured_at TIMESTAMPTZ NOT NULL,
    latest_tca TIMESTAMPTZ NOT NULL,
    latest_captured_at TIMESTAMPTZ NOT NULL,
    latest_range_km NUMERIC(10, 4) NOT NULL CHECK (latest_range_km >= 0),
    min_predicted_range_km NUMERIC(10, 4) NOT NULL CHECK (min_predicted_range_km >= 0),
    observation_count INT NOT NULL DEFAULT 1 CHECK (observation_count > 0),
    
    -- Orthogonal state dimensions
    lifecycle_state VARCHAR(20) NOT NULL DEFAULT 'MONITORING'
        CHECK (lifecycle_state IN ('MONITORING', 'PAST_TCA', 'ARCHIVED')),
    urgency_level VARCHAR(20) NOT NULL DEFAULT 'LOW'
        CHECK (urgency_level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    review_status VARCHAR(30) NOT NULL DEFAULT 'UNREVIEWED'
        CHECK (review_status IN ('UNREVIEWED', 'UNDER_REVIEW', 'ACTION_TAKEN', 'REQUIRES_RE_REVIEW', 'DISMISSED')),
    tracking_state VARCHAR(30) NOT NULL DEFAULT 'CONFIRMED'
        CHECK (tracking_state IN ('CONFIRMED', 'OMITTED_FROM_REPORT', 'AMBIGUOUS_MATCH')),
        
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_lookup ON conjunction_events(canonical_pair_key, lifecycle_state, latest_tca);
CREATE INDEX IF NOT EXISTS idx_events_pair ON conjunction_events(canonical_pair_key);
CREATE INDEX IF NOT EXISTS idx_events_state ON conjunction_events(lifecycle_state, urgency_level, review_status);

-- 2. Event Observations: Association linking raw immutable observations to their correlated event
CREATE TABLE IF NOT EXISTS event_observations (
    event_id UUID NOT NULL REFERENCES conjunction_events(id) ON DELETE RESTRICT,
    observation_id UUID NOT NULL REFERENCES raw_observations(id) ON DELETE RESTRICT,
    chronological_sequence INT NOT NULL CHECK (chronological_sequence > 0),
    is_unchanged_confirmation BOOLEAN NOT NULL DEFAULT FALSE,
    correlated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (event_id, observation_id),
    CONSTRAINT uq_event_sequence UNIQUE (event_id, chronological_sequence),
    CONSTRAINT uq_observation_unique_event UNIQUE (observation_id)
);

CREATE INDEX IF NOT EXISTS idx_event_obs_observation ON event_observations(observation_id);

-- 3. Correlation Decisions: Auditable record of every correlation evaluation and outcome
CREATE TABLE IF NOT EXISTS correlation_decisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    observation_id UUID NOT NULL REFERENCES raw_observations(id) ON DELETE RESTRICT,
    event_id UUID NULL REFERENCES conjunction_events(id) ON DELETE RESTRICT,
    decision_type VARCHAR(35) NOT NULL CHECK (decision_type IN (
        'EVENT_CREATED',
        'EVENT_MATCHED',
        'AMBIGUOUS_MATCH',
        'UNCHANGED_CONFIRMATION',
        'OUT_OF_ORDER_BACKFILL'
    )),
    candidate_event_ids UUID[] NOT NULL DEFAULT '{}',
    matching_policy_version VARCHAR(30) NOT NULL DEFAULT 'v1.0.0',
    step_drift_minutes NUMERIC(8, 2) NULL,
    cumulative_drift_minutes NUMERIC(8, 2) NULL,
    decision_reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_decision_observation UNIQUE (observation_id)
);

CREATE INDEX IF NOT EXISTS idx_decisions_obs ON correlation_decisions(observation_id);
CREATE INDEX IF NOT EXISTS idx_decisions_event ON correlation_decisions(event_id);
CREATE INDEX IF NOT EXISTS idx_decisions_type ON correlation_decisions(decision_type);
