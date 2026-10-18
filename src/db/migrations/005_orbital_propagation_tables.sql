-- Phase 8: Orbital Propagation and Encounter Estimation Schema
-- Additive extension for experimental SGP4 encounter estimation and TLE tracking

CREATE TABLE IF NOT EXISTS orbital_screenings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NULL REFERENCES conjunction_events(id) ON DELETE CASCADE,
    primary_object_id INT NOT NULL REFERENCES space_objects(norad_cat_id) ON DELETE RESTRICT,
    secondary_object_id INT NOT NULL REFERENCES space_objects(norad_cat_id) ON DELETE RESTRICT,
    nominal_tca TIMESTAMPTZ NOT NULL,
    estimated_tca TIMESTAMPTZ NOT NULL,
    estimated_miss_distance_km NUMERIC(10, 4) NOT NULL CHECK (estimated_miss_distance_km >= 0),
    estimated_relative_speed_kms NUMERIC(8, 4) NOT NULL CHECK (estimated_relative_speed_kms >= 0),
    search_window_minutes INT NOT NULL DEFAULT 10,
    step_seconds INT NOT NULL DEFAULT 5,
    primary_tle_line1 VARCHAR(72) NOT NULL,
    primary_tle_line2 VARCHAR(72) NOT NULL,
    secondary_tle_line1 VARCHAR(72) NOT NULL,
    secondary_tle_line2 VARCHAR(72) NOT NULL,
    primary_tle_epoch TIMESTAMPTZ NOT NULL,
    secondary_tle_epoch TIMESTAMPTZ NOT NULL,
    primary_tle_age_hours NUMERIC(8, 2) NOT NULL,
    secondary_tle_age_hours NUMERIC(8, 2) NOT NULL,
    algorithm_version VARCHAR(64) NOT NULL DEFAULT 'satellite.js@7.1.0-vallado-sgp4',
    screening_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_screenings_event_id ON orbital_screenings(event_id);
CREATE INDEX IF NOT EXISTS idx_screenings_created_at ON orbital_screenings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_screenings_pair ON orbital_screenings(primary_object_id, secondary_object_id);
