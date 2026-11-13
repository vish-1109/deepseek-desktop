'use strict';

const { isAllowedDeepSeekUrl, isBundleUrl } = require('./urlPolicy');

function getSenderFrameUrl(event) {
  try {
    return event?.senderFrame?.url || '';
  } catch {
    return '';
  }
}

function isTopLevelFrame(senderFrame) {
  if (!senderFrame) return false;
  return senderFrame.parent === null || senderFrame === senderFrame.top;
}

/**
 * Validates that an IPC message originates from a top-level https://chat.deepseek.com (or allowed DeepSeek) frame.
 */
function isDeepSeekIpcSender(event) {
  if (!event || !isTopLevelFrame(event.senderFrame)) return false;
  const url = getSenderFrameUrl(event);
  return isAllowedDeepSeekUrl(url);
}

/**
 * Validates that an IPC message comes strictly from the expected app://bundle WebContentsView.
 */
function isBundleIpcSender(event, expectedViewOrGetter) {
  if (!event || !event.sender || !isTopLevelFrame(event.senderFrame)) {
    return false;
  }
  const view =
    typeof expectedViewOrGetter === 'function'
      ? expectedViewOrGetter()
      : expectedViewOrGetter;

  if (!view || !view.webContents || view.webContents.isDestroyed()) {
    return false;
  }
  if (event.sender !== view.webContents) {
    return false;
  }
  return isBundleUrl(getSenderFrameUrl(event));
}

module.exports = {
  getSenderFrameUrl,
  isBundleIpcSender,
  isDeepSeekIpcSender,
  isTopLevelFrame,
};
