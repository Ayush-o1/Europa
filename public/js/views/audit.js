/**
 * @fileoverview Cryptographic Audit Ledger Verification View
 *
 * Provides a dedicated, read-only interface to execute end-to-end cryptographic
 * verification of the SHA-256 hash-chained audit ledger from genesis to head.
 */

import { api } from '../apiClient.js';
import { showToast } from '../components/toast.js';
import { escapeHtml, formatUtc } from '../utils.js';

export async function renderAudit(container) {
  container.innerHTML = `
    <div class="view-header">
      <div class="view-header-main">
        <h1 class="view-title">Cryptographic Audit Ledger</h1>
        <p class="view-desc">
          Inspect and cryptographically verify Europa's append-only, SHA-256 hash-chained audit ledger.
          Every conjunction event creation, correlation decision, priority assessment, and operator review is immutably recorded.
        </p>
      </div>
      <div class="view-actions">
        <button id="btn-run-verification" class="btn btn-primary btn-sm">
          🔒 Run Cryptographic Verification
        </button>
      </div>
    </div>

    <!-- Verification Results Card -->
    <div id="verification-card-wrapper">
      <div class="card verification-card verified" style="margin-bottom: var(--space-6);">
        <div class="verification-status-group" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: var(--space-3);">
          <div>
            <div class="verification-title" style="font-weight: 700; font-size: var(--text-md); color: var(--text-primary); margin-bottom: 2px;">
              <span>●</span> Cryptographic Audit Ledger Status: Ready
            </div>
            <div class="verification-details" style="font-size: var(--text-xs); color: var(--text-secondary);">
              Click "Run Cryptographic Verification" above to validate the complete hash-chain from genesis (0000...0000) to current head.
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Scientific & Architectural Integrity Notice -->
    <div class="methodology-notice" style="margin-bottom: var(--space-6);">
      <span style="font-size: 16px;">🛡</span>
      <div>
        <strong>Integrity &amp; Cryptographic Model Notice:</strong> Europa implements a database-level SHA-256 hash-chained ledger.
        Each entry seals its sequence number, action type, actor attribution, canonical JSON payload, predecessor hash, and timestamp.
        Database-level anti-tampering triggers prohibit SQL UPDATE and DELETE operations.
        <em style="display: block; margin-top: var(--space-1); color: var(--text-muted);">
          Scope Limitation: Local hash-chaining reliably detects row modifications, payload alterations, deletions, and sequence gaps,
          but cannot prevent privileged superuser filesystem manipulation without external distributed anchoring.
        </em>
      </div>
    </div>

    <!-- Verification Log Details -->
    <div id="verification-diagnostic-panel" style="display: none; margin-bottom: var(--space-6);"></div>

    <!-- Audit Ledger Information Cards -->
    <div class="metrics-grid">
      <div class="metric-card accent-brand">
        <span class="metric-label">Ledger Architecture</span>
        <span class="metric-value" style="font-size: var(--text-xl);">SHA-256 Chain</span>
        <span class="metric-subtext">Genesis: 64 zero-bytes</span>
      </div>
      <div class="metric-card accent-critical" style="--metric-accent: var(--color-success);">
        <span class="metric-label">Database Guard</span>
        <span class="metric-value" style="font-size: var(--text-xl); color: var(--color-success);">Strict Append-Only</span>
        <span class="metric-subtext">UPDATE &amp; DELETE prohibited by trigger</span>
      </div>
      <div class="metric-card accent-medium">
        <span class="metric-label">Payload Normalization</span>
        <span class="metric-value" style="font-size: var(--text-xl);">Deterministic</span>
        <span class="metric-subtext">Recursive alphabetical key sorting</span>
      </div>
      <div class="metric-card accent-low">
        <span class="metric-label">Integrity Endpoint</span>
        <span class="metric-value" style="font-size: var(--text-xl); color: var(--color-low);">Read-Only</span>
        <span class="metric-subtext">No destructive controls exposed</span>
      </div>
    </div>
  `;

  const btnVerify = container.querySelector('#btn-run-verification');
  btnVerify?.addEventListener('click', () => runVerification(container));

  // Run initial verification automatically on load
  await runVerification(container);
}

async function runVerification(container) {
  const cardWrapper = container.querySelector('#verification-card-wrapper');
  const diagPanel = container.querySelector('#verification-diagnostic-panel');
  const btnVerify = container.querySelector('#btn-run-verification');

  if (!cardWrapper) return;

  if (btnVerify) {
    btnVerify.disabled = true;
    btnVerify.textContent = 'Verifying hash chain...';
  }

  try {
    const res = await api.verifyAudit();
    const result = res.data;

    if (result.verified) {
      showToast(
        `Audit ledger verified successfully! (${result.recordsChecked} records checked)`,
        'success',
      );

      cardWrapper.innerHTML = `
        <div class="card verification-card verified" style="margin-bottom: var(--space-6);">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: var(--space-3);">
            <div class="verification-status-group">
              <div class="verification-title" style="font-weight: 700; font-size: var(--text-md); color: var(--color-success); margin-bottom: 2px;">
                <span>✓</span> Cryptographic Hash Chain Verified (Integrity Valid)
              </div>
              <div class="verification-details" style="font-size: var(--text-xs); color: var(--text-secondary); font-family: var(--font-mono);">
                Total Entries Checked: ${result.recordsChecked} | Sequence Continuity: 100% | Predecessor Hashes Linked: 100% | Verified at: ${formatUtc(new Date())}
              </div>
            </div>
            <span class="badge badge-success" style="font-size: var(--text-sm); padding: var(--space-1) var(--space-3);">
              CHAIN INTACT
            </span>
          </div>
        </div>
      `;

      if (diagPanel) {
        diagPanel.style.display = 'block';
        diagPanel.innerHTML = `
          <div class="card" style="padding: var(--space-4);">
            <h3 class="card-title" style="font-size: var(--text-sm); margin-bottom: var(--space-2);">
              Verification Summary
            </h3>
            <div style="font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-secondary); display: flex; flex-direction: column; gap: var(--space-1);">
              <div>✓ Genesis block checked against 64 zero-hex predecessor.</div>
              <div>✓ Every entry sequence number verified with zero gaps (N = ${result.recordsChecked}).</div>
              <div>✓ Payloads canonically stringified and SHA-256 digests validated against database stored hash.</div>
              <div>✓ Zero broken links detected across the complete ledger.</div>
            </div>
          </div>
        `;
      }
    } else {
      showToast('Integrity failure detected in audit ledger!', 'error');

      cardWrapper.innerHTML = `
        <div class="card verification-card failed" style="margin-bottom: var(--space-6); border-color: var(--color-critical-border);">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: var(--space-3);">
            <div class="verification-status-group">
              <div class="verification-title" style="font-weight: 700; font-size: var(--text-md); color: var(--color-critical); margin-bottom: 2px;">
                <span>✕</span> Cryptographic Integrity Problem Detected
              </div>
              <div class="verification-details" style="font-size: var(--text-xs); color: var(--text-primary); font-family: var(--font-mono);">
                Failed at sequence: #${result.firstBrokenRecordSequence || 'Unknown'} | Error: ${escapeHtml(result.error || 'Hash mismatch')}
              </div>
            </div>
            <span class="badge badge-critical" style="font-size: var(--text-sm); padding: var(--space-1) var(--space-3);">
              TAMPER DETECTED
            </span>
          </div>
        </div>
      `;

      if (diagPanel) {
        diagPanel.style.display = 'block';
        diagPanel.innerHTML = `
          <div class="card" style="border-color: var(--color-critical-border); padding: var(--space-4);">
            <h3 class="card-title" style="color: var(--color-critical); font-size: var(--text-sm); margin-bottom: var(--space-2);">
              Integrity Problem Diagnostic
            </h3>
            <p style="font-size: var(--text-xs); font-family: var(--font-mono); color: var(--text-primary); margin: 0;">
              ${escapeHtml(result.error)}
            </p>
          </div>
        `;
      }
    }
  } catch (err) {
    showToast(`Verification query failed: ${err.message}`, 'error');
    cardWrapper.innerHTML = `
      <div class="card verification-card failed" style="margin-bottom: var(--space-6);">
        <div class="verification-status-group">
          <div class="verification-title" style="color: var(--color-critical); font-weight: 700;">
            <span>⚠</span> Verification Query Error
          </div>
          <div class="verification-details" style="font-size: var(--text-xs); color: var(--text-secondary);">
            ${escapeHtml(err.message)}
          </div>
        </div>
      </div>
    `;
  } finally {
    if (btnVerify) {
      btnVerify.disabled = false;
      btnVerify.textContent = '🔒 Run Cryptographic Verification';
    }
  }
}
