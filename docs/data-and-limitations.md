# Data Provenance, Astrodynamics & Scientific Limitations

Europa is an analytical space situational awareness (SSA) workbench designed for research, retrospective analysis, and operational workflow demonstration. This document explicitly defines the sources of input data, the mathematical principles governing derived calculations, and the scientific and operational boundaries of the platform.

---

## 1. Input Data Provenance & SOCRATES Architecture

Europa ingests orbital close-approach reports based on the CelesTrak SOCRATES (Satellite Orbital Conjunction Reports Assessing Threatening Encounters in Space) specification.

### 1.1 Upstream Data Chain

1. **Observation & Tracking:** Public orbital elements originate from tracking data collected by the United States Space Surveillance Network (SSN) and published as Two-Line Element (TLE) sets by the 18th Space Defense Squadron via Space-Track.org.
2. **CelesTrak SOCRATES Processing:** CelesTrak runs automated screening algorithms propagating all active TLE sets forward over a 7-day lookahead window to identify pairs with close-approach ranges below specific screening thresholds (e.g., $<5.0\text{ km}$).
3. **Europa Ingestion:** Europa ingests snapshots of these published tables, calculates cryptographic SHA-256 content hashes, records provenance metadata (`source_uri`, `screening_scope`, `captured_at`), and stores unmodified raw observations in PostgreSQL.

### 1.2 Information Stored Per Observation

For every reported close approach, Europa archives:

- **Primary & Secondary Catalog IDs:** 5- or 6-digit NORAD catalog numbers identifying the orbiting objects.
- **Predicted Time of Closest Approach (TCA):** High-precision UTC timestamp of the predicted close approach.
- **Miss Distance (TCA Range):** Predicted separation distance in kilometers at TCA.
- **Relative Velocity:** Estimated relative encounter speed in kilometers per second ($\text{km/s}$).
- **Screening Probability Metric (`MAX_PROB`):** Mathematical maximum collision probability under worst-case covariance orientation.
- **Dilution Metric:** Separation-to-covariance ratio parameter in kilometers.
- **Days Since Epoch (DSE):** Age of the primary and secondary TLE orbital sets at the time of screening.

---

## 2. Distinction of Data Layers

To maintain scientific and operational clarity, Europa enforces strict architectural boundaries between four distinct categories of data:

```text
┌─────────────────────────────────────────────────────────────┐
│ 1. Reported Upstream Data                                    │
│    Unmodified raw observations from CelesTrak SOCRATES CSV. │
│    Examples: NORAD IDs, reported TCA, reported range, DSE.  │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Derived Calculations                                     │
│    Purely deterministic astrodynamic or algorithmic outputs.│
│    Examples: Refined TCA via SGP4, minimum range, relative  │
│    velocity vector, canonical pair key, observation counts. │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Heuristic Priority Assessments                           │
│    Multi-factor ranking scores (0–100) and urgency bands.   │
│    Examples: Score 82.5, CRITICAL urgency, breakdown cards. │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Operator Review Decisions                                │
│    Subjective human decisions recorded in the audit ledger. │
│    Examples: ESCALATE, ACKNOWLEDGE, DISMISS, justifications.│
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Review-Priority Scores vs. Physical Collision Probability

### 3.1 Nature of the Priority Score

The 0–100 review-priority score produced by `src/modules/assessment/assessmentEngine.js` is an **empirical triage index**, not a physical probability:

- **Purpose:** To help space operations teams organize hundreds of daily close-approach reports and focus analyst attention on the most time-sensitive, high-proximity events.
- **Weights:** Miss distance (50%), time to TCA (30%), screening metric (15%), and orbit data freshness (5%).
- **Non-Equivalence:** A score of `85/100` indicates high analytical urgency under Europa's configured heuristic rule set. It **does not** mean an 85% chance of collision.

### 3.2 Interpretation of SOCRATES `MAX_PROB`

The `MAX_PROB` field in CelesTrak reports is widely misunderstood. In Europa, it is strictly treated as an **upper-bound screening metric**:

- **Mathematical Definition:** `MAX_PROB` is computed using Salvatore Alfano's maximum probability formula. It calculates the theoretical maximum value that collision probability ($P_c$) could reach if the error covariance matrix were oriented in the worst-case possible direction and sized to maximize probability for the given miss distance and combined hard-body radius.
- **Operational Limitation:** `MAX_PROB` is **not** an authoritative or calibrated probability of collision ($P_c$). Real operational conjunction assessment requires precise, full-covariance matrices and spacecraft geometry. In Europa, `MAX_PROB` serves strictly as an input factor (up to 15 points) in the priority ranking heuristic.

### 3.3 Why Europa Does Not Compute Authoritative $P_c$

Authoritative collision probability computation requires:

1. Full 3-dimensional position and velocity error covariance matrices ($\mathbf{C}_1, \mathbf{C}_2$) at the epoch of TCA.
2. Accurate spacecraft physical dimensions, attitude, and cross-sectional collision cross-sections.
3. Numerical integration under a comprehensive force model (EGM96/EGM2008 geopotential, solar radiation pressure, lunar and solar third-body perturbations, and dynamic atmospheric density models such as NRLMSISE-00).

Public Two-Line Element (TLE) sets **do not contain error covariance matrices**. Calculating a classical 2D Gaussian collision probability (e.g., Foster, Akella-Alfriend, or Patera algorithms) without genuine covariance requires fabricating arbitrary covariance assumptions, which yields physically misleading results. Europa deliberately refrains from generating uncalibrated $P_c$ values.

---

## 4. Experimental SGP4 Propagation & Astrodynamic Limits

Europa includes an integrated trajectory screening tool based on `satellite.js` (Vallado SGP4 algorithm).

### 4.1 Underlying Astrodynamic Assumptions

SGP4 (Simplified General Perturbations 4) is an analytical propagation model designed for Two-Line Element sets:

- **Gravity Model:** Incorporates mean low-order zonal harmonics ($J_2, J_3, J_4$).
- **Atmospheric Drag:** Employs a simplified, static density model parameterized by the TLE $B^*$ drag term.
- **Exclusions:** SGP4 ignores tesseral and sectorial harmonics ($J_{2,2}$, etc.), non-spherical solar radiation pressure, thermal re-radiation (Yarkovsky effect), solar and lunar gravitational tides, and spacecraft active maneuvers.

### 4.2 Positional Error Growth & TLE Age

- **Degradation Rate:** In Low Earth Orbit (LEO), SGP4 positional error typically grows by **1 to 3 kilometers per day** following the TLE epoch.
- **Freshness Warning:** Europa tracks the age of orbital elements (Days Since Epoch, DSE). Any TLE older than 72 hours ($\text{DSE} > 3.0\text{ days}$) is explicitly flagged as stale in screening results.
- **Refined TCA Precision:** While Europa's encounter estimator performs a fine search with 100-millisecond steps, the astrodynamic accuracy of the underlying TLEs cannot support sub-second physical timing precision. The refined TCA represents the geometric minimum of the SGP4 mathematical curves, not a physical guarantee of satellite separation.

---

## 5. Scope & Limitations of the Cryptographic Audit Ledger

Europa's audit ledger (`audit_ledger`) uses a SHA-256 hash chain and PostgreSQL database triggers:

### 5.1 What the Ledger Protects Against

- **Application Logic Tampering:** Detects modifications made via application code or standard SQL queries (`UPDATE`, `DELETE`).
- **Chain Continuity Gaps:** Detects dropped records, unauthorized insertions, or altered payload records during verification walks (`GET /api/v1/audit/verify`).
- **Accidental Overwrites:** PostgreSQL `BEFORE UPDATE OR DELETE` triggers unconditionally reject mutation operations at the database engine level.

### 5.2 What the Ledger Does Not Protect Against

- **Superuser Out-of-Band Manipulation:** A database administrator with PostgreSQL superuser privileges or raw filesystem access can disable triggers (`ALTER TABLE ... DISABLE TRIGGER ALL`) or alter data on disk directly.
- **Absence of Distributed Consensus:** The ledger is local to the PostgreSQL database instance. It does not employ distributed Byzantine fault tolerance, Proof-of-Authority, or multi-party cryptographic time-stamping (e.g., RFC 3161 public timestamp authorities).
- **Physical Machine Compromise:** If the underlying database host or storage volume is compromised, the ledger cannot independently verify its history without an external anchoring reference.

---

## 6. Non-Operational Software Disclaimer

> [!CAUTION]
> **EUROPA IS NOT A CERTIFIED OPERATIONAL COLLISION-AVOIDANCE SYSTEM.**
>
> Europa is designed solely as an analytical space situational awareness workbench, workflow modeling platform, and research tool.
>
> - **No Flight Safety Use:** Outputs from Europa (including priority scores, urgency classifications, SGP4 encounter estimates, and tracking state labels) must **never** be used as the basis for commanding satellite collision-avoidance maneuvers (CAM), altering spacecraft orbital trajectories, or assessing real-world flight safety risks.
> - **Operational Requirements:** Certified flight-safety operations require access to authoritative, high-accuracy orbit determination data (such as Conjunction Data Messages / CDMs produced by 18 SDS, LeoLabs, or commercial SSA providers) with calibrated covariance matrices, high-fidelity numerical propagators, and human orbital safety team validation.
