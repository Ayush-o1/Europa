# Europa

> Analytical space situational awareness (SSA) workbench for satellite close-approach data, encounter correlation, prediction evolution tracking, and auditable operational reviews.

Europa ingests successive public satellite close-approach predictions (such as CelesTrak SOCRATES), correlates observations into persistent encounter events over time, tracks prediction evolution, computes explainable review priorities, provides an auditable operational review workflow, and supports experimental SGP4 orbital trajectory screening.

---

## The Problem Europa Addresses

Space operations teams receive hundreds of conjunction alerts daily. However, public close-approach reports present significant operational challenges:

- **Snapshot Isolation:** Reports are published as periodic point-in-time snapshots. Upstream providers do not automatically track how a specific conjunction's predicted miss distance or Time of Closest Approach (TCA) evolves across successive updates.
- **Arbitrary Object Ordering:** A pair of satellites may appear as `Object A vs Object B` in one update and `Object B vs Object A` in the next.
- **Triage Complexity:** Raw reports contain thousands of rows, making it difficult to prioritize events that are rapidly contracting in miss distance versus those that are stable or diverging.
- **Audit Deficits:** Operational review actions (acknowledgments, escalations, dismissals) and justification rationales are frequently untracked or stored in unverified spreadsheets without cryptographic integrity guarantees.

Europa solves these challenges by providing automated canonical pair keying, heuristic trajectory window correlation, explainable multi-factor scoring, an append-only SHA-256 cryptographic audit ledger, and an integrated analytical workbench.

---

## System Architecture & Data Flow

Europa is built as a modular Node.js monolith with an isolated PostgreSQL relational persistence layer and a zero-dependency vanilla web workbench.

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
│ • Adaptive Window Matching (Step & Drift Tolerances)        │
│ • Ambiguity Detection & Out-of-Order Backfill Safety        │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Assessment Engine & State Evaluation                        │
│ • Explainable 0–100 Multi-Factor Scoring                    │
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
│ • Automated Re-Review Triggers on Material Shifts           │
└──────────────────────────────┬──────────────────────────────┘
                               │
                ┌──────────────┴───────────────┐
                ▼                               ▼
┌─────────────────────────────┐ ┌─────────────────────────────┐
│ Express REST API (/api/v1)  │ │ Analytical Web Workbench    │
│ • Strict Input Validation   │ │ • Real-Time KPI Cards       │
│ • Operator Auth (API Key)   │ │ • Filtering & Triage Queue  │
│ • Sanitized Error Handling  │ │ • SVG Trajectory Evolution  │
│ • Read-Only Chain Verifier  │ │ • SGP4 Trajectory Screening │
└─────────────────────────────┘ └─────────────────────────────┘
```

For complete architectural details, see [docs/architecture.md](docs/architecture.md).

---

## Core Implemented Capabilities

- **Streaming Ingestion & Provenance:** Memory-bounded CSV parsing supporting 6-digit NORAD numbers and scientific notation. Computes SHA-256 snapshot checksums for idempotency and stores unaltered raw observations.
- **Event Correlation Engine:** Groups conjunction pairs using canonical pair keying (`min(id1, id2) : max(id1, id2)`) and serializes concurrent streams with two-key PostgreSQL transaction advisory locks (`pg_advisory_xact_lock`). Uses adaptive step (20 min) and cumulative drift (45 min) tolerances to handle prediction evolution, out-of-order backfills, and ambiguity detection.
- **Review-Priority Assessment:** Computes an explainable 0–100 score evaluating miss distance (50%), time to TCA (30%), upper-bound screening metric (15%), and orbit data freshness (5%), mapping to deterministic urgency tiers (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`).
- **Operational Reviews & Cryptographic Audit:** Tracks operator actions (`ACKNOWLEDGE`, `ESCALATE`, `DISMISS`, `REQUEST_REASSESSMENT`) with mandatory justification. Automatically triggers `REQUIRES_RE_REVIEW` on material prediction contractions ($\ge 20\%$). Maintains a SHA-256 hash-chained audit ledger protected against SQL updates and deletions by database triggers.
- **Experimental SGP4 Trajectory Screening:** Propagates NORAD Two-Line Element sets via `satellite.js` across coarse and fine (100 ms) resolution windows to refine TCA, miss distance, and relative velocity.
- **Analytical Web Interface:** Zero-framework, responsive workbench built with semantic HTML5, CSS design tokens, and vanilla ES modules. Features live triage queues, chronological timelines, SVG range evolution charts, and transient in-memory operator authentication.

---

## Technology Stack

| Component           | Technology                    | Description                                                        |
| :------------------ | :---------------------------- | :----------------------------------------------------------------- |
| **Runtime**         | Node.js (≥22.0.0 LTS)         | Server-side ECMAScript Modules (ESM)                               |
| **Framework**       | Express.js 5                  | Modular HTTP API and static workbench hosting                      |
| **Database**        | PostgreSQL (≥15)              | Relational persistence, transactional migrations, advisory locking |
| **Database Client** | `pg` (node-postgres)          | Pooled PostgreSQL connection interface                             |
| **Astrodynamics**   | `satellite.js` 7.1.0          | Pure JavaScript SGP4/SDP4 satellite orbit propagation              |
| **Testing**         | Vitest, Supertest, Playwright | Unit, database integration, and real-browser E2E testing           |
| **Code Quality**    | ESLint 10, Prettier 3         | Flat-configuration linting and code formatting                     |

---

## Repository Structure

```text
Europa/
├── docs/                # Comprehensive technical documentation
│   ├── architecture.md  # System architecture, data flow, and domain models
│   ├── development.md   # Setup, environment configuration, testing, and operations
│   ├── api.md           # Complete REST API reference and endpoint examples
│   └── data-and-limitations.md # Data provenance, astrodynamics, and scientific boundaries
├── public/              # Analytical web workbench (HTML5, CSS tokens, vanilla JS)
├── scripts/             # Operational CLI tools (migration runner, benchmark harness)
├── src/
│   ├── api/             # Express routers, authentication, and validation middlewares
│   ├── config/          # Environment configuration loader with safe fallbacks
│   ├── db/              # PostgreSQL pool, transactional migration runner, and SQL schemas
│   ├── modules/         # Core domain engines (ingestion, correlation, assessment, audit, SGP4)
│   ├── app.js           # Express application factory
│   └── index.js         # HTTP server entrypoint and graceful shutdown handler
├── storage/             # Local snapshot archive directory
├── test/
│   ├── fixtures/        # Sample datasets (real SOCRATES, synthetic scenarios, malformed CSVs)
│   ├── helpers/         # Safe test database cleanup and isolation helpers
│   ├── unit/            # Unit tests for domain modules and mathematical utilities
│   ├── integration/     # Database integration, concurrency, and REST API tests
│   └── e2e/             # Playwright real-browser end-to-end test scenarios
├── .env.example         # Environment template with safe placeholders
├── LICENSE              # MIT License
└── package.json         # Project manifest and npm scripts
```

---

## Quick Start

### 1. Prerequisites

- **Node.js:** v22.0.0 LTS or higher
- **PostgreSQL:** v15.0 or higher
- **npm:** v10.0.0 or higher

### 2. Installation & Database Setup

```bash
# Clone the repository
git clone https://github.com/Ayush-o1/Europa.git
cd Europa

# Install dependencies
npm install

# Create separate development and test databases in PostgreSQL
psql -U postgres -c "CREATE DATABASE europa_dev;"
psql -U postgres -c "CREATE DATABASE europa_test;"

# Configure environment variables
cp .env.example .env

# Apply database schema migrations
npm run db:migrate
```

### 3. Start the Server

```bash
# Start in development mode (live file watching)
npm run dev

# Or start in standard mode
npm start
```

Access the web interface at `http://localhost:3000` or inspect the API at `http://localhost:3000/api/v1/health`.

For detailed setup, environment variables, and troubleshooting, see [docs/development.md](docs/development.md).

---

## Available Commands

| Command                | Purpose                                                            |
| :--------------------- | :----------------------------------------------------------------- |
| `npm start`            | Launch the Express server on configured `PORT` (default 3000)      |
| `npm run dev`          | Launch server in watch mode with automatic reload (`node --watch`) |
| `npm test`             | Run Vitest unit and integration suites against `europa_test`       |
| `npm run test:watch`   | Run Vitest in interactive watch mode                               |
| `npm run test:e2e`     | Execute Playwright real-browser end-to-end tests                   |
| `npm run benchmark`    | Run reproducible performance benchmark against `europa_test`       |
| `npm run db:migrate`   | Apply pending SQL schema migrations with advisory locking          |
| `npm run lint`         | Inspect code with ESLint 10                                        |
| `npm run lint:fix`     | Automatically resolve fixable ESLint issues                        |
| `npm run format:check` | Verify formatting across the codebase with Prettier 3              |
| `npm run format`       | Apply Prettier formatting across the codebase                      |

---

## Documentation Index

- **[System Architecture](docs/architecture.md):** Data pipelines, advisory locking, heuristic matching policy, assessment rules, and cryptographic audit hash chain.
- **[Development & Operations Guide](docs/development.md):** Complete setup, database isolation guards, environment reference, test runners, and troubleshooting.
- **[REST API Reference](docs/api.md):** Specifications, authentication rules, parameters, payloads, response envelopes, and cURL examples for all endpoints.
- **[Data Provenance & Scientific Limitations](docs/data-and-limitations.md):** CelesTrak SOCRATES provenance, meaning of priority scores, why Europa does not compute uncalibrated $P_c$, SGP4 astrodynamic assumptions, and non-operational software disclaimer.

---

## Important Scientific Limitations

1. **Non-Operational Software Disclaimer:** Europa is an SSA analytical workbench and research tool. It is **not** a certified operational collision-avoidance system. Outputs must not be used for commanding satellite maneuvers or making flight-safety decisions.
2. **`MAX_PROB` is a Screening Metric:** The `MAX_PROB` value in SOCRATES reports represents an upper-bound screening metric under worst-case covariance orientation. It is **not** an authoritative or calibrated collision probability ($P_c$).
3. **Absence of Covariance:** Public Two-Line Elements do not include error covariance matrices. Computing physically calibrated collision probabilities without covariance is mathematically unfeasible.
4. **Experimental SGP4 Trajectory Screening:** SGP4 models mean orbital elements under low-order gravity and drag. It does not account for high-order geopotential, solar radiation pressure, atmospheric density fluctuations, or maneuvers. In Low Earth Orbit, TLE positional uncertainty degrades by 1–3 km per day.
5. **Local Audit Ledger Scope:** The SHA-256 hash-chained audit ledger protects against SQL tampering and application-level data mutation via database triggers. It does not provide distributed Byzantine fault tolerance against raw disk alteration by database superusers without external anchoring.

For full astrodynamic and scientific documentation, consult [docs/data-and-limitations.md](docs/data-and-limitations.md).

---

## License

This project is licensed under the [MIT License](LICENSE).
