'use strict';

const { isAllowedDeepSeekUrl, isBundleUrl } = require('./urlPolicy');
const { logger } = require('./logger');

const CAPABILITY_DESCRIPTIONS = Object.freeze({
  media: {
    title: 'Use your microphone with DeepSeek?',
    desc: 'DeepSeek uses your microphone for voice input.',
  },
  camera: {
    title: 'Use your camera with DeepSeek?',
    desc: 'DeepSeek uses your camera for visual input when requested.',
  },
  mediaAndCamera: {
    title: 'Use your microphone and camera with DeepSeek?',
    desc: 'DeepSeek uses your microphone and camera for voice and video input.',
  },
  geolocation: {
    title: 'Use your location with DeepSeek?',
    desc: 'DeepSeek uses approximate browser location to give relevant local answers.',
  },
  notifications: {
    title: 'Allow DeepSeek to send notifications?',
    desc: 'DeepSeek can alert you when responses are ready.',
  },
  clipboard: {
    title: 'Allow clipboard access for DeepSeek?',
    desc: 'Allows DeepSeek to paste or read copied snippets when you trigger clipboard actions.',
  },
});

function mapElectronPermission(permission, details = {}) {
  switch (permission) {
    case 'media': {
      const types = Array.isArray(details.mediaTypes) ? details.mediaTypes : [];
      if (types.length === 1 && types[0] === 'video') return 'camera';
      if (types.length === 0 && details.mediaType === 'video') return 'camera';
      return 'media';
    }
    case 'camera':
      return 'camera';
    case 'geolocation':
      return 'geolocation';
    case 'notifications':
      return 'notifications';
    case 'clipboard-read':
    case 'clipboard-sanitized-write':
      return 'clipboard';
    default:
      return null;
  }
}

function resolveRequestedCapabilities(permission, details = {}) {
  if (permission === 'media') {
    const types = Array.isArray(details.mediaTypes) ? details.mediaTypes : [];
    if (types.length > 0) {
      const caps = [];
      if (types.includes('audio')) caps.push('media');
      if (types.includes('video')) caps.push('camera');
      return caps.length > 0 ? caps : ['media'];
    }
    if (details.mediaType === 'video') return ['camera'];
    return ['media'];
  }
  const capability = mapElectronPermission(permission, details);
  return capability ? [capability] : [];
}

function installSessionPermissions(targetSession, { settingsStore, permissionDialog }) {
  targetSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details = {}) => {
    const urlToCheck = requestingOrigin || webContents?.getURL?.() || '';
    // Internal app://bundle views (e.g. Settings Copy buttons) may write to the clipboard on user action.
    if (isBundleUrl(urlToCheck)) {
      return permission === 'clipboard-sanitized-write';
    }
    if (!isAllowedDeepSeekUrl(urlToCheck)) return false;

    const storedPerms = settingsStore.get('permissions') || {};
    if (permission === 'media' && details.mediaType === 'unknown' && !details.mediaTypes?.length) {
      return storedPerms.media === 'granted' || storedPerms.camera === 'granted';
    }

    const capabilities = resolveRequestedCapabilities(permission, details);
    if (capabilities.length === 0) return false;
    return capabilities.every((cap) => (storedPerms[cap] || 'ask') === 'granted');
  });

  targetSession.setPermissionRequestHandler((webContents, permission, callback, details = {}) => {
    const requestingUrl = details?.requestingUrl || webContents?.getURL?.() || '';
    if (isBundleUrl(requestingUrl)) {
      callback(permission === 'clipboard-sanitized-write');
      return;
    }
    if (!isAllowedDeepSeekUrl(requestingUrl)) {
      logger.warn('permissions', `Denied permission "${permission}" from untrusted origin`);
      callback(false);
      return;
    }

    const capabilities = resolveRequestedCapabilities(permission, details);
    if (capabilities.length === 0) {
      logger.info('permissions', `Denied unsupported permission "${permission}"`);
      callback(false);
      return;
    }

    const storedPerms = settingsStore.get('permissions') || {};
    if (capabilities.some((cap) => (storedPerms[cap] || 'ask') === 'denied')) {
      logger.info('permissions', `Denied permission "${capabilities.join('+')}" by saved setting`);
      callback(false);
      return;
    }

    const pendingCaps = capabilities.filter(
      (cap) => (storedPerms[cap] || 'ask') !== 'granted',
    );
    if (pendingCaps.length === 0) {
      callback(true);
      return;
    }

    const isCombinedMedia =
      pendingCaps.includes('media') && pendingCaps.includes('camera');
    const copy = isCombinedMedia
      ? CAPABILITY_DESCRIPTIONS.mediaAndCamera
      : CAPABILITY_DESCRIPTIONS[pendingCaps[0]];

    permissionDialog.enqueue({
      capability: isCombinedMedia ? 'camera' : pendingCaps[0],
      title: copy.title,
      desc: copy.desc,
      callback: (allowed) => {
        const decision = allowed ? 'granted' : 'denied';
        for (const cap of pendingCaps) {
          settingsStore.setPermission(cap, decision);
        }
        logger.info(
          'permissions',
          `Permission "${pendingCaps.join('+')}" => ${decision}`,
        );
        callback(Boolean(allowed));
      },
    });
  });
}

module.exports = {
  CAPABILITY_DESCRIPTIONS,
  installSessionPermissions,
  mapElectronPermission,
  resolveRequestedCapabilities,
};
