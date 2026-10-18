-- Phase 3: Review-Priority Assessment Engine Schema
-- Tables for versioned assessment rule sets and explainable assessment results.

-- 1. Assessment Rule Sets: Versioned, documented rule definitions
CREATE TABLE IF NOT EXISTS assessment_rule_sets (
    version VARCHAR(32) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    config JSONB NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Event Assessments: Historical, immutable records of review-priority assessments
CREATE TABLE IF NOT EXISTS event_assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES conjunction_events(id) ON DELETE RESTRICT,
    observation_id UUID NULL REFERENCES raw_observations(id) ON DELETE RESTRICT,
    rule_set_version VARCHAR(32) NOT NULL REFERENCES assessment_rule_sets(version) ON DELETE RESTRICT,
    assessment_score NUMERIC(5, 2) NOT NULL CHECK (assessment_score >= 0 AND assessment_score <= 100),
    urgency_level VARCHAR(20) NOT NULL CHECK (urgency_level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    component_scores JSONB NOT NULL,
    input_snapshot JSONB NOT NULL,
    explanations JSONB NOT NULL,
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assessments_event_id ON event_assessments(event_id);
CREATE INDEX IF NOT EXISTS idx_assessments_observation_id ON event_assessments(observation_id);
CREATE INDEX IF NOT EXISTS idx_assessments_urgency ON event_assessments(urgency_level);
CREATE INDEX IF NOT EXISTS idx_assessments_created ON event_assessments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assessments_current ON event_assessments(event_id, is_current);

-- Seed initial default rule set (v1.0.0-heuristic)
INSERT INTO assessment_rule_sets (version, name, description, config, is_active)
VALUES (
    'v1.0.0-heuristic',
    'Standard Operational Screening Heuristic',
    'Explainable 100-point priority scoring evaluating miss distance (50%), time to TCA (30%), upper-bound screening probability metric (15%), and orbit data freshness (5%).',
    '{
        "weights": {
            "missDistance": 50,
            "timeToTca": 30,
            "probability": 15,
            "dataFreshness": 5
        },
        "thresholds": {
            "missDistanceKm": {
                "critical": 0.5,
                "high": 1.0,
                "medium": 2.0,
                "moderate": 5.0,
                "low": 10.0
            },
            "timeToTcaHours": {
                "critical": 12,
                "high": 24,
                "medium": 48,
                "low": 72
            },
            "probability": {
                "high": 1e-4,
                "elevated": 1e-5,
                "moderate": 1e-6
            },
            "dataFreshnessDays": {
                "fresh": 1.0,
                "acceptable": 3.0
            }
        },
        "classification": {
            "criticalScore": 75,
            "highScore": 55,
            "mediumScore": 35
        }
    }'::jsonb,
    TRUE
)
ON CONFLICT (version) DO NOTHING;
