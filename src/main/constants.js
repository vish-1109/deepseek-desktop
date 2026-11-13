'use strict';

const DEEPSEEK_HOME_URL = 'https://chat.deepseek.com';
const DEEPSEEK_APP_URL = 'https://chat.deepseek.com';
const GITHUB_REPO_URL = 'https://github.com/vish-1109/deepseek-desktop';
const GITHUB_RELEASES_API_URL =
  'https://api.github.com/repos/vish-1109/deepseek-desktop/releases/latest';
const GITHUB_RELEASES_PAGE_URL = `${GITHUB_REPO_URL}/releases`;

const BUNDLE_SCHEME = 'app';
const BUNDLE_HOST = 'bundle';
const BUNDLE_ORIGIN = `${BUNDLE_SCHEME}://${BUNDLE_HOST}`;

const DEEPSEEK_HOSTS = Object.freeze([
  'chat.deepseek.com',
  'deepseek.com',
  'login.deepseek.com',
]);

const AUTH_HOSTS = Object.freeze(
  [
    'login.deepseek.com',
    'accounts.google.com',
    'accounts.youtube.com',
    'consent.google.com',
    'gds.google.com',
    'myaccount.google.com',
    'appleid.apple.com',
  ].map((h) => h.toLowerCase()),
);

const OAUTH_FLOW_HOSTS = Object.freeze([
  'login.deepseek.com',
  'accounts.google.com',
  'accounts.youtube.com',
  'consent.google.com',
  'gds.google.com',
  'appleid.apple.com',
]);

const LOG_REDACT_DOMAINS = Object.freeze([
  'deepseek.com',
  'google.com',
  'googleapis.com',
  'googleusercontent.com',
  'gstatic.com',
  'apple.com',
  'github.com',
]);

const LAYOUT = Object.freeze({
  TOP_BAR_HEIGHT: 36,
  BACK_BAR_HEIGHT: 44,
  FIND_BAR_WIDTH: 384,
  FIND_BAR_HEIGHT: 68,
  FIND_BAR_MARGIN_RIGHT: 24,
  UPDATE_BANNER_WIDTH: 460,
  UPDATE_BANNER_HEIGHT: 80,
  UPDATE_BANNER_MARGIN: 16,
  PERMISSION_DIALOG_WIDTH: 520,
  PERMISSION_DIALOG_HEIGHT: 330,
  PERMISSION_DIALOG_TOP_OFFSET: 16,
  CAPTURE_DIALOG_WIDTH: 640,
  CAPTURE_DIALOG_HEIGHT: 560,
  DEFAULT_WINDOW_WIDTH: 1200,
  DEFAULT_WINDOW_HEIGHT: 820,
  MIN_WINDOW_WIDTH: 460,
  MIN_WINDOW_HEIGHT: 480,
});

const ZOOM = Object.freeze({
  MIN_LEVEL: -3.0,
  MAX_LEVEL: 3.0,
  STEP: 0.5,
});

const DANGEROUS_CLI_SWITCHES = Object.freeze([
  'remote-debugging-port',
  'remote-debugging-pipe',
  'remote-allow-origins',
  'inspect',
  'inspect-brk',
  'inspect-port',
  'inspect-publish-uid',
  'proxy-server',
  'proxy-pac-url',
  'host-rules',
  'host-resolver-rules',
  'ignore-certificate-errors',
  'disable-web-security',
]);

const VALID_PERMISSIONS = Object.freeze([
  'media',
  'camera',
  'geolocation',
  'notifications',
  'clipboard',
]);

const PERMISSION_STATES = Object.freeze(['ask', 'granted', 'denied']);

const IPC = Object.freeze({
  // DeepSeek page -> main
  DEEPSEEK_RETRY_LOAD: 'deepseek:retry-load',
  DEEPSEEK_RENDERER_ERROR: 'deepseek:renderer-error',
  DEEPSEEK_NOTIFY_TURN_LIFECYCLE: 'deepseek:notify-turn-lifecycle',

  // Top bar
  TOPBAR_OPEN_MENU: 'topbar:open-menu',
  TOPBAR_OPEN_ACCOUNT_MENU: 'topbar:open-account-menu',
  TOPBAR_MINIMIZE: 'topbar:minimize',
  TOPBAR_MAXIMIZE_TOGGLE: 'topbar:maximize-toggle',
  TOPBAR_CLOSE: 'topbar:close',
  TOPBAR_STATE: 'topbar:state',

  // Back bar
  BACKBAR_HOME: 'backbar:home',

  // Find bar
  FINDBAR_SEARCH: 'findbar:search',
  FINDBAR_NEXT: 'findbar:next',
  FINDBAR_PREV: 'findbar:prev',
  FINDBAR_CLOSE: 'findbar:close',
  FINDBAR_CLEAR: 'findbar:clear',
  FINDBAR_RESULT: 'findbar:result',
  FINDBAR_FOCUS: 'findbar:focus',

  // Permission dialog
  PERMISSION_REQUEST_DATA: 'permission:request-data',
  PERMISSION_GET_CURRENT: 'permission:get-current-request',
  PERMISSION_RESPOND: 'permission:respond',
  PERMISSION_OPEN_SETTINGS: 'permission:open-settings',

  // Display capture dialog
  CAPTURE_REQUEST_DATA: 'display-capture:request-data',
  CAPTURE_GET_CURRENT: 'display-capture:get-current-request',
  CAPTURE_RESPOND: 'display-capture:respond',

  // Settings modal
  SETTINGS_GET_ALL: 'settings:get-all',
  SETTINGS_UPDATE: 'settings:update',
  SETTINGS_RESET_PERMISSIONS: 'settings:reset-permissions',
  SETTINGS_CHECK_UPDATES: 'settings:check-for-updates',
  SETTINGS_GET_LOGS: 'settings:get-logs',
  SETTINGS_COPY_TEXT: 'settings:copy-text',
  SETTINGS_SIGN_OUT: 'settings:sign-out',
  SETTINGS_RESTART_APP: 'settings:restart-app',
  SETTINGS_OPEN_EXTERNAL: 'settings:open-external',
  SETTINGS_CLOSE: 'settings:close',
  SETTINGS_READY: 'settings:ready',
  SETTINGS_OPENED: 'settings:opened',
  SETTINGS_UPDATE_RESULT: 'settings:update-check-result',

  // Update banner
  UPDATE_BANNER_SHOW: 'update-banner:show',
  UPDATE_BANNER_OPEN_RELEASE: 'update-banner:open-release',
  UPDATE_BANNER_DISMISS: 'update-banner:dismiss',
});

module.exports = {
  DEEPSEEK_HOME_URL,
  DEEPSEEK_APP_URL,
  GITHUB_REPO_URL,
  GITHUB_RELEASES_API_URL,
  GITHUB_RELEASES_PAGE_URL,
  BUNDLE_SCHEME,
  BUNDLE_HOST,
  BUNDLE_ORIGIN,
  DEEPSEEK_HOSTS,
  AUTH_HOSTS,
  OAUTH_FLOW_HOSTS,
  LOG_REDACT_DOMAINS,
  LAYOUT,
  ZOOM,
  DANGEROUS_CLI_SWITCHES,
  VALID_PERMISSIONS,
  PERMISSION_STATES,
  IPC,
};
