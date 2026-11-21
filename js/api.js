/* KOLindex · api.js — 這頁唯一跟後端說話的地方（唯讀）
 *
 * 後端是 F:\DeepPlaygrent\kolindex-api\server.mjs（node:sqlite + node:http），
 * 由 dev-server.mjs 的 /api/* 反向代理轉發，所以前端是同源呼叫，不用處理 CORS。
 *
 * 規則：只有真的拿到資料才覆蓋頁面上的示範資料；拿不到就靜靜保留示範資料，
 *      只把右上角的 chip 從「DEMO DATA」改成「API DOWN」，不彈窗、不擋任何操作。
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
      if (!items.length) return;
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
      if (!items.length) return;
      if (bridge.setAlerts(items)) hits.alerts = items.length;
    });

    return Promise.allSettled([collect, alerts]).then(function (res) {
      var up = res.some(function (r) { return r.status === 'fulfilled'; });
      if (up) {
        failures = 0;
        var counts = bridge.counts ? bridge.counts() : hits;
        paint('API · LIVE', 'green',
          'kolindex-api 已連線：收集 ' + counts.collect + ' 項、告警 ' + counts.alerts + ' 筆（每 ' + (POLL_MS / 1000) + ' 秒重抓）');
      } else {
        failures += 1;
        var why = res.map(function (r) { return r.status === 'rejected' ? String(r.reason && r.reason.message || r.reason) : ''; })
          .filter(Boolean).join(' / ');
        paint(failures > 1 ? 'API DOWN' : 'DEMO DATA', 'or',
          '拿不到後端資料，頁面保留示範資料。' + (why ? '（' + why + '）' : '') + ' 另開終端跑：node kolindex-api/server.mjs');
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
