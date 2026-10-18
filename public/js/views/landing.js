/**
 * @fileoverview Europa Public Landing Page View Module
 *
 * Implements the Phase 1 brand identity and public landing page:
 * - Section A: Refined navigation with mobile drawer and workspace CTA
 * - Section B: High-contrast hero with custom SVG orbital encounter visual & telemetry strip
 * - Section C: Real orbital mechanics problem explanation & Europa's approach
 * - Section D: Product showcase featuring genuine application screenshots with interactive tabs
 * - Section E: Comprehensive capabilities composition
 * - Section F: Step-by-step engineering workflow sequence
 * - Section G: Authoritative trust and scientific limitations
 * - Section H: Architecture specifications and primary call-to-action
 * - Section I: Footer with documentation, license, and repository links
 */

import { state } from '../state.js';

export function renderLanding(container) {
  container.innerHTML = `
    <div class="landing-page">
      <!-- Section A: Top Navigation -->
      <header class="landing-nav-bar" id="landing-navbar">
        <div class="landing-nav-container">
          <a href="#home" class="landing-brand" aria-label="Europa Homepage">
            <span class="landing-brand-emblem" aria-hidden="true">◈</span>
            <div class="landing-brand-text">
              <span class="landing-brand-name">Europa</span>
              <span class="landing-brand-sub">SSA Platform</span>
            </div>
          </a>

          <nav class="landing-nav-links" aria-label="Main Navigation">
            <a href="#problem" class="landing-nav-link">Problem</a>
            <a href="#showcase" class="landing-nav-link">Showcase</a>
            <a href="#capabilities" class="landing-nav-link">Capabilities</a>
            <a href="#workflow" class="landing-nav-link">Methodology</a>
            <a href="#architecture" class="landing-nav-link">Architecture</a>
            <a href="#limitations" class="landing-nav-link">Trust</a>
          </nav>

          <div class="landing-nav-actions">
            <a href="#overview" id="btn-nav-open-app" class="btn-open-workspace" role="button">
              <span>Open Workspace</span>
              <span aria-hidden="true">→</span>
            </a>
            <button
              id="landing-menu-btn"
              class="landing-menu-toggle"
              aria-label="Toggle mobile navigation menu"
              aria-expanded="false"
            >
              ☰
            </button>
          </div>
        </div>

        <!-- Mobile Drawer Menu -->
        <div id="landing-mobile-drawer" class="landing-mobile-menu" aria-label="Mobile Navigation">
          <a href="#problem" class="landing-nav-link mobile-nav-item">Problem & Vision</a>
          <a href="#showcase" class="landing-nav-link mobile-nav-item">Product Showcase</a>
          <a href="#capabilities" class="landing-nav-link mobile-nav-item">Capabilities</a>
          <a href="#workflow" class="landing-nav-link mobile-nav-item">Engineering Methodology</a>
          <a href="#architecture" class="landing-nav-link mobile-nav-item">Architecture</a>
          <a href="#limitations" class="landing-nav-link mobile-nav-item">Scientific Limitations</a>
          <a href="#overview" id="btn-mobile-open-app" class="btn-open-workspace" style="justify-content: center; margin-top: var(--space-2);">
            Open Workspace →
          </a>
        </div>
      </header>

      <!-- Section B: Hero Section -->
      <section class="landing-hero" id="home">
        <div class="landing-container">
          <div class="hero-grid">
            <div class="hero-content">
              <span class="section-tag">
                <span style="font-weight: 700;">●</span> Space Situational Awareness
              </span>
              <h1 class="hero-title">
                Understand the encounters that matter.
              </h1>
              <p class="hero-lead">
                An analytical workbench for satellite close-approach screening, evolving encounter histories, explainable priority scoring, and auditable flight-safety reviews.
              </p>
              <div class="hero-actions">
                <a href="#overview" id="btn-hero-open-app" class="btn-hero-primary" role="button">
                  <span>Open Workspace</span>
                  <span aria-hidden="true">◈</span>
                </a>
                <a href="#showcase" class="btn-hero-secondary">
                  <span>Explore Showcase</span>
                  <span aria-hidden="true">↓</span>
                </a>
              </div>

              <!-- Real Telemetry Strip -->
              <div class="hero-telemetry-strip" aria-label="Platform Operational Parameters">
                <div class="telemetry-item">
                  <span class="telemetry-label">Screening Target</span>
                  <span class="telemetry-val">CelesTrak SOCRATES</span>
                </div>
                <div class="telemetry-item">
                  <span class="telemetry-label">Screening Boundary</span>
                  <span class="telemetry-val">&lt; 5.000 km Miss</span>
                </div>
                <div class="telemetry-item">
                  <span class="telemetry-label">Astrodynamics</span>
                  <span class="telemetry-val">SGP4 / SDP4 Orbit</span>
                </div>
                <div class="telemetry-item">
                  <span class="telemetry-label">Ledger Integrity</span>
                  <span class="telemetry-val">SHA-256 Hash Chain</span>
                </div>
              </div>
            </div>

            <!-- Custom Orbital SVG Visual -->
            <div class="hero-visual-card" aria-label="Orbital Encounter Geometry Visualization">
              <div class="hero-visual-header">
                <span>SIMULATED ENCOUNTER GEOMETRY</span>
                <span style="color: var(--color-accent); font-weight: 600;">Δr = 0.280 km</span>
              </div>
              <div class="hero-svg-container">
                <svg
                  class="hero-svg-canvas"
                  viewBox="0 0 500 380"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  role="img"
                  aria-label="Orbital trajectories of primary payload and secondary debris intersecting at TCA"
                >
                  <!-- Background Celestial Grid -->
                  <defs>
                    <radialGradient id="celestial-glow" cx="50%" cy="50%" r="50%">
                      <stop offset="0%" stop-color="#4e8796" stop-opacity="0.12" />
                      <stop offset="100%" stop-color="#07090e" stop-opacity="0" />
                    </radialGradient>
                    <linearGradient id="orbit-grad-primary" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stop-color="#e06c3a" stop-opacity="0.8" />
                      <stop offset="100%" stop-color="#e06c3a" stop-opacity="0.2" />
                    </linearGradient>
                    <linearGradient id="orbit-grad-secondary" x1="100%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stop-color="#4e8796" stop-opacity="0.9" />
                      <stop offset="100%" stop-color="#4e8796" stop-opacity="0.15" />
                    </linearGradient>
                  </defs>

                  <rect width="500" height="380" fill="#090d15" rx="8" />
                  <circle cx="250" cy="190" r="140" fill="url(#celestial-glow)" />

                  <!-- Coordinate Reference Lines -->
                  <line x1="40" y1="190" x2="460" y2="190" stroke="rgba(255,255,255,0.06)" stroke-width="1" stroke-dasharray="4 4" />
                  <line x1="250" y1="40" x2="250" y2="340" stroke="rgba(255,255,255,0.06)" stroke-width="1" stroke-dasharray="4 4" />
                  <circle cx="250" cy="190" r="80" stroke="rgba(255,255,255,0.05)" stroke-width="1" fill="none" />
                  <circle cx="250" cy="190" r="130" stroke="rgba(255,255,255,0.04)" stroke-width="1" fill="none" />

                  <!-- Earth Center Representation -->
                  <circle cx="250" cy="190" r="28" fill="#121824" stroke="rgba(78, 135, 150, 0.4)" stroke-width="1.5" />
                  <circle cx="250" cy="190" r="24" fill="#0d1420" />
                  <path d="M236 182 C242 186, 252 184, 258 190 C262 194, 260 202, 256 206" stroke="rgba(78, 135, 150, 0.3)" stroke-width="1" fill="none" />

                  <!-- Primary Satellite Orbit (NORAD 25544 - ISS Orbit Plane) -->
                  <ellipse cx="250" cy="190" rx="175" ry="75" transform="rotate(-24 250 190)" stroke="url(#orbit-grad-primary)" stroke-width="1.8" fill="none" />
                  
                  <!-- Secondary Object Orbit (Debris Plane) -->
                  <ellipse cx="250" cy="190" rx="160" ry="90" transform="rotate(38 250 190)" stroke="url(#orbit-grad-secondary)" stroke-width="1.8" fill="none" class="trajectory-dash-line" />

                  <!-- Conjunction Intersection Node (TCA) -->
                  <g transform="translate(345, 126)">
                    <!-- Proximity Range Circle -->
                    <circle cx="0" cy="0" r="18" fill="rgba(224, 108, 58, 0.12)" stroke="rgba(224, 108, 58, 0.4)" stroke-width="1" />
                    <!-- Crosshair -->
                    <line x1="-8" y1="0" x2="8" y2="0" stroke="var(--color-accent)" stroke-width="1.5" />
                    <line x1="0" y1="-8" x2="0" y2="8" stroke="var(--color-accent)" stroke-width="1.5" />
                    <circle cx="0" cy="0" r="3.5" fill="#fff" />
                    <!-- TCA Annotation Badge -->
                    <rect x="16" y="-22" width="115" height="36" rx="4" fill="#121824" stroke="rgba(224, 108, 58, 0.4)" stroke-width="1" />
                    <text x="24" y="-9" font-family="JetBrains Mono, monospace" font-size="9" fill="#94a3b8">TCA ENCOUNTER</text>
                    <text x="24" y="5" font-family="JetBrains Mono, monospace" font-size="11" font-weight="700" fill="#e06c3a">0.280 km @ 14.8 km/s</text>
                  </g>

                  <!-- Primary Object Marker -->
                  <circle cx="160" cy="235" r="5" class="orbit-node-primary" />
                  <text x="110" y="258" font-family="JetBrains Mono, monospace" font-size="9" fill="#f8fafc">NORAD 25544 (PRIMARY)</text>

                  <!-- Secondary Object Marker -->
                  <circle cx="360" cy="265" r="5" class="orbit-node-secondary" />
                  <text x="290" y="290" font-family="JetBrains Mono, monospace" font-size="9" fill="#94a3b8">NORAD 34454 (DEBRIS)</text>
                </svg>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Section C: The Problem & The Product -->
      <section class="landing-section" id="problem">
        <div class="landing-container">
          <span class="section-tag">01 / Operational Challenge</span>
          <h2 class="section-title">
            Conjunction reports are snapshots.<br />
            Orbital risk is an evolving timeline.
          </h2>
          <p class="section-lead">
            Space operators ingest hundreds of close-approach alerts daily from public sources like CelesTrak SOCRATES. Without persistent correlation, separating contracting hazards from diverging encounters requires tedious manual analysis.
          </p>

          <div class="problem-grid">
            <div class="problem-column problem-column-crisis">
              <div class="problem-col-header">
                <span class="problem-bullet">✕</span>
                <span style="color: var(--color-critical); font-weight: 700;">The Upstream Deficit</span>
              </div>
              <h3 class="problem-col-title">Fragmented point-in-time data leaves operators blind to trends</h3>
              <ul class="problem-list">
                <li class="problem-item">
                  <span class="problem-bullet">•</span>
                  <span><strong>Snapshot Isolation:</strong> Upstream ephemeris tables publish static rows. There is no automated record of how a conjunction's miss distance tightened or shifted over successive passes.</span>
                </li>
                <li class="problem-item">
                  <span class="problem-bullet">•</span>
                  <span><strong>Reversed Object Ordering:</strong> Satellites appear arbitrarily ordered ('Object A vs B' then 'B vs A'), causing manual tracking spreadsheets to fragment.</span>
                </li>
                <li class="problem-item">
                  <span class="problem-bullet">•</span>
                  <span><strong>Untracked Decisions:</strong> Operator review actions (acknowledgments, dismissals, escalations) are disconnected from the data trail, eliminating flight-safety auditability.</span>
                </li>
              </ul>
            </div>

            <div class="problem-column problem-column-solution">
              <div class="problem-col-header">
                <span class="solution-bullet">◈</span>
                <span style="color: var(--color-accent); font-weight: 700;">The Europa Solution</span>
              </div>
              <h3 class="problem-col-title">Continuous event correlation and explainable review priority</h3>
              <ul class="problem-list">
                <li class="problem-item">
                  <span class="solution-bullet">•</span>
                  <span><strong>Deterministic Canonical Pair Keying:</strong> Automatically groups encounters by sorted NORAD catalog IDs (<code>min(id1, id2) : max(id1, id2)</code>), maintaining an unbroken timeline across all snapshot updates.</span>
                </li>
                <li class="problem-item">
                  <span class="solution-bullet">•</span>
                  <span><strong>Explainable 0–100 Priority Scoring:</strong> Transparent multi-factor assessment evaluating miss distance contraction, time to encounter, and screening bounds into deterministic urgency tiers.</span>
                </li>
                <li class="problem-item">
                  <span class="solution-bullet">•</span>
                  <span><strong>Cryptographic Audit Ledger:</strong> Every ingestion, assessment, and operator decision is anchored in an append-only SHA-256 hash chain protected by database triggers.</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <!-- Section D: Product Showcase -->
      <section class="landing-section" id="showcase">
        <div class="landing-container">
          <span class="section-tag section-tag-teal">02 / Verified Interface</span>
          <h2 class="section-title">
            Built for mission analysts and orbital flight directors.
          </h2>
          <p class="section-lead">
            Inspect the genuine, live analytical workbench. Europa provides dense telemetry, interactive prediction evolution curves, experimental SGP4 screening, and cryptographic ledger verification.
          </p>

          <div class="showcase-wrapper">
            <div class="showcase-tabs-bar" role="tablist" aria-label="Showcase View Selector">
              <button class="showcase-tab active" data-shot="01" role="tab" aria-selected="true">
                01. Operational Overview
              </button>
              <button class="showcase-tab" data-shot="03" role="tab" aria-selected="false">
                02. Trajectory Evolution
              </button>
              <button class="showcase-tab" data-shot="04" role="tab" aria-selected="false">
                03. SGP4 Screening
              </button>
              <button class="showcase-tab" data-shot="06" role="tab" aria-selected="false">
                04. Cryptographic Audit
              </button>
            </div>

            <div class="showcase-display">
              <div class="showcase-image-frame">
                <img
                  id="showcase-active-img"
                  src="/assets/screenshots/01_dashboard_overview.png"
                  alt="Europa operational dashboard overview displaying KPI cards, encounter triage status, and latest snapshot telemetry"
                  class="showcase-image"
                  loading="lazy"
                />
              </div>

              <div class="showcase-caption">
                <div class="showcase-caption-text" id="showcase-caption-text">
                  <strong>Operational Dashboard Overview:</strong> Live telemetry KPI cards, 5.000 km threshold monitoring, encounter urgency tier distribution, and completed snapshot batch provenance.
                </div>
                <span class="showcase-meta-tag" id="showcase-meta-tag">GENUINE RUNTIME SCREENSHOT (1440x900)</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Section E: Platform Capabilities -->
      <section class="landing-section" id="capabilities">
        <div class="landing-container">
          <span class="section-tag">03 / Engineering Capabilities</span>
          <h2 class="section-title">
            Complete Space Situational Awareness workbench.
          </h2>
          <p class="section-lead">
            Six purpose-built engines engineered specifically for satellite conjunction surveillance and reproducible flight dynamics analysis.
          </p>

          <div class="capabilities-grid">
            <!-- 1. Ingestion -->
            <div class="capability-card">
              <div class="capability-icon-wrap">⤓</div>
              <h3 class="capability-title">Streaming Ingestion &amp; Provenance</h3>
              <p class="capability-desc">
                Memory-bounded RFC 4180 CSV parser supporting 6-digit NORAD IDs and scientific notation. Computes SHA-256 snapshot checksums for strict idempotency and stores unaltered raw observations.
              </p>
              <span class="capability-pill">STREAMING RFC 4180</span>
            </div>

            <!-- 2. Correlation -->
            <div class="capability-card">
              <div class="capability-icon-wrap">☍</div>
              <h3 class="capability-title">Event Correlation &amp; Drift Windowing</h3>
              <p class="capability-desc">
                Groups conjunction pairs using canonical pair keying (<code>min:max NORAD</code>). Employs adaptive 20m step and 45m cumulative drift tolerances with two-key PostgreSQL transaction advisory locks.
              </p>
              <span class="capability-pill">ADVISORY LOCKING</span>
            </div>

            <!-- 3. Assessment -->
            <div class="capability-card">
              <div class="capability-icon-wrap">◈</div>
              <h3 class="capability-title">Explainable Priority Scoring</h3>
              <p class="capability-desc">
                Transparent 0–100 index evaluating miss distance (50%), time to TCA (30%), upper-bound screening metric (15%), and data freshness (5%), mapping to deterministic urgency tiers.
              </p>
              <span class="capability-pill">0–100 EXPLAINABLE</span>
            </div>

            <!-- 4. Review -->
            <div class="capability-card">
              <div class="capability-icon-wrap">✓</div>
              <h3 class="capability-title">Operator Review Workflows</h3>
              <p class="capability-desc">
                Records operator actions (<code>ACKNOWLEDGE</code>, <code>ESCALATE</code>, <code>DISMISS</code>) with mandatory technical justifications. Automatically flags <code>REQUIRES_RE_REVIEW</code> whenever miss distance tightens by ≥ 20%.
              </p>
              <span class="capability-pill">TIMING-SAFE AUTH</span>
            </div>

            <!-- 5. Audit -->
            <div class="capability-card">
              <div class="capability-icon-wrap">🔒</div>
              <h3 class="capability-title">Hash-Chained Audit Ledger</h3>
              <p class="capability-desc">
                Append-only SHA-256 ledger chaining every batch, observation, review, and screening from genesis to head. Protected by SQL triggers prohibiting UPDATE and DELETE mutations.
              </p>
              <span class="capability-pill">SHA-256 INTEGRITY</span>
            </div>

            <!-- 6. SGP4 -->
            <div class="capability-card">
              <div class="capability-icon-wrap">∿</div>
              <h3 class="capability-title">Experimental SGP4 Screening</h3>
              <p class="capability-desc">
                Propagates NORAD Two-Line Elements across coarse and fine (100 ms) resolution windows to refine encounter geometry, relative velocity, and closest approach range profile.
              </p>
              <span class="capability-pill">EXPERIMENTAL TOOL</span>
            </div>
          </div>
        </div>
      </section>

      <!-- Section F: How It Works / Engineering Sequence -->
      <section class="landing-section" id="workflow">
        <div class="landing-container">
          <span class="section-tag section-tag-teal">04 / Pipeline Architecture</span>
          <h2 class="section-title">
            The end-to-end analytical pipeline.
          </h2>
          <p class="section-lead">
            How raw public satellite ephemeris observations transform into auditable, prioritize-scored flight safety decisions.
          </p>

          <div class="workflow-sequence">
            <div class="workflow-step-card">
              <span class="workflow-step-num">STEP 01</span>
              <h3 class="workflow-step-name">Ingest</h3>
              <p class="workflow-step-desc">
                Streaming parse of SOCRATES CSV snapshot, SHA-256 archive checksumming, and catalog upsert.
              </p>
            </div>
            <div class="workflow-step-card">
              <span class="workflow-step-num">STEP 02</span>
              <h3 class="workflow-step-name">Correlate</h3>
              <p class="workflow-step-desc">
                Two-key advisory locked grouping into persistent encounter events under temporal drift boundaries.
              </p>
            </div>
            <div class="workflow-step-card">
              <span class="workflow-step-num">STEP 03</span>
              <h3 class="workflow-step-name">Assess</h3>
              <p class="workflow-step-desc">
                Deterministic 0–100 priority score calculation and urgency classification (LOW to CRITICAL).
              </p>
            </div>
            <div class="workflow-step-card">
              <span class="workflow-step-num">STEP 04</span>
              <h3 class="workflow-step-name">Review</h3>
              <p class="workflow-step-desc">
                Flight director justified decision recording with automatic re-review triggers on trajectory contraction.
              </p>
            </div>
            <div class="workflow-step-card">
              <span class="workflow-step-num">STEP 05</span>
              <h3 class="workflow-step-name">Verify</h3>
              <p class="workflow-step-desc">
                Continuous cryptographic audit ledger validation verifying unbroken SHA-256 chain continuity.
              </p>
            </div>
          </div>
        </div>
      </section>

      <!-- Section G: Trust & Scientific Boundaries -->
      <section class="landing-section" id="limitations">
        <div class="landing-container">
          <div class="limitations-box">
            <div class="limitations-header">
              <span class="limitations-badge">Scientific Integrity &amp; Scope</span>
              <span style="font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-muted);">
                ESTABLISHED ASTRODYNAMIC BOUNDARIES
              </span>
            </div>

            <h3 style="font-family: var(--font-display); font-size: var(--text-2xl); font-weight: 700; color: var(--text-editorial); margin-bottom: var(--space-2);">
              Analytical Research Workbench — Not Certified Flight Control
            </h3>
            <p style="font-size: var(--text-base); color: var(--text-secondary); line-height: 1.6; max-width: 800px;">
              Europa is an operational research and analytical workbench for conjunction triage. Credibility in space situational awareness requires transparently communicating what the system does and does not do.
            </p>

            <div class="limitations-grid">
              <div class="limitation-item">
                <h4 class="limitation-title">Review Priority is an Analytical Heuristic</h4>
                <p class="limitation-text">
                  The 0–100 score is an operational triage heuristic to prioritize analyst attention, <strong>not</strong> an authoritative collision probability ($P_c$).
                </p>
              </div>

              <div class="limitation-item">
                <h4 class="limitation-title">Absence of Covariance Matrices</h4>
                <p class="limitation-text">
                  Public Two-Line Elements do not include error covariance. Computing calibrated, physically meaningful collision probabilities requires primary radar covariance.
                </p>
              </div>

              <div class="limitation-item">
                <h4 class="limitation-title">MAX_PROB is an Upper-Bound Screening Metric</h4>
                <p class="limitation-text">
                  The <code>MAX_PROB</code> metric in SOCRATES reports represents an upper-bound screening metric under worst-case covariance orientation, not an observed probability.
                </p>
              </div>

              <div class="limitation-item">
                <h4 class="limitation-title">Experimental SGP4 Trajectory Propagation</h4>
                <p class="limitation-text">
                  SGP4 models mean orbital elements under low-order gravity. LEO positional uncertainty typically degrades by 1–3 km per day and must not command spacecraft maneuvers.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Section H: Architecture & Final Call-to-Action -->
      <section class="landing-section" id="architecture">
        <div class="landing-container">
          <span class="section-tag">05 / Technical Specifications</span>
          <h2 class="section-title">
            Engineered for high-throughput operational safety.
          </h2>
          <p class="section-lead">
            Modern Node.js 22 LTS modular monolith backed by transactional PostgreSQL 16 persistence and zero-dependency frontend engineering.
          </p>

          <div class="architecture-grid">
            <div class="arch-card">
              <span class="arch-title">Application Engine</span>
              <span class="arch-val">Node.js 22 LTS</span>
              <span class="arch-sub">Express 5 ESM Monolith</span>
            </div>
            <div class="arch-card">
              <span class="arch-title">Database Storage</span>
              <span class="arch-val">PostgreSQL 16</span>
              <span class="arch-sub">Advisory Locks &amp; Triggers</span>
            </div>
            <div class="arch-card">
              <span class="arch-title">Ingestion Throughput</span>
              <span class="arch-val">2,862 rows/sec</span>
              <span class="arch-sub">Verified benchmark baseline</span>
            </div>
            <div class="arch-card">
              <span class="arch-title">API Latency</span>
              <span class="arch-val">&lt; 1.0 ms (p95)</span>
              <span class="arch-sub">Composite indexed queries</span>
            </div>
          </div>

          <!-- Final Call to Action -->
          <div class="final-cta-card">
            <h3 class="final-cta-title">Ready to explore satellite close-approaches?</h3>
            <p class="final-cta-lead">
              Access the analytical workbench directly. Review pre-loaded synthetic encounters, run orbital trajectory screenings, and verify cryptographic ledger integrity.
            </p>
            <div class="final-cta-buttons">
              <a href="#overview" id="btn-final-open-app" class="btn-hero-primary" role="button">
                <span>Launch Operational Workspace</span>
                <span aria-hidden="true">◈</span>
              </a>
              <a href="https://github.com/Ayush-o1/Europa" target="_blank" rel="noopener noreferrer" class="btn-hero-secondary">
                <span>View GitHub Repository</span>
                <span aria-hidden="true">↗</span>
              </a>
            </div>
          </div>
        </div>
      </section>

      <!-- Section I: Footer -->
      <footer class="landing-footer">
        <div class="landing-container">
          <div class="footer-top">
            <div class="footer-brand-col">
              <a href="#home" class="landing-brand">
                <span class="landing-brand-emblem" aria-hidden="true">◈</span>
                <span class="landing-brand-name">Europa</span>
              </a>
              <p class="footer-desc">
                Analytical space situational awareness workbench for satellite close-approach correlation, prediction evolution tracking, and auditable operational reviews.
              </p>
            </div>

            <div class="footer-links-col">
              <span class="footer-col-title">Platform</span>
              <a href="#overview" class="footer-link">Operational Overview</a>
              <a href="#events" class="footer-link">Triage Queue</a>
              <a href="#propagation" class="footer-link">Orbital Screening</a>
              <a href="#ingestion" class="footer-link">Snapshot Ingestion</a>
              <a href="#audit" class="footer-link">Audit Ledger</a>
            </div>

            <div class="footer-links-col">
              <span class="footer-col-title">Documentation</span>
              <a href="/docs/architecture.md" class="footer-link" target="_blank">System Architecture</a>
              <a href="/docs/api.md" class="footer-link" target="_blank">REST API Reference</a>
              <a href="/docs/deployment-runbook.md" class="footer-link" target="_blank">Deployment Runbook</a>
              <a href="/docs/data-and-limitations.md" class="footer-link" target="_blank">Scientific Boundaries</a>
            </div>

            <div class="footer-links-col">
              <span class="footer-col-title">Open Source</span>
              <a href="https://github.com/Ayush-o1/Europa" class="footer-link" target="_blank" rel="noopener noreferrer">GitHub Repository</a>
              <a href="https://github.com/Ayush-o1/Europa/blob/main/LICENSE" class="footer-link" target="_blank" rel="noopener noreferrer">MIT License</a>
              <a href="/docs/launch-checklist.md" class="footer-link" target="_blank">Launch Checklist</a>
            </div>
          </div>

          <div class="footer-bottom">
            <span>© 2026 Europa SSA Project. Open-source software released under the MIT License.</span>
            <span>NOT CERTIFIED FOR OPERATIONAL FLIGHT MANEUVER CONTROL</span>
          </div>
        </div>
      </footer>
    </div>
  `;

  // Attach interactive behaviors
  setupLandingInteractions(container);
}

/**
 * Attaches interactive controls for the landing page:
 * - Mobile navigation menu toggle
 * - Showcase screenshot switcher tabs
 * - Smooth scrolling for in-page anchors
 * - Direct routing to workspace
 */
function setupLandingInteractions(container) {
  // 1. Mobile Menu Toggle
  const menuBtn = container.querySelector('#landing-menu-btn');
  const drawer = container.querySelector('#landing-mobile-drawer');

  if (menuBtn && drawer) {
    menuBtn.addEventListener('click', () => {
      const isOpen = drawer.classList.contains('open');
      drawer.classList.toggle('open', !isOpen);
      menuBtn.setAttribute('aria-expanded', String(!isOpen));
      menuBtn.textContent = isOpen ? '☰' : '✕';
    });

    // Close on navigation click
    drawer.querySelectorAll('.mobile-nav-item').forEach(item => {
      item.addEventListener('click', () => {
        drawer.classList.remove('open');
        menuBtn.setAttribute('aria-expanded', 'false');
        menuBtn.textContent = '☰';
      });
    });

    // Close on Escape key
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape' && drawer.classList.contains('open')) {
        drawer.classList.remove('open');
        menuBtn.setAttribute('aria-expanded', 'false');
        menuBtn.textContent = '☰';
      }
    });
  }

  // 2. Showcase Screenshot Switcher
  const showcaseTabs = container.querySelectorAll('.showcase-tab');
  const activeImg = container.querySelector('#showcase-active-img');
  const captionText = container.querySelector('#showcase-caption-text');
  const metaTag = container.querySelector('#showcase-meta-tag');

  const shots = {
    '01': {
      src: '/assets/screenshots/01_dashboard_overview.png',
      caption:
        '<strong>Operational Dashboard Overview:</strong> Live telemetry KPI cards, 5.000 km threshold monitoring, encounter urgency tier distribution, and completed snapshot batch provenance.',
      meta: 'DASHBOARD VIEW (1440x900)',
      alt: 'Europa operational dashboard overview displaying KPI cards and encounter urgency breakdown',
    },
    '03': {
      src: '/assets/screenshots/03_event_detail_and_evolution.png',
      caption:
        '<strong>Event Detail & Prediction Evolution:</strong> Chronological observation history, interactive SVG miss distance evolution chart showing tightening encounter, and review-priority assessment breakdown.',
      meta: 'EVENT EVOLUTION VIEW (1440x900)',
      alt: 'Conjunction encounter detail showing SVG range evolution chart and multi-factor score breakdown',
    },
    '04': {
      src: '/assets/screenshots/04_sgp4_orbital_screening.png',
      caption:
        '<strong>Experimental SGP4 Orbital Screening:</strong> Two-Line Element set orbit propagation via satellite.js, coarse-to-fine step analysis, and closest approach range profile curve.',
      meta: 'SGP4 ASTRODYNAMICS (1440x900)',
      alt: 'SGP4 orbital trajectory screening workbench with encounter profile chart',
    },
    '06': {
      src: '/assets/screenshots/06_audit_ledger_verification.png',
      caption:
        '<strong>Cryptographic Audit Ledger:</strong> Real-time SHA-256 hash-chain verification from genesis to head across 17 immutable event, review, and screening records.',
      meta: 'CRYPTOGRAPHIC AUDIT (1440x900)',
      alt: 'Audit ledger verification interface reporting valid hash chain status across 17 records',
    },
  };

  showcaseTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      showcaseTabs.forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');

      const shotId = tab.getAttribute('data-shot');
      const data = shots[shotId] || shots['01'];

      if (activeImg) {
        activeImg.src = data.src;
        activeImg.alt = data.alt;
      }
      if (captionText) captionText.innerHTML = data.caption;
      if (metaTag) metaTag.textContent = data.meta;
    });
  });

  // 3. Workspace CTAs -> Switch to Workspace
  const openAppButtons = [
    container.querySelector('#btn-nav-open-app'),
    container.querySelector('#btn-hero-open-app'),
    container.querySelector('#btn-mobile-open-app'),
    container.querySelector('#btn-final-open-app'),
  ];

  openAppButtons.forEach(btn => {
    btn?.addEventListener('click', e => {
      e.preventDefault();
      state.set('currentView', 'overview');
      window.location.hash = 'overview';
    });
  });
}
