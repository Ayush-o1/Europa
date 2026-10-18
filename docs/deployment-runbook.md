# Europa Production Deployment Runbook

This runbook provides step-by-step operational procedures for deploying, configuring, monitoring, maintaining, and decommissioning the Europa Space Situational Awareness (SSA) platform in production.

---

## 1. System Architecture & Deployment Topologies

Europa is a self-contained analytical web application consisting of:

1. **Node.js 22 LTS Application Server**: Express API and static HTML5/CSS3/ES-Module client workbench.
2. **PostgreSQL 15+ Database Engine**: Relational storage for conjunction events, observations, assessments, audit ledger, and SGP4 orbital screenings.

### Supported Production Topologies

| Topology                         | Target Platform                            | Description                                                                                                                                                   |
| :------------------------------- | :----------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **PaaS Blueprint (Recommended)** | [Render](https://render.com)               | Turnkey Infrastructure-as-Code via `render.yaml`. Includes managed PostgreSQL 16, auto-provisioned HTTPS, pre-deploy migrations, and health check monitoring. |
| **Containerized Service**        | Docker Compose / Cloud Run / AWS ECS       | Multi-stage Docker image (`Dockerfile`) running unprivileged `node` user with process isolation and managed database container.                               |
| **Traditional Linux Host**       | Ubuntu 22.04 / 24.04 LTS (systemd + Nginx) | Node.js process managed via systemd/PM2 with Nginx reverse proxy terminating TLS and local/remote PostgreSQL.                                                 |

---

## 2. Environment Variables & Secrets Management

Europa strictly enforces **fail-closed configuration validation** at startup in production (`NODE_ENV=production`). If any mandatory variable is missing or insecure, the application terminates immediately with a descriptive startup error.

### Production Environment Variables

| Variable                                   | Type    | Default               | Required in Prod | Description & Security Policy                                                                         |
| :----------------------------------------- | :------ | :-------------------- | :--------------: | :---------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                 | String  | `development`         |     **Yes**      | Set to `production`. Disables dev error traces, enables strict auth and fail-closed checks.           |
| `PORT`                                     | Integer | `3000`                |        No        | HTTP listening port. Automatically bound to `$PORT` in cloud environments (e.g. Render uses `10000`). |
| `HOST`                                     | String  | `0.0.0.0`             |        No        | Network interface binding. Defaults to `0.0.0.0` for container compatibility.                         |
| `DATABASE_URL`                             | String  | _None_                |     **Yes**      | Fully qualified PostgreSQL connection URI: `postgresql://user:password@host:port/dbname`.             |
| `DATABASE_SSL`                             | Boolean | _Auto_                |        No        | Set `true` to force TLS, `false` to disable. Automatically negotiated for remote databases.           |
| `OPERATOR_API_KEY`                         | String  | _None_                |     **Yes**      | High-entropy secret key (>= 16 characters). Used by authorized operators for write mutations.         |
| `STORAGE_DIR`                              | String  | `./storage/snapshots` |        No        | Persistent directory path for ingested CSV snapshot archives.                                         |
| `CORRELATION_STEP_TOLERANCE_MINUTES`       | Integer | `20`                  |        No        | Maximum temporal tolerance between successive encounter observations (minutes).                       |
| `CORRELATION_MAX_CUMULATIVE_DRIFT_MINUTES` | Integer | `45`                  |        No        | Maximum cumulative TCA drift across an encounter's observation history (minutes).                     |
| `ALLOW_HOSTED_DEMO_SEED`                   | Boolean | `false`               |        No        | Explicit opt-in allowing non-destructive synthetic demo data seeding on hosted demo instances.        |

> [!CAUTION]
> **Production Credential Guardrails:**
>
> - Never commit `.env` files or hardcoded credentials to version control.
> - In production, `OPERATOR_API_KEY` must be at least 16 characters in length. Predictable development keys (`europa-dev-key`, `voidline-dev-key`, `test-operator-key`) are **strictly rejected** by the configuration loader.
> - Inject secrets using platform environment variables (Render Environment Dashboard, AWS Secrets Manager, Doppler, or GitHub Actions Secrets).

---

## 3. Deployment Procedure: Render PaaS (Recommended)

Render provides the simplest, most reliable production path for Europa using the included `render.yaml` Blueprint.

### 3.1 Initial Deployment via Blueprint

1. **Sign in to Render**: Navigate to [dashboard.render.com](https://dashboard.render.com).
2. **Create New Blueprint**:
   - Click **New +** → **Blueprint**.
   - Connect your GitHub repository (`https://github.com/Ayush-o1/Europa`).
   - Select the `main` branch.
   - Render automatically detects `render.yaml` and displays the service plan:
     - Web Service: `europa-web` (Node.js runtime, plan `starter` or `free`).
     - Database: `europa-db` (PostgreSQL 16, plan `starter` or `free`).
3. **Review & Deploy**:
   - Review the preconfigured build command (`npm ci`), pre-deploy command (`npm run db:migrate`), and start command (`npm start`).
   - Click **Apply Blueprint**.
   - Render automatically provisions the PostgreSQL instance, injects the secure `DATABASE_URL` and auto-generated `OPERATOR_API_KEY`, runs schema migrations, and deploys the web service behind managed HTTPS.

### 3.2 Pre-Deploy Database Migrations

Europa runs migrations via `scripts/migrate.js` using transactional advisory locks (`pg_advisory_xact_lock`). In Render, this is configured as the `preDeployCommand`:

```yaml
preDeployCommand: npm run db:migrate
```

Render executes this step before routing traffic to the newly built container. If a migration fails, the deployment aborts immediately, leaving the previous active release running without interruption.

---

## 4. Deployment Procedure: Docker & Self-Hosted Containers

For self-hosted virtual private servers (VPS), AWS ECS, Google Cloud Run, or local production simulation:

### 4.1 Production Multi-Container Stack (Docker Compose)

The repository provides a turnkey `docker-compose.yml` stack:

```bash
# 1. Clone the repository
git clone https://github.com/Ayush-o1/Europa.git
cd Europa

# 2. Review environment variables in docker-compose.yml (or supply via .env)
# 3. Build and launch the stack
docker compose up -d --build

# 4. Monitor application startup logs
docker compose logs -f app
```

### 4.2 Standalone Docker Container

To run Europa in a standalone container against an existing PostgreSQL instance:

```bash
# 1. Build the production image
docker build -t europa:latest .

# 2. Run schema migrations
docker run --rm \
  -e NODE_ENV=production \
  -e DATABASE_URL="postgresql://user:password@db.internal:5432/europa" \
  -e OPERATOR_API_KEY="your-secure-production-operator-key-32chars" \
  europa:latest npm run db:migrate

# 3. Start the application container
docker run -d \
  --name europa-web \
  --restart unless-stopped \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e DATABASE_URL="postgresql://user:password@db.internal:5432/europa" \
  -e OPERATOR_API_KEY="your-secure-production-operator-key-32chars" \
  europa:latest
```

---

## 5. Controlled Public Demo Data Initialization

For publicly accessible demonstration or staging instances, Europa includes deterministic synthetic fixtures (`LOCAL_FIXTURE`) demonstrating multi-snapshot tightening encounters, SGP4 screenings, and operator reviews.

### 5.1 Safety Principles for Hosted Demo Seeding

1. **Non-Destructive Only**: `scripts/seedDemoData.js` strictly forbids table cleanup (`--clean` / `TRUNCATE`) in production or against remote databases, even if requested.
2. **Explicit Authorization Flag**: In production (`NODE_ENV=production`), the seeder fails closed unless explicitly invoked with `ALLOW_HOSTED_DEMO_SEED=true`.
3. **Idempotent Ingestion**: Repeated executions detect existing records by SHA-256 content hashes and UUID keys, skipping mutations without duplicating audit ledger entries.
4. **Clear Synthetic Identification**: All demo fixtures are ingested under the `LOCAL_FIXTURE` screening scope and synthetic satellite catalog numbers.

### 5.2 Seeding Procedure for Hosted Demo Instances

To seed a freshly deployed public demonstration instance:

#### Option A: One-Time Render Shell / SSH Task

From the Render Dashboard:

1. Navigate to the `europa-web` service → **Shell** tab.
2. Execute the one-time seeding command:
   ```bash
   ALLOW_HOSTED_DEMO_SEED=true node scripts/seedDemoData.js
   ```
3. Verify the output table confirms events, observations, and audit entries.

#### Option B: Local CLI targeting Hosted Database

```bash
ALLOW_HOSTED_DEMO_SEED=true DATABASE_URL="<HOSTED_DATABASE_URL>" node scripts/seedDemoData.js
```

---

## 6. Health Checks, Monitoring & Diagnostics

### 6.1 Automated Liveness & Readiness Probing

Europa exposes a dedicated health check endpoint:

```http
GET /api/v1/health
```

**Healthy Response (HTTP 200 OK):**

```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "timestamp": "2026-10-18T18:30:00.000Z",
    "uptimeSeconds": 8421,
    "database": {
      "status": "ready"
    }
  }
}
```

**Unhealthy Response (HTTP 503 Service Unavailable):**

```json
{
  "success": false,
  "error": {
    "code": "DATABASE_UNAVAILABLE",
    "message": "Database readiness check failed."
  }
}
```

> [!NOTE]
> The health check queries `SELECT 1 as ready;` over the pool without revealing database versions, connection strings, table schemas, or host credentials.

### 6.2 Application Logs Inspection

Europa formats all access logs and diagnostic entries through sanitized, structured stdout/stderr streams.

- **Render**: Navigate to **Logs** in the Render Dashboard for live streaming and historical search.
- **Docker**: `docker logs -f europa-app`
- **Audit Logging**: All write operations (snapshot ingestion, review decisions, SGP4 screenings) generate structured entries with actor IDs and timestamped cryptographic hashes.

---

## 7. Database Backup & Disaster Recovery

### 7.1 Automated Cloud Backups

- **Render PostgreSQL (Starter Plan and above)**: Includes automated daily backups retained for 7 days with point-in-time recovery.
- **Render PostgreSQL (Free Plan)**: Does not include automated backups. Upgrade to Starter ($7/month) is recommended for production persistence.

### 7.2 Manual Logical Backup (`pg_dump`)

Execute logical database backups prior to major operational changes:

```bash
# Export compressed PostgreSQL database archive
pg_dump "$DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="europa_backup_$(date +%Y%m%d_%H%M%S).dump"
```

### 7.3 Disaster Restoration Procedure

To restore from a logical backup archive:

```bash
# 1. Terminate active web server traffic or set maintenance mode
# 2. Restore schema and data into target database
pg_restore \
  --dbname="$DATABASE_URL" \
  --clean \
  --if-exists \
  --no-owner \
  "europa_backup_<TIMESTAMP>.dump"

# 3. Verify audit ledger cryptographic integrity
curl -s -X GET "https://<YOUR_DEPLOYED_URL>/api/v1/audit/verify" | jq .
```

---

## 8. Zero-Downtime Operator Credential Rotation

If an `OPERATOR_API_KEY` is suspected of compromise or requires scheduled rotation:

1. **Generate New Key**:
   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
   ```
2. **Update Environment Variable in PaaS / Orchestrator**:
   - In Render: Go to **Environment** → Edit `OPERATOR_API_KEY` with the new value → Click **Save Changes**.
   - Render initiates a zero-downtime rolling deployment. The new container instance begins serving incoming requests, while existing requests in flight finish on the terminating instance.
3. **Distribute New Key to Authorized Operators**:
   - Inform flight safety operators to enter the updated key into the in-memory operator modal in the web workbench.
4. **Audit Verification**:
   - Inspect recent entries in `audit_ledger` to verify that operator actions continue with the updated credentials.

---

## 9. Rollback & Decommissioning Procedures

### 9.1 Immediate Application Rollback

If a newly deployed application version introduces a regression:

- **Render Dashboard**: Navigate to **Deploys** → Select the last known good deploy → Click **Rollback to this deploy**.
- Render instantly redirects routing to the previous healthy container build without rebuilding from scratch.

### 9.2 Safe Decommissioning

To retire a deployed Europa instance without leaving orphaned resources:

1. **Archive Data**: Perform a final `pg_dump` logical backup (Section 7.2).
2. **Delete Web Service**: Delete `europa-web` from the hosting dashboard.
3. **Delete Managed Database**: Delete `europa-db` after confirming the logical backup is stored safely off-site.

---

## 10. Provider Comparison & Real Operational Costs

Europa requires standard Node.js and PostgreSQL runtimes without proprietary cloud dependencies. The table below outlines verified capabilities and costs across major providers:

| Provider                                     | Runtime Plan            | Database Plan                    |    Verified Cost    | Free Tier Limitations                                                                                                                                                           |
| :------------------------------------------- | :---------------------- | :------------------------------- | :-----------------: | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Render**                                   | Starter Web ($7/mo)     | Starter PostgreSQL ($7/mo)       |   **$14 / month**   | Free web service spins down after 15 min inactivity; Free database deleted after 30 days. Paid Starter tier provides 24/7 uptime, 512MB RAM, persistent storage, daily backups. |
| **Neon + Render**                            | Render Free Web ($0/mo) | Neon Serverless Postgres ($0/mo) |   **$0 / month**    | Serverless compute spins down on idle; 0.5 GB storage limit on free tier.                                                                                                       |
| **Fly.io**                                   | Shared-CPU-1x ($2/mo)   | Fly Postgres Lite ($3/mo)        |   **~$5 / month**   | Requires credit card verification at sign-up. 256MB RAM per machine on basic tier.                                                                                              |
| **Self-Hosted VPS (Hetzner / DigitalOcean)** | Shared vCPU (2GB RAM)   | Local PostgreSQL 16              | **$4 – $6 / month** | Requires manual OS patching, TLS certificate management (Certbot), and backup cron jobs.                                                                                        |
