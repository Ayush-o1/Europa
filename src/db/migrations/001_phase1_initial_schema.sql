-- Phase 1: Foundational Database Schema
-- Ingestion batches, space objects, raw observations, and batch error reporting.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Ingestion Batches: Detailed Provenance, File Checksums, and Scope
CREATE TABLE IF NOT EXISTS ingestion_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_uri TEXT NOT NULL,
    query_params JSONB NOT NULL DEFAULT '{}'::jsonb,
    screening_scope VARCHAR(50) NOT NULL CHECK (screening_scope IN ('FULL_CATALOG_MINRANGE', 'FILTERED_QUERY', 'LOCAL_FIXTURE')),
    content_sha256 CHAR(64) NOT NULL,
    archive_file_path TEXT NOT NULL,
    http_etag VARCHAR(100) NULL,
    http_last_modified TIMESTAMPTZ NULL,
    captured_at TIMESTAMPTZ NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    row_count INT NOT NULL DEFAULT 0,
    valid_count INT NOT NULL DEFAULT 0,
    error_count INT NOT NULL DEFAULT 0,
    status VARCHAR(35) NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'SUPERSEDED_UNMODIFIED_POLL')),
    error_summary TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_batches_sha ON ingestion_batches(content_sha256);
CREATE INDEX IF NOT EXISTS idx_batches_captured ON ingestion_batches(captured_at);
CREATE INDEX IF NOT EXISTS idx_batches_status ON ingestion_batches(status);

-- 2. Space Objects: Normalized Catalog Information
CREATE TABLE IF NOT EXISTS space_objects (
    norad_cat_id INT PRIMARY KEY CHECK (norad_cat_id > 0),
    object_name VARCHAR(120) NOT NULL,
    operational_status VARCHAR(30) NOT NULL DEFAULT 'UNKNOWN',
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_space_objects_status ON space_objects(operational_status);

-- 3. Raw Observations: Immutable Provenance Ledger
CREATE TABLE IF NOT EXISTS raw_observations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES ingestion_batches(id) ON DELETE RESTRICT,
    row_index INT NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL,
    primary_norad_id INT NOT NULL REFERENCES space_objects(norad_cat_id) ON DELETE RESTRICT,
    secondary_norad_id INT NOT NULL REFERENCES space_objects(norad_cat_id) ON DELETE RESTRICT,
    canonical_pair_key VARCHAR(50) NOT NULL,
    tca TIMESTAMPTZ NOT NULL,
    tca_range_km NUMERIC(10, 4) NOT NULL CHECK (tca_range_km >= 0),
    relative_speed_kms NUMERIC(8, 4) NOT NULL CHECK (relative_speed_kms >= 0),
    max_prob NUMERIC(14, 10) NULL,
    dilution_km NUMERIC(10, 4) NULL,
    dse_primary NUMERIC(8, 4) NOT NULL,
    dse_secondary NUMERIC(8, 4) NOT NULL,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_batch_row UNIQUE (batch_id, row_index)
);

CREATE INDEX IF NOT EXISTS idx_raw_obs_pair_tca ON raw_observations(canonical_pair_key, tca);
CREATE INDEX IF NOT EXISTS idx_raw_obs_captured ON raw_observations(captured_at);
CREATE INDEX IF NOT EXISTS idx_raw_obs_batch ON raw_observations(batch_id);

-- 4. Batch Errors: Granular Row-Level Parsing and Validation Failure Reporting
CREATE TABLE IF NOT EXISTS batch_errors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES ingestion_batches(id) ON DELETE RESTRICT,
    row_index INT NULL,
    raw_data TEXT NULL,
    error_code VARCHAR(50) NOT NULL,
    error_message TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_batch_errors_batch ON batch_errors(batch_id);
