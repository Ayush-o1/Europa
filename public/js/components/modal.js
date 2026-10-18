/**
 * @fileoverview Accessible Modal Dialog Component
 */

/**
 * Creates and manages an accessible modal dialog.
 * @param {object} options
 * @param {string} options.title
 * @param {string | HTMLElement} options.content
 * @param {Array<{ text: string, className?: string, onClick: (modal: any) => void }>} [options.actions=[]]
 * @param {() => void} [options.onClose]
 * @returns {{ open: () => void, close: () => void, element: HTMLElement }}
 */
export function createModal({ title, content, actions = [], onClose }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');

  const dialog = document.createElement('div');
  dialog.className = 'modal-dialog';

  // Header
  const header = document.createElement('div');
  header.className = 'modal-header';
  header.innerHTML = `
    <h2 class="modal-title">${title}</h2>
    <button class="modal-close" aria-label="Close modal">&times;</button>
  `;

  // Body
  const body = document.createElement('div');
  body.className = 'modal-body';
  if (typeof content === 'string') {
    body.innerHTML = content;
  } else if (content instanceof HTMLElement) {
    body.appendChild(content);
  }

  dialog.appendChild(header);
  dialog.appendChild(body);

  // Footer Actions
  if (actions.length > 0) {
    const footer = document.createElement('div');
    footer.className = 'modal-footer';

    actions.forEach(action => {
      const btn = document.createElement('button');
      btn.className = `btn ${action.className || 'btn-secondary'}`;
      btn.textContent = action.text;
      btn.addEventListener('click', () => action.onClick(modalApi));
      footer.appendChild(btn);
    });

    dialog.appendChild(footer);
  }

  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  const close = () => {
    backdrop.classList.remove('open');
    document.removeEventListener('keydown', handleKeyDown);
    setTimeout(() => backdrop.remove(), 200);
    if (onClose) onClose();
  };

  const open = () => {
    backdrop.classList.add('open');
    document.addEventListener('keydown', handleKeyDown);
    const firstInput = dialog.querySelector('input, select, textarea, button:not(.modal-close)');
    if (firstInput) {
      firstInput.focus();
    }
  };

  const handleKeyDown = e => {
    if (e.key === 'Escape') {
      close();
    }
  };

  header.querySelector('.modal-close')?.addEventListener('click', close);
  backdrop.addEventListener('click', e => {
    if (e.target === backdrop) {
      close();
    }
  });

  const modalApi = { open, close, element: backdrop };
  return modalApi;
}
