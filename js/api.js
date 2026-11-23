/* KOLindex · api.js — 收集與告警的輪詢（60 秒）。寫入在各分頁自己的檔案。
 *
 * 後端是 F:\DeepPlaygrent\kolindex-api\server.mjs（node:sqlite + node:http），
 * 由 dev-server.mjs 的 /api/* 反向代理轉發。右欄 rail.js 是 15 秒，不是這支。
 *
 * 連不上或 401 時清掉收集與告警，不留示範卡片。401 會回到登入閘。
 */
(function () {
  'use strict';

  var POLL_MS = 60000;            // 一分鐘對一次；收集頁的認領／退回由 index2.js 自己送，這裡只負責重抓
  var firstPaint = true;
  var failures = 0;

  function ui() { return window.KOLINDEX_UI || null; }
  function chipEl() { return document.getElementById('dataChip'); }

  function paint(text, tone, title) {
    var c = chipEl();
    if (!c) return;
    c.textContent = text;
    c.className = 'chip ' + (tone || 'or');
    if (title) c.title = title;
    c.setAttribute('data-api', tone === 'green' ? 'live' : 'offline');
  }

  function getJSON(path) {
    return fetch(path, {
      headers: { accept: 'application/json' },
      cache: 'no-store'
    }).then(function (r) {
      if (!r.ok) {
        var err = new Error('HTTP ' + r.status + ' ' + path);
        err.status = r.status;
        throw err;
      }
      return r.json();
    });
  }

  function emit(ok, extra) {
    // 通知其他模組（person.js 等）後端連線狀態；測試環境沒有 CustomEvent 就跳過
    try {
      if (typeof window.CustomEvent !== 'function' || typeof window.dispatchEvent !== 'function') return;
      var detail = { ok: !!ok, hits: {}, reason: '', at: Date.now() };
      if (extra) {
        if (extra.hits) detail.hits = extra.hits;
        if (extra.reason) detail.reason = extra.reason;
      }
      window.dispatchEvent(new window.CustomEvent('kolindex:api', { detail: detail }));
    } catch (e) { /* 事件是加分項，不影響主流程 */ }
  }

  function sync() {
    var bridge = ui();
    if (!bridge) { emit(false, { reason: 'no-bridge' }); return Promise.resolve({ ok: false, reason: 'no-bridge' }); }

    var hits = { collect: 0, alerts: 0 };

    var collect = getJSON('/api/collect').then(function (d) {
      var items = d && Array.isArray(d.items) ? d.items : [];
      // 拿到回應就以它為準，即使是空陣列（否則清空資料庫後頁面還留著示範卡片）
      // 只帶要用的欄位；srcName/srcCat/srcLicense 讓卡片顯示正確的來源名
      var slim = items.map(function (x) {
        return { id: x.id, accountId: x.accountId, title: x.title, source: x.source, pri: x.pri, priLabel: x.priLabel,
          role: x.role, state: x.state, note: x.note, taskId: x.taskId, decidedBy: x.decidedBy,
          srcName: x.srcName, srcCat: x.srcCat, srcLicense: x.srcLicense };
      });
      if (bridge.setCollect(slim)) hits.collect = slim.length;
    });

    var alerts = getJSON('/api/alerts').then(function (d) {
      var items = d && Array.isArray(d.ui) ? d.ui : [];
      // 同 collect：成功就覆蓋，空陣列代表「目前沒有告警」
      if (bridge.setAlerts(items) && items.length) hits.alerts = items.length;
    });

    return Promise.allSettled([collect, alerts]).then(function (res) {
      var denied = res.some(function (r) { return r.status === 'rejected' && r.reason && r.reason.status === 401; });
      if (denied) {
        if (bridge.setCollect) bridge.setCollect([]);
        if (bridge.setAlerts) bridge.setAlerts([]);
        paint('需要登入', 'or', '工作階段失效。收集與告警已清掉，不顯示示範卡片。');
        if (window.KOLINDEX_LOGIN && typeof window.KOLINDEX_LOGIN.logout === 'function') window.KOLINDEX_LOGIN.logout();
        emit(false, { hits: hits, reason: '401' });
        return { ok: false, hits: hits };
      }
      var up = res.some(function (r) { return r.status === 'fulfilled'; });
      if (up) {
        failures = 0;
        var counts = bridge.counts ? bridge.counts() : hits;
        paint('API · LIVE', 'green',
          'kolindex-api 已連線：收集 ' + counts.collect + ' 項、告警 ' + counts.alerts + ' 筆（每 ' + (POLL_MS / 1000) + ' 秒重抓）');
      } else {
        failures += 1;
        if (bridge.setCollect) bridge.setCollect([]);
        if (bridge.setAlerts) bridge.setAlerts([]);
        var why = res.map(function (r) { return r.status === 'rejected' ? String(r.reason && r.reason.message || r.reason) : ''; })
          .filter(Boolean).join(' / ');
        paint('未連線', 'or',
          '收集與告警沒有連上後端，已清掉示範卡片。' + (why ? '（' + why + '）' : '') + ' 輪詢 ' + (POLL_MS / 1000) + ' 秒。');
      }
      firstPaint = false;
      emit(up, { hits: hits, reason: up ? '' : why });
      return { ok: up, hits: hits };
    });
  }

  function boot() {
    if (!ui()) {
      // index2.js 還沒跑完（defer 順序被改壞時）→ 晚一點再試一次，不報錯
      setTimeout(boot, 400);
      return;
    }
    paint('API · 連線中', 'or', '正在連 kolindex-api');
    sync().then(function () {
      setInterval(sync, POLL_MS);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // 測試/除錯用
  window.KOLINDEX_API = { sync: sync, pollMs: POLL_MS, state: function () { return { firstPaint: firstPaint, failures: failures }; } };
})();
