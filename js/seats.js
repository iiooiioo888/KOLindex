/* 席位編隊 · 前端
   把「席位執行」頁上半的 8 個席位接成真的 worker pool：工單真的在後端跑完才回到這裡。
   資料來源：GET /api/seats（每 3 秒）、POST /api/seats/run（派工）、POST /api/seats/auto（自動派工開關）。
   守衛：window.KOLINDEX_SEATS_LIVE 讓 index2.js 知道席位頁已有真資料。 */
(function () {
  'use strict';
  window.KOLINDEX_SEATS_LIVE = true;

  var BASE = window.KOLINDEX_BASE || '';
  var POLL_BUSY_MS = 1500;
  var POLL_IDLE_MS = 8000;
  var pollTimer = 0;
  var S = { ok: false, loaded: false, loading: false, queued: false, data: null, at: null, error: null, auto: true, busy: false };

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
  function rel(ts) {
    if (!ts) return '—';
    var t = Date.parse(String(ts).replace(' ', 'T') + 'Z');
    if (!t || isNaN(t)) t = Date.parse(ts);
    if (!t || isNaN(t)) return '—';
    var d = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (d < 10) return '剛剛';
    if (d < 60) return d + ' 秒前';
    if (d < 3600) return Math.round(d / 60) + ' 分鐘前';
    if (d < 86400) return Math.round(d / 3600) + ' 小時前';
    return Math.round(d / 86400) + ' 天前';
  }
  function statusLabel(st) {
    return { queued: '排隊', running: '執行中', done: '完成', failed: '失敗' }[st] || st;
  }
  function stateOf(seat) {
    if (seat.current) return { key: 'busy', label: '執行中' };
    if (seat.failStreak > 0) return { key: 'warn', label: '待命 · 上次失敗' };
    if (seat.done > 0) return { key: 'ok', label: '待命' };
    return { key: 'idle', label: '待命' };
  }
  function summarize(t) {
    var r = t.result || {};
    if (t.status === 'failed') return t.error || '失敗';
    if (!t.result) return '—';
    if (t.kind === 'library') return num(r.items) + ' 件 · ' + num(r.files) + ' 檔 · ' + num(r.missing) + ' 缺';
    if (t.kind === 'review') return r.open + ' 待複核 · 共 ' + r.total;
    if (t.kind === 'collect') return r.inbox + ' 待收 · ' + r.claimed + ' 已認領';
    if (t.kind === 'queue') return r.total + ' 工作 · 跑 ' + ((r.state && r.state.running) || 0);
    if (t.kind === 'disk') return String(r.drive || '').replace(':/', ':') + ' 剩 ' + r.freeGb + ' GB · ' + r.usedPct + '%';
    if (t.kind === 'audit') return r.today + ' 筆今日 · ' + ((r.top && r.top[0] && r.top[0].action) || '無');
    return '—';
  }

  function paintKpis(d) {
    var host = $('fleetKpis');
    if (!host) return;
    var seats = d.seats || [];
    var busy = seats.filter(function (s) { return !!s.current; }).length;
    var doneToday = (d.counts && d.counts.today) || 0;
    var failedToday = (d.counts && d.counts.failedToday) || 0;
    var cells = [
      { k: '席位', v: seats.length + ' / ' + seats.length, s: '同時最多 ' + seats.length + ' 張工單' },
      { k: '執行中', v: String(busy), s: busy ? '正在跑工單' : '全部待命' },
      { k: '佇列', v: String((d.queue && d.queue.queued) || 0), s: '等待空檔的工單' },
      { k: '今日完成', v: num(doneToday), s: '失敗 ' + num(failedToday) },
      { k: '平均耗時', v: d.avgMs == null ? '—' : num(d.avgMs) + ' ms', s: '最近全部工單' },
      { k: '自動派工', v: d.auto ? 'ON' : 'OFF', s: d.auto ? '閒時每 10 秒補一張' : '只接人工派工' }
    ];
    var html = cells.map(function (c) {
      return '<div class="fleet-kpi"><span class="fk-k">' + esc(c.k) + '</span>' +
        '<b class="fk-v">' + esc(c.v) + '</b><span class="fk-s">' + esc(c.s) + '</span></div>';
    }).join('');
    if (host.getAttribute('data-fp') === html) return;
    host.innerHTML = html;
    host.setAttribute('data-fp', html);
  }

  function seatFp(s) {
    var c = s.current;
    return [s.id, s.platform, s.lane, s.done, s.failed, s.failStreak, s.lastOkAt,
      c ? c.id : '', c ? c.label : '', c ? c.startedAt : ''].join('\u001f');
  }
  function seatHtml(s, lanes) {
    var st = stateOf(s);
    var title = s.current ? (s.current.label + ' #' + s.current.id + ' · ' + rel(s.current.startedAt)) : (lanes[s.lane] || s.lane);
    return '<div class="fs-card is-' + st.key + '" data-seat="' + esc(s.id) + '" title="' + esc(title) + '">' +
      '<div class="fs-top"><b class="fs-id">' + esc(s.id) + '</b>' +
      '<span class="fs-plat">' + esc(s.platform) + '</span>' +
      '<span class="fs-dot"></span><span class="fs-state">' + esc(st.label) + '</span></div>' +
      '<div class="fs-kind">' + esc(s.current ? s.current.label : (lanes[s.lane] || s.lane)) + '</div>' +
      '<div class="fs-meta">' + num(s.done) + ' 完成 · ' + num(s.failed) + ' 失敗 · ' + esc(rel(s.lastOkAt)) + '</div>' +
      '</div>';
  }
  function paintSeats(d) {
    var host = $('fleetSeats');
    if (!host) return;
    var lanes = {};
    (d.kinds || []).forEach(function (k) { lanes[k.key] = k.label; });
    var items = d.seats || [];
    var dom = window.KOLINDEX_DOM;
    if (!dom) {
      host.innerHTML = items.map(function (s) { return seatHtml(s, lanes); }).join('');
      return;
    }
    dom.mountKeyed(host, items, {
      sel: '.fs-card',
      attr: 'data-seat',
      id: function (s) { return s.id; },
      fp: seatFp,
      html: function (s) { return seatHtml(s, lanes); }
    });
  }

  function taskFp(t) {
    return [t.id, t.status, t.label, t.seat || '', t.ms, t.finishedAt || '', t.startedAt || '', t.createdAt || '', t.error || '', summarize(t)].join('\u001f');
  }
  function taskHtml(t) {
    return '<li class="ft-row" data-task="' + t.id + '">' +
      '<span class="ft-time">' + esc(rel(t.finishedAt || t.startedAt || t.createdAt)) + '</span>' +
      '<span class="ft-id">#' + t.id + '</span>' +
      '<span class="ft-seat">' + esc(t.seat || '—') + '</span>' +
      '<span class="ft-main">' +
        '<span class="ft-line">' +
          '<span class="ft-kind">' + esc(t.label) + '</span>' +
          '<span class="ft-st is-' + esc(t.status) + '">' + esc(statusLabel(t.status)) + '</span>' +
          '<span class="ft-ms">' + (t.ms == null ? '' : num(t.ms) + ' ms') + '</span>' +
        '</span>' +
        '<span class="ft-res" title="' + esc(summarize(t)) + '">' + esc(summarize(t)) + '</span>' +
      '</span>' +
      '</li>';
  }
  function paintTasks(d) {
    var host = $('fleetTasks');
    if (!host) return;
    var list = (d.tasks || []).slice(0, 12);
    if (!list.length) { host.innerHTML = '<li class="ft-empty">還沒有工單 · 按上方「派工」開始</li>'; return; }
    var dom = window.KOLINDEX_DOM;
    if (!dom) { host.innerHTML = list.map(taskHtml).join(''); return; }
    dom.mountKeyed(host, list, {
      sel: '.ft-row',
      attr: 'data-task',
      id: function (t) { return t.id; },
      fp: taskFp,
      html: taskHtml
    });
  }

  function paintChrome(d) {
    var live = $('fleetLive');
    var note = $('fleetNote');
    var auto = $('fleetAuto');
    if (live) {
      live.textContent = 'LIVE';
      live.className = 'fleet-live is-ok';
    }
    if (note) note.textContent = '來源 api · 每 ' + pollLabel(d) + ' 秒 · 最後同步 ' + rel(d && d.at);
    if (auto && d) auto.checked = !!d.auto;
  }

  function paint(d) {
    S.data = d;
    S.ok = true;
    S.loaded = true;
    S.at = d && d.at;
    S.auto = !!(d && d.auto);
    paintKpis(d);
    paintSeats(d);
    paintTasks(d);
    paintChrome(d);
  }

  function paintOffline(err) {
    var live = $('fleetLive');
    var note = $('fleetNote');
    if (live) {
      live.textContent = S.loaded ? '離線' : '連不上';
      live.className = 'fleet-live is-bad';
    }
    if (note) note.textContent = S.loaded
      ? '連不到 /api/seats · 顯示上次結果（' + rel(S.at) + '）'
      : ('連不到 /api/seats' + (err && err.message ? ' · ' + err.message : ''));
  }

  function load() {
    if (S.loading) { S.queued = true; return Promise.resolve(S.data); }
    S.loading = true;
    var tok = Date.now();
    return fetch(BASE + '/api/seats?tasks=12', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) { paint(d); })
      .catch(function (e) { paintOffline(e); })
      .then(function () {
        S.loading = false;
        if (S.queued) { S.queued = false; return load(); }
        return S.data;
      });
  }

  function post(path, body) {
    return fetch(BASE + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, data: j }; }); });
  }

  function run() {
    if (S.busy) return;
    var sel = $('fleetKind');
    var kind = sel ? sel.value : 'all';
    S.busy = true;
    post('/api/seats/run', { kind: kind, n: 1, actor: 'ui-operator' })
      .then(function (r) {
        if (!r.ok) throw new Error(r.data && r.data.error ? r.data.error : 'HTTP ' + r.status);
        return load();
      })
      .catch(function (e) {
        var note = $('fleetNote');
        if (note) note.textContent = '派工失敗 · ' + e.message;
      })
      .then(function () { S.busy = false; });
  }

  function setAuto(on) {
    post('/api/seats/auto', { on: !!on, actor: 'ui-operator' }).then(function (r) {
      if (!r.ok) return;
      S.auto = !!(r.data && r.data.auto);
      load();
    });
  }

  function seatBusy(d) {
    var seats = (d && d.seats) || [];
    for (var i = 0; i < seats.length; i++) if (seats[i].current) return true;
    return false;
  }
  function pollWait(d) { return seatBusy(d) ? POLL_BUSY_MS : POLL_IDLE_MS; }
  function pollLabel(d) { return seatBusy(d) ? '1.5' : '8'; }
  function stopPoll() {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = 0; }
  }
  function armPoll() {
    stopPoll();
    if (!visible() || document.hidden) return;
    pollTimer = setTimeout(function () {
      pollTimer = 0;
      if (!visible() || document.hidden) return;
      load().then(armPoll, armPoll);
    }, pollWait(S.data));
  }
  function visible() {
    return document.body.getAttribute('data-topic') === 'seat';
  }

  function bind() {
    var runBtn = $('fleetRun');
    if (runBtn) runBtn.addEventListener('click', run);
    var sel = $('fleetKind');
    if (sel) sel.addEventListener('change', function () { run(); });
    var auto = $('fleetAuto');
    if (auto) auto.addEventListener('change', function () { setAuto(auto.checked); });
    var rf = $('fleetRefresh');
    if (rf) rf.addEventListener('click', function () { load(); });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { stopPoll(); return; }
      if (visible()) load().then(armPoll, armPoll);
    });
  }

  function boot() {
    if (!$('fleet')) return;
    bind();
    if (visible() && !document.hidden) load().then(armPoll, armPoll);
    if (typeof MutationObserver === 'function') {
      var obs = new MutationObserver(function () {
        if (visible() && !document.hidden) load().then(armPoll, armPoll);
        else stopPoll();
      });
      obs.observe(document.body, { attributes: true, attributeFilter: ['data-topic'] });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.KOLINDEX_SEATS = {
    version: '1.0.0',
    state: S, load: load, paint: paint, run: run, setAuto: setAuto,
    rel: rel, num: num, summarize: summarize, statusLabel: statusLabel
  };
})();
