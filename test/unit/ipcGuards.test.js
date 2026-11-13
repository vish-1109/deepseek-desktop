'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isBundleIpcSender, isDeepSeekIpcSender } = require('../../src/main/ipcGuards');

function makeEvent({ url, parent = null, top = undefined, sender = null }) {
  const senderFrame = {
    url,
    parent,
    get top() {
      return top === undefined ? this : top;
    },
  };
  return { sender, senderFrame };
}

test('isDeepSeekIpcSender permits only top-level https DeepSeek frames', () => {
  assert.equal(
    isDeepSeekIpcSender(makeEvent({ url: 'https://chat.deepseek.com/' })),
    true,
  );
  assert.equal(
    isDeepSeekIpcSender(
      makeEvent({ url: 'https://chat.deepseek.com/', parent: {}, top: {} }),
    ),
    false,
  );
  assert.equal(
    isDeepSeekIpcSender(makeEvent({ url: 'https://evil.example/' })),
    false,
  );
  assert.equal(
    isDeepSeekIpcSender(makeEvent({ url: 'app://bundle/top_bar/top_bar.html' })),
    false,
  );
});

test('isBundleIpcSender strictly checks view identity and app://bundle URL', () => {
  const viewWc = { isDestroyed: () => false };
  const otherWc = { isDestroyed: () => false };
  const view = { webContents: viewWc };

  assert.equal(
    isBundleIpcSender(
      makeEvent({ url: 'app://bundle/find_bar/find_bar.html', sender: viewWc }),
      view,
    ),
    true,
  );
  assert.equal(
    isBundleIpcSender(
      makeEvent({ url: 'app://bundle/find_bar/find_bar.html', sender: otherWc }),
      view,
    ),
    false,
  );
  assert.equal(
    isBundleIpcSender(
      makeEvent({ url: 'https://chat.deepseek.com/', sender: viewWc }),
      view,
    ),
    false,
  );
  assert.equal(
    isBundleIpcSender(
      makeEvent({ url: 'app://bundle/find_bar/find_bar.html', sender: viewWc }),
      { webContents: { isDestroyed: () => true } },
    ),
    false,
  );
});
