/* 系統摘要與基礎設施的服務／席位／儲存／磁碟。
   優先畫 /api/rail、/api/seats、/api/jobs；連不上就顯示空狀態，不回填示範數字。 */
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
    if (window.KOL && window.KOL.request) return window.KOL.request(path);
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
    if (state === 'absent') return '不在';
    if (state === 'down') return '沒回應';
    return '沒檢查';
  }

  function shortImage(image) {
    var s = String(image || '');
    if (!s) return '—';
    if (s.indexOf('@sha256:') >= 0) {
      var parts = s.split('@sha256:');
      return parts[0].split('/').pop() + '@' + parts[1].slice(0, 12);
    }
    return s.length > 42 ? s.slice(0, 41) + '…' : s;
  }

  function paintHealthPage(stack) {
    var probes = ((stack && stack.items) || []).filter(function (x) { return x.kind !== 'docker'; });
    var dockers = ((stack && stack.items) || []).filter(function (x) { return x.kind === 'docker'; });
    var probeBody = $('healthProbeBody');
    var dockerBody = $('healthDockerBody');
    var note = $('healthNote');
    var source = $('healthSource');
    var chip = $('healthChip');
    var navBd = $('navHealthBd');
    if (probeBody) {
      if (!stack) {
        probeBody.innerHTML = '<tr><td colspan="4" class="conn-empty">讀不到 /__health/components。確認 BFF（5201）與 Next rewrite。</td></tr>';
      } else if (!probes.length) {
        probeBody.innerHTML = '<tr><td colspan="4" class="conn-empty">沒有探測項</td></tr>';
      } else {
        probeBody.innerHTML = probes.map(function (x) {
          var via = x.via === 'http' ? 'HTTP' : x.via === 'disk' ? '磁碟' : (x.via || 'TCP');
          return '<tr><td class="strong">' + esc(x.name || x.id) + '</td><td class="mono">' + esc(via) + '</td><td>' +
            pill(x.state === 'up', stackWord(x.state)) + '</td><td class="mono">' + esc(x.content || '—') + '</td></tr>';
        }).join('');
      }
    }
    if (dockerBody) {
      if (!stack) {
        dockerBody.innerHTML = '<tr><td colspan="5" class="conn-empty">讀不到容器目錄</td></tr>';
      } else if (!dockers.length) {
        dockerBody.innerHTML = '<tr><td colspan="5" class="conn-empty">還沒有 Compose 目錄。確認 BFF，並視需要設 KOL_DOCKER=1。</td></tr>';
      } else {
        dockerBody.innerHTML = dockers.map(function (x) {
          return '<tr><td class="mono strong">' + esc(x.service || x.name) + '</td><td>' +
            pill(x.state === 'up', stackWord(x.state)) + '</td><td class="mono">' + esc(x.health || '—') +
            '</td><td class="mono">' + esc(x.bind || '—') + '</td><td><div class="mono">' + esc(shortImage(x.image)) +
            '</div><div class="note">' + esc(x.content || '—') + '</div></td></tr>';
        }).join('');
      }
    }
    var known = ((stack && stack.items) || []).filter(function (x) { return x.state === 'up' || x.state === 'down'; });
    var up = known.filter(function (x) { return x.state === 'up'; }).length;
    var text = !stack ? '沒檢查' : (known.length ? (up + '/' + known.length) : ('目錄 ' + dockers.length));
    if (chip) {
      chip.textContent = text;
      chip.className = 'chip ' + (!stack || !known.length ? 'or' : (up === known.length ? 'green' : 'red'));
    }
    if (navBd) navBd.textContent = text;
    if (source) {
      source.textContent = !stack ? '來源 —' : ('來源 ' + (stack.source || 'bff') + (stack.duration_ms != null ? (' · ' + stack.duration_ms + ' ms') : ''));
      source.className = 'chip ' + (stack ? 'green' : 'or');
    }
    if (note && stack && stack.note) note.textContent = stack.note;
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
    var dockerItems = items.filter(function (x) { return x.kind === 'docker'; });
    var dockerMeta = (stack && stack.docker) || {};
    var dockerKnown = dockerItems.filter(function (x) { return x.state !== 'unset'; });
    var dockerUp = dockerKnown.filter(function (x) { return x.state === 'up'; }).length;
    set('stackDocker', !stack ? '沒檢查' : (dockerMeta.enabled === false ? ('目錄 ' + dockerItems.length + ' · 監測關') : (dockerUp + '/' + (dockerKnown.length || dockerItems.length))));
    var list = $('stackDockerList');
    if (list) {
      if (!dockerItems.length) {
        list.innerHTML = '<div class="note">還沒有 Docker 容器項</div>';
      } else {
        list.innerHTML = dockerItems.map(function (x) {
          return '<div class="kv"><span class="mono">' + esc(x.service || x.name) + '</span><b title="' + esc(x.content || '') + '">' +
            esc(stackWord(x.state)) + (x.health ? ' · ' + esc(x.health) : '') + '</b></div>' +
            '<div class="note mono">' + esc(shortImage(x.image)) + (x.bind ? ' · ' + esc(x.bind) : '') + '</div>' +
            '<div class="note">' + esc(x.content || '—') + '</div>';
        }).join('');
      }
    }
    var known = items.filter(function (x) { return x.state !== 'unset' && x.state !== 'absent'; });
    var up = known.filter(function (x) { return x.state === 'up'; }).length;
    var chip = $('stackChip');
    var foot = $('sysFootStack');
    var text = !stack ? '沒檢查' : (!known.length ? ('Docker ' + dockerItems.length) : (up + '/' + known.length));
    if (chip) {
      chip.textContent = '元件 ' + text;
      chip.className = 'chip ' + (!stack || !known.length ? 'or' : (up === known.length ? 'green' : 'red'));
    }
    if (foot) foot.textContent = text;
    paintHealthPage(stack);
    try {
      window.dispatchEvent(new CustomEvent('kolindex:health', { detail: { ok: !!stack, items: items, docker: dockerMeta } }));
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
      ['meilisearch', 'Meilisearch'],
      ['nas', '本機媒體']
    ];
    var by = {};
    ((stack && stack.items) || []).forEach(function (x) { by[x.id] = x; });
    var rows;
    if (!stack) {
      rows = order.map(function (pair) {
        return [pair[1], '健康檢查', pill(false, '沒檢查'), '—'];
      });
    } else {
      rows = order.map(function (pair) {
        var x = by[pair[0]] || { state: 'unset', via: '' };
        var label = x.state === 'up' ? '有回應' : x.state === 'unset' ? '未設定' : (x.state === 'absent' ? '不在' : '沒回應');
        var detail = x.content || '—';
        if (x.state === 'up' && x.freeBytes != null) detail = gb(x.freeBytes) + ' 可用';
        else if (x.state === 'up' && !x.content) detail = x.via === 'http' ? '健康檢查通過' : '連接埠有回應';
        var via = x.via === 'http' ? 'HTTP 健康檢查' : x.via === 'disk' ? '本機磁碟' : 'TCP';
        return [pair[1], via, pill(x.state === 'up', label), detail];
      });
    }
    var dockerItems = ((stack && stack.items) || []).filter(function (x) { return x.kind === 'docker'; });
    dockerItems.forEach(function (x) {
      var label = stackWord(x.state);
      var detail = (x.content || '—') + (x.image ? ' · ' + shortImage(x.image) : '') + (x.bind ? ' · ' + x.bind : '');
      rows.push([
        'Docker · ' + (x.service || x.name),
        'compose',
        pill(x.state === 'up', label + (x.health ? ' · ' + x.health : '')),
        detail
      ]);
    });
    return rows;
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

  function unwrap(res) {
    if (res && res.data && res.status != null && typeof res.data === 'object') return res.data;
    return res;
  }
  function load() {
    return Promise.allSettled([
      getJSON('/api/rail?range=1H'),
      getJSON('/api/seats?tasks=1'),
      getJSON('/api/jobs?state=all&limit=1'),
      getJSON('/__health/components')
    ]).then(function (res) {
      var rail = res[0].status === 'fulfilled' ? unwrap(res[0].value) : null;
      var seats = res[1].status === 'fulfilled' ? unwrap(res[1].value) : null;
      var jobs = res[2].status === 'fulfilled' ? unwrap(res[2].value) : null;
      var stack = res[3].status === 'fulfilled' ? unwrap(res[3].value) : null;
      paintSummary(rail, seats, !!jobs);
      paintStack(stack);
      paintServices(rail, seats, jobs, stack);
      paintSeats(seats);
      paintStore(rail);
      paintDisk(rail);
      paintDocker();
    });
  }

  function dockerRole(row) {
    if (!row) return '—';
    if (row.kind === 'oss') {
      if (row.crawl === 'off' && row.discovery === 'not_enabled') return '待命 · 發現未開';
      if (row.wait === 'control') return '待命控制';
      if (row.wait === 'idle') return '閒置待命';
      if (row.discovery === 'backup') return '備援';
      return '開源';
    }
    return '主服務';
  }

  function paintDockerList(data) {
    var body = $('dockerCtlBody');
    if (!body) return;
    var session = window.KOLINDEX_SESSION;
    var can = !!(session && session.role === 'operator' && data && data.enabled);
    if (!data) {
      body.innerHTML = '<tr><td colspan="6" class="conn-empty">讀不到容器狀態。</td></tr>';
      return;
    }
    if (data.message && !(data.items || []).length && data.enabled === false) {
      body.innerHTML = '<tr><td colspan="6" class="conn-empty">本機 NAS 未開啟容器監測。在跑這個站的機器上設 KOL_DOCKER=1。開源容器整合另見開源組件頁的 /__oss/status。</td></tr>';
      return;
    }
    if (data.message && !(data.items || []).length) {
      body.innerHTML = '<tr><td colspan="6" class="conn-empty">' + esc(data.message) + '</td></tr>';
      return;
    }
    var rows = (data.items || []).map(function (row) {
      var acts = can
        ? '<button type="button" class="mini-btn" data-docker-service="' + esc(row.service) + '" data-docker-action="start">啟動</button> ' +
          '<button type="button" class="mini-btn" data-docker-service="' + esc(row.service) + '" data-docker-action="restart">重啟</button> ' +
          '<button type="button" class="mini-btn" data-docker-service="' + esc(row.service) + '" data-docker-action="stop">停止</button>'
        : '—';
      var content = '<div class="mono">' + esc(shortImage(row.image)) + '</div><div class="note">' + esc(row.content || row.discovery_detail || '—') + (row.bind ? ' · ' + esc(row.bind) : '') + '</div>';
      return '<tr><td class="strong mono">' + esc(row.service) + '</td><td>' + esc(dockerRole(row)) + '</td><td>' + content + '</td><td class="mono">' + esc(row.state || '—') + '</td><td class="mono">' + esc(row.health || '—') + '</td><td>' + acts + '</td></tr>';
    }).join('');
    var tip = data.enabled === false
      ? '<tr><td colspan="6" class="conn-empty">監測未開（KOL_DOCKER≠1）。下表仍列出容器目錄與內容；狀態是 unset。</td></tr>'
      : '';
    body.innerHTML = tip + rows;
  }

  function paintDocker() {
    getJSON('/__docker').then(paintDockerList).catch(function () {
      paintDockerList(null);
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
    var refresh = $('healthRefresh');
    if (refresh) refresh.addEventListener('click', function () {
      refresh.disabled = true;
      load().finally(function () { refresh.disabled = false; });
    });
    var dock = $('dockerCtl');
    if (dock) dock.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-docker-action]');
      if (!btn) return;
      btn.disabled = true;
      fetch(BASE + '/__docker', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          service: btn.getAttribute('data-docker-service'),
          action: btn.getAttribute('data-docker-action')
        })
      }).then(function (r) { return r.json(); }).then(function (data) {
        paintDockerList(data);
      }).catch(function () {
        paintDocker();
      }).finally(function () {
        btn.disabled = false;
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.KOLINDEX_HEALTH = {
    load: load,
    state: function () { return lastStack; }
  };
})();
