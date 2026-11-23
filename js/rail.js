/* KOLindex · rail.js — 右欄監控全部接 /api/rail（真實資料）
 *
 * index2.js 內建的右欄面板是示範調度（隨機漫步）。這支檔案在載入時先把
 * window.KOLINDEX_RAIL_LIVE 設為 true，讓 index2.js 的假調度放手，
 * 再用 /api/rail 的資料自己畫：佇列深度、六格指標、走勢、連接器槽位、
 * Dispatcher 的認領／退回、事件流（audit_log）、操作審計、儲存。
 *
 * 後端：F:\DeepPlaygrent\kolindex-api\server.mjs 的 GET /api/rail
 * 代理：dev-server.mjs 的 /api/*
 */
(function () {
  'use strict';

  window.KOLINDEX_RAIL_LIVE = true;

  var BASE = window.KOLINDEX_BASE || '';
  var POLL_MS = 15000;

  var R = {
    ok: false, loaded: false, loading: false, queued: false,
    range: '24H', data: null, at: 0, error: '',
    paused: false, cleared: false
  };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(n) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toLocaleString('en-US');
  }
  function clampPct(v) { return Math.max(0, Math.min(100, Math.round(v || 0))) + '%'; }
  function gb(bytes) {
    if (bytes == null) return '—';
    return (Number(bytes) / 1e9).toFixed(2) + ' GB';
  }
  function rel(at) {
    if (!at) return '—';
    var t = typeof at === 'number' ? at : Date.parse(String(at).replace(' ', 'T') + (/Z|[+-]\d\d:?\d\d$/.test(String(at)) ? '' : 'Z'));
    if (!isFinite(t)) return '—';
    var d = Math.round((Date.now() - t) / 1000);
    if (d < 45) return '剛剛';
    if (d < 3600) return Math.round(d / 60) + ' 分鐘前';
    if (d < 86400) return Math.round(d / 3600) + ' 小時前';
    if (d < 86400 * 30) return Math.round(d / 86400) + ' 天前';
    var dt = new Date(t);
    return (dt.getMonth() + 1) + '/' + dt.getDate();
  }
  function hhmm(at) {
    if (at == null || at === '') return '—';
    var raw = String(at);
    var t = typeof at === 'number' ? at : Date.parse(raw.replace(' ', 'T') + (/Z|[+-]\d\d:?\d\d$/.test(raw) ? '' : 'Z'));
    if (!isFinite(t)) return '—';
    var d = new Date(t);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  /* ---------- 面板 1：佇列 ---------- */
  function tile(label, value, unit, tone, pct, color) {
    return '<div class="mtile"><div class="ml">' + esc(label) + '</div>' +
      '<div class="mv' + (tone ? ' tone-' + tone : '') + '">' + esc(value) +
      (unit ? '<small>' + esc(unit) + '</small>' : '') + '</div>' +
      (pct == null ? '' : '<div class="mbar"><i class="fill-' + (color || 'amber') + '" style="--pct:' + clampPct(pct) + '"></i></div>') +
      '</div>';
  }

  function paintTiles(q) {
    var el = $('railTiles'); if (!el) return;
    var p = q.parts || {};
    var depth = q.depth || 1;
    el.innerHTML = [
      tile('待收 · collect', num(p.collect), '項', 'amber', p.collect / depth * 100, 'amber'),
      tile('待複核 · review', num(p.review), '項', 'violet', p.review / depth * 100, 'violet'),
      tile('待採集 · queue', num(p.crawlQueued), '項', 'cyan', p.crawlQueued / depth * 100, 'cyan'),
      tile('採集運行', num(p.crawlRunning), '個', 'green', null),
      tile('阻塞／失敗', num(p.crawlFailed), '個', 'red', null),
      tile('今日寫入', num(q.auditToday), '筆', 'cyan', null)
    ].join('');
  }

  function paintChart(q, range) {
    range = range || R.range;
    var c = $('depthChart'); if (!c) return;
    var series = Array.isArray(q.series) ? q.series : [];
    var w = 300, h = 62, pad = 4;
    var len = series.length || 1;
    var max = Math.max.apply(null, series.concat([1]));
    var pts = series.map(function (v, i) {
      var x = pad + (len < 2 ? 0 : (i / (len - 1)) * (w - pad * 2));
      var y = h - pad - (v / max) * (h - pad * 2);
      return x.toFixed(1) + ',' + y.toFixed(1);
    });
    if (!pts.length) pts = [pad + ',' + (h - pad), (w - pad) + ',' + (h - pad)];
    var area = pad + ',' + (h - pad) + ' ' + pts.join(' ') + ' ' + (w - pad) + ',' + (h - pad);
    c.innerHTML = '<svg class="chart" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<defs><linearGradient id="railGrad" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#7fb2c9" stop-opacity=".32"></stop>' +
      '<stop offset="100%" stop-color="#7fb2c9" stop-opacity="0"></stop></linearGradient></defs>' +
      '<polygon fill="url(#railGrad)" points="' + area + '"></polygon>' +
      '<polyline fill="none" stroke="#7fb2c9" stroke-width="1.7" stroke-linejoin="round" points="' + pts.join(' ') + '"></polyline>' +
      '<circle r="2.4" fill="#7fb2c9" cx="' + pts[pts.length - 1].split(',')[0] + '" cy="' + pts[pts.length - 1].split(',')[1] + '"></circle>' +
      '</svg>';
    var start = $('rangeStart'); if (start) start.textContent = '-' + range;
    var mid = $('rangeMid'); if (mid) mid.textContent = '-' + (range === '24H' ? '12H' : range === '6H' ? '3H' : '30m');
  }

  function paintQueue(d) {
    var q = d.queue || {};
    var set = function (id, text) { var el = $(id); if (el) el.textContent = text; };
    set('railDepth', num(q.depth));
    var delta = $('railDelta');
    if (delta) {
      var dv = Number(q.delta) || 0;
      delta.textContent = dv === 0 ? '持平' : (dv > 0 ? '▲ +' + dv : '▼ ' + dv);
      delta.className = 'hc-delta ' + (dv >= 0 ? 'up' : 'down');
    }
    paintChart(d.queue, d.range);
    paintTiles(d.queue);
    var src = $('railSrc');
    if (src) src.textContent = R.ok ? 'api · 每 ' + (POLL_MS / 1000) + 's' : 'api · 離線';
    var sync = $('railSync');
    if (sync) sync.textContent = R.at ? rel(R.at) : '—';
    var note = $('railNote');
    if (note) {
      note.textContent = q.eventsInRange === 0
        ? ' · 此區間沒有寫入事件'
        : ' · ' + num(q.eventsInRange) + ' 筆寫入';
    }
  }

  /* ---------- 面板 2：連接器槽位 ---------- */
  function slotTone(status) {
    return status === 'active' ? 'green' : status === 'cooling' ? 'amber' : status === 'expired' ? 'red' : 'cyan';
  }

  function paintSlots(s) {
    var items = Array.isArray(s.items) ? s.items : [];
    var ok = $('railSlotOk'); if (ok) ok.textContent = num(s.active);
    var total = $('railSlotTotal'); if (total) total.textContent = num(s.total);
    var grid = $('railSlots');
    if (grid) {
      grid.innerHTML = items.length ? items.map(function (it) {
        var tone = slotTone(it.status);
        var load = it.jobs ? Math.min(100, (it.running / Math.max(1, it.jobs)) * 100) : 0;
        var meta = it.jobs ? it.jobs + ' 工作' : '無工作';
        if (it.failStreak) meta += ' · 失敗 ' + it.failStreak;
        return '<div class="slot" data-slot="' + esc(it.id) + '" data-status="' + esc(it.status) + '">' +
          '<div class="s-id"><span>' + esc(it.id) + '</span><span class="st tone-' + tone + '">' + esc(String(it.status).toUpperCase()) + '</span></div>' +
          '<div class="s-who">' + esc(it.platform) + '</div>' +
          '<div class="s-meta">' + esc(meta) + '</div>' +
          '<div class="s-ttl"><i style="--pct:' + clampPct(load) + '"></i></div></div>';
      }).join('') : '<div class="lane-empty">沒有連接器憑證</div>';
    }
    var quotas = $('railQuotas');
    if (quotas) {
      var rows = [
        ['可用', s.active, s.total, 'green'],
        ['冷卻', s.cooling, s.total, 'amber'],
        ['過期', s.expired, s.total, 'red']
      ];
      quotas.innerHTML = rows.map(function (r) {
        return '<div class="quota-row"><span class="ql">' + esc(r[0]) + '</span>' +
          '<div class="qtrack"><i class="fill-' + r[3] + '" style="--pct:' + clampPct(r[2] ? r[1] / r[2] * 100 : 0) + '"></i></div>' +
          '<span class="qv">' + num(r[1]) + '</span></div>';
      }).join('');
    }
    var state = $('railSlotState');
    if (state) state.textContent = num(s.active) + ' 可用 · ' + num(s.cooling) + ' 冷卻 · ' + num(s.expired) + ' 過期';
    var last = $('railSlotLast'); if (last) last.textContent = rel(s.lastOkAt);
    var fail = $('railSlotFail'); if (fail) fail.textContent = num(s.maxFailStreak) + ' 次';
  }

  /* ---------- 面板 3：Dispatcher ---------- */
  function paintDispatcher(d) {
    var ds = d.dispatcher || {};
    var work = (d.slots && d.slots.work) || {};
    var set = function (id, text) { var el = $(id); if (el) el.textContent = text; };
    set('dispScan', num(work.total) + ' 個工作 · ' + num(ds.accounts) + ' 個帳號');
    set('dispDispatch', num(ds.claimsToday));
    set('dispReclaim', num(ds.returnsToday));
    set('dispLast', ds.lastAt ? rel(ds.lastAt) : '—');
    var list = $('lockList');
    if (!list) return;
    var items = Array.isArray(ds.decisions) ? ds.decisions : [];
    list.innerHTML = items.length ? items.map(function (x) {
      var tone = x.action === 'claim' ? 'var(--green)' : 'var(--orange)';
      return '<div class="lock-row" data-decision="' + esc(x.id) + '">' +
        '<div class="lock-seat"><i style="background:' + tone + '"></i>' + esc(x.action === 'claim' ? '認領' : '退回') + '</div>' +
        '<div class="lock-info"><div class="li-1">C-' + esc(x.accountId) + (x.taskId ? ' · ' + esc(x.taskId) : '') + '</div>' +
        '<div class="li-2"><span>' + esc(x.actor || '—') + '</span><span>' + esc(rel(x.at)) + '</span></div></div></div>';
    }).join('') : '<div class="lane-empty" style="padding:6px 4px">尚無人工決定</div>';
  }

  /* ---------- 面板 4：事件流 ---------- */
  var EV_COLOR = { mylike: '#7fb2c9', library: '#cfa04a', collect: '#63b880', review: '#9a93c9', ai: '#cf8654' };

  function paintEvents(events) {
    if (R.paused) return;
    var el = $('eventStream'); if (!el) return;
    var items = Array.isArray(events) ? events : [];
    if (!items.length) {
      el.innerHTML = '<div class="lane-empty" style="padding:8px 4px">audit_log 還是空的</div>';
      return;
    }
    if (R.cleared) {
      if (items[0] && items[0].id !== R.clearedId) R.cleared = false;
      else { el.innerHTML = '<div class="lane-empty" style="padding:8px 4px">已清空，等新事件</div>'; return; }
    }
    el.innerHTML = items.map(function (e) {
      var key = String(e.action || '').split('.')[0];
      var color = EV_COLOR[key] || '#7a8894';
      var sub = e.subject ? ' <span class="dim">' + esc(e.subject) + '</span>' : '';
      return '<div class="ev"><span class="ts">' + esc(hhmm(e.at)) + '</span>' +
        '<span class="bul" style="background:' + color + '"></span>' +
        '<span class="msg"><b>' + esc(e.action) + '</b>' + sub + '</span></div>';
    }).join('');
  }

  /* ---------- 面板 6：操作審計 ---------- */
  function paintAudit(groups) {
    var el = $('auditList'); if (!el) return;
    var items = Array.isArray(groups) ? groups : [];
    el.innerHTML = items.length ? items.map(function (g) {
      return '<div class="audit-row"><span class="who">' + esc(g.action) + '</span>' +
        '<span class="act">' + num(g.n) + ' 次</span><span>' + esc(rel(g.last)) + '</span></div>';
    }).join('') : '<div class="lane-empty" style="padding:10px 4px">尚無操作</div>';
  }

  /* ---------- 面板 7：儲存 ---------- */
  function barPct(id, value) {
    var el = $(id); if (el) el.style.setProperty('--pct', clampPct(value));
  }

  function paintStorage(s) {
    var set = function (id, text) { var el = $(id); if (el) el.textContent = text; };
    set('stBytes', gb(s.bytes) + ' · ' + num(s.files) + ' 檔');
    barPct('stBytesBar', s.totalGb ? (Number(s.bytes) / 1e9) / s.totalGb * 100 : 0);
    set('stFree', (s.usedPct == null ? '—' : s.usedPct + '%') + ' · 剩 ' + num(s.freeGb) + ' GB');
    barPct('stFreeBar', s.usedPct || 0);
    set('stMissing', num(s.missing) + ' 件 · ' + (s.items ? (s.missing / s.items * 100).toFixed(1) : '0') + '%');
    barPct('stMissingBar', s.items ? s.missing / s.items * 100 : 0);
    set('stItems', num(s.items));
    set('stKinds', num(s.galleries) + ' / ' + num(s.videos));
    set('stAuthors', num(s.authors));
  }

  /* ---------- 抓資料 ---------- */
  function paint(d) {
    R.data = d;
    R.ok = true;
    R.loaded = true;
    R.at = Date.now();
    R.error = '';
    paintQueue(d);
    paintSlots(d.slots || {});
    paintDispatcher(d);
    paintEvents(d.events);
    paintAudit(d.audit);
    paintStorage(d.storage || {});
  }

  function paintOffline(err) {
    R.ok = false;
    R.error = String((err && err.message) || err || 'offline');
    var src = $('railSrc'); if (src) src.textContent = 'api · 離線';
    var note = $('railNote');
    if (note) note.textContent = R.loaded
      ? ' · 離線，顯示上次結果（' + rel(R.at) + '）'
      : ' · 連不到 /api/rail，等後端回來';
    if (!R.loaded) return;
    /* 保留上次的數字，只把連線狀態標記出來 */
  }

  function load() {
    if (R.loading) { R.queued = true; return Promise.resolve(R.data); }
    R.loading = true;
    return fetch(BASE + '/api/rail?range=' + encodeURIComponent(R.range), {
      headers: { accept: 'application/json' }, cache: 'no-store'
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (d) {
      paint(d);
      return d;
    }).catch(function (err) {
      paintOffline(err);
      return R.data;
    }).then(function (d) {
      R.loading = false;
      if (R.queued) { R.queued = false; setTimeout(load, 30); }
      return d;
    });
  }

  /* ---------- 事件 ---------- */
  function bind() {
    var row = $('rangeRow');
    if (row) row.addEventListener('click', function (e) {
      var b = e.target.closest('.range-btn'); if (!b) return;
      var r = b.getAttribute('data-range'); if (!r || r === R.range) return;
      Array.prototype.forEach.call(row.querySelectorAll('.range-btn'), function (x) {
        x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
      });
      R.range = r;
      var start = $('rangeStart'); if (start) start.textContent = '-' + r;
      load();
    });

    var pause = $('evPause');
    if (pause) pause.addEventListener('click', function () {
      R.paused = !R.paused;
      pause.textContent = R.paused ? 'RESUME' : 'PAUSE';
      if (!R.paused && R.data) paintEvents(R.data.events);
    });

    var clear = $('evClear');
    if (clear) clear.addEventListener('click', function () {
      R.cleared = true;
      R.clearedId = R.data && R.data.events && R.data.events[0] ? R.data.events[0].id : null;
      var el = $('eventStream');
      if (el) el.innerHTML = '<div class="lane-empty" style="padding:8px 4px">已清空，等新事件</div>';
    });

    /* 新事件流進來（不主動輪詢以外的方式）→ 清空標記在下一批資料時解除 */
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) load();
    });
  }

  function boot() {
    bind();
    load();
    setInterval(function () { if (!document.hidden) load(); }, POLL_MS);
  }

  window.KOLINDEX_RAIL = {
    version: '1.0.0',
    state: R,
    load: load,
    paint: paint,
    rel: rel,
    num: num,
    gb: gb,
    paintQueue: paintQueue,
    paintSlots: paintSlots,
    paintDispatcher: paintDispatcher,
    paintEvents: paintEvents,
    paintAudit: paintAudit,
    paintStorage: paintStorage
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
