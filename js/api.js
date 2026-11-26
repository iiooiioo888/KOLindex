/* KOLindex · 唯一的資料請求層。各分頁不准再自己 fetch 業務資料。
 * 401 與 500 會清掉畫面上的資料；一般離線會保留上次結果，並在右下角提示重試。
 * 沒有後端就顯示未連線，不回退示範資料。
 */
(function () {
  'use strict';

  var POLL_MS = 60000;
  var TIMEOUT_MS = 8000;
  var RETRY_MS = 8000;
  var CACHE_KEY = 'kolindex.cache.v1';
  var CACHE_MAX_MS = 6 * 60 * 60 * 1000;
  var firstPaint = true;
  var failures = 0;
  var epoch = 0;
  var lastOkAt = 0;
  var lastMs = 0;
  var lastError = '';
  var retryTimer = 0;
  var netHideTimer = 0;
  var netDismissed = false;
  var inflight = null;

  function ui() { return window.KOLINDEX_UI || null; }
  function chipEl() { return document.getElementById('dataChip'); }
  function $(id) { return document.getElementById(id); }

  function fmtClock(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    function p(n) { return n < 10 ? '0' + n : String(n); }
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function paint(text, tone, title) {
    var c = chipEl();
    var full = title || '';
    // 只有連線成功時才把延遲附在 tooltip；離線或顯示快取時 lastMs 是上一次的，不能拿來誤導
    if (full && tone === 'green' && lastMs) full += ' · ' + lastMs + ' ms';
    if (!c) return;
    c.textContent = text;
    c.className = 'chip';
    if (full) c.title = full;
    c.setAttribute('data-api', tone === 'green' ? 'live' : 'offline');
    c.setAttribute('data-source', title || '');
    var lat = $('apiLatency');
    if (lat) lat.textContent = (tone === 'green' && lastMs) ? lastMs + ' ms' : '—';
  }

  function emit(ok, extra) {
    try {
      if (typeof window.CustomEvent !== 'function' || typeof window.dispatchEvent !== 'function') return;
      var detail = { ok: !!ok, hits: {}, reason: '', at: Date.now(), ms: lastMs };
      if (extra) {
        if (extra.hits) detail.hits = extra.hits;
        if (extra.reason) detail.reason = extra.reason;
        if (typeof extra.ms === 'number') detail.ms = extra.ms;
      }
      window.dispatchEvent(new window.CustomEvent('kolindex:api', { detail: detail }));
    } catch (e) { /* 事件失敗不影響請求結果 */ }
  }

  function netBar() { return $('netBar'); }
  function showNet(msg) {
    if (netDismissed) return;
    var bar = netBar();
    if (!bar) return;
    if (netHideTimer) { clearTimeout(netHideTimer); netHideTimer = 0; }
    var text = $('netText');
    if (text) text.textContent = msg;
    bar.setAttribute('data-state', 'down');
    bar.hidden = false;
  }
  function showNetUp() {
    var bar = netBar();
    if (!bar || bar.hidden) return;
    var text = $('netText');
    if (text) text.textContent = '後端已連線';
    bar.setAttribute('data-state', 'up');
    bar.hidden = false;
    if (netHideTimer) clearTimeout(netHideTimer);
    netHideTimer = setTimeout(function () {
      netHideTimer = 0;
      if (bar && bar.getAttribute('data-state') === 'up') bar.hidden = true;
    }, 3200);
  }
  function hideNet() {
    var bar = netBar();
    if (bar) bar.hidden = true;
    if (netHideTimer) { clearTimeout(netHideTimer); netHideTimer = 0; }
  }

  function saveCache(collect, alerts) {
    try {
      if (typeof sessionStorage === 'undefined') return;
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), collect: collect || [], alerts: alerts || [] }));
    } catch (e) { /* 私密模式或容量不足時忽略 */ }
  }
  function restoreCache(bridge) {
    try {
      if (typeof sessionStorage === 'undefined') return false;
      var raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return false;
      var c = JSON.parse(raw);
      if (!c || !c.at || Date.now() - c.at > CACHE_MAX_MS) return false;
      var got = false;
      if (Array.isArray(c.collect) && bridge.setCollect) got = bridge.setCollect(c.collect, { source: 'cache' }) || got;
      if (Array.isArray(c.alerts) && bridge.setAlerts) got = bridge.setAlerts(c.alerts) || got;
      if (got) {
        lastOkAt = c.at;
        paint('快取', 'or', '顯示 ' + fmtClock(c.at) + ' 的上次結果，正在重連');
      }
      return got;
    } catch (e) { return false; }
  }

  function clearScreen(reason) {
    epoch += 1;
    var bridge = ui();
    if (bridge && typeof bridge.invalidate === 'function') bridge.invalidate(reason);
    hideNet();
    emit(false, { reason: reason });
    if (reason === '401' && window.KOLINDEX_LOGIN && typeof window.KOLINDEX_LOGIN.logout === 'function') {
      window.KOLINDEX_LOGIN.logout();
    }
  }

  function request(path, opt) {
    var seen = epoch;
    var started = Date.now();
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
        lastMs = Math.max(1, Date.now() - started);
        return { data: data, status: r.status, at: new Date().toISOString(), source: path, ms: lastMs };
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
      return { ok: true, status: res.status, data: res.data, at: res.at, source: res.source, ms: res.ms };
    }, function (err) {
      return { ok: false, status: err && err.status || 0, data: {}, error: String(err && err.message || err), source: path };
    });
  }

  function scheduleRetry() {
    if (retryTimer) return;
    if (failures <= 0) return;
    retryTimer = setTimeout(function () {
      retryTimer = 0;
      if (typeof document !== 'undefined' && document.hidden) return;
      sync();
    }, RETRY_MS);
  }

  function retry() {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = 0; }
    return sync();
  }

  function doSync() {
    var bridge = ui();
    if (!bridge) { emit(false, { reason: 'no-bridge' }); return Promise.resolve({ ok: false, reason: 'no-bridge' }); }
    var hits = { collect: 0, alerts: 0 };
    var collectCache = null;
    var alertsCache = null;
    var collect = request('/api/collect').then(function (res) {
      var d = res.data;
      var items = d && Array.isArray(d.items) ? d.items : [];
      var slim = items.map(function (x) {
        return { id: x.id, accountId: x.accountId, title: x.title, source: x.source, pri: x.pri, priLabel: x.priLabel,
          role: x.role, state: x.state, note: x.note, taskId: x.taskId, decidedBy: x.decidedBy,
          srcName: x.srcName, srcCat: x.srcCat, srcLicense: x.srcLicense };
      });
      collectCache = slim;
      if (bridge.setCollect(slim, { source: '/api/collect', at: res.at })) hits.collect = slim.length;
    });
    var alerts = request('/api/alerts').then(function (res) {
      var d = res.data;
      var items = d && Array.isArray(d.ui) ? d.ui : [];
      alertsCache = items;
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
        lastOkAt = Date.now();
        lastError = '';
        netDismissed = false;
        saveCache(collectCache, alertsCache);
        var counts = bridge.counts ? bridge.counts() : hits;
        paint('已連線', 'green', '已連線 · /api/collect · /api/alerts · ' + new Date().toISOString());
        showNetUp();
        emit(true, { hits: counts });
      } else {
        failures += 1;
        var why = '';
        for (var i = 0; i < res.length; i++) {
          if (res[i].status === 'rejected' && res[i].reason) {
            why = String(res[i].reason.message || res[i].reason.status || res[i].reason);
            break;
          }
        }
        lastError = why;
        var ago = lastOkAt ? fmtClock(lastOkAt) : '';
        paint('未連線', 'or', '收集與告警沒有連上。' + (why ? '原因：' + why + '。' : '') + (lastOkAt ? '顯示 ' + ago + ' 的最後結果。' : '目前沒有可顯示的資料。'));
        showNet('後端離線 · ' + (lastOkAt ? '顯示 ' + ago + ' 的資料' : '目前沒有資料') + ' · 每 ' + Math.round(RETRY_MS / 1000) + ' 秒重試');
        emit(false, { hits: hits, reason: 'offline' });
        scheduleRetry();
      }
      firstPaint = false;
      return { ok: up, hits: hits };
    });
  }

  function sync() {
    if (inflight) return inflight;
    inflight = doSync().then(function (r) { inflight = null; return r; }, function (e) { inflight = null; throw e; });
    return inflight;
  }

  function bindNet() {
    var r = $('netRetry');
    if (r) r.addEventListener('click', function () { retry(); });
    var x = $('netClose');
    if (x) x.addEventListener('click', function () { netDismissed = true; hideNet(); });
    if (typeof window.addEventListener === 'function') {
      window.addEventListener('online', function () { retry(); });
      window.addEventListener('offline', function () { showNet('瀏覽器離線 · 顯示上次資料'); });
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden && failures > 0) retry();
      });
    }
  }

  function boot() {
    if (!ui()) { setTimeout(boot, 400); return; }
    bindNet();
    if (!restoreCache(ui())) paint('連線中', 'dim', '正在連後端');
    sync().then(function () { setInterval(sync, POLL_MS); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.KOL = { request: function (path, opt) { return request(path, opt).then(function (res) { return res.data; }); }, requestStatus: requestStatus, clear: clearScreen };
  window.KOLINDEX_API = {
    sync: sync,
    retry: retry,
    pollMs: POLL_MS,
    retryMs: RETRY_MS,
    state: function () { return { firstPaint: firstPaint, failures: failures, lastOkAt: lastOkAt, lastMs: lastMs, lastError: lastError }; }
  };
})();
