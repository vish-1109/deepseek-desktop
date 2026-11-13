'use strict';

window.addEventListener('DOMContentLoaded', () => {
  const retryBtn = document.getElementById('btn-retry');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      window.deepseekOffline?.retryLoad();
    });
  }
  window.addEventListener('online', () => {
    window.deepseekOffline?.retryLoad();
  });
});
