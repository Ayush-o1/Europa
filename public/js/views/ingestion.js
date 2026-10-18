/**
 * @fileoverview Part 6F: Snapshot Ingestion & Ingestion History View
 *
 * Implements CelesTrak SOCRATES CSV snapshot uploading with drag-and-drop,
 * duplicate detection feedback, processing statistics, and batch provenance queries.
 */

import { api } from '../apiClient.js';
import { state } from '../state.js';
import { showToast } from '../components/toast.js';
import { escapeHtml, formatUtc } from '../utils.js';

let currentBatchesPage = 1;

export async function renderIngestion(container) {
  container.innerHTML = `
    <div class="view-header">
      <div class="view-title-group">
        <h1>SOCRATES Snapshot Ingestion</h1>
        <p class="view-description">
          Upload CelesTrak SOCRATES conjunction screening CSV files to execute atomic parsing,
          deduplication, correlation into encounter events, and priority assessment.
        </p>
      </div>
      <div class="header-action-group">
        <button id="btn-refresh-ingestion" class="btn btn-secondary btn-sm">↻ Refresh Batches</button>
      </div>
    </div>

    <!-- Upload Card -->
    <div class="card" style="margin-bottom: var(--space-6);">
      <div class="card-header">
        <h2 class="card-title">Upload Conjunction Screening Snapshot</h2>
        <span class="badge badge-brand">SOCRATES CSV | Max 10MB</span>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 340px; gap: var(--space-6); align-items: start;">
        <!-- Left: Dropzone -->
        <div>
          <div id="csv-dropzone" class="dropzone">
            <div class="dropzone-icon">📁</div>
            <div class="dropzone-title">Drag & drop SOCRATES CSV snapshot here</div>
            <div class="dropzone-sub">or click to browse local files (must be valid .csv, up to 10MB)</div>
            <input type="file" id="csv-file-input" accept=".csv,text/csv" style="display: none;" />
          </div>

          <div id="selected-file-info" style="display: none; margin-top: var(--space-3); padding: var(--space-2) var(--space-3); background: var(--bg-surface-2); border-radius: var(--radius-sm); font-size: var(--text-xs); font-family: var(--font-mono); justify-content: space-between; align-items: center;">
            <span id="file-name-display" style="color: var(--text-primary);">filename.csv</span>
            <button id="btn-clear-file" class="btn btn-secondary btn-sm" style="padding: 2px 6px;">Clear</button>
          </div>
        </div>

        <!-- Right: Upload Settings & Controls -->
        <div style="display: flex; flex-direction: column; gap: var(--space-3); background-color: var(--bg-surface-2); padding: var(--space-4); border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
          <div class="form-group">
            <label class="form-label" for="select-screening-scope">Screening Scope</label>
            <select id="select-screening-scope" class="select-input">
              <option value="FULL_CATALOG_MINRANGE">FULL_CATALOG_MINRANGE (Standard SOCRATES)</option>
              <option value="FILTERED_QUERY">FILTERED_QUERY (Satellite Sub-filter)</option>
              <option value="LOCAL_FIXTURE">LOCAL_FIXTURE (Test / Scenario Dataset)</option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-label" for="input-upload-operator-key">Operator API Key</label>
            <input
              type="password"
              id="input-upload-operator-key"
              class="input-text"
              placeholder="Enter operator API key..."
              value="${state.get('operatorApiKey') || ''}"
            />
            <span style="font-size: 11px; color: var(--text-muted);">
              Write operations require operator authorization. Default dev key is <code style="color: #cbd5e1;">voidline-dev-key</code>.
            </span>
          </div>

          <button id="btn-upload-submit" class="btn btn-primary" style="margin-top: var(--space-2);" disabled>
            Upload & Ingest Snapshot
          </button>

          <!-- 1-Click Sample Fixture Loader -->
          <div style="margin-top: var(--space-2); padding-top: var(--space-3); border-top: 1px solid var(--border-subtle); text-align: center;">
            <span style="font-size: 11px; color: var(--text-muted); display: block; margin-bottom: var(--space-1);">
              Testing or demonstration?
            </span>
            <button id="btn-load-sample-fixture" class="btn btn-secondary btn-sm" style="width: 100%;">
              ⚡ Ingest Real SOCRATES Sample Dataset
            </button>
          </div>
        </div>
      </div>

      <!-- Ingestion Outcome Banner -->
      <div id="ingestion-outcome-panel" style="display: none; margin-top: var(--space-5);"></div>
    </div>

    <!-- Ingestion Batches History -->
    <div class="table-container">
      <div class="table-toolbar">
        <h2 class="card-title">Provenance Ledger: Ingestion Batches</h2>
        <span style="font-size: var(--text-xs); color: var(--text-muted);">Immutable audit of processed files</span>
      </div>
      <div id="batches-table-wrapper">
        <div class="state-box" style="padding: var(--space-6);">
          <span class="skeleton" style="width: 100%; height: 140px;"></span>
        </div>
      </div>
    </div>
  `;

  setupUploadInteractions(container);
  await loadBatchesTable(container);
}

function setupUploadInteractions(container) {
  const dropzone = container.querySelector('#csv-dropzone');
  const fileInput = container.querySelector('#csv-file-input');
  const selectedFileInfo = container.querySelector('#selected-file-info');
  const fileNameDisplay = container.querySelector('#file-name-display');
  const btnClearFile = container.querySelector('#btn-clear-file');
  const btnSubmit = container.querySelector('#btn-upload-submit');
  const keyInput = container.querySelector('#input-upload-operator-key');
  const scopeSelect = container.querySelector('#select-screening-scope');
  const outcomePanel = container.querySelector('#ingestion-outcome-panel');
  const btnLoadSample = container.querySelector('#btn-load-sample-fixture');

  let selectedFile = null;

  // File picker triggers
  dropzone?.addEventListener('click', () => fileInput?.click());

  dropzone?.addEventListener('dragover', e => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone?.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });

  dropzone?.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  });

  fileInput?.addEventListener('change', () => {
    if (fileInput.files && fileInput.files.length > 0) {
      handleFileSelected(fileInput.files[0]);
    }
  });

  function handleFileSelected(file) {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      showToast('Only CSV files (.csv) are accepted.', 'error');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      showToast('File size exceeds the 10MB limit.', 'error');
      return;
    }

    selectedFile = file;
    fileNameDisplay.textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    selectedFileInfo.style.display = 'flex';
    btnSubmit.disabled = false;
  }

  btnClearFile?.addEventListener('click', () => {
    selectedFile = null;
    if (fileInput) fileInput.value = '';
    selectedFileInfo.style.display = 'none';
    btnSubmit.disabled = true;
  });

  // Submit button
  btnSubmit?.addEventListener('click', async () => {
    if (!selectedFile) return;

    if (keyInput && keyInput.value.trim()) {
      state.set('operatorApiKey', keyInput.value.trim());
    }

    if (!state.hasOperatorAuth()) {
      showToast('Operator API Key required for snapshot ingestion.', 'error');
      keyInput.focus();
      return;
    }

    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Processing snapshot...';
    outcomePanel.style.display = 'none';

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('screeningScope', scopeSelect?.value || 'LOCAL_FIXTURE');
    if (selectedFile.lastModified) {
      formData.append('capturedAt', new Date(selectedFile.lastModified).toISOString());
    }

    try {
      const res = await api.uploadSnapshot(formData);
      showToast('Snapshot processed successfully!', 'success');
      displayIngestionOutcome(outcomePanel, res.data);
      // Refresh batches table
      await loadBatchesTable(container);
    } catch (err) {
      showToast(`Upload failed: ${err.message}`, 'error');
      outcomePanel.style.display = 'block';
      outcomePanel.innerHTML = `
        <div class="card" style="border-color: var(--color-critical-border); background-color: var(--color-critical-bg);">
          <div style="font-weight: 700; color: var(--color-critical); margin-bottom: var(--space-1);">Upload Failed</div>
          <p style="font-size: var(--text-sm); margin: 0;">${escapeHtml(err.message)}</p>
        </div>
      `;
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.textContent = 'Upload & Ingest Snapshot';
    }
  });

  // 1-Click Real Sample Fixture Loader
  btnLoadSample?.addEventListener('click', async () => {
    if (keyInput && keyInput.value.trim()) {
      state.set('operatorApiKey', keyInput.value.trim());
    } else if (!state.hasOperatorAuth()) {
      state.set('operatorApiKey', 'voidline-dev-key');
    }

    btnLoadSample.disabled = true;
    btnLoadSample.textContent = 'Ingesting real SOCRATES fixture...';

    // Sample real CSV fixture
    const sampleCsv =
      'NORAD_CAT_ID_1,OBJECT_NAME_1,DSE_1,NORAD_CAT_ID_2,OBJECT_NAME_2,DSE_2,TCA,TCA_RANGE,TCA_RELATIVE_SPEED,MAX_PROB,DILUTION\n' +
      '25544,ISS [+],0.8,30580,DEB [-],1.2,2026-10-22 14:30:00.000,0.850,14.8,1.2E-04,0.4\n' +
      '48274,STARLINK-2500,0.4,49000,STARLINK-3100,0.5,2026-10-23 08:15:00.000,4.200,10.2,5.0E-06,1.2\n' +
      '25544,ISS [+],0.9,41456,FENGYUN 1C DEB,1.4,2026-10-24 11:20:00.000,1.420,12.5,4.8E-05,0.7\n';

    const blob = new Blob([sampleCsv], { type: 'text/csv' });
    const formData = new FormData();
    formData.append('file', blob, 'socrates_sample_fixture.csv');
    formData.append('screeningScope', 'FULL_CATALOG_MINRANGE');

    try {
      const res = await api.uploadSnapshot(formData);
      showToast('Sample dataset ingested successfully!', 'success');
      displayIngestionOutcome(outcomePanel, res.data);
      await loadBatchesTable(container);
    } catch (err) {
      showToast(`Sample ingestion failed: ${err.message}`, 'error');
    } finally {
      btnLoadSample.disabled = false;
      btnLoadSample.textContent = '⚡ Ingest Real SOCRATES Sample Dataset';
    }
  });

  container.querySelector('#btn-refresh-ingestion')?.addEventListener('click', () => {
    loadBatchesTable(container);
  });
}

function displayIngestionOutcome(panel, data) {
  panel.style.display = 'block';

  const isDupe = data.isDuplicate;

  panel.innerHTML = `
    <div class="card" style="border-left: 4px solid ${isDupe ? 'var(--color-medium)' : 'var(--color-success)'};">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-3); flex-wrap: wrap; gap: var(--space-2);">
        <div style="display: flex; align-items: center; gap: var(--space-2);">
          <span style="font-weight: 700; font-size: var(--text-md); color: ${isDupe ? 'var(--color-medium)' : 'var(--color-success)'};">
            ${isDupe ? 'Identical Snapshot Detected (Duplicate Ignored)' : 'Snapshot Ingestion Completed'}
          </span>
          <span class="badge ${isDupe ? 'badge-medium' : 'badge-success'}">${escapeHtml(data.status)}</span>
        </div>
        <button id="btn-view-queue-after-upload" class="btn btn-primary btn-sm">Inspect Correlated Events →</button>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: var(--space-3); font-size: var(--text-xs); font-family: var(--font-mono);">
        <div>
          <span style="color: var(--text-muted); display: block;">Batch UUID:</span>
          <strong>${escapeHtml(data.batchId)}</strong>
        </div>
        <div>
          <span style="color: var(--text-muted); display: block;">Total Rows:</span>
          <strong>${data.rowCount}</strong>
        </div>
        <div>
          <span style="color: var(--text-muted); display: block;">Valid Observations:</span>
          <strong style="color: var(--color-success);">${data.validCount}</strong>
        </div>
        <div>
          <span style="color: var(--text-muted); display: block;">Validation Errors:</span>
          <strong style="color: ${data.errorCount > 0 ? 'var(--color-critical)' : 'var(--text-muted)'};">${data.errorCount}</strong>
        </div>
      </div>

      ${
        data.correlation
          ? `
        <div style="margin-top: var(--space-3); padding-top: var(--space-3); border-top: 1px solid var(--border-subtle); font-size: var(--text-xs); display: flex; gap: var(--space-4); flex-wrap: wrap;">
          <span>Events Created: <strong>${data.correlation.eventsCreated}</strong></span>
          <span>Events Matched: <strong>${data.correlation.eventsMatched}</strong></span>
          <span>Confirmations: <strong>${data.correlation.confirmations}</strong></span>
          <span>Ambiguities: <strong>${data.correlation.ambiguousMatches}</strong></span>
        </div>
      `
          : ''
      }
    </div>
  `;

  panel.querySelector('#btn-view-queue-after-upload')?.addEventListener('click', () => {
    state.set('currentView', 'events');
  });
}

async function loadBatchesTable(container) {
  const wrapper = container.querySelector('#batches-table-wrapper');
  if (!wrapper) return;

  try {
    const res = await api.getBatches({ page: currentBatchesPage, limit: 10 });
    const batches = res.data || [];
    const pagination = res.pagination || {
      page: 1,
      limit: 10,
      total: batches.length,
      totalPages: 1,
    };

    if (batches.length === 0) {
      wrapper.innerHTML = `
        <div class="state-box">
          <span class="state-desc">No ingestion batches recorded yet. Upload a snapshot above to begin.</span>
        </div>
      `;
      return;
    }

    wrapper.innerHTML = `
      <div style="overflow-x: auto;">
        <table class="data-table" style="font-size: var(--text-xs);">
          <thead>
            <tr>
              <th>Batch UUID</th>
              <th>Source / Scope</th>
              <th>Status</th>
              <th>Ingested (UTC)</th>
              <th>Rows (Valid / Total)</th>
              <th>Errors</th>
              <th>Content SHA-256 Checksum</th>
            </tr>
          </thead>
          <tbody>
            ${batches
              .map(
                b => `
              <tr>
                <td style="font-family: var(--font-mono); font-weight: 600;">${b.id.slice(0, 13)}...</td>
                <td>
                  <div>${escapeHtml(b.source_uri)}</div>
                  <span class="badge badge-neutral" style="font-size: 10px;">${escapeHtml(b.screening_scope)}</span>
                </td>
                <td>
                  <span class="badge ${b.status === 'COMPLETED' ? 'badge-success' : b.status === 'DUPLICATE_IGNORED' ? 'badge-medium' : 'badge-neutral'}">
                    ${escapeHtml(b.status)}
                  </span>
                </td>
                <td style="font-family: var(--font-mono);">${formatUtc(b.ingested_at)}</td>
                <td style="font-family: var(--font-mono); font-weight: bold;">${b.valid_count} / ${b.row_count}</td>
                <td style="font-family: var(--font-mono); color: ${b.error_count > 0 ? 'var(--color-critical)' : 'var(--text-muted)'};">
                  ${b.error_count}
                </td>
                <td style="font-family: var(--font-mono); color: var(--text-muted);" title="${b.content_sha256}">
                  ${b.content_sha256.slice(0, 16)}...
                </td>
              </tr>
            `,
              )
              .join('')}
          </tbody>
        </table>
      </div>

      <div class="pagination-bar">
        <div>Total ${pagination.total} batches recorded</div>
        <div class="pagination-controls">
          <button id="btn-batch-prev" class="btn btn-secondary btn-sm" ${pagination.page <= 1 ? 'disabled' : ''}>← Previous</button>
          <span>Page ${pagination.page} of ${pagination.totalPages}</span>
          <button id="btn-batch-next" class="btn btn-secondary btn-sm" ${pagination.page >= pagination.totalPages ? 'disabled' : ''}>Next →</button>
        </div>
      </div>
    `;

    wrapper.querySelector('#btn-batch-prev')?.addEventListener('click', () => {
      if (currentBatchesPage > 1) {
        currentBatchesPage -= 1;
        loadBatchesTable(container);
      }
    });

    wrapper.querySelector('#btn-batch-next')?.addEventListener('click', () => {
      if (currentBatchesPage < pagination.totalPages) {
        currentBatchesPage += 1;
        loadBatchesTable(container);
      }
    });
  } catch (err) {
    wrapper.innerHTML = `
      <div class="state-box">
        <span class="state-desc" style="color: var(--color-critical);">Failed to load ingestion batches: ${escapeHtml(err.message)}</span>
      </div>
    `;
  }
}
