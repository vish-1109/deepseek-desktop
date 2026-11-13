'use strict';

function getHeaderCaseInsensitive(headers, targetName) {
  if (!headers || typeof headers !== 'object') return '';
  const lowerTarget = targetName.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerTarget) {
      return Array.isArray(value) ? value.join('; ') : String(value || '');
    }
  }
  return '';
}

function isDeepSeekChatApiUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl) return false;
  try {
    const parsed = new URL(rawUrl);
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname.toLowerCase() === 'chat.deepseek.com' &&
      parsed.pathname.startsWith('/api/')
    );
  } catch {
    return false;
  }
}

/**
 * Tracks active chat SSE POST responses on chat.deepseek.com and deduplicates
 * turn-complete notifications across network and DOM lifecycle sources.
 */
class TurnCompletionTracker {
  constructor(options = {}) {
    this.minStreamDurationMs = options.minStreamDurationMs ?? 400;
    this.dedupWindowMs = options.dedupWindowMs ?? 3000;
    this.maxPendingAgeMs = options.maxPendingAgeMs ?? 30 * 60 * 1000;
    this.now = options.now || (() => Date.now());
    this.pending = new Map();
    this.lastNotificationAt = -Infinity;
  }

  onResponseStarted(details, expectedWebContentsId = null) {
    if (!details || details.method !== 'POST') return false;
    if (
      typeof expectedWebContentsId === 'number' &&
      details.webContentsId !== expectedWebContentsId
    ) {
      return false;
    }
    if (!isDeepSeekChatApiUrl(details.url)) return false;
    if (
      typeof details.statusCode === 'number' &&
      (details.statusCode < 200 || details.statusCode >= 300)
    ) {
      return false;
    }

    const contentType = getHeaderCaseInsensitive(
      details.responseHeaders,
      'content-type',
    ).toLowerCase();
    if (!contentType.includes('text/event-stream')) return false;

    const now = this.now();
    this.#pruneStale(now);
    this.pending.set(details.id, now);
    return true;
  }

  onCompleted(details) {
    if (!details || !this.pending.has(details.id)) return false;
    const startedAt = this.pending.get(details.id);
    this.pending.delete(details.id);

    if (
      typeof details.statusCode === 'number' &&
      (details.statusCode < 200 || details.statusCode >= 300)
    ) {
      return false;
    }
    const elapsed = this.now() - startedAt;
    return elapsed >= this.minStreamDurationMs;
  }

  onErrorOccurred(details) {
    if (!details) return;
    this.pending.delete(details.id);
  }

  claimNotificationSlot() {
    const now = this.now();
    if (now - this.lastNotificationAt < this.dedupWindowMs) {
      return false;
    }
    this.lastNotificationAt = now;
    return true;
  }

  reset() {
    this.pending.clear();
  }

  #pruneStale(now) {
    for (const [id, startedAt] of this.pending.entries()) {
      if (now - startedAt > this.maxPendingAgeMs) {
        this.pending.delete(id);
      }
    }
  }
}

module.exports = {
  TurnCompletionTracker,
  getHeaderCaseInsensitive,
  isDeepSeekChatApiUrl,
};
