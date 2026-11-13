'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { app, protocol, session } = require('electron');

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepseek-electron-smoke-'));
app.setName('DeepSeek');
app.setPath('userData', userDataDir);

const ROOT_DIR = path.resolve(__dirname, '../..');
const RENDERER_DIR = path.resolve(ROOT_DIR, 'src/renderer');
const PRELOAD_DIR = path.resolve(ROOT_DIR, 'src/preload');
const ICON_PATH = path.join(ROOT_DIR, 'icon.png');

const { BUNDLE_ORIGIN, LAYOUT } = require('../../src/main/constants');
const { logger } = require('../../src/main/logger');
const { installSessionPermissions } = require('../../src/main/permissions');
const {
  registerBundleProtocolHandler,
  registerPrivilegedBundleScheme,
} = require('../../src/main/protocol');
const { SettingsStore } = require('../../src/main/settingsStore');
const { WindowManager } = require('../../src/main/windowManager');

registerPrivilegedBundleScheme(protocol);
app.enableSandbox();

const consoleErrors = [];
const uncaughtErrors = [];

function attachDiagnostics(webContents, label) {
  webContents.on('console-message', ({ level, message }) => {
    if (level === 'error') {
      consoleErrors.push(`[${label}] ${message}`);
    }
  });
  webContents.on('render-process-gone', (_event, details) => {
    uncaughtErrors.push(`[${label}] renderer gone: ${details.reason}`);
  });
  webContents.on('preload-error', (_event, preloadPath, error) => {
    uncaughtErrors.push(`[${label}] preload error (${preloadPath}): ${error.message}`);
  });
}

function waitForLoaded(webContents, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    if (!webContents.isLoading() && webContents.getURL()) {
      setTimeout(resolve, 50);
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      setTimeout(resolve, 50);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`Timed out waiting for view load (${webContents.getURL() || 'empty'})`));
    }, timeoutMs);
    webContents.once('did-finish-load', finish);
    webContents.once('did-fail-load', (_e, code, desc, url) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`View failed to load ${url}: ${code} ${desc}`));
    });
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCondition(fn, timeoutMs = 4000, stepMs = 50) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await fn();
    if (result) return result;
    await wait(stepMs);
  }
  throw new Error('Timed out waiting for condition');
}

class SmokeWindowManager extends WindowManager {
  loadInitialContent() {
    // Stay completely offline during deterministic smoke test
    this.showOfflinePage();
  }

  retryFromOffline() {
    this.showOfflinePage();
  }

  show() {
    // Keep the smoke window hidden so tests don't hijack the user's desktop
  }
}

async function run() {
  await app.whenReady();

  logger.setLogDirectory(path.join(userDataDir, 'logs'));
  logger.info('smoke', 'Starting Electron integration smoke runner');

  registerBundleProtocolHandler(protocol, RENDERER_DIR, {
    'assets/icon.png': ICON_PATH,
  });

  const settingsStore = new SettingsStore(path.join(userDataDir, 'settings.json'), {
    logger,
  });
  settingsStore.load();

  let windowManager = null;
  const meta = {
    appVersion: '1.0.0',
    license: 'GPL-3.0',
    electronVersion: process.versions.electron || 'unknown',
    chromeVersion: process.versions.chrome || 'unknown',
    sessionType: 'x11',
  };

  windowManager = new SmokeWindowManager({
    iconPath: ICON_PATH,
    preloadDir: PRELOAD_DIR,
    settingsStore,
    isDev: true,
    startVisible: false,
    onVisibilityChange: () => {},
    onCheckUpdates: async () => ({ status: 'up-to-date', currentVersion: '1.0.0' }),
    getMeta: () => meta,
    onQuit: () => app.quit(),
    onRestart: () => {},
  });

  settingsStore.subscribe((key) => {
    if (key === 'zoomLevel') {
      windowManager?.applySavedZoom();
    }
  });

  const win = windowManager.create();
  attachDiagnostics(windowManager.contentView.webContents, 'content');
  attachDiagnostics(windowManager.topBar.view.webContents, 'topBar');

  installSessionPermissions(session.defaultSession, {
    settingsStore,
    permissionDialog: windowManager.permissionDialog,
  });

  // 0. Wait for offline page & verify sandboxed preload
  await waitForLoaded(windowManager.contentView.webContents);
  const offlineState = await windowManager.contentView.webContents.executeJavaScript(`
    (() => {
      const img = document.querySelector('img');
      return {
        url: window.location.href,
        hasOfflineApi: typeof window.deepseekOffline === 'object',
        hasNodeRequire: typeof require !== 'undefined',
        hasProcess: typeof process !== 'undefined',
        imgComplete: img ? img.complete : false,
        imgWidth: img ? img.naturalWidth : 0
      };
    })()
  `);
  assert.ok(offlineState.url.startsWith(`${BUNDLE_ORIGIN}/offline.html`), 'Expected app://bundle/offline.html');
  assert.strictEqual(offlineState.hasOfflineApi, true);
  assert.strictEqual(offlineState.hasNodeRequire, false, 'Renderer must not expose Node require');
  assert.strictEqual(offlineState.hasProcess, false, 'Renderer must not expose Node process');
  assert.ok(offlineState.imgWidth > 0, 'Offline logo image must load from app://bundle');

  // 1. Verify TopBar
  await waitForLoaded(windowManager.topBar.view.webContents);
  const topBarCheck = await windowManager.topBar.view.webContents.executeJavaScript(`
    (() => ({
      hasApi: typeof window.topBarApi === 'object',
      buttonCount: document.querySelectorAll('button').length
    }))()
  `);
  assert.strictEqual(topBarCheck.hasApi, true);
  assert.ok(topBarCheck.buttonCount >= 4);

  // 2. Verify BackBar visibility evaluation on DeepSeek vs external auth URLs
  windowManager.backBar.evaluateUrl('https://accounts.google.com/v3/signin');
  assert.strictEqual(windowManager.backBar.getHeight(), LAYOUT.BACK_BAR_HEIGHT);
  attachDiagnostics(windowManager.backBar.view.webContents, 'backBar');
  windowManager.backBar.evaluateUrl('https://chat.deepseek.com/');
  assert.strictEqual(windowManager.backBar.getHeight(), 0);

  // 3. Verify FindBar open/close
  windowManager.findBar.open();
  await waitForLoaded(windowManager.findBar.view.webContents);
  attachDiagnostics(windowManager.findBar.view.webContents, 'findBar');
  const findCheck = await windowManager.findBar.view.webContents.executeJavaScript(`
    (() => ({
      hasApi: typeof window.findBarApi === 'object',
      hasInput: Boolean(document.querySelector('input'))
    }))()
  `);
  assert.strictEqual(findCheck.hasApi, true);
  assert.strictEqual(findCheck.hasInput, true);
  windowManager.findBar.close();

  // 4. Verify Settings modal round-trip + About tab + Zoom propagation
  windowManager.openSettings('about');
  await waitForLoaded(windowManager.settingsModal.view.webContents);
  attachDiagnostics(windowManager.settingsModal.view.webContents, 'settings');
  const settingsRoundTrip = await windowManager.settingsModal.view.webContents.executeJavaScript(`
    (async () => {
      const initial = await window.settingsApi.getAll();
      const updated = await window.settingsApi.update({ zoomLevel: 1.5, closeToTray: false });
      const logs = await window.settingsApi.getLogs();
      const updCheck = await window.settingsApi.checkForUpdates();
      const reset = await window.settingsApi.resetPermissions();
      const copied = await window.settingsApi.copyText('deepseek-desktop --toggle');
      return { initial, updated, logs, updCheck, reset, copied };
    })()
  `);
  assert.strictEqual(settingsRoundTrip.updated.zoomLevel, 1.5);
  assert.strictEqual(settingsRoundTrip.updated.closeToTray, false);
  assert.ok(typeof settingsRoundTrip.logs === 'string' && settingsRoundTrip.logs.includes('Starting Electron integration smoke runner'));
  assert.strictEqual(settingsRoundTrip.updCheck.status, 'up-to-date');
  assert.strictEqual(settingsRoundTrip.copied, true);
  assert.ok(Math.abs(windowManager.contentView.webContents.getZoomLevel() - 1.5) < 0.05);
  windowManager.settingsModal.close();
  assert.strictEqual(windowManager.settingsModal.isOpen, false);

  // 5. Verify UpdateBanner show/hide
  windowManager.updateBanner.show({
    status: 'available',
    latestVersion: '9.9.9',
    releaseUrl: 'https://github.com/vish-1109/deepseek-desktop/releases/tag/v9.9.9',
    notes: 'Test banner',
  });
  await waitForLoaded(windowManager.updateBanner.view.webContents);
  attachDiagnostics(windowManager.updateBanner.view.webContents, 'updateBanner');
  await waitForCondition(async () => {
    return windowManager.updateBanner.view.webContents.executeJavaScript(
      `document.body.innerText.includes('9.9.9')`
    );
  });
  const bannerCheck = await windowManager.updateBanner.view.webContents.executeJavaScript(`
    (() => ({ hasApi: typeof window.updateBannerApi === 'object', text: document.body.innerText }))()
  `);
  assert.strictEqual(bannerCheck.hasApi, true);
  assert.ok(bannerCheck.text.includes('9.9.9'));
  windowManager.updateBanner.hide();

  // 6. Verify PermissionDialog enqueue + button interaction
  const permDecision = new Promise((resolve) => {
    windowManager.permissionDialog.enqueue({
      capability: 'media',
      title: 'Use your microphone with DeepSeek?',
      desc: 'Smoke test prompt',
      callback: resolve,
    });
  });
  await waitForLoaded(windowManager.permissionDialog.view.webContents);
  attachDiagnostics(windowManager.permissionDialog.view.webContents, 'permissionDialog');
  await waitForCondition(async () => {
    return windowManager.permissionDialog.view.webContents.executeJavaScript(
      `Boolean(document.getElementById('btn-block') && document.getElementById('perm-title').textContent.includes('microphone'))`
    );
  });
  await windowManager.permissionDialog.view.webContents.executeJavaScript(
    `(() => { setTimeout(() => document.getElementById('btn-block')?.click(), 20); return true; })()`
  );
  const permAllowed = await Promise.race([
    permDecision,
    wait(4000).then(() => { throw new Error('Timed out waiting for permissionDialog decision'); }),
  ]);
  assert.strictEqual(permAllowed, false);

  // 7. Verify DisplayCaptureDialog prompt + allow interaction
  const dcPromise = windowManager.displayCaptureDialog.prompt({
    appName: 'DeepSeek',
    sources: [
      { id: 'screen:0:0', name: 'Entire Screen', kind: 'screen', thumbnailDataUrl: '' },
    ],
  });
  await waitForLoaded(windowManager.displayCaptureDialog.view.webContents);
  attachDiagnostics(windowManager.displayCaptureDialog.view.webContents, 'displayCaptureDialog');
  await waitForCondition(async () => {
    return windowManager.displayCaptureDialog.view.webContents.executeJavaScript(
      `Boolean(document.querySelector('.source-card') && document.getElementById('dc-allow'))`
    );
  });
  await windowManager.displayCaptureDialog.view.webContents.executeJavaScript(
    `(() => { setTimeout(() => document.getElementById('dc-allow')?.click(), 20); return true; })()`
  );
  const dcDecision = await Promise.race([
    dcPromise,
    wait(4000).then(() => { throw new Error('Timed out waiting for displayCaptureDialog decision'); }),
  ]);
  assert.strictEqual(dcDecision.allowed, true);
  assert.strictEqual(dcDecision.sourceId, 'screen:0:0');

  // 8. Verify Z-order + clean teardown
  windowManager.syncZOrder();
  windowManager.setQuitting();
  win.close();

  assert.deepStrictEqual(consoleErrors, [], `Renderer console errors: ${consoleErrors.join('; ')}`);
  assert.deepStrictEqual(uncaughtErrors, [], `Renderer uncaught errors: ${uncaughtErrors.join('; ')}`);

  console.log('ELECTRON_SMOKE_OK');
  fs.rmSync(userDataDir, { recursive: true, force: true });
  app.exit(0);
}

run().catch((err) => {
  console.error('ELECTRON_SMOKE_FAIL:', err);
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
  app.exit(1);
});
