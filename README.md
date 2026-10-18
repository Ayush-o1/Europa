# Voidline

> Satellite close-approach correlation, prediction evolution tracking, and auditable review platform.

Voidline is an analytical software platform and backend engineering demonstration inspired by Space Situational Awareness (SSA) workflows. It ingests repeated public satellite close-approach predictions (such as CelesTrak SOCRATES), correlates observations into discrete encounter events over time, preserves the history of changing predictions, calculates transparent review priorities, and provides an auditable operational review workflow.

---

## Technical Stack & Architecture

- **Runtime:** Node.js (Recommended: Node.js 24 LTS; supported minimum: Node.js 22 LTS; active development environment: Node.js 26 Current)
- **Module System:** ECMAScript Modules (ESM)
- **Backend Framework:** Express.js (Modular Monolith)
- **Database:** PostgreSQL 15+ (Relational integrity, transactional advisory locks, strictly isolated transactions)
- **Testing:** Vitest & Supertest (Unit & Database Integration)
- **Code Quality:** ESLint (Flat Config v10+), Prettier

---

## Project Structure

```text
Voidline/
├── src/
│   ├── api/             # REST API layer (Modular Express Routers & Middlewares)
│   │   ├── middlewares/ # Auth, CSV upload, validator, error handling & request logging
│   │   ├── routes/      # Health, Ingestion, Events, and Audit sub-routers
│   │   └── router.js    # API v1 master router
│   ├── config/          # Environment configuration & validation
│   ├── db/              # PostgreSQL pool, transactional migrator & schema SQL
│   │   ├── migrations/  # Incremental pure SQL migrations (001, 002, 003, 004)
│   │   ├── migrator.js  # Transactional migration runner with advisory locking
│   │   └── pool.js      # Connection pool & query helpers
│   ├── modules/         # Domain modules (Zero duplicate business logic in API routes)
│   │   ├── ingestion/   # SOCRATES CSV parser, validator & ingestion service
│   │   ├── correlation/ # Event correlation service & matching heuristics
│   │   ├── assessment/  # Review-priority assessment engine & versioned rules
│   │   ├── review/      # Operator review actions & justification tracking
│   │   ├── audit/       # Cryptographic hash-chained audit ledger
│   │   ├── lifecycle/   # Event lifecycle state transitions (e.g., PAST_TCA)
│   │   └── propagation/ # SGP4 orbital propagator, TLE validator & encounter estimation
│   ├── utils/           # Shared utility functions
│   ├── app.js           # Express application factory (separated from listen for testing)
│   └── index.js         # Server runner & graceful termination handler
├── scripts/             # Operational & developer CLI tools (migrate, benchmark)
├── storage/
│   └── snapshots/       # Immutable local raw snapshot archive
├── test/
│   ├── fixtures/        # Sample scenario CSV datasets (real, synthetic, malformed)
│   ├── helpers/         # Test database cleanup and isolation helpers
│   ├── unit/            # Unit tests for domain logic, parser, rules & audit ledger
│   ├── integration/     # Database integration, concurrency & Supertest API tests
│   └── e2e/             # Real browser Playwright end-to-end user workflow tests
├── public/              # Static frontend assets (HTML, CSS, vanilla JS)
├── eslint.config.js     # ESLint flat configuration
├── vitest.config.js     # Vitest test runner configuration
├── playwright.config.js # Playwright browser test configuration
├── .prettierrc          # Prettier code formatting rules
├── .env.example         # Environment template
└── package.json         # Project manifest
```

---

## Getting Started

### Prerequisites

- **Node.js:** v22.0.0 or higher (recommended: **Node.js 24 LTS**; active dev environment runs **Node.js 26 Current**)
- **npm:** v10.0.0 or higher
- **PostgreSQL:** v15 or higher (running locally on port 5432)

### Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/Ayush-o1/Voidline.git
cd Voidline
npm install
```

### Database Provisioning

Create local development and test databases in PostgreSQL:

```bash
# Using standard macOS Homebrew PostgreSQL or local psql
psql -d postgres -c "CREATE DATABASE voidline_dev;"
psql -d postgres -c "CREATE DATABASE voidline_test;"
```

### Environment Setup

Copy the example environment configuration:

```bash
cp .env.example .env
```

Apply database migrations:

```bash
npm run db:migrate
```

Start the application server:

```bash
# Start development server with live watch mode
npm run dev

# Or run standard server
npm start
```

---

## Available Commands

| Command                | Purpose                                                                    |
| :--------------------- | :------------------------------------------------------------------------- |
| `npm start`            | Start the Express API server on `PORT` (default 3000)                      |
| `npm run dev`          | Start the Express API server in watch mode (`node --watch`)                |
| `npm test`             | Run the automated test suite once via Vitest (unit & database integration) |
| `npm run test:watch`   | Run Vitest in interactive watch mode                                       |
| `npm run test:e2e`     | Run real browser end-to-end tests via Playwright against PostgreSQL        |
| `npm run benchmark`    | Run reproducible performance benchmark harness and record baseline metrics |
| `npm run db:migrate`   | Apply all pending transactional SQL migrations                             |
| `npm run lint`         | Check code for style and syntax errors via ESLint                          |
| `npm run lint:fix`     | Automatically fix ESLint warnings and errors                               |
| `npm run format`       | Format all source and test files using Prettier                            |
| `npm run format:check` | Verify formatting consistency without writing changes                      |

---

## REST API Reference

The Voidline API is exposed under `/api/v1` with consistent JSON envelopes:

### Response Format

- **Success Envelope:**
  ```json
  {
    "success": true,
    "data": { ... },
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 42,
      "totalPages": 3
    }
  }
  ```
- **Error Envelope:**
  ```json
  {
    "success": false,
    "error": {
      "code": "INVALID_FILTER",
      "message": "Detailed sanitized error explanation"
    }
  }
  ```

### Authentication & Authorization Boundary

- **Read Endpoints:** Publicly accessible for operational awareness and audits (`GET /health`, `GET /events`, `GET /events/:id`, etc.).
- **Write Endpoints:** Protected by operator authentication (`POST /ingest/snapshots`, `POST /events/:id/reviews`).
- **Authentication Headers:** Supply either `X-API-Key: <key>` or `Authorization: Bearer <key>`. Default development key is `voidline-dev-key`.
- An optional `X-Actor-Id: <identifier>` header may be provided to record operator attribution in reviews and the cryptographic audit ledger.

---

### Endpoint Catalog

| Method | Endpoint                                | Auth              | Description                                                                                       |
| :----- | :-------------------------------------- | :---------------- | :------------------------------------------------------------------------------------------------ |
| `GET`  | `/api/v1/health`                        | None              | Application and database readiness status (safe, no credential leakage).                          |
| `POST` | `/api/v1/ingest/snapshots`              | Operator          | Upload CelesTrak SOCRATES CSV snapshot; triggers correlation & assessment.                        |
| `GET`  | `/api/v1/ingest/batches`                | None              | Paginated ingestion batch history (omits internal filesystem paths).                              |
| `GET`  | `/api/v1/events`                        | None              | Paginated event discovery with strict sorting and multi-field filtering.                          |
| `GET`  | `/api/v1/events/:id`                    | None              | Event details joined with space objects, latest observation, and review.                          |
| `GET`  | `/api/v1/events/:id/history`            | None              | Chronological observation history sorted by snapshot capture time.                                |
| `GET`  | `/api/v1/events/:id/assessments`        | None              | Full assessment score and explanation history for an event.                                       |
| `GET`  | `/api/v1/events/:id/assessments/latest` | None              | Current active review-priority assessment (404 if unpopulated).                                   |
| `POST` | `/api/v1/events/:id/reviews`            | Operator          | Record justified operator review (`ACKNOWLEDGE`, `ESCALATE`, `DISMISS`).                          |
| `GET`  | `/api/v1/events/:id/audit`              | None              | Paginated cryptographic audit trail entries for an encounter event.                               |
| `GET`  | `/api/v1/audit/verify`                  | None              | Read-only cryptographic verification of entire hash-chained audit ledger.                         |
| `POST` | `/api/v1/propagation/estimate`          | Public / Operator | Compute SGP4 encounter trajectory, refined TCA, and miss distance (persists if eventId provided). |
| `GET`  | `/api/v1/events/:id/propagation`        | None              | Retrieve historical SGP4 orbital encounter screenings for an event.                               |

---

### Example Requests (Safe Sample Data)

#### 1. System Health & Database Readiness

```bash
curl -s http://localhost:3000/api/v1/health
```

#### 2. Ingest a SOCRATES CSV Snapshot

```bash
curl -s -X POST http://localhost:3000/api/v1/ingest/snapshots \
  -H "X-API-Key: voidline-dev-key" \
  -F "file=@test/fixtures/socrates_real_sample.csv" \
  -F "screeningScope=FULL_CATALOG_MINRANGE"
```

#### 3. Ingestion Batches Query

```bash
curl -s "http://localhost:3000/api/v1/ingest/batches?page=1&limit=10"
```

#### 4. Filter and Discover Conjunction Events

```bash
# Query active CRITICAL encounters sorted by miss distance
curl -s "http://localhost:3000/api/v1/events?urgency=CRITICAL&sortBy=latest_range_km&sortOrder=ASC&limit=20"

# Filter by satellite catalog number (e.g. ISS 25544)
curl -s "http://localhost:3000/api/v1/events?objectId=25544"

# Filter by maximum miss distance threshold (e.g. 5.0 km)
curl -s "http://localhost:3000/api/v1/events?missDistanceMax=5.0"
```

#### 5. Inspect Event Details & Chronological Observation History

```bash
# Event details, latest observation, latest assessment, and current review
curl -s "http://localhost:3000/api/v1/events/14a0cf7d-2b3f-4e05-9502-861f8a7e6712"

# Chronological observation history
curl -s "http://localhost:3000/api/v1/events/14a0cf7d-2b3f-4e05-9502-861f8a7e6712/history"
```

#### 6. Inspect Conjunction Assessments

```bash
# Latest assessment
curl -s "http://localhost:3000/api/v1/events/14a0cf7d-2b3f-4e05-9502-861f8a7e6712/assessments/latest"

# Assessment evolution history
curl -s "http://localhost:3000/api/v1/events/14a0cf7d-2b3f-4e05-9502-861f8a7e6712/assessments"
```

#### 7. Submit Justified Operator Review

```bash
curl -s -X POST "http://localhost:3000/api/v1/events/14a0cf7d-2b3f-4e05-9502-861f8a7e6712/reviews" \
  -H "X-API-Key: voidline-dev-key" \
  -H "X-Actor-Id: flight-director-1" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "ESCALATE",
    "justification": "Miss distance predicted under 1km within 24h of TCA. Escalated for orbital collision avoidance maneuver screening."
  }'
```

#### 8. Verify Cryptographic Audit Ledger

```bash
curl -s "http://localhost:3000/api/v1/audit/verify"
```

#### 9. Compute SGP4 Orbital Encounter Screening (Experimental)

```bash
curl -s -X POST "http://localhost:3000/api/v1/propagation/estimate" \
  -H "Content-Type: application/json" \
  -d '{
    "primaryTle": {
      "line1": "1 25544U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  9009",
      "line2": "2 25544  51.6400 208.9163 0004780  69.9862  25.2906 15.49815016431907"
    },
    "secondaryTle": {
      "line1": "1 34454U 93036SX  24001.50000000  .00001234  00000-0  56789-4 0  9004",
      "line2": "2 34454  74.0400 210.1234 0021500 120.4500  45.6700 14.85000000213455"
    },
    "nominalTca": "2024-01-01T12:00:00.000Z",
    "searchWindowMinutes": 10,
    "stepSeconds": 5
  }'
```

---

## Current Status

- **Phase 0 (Foundation & Scaffolding):** Completed and verified.
- **Phase 1 (Database & Ingestion Pipeline):** Completed and verified.
  - Transactional SQL migration engine with advisory locking.
  - Phase 1 relational schema: `ingestion_batches`, `space_objects`, `raw_observations`, `batch_errors`.
  - RFC 4180 streaming SOCRATES CSV parser handling 6-digit catalog numbers, scientific notation, and status codes.
  - Atomic ingestion pipeline with SHA-256 disk archiving, idempotency enforcement, and multi-snapshot provenance.
- **Phase 2 (Event Correlation Engine):** Completed and verified.
  - Additive migration `002_correlation_tables.sql`: `conjunction_events`, `event_observations`, `correlation_decisions`.
  - Concurrency control: Two-key transaction advisory locks (`pg_advisory_xact_lock(primary, secondary)`) preventing duplicate events under concurrent imports.
  - Deterministic canonical pair identity (`primary_id = min(a,b)`, `secondary_id = max(a,b)`).
  - Explicit heuristic matching policy: 20-minute step tolerance, 45-minute cumulative drift ceiling.
  - Ambiguity tracking: Flagging and preserving competing intra-snapshot predictions, continuity breaks, or multiple plausible candidates without arbitrary merging.
  - Out-of-order snapshot safety: Non-destructive backfills preserving latest predicted state and historical sequence.
  - Deterministic event lifecycle manager (`PAST_TCA` transition logic with injectable reference time).
- **Phase 3 (Review-Priority Assessment Engine):** Completed and verified.
  - Additive migration `003_assessment_tables.sql`: `assessment_rule_sets`, `event_assessments`.
  - Default rule-set `v1.0.0-heuristic`: Explainable 100-point priority scoring evaluating miss distance (50%), time to TCA (30%), upper-bound screening probability metric (15%), and data freshness (5%).
  - Scientific boundaries: Explicitly treats `MAX_PROB` as an upper-bound screening metric under simplified covariance assumptions rather than an authoritative collision risk or maneuver threshold.
  - Deterministic urgency classification (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`) with severe proximity override (< 0.5 km within 24h).
  - Full historical assessment trace preservation (`is_current` flagging, preventing overwrite of prior evaluations).
  - Out-of-order backfill safety: Late historical arrivals do not demote current assessment urgency.
  - Transparent explainability storing diagnostic component reasons, input snapshots, and rule versions.
- **Phase 4 (Analyst Review & Ledger Audit Trail):** Completed and verified.
  - Additive migration `004_review_and_audit_tables.sql`: `event_reviews`, `audit_ledger`, and database-level mutation prevention triggers.
  - Operational review workflow: `ACKNOWLEDGE`, `ESCALATE`, `DISMISS`, `REQUEST_REASSESSMENT` actions with mandatory meaningful justification (>= 10 characters).
  - Decoupled state dimensions: `review_status` remains strictly decoupled from `lifecycle_state` and `urgency_level`.
  - Automated re-review triggering: Marks `review_status = 'REQUIRES_RE_REVIEW'` when subsequent observations materially elevate urgency, contract miss distance by >= 20%, or cross under 24 hours to TCA, preserving previous review history.
  - Cryptographic append-only audit ledger: SHA-256 hash chaining over canonical serialized payloads with advisory-locked concurrency protection.
  - Verification & anti-tampering: Trigger strictly prohibits `UPDATE` or `DELETE` on `audit_ledger`, and `verifyAuditLedger()` validates the hash chain from genesis to head.
  - Documented limitation: Database-local hash chaining detects SQL tampering but cannot prevent root administrative manipulation without external distributed anchoring.
- **Phase 5 (REST API & Operational Queries):** Completed and verified.
  - Modular Express.js architecture separating app creation (`src/app.js`) from server listening (`src/index.js`).
  - Zero duplicate business logic: Route controllers delegate strictly to domain services.
  - Standard JSON success and error envelopes with database error sanitization (no leaked SQL, credentials, or stack traces).
  - Strict input validation on UUIDs, pagination bounds (1..100), query filters, and review justifications (>=10 chars).
  - CSV upload safety: In-memory streaming, 10MB file limit, MIME/extension filtering (`.csv`), and duplicate detection.
  - Security boundary: Write operations protected by operator API key authentication (`X-API-Key` or `Bearer`), with read endpoints publicly accessible.
  - Read-only cryptographic audit chain verification endpoint (`GET /api/v1/audit/verify`).
  - Comprehensive Supertest integration suite with 102 passing tests across unit and database integration suites.
- **Phase 6 (Analytical Web Interface):** Completed and verified.
  - Restrained, scientific dark-theme workbench delivered via vanilla HTML5, CSS custom properties (design tokens), and modular ES JavaScript.
  - Zero frontend framework dependencies: No React, Vue, build bundlers, or second server; served directly via Express from `public/`.
  - Operational Overview (Part 6A): Real-time KPI metrics, priority urgency distribution bars, upcoming encounters, and ingestion batch status.
  - Event Triage Queue (Part 6B): Analytical data table with multi-dimensional filtering (urgency, lifecycle state, review status, NORAD IDs, max range), sorting, and pagination.
  - Event Details & Prediction History (Part 6C): Encounter banner, precision SVG miss distance evolution chart, and chronological observation timeline (`captured_at ASC`).
  - Assessment Explanation (Part 6D): 100-point heuristic scoring breakdown across miss distance (50%), time to TCA (30%), max probability metric (15%), and orbit data freshness (5%), accompanied by a neutral scientific limitation disclaimer.
  - Operator Review Workflow (Part 6E): Justified operational decision submission (`ACKNOWLEDGE`, `ESCALATE`, `DISMISS`, `REQUEST_REASSESSMENT`) with live validation (>=10 chars), review history stream, and re-review warning banners.
  - Snapshot Ingestion (Part 6F): Drag-and-drop CSV upload with duplicate detection, batch history table, and 1-click real SOCRATES sample dataset loader.
  - Cryptographic Audit Ledger (Part 6G): Read-only cryptographic hash-chain verification runner, chain status indicator, and anti-tampering notices.
  - Security Architecture: Operator API keys are managed strictly in transient in-memory state (`state.operatorApiKey`), never written to disk, localStorage, sessionStorage, or logs.
- **Phase 7 (End-to-End Testing & Performance Benchmarks):** Completed and verified.
  - Real browser end-to-end test suite (`test/e2e/e2eWorkflows.spec.js`) powered by Playwright executing against live Express server and real PostgreSQL (`voidline_test`).
  - Comprehensive scenario coverage:
    - **Scenario A (Fresh installation):** Server boot, DOM load, real DB readiness status, zero-state messaging, and navigation without browser console errors.
    - **Scenario B (Snapshot ingestion):** Operator key entry via in-memory modal, drag-and-drop file upload, ingestion summary verification, provenance table tracking, duplicate upload rejection (`DUPLICATE_IGNORED`), separate capture confirmation, and malformed row error reporting.
    - **Scenario C (Event investigation):** Encounter triage filtering, event detail inspection, precision SVG miss distance evolution charting, chronological timeline sequence, heuristic assessment breakdown, and linked audit records.
    - **Scenario D (Operator review & audit):** Technical justification validation (>=10 chars), unauthorized write rejection, state escalation (`ESCALATED`), re-review triggering upon prediction contraction without erasing prior review history, valid audit ledger verification (`CHAIN INTACT`), and deliberate controlled tampering detection (`TAMPER DETECTED` reporting exact broken sequence).
    - **Scenario E (Usability & security):** Desktop (1280x720) and mobile (375x667) responsiveness, hash-based client routing across reloads, transient memory isolation (keys absent from `localStorage`, `sessionStorage`, and URLs).
  - Deterministic synthetic scenario fixtures (`test/fixtures/synthetic_scenario_*.csv`) explicitly labeled as synthetic: newly created encounters, tightening predictions, diverging predictions, duplicate captures, distinct encounters for the same object pair, ambiguous intra-snapshot predictions, out-of-order historical arrivals, and malformed rows.
  - Comprehensive regression and resilience integration suite (`test/integration/resilienceAndRegression.test.js`) verifying concurrent ingestion safety under PostgreSQL advisory locks, transactional rollback isolation, chronological sequence preservation during out-of-order backfills, and safeguards against running destructive cleanup in production.
  - Repeatable performance benchmark harness (`scripts/benchmark.js`) recording real metrics across 100, 1,000, and 5,000 synthetic rows and multi-worker concurrency.
  - Automated Continuous Integration workflow (`.github/workflows/ci.yml`) executing formatting checks, ESLint, database migrations, Vitest suite, and Playwright browser tests against a containerized PostgreSQL service.
- **Phase 8 (Experimental SGP4 Orbital Propagation & Encounter Estimation):** Completed and verified.
  - Pinned Dependency: `satellite.js@7.1.0` (MIT license, 0 external dependencies, actively maintained implementation of Vallado's revised SGP4 algorithm).
  - TLE Validation & Parsing (`src/modules/propagation/tleValidator.js`): Strict NORAD standard verification enforcing 69-character line lengths, prefixes (`1 `, `2 `), modulo-10 checksums, catalog number consistency, fractional day epoch decoding, and orbital parameter boundaries.
  - SGP4 Trajectory Propagation (`src/modules/propagation/sgp4Propagator.js`): Evaluates mean orbital elements under low-order zonal harmonics ($J_2, J_3, J_4$), BSTAR drag, and lunar/solar third-body gravitational perturbations (SDP4), generating True Equator Mean Equinox (TEME) position and velocity vectors.
  - Encounter Estimation Engine (`src/modules/propagation/encounterEstimator.js`): Refines Time of Closest Approach (TCA), minimum miss distance, and relative speed across a bounded search window using coarse sweep and fine (100 ms) resolution refinement. Tracks TLE age in hours and flags stale elements (>72h).
  - Additive Relational Schema (`src/db/migrations/005_orbital_propagation_tables.sql`): `orbital_screenings` table with cascading foreign keys to `conjunction_events` and indexed object pairs.
  - Cryptographic Audit Trail: Appends verified `ORBITAL_SCREENING_COMPUTED` entries to the hash-chained `audit_ledger` when operator-authenticated screenings are executed.
  - REST Endpoints: `POST /api/v1/propagation/estimate` (on-demand screening with optional persistence) and `GET /api/v1/events/:id/propagation` (historical screenings).
  - Analytical Frontend Workbench: Interactive SGP4 screening card on Event Details view featuring 1-click sample TLE loading, trajectory computation, and direct comparison with SOCRATES reported range.
  - Scientific Disclaimers & Limitations: Prominently identifies all calculations as experimental screening aids. Reaffirms that SGP4 mean elements lack covariance matrices and do not compute authoritative collision probabilities ($P_c$), and that SOCRATES `MAX_PROB` is an upper-bound screening metric.

---

## Performance Baseline & Benchmarks

The benchmark suite (`npm run benchmark`) measures real execution throughput, response latency percentiles, and memory footprint across controlled synthetic workloads against PostgreSQL.

### Test Environment

- **Operating System:** macOS Darwin (arm64, Apple Silicon)
- **Processor:** Apple M4 (10 cores)
- **System Memory:** 16.00 GB RAM
- **Node.js Runtime:** v26.12.0
- **Database Engine:** PostgreSQL 18.6 (Homebrew)
- **Isolation:** Serial and concurrent database workloads isolated in `voidline_test`

### Measured Performance Baseline

| Operation                               | 100 Rows                   | 1,000 Rows                  | 5,000 Rows                  |
| :-------------------------------------- | :------------------------- | :-------------------------- | :-------------------------- |
| **CSV Parsing & Validation**            | 24,478 rows/s (4.09 ms)    | 161,835 rows/s (6.18 ms)    | 187,932 rows/s (26.61 ms)   |
| **Ingestion, Correlation & Assessment** | 447 rows/s (223.73 ms)     | 869 rows/s (1,150.16 ms)    | 1,492 rows/s (3,350.46 ms)  |
| **Successive Snapshot Evolution**       | 100 updates (241.12 ms)    | 500 updates (1,462.52 ms)   | 500 updates (5,624.82 ms)   |
| **Event List API Query (p50 / p95)**    | 2.63 ms / 4.13 ms          | 1.95 ms / 4.91 ms           | 1.90 ms / 2.94 ms           |
| **Event History API Query (p50 / p95)** | 0.81 ms / 1.03 ms          | 0.89 ms / 1.14 ms           | 0.76 ms / 0.98 ms           |
| **Cryptographic Audit Verification**    | 88,185 entries/s (2.27 ms) | 141,909 entries/s (7.05 ms) | 133,960 entries/s (7.46 ms) |
| **Peak Heap / RSS Memory**              | 28.9 MB / 71.7 MB          | 61.4 MB / 137.6 MB          | 78.1 MB / 169.8 MB          |

### Concurrency Stress Baseline (3 Workers × 500 Rows)

- **Total Workload:** 1,500 rows submitted concurrently in parallel across 3 worker connections
- **Duration & Aggregate Throughput:** 2,606.50 ms (~575 rows/sec aggregate)
- **Encounter Integrity:** Exactly 500 unique conjunction encounters formed (zero duplicate encounter creation, verifying two-key transaction advisory locking)
- **Audit Ledger Verification:** 100% valid SHA-256 hash chain with zero sequence gaps or link breaks

### Bottleneck Analysis

1. **Fastest Operations:**
   - **Streaming CSV Parsing:** Exceeds 180,000 rows/second utilizing Node.js streams and low-overhead regex validation.
   - **Cryptographic Audit Ledger Verification:** Operates at ~134,000 to 142,000 entries/second due to indexed sequential scanning and native V8 SHA-256 computation.
   - **Operational REST Queries:** Triage queue and event history endpoints respond with p95 latency under 5 milliseconds.
2. **Primary Workload Bottleneck:**
   - **Database Transaction Write Latency during Batch Ingestion:** For each observation in a batch, the pipeline performs canonical object lookup/insertion, candidate encounter evaluation, raw observation persistence, event state updating, assessment scoring, and audit entry appending.
   - Ingest throughput scales from ~447 rows/s for small batches to ~1,492 rows/s for 5,000-row batches due to connection pooling amortization.
   - Under heavy concurrency, transactional advisory locks (`pg_advisory_xact_lock`) safely serialize operations per object pair, prioritizing correctness over raw unsafe parallel throughput.
