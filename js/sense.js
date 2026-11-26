/* 感測上下文
   產品語意：平台熱度、關鍵詞、情緒分佈。
   目前為示範樣本（ROADMAP 標假）；只建事件候選，不觸發採集／寫庫／刪除。 */
(function () {
  'use strict';

  var STORE_KEY = 'kolindex.sense.v1';
  var TICK_MS = 4200;

  var PLATFORMS = [
    { id: 'douyin', label: '抖音', heat: 78, delta: 2.1, posts: 128 },
    { id: 'xhs', label: '小紅書', heat: 64, delta: -0.8, posts: 86 },
    { id: 'bilibili', label: 'B 站', heat: 51, delta: 1.4, posts: 42 },
    { id: 'weibo', label: '微博', heat: 44, delta: 0.3, posts: 37 },
    { id: 'youtube', label: 'YouTube', heat: 31, delta: -1.2, posts: 18 }
  ];

  var KEYWORDS = [
    { term: '聯名', hits: 42, plat: 'xhs' },
    { term: '開箱', hits: 37, plat: 'douyin' },
    { term: '直播預告', hits: 29, plat: 'douyin' },
    { term: '同框', hits: 24, plat: 'bilibili' },
    { term: '限量', hits: 21, plat: 'xhs' },
    { term: '售罄', hits: 18, plat: 'weibo' },
    { term: '幕後', hits: 15, plat: 'youtube' },
    { term: '澄清', hits: 12, plat: 'weibo' }
  ];

  var SAMPLES = [
    { plat: '抖音', mood: 'neu', text: '下週直播會把庫存表公開對一下。' },
    { plat: '小紅書', mood: 'pos', text: '這次聯名包裝細節比預期完整。' },
    { plat: '微博', mood: 'neg', text: '預售頁與到貨說明對不上，想看官方補一句。' },
    { plat: 'B 站', mood: 'neu', text: '幕後花絮只放了剪輯版，原片未公開。' }
  ];

  var S = {
    platforms: [],
    keywords: [],
    mood: { pos: 34, neu: 49, neg: 17 },
    samples: [],
    candidates: [],
    selected: { kind: '', id: '' },
    at: null,
    seq: 200
  };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function nowIso() { return new Date().toISOString(); }
  function rel(ts) {
    if (!ts) return '—';
    var t = Date.parse(ts);
    if (!t || isNaN(t)) return '—';
    var d = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (d < 8) return '剛剛';
    if (d < 60) return d + ' 秒前';
    if (d < 3600) return Math.round(d / 60) + ' 分前';
    return Math.round(d / 3600) + ' 時前';
  }
  function toast(msg, tone) {
    if (window.KOLINDEX_UI && typeof window.KOLINDEX_UI.toast === 'function') {
      window.KOLINDEX_UI.toast(msg, tone || 'ok');
      return;
    }
    var note = $('senseNote');
    if (note) note.textContent = msg;
  }
  function visible() {
    return document.body.getAttribute('data-topic') === 'sense';
  }
  function moodZh(m) {
    return { pos: '偏正', neu: '中性', neg: '偏負' }[m] || m;
  }
  function clone(list) {
    return list.map(function (x) { return Object.assign({}, x); });
  }

  function seed() {
    S.platforms = clone(PLATFORMS);
    S.keywords = clone(KEYWORDS);
    S.samples = clone(SAMPLES);
    S.mood = { pos: 34, neu: 49, neg: 17 };
    S.candidates = [
      {
        id: ++S.seq,
        kind: 'brand_risk',
        mood: 'neg',
        summary: '多則留言重複提到預售與到貨說明不一致。',
        evidence: ['weibo', '售罄'],
        confidence: 0.71,
        status: 'candidate'
      },
      {
        id: ++S.seq,
        kind: 'campaign',
        mood: 'pos',
        summary: '聯名／開箱關鍵詞同步上升，偏正向討論。',
        evidence: ['xhs', '聯名', '開箱'],
        confidence: 0.66,
        status: 'candidate'
      },
      {
        id: ++S.seq,
        kind: 'coverage_gap',
        mood: 'neu',
        summary: 'B 站幕後內容缺少原片索引，覆蓋可能有缺口。',
        evidence: ['bilibili', '幕後'],
        confidence: 0.58,
        status: 'candidate'
      }
    ];
    S.at = nowIso();
  }

  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        platforms: S.platforms,
        keywords: S.keywords,
        mood: S.mood,
        samples: S.samples,
        candidates: S.candidates,
        selected: S.selected,
        seq: S.seq,
        at: S.at
      }));
    } catch (e) { /* ignore */ }
  }

  function restore() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return false;
      var d = JSON.parse(raw);
      if (!d || !Array.isArray(d.platforms) || !d.platforms.length) return false;
      S.platforms = d.platforms;
      S.keywords = d.keywords || clone(KEYWORDS);
      S.mood = d.mood || S.mood;
      S.samples = d.samples || clone(SAMPLES);
      S.candidates = d.candidates || [];
      S.selected = d.selected || S.selected;
      S.seq = d.seq || S.seq;
      S.at = d.at || null;
      return true;
    } catch (e) {
      return false;
    }
  }

  function drift() {
    S.platforms.forEach(function (p) {
      var d = (Math.random() - 0.48) * 1.6;
      p.heat = Math.max(8, Math.min(96, Math.round((p.heat + d) * 10) / 10));
      p.delta = Math.round(d * 10) / 10;
    });
    S.keywords.forEach(function (k) {
      k.hits = Math.max(3, k.hits + Math.round((Math.random() - 0.45) * 2));
    });
    S.keywords.sort(function (a, b) { return b.hits - a.hits; });
    var pos = S.mood.pos + (Math.random() - 0.5) * 2;
    var neg = S.mood.neg + (Math.random() - 0.5) * 1.6;
    pos = Math.max(12, Math.min(55, pos));
    neg = Math.max(8, Math.min(40, neg));
    var neu = Math.max(15, 100 - pos - neg);
    var sum = pos + neu + neg;
    S.mood = {
      pos: Math.round(pos / sum * 100),
      neu: Math.round(neu / sum * 100),
      neg: Math.max(0, 100 - Math.round(pos / sum * 100) - Math.round(neu / sum * 100))
    };
    S.at = nowIso();
    persist();
  }

  function paintKpis() {
    var host = $('senseKpis');
    if (!host) return;
    var hot = S.platforms.slice().sort(function (a, b) { return b.heat - a.heat; })[0];
    var topKw = S.keywords[0];
    var cells = [
      { k: '平台', v: String(S.platforms.length), s: hot ? ('最高 ' + hot.label) : '—' },
      { k: '關鍵詞', v: String(S.keywords.length), s: topKw ? (topKw.term + ' ×' + topKw.hits) : '—' },
      { k: '偏正', v: S.mood.pos + '%', s: '情緒三桶' },
      { k: '偏負', v: S.mood.neg + '%', s: '只作候選訊號' },
      { k: '候選', v: String(S.candidates.length), s: '未觸發動作' }
    ];
    host.innerHTML = cells.map(function (c) {
      return '<div class="sk-kpi"><span class="sk-k">' + esc(c.k) + '</span>' +
        '<b class="sk-v">' + esc(c.v) + '</b><span class="sk-s">' + esc(c.s) + '</span></div>';
    }).join('');
    var bd = $('navSenseBd');
    if (bd) bd.textContent = String(S.candidates.length);
    var chip = $('senseToolChip');
    if (chip) chip.textContent = '示範樣本 · 候選 ' + S.candidates.length;
  }

  function paintPlatforms() {
    var host = $('sensePlatforms');
    if (!host) return;
    var max = Math.max.apply(null, S.platforms.map(function (p) { return p.heat; })) || 1;
    host.innerHTML = S.platforms.map(function (p) {
      var sel = S.selected.kind === 'plat' && S.selected.id === p.id;
      var pct = Math.round(p.heat / max * 100);
      var hot = p.heat >= 70;
      return '<li class="sn-row' + (hot ? ' is-hot' : '') + (sel ? ' is-sel' : '') + '" data-kind="plat" data-id="' + esc(p.id) + '">' +
        '<div><span class="sn-name">' + esc(p.label) + '</span>' +
        '<span class="sn-meta">' + esc(p.id) + ' · 抽樣貼文 ' + p.posts + ' · Δ ' + (p.delta >= 0 ? '+' : '') + p.delta + '</span></div>' +
        '<span class="sn-val">' + p.heat + '</span>' +
        '<div class="sn-bar" aria-hidden="true"><i style="width:' + pct + '%"></i></div></li>';
    }).join('');
  }

  function paintKeywords() {
    var host = $('senseKeywords');
    if (!host) return;
    var max = (S.keywords[0] && S.keywords[0].hits) || 1;
    host.innerHTML = S.keywords.map(function (k) {
      var sel = S.selected.kind === 'kw' && S.selected.id === k.term;
      var pct = Math.round(k.hits / max * 100);
      return '<li class="sn-row' + (sel ? ' is-sel' : '') + '" data-kind="kw" data-id="' + esc(k.term) + '">' +
        '<div><span class="sn-name">' + esc(k.term) + '</span>' +
        '<span class="sn-meta">平台 ' + esc(k.plat) + '</span></div>' +
        '<span class="sn-val">×' + k.hits + '</span>' +
        '<div class="sn-bar" aria-hidden="true"><i style="width:' + pct + '%"></i></div></li>';
    }).join('');
  }

  function paintMood() {
    var host = $('senseMood');
    if (!host) return;
    var rows = [
      { key: 'pos', label: '偏正', val: S.mood.pos, cls: 'is-pos' },
      { key: 'neu', label: '中性', val: S.mood.neu, cls: 'is-neu' },
      { key: 'neg', label: '偏負', val: S.mood.neg, cls: 'is-neg' }
    ];
    host.innerHTML = rows.map(function (r) {
      return '<div class="sn-mood-row"><span>' + esc(r.label) + '</span>' +
        '<div class="sn-mood-track ' + r.cls + '"><i style="width:' + r.val + '%"></i></div>' +
        '<b>' + r.val + '%</b></div>';
    }).join('');
    var meta = $('senseWindowMeta');
    if (meta) meta.textContent = '最近抽樣 · ' + rel(S.at);
    var samples = $('senseSamples');
    if (samples) {
      samples.innerHTML = S.samples.map(function (s) {
        return '<li class="sn-row"><div><span class="sn-name">' + esc(s.text) + '</span>' +
          '<span class="sn-meta">' + esc(s.plat) + ' · ' + esc(moodZh(s.mood)) + ' · untrusted</span></div>' +
          '<span class="sn-tag">' + esc(moodZh(s.mood)) + '</span></li>';
      }).join('');
    }
  }

  function paintCandidates() {
    var host = $('senseCandidates');
    if (!host) return;
    if (!S.candidates.length) {
      host.innerHTML = '<li class="sn-empty">尚無候選</li>';
      return;
    }
    host.innerHTML = S.candidates.map(function (c) {
      var sel = S.selected.kind === 'cand' && String(S.selected.id) === String(c.id);
      return '<li class="sn-row is-' + esc(c.mood) + (sel ? ' is-sel' : '') + '" data-kind="cand" data-id="' + c.id + '">' +
        '<span class="sn-id">#' + c.id + '</span>' +
        '<div><span class="sn-name">' + esc(c.summary) + '</span>' +
        '<span class="sn-meta">' + esc(c.kind) + ' · 置信 ' + c.confidence +
        ' · 證據 ' + esc((c.evidence || []).join(' · ')) + '</span></div>' +
        '<span class="sn-tag">' + esc(c.status) + '</span></li>';
    }).join('');
  }

  function paintChrome() {
    var live = $('senseLive');
    var note = $('senseNote');
    if (live) live.textContent = '示範';
    if (note) note.textContent = '平台熱度 · 關鍵詞 · 情緒分佈 · 上次 ' + rel(S.at);
  }

  function paint() {
    paintKpis();
    paintPlatforms();
    paintKeywords();
    paintMood();
    paintCandidates();
    paintChrome();
  }

  function select(kind, id) {
    if (S.selected.kind === kind && String(S.selected.id) === String(id)) {
      S.selected = { kind: '', id: '' };
    } else {
      S.selected = { kind: kind, id: id };
    }
    persist();
    paint();
  }

  function pushToBoard() {
    var cands = S.candidates.filter(function (c) { return c.status === 'candidate'; });
    if (!cands.length) {
      toast('沒有可送出的候選', 'err');
      return;
    }
    var seats = window.KOLINDEX_SEATS;
    if (seats && typeof seats.createJob === 'function') {
      cands.forEach(function (c) {
        seats.createJob('[感測] ' + c.summary.slice(0, 72), c.mood === 'neg' ? 'audit' : 'mixed');
        c.status = 'queued';
      });
      persist();
      paint();
      toast('已送 ' + cands.length + ' 筆到席位大任務', 'ok');
      return;
    }
    /* 無席位模組時：只標記並提示去看板 */
    cands.forEach(function (c) { c.status = 'queued'; });
    persist();
    paint();
    toast('已標記 ' + cands.length + ' 筆 · 請到任務看板／席位查看', 'ok');
    if (window.KOLINDEX_UI && typeof window.KOLINDEX_UI.go === 'function') {
      window.KOLINDEX_UI.go({ topic: 'queue' });
    } else {
      document.body.setAttribute('data-topic', 'queue');
    }
  }

  function tick() {
    if (!visible() || document.hidden) return;
    drift();
    paint();
  }

  function bind() {
    var root = $('sense');
    if (!root) return;
    root.addEventListener('click', function (e) {
      var row = e.target.closest('[data-kind][data-id]');
      if (!row) return;
      select(row.getAttribute('data-kind'), row.getAttribute('data-id'));
    });
    var rf = $('senseRefresh');
    if (rf) rf.addEventListener('click', function () { paint(); toast('已重整感測畫面', 'ok'); });
    var push = $('senseToQueue');
    if (push) push.addEventListener('click', pushToBoard);
  }

  function boot() {
    if (!$('sense')) return;
    if (!restore()) seed();
    bind();
    paint();
    setInterval(tick, TICK_MS);
    if (typeof MutationObserver === 'function') {
      var obs = new MutationObserver(function () { if (visible()) paint(); });
      obs.observe(document.body, { attributes: true, attributeFilter: ['data-topic'] });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.KOLINDEX_SENSE = {
    version: '2.0.0',
    state: S,
    paint: paint,
    pushToBoard: pushToBoard,
    seed: function () { seed(); persist(); paint(); }
  };
})();
