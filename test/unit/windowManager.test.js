'use strict';

const EventEmitter = require('node:events');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

function loadWindowManagerWithElectronStub() {
  const clearStorageCalls = [];

  class FakeWebContents extends EventEmitter {
    constructor() {
      super();
      this.id = 1;
      this.loadedUrls = [];
      this.currentUrl = 'https://chat.deepseek.com/';
      this.windowOpenHandler = null;
    }
    isDestroyed() { return false; }
    isLoading() { return false; }
    getURL() { return this.currentUrl; }
    focus() {}
    send() {}
    stopFindInPage() {}
    setVisualZoomLevelLimits() { return Promise.resolve(); }
    setZoomLevel() {}
    setWindowOpenHandler(fn) { this.windowOpenHandler = fn; }
    loadURL(url) {
      this.loadedUrls.push(url);
      this.currentUrl = url;
      return Promise.resolve();
    }
    close() {}
  }

  class FakeWebContentsView {
    constructor() {
      this.webContents = new FakeWebContents();
      this.children = [];
    }
    setBackgroundColor() {}
    setVisible() {}
    setBounds() {}
    addChildView(v) { this.children.push(v); }
    removeChildView(v) {
      this.children = this.children.filter((c) => c !== v);
    }
  }

  class FakeBaseWindow extends EventEmitter {
    constructor() {
      super();
      this.contentView = new FakeWebContentsView();
      this._visible = false;
      this._focused = false;
      this._minimized = false;
    }
    isDestroyed() { return false; }
    isMinimized() { return this._minimized; }
    isMaximized() { return false; }
    isFullScreen() { return false; }
    isVisible() { return this._visible; }
    isFocused() { return this._focused; }
    getContentBounds() { return { x: 0, y: 0, width: 1200, height: 800 }; }
    getBounds() { return { x: 0, y: 0, width: 1200, height: 800 }; }
    show() { this._visible = true; }
    hide() { this._visible = false; }
    focus() { this._focused = true; }
    restore() { this._minimized = false; }
    close() {}
  }

  const electronStub = {
    BaseWindow: FakeBaseWindow,
    WebContentsView: FakeWebContentsView,
    clipboard: { writeText() {} },
    Menu: { buildFromTemplate: () => ({ popup() {} }) },
    ipcMain: { on() {}, handle() {}, removeListener() {}, removeHandler() {} },
    shell: { openExternal: () => Promise.resolve() },
    screen: {
      on() {},
      removeListener() {},
      getAllDisplays: () => [{ id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
      getPrimaryDisplay: () => ({ id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
      getDisplayMatching: () => ({ id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
    },
    session: {
      defaultSession: {
        clearStorageData: async (...args) => {
          clearStorageCalls.push(args);
        },
      },
    },
  };

  const origLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return origLoad.call(this, request, parent, isMain);
  };

  try {
    const { WindowManager } = require('../../src/main/windowManager');
    return { WindowManager, FakeWebContents, clearStorageCalls };
  } finally {
    Module._load = origLoad;
  }
}

const { WindowManager, FakeWebContents, clearStorageCalls } =
  loadWindowManagerWithElectronStub();

function createFakeSettingsStore() {
  const data = {
    frameStyle: 'custom',
    zoomLevel: 0,
    lastAccountUrl: 'https://chat.deepseek.com/a/chat/s/123',
    windowBounds: null,
  };
  return {
    data,
    get: (k) => data[k],
    set: (k, v) => {
      data[k] = v;
      return v;
    },
  };
}

function createManager(WindowManager, settingsStore) {
  return new WindowManager({
    iconPath: path.resolve(__dirname, '../../icon.png'),
    preloadDir: path.resolve(__dirname, '../../src/preload'),
    settingsStore,
    isDev: false,
    startVisible: false,
    onVisibilityChange: () => {},
    onCheckUpdates: async () => ({ status: 'up_to_date' }),
    getMeta: () => ({}),
    onQuit: () => {},
    onRestart: () => {},
  });
}

test('WindowManager recovers to offline page on renderer crash but ignores clean-exit', () => {
  const mgr = createManager(WindowManager, createFakeSettingsStore());
  mgr.create();

  let offlineCalls = 0;
  mgr.showOfflinePage = () => {
    offlineCalls += 1;
    mgr.isOffline = true;
  };

  mgr.contentView.webContents.emit('render-process-gone', {}, { reason: 'clean-exit', exitCode: 0 });
  assert.equal(offlineCalls, 0);

  mgr.contentView.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
  assert.equal(offlineCalls, 1);
  assert.equal(mgr.isOffline, true);

  mgr.cleanup();
});

test('WindowManager openSettings and openNewChat skip retryFromOffline when offline', () => {
  const mgr = createManager(WindowManager, createFakeSettingsStore());
  mgr.create();

  let retryCalls = 0;
  mgr.retryFromOffline = () => {
    retryCalls += 1;
  };
  mgr.isOffline = true;

  mgr.openSettings('general');
  assert.equal(retryCalls, 0);

  mgr.openNewChat();
  assert.equal(retryCalls, 0);
  assert.equal(mgr.contentView.webContents.loadedUrls.at(-1), 'https://chat.deepseek.com');

  mgr.show();
  mgr.isOffline = true;
  mgr.show();
  assert.equal(retryCalls, 1);

  mgr.cleanup();
});

test('WindowManager signOut clears all session storage types and resets lastAccountUrl', async () => {
  clearStorageCalls.length = 0;
  const store = createFakeSettingsStore();
  const mgr = createManager(WindowManager, store);
  mgr.create();

  await mgr.signOut();

  assert.equal(clearStorageCalls.length, 1);
  assert.deepEqual(clearStorageCalls[0], []);
  assert.equal(store.data.lastAccountUrl, null);
  assert.equal(mgr.contentView.webContents.loadedUrls.at(-1), 'https://chat.deepseek.com');

  mgr.cleanup();
});

test('WindowManager wireAuthChildWindow refreshes auth tracker on navigations and redirects', () => {
  const mgr = createManager(WindowManager, createFakeSettingsStore());
  mgr.create();

  const childWin = new EventEmitter();
  childWin.webContents = new FakeWebContents();
  childWin.isDestroyed = () => false;
  childWin.close = () => {};

  mgr.wireAuthChildWindow(childWin);

  let prevented = false;
  childWin.webContents.emit(
    'will-navigate',
    { preventDefault: () => { prevented = true; } },
    'https://accounts.google.com/v3/signin',
  );
  assert.equal(prevented, false);

  childWin.webContents.emit(
    'did-redirect-navigation',
    {},
    'https://idp.example.com/step2',
    false,
    true,
  );
  // Returning to chat.deepseek.com disarms childAuth without blocking
  prevented = false;
  childWin.webContents.emit(
    'will-navigate',
    { preventDefault: () => { prevented = true; } },
    'https://chat.deepseek.com/',
  );
  assert.equal(prevented, false);

  childWin.emit('closed');
  mgr.cleanup();
});

test('FindBarController close clears pending step queue and stepping flags', () => {
  const mgr = createManager(WindowManager, createFakeSettingsStore());
  mgr.create();

  mgr.findBar.visible = true;
  mgr.findBar.lastQuery = 'hello';
  mgr.findBar.isStepping = true;
  mgr.findBar.retried = true;
  mgr.findBar.stepQueue.push(true, false);

  mgr.findBar.close();

  assert.equal(mgr.findBar.visible, false);
  assert.equal(mgr.findBar.lastQuery, '');
  assert.equal(mgr.findBar.isStepping, false);
  assert.equal(mgr.findBar.retried, false);
  assert.equal(mgr.findBar.stepQueue.length, 0);

  mgr.cleanup();
});
