# Europa REST API Reference

Europa provides a modular, predictable REST API mounted under `/api/v1`. All endpoints return uniform JSON envelopes, and write operations require operator authentication.

---

## 1. Conventions & Envelopes

### Base URL

```text
http://localhost:3000/api/v1
```

### Universal Success Envelope

```json
{
  "success": true,
  "data": { ... },
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 142,
    "totalPages": 8
  }
}
```

### Universal Error Envelope

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "A meaningful justification of at least 10 characters is required.",
    "details": null
  }
}
```

### Authentication Scheme

Write operations (snapshot uploads, review submissions, and persisted orbital propagation screenings) require an operator API key. Provide the key using either header:

- **API Key Header:** `X-API-Key: <key>`
- **Authorization Header:** `Authorization: Bearer <key>`
- **Optional Operator Identity:** `X-Actor-Id: <callsign>` (defaults to `'operator'` for audit ledger attribution)

Default development key: `europa-dev-key`.

---

## 2. Health & System Status

### `GET /health`

Inspects server uptime and verifies live PostgreSQL connectivity with a lightweight ping (`SELECT 1`).

- **Authentication:** Public
- **Response Codes:**
  - `200 OK`: Server and database operational.
  - `503 Service Unavailable`: Database ping failed or disconnected.

#### Example Request

```bash
curl -s http://localhost:3000/api/v1/health
```

#### Example Response

```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "timestamp": "2026-10-18T10:00:00.000Z",
    "uptimeSeconds": 1420,
    "database": {
      "status": "ready"
    }
  }
}
```

---

## 3. Snapshot Ingestion & Batches

### `POST /ingest/snapshots`

Upload and process a CelesTrak SOCRATES CSV snapshot. Ingests raw rows, performs duplicate checks, updates or creates conjunction events, and calculates initial assessment scores.

- **Authentication:** Operator required (`X-API-Key`)
- **Content-Type:** `multipart/form-data`
- **Form Fields:**
  - `file`: CSV file buffer (Required, max 10MB).
  - `screeningScope`: Enum `FULL_CATALOG_MINRANGE` | `FILTERED_QUERY` | `LOCAL_FIXTURE` (Default: `LOCAL_FIXTURE`).
  - `sourceUri`: Optional origin file path or URL string.
  - `capturedAt`: Optional ISO timestamp string representing snapshot extraction time.
  - `queryParams`: Optional JSON string containing search metadata.
- **Response Codes:**
  - `201 Created`: Snapshot processed successfully.
  - `200 OK`: Snapshot already ingested (identical content and timestamp); returned cached batch.
  - `400 Bad Request`: Missing file or unparseable metadata.
  - `401 Unauthorized` / `403 Forbidden`: Missing or invalid operator key.

#### Example Request

```bash
curl -s -X POST http://localhost:3000/api/v1/ingest/snapshots \
  -H "X-API-Key: europa-dev-key" \
  -F "file=@test/fixtures/socrates_real_sample.csv" \
  -F "screeningScope=FULL_CATALOG_MINRANGE"
```

#### Example Response

```json
{
  "success": true,
  "data": {
    "batchId": "a7b3c2e1-4f5a-4b6c-8d9e-1f2a3b4c5d6e",
    "status": "COMPLETED",
    "isDuplicate": false,
    "rowCount": 10,
    "validCount": 10,
    "errorCount": 0,
    "correlation": {
      "eventsCreated": 10,
      "eventsUpdated": 0,
      "observationsConfirmed": 0
    }
  }
}
```

---

### `GET /ingest/batches`

Retrieve a paginated provenance ledger of ingested snapshot files.

- **Authentication:** Public
- **Query Parameters:**
  - `page`: Page number (Default: `1`).
  - `limit`: Number of items per page (Default: `20`, Max: `100`).
- **Response Codes:** `200 OK`.

#### Example Request

```bash
curl -s "http://localhost:3000/api/v1/ingest/batches?page=1&limit=5"
```

---

## 4. Conjunction Events

### `GET /events`

Query, filter, and sort conjunction events across operational dimensions.

- **Authentication:** Public
- **Query Parameters:**
  - `page`: Page number (Default: `1`).
  - `limit`: Page size (Default: `20`, Max: `100`).
  - `urgency`: Filter by `LOW` | `MEDIUM` | `HIGH` | `CRITICAL`.
  - `lifecycleState`: Filter by `MONITORING` | `PAST_TCA` | `CANCELLED`.
  - `reviewStatus`: Filter by `PENDING` | `ACKNOWLEDGED` | `ESCALATED` | `DISMISSED` | `REQUIRES_RE_REVIEW`.
  - `trackingState`: Filter by `ACTIVE_TRACKING` | `LOST_TRACKING` | `AMBIGUOUS`.
  - `objectId`: Filter by satellite NORAD catalog number (matches primary or secondary).
  - `tcaFrom`: Filter events with `latest_tca >= tcaFrom` (ISO timestamp).
  - `tcaTo`: Filter events with `latest_tca <= tcaTo` (ISO timestamp).
  - `missDistanceMax`: Maximum predicted miss distance in kilometers (Float).
  - `sortBy`: Column to sort by: `latest_tca` | `latest_range_km` | `urgency_level` | `created_at` | `updated_at` (Default: `latest_tca`).
  - `sortOrder`: `ASC` | `DESC` (Default: `ASC`).
- **Response Codes:** `200 OK`, `400 Bad Request` (invalid filter parameters).

#### Example Request

```bash
curl -s "http://localhost:3000/api/v1/events?urgency=CRITICAL&sortBy=latest_range_km&sortOrder=ASC&limit=10"
```

---

### `GET /events/:id`

Retrieve detailed information for a single encounter event, including catalog metadata for both space objects, latest observation metrics, current assessment, and latest review decision.

- **Authentication:** Public
- **Parameters:** `:id` — UUID of the conjunction event.
- **Response Codes:** `200 OK`, `404 Not Found`.

#### Example Request

```bash
curl -s "http://localhost:3000/api/v1/events/14a0cf7d-2b3f-4e05-9502-861f8a7e6712"
```

---

### `GET /events/:id/history`

Retrieve the complete chronological observation sequence for an encounter event, ordered by snapshot capture time (`captured_at ASC`).

- **Authentication:** Public
- **Parameters:** `:id` — UUID of the conjunction event.
- **Response Codes:** `200 OK`, `404 Not Found`.

#### Example Response

```json
{
  "success": true,
  "data": [
    {
      "chronological_sequence": 1,
      "is_unchanged_confirmation": false,
      "correlated_at": "2026-10-18T08:00:00.000Z",
      "observation_id": "f4b2a1c0-1111-2222-3333-444455556666",
      "captured_at": "2026-10-18T01:00:00.000Z",
      "tca": "2026-11-01T12:00:00.000Z",
      "tca_range_km": 4.5,
      "relative_speed_kms": 12.5,
      "max_prob": 1.2e-5,
      "dilution_km": 0.45,
      "dse_primary": 1.5,
      "dse_secondary": 1.8,
      "source_uri": "socrates_snapshot_1.csv",
      "screening_scope": "LOCAL_FIXTURE"
    }
  ]
}
```

---

### `GET /events/:id/assessments`

Retrieve the assessment history for an encounter event in reverse chronological order, including component score breakdowns and explanation narratives.

- **Authentication:** Public
- **Parameters:** `:id` — UUID of the conjunction event.
- **Response Codes:** `200 OK`, `404 Not Found`.

---

### `GET /events/:id/assessments/latest`

Retrieve the current active assessment record for an encounter event.

- **Authentication:** Public
- **Parameters:** `:id` — UUID of the conjunction event.
- **Response Codes:** `200 OK`, `404 Not Found`.

#### Example Response

```json
{
  "success": true,
  "data": {
    "id": "e3a1b2c4-9999-8888-7777-666655554444",
    "eventId": "14a0cf7d-2b3f-4e05-9502-861f8a7e6712",
    "score": 82.5,
    "urgencyLevel": "CRITICAL",
    "ruleSetVersion": "1.0.0",
    "componentScores": {
      "missDistance": { "score": 50, "maxScore": 50, "value": 0.28 },
      "timeToTca": { "score": 24, "maxScore": 30, "value": 23.5 },
      "probability": { "score": 6, "maxScore": 15, "value": 4.8e-2 },
      "freshness": { "score": 2.5, "maxScore": 5, "value": [1.2, 1.4] }
    },
    "explanations": [
      "Assigned score of 82.5/100 resulting in CRITICAL review priority under rule set 1.0.0.",
      "Miss distance 0.28 km (< 0.5 km) assigned full score 50.0/50.",
      "Time to TCA 23.5h (< 24h) assigned score 24.0/30."
    ]
  }
}
```

---

## 5. Operator Reviews

### `POST /events/:id/reviews`

Submit a justified human review decision for an encounter event.

- **Authentication:** Operator required (`X-API-Key`)
- **Headers:**
  - `X-API-Key: <key>`
  - `X-Actor-Id: <callsign>` (Optional, e.g., `flight-director-1`)
  - `Content-Type: application/json`
- **Request Body:**
  ```json
  {
    "action": "ESCALATE",
    "justification": "Predicted miss distance contracted under 1.0 km within 24 hours of TCA. Escalating for maneuver screening.",
    "targetUrgency": "CRITICAL"
  }
  ```
  - `action`: Enum `ACKNOWLEDGE` | `ESCALATE` | `DISMISS` | `REQUEST_REASSESSMENT` (Required).
  - `justification`: String with $\ge 10$ characters explaining rationale (Required).
  - `targetUrgency`: Optional urgency override (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`).
- **Response Codes:**
  - `201 Created`: Review recorded; event updated.
  - `400 Bad Request`: Justification too short (<10 chars) or invalid action.
  - `401 Unauthorized` / `403 Forbidden`: Missing or invalid operator key.
  - `404 Not Found`: Event does not exist.

---

## 6. Audit Ledger Verification

### `GET /audit/verify`

Executes a read-only cryptographic verification of the SHA-256 hash-chained audit ledger from sequence #1 (genesis) to the latest head.

- **Authentication:** Public
- **Response Codes:** `200 OK`.

#### Example Request

```bash
curl -s http://localhost:3000/api/v1/audit/verify
```

#### Example Response (Intact Chain)

```json
{
  "success": true,
  "data": {
    "verified": true,
    "recordsChecked": 348,
    "firstBrokenRecordSequence": null,
    "error": null
  }
}
```

#### Example Response (Tamper Detected)

```json
{
  "success": true,
  "data": {
    "verified": false,
    "recordsChecked": 348,
    "firstBrokenRecordSequence": 14,
    "error": "Hash mismatch at sequence 14: expected hash does not match computed payload hash."
  }
}
```

---

### `GET /events/:id/audit`

Retrieve paginated audit ledger entries associated with a specific event.

- **Authentication:** Public
- **Parameters:** `:id` — UUID of the conjunction event.
- **Query Parameters:** `page` (Default: `1`), `limit` (Default: `20`, Max: `100`).
- **Response Codes:** `200 OK`, `404 Not Found`.

---

## 7. Orbital Propagation & SGP4 Screening

### `POST /propagation/estimate`

Calculates an SGP4 orbital encounter screening between two satellites given their Two-Line Element (TLE) sets and a nominal TCA.

- **Authentication:** Public for transient estimation; Operator required if `eventId` is provided to persist the screening.
- **Request Body:**
  ```json
  {
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
    "stepSeconds": 5,
    "eventId": "14a0cf7d-2b3f-4e05-9502-861f8a7e6712"
  }
  ```
- **Response Codes:**
  - `200 OK`: Screening calculated successfully.
  - `400 Bad Request`: Malformed TLE strings, checksum error, or unparseable date.
  - `401 Unauthorized`: Attempted to persist screening with `eventId` without operator key.
  - `404 Not Found`: Referenced `eventId` does not exist.

#### Example Response

```json
{
  "success": true,
  "data": {
    "refinedTca": "2024-01-01T12:01:14.200Z",
    "minRangeKm": 1.482,
    "relativeVelocityKms": 11.842,
    "coarseMinRangeKm": 1.512,
    "searchWindowMinutes": 10,
    "stepSeconds": 5,
    "primaryTleAgeHours": 12.4,
    "secondaryTleAgeHours": 8.1,
    "staleElementsWarning": false
  }
}
```

---

### `GET /events/:id/propagation`

Retrieve historical SGP4 orbital encounter screenings associated with an event.

- **Authentication:** Public
- **Parameters:** `:id` — UUID of the conjunction event.
- **Response Codes:** `200 OK`, `404 Not Found`.
