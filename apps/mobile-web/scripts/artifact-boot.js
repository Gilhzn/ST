/*
 * Boot shim for the claude.ai Artifact demo (inlined into index.html by build-artifact.mjs,
 * ahead of the Expo bundles). The Artifact viewer serves the page from an unknown sub-path
 * inside a sandboxed frame, so:
 *  1. <base href> pins every relative URL (bundles, async chunks, fonts, map worker) to the
 *     page's own directory, even after Expo Router rewrites the URL with pushState.
 *  2. The route is reset to "/" so Expo Router starts on the home screen.
 *  3. localStorage gets an in-memory fallback when the sandbox refuses it.
 *  4. Boot failures render a readable card instead of a blank screen.
 */
(function () {
  var base = location.href.split('#')[0].split('?')[0].replace(/[^/]*$/, '');
  window.__ST_BASE__ = base;
  var tag = document.createElement('base');
  tag.href = base;
  document.head.insertBefore(tag, document.head.firstChild);

  try {
    if (location.pathname !== '/') history.replaceState(null, '', '/');
  } catch (e) {
    window.__ST_ROUTE_RESET_FAILED__ = String(e);
  }

  var storageOk = false;
  try {
    var k = '__st_probe__';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    storageOk = true;
  } catch { /* storage unavailable: shim below */ }
  if (!storageOk) {
    var mem = {};
    var shim = {
      getItem: function (key) { return Object.prototype.hasOwnProperty.call(mem, key) ? mem[key] : null; },
      setItem: function (key, v) { mem[key] = String(v); },
      removeItem: function (key) { delete mem[key]; },
      clear: function () { mem = {}; },
      key: function (i) { return Object.keys(mem)[i] || null; },
      get length() { return Object.keys(mem).length; },
    };
    try { Object.defineProperty(window, 'localStorage', { configurable: true, value: shim }); } catch { /* keep the native object */ }
  }

  function showError(title, detail) {
    var root = document.getElementById('root');
    if (!root || root.getAttribute('data-st-error')) return;
    root.setAttribute('data-st-error', '1');
    root.innerHTML =
      '<div style="margin:auto;max-width:420px;padding:24px;font:15px/1.5 system-ui,sans-serif;color:#E9EAF2">' +
      '<div style="font-size:20px;font-weight:700;margin-bottom:8px">Sport Talent</div>' +
      '<div style="font-weight:600;margin-bottom:8px"></div>' +
      '<pre style="white-space:pre-wrap;word-break:break-word;font-size:12px;opacity:.8;background:rgba(255,255,255,.06);padding:12px;border-radius:12px"></pre>' +
      '</div>';
    root.querySelector('div div:nth-child(2)').textContent = title;
    root.querySelector('pre').textContent = String(detail || '') + '\nbase: ' + base;
  }
  window.addEventListener('error', function (e) {
    var target = e.target;
    if (target && target !== window && (target.src || target.href)) {
      showError('A file failed to load', target.src || target.href);
    } else if (!document.querySelector('#root > *:not([data-st-error])')) {
      showError('The app failed to start', (e.error && e.error.stack) || e.message);
    }
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    if (!document.querySelector('#root > *')) showError('The app failed to start', e.reason && (e.reason.stack || e.reason));
  });
  setTimeout(function () {
    var root = document.getElementById('root');
    if (root && !root.firstElementChild) showError('The app is taking too long to start', 'No content after 12 s');
  }, 12000);
})();
