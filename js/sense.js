/* 感測上下文 · 前端
   資料來源：GET /api/sense（近 30 日 douyin_item 聚合 + open ai_event）。
   只讀；不派工、不寫庫。情緒是詞典粗分，不是模型判定。 */
(function () {
  'use strict';

  var BASE = window.KOLINDEX_BASE || '';
  var POLL_MS = 300000;
  var S = {
    ok: false, loaded: false, loading: false, queued: false,
    data: null, error: null, at: null, selected: { kind: '', id: '' }
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
  function rel(ts) {
    if (!ts) return '—';
    var t = Date.parse(ts);
    if (!t || isNaN(t)) return '—';
    var d = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (d < 10) return '剛剛';
    if (d < 60) return d + ' 秒前';
    if (d < 3600) return Math.round(d / 60) + ' 分鐘前';
    if (d < 86400) return Math.round(d / 3600) + ' 小時前';
    return Math.round(d / 86400) + ' 天前';
  }
  function day(iso) {
    if (!iso) return '—';
    return String(iso).slice(0, 10);
  }
  function moodZh(m) {
    return { pos: '偏正', neu: '中性', neg: '偏負' }[m] || m;
  }
  function visible() {
    return document.body.getAttribute('data-topic') === 'sense';
  }
  function platform() {
    return (S.data && S.data.platforms && S.data.platforms[0]) || null;
  }
  function mood() {
    return (S.data && S.data.mood) || { pos: 0, neu: 0, neg: 0 };
  }
  function candidates() {
    return (S.data && S.data.candidates) || [];
  }

  function paintKpis() {
    var host = $('senseKpis');
    if (!host) return;
    var p = platform();
    var m = mood();
    var kws = (S.data && S.data.keywords) || [];
    var cells = [
      { k: '平台', v: p ? '1' : '0', s: p ? p.label : '未接入' },
      { k: '作品', v: p ? num(p.works) : '—', s: '近 30 日' },
      { k: '作者', v: p ? num(p.authors) : '—', s: '去重作者' },
      { k: '互動', v: p ? num(p.likes) : '—', s: p ? ('讚 · 平均 ' + num(p.avgLikes)) : '—' },
      { k: '候選', v: num(candidates().length), s: 'open ai_event' }
    ];
    host.innerHTML = cells.map(function (c) {
      return '<div class="sk-kpi"><span class="sk-k">' + esc(c.k) + '</span>' +
        '<b class="sk-v">' + esc(c.v) + '</b><span class="sk-s">' + esc(c.s) + '</span></div>';
    }).join('');
    var bd = $('navSenseBd');
    if (bd) bd.textContent = String(candidates().length);
    var chip = $('senseToolChip');
    if (chip) chip.textContent = '真實聚合 · 近 ' + ((S.data && S.data.window && S.data.window.days) || 30) + ' 日';
  }

  function paintPlatforms() {
    var host = $('sensePlatforms');
    if (!host) return;
    var p = platform();
    if (!p) { host.innerHTML = '<li class="sn-empty">找不到抖音索引</li>'; return; }
    var max = Math.max(1, p.works);
    host.innerHTML = '<li class="sn-row' + (p.works ? ' is-hot' : '') + '" data-kind="plat" data-id="' + esc(p.key) + '">' +
      '<div><span class="sn-name">' + esc(p.label) + '</span>' +
      '<span class="sn-meta">作品 ' + num(p.works) + ' · 作者 ' + num(p.authors) + ' · 讚 ' + num(p.likes) + '</span></div>' +
      '<span class="sn-val">' + num(p.works) + '</span>' +
      '<div class="sn-bar" aria-hidden="true"><i style="width:' + Math.round(p.works / max * 100) + '%"></i></div></li>';
  }

  function paintKeywords() {
    var host = $('senseKeywords');
    if (!host) return;
    var list = (S.data && S.data.keywords) || [];
    if (!list.length) { host.innerHTML = '<li class="sn-empty">近 30 日沒有 hashtag</li>'; return; }
    var max = list[0].hits || 1;
    host.innerHTML = list.map(function (k) {
      var sel = S.selected.kind === 'kw' && S.selected.id === k.term;
      return '<li class="sn-row' + (sel ? ' is-sel' : '') + '" data-kind="kw" data-id="' + esc(k.term) + '">' +
        '<div><span class="sn-name">' + esc(k.term) + '</span>' +
        '<span class="sn-meta">抖音 · 出現 ' + num(k.hits) + ' 次</span></div>' +
        '<span class="sn-val">×' + num(k.hits) + '</span>' +
        '<div class="sn-bar" aria-hidden="true"><i style="width:' + Math.round(k.hits / max * 100) + '%"></i></div></li>';
    }).join('');
  }

  function paintMood() {
    var host = $('senseMood');
    if (!host) return;
    var m = mood();
    var rows = [
      { label: '偏正', val: m.pos || 0, cls: 'is-pos' },
      { label: '中性', val: m.neu || 0, cls: 'is-neu' },
      { label: '偏負', val: m.neg || 0, cls: 'is-neg' }
    ];
    host.innerHTML = rows.map(function (r) {
      return '<div class="sn-mood-row"><span>' + esc(r.label) + '</span>' +
        '<div class="sn-mood-track ' + r.cls + '"><i style="width:' + r.val + '%"></i></div>' +
        '<b>' + r.val + '%</b></div>';
    }).join('');
    var meta = $('senseWindowMeta');
    if (meta) meta.textContent = (m.method ? ('詞典 ' + m.method + ' · ') : '') + '近 30 日';
    var samples = $('senseSamples');
    if (!samples) return;
    var list = (S.data && S.data.samples) || [];
    if (!list.length) { samples.innerHTML = '<li class="sn-empty">近 30 日沒有樣本</li>'; return; }
    samples.innerHTML = list.map(function (s) {
      return '<li class="sn-row"><div><span class="sn-name">' + esc(s.caption || '（無文案）') + '</span>' +
        '<span class="sn-meta">' + esc(s.author) + ' · 讚 ' + num(s.likes) + ' · ' + esc(day(s.published_at)) + '</span></div>' +
        '<span class="sn-tag">' + esc(s.kind === 'gallery' ? '圖集' : '影片') + '</span></li>';
    }).join('');
  }

  function paintCandidates() {
    var host = $('senseCandidates');
    if (!host) return;
    var list = candidates();
    if (!list.length) {
      host.innerHTML = '<li class="sn-empty">目前沒有 open 的 AI 事件候選</li>';
      return;
    }
    host.innerHTML = list.map(function (c) {
      var sel = S.selected.kind === 'cand' && String(S.selected.id) === String(c.id);
      return '<li class="sn-row' + (sel ? ' is-sel' : '') + '" data-kind="cand" data-id="' + c.id + '">' +
        '<span class="sn-id">#' + c.id + '</span>' +
        '<div><span class="sn-name">' + esc(c.summary) + '</span>' +
        '<span class="sn-meta">' + esc(c.kind) + ' · 嚴重度 ' + esc(c.severity) + ' · ' + esc(rel(c.created_at)) + '</span></div>' +
        '<span class="sn-tag">' + esc(c.state) + '</span></li>';
    }).join('');
  }

  function paintChrome() {
    var live = $('senseLive');
    var note = $('senseNote');
    if (live) { live.textContent = 'LIVE'; live.className = 'sense-live is-ok'; }
    if (note) note.textContent = '平台熱度 · 關鍵詞 · 情緒分佈 · 來源 /api/sense · 最後同步 ' + rel(S.at);
  }

  function paint() {
    paintKpis();
    paintPlatforms();
    paintKeywords();
    paintMood();
    paintCandidates();
    paintChrome();
  }

  function paintOffline(err) {
    var live = $('senseLive');
    var note = $('senseNote');
    if (live) { live.textContent = S.loaded ? '離線' : '連不上'; live.className = 'sense-live is-bad'; }
    if (note) note.textContent = S.loaded
      ? ('連不到 /api/sense · 顯示上次結果（' + rel(S.at) + '）')
      : ('連不到 /api/sense' + (err && err.message ? ' · ' + err.message : ''));
  }

  function load() {
    if (S.loading) { S.queued = true; return Promise.resolve(S.data); }
    S.loading = true;
    return fetch(BASE + '/api/sense', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) {
        S.data = d;
        S.ok = true;
        S.loaded = true;
        S.at = d.at || new Date().toISOString();
        S.error = null;
        paint();
      })
      .catch(function (e) {
        S.ok = false;
        S.error = e.message;
        paintOffline(e);
      })
      .then(function () {
        S.loading = false;
        if (S.queued) { S.queued = false; return load(); }
        return S.data;
      });
  }

  function select(kind, id) {
    if (S.selected.kind === kind && String(S.selected.id) === String(id)) {
      S.selected = { kind: '', id: '' };
    } else {
      S.selected = { kind: kind, id: id };
    }
    paint();
  }

  function bind() {
    var root = $('sense');
    if (root) {
      root.addEventListener('click', function (e) {
        var row = e.target.closest('[data-kind][data-id]');
        if (!row) return;
        select(row.getAttribute('data-kind'), row.getAttribute('data-id'));
      });
    }
    var rf = $('senseRefresh');
    if (rf) rf.addEventListener('click', load);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && visible()) load();
    });
    if (typeof MutationObserver === 'function') {
      var obs = new MutationObserver(function () {
        if (visible() && !S.loading) load();
      });
      obs.observe(document.body, { attributes: true, attributeFilter: ['data-topic'] });
    }
  }

  function boot() {
    bind();
    load();
    setInterval(function () {
      if (visible() && !document.hidden) load();
    }, POLL_MS);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.KOLINDEX_SENSE = {
    version: '2.0.0', state: S, load: load, paint: paint, rel: rel, num: num, day: day
  };
})();
