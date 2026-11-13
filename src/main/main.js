'use strict';

const path = require('path');
const { app, ipcMain, Menu, Notification, protocol, session } = require('electron');
const { IPC } = require('./constants');
const { isBundleIpcSender, isDeepSeekIpcSender } = require('./ipcGuards');
const {
  applyLinuxChromiumSwitches,
  detectSessionType,
  findDangerousCliSwitch,
  isAutostartEnabledOnDisk,
  resolveLaunchCommand,
  syncAutostartDesktopFile,
} = require('./linuxPlatform');
const { logger } = require('./logger');
const { installSessionPermissions } = require('./permissions');
const { installDisplayMediaHandler } = require('./capture');
const {
  registerBundleProtocolHandler,
  registerPrivilegedBundleScheme,
} = require('./protocol');
const { SettingsStore } = require('./settingsStore');
const { TrayManager } = require('./trayManager');
const { TurnCompletionTracker } = require('./turnTracker');
const { checkForUpdates } = require('./updater');
const { cleanUserAgent, sanitizeRequestHeaders } = require('./urlPolicy');
const { WindowManager } = require('./windowManager');

const ROOT_DIR = path.resolve(__dirname, '../..');
const RENDERER_DIR = path.resolve(__dirname, '../renderer');
const PRELOAD_DIR = path.resolve(__dirname, '../preload');
const ICON_PATH = path.join(ROOT_DIR, 'icon.png');

const cliArgs = process.argv.slice(1);
const dangerousSwitch = findDangerousCliSwitch(cliArgs, app.isPackaged);
if (dangerousSwitch) {
  console.error(
    `DeepSeek Desktop: refusing to start with unsafe switch "--${dangerousSwitch}" in packaged mode.`,
  );
  app.exit(1);
}

const isDev = !app.isPackaged || cliArgs.includes('--dev');
const launchFlags = {
  tray: cliArgs.includes('--tray'),
  toggle: cliArgs.includes('--toggle'),
  newChat: cliArgs.includes('--new-chat'),
  settings: cliArgs.includes('--settings'),
  resetBounds: cliArgs.includes('--reset-bounds'),
};

registerPrivilegedBundleScheme(protocol);
applyLinuxChromiumSwitches(app.commandLine, cliArgs, process.env);
app.enableSandbox();
app.setName('DeepSeek');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

let settingsStore = null;
let windowManager = null;
let trayManager = null;
let activeTurnNotification = null;
const turnTracker = new TurnCompletionTracker();

function getRuntimeMeta() {
  return {
    appVersion: app.getVersion(),
    license: 'GPL-3.0',
    electronVersion: process.versions.electron || 'unknown',
    chromeVersion: process.versions.chrome || 'unknown',
    sessionType: detectSessionType(process.env),
  };
}

function showTurnCompleteNotification() {
  if (!settingsStore?.get('notifyOnTurnComplete')) return;
  if (windowManager && windowManager.isVisible() && windowManager.isFocused()) return;
  if (!Notification.isSupported()) return;
  if (!turnTracker.claimNotificationSlot()) return;

  try {
    activeTurnNotification?.close();
  } catch {
    // Ignore
  }

  const notification = new Notification({
    title: 'DeepSeek',
    body: 'Your response is ready.',
    icon: ICON_PATH,
  });
  notification.on('click', () => {
    windowManager?.show();
  });
  activeTurnNotification = notification;
  notification.show();
}

function registerDeepSeekPageIpc() {
  ipcMain.on(IPC.DEEPSEEK_RENDERER_ERROR, (event, payload) => {
    if (!isDeepSeekIpcSender(event) || !payload || typeof payload !== 'object') return;
    logger.warn('renderer', `${payload.type || 'error'}: ${String(payload.message || '').slice(0, 300)}`);
  });

  ipcMain.on(IPC.DEEPSEEK_NOTIFY_TURN_LIFECYCLE, (event, payload) => {
    if (!isDeepSeekIpcSender(event) || !payload || typeof payload !== 'object') return;
    if (payload.phase === 'complete') {
      showTurnCompleteNotification();
    }
  });

  ipcMain.on(IPC.DEEPSEEK_RETRY_LOAD, (event) => {
    if (!isBundleIpcSender(event, windowManager?.contentView)) {
      return;
    }
    windowManager.retryFromOffline();
  });
}

function wireSessionNetworkAndSecurity() {
  app.userAgentFallback = cleanUserAgent(app.userAgentFallback, process.versions.chrome);

  session.defaultSession.webRequest.onBeforeSendHeaders(
    {
      urls: [
        'https://*.deepseek.com/*',
        'https://*.google.com/*',
        'https://*.googleapis.com/*',
        'https://*.googleusercontent.com/*',
        'https://*.youtube.com/*',
        'https://*.apple.com/*',
      ],
    },
    (details, callback) => {
      const requestHeaders = sanitizeRequestHeaders(details.requestHeaders);
      requestHeaders['User-Agent'] = app.userAgentFallback;
      callback({ requestHeaders });
    },
  );

  session.defaultSession.webRequest.onResponseStarted(
    { urls: ['https://chat.deepseek.com/api/*'] },
    (details) => {
      const contentWcId =
        windowManager?.contentView && !windowManager.contentView.webContents.isDestroyed()
          ? windowManager.contentView.webContents.id
          : null;
      turnTracker.onResponseStarted(details, contentWcId);
    },
  );

  session.defaultSession.webRequest.onCompleted(
    { urls: ['https://chat.deepseek.com/api/*'] },
    (details) => {
      if (turnTracker.onCompleted(details)) {
        showTurnCompleteNotification();
      }
    },
  );

  session.defaultSession.webRequest.onErrorOccurred(
    { urls: ['https://chat.deepseek.com/api/*'] },
    (details) => {
      turnTracker.onErrorOccurred(details);
    },
  );

  session.defaultSession.on('will-download', (_event, item) => {
    const filename = path.basename(item.getFilename() || 'download');
    item.setSaveDialogOptions({
      defaultPath: path.join(app.getPath('downloads'), filename),
    });
  });
}

async function runUpdateCheck({ interactive = false } = {}) {
  const res = await checkForUpdates({
    fetchFn: globalThis.fetch,
    currentVersion: app.getVersion(),
  });
  windowManager?.notifyUpdateResult(res, !interactive);
  return res;
}

function syncAutostartPreference(enabled) {
  const execLine = resolveLaunchCommand({
    execPath: process.execPath,
    appPath: app.getAppPath(),
    isPackaged: app.isPackaged,
    env: process.env,
  });
  const res = syncAutostartDesktopFile(enabled, { execLine });
  if (!res.ok) {
    logger.warn('autostart', `Failed syncing autostart desktop file: ${res.error}`);
  }
}

function applyAllSettings() {
  settingsStore.subscribe((key, value) => {
    if (key === 'openAtLogin') {
      syncAutostartPreference(Boolean(value));
      trayManager?.updateMenu();
    } else if (key === 'zoomLevel') {
      windowManager?.applySavedZoom();
    }
  });
}

function setupApplicationMenu(actions) {
  if (settingsStore.get('frameStyle') !== 'native') {
    Menu.setApplicationMenu(null);
    return;
  }
  const menu = Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        { label: 'New Chat', accelerator: 'CmdOrCtrl+N', click: () => actions.newChat() },
        { label: 'Settings...', accelerator: 'CmdOrCtrl+,', click: () => actions.openSettings('general') },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => actions.quit() },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Find in Page', accelerator: 'CmdOrCtrl+F', click: () => actions.openFind() },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => actions.reload(false) },
        { label: 'Force Reload', accelerator: 'CmdOrCtrl+Shift+R', click: () => actions.reload(true) },
        { type: 'separator' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: () => actions.zoomIn() },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => actions.zoomOut() },
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: () => actions.zoomReset() },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

app.on('second-instance', (_event, commandLine) => {
  if (!windowManager) return;
  if (commandLine.includes('--toggle')) {
    windowManager.toggle();
    return;
  }
  if (commandLine.includes('--new-chat')) {
    windowManager.openNewChat();
    return;
  }
  if (commandLine.includes('--settings')) {
    windowManager.openSettings('general');
    return;
  }
  windowManager.show();
});

app.whenReady().then(async () => {
  logger.setLogDirectory(path.join(app.getPath('userData'), 'logs'));
  logger.info('startup', `Starting DeepSeek Desktop v${app.getVersion()} (${detectSessionType()})`);

  registerBundleProtocolHandler(protocol, RENDERER_DIR, {
    'assets/icon.png': ICON_PATH,
  });

  settingsStore = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'), {
    logger,
  });
  settingsStore.load();

  if (launchFlags.resetBounds) {
    settingsStore.set('windowBounds', null, { silent: true });
  }

  // Reconcile persisted openAtLogin with actual ~/.config/autostart desktop entry cleanly.
  const diskAutostart = isAutostartEnabledOnDisk();
  if (diskAutostart !== settingsStore.get('openAtLogin')) {
    settingsStore.set('openAtLogin', diskAutostart, { silent: true });
  }

  wireSessionNetworkAndSecurity();
  registerDeepSeekPageIpc();

  const shouldStartVisible =
    launchFlags.toggle ||
    launchFlags.newChat ||
    launchFlags.settings ||
    (!launchFlags.tray && !settingsStore.get('startInTray'));

  const quitApp = () => {
    windowManager?.setQuitting();
    app.quit();
  };

  windowManager = new WindowManager({
    iconPath: ICON_PATH,
    preloadDir: PRELOAD_DIR,
    settingsStore,
    isDev,
    startVisible: shouldStartVisible,
    startNewChat: launchFlags.newChat,
    onVisibilityChange: () => trayManager?.updateMenu(),
    onCheckUpdates: (opts) => runUpdateCheck(opts),
    getMeta: getRuntimeMeta,
    onQuit: quitApp,
    onRestart: () => {
      windowManager?.setQuitting();
      trayManager?.dispose();
      try {
        activeTurnNotification?.close();
      } catch {
        // Ignore
      }
      const oneShotFlags = new Set([
        '--tray',
        '--toggle',
        '--new-chat',
        '--settings',
        '--reset-bounds',
      ]);
      const relaunchArgs = process.argv
        .slice(1)
        .filter((arg) => !oneShotFlags.has(arg));
      if (process.env.APPIMAGE) {
        app.relaunch({ execPath: process.env.APPIMAGE, args: relaunchArgs });
      } else {
        app.relaunch({ args: relaunchArgs });
      }
      app.exit(0);
    },
  });

  windowManager.create();

  installSessionPermissions(session.defaultSession, {
    settingsStore,
    permissionDialog: windowManager.permissionDialog,
  });

  installDisplayMediaHandler(session.defaultSession, {
    displayCaptureDialog: windowManager.displayCaptureDialog,
    contentView: windowManager.contentView,
  });

  trayManager = new TrayManager({
    iconPath: ICON_PATH,
    settingsStore,
    actions: {
      toggleWindow: () => windowManager?.toggle(),
      newChat: () => windowManager?.openNewChat(),
      openSettings: (tab) => windowManager?.openSettings(tab),
      checkUpdates: () => {
        windowManager?.openSettings('about');
        runUpdateCheck({ interactive: true });
      },
      quit: quitApp,
    },
    isWindowVisible: () => windowManager?.isVisible(),
  });
  trayManager.init();

  setupApplicationMenu({
    newChat: () => windowManager?.openNewChat(),
    openFind: () => {
      windowManager?.findBar?.open();
      windowManager?.syncZOrder();
    },
    reload: (force) => windowManager?.reloadContent(force),
    zoomIn: () => windowManager?.adjustZoom(0.5),
    zoomOut: () => windowManager?.adjustZoom(-0.5),
    zoomReset: () => windowManager?.setZoomLevel(0),
    openSettings: (tab) => windowManager?.openSettings(tab),
    quit: quitApp,
  });

  applyAllSettings();

  if (launchFlags.settings) {
    windowManager.openSettings('general');
  }

  if (settingsStore.get('autoCheckUpdates')) {
    const timer = setTimeout(() => {
      runUpdateCheck({ interactive: false });
    }, 4500);
    if (typeof timer.unref === 'function') timer.unref();
  }
});

app.on('window-all-closed', () => {
  if (!settingsStore?.get('closeToTray') || windowManager?.isQuitting) {
    app.quit();
  }
});

app.on('before-quit', () => {
  windowManager?.setQuitting();
  trayManager?.dispose();
  try {
    activeTurnNotification?.close();
  } catch {
    // Ignore
  }
});
