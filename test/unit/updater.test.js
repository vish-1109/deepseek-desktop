'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  checkForUpdates,
  compareSemver,
  evaluateRelease,
} = require('../../src/main/updater');

test('compareSemver orders stable and prerelease versions properly', () => {
  assert.equal(compareSemver('2.0.1', '2.0.0'), 1);
  assert.equal(compareSemver('v2.1.0', '2.0.9'), 1);
  assert.equal(compareSemver('2.0.0', 'v2.0.0'), 0);
  assert.equal(compareSemver('2.0.0-beta.1', '2.0.0'), -1);
  assert.equal(compareSemver('2.0.0-beta.2', '2.0.0-beta.1'), 1);
});

test('evaluateRelease detects available updates and sanitizes unsafe URLs', () => {
  const res = evaluateRelease(
    {
      tag_name: 'v2.1.0',
      html_url: 'https://github.com/vish-1109/deepseek-desktop/releases/tag/v2.1.0',
      published_at: '2026-11-12T00:00:00Z',
    },
    '2.0.0',
  );
  assert.equal(res.status, 'available');
  assert.equal(res.latestVersion, '2.1.0');
  assert.match(res.releaseUrl, /^https:\/\/github\.com\//);

  const spoofed = evaluateRelease(
    { tag_name: 'v2.2.0', html_url: 'javascript:alert(1)' },
    '2.0.0',
  );
  assert.equal(spoofed.status, 'available');
  assert.equal(
    spoofed.releaseUrl,
    'https://github.com/vish-1109/deepseek-desktop/releases',
  );
});

test('checkForUpdates handles offline/HTTP errors without throwing', async () => {
  const failRes = await checkForUpdates({
    fetchFn: async () => ({ ok: false, status: 503 }),
    currentVersion: '2.0.0',
  });
  assert.equal(failRes.status, 'error');
  assert.equal(failRes.error, 'HTTP 503');

  const okRes = await checkForUpdates({
    fetchFn: async () => ({
      ok: true,
      json: async () => ({ tag_name: 'v2.0.0' }),
    }),
    currentVersion: '2.0.0',
  });
  assert.equal(okRes.status, 'up_to_date');
});
