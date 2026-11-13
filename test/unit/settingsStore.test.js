'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_SETTINGS,
  SettingsStore,
  clampZoomLevel,
  normalizeSettings,
} = require('../../src/main/settingsStore');

test('normalizeSettings repairs invalid fields cleanly to defaults', () => {
  const normalized = normalizeSettings({
    openAtLogin: 'nope',
    closeToTray: 'nope',
    frameStyle: 'floating',
    zoomLevel: 99,
    permissions: { media: 'granted', camera: 'hacked' },
    lastAccountUrl: 'https://evil.com/steal',
    windowBounds: { width: 'bad', height: 600, relativeX: 0.5, relativeY: 0.5 },
  });

  assert.equal(normalized.openAtLogin, DEFAULT_SETTINGS.openAtLogin);
  assert.equal(normalized.closeToTray, DEFAULT_SETTINGS.closeToTray);
  assert.equal(normalized.frameStyle, 'custom');
  assert.equal(normalized.zoomLevel, 3);
  assert.equal(normalized.permissions.media, 'granted');
  assert.equal(normalized.permissions.camera, 'ask');
  assert.equal(normalized.lastAccountUrl, null);
  assert.equal(normalized.windowBounds, null);
});

test('normalizeSettings preserves valid chat.deepseek.com bookmark URL', () => {
  const normalized = normalizeSettings({
    lastAccountUrl: 'https://chat.deepseek.com/a/chat/s/abc',
  });
  assert.equal(normalized.lastAccountUrl, 'https://chat.deepseek.com/a/chat/s/abc');
});

test('clampZoomLevel bounds finite numbers and ignores NaN', () => {
  assert.equal(clampZoomLevel(-10), -3);
  assert.equal(clampZoomLevel(10), 3);
  assert.equal(clampZoomLevel(1.5), 1.5);
  assert.equal(clampZoomLevel(Number.NaN), 0);
});

test('SettingsStore persists atomically and triggers subscribers', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepseek-settings-'));
  try {
    const file = path.join(tmpDir, 'settings.json');
    const store = new SettingsStore(file);

    const changes = [];
    store.subscribe((key, val) => changes.push([key, val]));

    store.set('zoomLevel', 1.5);
    store.setPermission('camera', 'granted');
    assert.deepEqual(changes[0], ['zoomLevel', 1.5]);

    const reloaded = new SettingsStore(file);
    assert.equal(reloaded.get('zoomLevel'), 1.5);
    assert.equal(reloaded.get('permissions').camera, 'granted');

    reloaded.resetPermissions();
    assert.equal(reloaded.get('permissions').camera, 'ask');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
