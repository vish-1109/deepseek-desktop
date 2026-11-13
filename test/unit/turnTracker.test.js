'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TurnCompletionTracker,
  getHeaderCaseInsensitive,
  isDeepSeekChatApiUrl,
} = require('../../src/main/turnTracker');

function loadPreloadWithMocks({ elements = [], clockStart = 1000 } = {}) {
  const sent = [];
  const timers = new Map();
  let nextTimerId = 1;
  let now = clockStart;
  let observerCallback = null;
  let currentElements = elements;

  const mockDate = class extends Date {
    static now() {
      return now;
    }
  };

  const context = {
    Date: mockDate,
    require(id) {
      if (id === 'electron') {
        return {
          contextBridge: { exposeInMainWorld() {} },
          ipcRenderer: { send: (channel, payload) => sent.push({ channel, payload }) },
        };
      }
      throw new Error(`Unexpected require in preload: ${id}`);
    },
    window: {
      location: {
        protocol: 'https:',
        hostname: 'chat.deepseek.com',
        pathname: '/',
      },
      addEventListener() {},
    },
    document: {
      readyState: 'complete',
      body: {},
      querySelectorAll() {
        return currentElements;
      },
    },
    MutationObserver: class {
      constructor(cb) {
        observerCallback = cb;
      }
      observe() {}
    },
    setTimeout(fn, delay) {
      const id = nextTimerId++;
      timers.set(id, { fn, runAt: now + delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };

  const preloadPath = path.resolve(__dirname, '../../src/preload/deepseekPreload.js');
  const source = fs.readFileSync(preloadPath, 'utf8');
  vm.runInNewContext(source, context, { filename: preloadPath });

  return {
    sent,
    hasActiveGenerationControl: context.hasActiveGenerationControl,
    setElements(next) {
      currentElements = next;
    },
    triggerMutation() {
      observerCallback?.();
    },
    advanceTime(ms) {
      now += ms;
      for (const [id, entry] of [...timers.entries()]) {
        if (entry.runAt <= now) {
          timers.delete(id);
          entry.fn();
        }
      }
    },
  };
}

function makeMockEl({ attrs = {}, disabled = false, width = 24, height = 24 } = {}) {
  return {
    disabled,
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    },
    getBoundingClientRect() {
      return { width, height };
    },
  };
}

test('isDeepSeekChatApiUrl accepts only HTTPS chat.deepseek.com /api/ endpoints', () => {
  assert.equal(isDeepSeekChatApiUrl('https://chat.deepseek.com/api/v0/chat/completion'), true);
  assert.equal(isDeepSeekChatApiUrl('https://chat.deepseek.com/sign_in'), false);
  assert.equal(isDeepSeekChatApiUrl('http://chat.deepseek.com/api/v0/chat/completion'), false);
  assert.equal(isDeepSeekChatApiUrl('https://evil.com/api/v0/chat/completion'), false);
});

test('getHeaderCaseInsensitive matches regardless of casing and array values', () => {
  assert.equal(
    getHeaderCaseInsensitive({ 'Content-Type': ['text/event-stream; charset=utf-8'] }, 'content-type'),
    'text/event-stream; charset=utf-8',
  );
  assert.equal(getHeaderCaseInsensitive({}, 'content-type'), '');
});

test('TurnCompletionTracker fires once on completed DeepSeek POST SSE stream', () => {
  let clock = 1000;
  const tracker = new TurnCompletionTracker({ now: () => clock });

  const tracked = tracker.onResponseStarted(
    {
      id: 'req-1',
      method: 'POST',
      webContentsId: 42,
      url: 'https://chat.deepseek.com/api/v0/chat/completion',
      statusCode: 200,
      responseHeaders: { 'Content-Type': ['text/event-stream; charset=utf-8'] },
    },
    42,
  );
  assert.equal(tracked, true);

  clock += 1200;
  assert.equal(tracker.onCompleted({ id: 'req-1', statusCode: 200 }), true);
  // Notifier claims the slot once when presenting the notification
  assert.equal(tracker.claimNotificationSlot(), true);
  // Duplicate notification within cooldown window is suppressed
  clock += 300;
  assert.equal(tracker.claimNotificationSlot(), false);
  // After cooldown window passes, another notification is allowed
  clock += 3000;
  assert.equal(tracker.claimNotificationSlot(), true);
});

test('TurnCompletionTracker ignores GET streams, wrong webContents, aborted streams, and short bursts', () => {
  let clock = 5000;
  const tracker = new TurnCompletionTracker({ now: () => clock });

  assert.equal(
    tracker.onResponseStarted(
      {
        id: 'get-sse',
        method: 'GET',
        webContentsId: 10,
        url: 'https://chat.deepseek.com/api/v0/events',
        statusCode: 200,
        responseHeaders: { 'content-type': 'text/event-stream' },
      },
      10,
    ),
    false,
  );

  assert.equal(
    tracker.onResponseStarted(
      {
        id: 'other-wc',
        method: 'POST',
        webContentsId: 99,
        url: 'https://chat.deepseek.com/api/v0/chat/completion',
        statusCode: 200,
        responseHeaders: { 'content-type': 'text/event-stream' },
      },
      10,
    ),
    false,
  );

  assert.equal(
    tracker.onResponseStarted(
      {
        id: 'aborted',
        method: 'POST',
        webContentsId: 10,
        url: 'https://chat.deepseek.com/api/v0/chat/completion',
        statusCode: 200,
        responseHeaders: { 'content-type': 'text/event-stream' },
      },
      10,
    ),
    true,
  );
  clock += 2000;
  tracker.onErrorOccurred({ id: 'aborted' });
  assert.equal(tracker.onCompleted({ id: 'aborted', statusCode: 200 }), false);

  assert.equal(
    tracker.onResponseStarted(
      {
        id: 'too-short',
        method: 'POST',
        webContentsId: 10,
        url: 'https://chat.deepseek.com/api/v0/chat/completion',
        statusCode: 200,
        responseHeaders: { 'content-type': 'text/event-stream' },
      },
      10,
    ),
    true,
  );
  clock += 100;
  assert.equal(tracker.onCompleted({ id: 'too-short', statusCode: 200 }), false);
});

test('preload DOM detection recognizes active stop/streaming controls and ignores hidden or disabled ones', () => {
  const harness = loadPreloadWithMocks();

  assert.equal(harness.hasActiveGenerationControl(), false);

  harness.setElements([
    makeMockEl({ attrs: { 'aria-label': 'Stop generating' }, disabled: true }),
    makeMockEl({ attrs: { 'aria-label': 'Stop generating' }, width: 0, height: 0 }),
    makeMockEl({ attrs: { 'aria-label': 'Send message' } }),
  ]);
  assert.equal(harness.hasActiveGenerationControl(), false);

  harness.setElements([makeMockEl({ attrs: { 'aria-label': 'Stop generating' } })]);
  assert.equal(harness.hasActiveGenerationControl(), true);

  harness.setElements([makeMockEl({ attrs: { title: '停止生成' } })]);
  assert.equal(harness.hasActiveGenerationControl(), true);

  harness.setElements([makeMockEl({ attrs: { 'data-state': 'streaming' } })]);
  assert.equal(harness.hasActiveGenerationControl(), true);
});

test('preload DOM observer emits completion after sustained generation settles', () => {
  const harness = loadPreloadWithMocks();

  harness.setElements([makeMockEl({ attrs: { 'aria-label': 'Stop generating' } })]);
  harness.triggerMutation();
  harness.advanceTime(120);

  harness.advanceTime(500);
  harness.setElements([]);
  harness.triggerMutation();
  harness.advanceTime(120);
  assert.equal(harness.sent.length, 0);

  harness.advanceTime(350);
  assert.equal(harness.sent.length, 1);
  assert.equal(harness.sent[0].channel, 'deepseek:notify-turn-lifecycle');
  assert.equal(harness.sent[0].payload.phase, 'complete');
  assert.equal(harness.sent[0].payload.source, 'dom');
});
