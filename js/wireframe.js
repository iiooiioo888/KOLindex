/* ============================================================
   wireframe.js · 線框圖渲染器
   把 LLM 回傳的結構 JSON 變成可直接看的線框圖（純函式，無 DOM 依賴）
   對外：window.WF.normalize(raw) / WF.render(doc) / WF.demo()
   Node 測試時：require('./wireframe.js')
   ============================================================ */
(function (global) {
  'use strict';

  var TYPES = ['header', 'toolbar', 'nav', 'sidebar', 'panel', 'card', 'kpi', 'table', 'list',
    'form', 'chart', 'tabs', 'text', 'button', 'input', 'avatar', 'divider', 'footer',
    'gallery', 'media', 'map', 'timeline'];
  var DEVICES = ['desktop', 'tablet', 'mobile'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function str(v, def) {
    if (v == null) return def == null ? '' : def;
    if (typeof v === 'object') return def == null ? '' : def;
    var s = String(v).replace(/\s+/g, ' ').trim();
    return s ? s.slice(0, 40) : (def == null ? '' : def);
  }
  function num(v, def, min, max) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    if (!isFinite(n)) return def;
    n = Math.round(n);
    return Math.max(min, Math.min(max, n));
  }
  function hash(s) {
    var h = 2166136261;
    for (var i = 0; i < String(s).length; i++) { h ^= String(s).charCodeAt(i); h = Math.imul(h, 16777619); }
    return Math.abs(h >>> 0);
  }

  function guessType(n) {
    var kids = n.cols || n.children || n.nodes || n.items;
    if (Array.isArray(kids) && kids.length) return 'panel';
    var t = (str(n.label) + ' ' + str(n.note)).toLowerCase();
    if (/表|table|grid|清單|列表/.test(t)) return 'table';
    if (/圖|chart|趨勢|折線|柱/.test(t)) return 'chart';
    if (/搜|search|篩選|filter|工具列/.test(t)) return 'toolbar';
    if (/導覽|nav|選單|menu/.test(t)) return 'nav';
    if (/數字|kpi|指標|統計/.test(t)) return 'kpi';
    if (/表單|form|輸入/.test(t)) return 'form';
    return 'text';
  }

  function pickChildren(n) {
    var k = n.cols || n.children || n.nodes || n.items || n.blocks;
    return Array.isArray(k) ? k : [];
  }

  function makeNode(raw, depth) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      if (typeof raw === 'string' && raw) return { type: 'text', label: str(raw), note: '', span: 12, h: 0, cols: [] };
      return null;
    }
    if (depth > 4) return null;
    var type = str(raw.type || raw.kind || raw.t || '').toLowerCase();
    if (TYPES.indexOf(type) < 0) type = guessType(raw);
    var kids = pickChildren(raw).slice(0, 6).map(function (c) { return makeNode(c, depth + 1); }).filter(Boolean);
    return {
      type: type,
      label: str(raw.label || raw.title || raw.name || ''),
      note: str(raw.note || raw.desc || raw.sub || ''),
      span: num(raw.span, kids.length > 1 ? 12 : 12, 1, 12),
      h: num(raw.h || raw.height, 0, 0, 260),
      cols: kids
    };
  }

  function normalize(raw) {
    var doc = (raw && typeof raw === 'object') ? raw : {};
    if (Array.isArray(doc)) doc = { nodes: doc };
    var src = doc.nodes || doc.blocks || doc.layout || doc.children;
    if (!src && doc.root) src = pickChildren(doc.root).length ? pickChildren(doc.root) : [doc.root];
    if (!src && doc.page) src = [doc.page];
    if (src && !Array.isArray(src)) src = [src];
    var nodes = (src || []).map(function (n) { return makeNode(n, 1); }).filter(Boolean).slice(0, 14);
    if (!nodes.length) nodes = normalize(demo()).nodes;
    var device = str(doc.device).toLowerCase();
    return {
      title: str(doc.title || doc.name, '未命名線框'),
      summary: str(doc.summary || doc.desc || doc.description || ''),
      device: DEVICES.indexOf(device) >= 0 ? device : 'desktop',
      nodes: nodes
    };
  }

  /* ---------- 各種節點的骨架圖形 ---------- */
  function bars(seed, n) {
    var out = '', r = hash(seed);
    for (var i = 0; i < n; i++) {
      r = (r * 1103515245 + 12345) & 0x7fffffff;
      var hgt = 26 + (r % 62);
      out += '<i style="height:' + hgt + '%"></i>';
    }
    return '<div class="wf-bars">' + out + '</div>';
  }
  function lines(n, w) {
    var out = '';
    for (var i = 0; i < n; i++) out += '<i style="width:' + (i === n - 1 ? 62 : (w || 96) - i * 6) + '%"></i>';
    return '<div class="wf-lines">' + out + '</div>';
  }
  function pills(n, cls) {
    var out = '';
    for (var i = 0; i < n; i++) out += '<i class="' + (cls || '') + '" style="width:' + (34 + (i * 13) % 40) + 'px"></i>';
    return '<div class="wf-pills">' + out + '</div>';
  }
  function hatch(tag) {
    return '<div class="wf-hatch"><svg viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true">' +
      '<path d="M0 0L100 60M100 0L0 60" stroke="currentColor" stroke-width=".6" opacity=".35"/></svg>' +
      (tag ? '<span>' + esc(tag) + '</span>' : '') + '</div>';
  }

  function body(n) {
    if (n.cols && n.cols.length) return '';
    switch (n.type) {
      case 'header':
        return '<div class="wf-hdr"><i class="wf-sq"></i><span class="wf-grow"></span>' + pills(3) + '<i class="wf-av"></i></div>';
      case 'toolbar':
        return '<div class="wf-hdr"><i class="wf-search"></i><span class="wf-grow"></span><i class="wf-btn"></i><i class="wf-btn"></i></div>';
      case 'nav':
        return pills(5, 'on');
      case 'sidebar':
        return '<div class="wf-side">' + lines(6, 88) + '</div>';
      case 'kpi':
        return '<div class="wf-kpi"><b>0.0</b><i></i></div>';
      case 'table':
        return '<div class="wf-table"><div class="wf-tr wf-th"><i></i><i></i><i></i><i></i></div>' +
          '<div class="wf-tr"><i></i><i></i><i></i><i></i></div>' +
          '<div class="wf-tr"><i></i><i></i><i></i><i></i></div>' +
          '<div class="wf-tr"><i></i><i></i><i></i><i></i></div></div>';
      case 'list':
        return '<div class="wf-list">' + [0, 1, 2].map(function () {
          return '<div class="wf-li"><i class="wf-av sm"></i><span class="wf-lines"><i style="width:66%"></i><i style="width:44%"></i></span></div>';
        }).join('') + '</div>';
      case 'form':
        return '<div class="wf-form"><div class="wf-f"><i></i><i class="wf-in"></i></div><div class="wf-f"><i></i><i class="wf-in"></i></div><i class="wf-btn wide"></i></div>';
      case 'chart':
        return bars(n.label + n.note, 9);
      case 'tabs':
        return '<div class="wf-tabs"><i class="on"></i><i></i><i></i><i></i></div>';
      case 'text':
        return lines(3);
      case 'button':
        return '<div class="wf-center"><i class="wf-btn wide"></i></div>';
      case 'input':
        return '<div class="wf-center"><i class="wf-in"></i></div>';
      case 'avatar':
        return '<div class="wf-center"><i class="wf-av lg"></i></div>';
      case 'divider':
        return '<div class="wf-div"></div>';
      case 'footer':
        return '<div class="wf-foot">' + lines(2, 60) + lines(2, 60) + lines(2, 60) + '</div>';
      case 'gallery':
        return '<div class="wf-gal">' + [0, 1, 2, 3].map(function () { return hatch(); }).join('') + '</div>';
      case 'media':
        return hatch('media');
      case 'map':
        return hatch('map');
      case 'timeline':
        return '<div class="wf-tl">' + [0, 1, 2].map(function () { return '<div><i class="wf-dot"></i><span class="wf-lines"><i style="width:70%"></i></span></div>'; }).join('') + '</div>';
      default:
        return '';
    }
  }

  function renderNode(n) {
    var style = 'grid-column:span ' + n.span;
    if (n.h) style += ';min-height:' + n.h + 'px';
    return '<div class="wf-node t-' + n.type + '" style="' + style + '">' +
      '<span class="wf-tag">' + n.type + '</span>' +
      (n.label ? '<div class="wf-label">' + esc(n.label) + '</div>' : '') +
      (n.note ? '<div class="wf-note">' + esc(n.note) + '</div>' : '') +
      body(n) +
      (n.cols && n.cols.length ? '<div class="wf-children">' + n.cols.map(renderNode).join('') + '</div>' : '') +
      '</div>';
  }

  function render(doc) {
    var d = normalize(doc);
    return '<div class="wf-page" data-device="' + d.device + '">' +
      '<div class="wf-meta"><b>' + esc(d.title) + '</b>' +
      (d.summary ? '<span>' + esc(d.summary) + '</span>' : '') +
      '<em>' + d.device + ' · ' + d.nodes.length + ' 區塊</em></div>' +
      '<div class="wf-canvas"><div class="wf-root">' + d.nodes.map(renderNode).join('') + '</div></div>' +
      '</div>';
  }

  /* ---------- 示範線框（未接模型 / 想先看效果） ---------- */
  function demo() {
    return {
      title: 'KOL 榜單管理台',
      summary: '左篩選 · 上 KPI · 主區榜單表 · 右詳情',
      device: 'desktop',
      nodes: [
        { type: 'header', label: '頂欄', note: '品牌 · 搜尋 · 個人', span: 12, h: 56 },
        { type: 'tabs', label: '榜單維度', note: '近 7 日 / 30 日 / 全期', span: 12, h: 40 },
        { type: 'kpi', label: '總互動', note: '本週 +12.4%', span: 4, h: 84 },
        { type: 'kpi', label: '帶貨 GMV', note: '目標 82%', span: 4, h: 84 },
        { type: 'kpi', label: '新增 KOL', note: '待審 6', span: 4, h: 84 },
        {
          type: 'sidebar', label: '篩選', note: '平台 · 品類 · 粉絲量級', span: 3, h: 300,
          cols: [{ type: 'form', label: '條件', span: 12 }, { type: 'list', label: '已選條件', span: 12 }]
        },
        {
          type: 'panel', label: 'KOL 榜單', note: '可排序 · 支援批次匯出', span: 9, h: 300,
          cols: [
            { type: 'toolbar', label: '表格工具列', span: 12 },
            { type: 'table', label: '榜單明細', note: '排名 / 帳號 / 互動 / 轉化', span: 12, h: 220 }
          ]
        },
        { type: 'chart', label: '互動趨勢', note: '近 14 日', span: 8, h: 160 },
        { type: 'list', label: '近期異動', span: 4, h: 160 },
        { type: 'footer', label: '頁尾', note: '資料更新 12:04', span: 12, h: 48 }
      ]
    };
  }

  var API = { normalize: normalize, render: render, demo: demo, types: TYPES, esc: esc };
  if (typeof module === 'object' && module.exports) module.exports = API;
  else global.WF = API;
})(typeof window !== 'undefined' ? window : this);
