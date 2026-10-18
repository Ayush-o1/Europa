# Europa

> Satellite close-approach correlation, prediction evolution tracking, and auditable operational review platform.

Europa is an analytical space situational awareness (SSA) workbench and backend service. It ingests successive public satellite close-approach predictions (such as CelesTrak SOCRATES), correlates observations into persistent encounter events over time, tracks prediction evolution, computes transparent review priorities, provides an auditable operational review workflow, and supports experimental SGP4 orbital trajectory screening.

---

## System Architecture & Data Flow

Europa is built as a modular Node.js monolith with an isolated relational PostgreSQL persistence layer and a zero-dependency vanilla web workbench.

```text
[ CelesTrak SOCRATES CSV ]
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│ Ingestion Pipeline                                          │
│ • RFC 4180 Streaming Parser                                 │
│ • SHA-256 Checksumming & Raw Snapshot Storage               │
│ • Catalog Object Lookup / Upsert (NORAD IDs)                │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Correlation Engine                                          │
│ • Deterministic Canonical Pair Keying: min(id1, id2)        │
│ • Two-Key PostgreSQL Transaction Advisory Locks             │
│ • Adaptive Window Matching & Drift Tolerance                │
│ • Ambiguity Detection & Out-of-Order Backfill Safety        │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Assessment Engine & State Evaluation                        │
│ • Versioned Heuristic Rule Sets                             │
│ • Multi-Factor Scoring (Range, TCA Time, Freshess, Metric)   │
│ • Urgency Classification (LOW, MEDIUM, HIGH, CRITICAL)      │
│ • Lifecycle Management (MONITORING ➔ PAST_TCA)              │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Audit Ledger & Operator Workflow                            │
│ • Append-Only SHA-256 Hash Chain (Genesis to Head)          │
│ • Database Anti-Tampering Triggers (Blocks UPDATE / DELETE) │
│ • Justified Review Actions (ACKNOWLEDGE, ESCALATE, DISMISS) │
│ • Automated Re-Review Triggers on Prediction Shifts         │
└──────────────────────────────┬──────────────────────────────┘
                               │
               ┌───────────────┴───────────────┐
               ▼                               ▼
┌─────────────────────────────┐ ┌─────────────────────────────┐
│ Express REST API (/api/v1)  │ │ Analytical Web Workbench    │
│ • Strict Input Validation   │ │ • Real-Time KPI Cards       │
│ • Operator Auth (API Key)   │ │ • Filtering & Triage Queue  │
│ • Sanitized Error Handling  │ │ • SVG Trajectory Evolution  │
│ • Read-Only Chain Verifier  │ │ • SGP4 Trajectory Screening │
└─────────────────────────────┘ └─────────────────────────────┘
```

---

## Core Capabilities

### 1. Ingestion Pipeline & Data Provenance

- **Streaming Parser:** Memory-bounded CSV parsing supporting 6-digit NORAD catalog numbers, scientific notation, and status flags.
- **Idempotency & Integrity:** Computes SHA-256 checksums per snapshot to detect repeated ingestion. Identical snapshots return cached batch metadata without creating duplicate observations.
- **Provenance Retention:** Stores unaltered raw observations linked to source batch records, capture timestamps, and line numbers.

### 2. Event Correlation Engine

- **Deterministic Pair Identity:** Groups conjunction pairs using canonical ordering (`primary_id = min(a, b)`, `secondary_id = max(a, b)`).
- **Concurrency Control:** Utilizes two-key PostgreSQL transaction advisory locking (`pg_advisory_xact_lock(primary, secondary)`) to serialize concurrent ingestion workers without race conditions or duplicate events.
- **Heuristic Matching Policy:** Applies a 20-minute step tolerance and a 45-minute cumulative drift ceiling to associate successive predictions into the same encounter event.
- **Out-of-Order Resilience:** Safely ingests delayed or historical snapshots as non-destructive backfills, preserving the historical sequence while updating event state correctly.
- **Ambiguity Detection:** Identifies competing intra-snapshot predictions, continuity breaks, or multiple plausible candidates without arbitrary merging.

### 3. Review-Priority Assessment

- **Explainable 100-Point Scoring:** Evaluates miss distance (50%), time to TCA (30%), upper-bound screening probability (15%), and orbit data freshness (5%).
- **Deterministic Urgency Bands:** Classifies events into `LOW`, `MEDIUM`, `HIGH`, and `CRITICAL` urgency tiers, with severe proximity overrides (<0.5 km within 24h of TCA).
- **Audit Trace Preservation:** Every calculation creates a timestamped assessment record retaining input snapshot metrics, rule versions, and breakdown components.

### 4. Operator Review & Audit Ledger

- **Operational Review Actions:** Operators can record `ACKNOWLEDGE`, `ESCALATE`, `DISMISS`, or `REQUEST_REASSESSMENT` actions with mandatory justification (≥10 characters).
- **Decoupled State Dimensions:** Operator `review_status` remains strictly separated from `lifecycle_state` (`MONITORING`, `PAST_TCA`) and algorithmic `urgency_level`.
- **Automated Re-Review Triggering:** Marks events as `REQUIRES_RE_REVIEW` when a new observation contracts miss distance by ≥20%, elevates urgency, or brings TCA within 24 hours.
- **Cryptographic Hash Chaining:** Every event creation, correlation step, assessment evaluation, and review decision is immutably appended to a SHA-256 hash-chained ledger. Database triggers prevent SQL `UPDATE` or `DELETE` operations on audit rows.

### 5. Experimental SGP4 Orbital Screening

- **Trajectory Propagation:** Evaluates two-line element (TLE) sets using Vallado's revised SGP4 algorithm via `satellite.js` (MIT license, 0 external dependencies).
- **Encounter Refinement:** Employs a coarse sweep and fine (100 ms) resolution step across a configurable window to compute refined Time of Closest Approach, minimum miss distance, and relative velocity.
- **TLE Quality & Age Tracking:** Validates standard NORAD 69-character lines, modulo-10 checksums, epoch timestamps, and flags orbital elements older than 72 hours.

### 6. Analytical Web Interface

- **Pure Vanilla Stack:** Built with semantic HTML5, CSS design tokens, and modular ES JavaScript—no heavyweight frontend frameworks or build steps required.
- **Operational Views:** Overview dashboard with live KPIs, searchable triage queue with multi-field filtering, chronological observation timelines, SVG range evolution charts, ingestion console, and cryptographic chain verifier.
- **In-Memory Security:** Operator API keys are held strictly in transient memory (`state.operatorApiKey`) and are never written to disk, `localStorage`, `sessionStorage`, or client logs.

---

## Technology Stack

| Component         | Technology                    | Description                                                   |
| :---------------- | :---------------------------- | :------------------------------------------------------------ |
| **Runtime**       | Node.js (≥22.0.0 LTS)         | Server-side ECMAScript Modules (ESM)                          |
| **Framework**     | Express.js 5                  | Lightweight HTTP API and static file serving                  |
| **Database**      | PostgreSQL (≥15)              | Relational schema, transactional migrations, advisory locking |
| **Driver**        | `pg` (node-postgres)          | High-performance pooled PostgreSQL client                     |
| **Astrodynamics** | `satellite.js` 7.1.0          | SGP4/SDP4 satellite orbit propagation                         |
| **Testing**       | Vitest, Supertest, Playwright | Unit, database integration, and real-browser E2E testing      |
| **Code Quality**  | ESLint 10, Prettier 3         | Flat config linting and formatting standards                  |

---

## Repository Structure

```text
Europa/
├── src/
│   ├── api/             # Modular Express routers, auth, validation, and error middlewares
│   │   ├── middlewares/ # Authentication, CSV upload, logging, and error handling
│   │   ├── routes/      # Ingestion, events, reviews, audit, and propagation endpoints
│   │   └── router.js    # Master API v1 router
│   ├── config/          # Environment configuration loader with safe defaults
│   ├── db/              # Database pool, migrations, and transactional migrator
│   │   ├── migrations/  # Pure SQL incremental schema migrations (001–005)
│   │   ├── migrator.js  # Advisory-locked transactional migration runner
│   │   └── pool.js      # Pooled database connection helpers
│   ├── modules/         # Core domain services
│   │   ├── ingestion/   # SOCRATES CSV streaming parser and ingestion service
│   │   ├── correlation/ # Event correlation, pair keying, and matching heuristics
│   │   ├── assessment/  # Review-priority assessment engine and rule sets
│   │   ├── review/      # Operator reviews and re-review triggers
│   │   ├── audit/       # Cryptographic hash-chained audit ledger
│   │   ├── lifecycle/   # Event lifecycle state transitions (e.g., PAST_TCA)
│   │   └── propagation/ # SGP4 orbital propagator and encounter estimator
│   ├── utils/           # Shared utility functions
│   ├── app.js           # Express application factory
│   └── index.js         # HTTP server entrypoint and graceful shutdown handler
├── scripts/             # CLI tools (database migrations, performance benchmark)
├── storage/             # Local snapshot archive directory
├── test/
│   ├── fixtures/        # Sample datasets (real SOCRATES, synthetic scenarios, invalid CSVs)
│   ├── helpers/         # Test database cleanup and isolation helpers
│   ├── unit/            # Unit tests for domain modules and mathematical utilities
│   ├── integration/     # Database integration, concurrency, and API tests
│   └── e2e/             # Playwright real-browser end-to-end test scenarios
├── public/              # Analytical web workbench frontend (HTML, CSS, JS)
├── eslint.config.js     # ESLint configuration
├── vitest.config.js     # Vitest configuration
├── playwright.config.js # Playwright browser test configuration
├── .env.example         # Environment template with safe placeholders
└── package.json         # Project manifest
```

---

## Getting Started

### Prerequisites

- **Node.js:** v22.0.0 or higher (tested with Node.js 22 LTS and Node.js 26 Current)
- **npm:** v10.0.0 or higher
- **PostgreSQL:** v15 or higher (accessible locally or via network)

### Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/Ayush-o1/Europa.git
cd Europa
npm install
```

### Database Provisioning

Create dedicated development and test databases in PostgreSQL:

```bash
psql -d postgres -c "CREATE DATABASE europa_dev;"
psql -d postgres -c "CREATE DATABASE europa_test;"
```

### Environment Configuration

Copy the sample environment file:

```bash
cp .env.example .env
```

Review `.env` to verify your local database connection parameters:

```bash
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/europa_dev
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/europa_test
STORAGE_DIR=./storage/snapshots
CORRELATION_STEP_TOLERANCE_MINUTES=20
CORRELATION_MAX_CUMULATIVE_DRIFT_MINUTES=45
```

### Run Migrations & Start Server

Apply all database schema migrations:

```bash
npm run db:migrate
```

Launch the development server:

```bash
# Start in watch mode (restarts on file changes)
npm run dev

# Or start in standard mode
npm start
```

The web interface is available at `http://localhost:3000` and the API is mounted under `http://localhost:3000/api/v1`.

---

## Available Commands

| Command                | Purpose                                                                    |
| :--------------------- | :------------------------------------------------------------------------- |
| `npm start`            | Start the Express server on configured `PORT` (default 3000)               |
| `npm run dev`          | Start the Express server with live reload (`node --watch`)                 |
| `npm test`             | Run all unit and database integration tests via Vitest                     |
| `npm run test:watch`   | Run Vitest in interactive watch mode                                       |
| `npm run test:e2e`     | Run real-browser end-to-end tests via Playwright                           |
| `npm run benchmark`    | Execute reproducible performance benchmarks against isolated test database |
| `npm run db:migrate`   | Execute pending SQL schema migrations with advisory locking                |
| `npm run lint`         | Inspect codebase for syntax and style issues via ESLint                    |
| `npm run lint:fix`     | Automatically resolve fixable ESLint warnings and errors                   |
| `npm run format`       | Format source and test files using Prettier                                |
| `npm run format:check` | Check code formatting without applying modifications                       |

---

## REST API Highlights

All endpoints return uniform JSON envelopes. Write operations require operator authentication via the `X-API-Key` or `Authorization: Bearer <token>` header (default development key: `europa-dev-key`).

### Key Endpoints

| Method | Endpoint                         | Auth      | Description                                                             |
| :----- | :------------------------------- | :-------- | :---------------------------------------------------------------------- |
| `GET`  | `/api/v1/health`                 | Public    | System and database readiness status                                    |
| `POST` | `/api/v1/ingest/snapshots`       | Operator  | Upload and process SOCRATES CSV snapshot                                |
| `GET`  | `/api/v1/ingest/batches`         | Public    | Paginated history of ingested snapshot batches                          |
| `GET`  | `/api/v1/events`                 | Public    | Paginated conjunction event list with multi-field filtering             |
| `GET`  | `/api/v1/events/:id`             | Public    | Conjunction event details, space objects, and latest status             |
| `GET`  | `/api/v1/events/:id/history`     | Public    | Chronological observation history for an encounter                      |
| `GET`  | `/api/v1/events/:id/assessments` | Public    | Full assessment score and explanation history                           |
| `POST` | `/api/v1/events/:id/reviews`     | Operator  | Submit justified review decision (`ACKNOWLEDGE`, `ESCALATE`, `DISMISS`) |
| `GET`  | `/api/v1/events/:id/audit`       | Public    | Paginated audit trail entries for an event                              |
| `GET`  | `/api/v1/audit/verify`           | Public    | Read-only cryptographic verification of the SHA-256 ledger              |
| `POST` | `/api/v1/propagation/estimate`   | Public/Op | Compute SGP4 trajectory, refined TCA, and miss distance from TLEs       |
| `GET`  | `/api/v1/events/:id/propagation` | Public    | Retrieve historical SGP4 screenings associated with an event            |

### cURL Examples

#### 1. Ingest Snapshot

```bash
curl -s -X POST http://localhost:3000/api/v1/ingest/snapshots \
  -H "X-API-Key: europa-dev-key" \
  -F "file=@test/fixtures/socrates_real_sample.csv" \
  -F "screeningScope=FULL_CATALOG_MINRANGE"
```

#### 2. Query High-Urgency Events

```bash
curl -s "http://localhost:3000/api/v1/events?urgency=CRITICAL&sortBy=latest_range_km&sortOrder=ASC&limit=10"
```

#### 3. Submit Justified Operator Review

```bash
curl -s -X POST "http://localhost:3000/api/v1/events/14a0cf7d-2b3f-4e05-9502-861f8a7e6712/reviews" \
  -H "X-API-Key: europa-dev-key" \
  -H "X-Actor-Id: flight-director-1" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "ESCALATE",
    "justification": "Predicted miss distance contracted under 1.0 km within 24 hours of TCA. Escalating for maneuver screening."
  }'
```

#### 4. Cryptographic Audit Chain Verification

```bash
curl -s "http://localhost:3000/api/v1/audit/verify"
```

#### 5. SGP4 Trajectory Screening

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

## Measured Performance Baseline

Benchmarks can be reproduced via `npm run benchmark`. The benchmark harness executes controlled workloads against an isolated PostgreSQL instance (`europa_test`).

### Test Environment

- **Platform:** macOS Darwin (arm64, Apple Silicon)
- **Processor:** Apple M4 (10 cores)
- **Memory:** 16.00 GB RAM
- **Node.js:** v26.12.0
- **Database:** PostgreSQL 18.6 (Homebrew)
- **Target Database:** `europa_test`

### Measured Metrics

| Operation                               | 100 Rows                   | 1,000 Rows                  | 5,000 Rows                  |
| :-------------------------------------- | :------------------------- | :-------------------------- | :-------------------------- |
| **CSV Parsing & Validation**            | 24,478 rows/s (4.09 ms)    | 161,835 rows/s (6.18 ms)    | 187,932 rows/s (26.61 ms)   |
| **Ingestion, Correlation & Assessment** | 447 rows/s (223.73 ms)     | 869 rows/s (1,150.16 ms)    | 1,492 rows/s (3,350.46 ms)  |
| **Successive Snapshot Evolution**       | 100 updates (241.12 ms)    | 500 updates (1,462.52 ms)   | 500 updates (5,624.82 ms)   |
| **Event List API Query (p50 / p95)**    | 2.63 ms / 4.13 ms          | 1.95 ms / 4.91 ms           | 1.90 ms / 2.94 ms           |
| **Event History API Query (p50 / p95)** | 0.81 ms / 1.03 ms          | 0.89 ms / 1.14 ms           | 0.76 ms / 0.98 ms           |
| **Audit Ledger Verification**           | 88,185 entries/s (2.27 ms) | 141,909 entries/s (7.05 ms) | 133,960 entries/s (7.46 ms) |
| **Peak Heap / RSS Memory**              | 28.9 MB / 71.7 MB          | 61.4 MB / 137.6 MB          | 78.1 MB / 169.8 MB          |

### Concurrency Stress Test (3 Workers × 500 Rows)

- **Workload:** 1,500 total rows processed concurrently across 3 parallel worker connections.
- **Aggregate Throughput:** ~575 rows/second.
- **Encounter Integrity:** Exactly 500 distinct conjunction events created (zero duplicates, proving advisory locking correctness).
- **Audit Verification:** 100% valid SHA-256 hash chain with no sequence gaps.

---

## Scientific Caveats & Operational Boundaries

1. **Experimental SGP4 Trajectory Screening:**
   SGP4 propagation is implemented solely as an initial screening and analytical comparison tool. SGP4 models mean orbital elements under low-order gravity harmonics and drag, but does not incorporate full-force numerical integration, solar radiation pressure, atmospheric density variations, or covariance propagation. **SGP4 estimates must not be used as operational collision-avoidance guidance or maneuver decision criteria.**

2. **SOCRATES `MAX_PROB` Interpretation:**
   The `MAX_PROB` value provided in CelesTrak SOCRATES reports represents an upper-bound screening metric computed under idealized spherical collision geometry and worst-case covariance orientation. It is **not** an authoritative or calibrated collision probability ($P_c$). In Europa, this value is utilized solely as an input component to a review-priority ranking heuristic.

3. **Cryptographic Audit Ledger Scope:**
   Europa implements a database-level SHA-256 hash-chained ledger protected by SQL `BEFORE UPDATE OR DELETE` triggers. This mechanism detects data alteration, row deletions, and sequence tampering in standard application and SQL environments. It does not provide Byzantine fault tolerance or prevent out-of-band disk manipulation by privileged database superusers without external, independent ledger anchoring.

---

## Security & Configuration Notes

- **Credentials:** No secrets, credentials, or operational connection strings are hardcoded or tracked in version control.
- **Environment Isolation:** Local configurations are kept in `.env` (ignored by Git). The provided `.env.example` file contains safe, unprivileged localhost placeholders only.
- **API Key Handling:** The analytical web interface manages operator authentication strictly in transient JavaScript application memory. Keys are never saved to `localStorage`, `sessionStorage`, cookies, or browser storage.
- **Database Destructive Protection:** The database cleanup routines explicitly refuse to execute if the target database URL points to a production environment or does not contain `test`.

---

## License

This project is licensed under the [MIT License](package.json).
