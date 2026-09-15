'use strict';

/* Registers the service worker for offline play / "add to home
   screen". Entirely best-effort: service workers need a secure
   context (https, or localhost), so this silently does nothing
   when opened as a local file or over plain http — never an error,
   just no offline support in that case. */

if ('serviceWorker' in navigator && (window.isSecureContext || location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      /* offline support just won't be available this session */
    });
  });
}
