'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AuthFlowTracker,
  cleanUserAgent,
  isAllowedAuthUrl,
  isAllowedDeepSeekUrl,
  isAllowedExternalUrl,
  isAllowedInAppUrl,
  isBundleUrl,
  isChatDeepSeekHost,
  sanitizeRequestHeaders,
} = require('../../src/main/urlPolicy');

test('isAllowedDeepSeekUrl allows only https DeepSeek hosts', () => {
  assert.equal(isAllowedDeepSeekUrl('https://chat.deepseek.com/'), true);
  assert.equal(isAllowedDeepSeekUrl('https://chat.deepseek.com/a/chat/s/123'), true);
  assert.equal(isAllowedDeepSeekUrl('https://login.deepseek.com/'), true);
  assert.equal(isAllowedDeepSeekUrl('https://deepseek.com/'), true);
  assert.equal(isAllowedDeepSeekUrl('http://chat.deepseek.com/'), false);
  assert.equal(isAllowedDeepSeekUrl('https://chat.deepseek.com.evil.com/'), false);
  assert.equal(isAllowedDeepSeekUrl('file:///etc/passwd'), false);
  assert.equal(isAllowedDeepSeekUrl('not a url'), false);
});

test('isChatDeepSeekHost matches chat/root DeepSeek hosts and excludes login.deepseek.com', () => {
  assert.equal(isChatDeepSeekHost('https://chat.deepseek.com/'), true);
  assert.equal(isChatDeepSeekHost('https://chat.deepseek.com/a/chat/s/123'), true);
  assert.equal(isChatDeepSeekHost('https://deepseek.com/'), true);
  assert.equal(isChatDeepSeekHost('https://login.deepseek.com/'), false);
  assert.equal(isChatDeepSeekHost('https://sub.login.deepseek.com/'), false);
  assert.equal(isChatDeepSeekHost('http://chat.deepseek.com/'), false);
  assert.equal(isChatDeepSeekHost('https://evil.com/'), false);
});

test('isAllowedAuthUrl & isAllowedInAppUrl enforce HTTPS allowlist', () => {
  assert.equal(isAllowedAuthUrl('https://accounts.google.com/ServiceLogin'), true);
  assert.equal(isAllowedAuthUrl('https://appleid.apple.com/auth/authorize'), true);
  assert.equal(isAllowedAuthUrl('https://login.deepseek.com/'), true);
  assert.equal(isAllowedAuthUrl('https://evil.com'), false);
  assert.equal(isAllowedInAppUrl('https://accounts.google.com/'), true);
  assert.equal(isAllowedInAppUrl('https://github.com/'), false);
});

test('isAllowedExternalUrl accepts only http/https schemes', () => {
  assert.equal(isAllowedExternalUrl('https://github.com/vish-1109/deepseek-desktop'), true);
  assert.equal(isAllowedExternalUrl('http://localhost:3000'), true);
  assert.equal(isAllowedExternalUrl('file:///etc/passwd'), false);
  assert.equal(isAllowedExternalUrl('ms-settings:privacy'), false);
  assert.equal(isAllowedExternalUrl('javascript:alert(1)'), false);
});

test('isBundleUrl checks app://bundle/ prefix strictly', () => {
  assert.equal(isBundleUrl('app://bundle/top_bar/top_bar.html'), true);
  assert.equal(isBundleUrl('app://other/index.html'), false);
  assert.equal(isBundleUrl('file:///app/index.html'), false);
});

test('cleanUserAgent strips Electron and deepseek-desktop tokens cleanly', () => {
  const dirty =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) deepseek-desktop/2.0.0 Chrome/140.0.0.0 Electron/40.10.2 Safari/537.36';
  const cleaned = cleanUserAgent(dirty, '140.0.7339.207');
  assert.equal(cleaned.includes('Electron'), false);
  assert.equal(cleaned.includes('deepseek-desktop'), false);
  assert.match(cleaned, /Chrome\/140\.0\.0\.0/);
  assert.match(cleaned, /Safari\/537\.36/);
});

test('sanitizeRequestHeaders removes sec-ch-ua headers case-insensitively', () => {
  const sanitized = sanitizeRequestHeaders({
    Accept: 'text/html',
    'Sec-CH-UA': '"Electron";v="40"',
    'sec-ch-ua-platform': '"Linux"',
    Referer: 'https://chat.deepseek.com',
  });
  assert.deepEqual(sanitized, {
    Accept: 'text/html',
    Referer: 'https://chat.deepseek.com',
  });
});

test('AuthFlowTracker arms on OAuth URLs and disarms on return to chat.deepseek.com', () => {
  const tracker = new AuthFlowTracker({ idleTimeoutMs: 5000, maxDurationMs: 10000 });
  assert.equal(tracker.isActive(), false);
  assert.equal(tracker.shouldAllowInAppNavigation('https://idp.corp.example/sso'), false);

  tracker.onNavigate('https://app.example/oauth?client_id=1&redirect_uri=https%3A%2F%2Fchat.deepseek.com&response_type=code');
  assert.equal(tracker.isActive(), true);
  assert.equal(tracker.shouldAllowInAppNavigation('https://idp.corp.example/sso'), true);

  tracker.onNavigate('https://chat.deepseek.com/');
  assert.equal(tracker.isActive(), false);

  tracker.arm();
  assert.equal(tracker.isActive(), true);
  tracker.dispose();
  assert.equal(tracker.isActive(), false);
});

test('AuthFlowTracker rejects OAuth links whose redirect_uri leaves allowed hosts', () => {
  const tracker = new AuthFlowTracker({ idleTimeoutMs: 5000, maxDurationMs: 10000 });
  const phishUrl =
    'https://evil.example/oauth?client_id=1&redirect_uri=https%3A%2F%2Fevil.example%2Fcb&response_type=code';
  assert.equal(tracker.shouldAllowInAppNavigation(phishUrl), false);
  assert.equal(tracker.isActive(), false);
});
