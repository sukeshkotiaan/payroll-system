/* toast.js — global toast notification system */
(function () {
  'use strict';

  let container = null;

  function getContainer() {
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    return container;
  }

  function show(message, type, duration) {
    type = type || 'info';
    duration = duration == null ? 3500 : duration;
    const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
    const c = getContainer();
    const el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ'}</span><span class="toast-msg">${message}</span>`;
    c.appendChild(el);

    if (duration > 0) {
      setTimeout(() => {
        el.classList.add('toast-out');
        el.addEventListener('animationend', () => el.remove(), { once: true });
        setTimeout(() => { if (el.parentNode) el.remove(); }, 400);
      }, duration);
    }
    return el;
  }

  window.toast = {
    success: (msg, ms) => show(msg, 'success', ms),
    error:   (msg, ms) => show(msg, 'error', ms),
    warning: (msg, ms) => show(msg, 'warning', ms),
    info:    (msg, ms) => show(msg, 'info', ms),
    show,
  };
})();
