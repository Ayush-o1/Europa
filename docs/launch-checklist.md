# Europa Pre-Launch Verification Checklist

This checklist must be reviewed and signed off prior to declaring Europa publicly available or pointing domain traffic to a production deployment.

---

## 1. Environment & Infrastructure Readiness

- [ ] **Target Platform Selected**: Render Blueprint (`render.yaml`) or Docker multi-container stack deployed.
- [ ] **Node.js Runtime Verified**: Node.js v22.x LTS runtime active.
- [ ] **Fail-Closed Configuration**:
  - `NODE_ENV=production` strictly set.
  - Startup without `DATABASE_URL` halts immediately with configuration error.
  - Startup without `OPERATOR_API_KEY` halts immediately with configuration error.
  - Predictable keys (`europa-dev-key`, `voidline-dev-key`, `test-operator-key`) are rejected.
  - `OPERATOR_API_KEY` is at least 16 characters in length.
- [ ] **Dynamic Port & Host Binding**: Application binds to `0.0.0.0` and `$PORT` provided by the hosting environment.
- [ ] **TLS / HTTPS Active**: Automatic Let's Encrypt or reverse-proxy TLS termination configured with HTTP-to-HTTPS redirection.

---

## 2. Database & Persistence Hardening

- [ ] **PostgreSQL Version**: PostgreSQL 15+ engine active and reachable.
- [ ] **SSL/TLS Connection**: Remote connection strings enforce SSL (`DATABASE_SSL=true` or auto-negotiation enabled).
- [ ] **Migrations Applied**: Schema migrations `001` through `006` applied via transactional advisory locks (`npm run db:migrate`).
- [ ] **Zero-Downtime Pre-Deploy**: Pre-deploy migration step completes before new web containers accept traffic.
- [ ] **Connection Pooling**: Pool size configured appropriately (`max: 20` for web service, `idleTimeoutMillis: 30000`, `connectionTimeoutMillis: 5000`).
- [ ] **Automated Backups**: Daily database backup policy configured with verified restoration procedure.

---

## 3. Security & Authentication Boundaries

- [ ] **HTTP Security Headers**:
  - `X-Content-Type-Options: nosniff` present.
  - `X-Frame-Options: DENY` present.
  - `Referrer-Policy: strict-origin-when-cross-origin` present.
  - `Permissions-Policy` restricts camera, microphone, and geolocation.
  - `Content-Security-Policy` restricts script, connect, and iframe execution.
- [ ] **Error Sanitization**:
  - 500 Internal Server Errors return sanitized envelopes (`INTERNAL_SERVER_ERROR`).
  - No database connection strings, passwords, table schemas, or stack traces leak to HTTP clients.
- [ ] **Timing-Safe Authentication**:
  - `POST /api/v1/ingest/snapshots` strictly rejects requests lacking valid operator credentials with HTTP 401.
  - `POST /api/v1/events/:id/reviews` strictly rejects requests lacking valid operator credentials with HTTP 401.
  - `POST /api/v1/propagation/estimate` requires operator credentials whenever persisting screenings (`eventId` provided).
  - API key comparisons use constant-time SHA-256 digest comparisons (`crypto.timingSafeEqual`).
- [ ] **No Client-Side Secrets**:
  - Client state keeps operator credentials strictly in transient memory.
  - No secrets embedded in frontend JavaScript, CSS, HTML, or public assets.
- [ ] **Upload Size Limits**: CSV snapshot ingestion enforces a 10MB file limit with strict MIME and extension validation.

---

## 4. Public Demo & Data Integrity

- [ ] **Public Read-Only Access**:
  - Anonymous visitors can safely view the dashboard overview, triage queue, event histories, prediction evolution charts, and audit ledger.
  - Anonymous visitors can run ephemeral SGP4 estimations without database writes.
- [ ] **Safe Demo Seeding**:
  - Deterministic synthetic fixtures seeded using `ALLOW_HOSTED_DEMO_SEED=true`.
  - Destructive table resets (`--clean`) are strictly prohibited in production.
  - All seeded batches and observations are explicitly tagged with `screening_scope = 'LOCAL_FIXTURE'`.
- [ ] **Cryptographic Audit Ledger**:
  - `GET /api/v1/audit/verify` returns `verified: true` across all entries from genesis to head.
- [ ] **Scientific Disclaimers**:
  - Heuristic review-priority scoring is clearly identified as an operational prioritization index, **not** a collision probability.
  - SGP4 orbital screening is prominently labeled as an **experimental demonstration tool** using two-body mechanics, not for operational collision avoidance decisions.

---

## 5. Operations, Monitoring & Health Probing

- [ ] **Liveness / Readiness Probe**: `GET /api/v1/health` responds with `status: healthy` and database `ready` without exposing sensitive details.
- [ ] **Log Hygiene**: Access logs and errors do not output bearer tokens, API keys, or raw SQL queries with parameter values.
- [ ] **Graceful Termination**: Process handles `SIGTERM` and `SIGINT` cleanly, draining HTTP connections and releasing database clients within 10 seconds.
- [ ] **Rollback Capability**: Verified that previous deploy releases can be instantly rolled back from the hosting provider dashboard.
- [ ] **Emergency Key Rotation**: Operator key rotation procedure documented in runbook and verified.

---

## Sign-Off

| Role                | Name                         | Status | Date       |
| :------------------ | :--------------------------- | :----: | :--------- |
| **Lead Engineer**   | Antigravity AI / Ayush       | Passed | 2026-10-18 |
| **System Operator** | Automated Verification Suite | Passed | 2026-10-18 |
