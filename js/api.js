/* KOLindex · 唯一的資料請求層。各分頁不准再自己 fetch 業務資料。
 * 401 與 500 會清掉畫面上的資料。示範模式（?demo=1）不打後端。
 */
(function () {
  'use strict';

  var POLL_MS = 60000;
  var TIMEOUT_MS = 8000;
  var firstPaint = true;
  var failures = 0;
  var epoch = 0;

  function demoOn() { return document.documentElement.getAttribute('data-demo') === '1'; }
  function ui() { return window.KOLINDEX_UI || null; }
  function chipEl() { return document.getElementById('dataChip'); }

  function paint(text, tone, title) {
    var c = chipEl();
    if (!c) return;
    c.textContent = text;
    c.className = 'chip ' + (tone || 'or');
    if (title) c.title = title;
    c.setAttribute('data-api', tone === 'green' ? 'live' : 'offline');
    c.setAttribute('data-source', title || '');
  }

  function emit(ok, extra) {
    try {
      if (typeof window.CustomEvent !== 'function' || typeof window.dispatchEvent !== 'function') return;
      var detail = { ok: !!ok, hits: {}, reason: '', at: Date.now() };
      if (extra) {
        if (extra.hits) detail.hits = extra.hits;
        if (extra.reason) detail.reason = extra.reason;
      }
      window.dispatchEvent(new window.CustomEvent('kolindex:api', { detail: detail }));
    } catch (e) { /* 事件失敗不影響請求結果 */ }
  }

  function clearScreen(reason) {
    epoch += 1;
    var bridge = ui();
    if (bridge && typeof bridge.invalidate === 'function') bridge.invalidate(reason);
    emit(false, { reason: reason });
    if (reason === '401' && window.KOLINDEX_LOGIN && typeof window.KOLINDEX_LOGIN.logout === 'function') {
      window.KOLINDEX_LOGIN.logout();
    }
  }

  function request(path, opt) {
    if (demoOn()) {
      var blocked = new Error('demo');
      blocked.status = 0;
      return Promise.reject(blocked);
    }
    var seen = epoch;
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS) : null;
    var option = opt || {};
    return fetch(path, {
      method: option.method || 'GET',
      headers: Object.assign({ accept: 'application/json' }, option.headers || {}),
      body: option.body,
      cache: 'no-store',
      credentials: 'same-origin',
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      if (timer) clearTimeout(timer);
      if (seen !== epoch) {
        var stale = new Error('cleared');
        stale.status = r.status;
        throw stale;
      }
      if (r.status === 401 || r.status === 500) {
        clearScreen(String(r.status));
        paint(r.status === 401 ? '需要登入' : '來源錯誤', 'or', path + ' · HTTP ' + r.status);
        var err = new Error('HTTP ' + r.status + ' ' + path);
        err.status = r.status;
        throw err;
      }
      if (!r.ok) {
        var bad = new Error('HTTP ' + r.status + ' ' + path);
        bad.status = r.status;
        throw bad;
      }
      return r.json().then(function (data) {
        return { data: data, status: r.status, at: new Date().toISOString(), source: path };
      });
    }, function (err) {
      if (timer) clearTimeout(timer);
      if (err && err.name === 'AbortError') {
        var timeout = new Error('timeout ' + path);
        timeout.status = 0;
        throw timeout;
      }
      throw err;
    });
  }

  function requestStatus(path, opt) {
    return request(path, opt).then(function (res) {
      return { ok: true, status: res.status, data: res.data, at: res.at, source: res.source };
    }, function (err) {
      return { ok: false, status: err && err.status || 0, data: {}, error: String(err && err.message || err), source: path };
    });
  }

  function sync() {
    if (demoOn()) {
      paint('示範', 'or', 'demo');
      return Promise.resolve({ ok: false, reason: 'demo' });
    }
    var bridge = ui();
    if (!bridge) { emit(false, { reason: 'no-bridge' }); return Promise.resolve({ ok: false, reason: 'no-bridge' }); }
    var hits = { collect: 0, alerts: 0 };
    var collect = request('/api/collect').then(function (res) {
      var d = res.data;
      var items = d && Array.isArray(d.items) ? d.items : [];
      var slim = items.map(function (x) {
        return { id: x.id, accountId: x.accountId, title: x.title, source: x.source, pri: x.pri, priLabel: x.priLabel,
          role: x.role, state: x.state, note: x.note, taskId: x.taskId, decidedBy: x.decidedBy,
          srcName: x.srcName, srcCat: x.srcCat, srcLicense: x.srcLicense };
      });
      if (bridge.setCollect(slim, { source: '/api/collect', at: res.at })) hits.collect = slim.length;
    });
    var alerts = request('/api/alerts').then(function (res) {
      var d = res.data;
      var items = d && Array.isArray(d.ui) ? d.ui : [];
      if (bridge.setAlerts(items) && items.length) hits.alerts = items.length;
    });
    return Promise.allSettled([collect, alerts]).then(function (res) {
      var denied = res.some(function (r) { return r.status === 'rejected' && r.reason && (r.reason.status === 401 || r.reason.status === 500); });
      if (denied) {
        if (bridge.invalidate) bridge.invalidate('401');
        return { ok: false, hits: hits };
      }
      var up = res.some(function (r) { return r.status === 'fulfilled'; });
      if (up) {
        failures = 0;
        var counts = bridge.counts ? bridge.counts() : hits;
        paint('API · LIVE', 'green', '/api/collect · /api/alerts · ' + new Date().toISOString());
        emit(true, { hits: counts });
      } else {
        failures += 1;
        if (bridge.invalidate) bridge.invalidate('offline');
        paint('未連線', 'or', '收集與告警沒有連上。已清掉畫面上的資料。');
        emit(false, { hits: hits, reason: 'offline' });
      }
      firstPaint = false;
      return { ok: up, hits: hits };
    });
  }

  function boot() {
    if (demoOn()) { paint('示範', 'or', 'demo'); return; }
    if (!ui()) { setTimeout(boot, 400); return; }
    paint('API · 連線中', 'or', '正在連後端');
    sync().then(function () { setInterval(sync, POLL_MS); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.KOL = { request: function (path, opt) { return request(path, opt).then(function (res) { return res.data; }); }, requestStatus: requestStatus, clear: clearScreen };
  window.KOLINDEX_API = { sync: sync, pollMs: POLL_MS, state: function () { return { firstPaint: firstPaint, failures: failures }; } };
})();
