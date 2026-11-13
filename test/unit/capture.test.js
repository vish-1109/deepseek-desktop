'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  installDisplayMediaHandler,
  listCaptureSources,
  serializeSourcesForUi,
} = require('../../src/main/capture');

test('listCaptureSources handles capturer results and failures safely', async () => {
  const sample = [{ id: 'screen:0:0', name: 'Entire Screen' }];
  const sources = await listCaptureSources({
    desktopCapturer: { getSources: async () => sample },
  });
  assert.deepEqual(sources, sample);

  const failed = await listCaptureSources({
    desktopCapturer: {
      getSources: async () => {
        throw new Error('pipewire unavailable');
      },
    },
  });
  assert.deepEqual(failed, []);
});

test('serializeSourcesForUi normalizes screen vs window entries and thumbnails', () => {
  const serialized = serializeSourcesForUi([
    {
      id: 'screen:1:0',
      name: 'Display 1',
      thumbnail: { toDataURL: () => 'data:image/png;base64,AAA' },
    },
    {
      id: 'window:42:0',
      name: '',
      thumbnail: null,
    },
  ]);

  assert.deepEqual(serialized, [
    {
      id: 'screen:1:0',
      name: 'Display 1',
      kind: 'screen',
      thumbnailDataUrl: 'data:image/png;base64,AAA',
    },
    {
      id: 'window:42:0',
      name: 'Display',
      kind: 'window',
      thumbnailDataUrl: '',
    },
  ]);
});

test('installDisplayMediaHandler blocks untrusted origins and routes trusted picks', async () => {
  let handler = null;
  const mockSession = {
    setDisplayMediaRequestHandler(fn) {
      handler = fn;
    },
  };

  let promptArgs = null;
  let nextDecision = { allowed: false, sourceId: '' };
  const rawSources = [
    { id: 'screen:0:0', name: 'Monitor 1', thumbnail: null },
    { id: 'window:9:0', name: 'Terminal', thumbnail: null },
  ];

  const mockContentView = {
    webContents: {
      isDestroyed: () => false,
      getURL: () => 'https://chat.deepseek.com/',
      mainFrame: { id: 'main-frame' },
    },
  };

  installDisplayMediaHandler(mockSession, {
    displayCaptureDialog: {
      prompt: async (args) => {
        promptArgs = args;
        return nextDecision;
      },
    },
    contentView: mockContentView,
    listSourcesFn: async () => rawSources,
  });

  // 1. Untrusted origin must be rejected before listing sources or prompting
  const blockedResult = await new Promise((resolve) => {
    handler({ frame: { url: 'https://evil.example/' } }, resolve);
  });
  assert.equal(blockedResult, null);
  assert.equal(promptArgs, null);

  // 2. User denies capture prompt
  nextDecision = { allowed: false, sourceId: '' };
  const deniedResult = await new Promise((resolve) => {
    handler({ frame: { url: 'https://chat.deepseek.com/' } }, resolve);
  });
  assert.equal(deniedResult, null);
  assert.equal(promptArgs.sources.length, 2);

  // 3. User selects a specific window source
  nextDecision = { allowed: true, sourceId: 'window:9:0' };
  const selectedResult = await new Promise((resolve) => {
    handler({ frame: { url: 'https://chat.deepseek.com/' } }, resolve);
  });
  assert.equal(selectedResult.video, rawSources[1]);

  // 4. User allows without matching sourceId -> falls back to top frame
  nextDecision = { allowed: true, sourceId: '' };
  const topFrame = { id: 'top-frame' };
  const fallbackResult = await new Promise((resolve) => {
    handler({ frame: { url: 'https://chat.deepseek.com/', top: topFrame } }, resolve);
  });
  assert.equal(fallbackResult.video, topFrame);
});
