/* ============================================================
   studio.js · 「UI 生成」分頁
   需求 → /__llm（OpenAI 相容代理）→ 結構 JSON → 線框圖
   生成物只描述版面結構，不產生可執行程式碼
   ============================================================ */
(function () {
  'use strict';
  var stage = document.getElementById('studioStage');
  if (!stage || !window.WF) return;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var form = $('#studioForm');
  var promptEl = $('#studioPrompt');
  var deviceEl = $('#studioDevice');
  var densityEl = $('#studioDensity');
  var goBtn = $('#studioGo');
  var jsonEl = $('#studioJson');
  var statusChip = $('#llmStatus');
  var countChip = $('#studioCount');
  var hintEl = $('#studioHint');
  var views = $('#studioViews');
  var presets = $('#studioPresets');

  var state = { doc: null, view: 'preview', count: 0, busy: false, ms: 0, autoDemo: false };
  var STATUS = 'unknown';   // unknown | ready | off | nokey

  var SYSTEM = [
    '你是資深產品設計師。把使用者的需求轉成「線框圖結構」，只輸出 JSON，不要解釋、不要 markdown 圍欄。',
    '',
    'JSON 格式：',
    '{"title":"頁面名稱","summary":"一句話說明版面策略","device":"desktop","nodes":[節點...]}',
    '',
    '節點欄位：',
    'type  只能是 header|toolbar|nav|sidebar|panel|card|kpi|table|list|form|chart|tabs|text|button|input|avatar|divider|footer|gallery|media|map|timeline',
    'label 中文標籤，12 字內',
    'note  可選，補充資訊，20 字內',
    'span  1-12，12 欄網格的佔寬',
    'h     可選，建議高度 px（40-240）',
    'cols  子節點陣列，只有 panel/card/sidebar 這類容器才用',
    '',
    '規則：',
    '- 頂層 5-9 個節點，順序是 header → 主區 → footer',
    '- 巢狀最多 3 層，單一容器子節點 2-6 個',
    '- 用 span 表達排布：三張並排卡片各 span:4；主表格 span:12；左側欄 span:3 + 主區 span:9',
    '- 只表達結構與資訊層級，不要顏色、不要 CSS、不要像素級裝飾',
    '- 內容要具體到這個需求本身，不要用「卡片 1」「項目 A」這類佔位字'
  ].join('\n');

  var PRESETS = [
    { k: '榜單', v: '社群 KOL 影響力榜單頁：左側多維篩選（平台/品類/粉絲量級），頂部三張 KPI，主區是可排序的 KOL 表格，右側滑出詳情抽屜，底部趨勢圖' },
    { k: '看板', v: '帶貨直播營運看板：頂欄放今日場次與在線人數，中間三欄是待播/直播中/已結束，右側實時彈幕與轉化漏斗，底部 24 小時 GMV 曲線' },
    { k: '後台', v: '內容審核後台：左側任務隊列，主區是審核卡片（封面+文案+風險分），右側是審核動作與歷史記錄，頂部有批次操作與篩選' },
    { k: '門戶', v: 'KOL 入駐申請頁：首屏是品牌主張與申請 CTA，下面是入駐流程四步、成功案例牆、常見問題手風琴、頁尾聯絡資訊' }
  ];

  /* ---------- 工具 ---------- */
  function el(tag, cls, html) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (html != null) d.innerHTML = html;
    return d;
  }
  function setHint(txt, tone) {
    hintEl.textContent = txt || '';
    hintEl.style.color = tone === 'ok' ? 'var(--green)' : tone === 'warn' ? 'var(--amber)' : tone === 'bad' ? 'var(--red)' : '';
  }
  function hintFor(txt, tone) {
    if (state.autoDemo) setHint('示範線框（不呼叫模型） · ' + txt, tone === 'warn' ? 'warn' : tone);
    else if (!state.doc) setHint(txt, tone);
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function unwrap(obj) {
    for (var i = 0; i < 3 && obj && typeof obj === 'object' && !Array.isArray(obj); i++) {
      if (obj.nodes || obj.blocks || obj.layout || obj.root || obj.page) return obj;
      var keys = Object.keys(obj).filter(function (k) { return obj[k] && typeof obj[k] === 'object'; });
      if (keys.length !== 1) return obj;
      obj = obj[keys[0]];
    }
    return obj;
  }
  function parseJSON(text) {
    var t = String(text || '').trim();
    var fence = t.match(/\x60{3}(?:json|javascript|js)?\s*([\s\S]*?)\x60{3}/i);
    if (fence) t = fence[1];
    t = t.trim();
    if (t[0] !== '{' && t[0] !== '[') {
      var a = t.indexOf('{'), b = t.lastIndexOf('}');
      if (a >= 0 && b > a) t = t.slice(a, b + 1);
    }
    return JSON.parse(t);
  }

  /* ---------- 檢視 ---------- */
  function renderDoc(doc, meta) {
    state.doc = doc;
    state.autoDemo = false;
    var d = WF.normalize(unwrap(doc));
    stage.innerHTML = WF.render(d);
    jsonEl.textContent = JSON.stringify(d, null, 2);
    stage.setAttribute('data-density', densityEl.value);
    state.view = 'preview';
    applyView();
    countChip.textContent = state.count + ' 次生成';
    setHint(meta || ('已生成《' + d.title + '》 · ' + d.nodes.length + ' 個區塊'), 'ok');
  }
  function applyView() {
    var p = state.view === 'preview';
    stage.hidden = !p;
    jsonEl.hidden = p;
    Array.prototype.forEach.call(views.querySelectorAll('button'), function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-view') === state.view));
    });
  }
  function busy(on) {
    state.busy = on;
    goBtn.disabled = on;
    goBtn.textContent = on ? '生成中…' : '生成線框';
    var old = $('.studio-busy', stage.parentNode);
    if (!on) { if (old) old.remove(); return; }
    if (old) return;
    var box = el('div', 'studio-busy', '<div class="spin"></div><div>LLM 生成中 · <span class="el">0.0s</span></div>');
    stage.parentNode.appendChild(box);
    var t0 = Date.now(), span = $('.el', box);
    var timer = setInterval(function () { span.textContent = ((Date.now() - t0) / 1000).toFixed(1) + 's'; }, 100);
    box.__timer = timer;
  }
  function stopBusyTimer() {
    var box = $('.studio-busy');
    if (box && box.__timer) clearInterval(box.__timer);
  }
  function showError(msg, raw) {
    var err = $('.studio-err');
    if (err) err.remove();
    var box = el('div', 'studio-err', '<b>' + esc(msg) + '</b>' +
      (raw ? '<div class="studio-raw">' + esc(String(raw).slice(0, 1200)) + '</div>' : ''));
    stage.parentNode.insertBefore(box, stage);
    setHint('生成失敗，詳見上方紅框', 'bad');
  }
  function clearError() { var e = $('.studio-err'); if (e) e.remove(); }

  /* ---------- 後端狀態 ---------- */
  function setStatus(kind, text) {
    STATUS = kind;
    statusChip.textContent = text;
    statusChip.className = 'chip ' + (kind === 'ready' ? 'green' : kind === 'nokey' ? 'or' : 'red');
  }
  function checkStatus() {
    fetch('/__llm/status', { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
      .then(function (d) {
        if (d.configured) {
          setStatus('ready', 'LLM 已接線 · ' + (d.model || 'model'));
          hintFor(d.model + ' · ' + (d.baseHost || '') + ' · 金鑰只留在本機代理', '');
        } else {
          setStatus('nokey', 'LLM 未設定');
          hintFor('代理已就緒但沒有金鑰：在 KOLindex-dev/.env 填入 LLM_API_KEY 後重啟 dev server', 'warn');
        }
      })
      .catch(function () {
        setStatus('off', 'LLM 未接線');
        hintFor('沒偵測到本地代理：請用 KOLindex-dev/start.cmd 啟動（靜態托管不支援生成）', 'warn');
      });
  }

  /* ---------- 生成 ---------- */
  function generate() {
    if (state.busy) return;
    var prompt = promptEl.value.trim();
    if (!prompt) { promptEl.focus(); setHint('先寫需求，或點一個範例', 'warn'); return; }
    clearError();
    var devLabel = { desktop: '桌面 1440', tablet: '平板 834', mobile: '手機 390' }[deviceEl.value];
    var messages = [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: '需求：' + prompt + '\n裝置：' + devLabel + '\n密度：' + ((densityEl.options && densityEl.selectedIndex >= 0 && densityEl.options[densityEl.selectedIndex]) ? densityEl.options[densityEl.selectedIndex].textContent : densityEl.value) + '\n只輸出 JSON。' }
    ];
    busy(true);
    var t0 = Date.now(), raw = '';
    fetch('/__llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: messages, temperature: 0.4 })
    }).then(function (r) {
      return r.text().then(function (txt) {
        var data;
        try { data = JSON.parse(txt); } catch (e) { data = null; }
        if (!r.ok) {
          var m = (data && data.error && (data.error.message || data.error)) || txt.slice(0, 300) || ('HTTP ' + r.status);
          throw new Error(typeof m === 'string' ? m : JSON.stringify(m));
        }
        if (!data) throw new Error('代理回了非 JSON 內容');
        raw = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
        if (!raw) throw new Error('模型沒有回內容（可能被 max_tokens 截斷）');
        return parseJSON(raw);
      });
    }).then(function (doc) {
      state.count++;
      state.ms = Date.now() - t0;
      renderDoc(doc, null);
      setHint('已生成 · 耗時 ' + (state.ms / 1000).toFixed(1) + 's · ' +
        (doc.summary || '') , 'ok');
      try { localStorage.setItem('kolindex.studio.last', JSON.stringify({ p: prompt, d: doc, t: Date.now() })); } catch (e) {}
    }).catch(function (e) {
      showError(e && e.message ? e.message : String(e), raw);
    }).then(function () {
      stopBusyTimer();
      busy(false);
    });
  }

  /* ---------- 綁定 ---------- */
  PRESETS.forEach(function (p) {
    var b = el('button', '', p.k);
    b.type = 'button';
    b.title = p.v;
    b.addEventListener('click', function () { promptEl.value = p.v; promptEl.focus(); });
    presets.appendChild(b);
  });

  form.addEventListener('submit', function (e) { e.preventDefault(); generate(); });
  densityEl.addEventListener('change', function () { stage.setAttribute('data-density', densityEl.value); });
  views.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-view]');
    if (!b || !state.doc) return;
    state.view = b.getAttribute('data-view');
    applyView();
  });

  $('#studioDemo').addEventListener('click', function () {
    clearError();
    renderDoc(WF.demo(), '示範線框（不呼叫模型）');
  });

  $('#studioCopy').addEventListener('click', function () {
    if (!state.doc) { setHint('還沒有可複製的結構', 'warn'); return; }
    var txt = jsonEl.textContent;
    var done = function () { setHint('已複製結構 JSON（' + txt.length + ' 字元）', 'ok'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(done, function () { fallbackCopy(txt, done); });
    } else fallbackCopy(txt, done);
  });
  function fallbackCopy(txt, done) {
    var ta = document.createElement('textarea');
    ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { setHint('複製失敗，請手動全選', 'bad'); }
    ta.remove();
  }

  /* ---------- 初始化 ---------- */
  try {
    var saved = JSON.parse(localStorage.getItem('kolindex.studio.last') || 'null');
    if (saved && saved.d) {
      promptEl.value = saved.p || '';
      renderDoc(saved.d, '已載入上次結果 · 按「生成線框」可重跑');
    }
  } catch (e) {}
  if (!state.doc) {
    renderDoc(WF.demo(), '示範線框 · 改名換需求就能生成');
    state.autoDemo = true;
  }
  checkStatus();
})();
