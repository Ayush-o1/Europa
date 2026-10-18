# Voidline

> Satellite close-approach correlation, prediction evolution tracking, and auditable review platform.

Voidline is an analytical software platform and backend engineering demonstration inspired by Space Situational Awareness (SSA) workflows. It ingests repeated public satellite close-approach predictions (such as CelesTrak SOCRATES), correlates observations into discrete encounter events over time, preserves the history of changing predictions, calculates transparent review priorities, and provides an auditable operational review workflow.

---

## Technical Stack & Architecture

- **Runtime:** Node.js (Recommended: Node.js 24 LTS; supported minimum: Node.js 22 LTS; active development environment: Node.js 26 Current)
- **Module System:** ECMAScript Modules (ESM)
- **Backend Framework:** Express.js (Modular Monolith)
- **Database:** PostgreSQL 15+ (Relational integrity, transactional advisory locks, strictly isolated transactions)
- **Testing:** Vitest
- **Code Quality:** ESLint (Flat Config v10+), Prettier

---

## Project Structure

```text
Voidline/
├── src/
│   ├── config/          # Environment configuration & validation
│   ├── db/              # PostgreSQL pool, transactional migrator & schema SQL
│   │   ├── migrations/  # Incremental pure SQL migrations (001, 002, 003, 004)
│   │   ├── migrator.js  # Transactional migration runner with advisory locking
│   │   └── pool.js      # Connection pool & query helpers
│   ├── modules/         # Domain modules
│   │   ├── ingestion/   # SOCRATES CSV parser, validator & ingestion service
│   │   ├── correlation/ # Event correlation service & matching heuristics
│   │   ├── assessment/  # Review-priority assessment engine & versioned rules
│   │   ├── review/      # Operator review actions & justification tracking
│   │   ├── audit/       # Cryptographic hash-chained audit ledger
│   │   └── lifecycle/   # Event lifecycle state transitions (e.g., PAST_TCA)
│   └── utils/           # Shared utility functions
├── scripts/             # Operational & developer CLI tools (migrate, replay, audit)
├── storage/
│   └── snapshots/       # Immutable local raw snapshot archive
├── test/
│   ├── fixtures/        # Sample scenario CSV datasets (real, malformed)
│   ├── unit/            # Unit tests for domain logic, parser, rules & audit ledger
│   └── integration/     # Database ingestion, correlation, assessment & review tests
├── public/              # Static frontend assets (HTML, CSS, vanilla JS)
├── eslint.config.js     # ESLint flat configuration
├── vitest.config.js     # Vitest test runner configuration
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

---

## Available Commands

| Command                | Purpose                                                                    |
| :--------------------- | :------------------------------------------------------------------------- |
| `npm test`             | Run the automated test suite once via Vitest (unit & database integration) |
| `npm run test:watch`   | Run Vitest in interactive watch mode                                       |
| `npm run db:migrate`   | Apply all pending transactional SQL migrations                             |
| `npm run lint`         | Check code for style and syntax errors via ESLint                          |
| `npm run lint:fix`     | Automatically fix ESLint warnings and errors                               |
| `npm run format`       | Format all source and test files using Prettier                            |
| `npm run format:check` | Verify formatting consistency without writing changes                      |

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
- **Phase 5 (REST API & Operational Queries):** Pending explicit authorization.
