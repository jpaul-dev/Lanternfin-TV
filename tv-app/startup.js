/* Deliberately ES5 and independent of app.js so a startup syntax error is visible. */
(function () {
  'use strict';
  var timer;
  function check() {
    var root = document.documentElement;
    var styled = window.getComputedStyle(root).getPropertyValue('--lanternfin-styles').trim() === 'ready';
    var ready = root.getAttribute('data-app-ready') === 'true';
    if (styled && ready) return;
    var panel = document.getElementById('startup-status');
    if (!panel) return;
    var version = /(?:Chrome|Chromium)\/(\d+)/.exec(navigator.userAgent || '');
    var reason = !styled ? 'The app’s local stylesheet did not load.' : 'The app could not finish starting.';
    panel.textContent = 'Lanternfin TV — startup problem. ' + reason + (version ? ' TV browser: Chromium ' + version[1] + '.' : '') + ' Rebuild this checkout in TV Setup, install it again, then close and reopen the TV app. Your saved sources do not need to be deleted.';
    panel.hidden = false;
    // Individual trusted CSSOM properties work even if the external CSS failed.
    panel.style.position = 'fixed'; panel.style.top = '8%'; panel.style.left = '8%'; panel.style.right = '8%';
    panel.style.padding = '32px'; panel.style.backgroundColor = '#181b25'; panel.style.color = '#ffffff';
    panel.style.border = '2px solid #eda4db'; panel.style.font = '24px Arial, sans-serif'; panel.style.lineHeight = '1.6'; panel.style.zIndex = '9999';
    document.getElementById('app').hidden = true;
  }
  window.addEventListener('load', function () { timer = window.setTimeout(check, 5000); });
  window.addEventListener('lanternfin-ready', function () { window.clearTimeout(timer); check(); });
}());
