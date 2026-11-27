/* MyLike 深入分析（確定性規則）
   - 只依 /api/mylike 與素材庫摘要產出候選與建議
   - 不寫庫、不觸發採集；「自動派席」只建席位 Agent 大任務候選
   - 模型無工具；severity 由規則決定 */
(function () {
  'use strict';

  var STORE_KEY = 'kolindex.mylike.intel.v1';
  var AUTO_KEY = 'kolindex.mylike.intel.auto';

  var S = {
    insights: [],
    at: null,
    autoSeat: false,
    lastHash: ''
  };

  try { S.autoSeat = localStorage.getItem(AUTO_KEY) === '1'; } catch (e) { /* ignore */ }

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function nfmt(n) {
    return String(n == null ? 0 : n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function nowIso() { return new Date().toISOString(); }
  function daysAgo(ts) {
    if (!ts) return null;
    var t = Date.parse(String(ts).replace(' ', 'T') + (/Z$/.test(String(ts)) ? '' : 'Z'));
    if (!t || isNaN(t)) return null;
    return (Date.now() - t) / 86400000;
  }
  function toast(msg, tone) {
    if (window.KOLINDEX_UI && typeof window.KOLINDEX_UI.toast === 'function') {
      window.KOLINDEX_UI.toast(msg, tone || 'ok');
    }
  }

  function libraryHint() {
    var L = window.KOLINDEX_LIBRARY && window.KOLINDEX_LIBRARY.state;
    if (!L || !L.counts) return null;
    return {
      all: Number(L.counts.all) || 0,
      files: Number(L.counts.files) || 0,
      authors: Number(L.counts.authors) || 0,
      bytes: Number(L.counts.bytes) || 0
    };
  }

  /* ── 規則引擎 ───────────────────────────────────────────── */
  function analyze(raw) {
    var d = raw || {};
    var db = d.db || {};
    var disk = d.disk || {};
    var folders = Array.isArray(d.folders) ? d.folders : [];
    var runs = Array.isArray(d.last) ? d.last : [];
    var out = [];
    var lib = libraryHint();

    function push(row) {
      out.push(Object.assign({
        id: row.id,
        severity: row.severity || 1,
        kind: row.kind || 'ops',
        title: row.title,
        summary: row.summary || '',
        evidence: row.evidence || [],
        action: row.action || null,
        actionLabel: row.actionLabel || '',
        seatGoal: row.seatGoal || null,
        seatTitle: row.seatTitle || null
      }, row));
    }

    if (!(d.cdp && d.cdp.ok)) {
      push({
        id: 'cdp_down', severity: 3, kind: 'connectivity',
        title: 'MyLike CDP 未連線',
        summary: '無法讀抖音頁狀態。先確認本機 MyLike／瀏覽器遠端偵錯。',
        evidence: [String((d.cdp && d.cdp.error) || 'cdp_offline')],
        action: null, actionLabel: ''
      });
    } else if (!(d.page && d.page.ok)) {
      push({
        id: 'page_closed', severity: 2, kind: 'connectivity',
        title: '抖音頁未就緒',
        summary: 'CDP 已通但抖音頁關閉或失效。建議喚醒後再同步。',
        evidence: [String((d.page && d.page.error) || 'page_closed')],
        action: 'wake', actionLabel: '喚醒抖音頁'
      });
    }

    if (disk.ok && Number(disk.freeGb) < 20) {
      push({
        id: 'disk_critical', severity: 3, kind: 'storage',
        title: '磁碟空間危急',
        summary: (disk.drive || '磁碟') + ' 剩餘 ' + disk.freeGb + ' GB。繼續同步可能失敗。',
        evidence: ['freeGb=' + disk.freeGb],
        action: 'seat', actionLabel: '派磁碟巡檢席',
        seatGoal: 'ops', seatTitle: 'MyLike 觸發：磁碟危急巡檢（剩 ' + disk.freeGb + ' GB）'
      });
    } else if (disk.ok && Number(disk.freeGb) < 50) {
      push({
        id: 'disk_warn', severity: 2, kind: 'storage',
        title: '磁碟空間偏低',
        summary: (disk.drive || '磁碟') + ' 剩餘 ' + disk.freeGb + ' GB。建議先清缺檔／衍生檔策略。',
        evidence: ['freeGb=' + disk.freeGb],
        action: 'seat', actionLabel: '派營運巡檢',
        seatGoal: 'ops', seatTitle: 'MyLike 觸發：磁碟偏低巡檢'
      });
    }

    var items = Number(db.items) || 0;
    var localItems = Number(db.localItems) || 0;
    if (items > 20) {
      var missRatio = (items - localItems) / items;
      if (missRatio >= 0.25) {
        push({
          id: 'local_gap', severity: 2, kind: 'media',
          title: '本機缺檔比例偏高',
          summary: '索引 ' + nfmt(items) + ' 件，本機 ' + nfmt(localItems) + '（缺約 ' + Math.round(missRatio * 100) + '%）。',
          evidence: ['items=' + items, 'local=' + localItems],
          action: 'download_missing', actionLabel: '下載缺檔',
          seatGoal: 'media', seatTitle: 'MyLike 觸發：素材缺檔與索引對帳'
        });
      }
    }

    var gapFolders = [];
    var staleFolders = [];
    var emptyIndexed = [];
    folders.forEach(function (f) {
      var total = Number(f.total) || 0;
      var tagged = Number(f.dbItems) || 0;
      var gap = Math.max(0, total - tagged);
      var age = daysAgo(f.syncedAt);
      if (total >= 10 && gap / total >= 0.3) {
        gapFolders.push({ id: f.id, name: f.name, total: total, tagged: tagged, gap: gap });
      }
      if (total > 0 && tagged === 0) {
        emptyIndexed.push({ id: f.id, name: f.name, total: total });
      }
      if (age != null && age >= 7 && total > 0) {
        staleFolders.push({ id: f.id, name: f.name, days: Math.round(age), total: total });
      }
    });
    gapFolders.sort(function (a, b) { return b.gap - a.gap; });
    emptyIndexed.sort(function (a, b) { return b.total - a.total; });
    staleFolders.sort(function (a, b) { return b.days - a.days; });

    if (emptyIndexed.length) {
      var topE = emptyIndexed[0];
      push({
        id: 'folder_untagged', severity: 3, kind: 'coverage',
        title: '收藏夾尚未入索引',
        summary: '「' + topE.name + '」聲稱 ' + nfmt(topE.total) + ' 件，庫內標記 0。另有 ' + (emptyIndexed.length - 1) + ' 個同類夾。',
        evidence: emptyIndexed.slice(0, 5).map(function (x) { return x.name + ':' + x.total; }),
        action: 'sync_folder', actionLabel: '抓「' + topE.name + '」索引',
        actionPayload: { folderId: topE.id },
        seatGoal: 'media', seatTitle: 'MyLike 觸發：補抓收藏夾「' + topE.name + '」'
      });
    }

    if (gapFolders.length) {
      var topG = gapFolders[0];
      push({
        id: 'folder_gap', severity: 2, kind: 'coverage',
        title: '收藏夾覆蓋缺口',
        summary: '「' + topG.name + '」缺口約 ' + nfmt(topG.gap) + '／' + nfmt(topG.total) + '。共 ' + gapFolders.length + ' 個夾缺口 ≥30%。',
        evidence: gapFolders.slice(0, 5).map(function (x) { return x.name + ' gap=' + x.gap; }),
        action: 'sync_folder', actionLabel: '補抓「' + topG.name + '」',
        actionPayload: { folderId: topG.id },
        seatGoal: 'media', seatTitle: 'MyLike 觸發：收藏夾覆蓋對帳'
      });
    }

    if (staleFolders.length) {
      var topS = staleFolders[0];
      push({
        id: 'folder_stale', severity: 2, kind: 'freshness',
        title: '收藏夾同步過舊',
        summary: '「' + topS.name + '」約 ' + topS.days + ' 天未同步。共 ' + staleFolders.length + ' 個夾超過 7 天。',
        evidence: staleFolders.slice(0, 5).map(function (x) { return x.name + ' ' + x.days + 'd'; }),
        action: 'sync_folder', actionLabel: '更新「' + topS.name + '」',
        actionPayload: { folderId: topS.id }
      });
    }

    if (!folders.length && items > 0) {
      push({
        id: 'no_folders', severity: 1, kind: 'coverage',
        title: '尚無收藏夾清單',
        summary: '索引已有資料，但未抓收藏夾目錄。無法做夾級覆蓋分析。',
        evidence: ['folders=0'],
        action: 'refresh_folders', actionLabel: '重新抓收藏夾'
      });
    }

    var recentFail = runs.filter(function (r) { return r.state === 'error'; })[0];
    if (recentFail) {
      push({
        id: 'sync_error', severity: 2, kind: 'reliability',
        title: '最近同步失敗',
        summary: (recentFail.kind || 'sync') + ' 失敗：' + (recentFail.error || '未知原因'),
        evidence: [String(recentFail.error || 'error')],
        action: recentFail.kind === 'likes' ? 'sync_likes' : (recentFail.kind === 'favorites' ? 'sync_favorites' : 'wake'),
        actionLabel: '重試／喚醒'
      });
    }

    var lastOk = runs.filter(function (r) { return r.state === 'done' || r.state === 'error'; })[0];
    var lastAge = lastOk ? daysAgo(lastOk.finishedAt || lastOk.startedAt) : null;
    if (items > 0 && (lastAge == null || lastAge >= 2)) {
      push({
        id: 'sync_stale', severity: 1, kind: 'freshness',
        title: '超過 2 天未成功同步',
        summary: lastAge == null ? '沒有同步紀錄。' : ('距上次同步約 ' + Math.round(lastAge) + ' 天。'),
        evidence: ['lastAge=' + lastAge],
        action: 'sync_likes', actionLabel: '同步點讚'
      });
    }

    if (!(d.account && d.account.name)) {
      push({
        id: 'account_unknown', severity: 2, kind: 'identity',
        title: '尚未讀到 MyLike 帳號',
        summary: '喚醒抖音頁並登入後，才能把同步結果對到正確帳號。',
        evidence: ['account=missing'],
        action: 'wake', actionLabel: '喚醒抖音頁'
      });
    }

    if (lib && lib.all > 0 && items > 0) {
      var drift = Math.abs(lib.all - items) / Math.max(lib.all, items);
      if (drift >= 0.15) {
        push({
          id: 'lib_drift', severity: 1, kind: 'integrity',
          title: '素材庫與 MyLike 索引筆數落差',
          summary: '素材庫顯示 ' + nfmt(lib.all) + '，MyLike 索引 ' + nfmt(items) + '。可能篩選或來源不同。',
          evidence: ['library=' + lib.all, 'mylike=' + items],
          action: 'open_library', actionLabel: '打開素材庫',
          seatGoal: 'media', seatTitle: 'MyLike 觸發：素材庫與索引對帳'
        });
      }
    }

    /* 集中度：前三大缺口夾佔總缺口過半 → 建議優先補這幾個 */
    var totalGap = gapFolders.reduce(function (a, b) { return a + b.gap; }, 0);
    if (totalGap >= 50 && gapFolders.length >= 2) {
      var top3 = gapFolders.slice(0, 3);
      var top3Gap = top3.reduce(function (a, b) { return a + b.gap; }, 0);
      if (top3Gap / totalGap >= 0.5) {
        push({
          id: 'gap_concentration', severity: 2, kind: 'priority',
          title: '缺口集中在少數收藏夾',
          summary: '前 ' + top3.length + ' 夾佔總缺口 ' + Math.round(top3Gap / totalGap * 100) + '%。優先補這幾個效率最高。',
          evidence: top3.map(function (x) { return x.name + ':' + x.gap; }),
          action: 'sync_folder', actionLabel: '先補「' + top3[0].name + '」',
          actionPayload: { folderId: top3[0].id },
          seatGoal: 'mixed', seatTitle: 'MyLike 觸發：高優先收藏夾補齊'
        });
      }
    }

    out.sort(function (a, b) { return b.severity - a.severity; });
    return out;
  }

  function hashInsights(list) {
    return list.map(function (x) { return x.id + ':' + x.severity + ':' + (x.actionPayload && x.actionPayload.folderId || ''); }).join('|');
  }

  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ insights: S.insights, at: S.at, lastHash: S.lastHash }));
    } catch (e) { /* ignore */ }
  }

  function run(data) {
    var src = data || (window.KOLINDEX_LIBRARY && window.KOLINDEX_LIBRARY.mylike && window.KOLINDEX_LIBRARY.mylike.state && window.KOLINDEX_LIBRARY.mylike.state.data) || null;
    /* library exposes mylike via KOLINDEX_LIBRARY.mylike.state — also accept explicit */
    if (!src && window.KOLINDEX_LIBRARY && window.KOLINDEX_LIBRARY.mylike) {
      src = window.KOLINDEX_LIBRARY.mylike.state.data;
    }
    S.insights = analyze(src || {});
    S.at = nowIso();
    var h = hashInsights(S.insights);
    var changed = h !== S.lastHash;
    S.lastHash = h;
    persist();
    paint();
    notifyBoard();
    if (changed && S.autoSeat) autoDispatchSeats();
    return S.insights;
  }

  function autoDispatchSeats() {
    var seats = window.KOLINDEX_SEATS;
    if (!seats || typeof seats.createJob !== 'function') return;
    var sent = 0;
    S.insights.forEach(function (ins) {
      if (ins.severity < 2 || !ins.seatGoal || !ins.seatTitle) return;
      if (sent >= 2) return; /* 每次最多兩張，避免洗版 */
      seats.createJob(ins.seatTitle, ins.seatGoal);
      sent += 1;
    });
    if (sent) toast('已依 MyLike 分析自動派 ' + sent + ' 張席位大任務', 'ok');
  }

  function boardItems() {
    return S.insights.filter(function (x) { return x.severity >= 2; }).slice(0, 8).map(function (x) {
      return {
        board: 'mylike-intel',
        state: x.severity >= 3 ? 'running' : 'queued',
        ref: 'MLI-' + x.id,
        title: x.title,
        detail: x.summary,
        error: '',
        source: 'mylike-intel',
        severity: x.severity
      };
    });
  }

  function notifyBoard() {
    var ui = window.KOLINDEX_UI;
    if (ui && typeof ui.setMylikeIntel === 'function') {
      try { ui.setMylikeIntel({ insights: S.insights, items: boardItems(), at: S.at }); } catch (e) { /* ignore */ }
    }
    try {
      window.dispatchEvent(new CustomEvent('kolindex:mylike-intel', {
        detail: { insights: S.insights, items: boardItems(), at: S.at }
      }));
    } catch (e) { /* ignore */ }
  }

  function paint() {
    var host = $('mlIntel');
    var meta = $('mlIntelMeta');
    var auto = $('mlIntelAuto');
    if (auto) auto.checked = !!S.autoSeat;
    if (meta) {
      var hi = S.insights.filter(function (x) { return x.severity >= 3; }).length;
      meta.textContent = S.insights.length
        ? (S.insights.length + ' 則 · 高優先 ' + hi)
        : '尚無洞察';
    }
    if (!host) return;
    if (!S.insights.length) {
      host.innerHTML = '<div class="ml-empty">載入 MyLike 狀態後，會依收藏夾缺口、缺檔、磁碟與同步健康產出分析候選。</div>';
      return;
    }
    host.innerHTML = S.insights.map(function (x) {
      var sev = x.severity >= 3 ? 'hi' : (x.severity >= 2 ? 'mid' : 'lo');
      var btn = x.action
        ? '<button type="button" class="mini-btn" data-ml-intel="' + esc(x.id) + '" data-cap="write">' + esc(x.actionLabel || '執行') + '</button>'
        : '';
      var seat = x.seatGoal
        ? '<button type="button" class="mini-btn" data-ml-seat="' + esc(x.id) + '">派席</button>'
        : '';
      return '<div class="ml-intel-row sev-' + sev + '" data-id="' + esc(x.id) + '">' +
        '<div class="mi-top"><span class="mi-sev">' + x.severity + '</span><b class="mi-title">' + esc(x.title) + '</b><span class="mi-kind">' + esc(x.kind) + '</span></div>' +
        '<div class="mi-sum">' + esc(x.summary) + '</div>' +
        (x.evidence && x.evidence.length ? '<div class="mi-ev">' + esc(x.evidence.slice(0, 4).join(' · ')) + '</div>' : '') +
        '<div class="mi-acts">' + btn + seat + '</div></div>';
    }).join('');
  }

  function findInsight(id) {
    for (var i = 0; i < S.insights.length; i++) if (S.insights[i].id === id) return S.insights[i];
    return null;
  }

  function act(id) {
    var ins = findInsight(id);
    if (!ins || !ins.action) return;
    var ML = window.KOLINDEX_LIBRARY && window.KOLINDEX_LIBRARY.mylike;
    if (ins.action === 'wake' && ML && ML.wake) { ML.wake(); return; }
    if (ins.action === 'sync_likes' && ML && ML.start) { ML.start('likes'); return; }
    if (ins.action === 'sync_favorites' && ML && ML.start) { ML.start('favorites'); return; }
    if (ins.action === 'refresh_folders' && ML && ML.refreshFolders) { ML.refreshFolders(); return; }
    if (ins.action === 'sync_folder' && ML && ML.folder && ins.actionPayload && ins.actionPayload.folderId) {
      ML.folder(ins.actionPayload.folderId);
      return;
    }
    if (ins.action === 'download_missing' && window.KOLINDEX_LIBRARY && window.KOLINDEX_LIBRARY.download) {
      window.KOLINDEX_LIBRARY.download.missing();
      return;
    }
    if (ins.action === 'open_library' && window.KOLINDEX_UI && window.KOLINDEX_UI.setTopic) {
      window.KOLINDEX_UI.setTopic('library');
      return;
    }
    if (ins.action === 'seat') {
      seatAct(id);
    }
  }

  function seatAct(id) {
    var ins = findInsight(id);
    if (!ins || !ins.seatGoal) return;
    var seats = window.KOLINDEX_SEATS;
    if (!seats || typeof seats.createJob !== 'function') {
      toast('席位 Agent 未載入', 'err');
      return;
    }
    seats.createJob(ins.seatTitle || ins.title, ins.seatGoal);
    if (window.KOLINDEX_UI && window.KOLINDEX_UI.setTopic) window.KOLINDEX_UI.setTopic('seat');
    toast('已派席：' + (ins.seatTitle || ins.title), 'ok');
  }

  function bind() {
    var host = $('mlIntel');
    if (host && !host._bound) {
      host._bound = true;
      host.addEventListener('click', function (e) {
        var a = e.target.closest('[data-ml-intel]');
        if (a) { act(a.getAttribute('data-ml-intel')); return; }
        var s = e.target.closest('[data-ml-seat]');
        if (s) { seatAct(s.getAttribute('data-ml-seat')); return; }
      });
    }
    var auto = $('mlIntelAuto');
    if (auto && !auto._bound) {
      auto._bound = true;
      auto.addEventListener('change', function () {
        S.autoSeat = !!auto.checked;
        try { localStorage.setItem(AUTO_KEY, S.autoSeat ? '1' : '0'); } catch (e) { /* ignore */ }
        toast(S.autoSeat ? '已開：高優先洞察自動派席（最多 2 張）' : '已關自動派席', 'ok');
      });
    }
    var rerun = $('mlIntelRun');
    if (rerun && !rerun._bound) {
      rerun._bound = true;
      rerun.addEventListener('click', function () {
        var data = window.KOLINDEX_LIBRARY && window.KOLINDEX_LIBRARY.mylike && window.KOLINDEX_LIBRARY.mylike.state.data;
        run(data);
        toast('已重跑 MyLike 分析', 'ok');
      });
    }
  }

  function hookLibrary() {
    /* 在 mlRenderAll / sync 完成後由 library 呼叫 window.KOLINDEX_MYLIKE_INTEL.onData */
  }

  function onData(data) {
    bind();
    return run(data);
  }

  window.KOLINDEX_MYLIKE_INTEL = {
    version: '1.0.0',
    state: S,
    analyze: analyze,
    run: run,
    onData: onData,
    boardItems: boardItems,
    paint: paint,
    act: act
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { bind(); paint(); });
  } else {
    bind();
    paint();
  }
})();
