/* 系統摘要與基礎設施的服務／席位／儲存／磁碟。
   只畫 /api/rail、/api/seats、/api/jobs 回來的數字。沒連上就留「—」，不回填舊的雲端示範值。 */
(function () {
  'use strict';

  var BASE = window.KOLINDEX_BASE || '';
  var POLL_MS = 15000;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(n) {
    if (n == null || n === '' || isNaN(Number(n))) return '—';
    return Number(n).toLocaleString('en-US');
  }
  function set(id, text) {
    var el = $(id);
    if (el) el.textContent = text;
  }
  function gb(bytes) {
    if (bytes == null || isNaN(Number(bytes))) return '—';
    var n = Number(bytes);
    if (n >= 1e12) return (n / 1e12).toFixed(2) + ' TB';
    if (n >= 1e9) return (n / 1e9).toFixed(2) + ' GB';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + ' MB';
    return num(n) + ' B';
  }
  function getJSON(path) {
    return fetch(BASE + path, { headers: { accept: 'application/json' }, cache: 'no-store', credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
  }

  function paintPorts() {
    set('sysPortWeb', location.host || '—');
    set('sysPortApi', '同源 /api');
    var media = window.KOLINDEX_MEDIA || '';
    set('sysPortMedia', media ? String(media).replace(/^https?:\/\//, '').replace(/\/$/, '') : '未設定');
    set('sysFootPorts', (location.host || '—') + ' · /api');
  }

  var STACK_IDS = { postgres: 'stackPg', redis: 'stackRedis', minio: 'stackMinio', meilisearch: 'stackMeili' };
  var lastStack = null;

  function stackWord(state) {
    if (state === 'up') return '有回應';
    if (state === 'unset') return '未設定';
    if (state === 'down') return '沒回應';
    return '沒檢查';
  }

  function paintStack(stack) {
    lastStack = stack;
    var items = (stack && stack.items) || [];
    var by = {};
    items.forEach(function (x) { by[x.id] = x; });
    Object.keys(STACK_IDS).forEach(function (id) {
      var x = by[id];
      set(STACK_IDS[id], x ? stackWord(x.state) : '沒檢查');
    });
    var known = items.filter(function (x) { return x.state !== 'unset'; });
    var up = known.filter(function (x) { return x.state === 'up'; }).length;
    var chip = $('stackChip');
    var foot = $('sysFootStack');
    var text = !stack ? '沒檢查' : (!known.length ? '未設定' : (up + '/' + known.length));
    if (chip) {
      chip.textContent = '元件 ' + text;
      chip.className = 'chip ' + (!stack || !known.length ? 'or' : (up === known.length ? 'green' : 'red'));
    }
    if (foot) foot.textContent = text;
    try {
      window.dispatchEvent(new CustomEvent('kolindex:health', { detail: { ok: !!stack, items: items } }));
    } catch (e) { /* 事件是加分項 */ }
  }

  function paintSummary(rail, seats, jobsOk) {
    var slots = (rail && rail.slots) || {};
    var storage = (rail && rail.storage) || {};
    var queue = (rail && rail.queue) || {};
    var list = (seats && seats.seats) || [];
    var busy = list.filter(function (s) { return s && s.current; }).length;
    var counts = (seats && seats.counts) || {};
    set('sysSeats', list.length ? (busy + ' / ' + list.length) : '—');
    set('sysQueue', rail ? num(queue.depth) : '—');
    set('sysConn', rail ? (num(slots.active) + ' / ' + num(slots.total)) : '—');
    set('sysDisk', storage.usedPct == null ? '—' : (storage.usedPct + '% · 剩 ' + num(storage.freeGb) + ' GB'));
    set('sysToday', seats ? (num(counts.today) + (counts.failedToday ? ' · 失敗 ' + num(counts.failedToday) : '')) : '—');
    set('sysAuto', seats ? (seats.auto ? 'ON' : 'OFF') : '—');
    var badge = $('navInfraBd');
    if (badge) badge.textContent = rail ? (num(slots.active) + '/' + num(slots.total)) : '—';
    set('sysMetaSeats', '席位 ' + (list.length ? (busy + '/' + list.length) : '—'));
    set('sysMetaDisk', '磁碟 ' + (storage.usedPct == null ? '—' : storage.usedPct + '%'));
    set('sysMetaQueue', '佇列 ' + (rail ? num(queue.depth) : '—'));
    var live = $('sysLive');
    if (live) {
      var up = !!(rail || seats || jobsOk);
      live.textContent = up ? 'LIVE' : '未連線';
      live.className = 'chip ' + (up ? 'green' : 'or');
      set('sysFootData', up ? 'API · 輪詢' : '未連線');
    }
  }

  function pill(ok, label) {
    return '<span class="pill ' + (ok ? 'green' : 'or') + '"><span class="sig ' + (ok ? 'ok' : 'warn') + '"></span>' + esc(label) + '</span>';
  }

  function stackRows(stack) {
    var order = [
      ['postgres', 'PostgreSQL'],
      ['redis', 'Redis'],
      ['minio', 'MinIO'],
      ['meilisearch', 'Meilisearch']
    ];
    var by = {};
    ((stack && stack.items) || []).forEach(function (x) { by[x.id] = x; });
    if (!stack) {
      return order.map(function (pair) {
        return [pair[1], '健康檢查', pill(false, '沒檢查'), '—'];
      });
    }
    return order.map(function (pair) {
      var x = by[pair[0]] || { state: 'unset', via: '' };
      var label = x.state === 'up' ? '有回應' : x.state === 'unset' ? '未設定' : '沒回應';
      var detail = x.state === 'up'
        ? (x.via === 'http' ? '健康檢查通過' : '連接埠有回應')
        : '—';
      return [pair[1], x.via === 'http' ? 'HTTP 健康檢查' : 'TCP', pill(x.state === 'up', label), detail];
    });
  }

  function paintServices(rail, seats, jobs, stack) {
    var body = $('sysServices');
    if (!body) return;
    var slots = (rail && rail.slots) || {};
    var rows = stackRows(stack).concat([
      ['監控 /api/rail', '佇列、連接器、磁碟', rail ? pill(true, '有回應') : pill(false, '沒回應'), rail ? (num((rail.queue || {}).depth) + ' 佇列') : '—'],
      ['席位 /api/seats', 'worker pool', seats ? pill(true, '有回應') : pill(false, '沒回應'), seats ? (((seats.seats || []).length) + ' 席') : '—'],
      ['連接器', '憑證健康', rail ? pill(true, num(slots.active) + '/' + num(slots.total)) : pill(false, '沒回應'), rail ? ('冷卻 ' + num(slots.cooling) + ' · 過期 ' + num(slots.expired)) : '—'],
      ['排程 /api/jobs', 'crawl_job', jobs ? pill(true, '有回應') : pill(false, '沒回應'), jobs ? (num(jobs.total) + ' 筆') : '—']
    ]);
    body.innerHTML = rows.map(function (r) {
      return '<tr><td class="strong">' + esc(r[0]) + '</td><td class="mono">' + esc(r[1]) + '</td><td>' + r[2] + '</td><td class="mono">' + esc(r[3]) + '</td></tr>';
    }).join('');
  }

  function paintSeats(seats) {
    var body = $('sysSeatBody');
    if (!body) return;
    var list = (seats && seats.seats) || [];
    if (!seats) {
      body.innerHTML = '<tr><td colspan="6" class="conn-empty">連不到 /api/seats</td></tr>';
      return;
    }
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="6" class="conn-empty">後端沒有席位</td></tr>';
      return;
    }
    body.innerHTML = list.map(function (s) {
      var busy = !!(s && s.current);
      return '<tr><td class="strong mono">' + esc(s.id) + '</td><td class="mono">' + esc(s.platform || '—') + '</td><td>' +
        pill(true, busy ? '執行中' : '待命') + '</td><td class="mono">' + esc(s.lane || '—') + '</td><td class="mono" data-col="low">' +
        esc(num(s.done)) + '</td><td class="mono" data-col="low">' + esc(num(s.failed)) + '</td></tr>';
    }).join('');
  }

  function storeRows(storage) {
    var items = Number(storage.items) || 0;
    var missingPct = items ? ((Number(storage.missing) || 0) / items * 100) : 0;
    return [
      ['作品', num(storage.items), '索引裡的件數'],
      ['圖集 / 影片', num(storage.galleries) + ' / ' + num(storage.videos), '依種類'],
      ['作者', num(storage.authors), '有作品的作者'],
      ['本機檔案', num(storage.files), gb(storage.bytes)],
      ['缺檔', num(storage.missing), items ? (missingPct.toFixed(1) + '%') : '—'],
      ['磁碟已用', storage.usedPct == null ? '—' : (storage.usedPct + '%'), '剩 ' + num(storage.freeGb) + ' GB']
    ];
  }

  function paintStore(rail) {
    var body = $('sysStoreBody');
    if (!body) return;
    var storage = rail && rail.storage;
    if (!storage) {
      body.innerHTML = '<tr><td colspan="3" class="conn-empty">連不到 /api/rail 的儲存數字</td></tr>';
      return;
    }
    body.innerHTML = storeRows(storage).map(function (r) {
      return '<tr><td class="strong">' + esc(r[0]) + '</td><td class="mono">' + esc(r[1]) + '</td><td>' + esc(r[2]) + '</td></tr>';
    }).join('');
  }

  function bar(label, pct, value) {
    var p = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
    return '<div class="cost-row"><div class="cl">' + esc(label) + '</div><div class="ctrack"><div class="cfill fill-cyan" style="--pct:' + p + '%"></div></div><div class="cval">' + esc(value) + '</div><div class="cpct">' + p + '%</div></div>';
  }

  function paintDisk(rail) {
    var box = $('sysDiskPane');
    if (!box) return;
    var storage = rail && rail.storage;
    if (!storage) {
      box.innerHTML = '<div class="conn-empty">連不到 /api/rail 的磁碟數字</div>';
      return;
    }
    var items = Number(storage.items) || 0;
    var miss = items ? (Number(storage.missing) || 0) / items * 100 : 0;
    var local = items ? Math.max(0, 100 - miss) : 0;
    box.innerHTML =
      '<div class="kicker">本機素材磁碟</div>' +
      bar('已用', storage.usedPct, storage.usedPct == null ? '—' : (num(storage.freeGb) + ' GB 剩餘')) +
      bar('已在本機', local, num(Math.max(0, items - (Number(storage.missing) || 0))) + ' 件') +
      bar('缺檔', miss, num(storage.missing) + ' 件') +
      '<div class="note">數字來自 /api/rail 的 storage。這裡沒有雲端帳單。</div>';
  }

  function load() {
    return Promise.allSettled([
      getJSON('/api/rail?range=1H'),
      getJSON('/api/seats?tasks=1'),
      getJSON('/api/jobs?state=all&limit=1'),
      getJSON('/__health/components')
    ]).then(function (res) {
      var rail = res[0].status === 'fulfilled' ? res[0].value : null;
      var seats = res[1].status === 'fulfilled' ? res[1].value : null;
      var jobs = res[2].status === 'fulfilled' ? res[2].value : null;
      var stack = res[3].status === 'fulfilled' ? res[3].value : null;
      paintSummary(rail, seats, !!jobs);
      paintStack(stack);
      paintServices(rail, seats, jobs, stack);
      paintSeats(seats);
      paintStore(rail);
      paintDisk(rail);
    });
  }

  function boot() {
    paintPorts();
    load();
    setInterval(function () {
      if (!document.hidden) load();
    }, POLL_MS);
    window.addEventListener('kolindex:api', function (e) {
      var d = (e && e.detail) || {};
      if (d.ok) load();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.KOLINDEX_HEALTH = {
    load: load,
    state: function () { return lastStack; }
  };
})();
