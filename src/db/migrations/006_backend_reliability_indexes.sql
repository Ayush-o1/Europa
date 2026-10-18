-- Phase 3: Backend Hardening, Performance Indexes & Operational Reliability
-- Indexes supporting frequent operational conjunction queries, triage sorting, and batch provenance.

-- 1. Index for triage queue sorting by closest predicted miss distance
CREATE INDEX IF NOT EXISTS idx_events_range ON conjunction_events(latest_range_km ASC);

-- 2. Index for triage queue sorting by cumulative minimum miss distance
CREATE INDEX IF NOT EXISTS idx_events_min_range ON conjunction_events(min_predicted_range_km ASC);

-- 3. Indexes for conjunction event object lookup by NORAD catalog ID
CREATE INDEX IF NOT EXISTS idx_events_primary_obj ON conjunction_events(primary_object_id);
CREATE INDEX IF NOT EXISTS idx_events_secondary_obj ON conjunction_events(secondary_object_id);

-- 4. Index for chronological ingestion batch provenance pagination
CREATE INDEX IF NOT EXISTS idx_batches_ingested_at ON ingestion_batches(ingested_at DESC);
