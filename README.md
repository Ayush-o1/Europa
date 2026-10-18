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

# Seed reproducible demo dataset (optional for instant exploration)
npm run db:seed
```

### 3. Start the Server

```bash
# Start in development mode (live file watching)
npm run dev

# Or start in standard mode
npm start
```

Access the web interface at `http://localhost:3000` or inspect the API at `http://localhost:3000/api/v1/health`.

### 4. Alternative: Instant Docker Compose Stack

To run Europa and a dedicated PostgreSQL 16 database without installing Node or Postgres locally:

```bash
docker compose up -d --build
```

The stack automatically applies database migrations and starts Europa on `http://localhost:3000`.

For detailed setup, environment variables, and troubleshooting, see [docs/development.md](docs/development.md).

---

## Production Deployment

Europa is engineered to be deployable within minutes using modern PaaS providers or container runtimes.

### Option A: Render PaaS Blueprint (Recommended)

Europa includes a turnkey `render.yaml` Infrastructure-as-Code Blueprint defining the web service, pre-deploy migrations, and managed PostgreSQL 16 database.

1. Fork or push this repository to GitHub.
2. In the [Render Dashboard](https://dashboard.render.com), click **New +** → **Blueprint**.
3. Select your repository. Render automatically provisions the database, injects `DATABASE_URL` with SSL negotiation, generates a secure `OPERATOR_API_KEY`, runs schema migrations, and deploys the web service behind automated HTTPS.

### Option B: Standalone Docker Container

```bash
# Build production image
docker build -t europa:latest .

# Run pre-deploy database migrations
docker run --rm \
  -e NODE_ENV=production \
  -e DATABASE_URL="postgresql://user:password@host:5432/europa" \
  -e OPERATOR_API_KEY="your-secure-production-key-32chars" \
  europa:latest npm run db:migrate

# Start the web service
docker run -d \
  --name europa-web \
  --restart unless-stopped \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e DATABASE_URL="postgresql://user:password@host:5432/europa" \
  -e OPERATOR_API_KEY="your-secure-production-key-32chars" \
  europa:latest
```

For zero-downtime rolling deploys, database backup procedures, secret rotation, and operational checklists, consult the **[Production Deployment Runbook](docs/deployment-runbook.md)** and **[Pre-Launch Verification Checklist](docs/launch-checklist.md)**.

---

## Demo Walkthrough & Visual Evidence

For evaluators and developers inspecting Europa, the application includes a deterministic demo seeder (`npm run db:seed`) and real visual evidence captured directly from the running system.

### Recommended Evaluation Flow

1. **Operational Overview (`#overview`):**
   Examine active encounter totals, the 5.000 km close-approach threshold, urgency tier distribution bars (`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`), and latest snapshot provenance.
2. **Triage Queue (`#events`):**
   Filter encounters by Priority Urgency or sort by miss distance. Inspect the sorted table showing canonical pairs, TCA countdowns, and operational statuses.
3. **Event Detail & Prediction Evolution (`#details/:id`):**
   Select the synthetic tightening encounter (`90001:90002`). Observe the SVG prediction evolution chart displaying miss distance tightening from 4.500 km down to 0.280 km across successive snapshot arrivals, alongside the multi-factor assessment score breakdown (68.00/100 PTS).
4. **Operator Review Workflow:**
   Enter the operator key in the header (`europa-dev-key` in dev), select an action (`ACKNOWLEDGE`, `ESCALATE`, `DISMISS`), submit a required technical justification (minimum 10 characters), and verify that the review decision updates immutably.
5. **Experimental SGP4 Trajectory Screening (`#propagation`):**
   Load standard TLE presets (e.g. ISS vs Cosmos debris) or custom TLE pairs, run orbit propagation with `satellite.js`, and evaluate the encounter range profile chart under explicit experimental warnings.
6. **Snapshot Ingestion (`#ingestion`):**
   Inspect the drag-and-drop CSV upload card, screening scopes (`LOCAL_FIXTURE` vs `FULL_CATALOG_MINRANGE`), and the batch provenance table displaying SHA-256 archive checksums and deduplication logs.
7. **Cryptographic Audit Ledger (`#audit`):**
   Click **"Run Cryptographic Verification"** to execute client-triggered verification of the entire SHA-256 hash chain from genesis to head across all ledger records.

### Visual Evidence Gallery

Genuine high-resolution screenshots captured directly from the running web application via Playwright are persisted in `artifacts/phase-4/screenshots/`:

| Screenshot                                                                                               | Description                                                                 |      Viewport      |
| :------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------- | :----------------: |
| [**01_dashboard_overview.png**](artifacts/phase-4/screenshots/01_dashboard_overview.png)                 | Operational overview with KPI cards, urgency breakdown, and telemetry strip | Desktop (1440x900) |
| [**02_triage_queue.png**](artifacts/phase-4/screenshots/02_triage_queue.png)                             | Conjunction triage queue filtered by urgency and sorted by miss distance    | Desktop (1440x900) |
| [**03_event_detail_and_evolution.png**](artifacts/phase-4/screenshots/03_event_detail_and_evolution.png) | Event investigation, SVG range evolution chart, and review breakdown        | Desktop (1440x900) |
| [**04_sgp4_orbital_screening.png**](artifacts/phase-4/screenshots/04_sgp4_orbital_screening.png)         | Experimental SGP4 orbital screening workbench and encounter range profile   | Desktop (1440x900) |
| [**05_ingestion_and_provenance.png**](artifacts/phase-4/screenshots/05_ingestion_and_provenance.png)     | SOCRATES snapshot upload dropzone and completed batch provenance table      | Desktop (1440x900) |
| [**06_audit_ledger_verification.png**](artifacts/phase-4/screenshots/06_audit_ledger_verification.png)   | Cryptographic hash chain verification status (`CHAIN INTACT`, 17 records)   | Desktop (1440x900) |
| [**07_mobile_dashboard.png**](artifacts/phase-4/screenshots/07_mobile_dashboard.png)                     | Responsive mobile overview dashboard and compact KPI cards                  |  Mobile (375x812)  |
| [**08_mobile_event_detail.png**](artifacts/phase-4/screenshots/08_mobile_event_detail.png)               | Responsive mobile event detail, observation timeline, and audit history     |  Mobile (375x812)  |

---

## Available Commands

| Command                | Purpose                                                                 |
| :--------------------- | :---------------------------------------------------------------------- |
| `npm start`            | Launch the Express server on configured `PORT` (default 3000)           |
| `npm run dev`          | Launch server in watch mode with automatic reload (`node --watch`)      |
| `npm test`             | Run Vitest unit and integration suites against `europa_test`            |
| `npm run test:watch`   | Run Vitest in interactive watch mode                                    |
| `npm run test:e2e`     | Execute Playwright real-browser end-to-end tests                        |
| `npm run benchmark`    | Run reproducible performance benchmark against `europa_test`            |
| `npm run db:migrate`   | Apply pending SQL schema migrations with advisory locking               |
| `npm run db:seed`      | Seed deterministic demo fixtures into development database (idempotent) |
| `npm run lint`         | Inspect code with ESLint 10                                             |
| `npm run lint:fix`     | Automatically resolve fixable ESLint issues                             |
| `npm run format:check` | Verify formatting across the codebase with Prettier 3                   |
| `npm run format`       | Apply Prettier formatting across the codebase                           |

---

## Documentation Index

- **[System Architecture](docs/architecture.md):** Data pipelines, advisory locking, heuristic matching policy, assessment rules, and cryptographic audit hash chain.
- **[Development & Operations Guide](docs/development.md):** Complete setup, database isolation guards, environment reference, test runners, and troubleshooting.
- **[REST API Reference](docs/api.md):** Specifications, authentication rules, parameters, payloads, response envelopes, and cURL examples for all endpoints.
- **[Production Deployment Runbook](docs/deployment-runbook.md):** Production architecture topologies (Render Blueprint, Docker), environment variables, backup/restore, secret rotation, and rollback procedures.
- **[Pre-Launch Verification Checklist](docs/launch-checklist.md):** Comprehensive pre-launch operational, security, and database sign-off checklist.
- **[Data Provenance & Scientific Limitations](docs/data-and-limitations.md):** CelesTrak SOCRATES provenance, meaning of priority scores, why Europa does not compute uncalibrated $P_c$, SGP4 astrodynamic assumptions, and non-operational software disclaimer.

---

## Release Notes — v0.1.0 (Public Launch Preparation)

Europa v0.1.0 represents the complete, hardened analytical Space Situational Awareness platform ready for deployment and evaluation:

- **Phase 1 (Documentation & Product Definition):** Comprehensive architecture specifications, API references, mathematical scoring formulations, and scientific boundary definitions.
- **Phase 2 (Frontend Redesign & UX Engineering):** Modern, accessible, dark-mode analytical workbench with responsive KPI cards, interactive SVG trajectory evolution charts, and high-resolution visual evidence.
- **Phase 3 (Backend Reliability & Security Hardening):** Strict input sanitization, timing-safe authentication, PostgreSQL composite indexing (`006_backend_reliability_indexes.sql`), managed transaction helpers (`withTransaction`), defense-in-depth security headers, and fail-closed production configuration.
- **Phase 4 (Testing & Reproducible Demonstration):** Deterministic multi-snapshot fixture seeder (`npm run db:seed`), 17 Vitest test suites (161 automated tests), Playwright real-browser E2E workflows, and benchmark harness measuring up to 2,741 rows/sec ingestion throughput.
- **Phase 5 (Launch & Production Readiness):** Turnkey Render Infrastructure-as-Code Blueprint (`render.yaml`), multi-stage production container (`Dockerfile`), self-hosted stack (`docker-compose.yml`), hosted PostgreSQL SSL negotiation, public read-only demo boundary, production operations runbook (`docs/deployment-runbook.md`), and pre-launch verification checklist (`docs/launch-checklist.md`).

---

## Important Scientific Limitations

1. **Non-Operational Software Disclaimer:** Europa is an SSA analytical workbench and research tool. It is **not** a certified operational collision-avoidance system. Outputs must not be used for commanding satellite maneuvers or making flight-safety decisions.
2. **`MAX_PROB` is a Screening Metric:** The `MAX_PROB` value in SOCRATES reports represents an upper-bound screening metric under worst-case covariance orientation. It is **not** an authoritative or calibrated collision probability ($P_c$).
3. **Absence of Covariance:** Public Two-Line Elements do not include error covariance matrices. Computing physically calibrated collision probabilities without covariance is mathematically unfeasible.
4. **Experimental SGP4 Trajectory Screening:** SGP4 models mean orbital elements under low-order gravity and drag. It does not account for high-order geopotential, solar radiation pressure, atmospheric density fluctuations, or maneuvers. In Low Earth Orbit, TLE positional uncertainty degrades by 1–3 km per day.
5. **Local Audit Ledger Scope:** The SHA-256 hash-chained audit ledger protects against SQL tampering and application-level data mutation via database triggers. It does not provide distributed Byzantine fault tolerance against raw disk alteration by database superusers without external anchoring.

For full astrodynamic and scientific documentation, consult [docs/data-and-limitations.md](docs/data-and-limitations.md).

---

## Contributing & Development

Contributions to Europa are welcome! To contribute:

1. Fork the repository and create a feature branch (`git checkout -b feat/your-feature`).
2. Adhere to code style guidelines: verify with `npm run lint` and `npm run format:check`.
3. Ensure all tests pass: `npm test` and `npm run test:e2e`.
4. Submit a Pull Request with a clear description of changes.

---

## License

This project is licensed under the [MIT License](LICENSE).
