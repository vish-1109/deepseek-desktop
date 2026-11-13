'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const isBundleOfflinePage =
  window.location.protocol === 'app:' &&
  window.location.hostname === 'bundle' &&
  window.location.pathname === '/offline.html';

if (isBundleOfflinePage) {
  contextBridge.exposeInMainWorld(
    'deepseekOffline',
    Object.freeze({
      retryLoad: () => ipcRenderer.send('deepseek:retry-load'),
    }),
  );
}

const host = String(window.location.hostname || '').toLowerCase();
const isDeepSeekOrigin =
  window.location.protocol === 'https:' &&
  (host === 'deepseek.com' || host.endsWith('.deepseek.com'));

if (isDeepSeekOrigin) {
  window.addEventListener('error', (event) => {
    try {
      ipcRenderer.send('deepseek:renderer-error', {
        type: 'error',
        message: event.message || 'Unknown renderer error',
      });
    } catch {
      // Ignore reporting error
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    try {
      const reason =
        event.reason instanceof Error
          ? event.reason.message
          : String(event.reason || 'Unhandled rejection');
      ipcRenderer.send('deepseek:renderer-error', {
        type: 'unhandledrejection',
        message: reason,
      });
    } catch {
      // Ignore reporting error
    }
  });

  installTurnCompletionObserver();
}

function isElementVisibleAndEnabled(el) {
  if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') {
    return false;
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function hasActiveGenerationControl() {
  try {
    const candidates = document.querySelectorAll(
      'button[aria-label], [role="button"][aria-label], button[title], [role="button"][title], [data-testid*="stop" i], [data-state="streaming"]',
    );
    for (const el of candidates) {
      if (el.getAttribute('data-state') === 'streaming') {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) return true;
        continue;
      }
      const label = [
        el.getAttribute('aria-label'),
        el.getAttribute('title'),
        el.getAttribute('data-testid'),
      ]
        .filter(Boolean)
        .join(' ');
      if (/\bstop\b|停止/i.test(label) && isElementVisibleAndEnabled(el)) {
        return true;
      }
    }
  } catch {
    // Ignore DOM query failures during teardown
  }
  return false;
}

function installTurnCompletionObserver() {
  let generating = false;
  let startedAt = 0;
  let settleTimer = null;
  let scheduled = false;

  const reset = () => {
    generating = false;
    startedAt = 0;
    clearTimeout(settleTimer);
    settleTimer = null;
  };

  const evaluate = () => {
    scheduled = false;
    const active = hasActiveGenerationControl();
    if (active) {
      clearTimeout(settleTimer);
      settleTimer = null;
      if (!generating) {
        generating = true;
        startedAt = Date.now();
      }
      return;
    }

    if (generating && !settleTimer) {
      const elapsed = Date.now() - startedAt;
      settleTimer = setTimeout(() => {
        settleTimer = null;
        if (!hasActiveGenerationControl() && generating) {
          generating = false;
          if (elapsed >= 400) {
            try {
              ipcRenderer.send('deepseek:notify-turn-lifecycle', {
                phase: 'complete',
                source: 'dom',
              });
            } catch {
              // Ignore IPC failure on navigation
            }
          }
        }
      }, 350);
    }
  };

  const scheduleEvaluate = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(evaluate, 120);
  };

  const startObserver = () => {
    const target = document.body || document.documentElement;
    if (!target) return;
    const observer = new MutationObserver(scheduleEvaluate);
    observer.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'aria-label',
        'title',
        'disabled',
        'aria-disabled',
        'data-testid',
        'data-state',
      ],
    });
  };

  window.addEventListener('pagehide', reset);
  window.addEventListener('popstate', reset);

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', startObserver, { once: true });
  } else {
    startObserver();
  }
}
