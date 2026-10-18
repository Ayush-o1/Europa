# Europa Development & Operations Guide

This guide provides reliable, verified instructions for setting up, developing, testing, and operating the Europa platform from a fresh clone.

---

## 1. System Requirements

Ensure the host environment meets the following minimum requirements:

- **Node.js:** v22.0.0 LTS or higher (tested with Node.js 22 LTS and Node.js 26 Current)
- **npm:** v10.0.0 or higher
- **PostgreSQL:** v15.0 or higher (accessible locally or via network)
- **Operating System:** Linux, macOS (Apple Silicon or Intel), or Windows (WSL2 recommended)

Verify installed versions:

```bash
node --version  # Must be >= v22.0.0
npm --version   # Must be >= v10.0.0
psql --version  # Must be >= 15.0
```

---

## 2. Quick Setup from a Fresh Clone

### 2.1 Clone Repository & Install Dependencies

```bash
git clone https://github.com/Ayush-o1/Europa.git
cd Europa
npm install
```

For continuous integration or strictly reproducible builds, use:

```bash
npm ci
```

### 2.2 Provision PostgreSQL Databases

Europa enforces strict database isolation between development and testing environments. Create two separate databases:

```bash
# Connect as postgres superuser (adjust user/host if necessary)
psql -U postgres -c "CREATE DATABASE europa_dev;"
psql -U postgres -c "CREATE DATABASE europa_test;"
```

> [!IMPORTANT]
> Never point `TEST_DATABASE_URL` at `europa_dev` or any production database. The automated test suite executes destructive data resets before and after test suites.

### 2.3 Configure Environment Variables

Create a local `.env` file from the provided template:

```bash
cp .env.example .env
```

Edit `.env` to match your local PostgreSQL configuration:

```bash
# Server Configuration
PORT=3000
HOST=0.0.0.0
NODE_ENV=development
LOG_LEVEL=info

# Database Configuration (PostgreSQL 15+)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/europa_dev
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/europa_test

# Local Snapshot Archive Directory
STORAGE_DIR=./storage/snapshots

# Correlation Engine Heuristics (Minutes)
CORRELATION_STEP_TOLERANCE_MINUTES=20
CORRELATION_MAX_CUMULATIVE_DRIFT_MINUTES=45

# Operator Authentication (Optional in dev; defaults to europa-dev-key)
OPERATOR_API_KEY=europa-dev-key
```

### 2.4 Apply Database Schema Migrations

Run the transactional migration runner to apply all pending SQL schemas:

```bash
npm run db:migrate
```

This applies migrations from `src/db/migrations/` sequentially (`001_phase1_initial_schema.sql` through `006_backend_reliability_indexes.sql`) under PostgreSQL advisory locks.

### 2.5 Populate Deterministic Demo Data

To immediately explore Europa with populated conjunctions, prediction evolution charts, operator reviews, and audit trails:

```bash
npm run db:seed
```

The seeder is:

- **Deterministic & Idempotent:** Runs three repeatable snapshots (synthetic baseline, synthetic tightening update, and a real public SOCRATES sample) under `LOCAL_FIXTURE` screening scope. Running `npm run db:seed` repeatedly detects existing batches and skips mutations without creating duplicates or breaking the audit chain.
- **Production-Guarded:** Fails closed immediately if `NODE_ENV=production` or if the database URL points to a production database.
- **Safe Reset:** To reset the demo tables on local development or test databases, run:
  ```bash
  npm run db:seed -- --clean
  ```

### 2.6 Start the Application

```bash
# Development mode with automatic file reloading
npm run dev

# Or standard production start
npm start
```

Once running:

- **Web Workbench:** Visit `http://localhost:3000` in any modern web browser.
- **REST API:** Endpoints are mounted at `http://localhost:3000/api/v1`.
- **Health Check:** Test system and database readiness via `curl http://localhost:3000/api/v1/health`.

---

## 3. Environment Variables Reference

| Variable                                   | Default Value                                       | Description                                                                                                | Required |
| :----------------------------------------- | :-------------------------------------------------- | :--------------------------------------------------------------------------------------------------------- | :------: |
| `PORT`                                     | `3000`                                              | HTTP listening port for the Express application.                                                           |    No    |
| `HOST`                                     | `0.0.0.0`                                           | Network interface binding host.                                                                            |    No    |
| `NODE_ENV`                                 | `development`                                       | Runtime environment mode (`development`, `test`, `production`).                                            |    No    |
| `LOG_LEVEL`                                | `info`                                              | Logging verbosity (`debug`, `info`, `warn`, `error`).                                                      |    No    |
| `DATABASE_URL`                             | `postgresql://<user>@localhost:5432/europa_dev`     | Connection string for PostgreSQL database. Strictly required in production without fallback.               | In prod  |
| `TEST_DATABASE_URL`                        | `postgresql://<user>@localhost:5432/europa_test`    | Dedicated connection string for automated test suites.                                                     | In tests |
| `STORAGE_DIR`                              | `./storage/snapshots`                               | Filesystem directory where raw uploaded snapshots are archived.                                            |    No    |
| `CORRELATION_STEP_TOLERANCE_MINUTES`       | `20`                                                | Maximum TCA difference between consecutive observations to correlate into the same encounter event.        |    No    |
| `CORRELATION_MAX_CUMULATIVE_DRIFT_MINUTES` | `45`                                                | Maximum allowable TCA drift between any observation and the event's initial TCA.                           |    No    |
| `OPERATOR_API_KEY`                         | `europa-dev-key` (dev) / `test-operator-key` (test) | Pre-shared key for write operations (snapshot ingestion, reviews). Strictly required in prod (>=16 chars). | In prod  |

---

## 4. Database Isolation & Safety Guards

Europa incorporates security guards (`test/helpers/dbCleanup.js`) to protect non-test databases:

```javascript
assertSafeTestEnvironment(connectionString);
```

The guard verifies:

1. `NODE_ENV` must not be `production`.
2. The connection string must not contain `prod`.
3. The connection string must contain `test` (unless explicitly overridden via `ALLOW_DEV_RESET=true`).

If any destructive helper (`resetTestDatabase()`) is called against an unsafe database, execution aborts with a fatal exception:

```text
[Security Guard] Database cleanup aborted: Target database URL does not contain 'test'.
```

---

## 5. Testing & Quality Verification

All commands can be executed from the project root:

| Command                | Suite / Task                     | Target Environment                                    |
| :--------------------- | :------------------------------- | :---------------------------------------------------- |
| `npm test`             | Vitest Unit & Integration Suites | Runs against `europa_test`                            |
| `npm run test:watch`   | Vitest Interactive Watch Mode    | Runs against `europa_test`                            |
| `npm run test:e2e`     | Playwright Browser E2E Workflows | Spawns test server on port 3099 against `europa_test` |
| `npm run benchmark`    | Performance & Stress Benchmark   | Controlled workloads against `europa_test`            |
| `npm run db:migrate`   | Apply SQL Schema Migrations      | Applies migrations to `europa_dev` or `europa_test`   |
| `npm run db:seed`      | Seed Deterministic Demo Data     | Safe, idempotent fixture seeder for `europa_dev`      |
| `npm run lint`         | ESLint 10 Static Analysis        | Source and test files                                 |
| `npm run lint:fix`     | ESLint Automated Fixes           | Safe lint autofixes                                   |
| `npm run format:check` | Prettier 3 Style Verification    | Checks formatting across repository                   |
| `npm run format`       | Prettier 3 Formatting            | Applies code formatting                               |

### Running Browser E2E Tests (Playwright)

To execute end-to-end browser tests, install Playwright's Chromium browser binary:

```bash
npx playwright install --with-deps chromium
npm run test:e2e
```

The Playwright test runner boots an isolated Express instance on port `3099`, resets `europa_test`, and executes real browser scenarios covering installation, ingestion, event investigation, operator reviews, and audit verification.

### Running Performance Benchmarks

The benchmark suite measures throughput, latency, memory utilization, and concurrency across 100, 1,000, and 5,000 synthetic rows:

```bash
npm run benchmark
```

Benchmark results and JSON metrics summaries are output to the console and written to `benchmarks/results/`.

---

## 6. Common Troubleshooting

### 1. `role "runner" does not exist` or `role "<user>" does not exist`

- **Cause:** PostgreSQL authentication failed because the system username was used as a fallback.
- **Fix:** Ensure `PGUSER=postgres` or configure `DATABASE_URL` and `TEST_DATABASE_URL` explicitly with user and password (e.g., `postgresql://postgres:password@localhost:5432/europa_dev`).

### 2. `ECONNREFUSED 127.0.0.1:5432`

- **Cause:** PostgreSQL service is not running or not listening on port 5432.
- **Fix:** Start PostgreSQL (`brew services start postgresql@16` on macOS, `sudo systemctl start postgresql` on Linux) and verify connectivity via `psql -U postgres -h localhost`.

### 3. `EADDRINUSE: address already in use :::3000`

- **Cause:** Another process is already running on port 3000.
- **Fix:** Specify a different port via `PORT=3001 npm start` or terminate the existing process using `lsof -i :3000` followed by `kill <PID>`.

### 4. `Playwright executable doesn't exist`

- **Cause:** Chromium browser binary is not downloaded.
- **Fix:** Run `npx playwright install --with-deps chromium`.

### 5. `Database cleanup aborted: Target database URL does not contain 'test'`

- **Cause:** A test or test script was executed with `DATABASE_URL` pointing to `europa_dev` or an unlabelled database.
- **Fix:** Ensure `NODE_ENV=test` and `TEST_DATABASE_URL` points to a database name containing `test` (e.g., `europa_test`).

---

## 7. Containerized Development & Production Operations

### Zero-Configuration Docker Compose

To run Europa and an isolated PostgreSQL 16 database without configuring local software:

```bash
# Build and run the multi-container stack in the background
docker compose up -d --build

# Inspect running container logs
docker compose logs -f app

# Tear down the stack and preserve persistent database volumes
docker compose down
```

The application automatically applies schema migrations and starts on `http://localhost:3000`.

### Production Deployment & Runbook

For production hosting, secrets rotation, managed backups, and disaster recovery:

- Consult the **[Production Deployment Runbook](deployment-runbook.md)** for detailed Render PaaS, Docker, and Linux deployment topologies.
- Review the **[Pre-Launch Verification Checklist](launch-checklist.md)** prior to directing production traffic.
