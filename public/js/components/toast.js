/**
 * @fileoverview Toast Notification Component
 * Displays non-blocking status and error toasts with auto-dismissal.
 */

let toastContainer = null;

function ensureContainer() {
  if (!toastContainer) {
    toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.id = 'toast-container';
      toastContainer.className = 'toast-container';
      document.body.appendChild(toastContainer);
    }
  }
}

/**
 * Shows a toast notification.
 * @param {string} message
 * @param {'success' | 'error' | 'info'} [type='info']
 * @param {number} [durationMs=4000]
 */
export function showToast(message, type = 'info', durationMs = 4000) {
  ensureContainer();

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', 'alert');

  const icon = type === 'success' ? '✓' : type === 'error' ? '⚠' : 'ℹ';
  toast.innerHTML = `<span style="font-weight: bold;">${icon}</span><span>${message}</span>`;

  toastContainer.appendChild(toast);

  const timeoutId = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    setTimeout(() => toast.remove(), 200);
  }, durationMs);

  toast.addEventListener('click', () => {
    clearTimeout(timeoutId);
    toast.remove();
  });
}
