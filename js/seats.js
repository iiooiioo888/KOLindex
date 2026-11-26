/* 席位 Agent 編隊
   管線：用戶大任務 → 任務經理分析／拆分 → 各席位獨立空間（技能／MCP／任務列表）承接。
   本層為控制台編排模擬；分析模型無工具、不直連 Vault／DB／檔案寫入。 */
(function () {
  'use strict';
  window.KOLINDEX_SEATS_LIVE = true;

  var TICK_MS = 700;
  var STORE_KEY = 'kolindex.seat.agents.v1';

  var SKILL_CATALOG = {
    analyze: { id: 'analyze', label: '任務分析' },
    split: { id: 'split', label: '子任務拆分' },
    assign: { id: 'assign', label: '技能匹配派工' },
    discover: { id: 'discover', label: '帳號發現' },
    oss: { id: 'oss', label: 'OSS 探查' },
    library: { id: 'library', label: '素材索引' },
    review: { id: 'review', label: '複核審核' },
    collect: { id: 'collect', label: '收集收件' },
    queue: { id: 'queue', label: '佇列健康' },
    disk: { id: 'disk', label: '磁碟巡檢' },
    audit: { id: 'audit', label: '審計掃描' },
    contract: { id: 'contract', label: '契約校驗' }
  };

  var MCP_CATALOG = {
    none: { id: 'none', label: '無（純決策）' },
    'policy-read': { id: 'policy-read', label: 'policy-read' },
    'oss-runner': { id: 'oss-runner', label: 'oss-runner' },
    'meili-query': { id: 'meili-query', label: 'meili-query' },
    'minio-list': { id: 'minio-list', label: 'minio-list' },
    'pg-readonly': { id: 'pg-readonly', label: 'pg-readonly' },
    'fs-scoped': { id: 'fs-scoped', label: 'fs-scoped' },
    'audit-tail': { id: 'audit-tail', label: 'audit-tail' },
    'schema-check': { id: 'schema-check', label: 'schema-check' }
  };

  /* 目標類型 → 拆分子任務模板（確定性規則，非 LLM 動作） */
  var SPLIT_MAP = {
    discover: [
      { skill: 'discover', label: '整理公開帳號候選', mcp: 'meili-query' },
      { skill: 'oss', label: 'OSS 交叉探查', mcp: 'oss-runner' },
      { skill: 'review', label: '人工確認候選', mcp: 'pg-readonly' },
      { skill: 'audit', label: '寫入審計軌跡', mcp: 'audit-tail' }
    ],
    audit: [
      { skill: 'audit', label: '掃描審計日誌', mcp: 'audit-tail' },
      { skill: 'contract', label: '契約／權限抽檢', mcp: 'schema-check' },
      { skill: 'review', label: '異常項複核', mcp: 'pg-readonly' }
    ],
    media: [
      { skill: 'library', label: '素材索引對帳', mcp: 'minio-list' },
      { skill: 'disk', label: '磁碟容量巡檢', mcp: 'fs-scoped' },
      { skill: 'collect', label: '待收媒體清點', mcp: 'pg-readonly' }
    ],
    ops: [
      { skill: 'queue', label: '採集佇列健康', mcp: 'pg-readonly' },
      { skill: 'disk', label: '磁碟告警檢查', mcp: 'fs-scoped' },
      { skill: 'audit', label: '營運審計抽樣', mcp: 'audit-tail' }
    ],
    mixed: [
      { skill: 'discover', label: '帳號候選整理', mcp: 'meili-query' },
      { skill: 'library', label: '素材缺口掃描', mcp: 'minio-list' },
      { skill: 'queue', label: '佇列壓力檢查', mcp: 'pg-readonly' },
      { skill: 'review', label: '結果彙總複核', mcp: 'pg-readonly' },
      { skill: 'audit', label: '全鏈審計標記', mcp: 'audit-tail' }
    ]
  };

  var AGENT_DEFS = [
    {
      id: 'A1', name: '探查席', role: '帳號發現 Agent',
      skills: ['discover', 'oss'], mcps: ['oss-runner', 'meili-query'], hue: 1
    },
    {
      id: 'A2', name: '素材席', role: '素材索引 Agent',
      skills: ['library'], mcps: ['minio-list', 'fs-scoped'], hue: 2
    },
    {
      id: 'A3', name: '複核席', role: '複核審核 Agent',
      skills: ['review'], mcps: ['pg-readonly'], hue: 3
    },
    {
      id: 'A4', name: '收件席', role: '收集收件 Agent',
      skills: ['collect'], mcps: ['pg-readonly', 'minio-list'], hue: 4
    },
    {
      id: 'A5', name: '佇列席', role: '佇列健康 Agent',
      skills: ['queue'], mcps: ['pg-readonly'], hue: 5
    },
    {
      id: 'A6', name: '磁碟席', role: '磁碟巡檢 Agent',
      skills: ['disk'], mcps: ['fs-scoped'], hue: 6
    },
    {
      id: 'A7', name: '審計席', role: '審計掃描 Agent',
      skills: ['audit'], mcps: ['audit-tail', 'pg-readonly'], hue: 7
    },
    {
      id: 'A8', name: '契約席', role: '契約校驗 Agent',
      skills: ['contract', 'review'], mcps: ['schema-check', 'policy-read'], hue: 8
    }
  ];

  var S = {
    jobs: [],
    children: [],
    agents: [],
    manager: {
      id: 'TM-00',
      name: '任務經理',
      skills: ['analyze', 'split', 'assign'],
      mcps: ['policy-read'],
      state: 'idle',
      focusJobId: null,
      log: []
    },
    selected: '',
    auto: true,
    seq: { job: 100, child: 1000 },
    at: null
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
  function skillLabel(id) { return (SKILL_CATALOG[id] && SKILL_CATALOG[id].label) || id; }
  function mcpLabel(id) { return (MCP_CATALOG[id] && MCP_CATALOG[id].label) || id; }
  function statusZh(st) {
    return {
      queued: '排隊', analyzing: '分析中', splitting: '拆分中',
      dispatching: '派工中', running: '執行中', done: '完成',
      failed: '失敗', blocked: '阻塞', idle: '待命',
      claimed: '已認領', assigned: '已派席'
    }[st] || st;
  }
  function toast(msg, tone) {
    if (window.KOLINDEX_UI && typeof window.KOLINDEX_UI.toast === 'function') {
      window.KOLINDEX_UI.toast(msg, tone || 'ok');
      return;
    }
    var note = $('fleetNote');
    if (note) note.textContent = msg;
  }
  function pushLog(arr, text, cap) {
    arr.unshift({ at: nowIso(), text: text });
    if (arr.length > (cap || 40)) arr.length = cap || 40;
  }
  function visible() {
    return document.body.getAttribute('data-topic') === 'seat';
  }

  function blankAgents() {
    return AGENT_DEFS.map(function (d) {
      return {
        id: d.id,
        name: d.name,
        role: d.role,
        skills: d.skills.slice(),
        mcps: d.mcps.slice(),
        hue: d.hue,
        state: 'idle',
        inbox: [],
        current: null,
        done: 0,
        failed: 0,
        log: [],
        space: 'seat/' + d.id.toLowerCase()
      };
    });
  }

  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        jobs: S.jobs.slice(0, 40),
        children: S.children.slice(0, 120),
        agents: S.agents,
        manager: S.manager,
        auto: S.auto,
        seq: S.seq,
        selected: S.selected,
        at: S.at
      }));
    } catch (e) { /* ignore quota */ }
  }

  function restore() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return false;
      var d = JSON.parse(raw);
      if (!d || !Array.isArray(d.agents) || !d.agents.length) return false;
      S.jobs = d.jobs || [];
      S.children = d.children || [];
      S.agents = d.agents;
      S.manager = d.manager || S.manager;
      S.auto = d.auto !== false;
      S.seq = d.seq || S.seq;
      S.selected = d.selected || '';
      S.at = d.at || null;
      return true;
    } catch (e) {
      return false;
    }
  }

  function ensureWorld() {
    if (!S.agents.length) S.agents = blankAgents();
    if (!S.manager.log) S.manager.log = [];
  }

  /* ── 業務邏輯 ─────────────────────────────────────────── */
  function createJob(title, goal) {
    var id = ++S.seq.job;
    var job = {
      id: id,
      title: title,
      goal: goal || 'mixed',
      status: 'queued',
      createdAt: nowIso(),
      childIds: [],
      note: ''
    };
    S.jobs.unshift(job);
    pushLog(S.manager.log, '收到大任務 #' + id + '「' + title + '」', 30);
    S.manager.state = 'idle';
    S.at = nowIso();
    persist();
    paint();
    toast('已發起大任務 #' + id, 'ok');
    return job;
  }

  function pickQueuedJob() {
    for (var i = 0; i < S.jobs.length; i++) {
      if (S.jobs[i].status === 'queued') return S.jobs[i];
    }
    return null;
  }

  function findJob(id) {
    for (var i = 0; i < S.jobs.length; i++) if (S.jobs[i].id === id) return S.jobs[i];
    return null;
  }

  function findChild(id) {
    for (var i = 0; i < S.children.length; i++) if (S.children[i].id === id) return S.children[i];
    return null;
  }

  function findAgent(id) {
    for (var i = 0; i < S.agents.length; i++) if (S.agents[i].id === id) return S.agents[i];
    return null;
  }

  function agentsForSkill(skill) {
    return S.agents.filter(function (a) {
      return a.skills.indexOf(skill) !== -1;
    });
  }

  function managerTick() {
    var m = S.manager;
    if (m.state === 'idle' || m.state === 'done') {
      var job = pickQueuedJob();
      if (!job) {
        m.state = 'idle';
        m.focusJobId = null;
        return;
      }
      m.focusJobId = job.id;
      m.state = 'analyzing';
      job.status = 'analyzing';
      pushLog(m.log, '分析 #' + job.id + ' · 目標 ' + job.goal, 30);
      return;
    }

    var focus = m.focusJobId ? findJob(m.focusJobId) : null;
    if (!focus) {
      m.state = 'idle';
      return;
    }

    if (m.state === 'analyzing') {
      m.state = 'splitting';
      focus.status = 'splitting';
      pushLog(m.log, '拆分 #' + focus.id + ' …', 30);
      return;
    }

    if (m.state === 'splitting') {
      var plan = SPLIT_MAP[focus.goal] || SPLIT_MAP.mixed;
      focus.childIds = [];
      plan.forEach(function (step, idx) {
        var cid = ++S.seq.child;
        var child = {
          id: cid,
          jobId: focus.id,
          label: step.label,
          skill: step.skill,
          mcp: step.mcp,
          status: 'queued',
          seat: null,
          order: idx + 1,
          createdAt: nowIso(),
          startedAt: null,
          finishedAt: null,
          result: null
        };
        S.children.unshift(child);
        focus.childIds.push(cid);
      });
      focus.status = 'dispatching';
      m.state = 'dispatching';
      pushLog(m.log, '已拆 ' + plan.length + ' 子任務 · #' + focus.id, 30);
      return;
    }

    if (m.state === 'dispatching') {
      if (!S.auto) return;
      var pending = S.children.filter(function (c) {
        return c.jobId === focus.id && c.status === 'queued';
      });
      if (!pending.length) {
        var still = S.children.some(function (c) {
          return c.jobId === focus.id && (c.status === 'assigned' || c.status === 'claimed' || c.status === 'running');
        });
        if (!still) {
          focus.status = 'done';
          m.state = 'idle';
          m.focusJobId = null;
          pushLog(m.log, '大任務 #' + focus.id + ' 子任務已全部結束', 30);
        } else {
          m.state = 'watching';
          focus.status = 'running';
        }
        return;
      }
      var next = pending[pending.length - 1]; /* 先進先派：陣列 unshift，取尾 */
      var cands = agentsForSkill(next.skill).filter(function (a) {
        return a.state === 'idle' && !a.current;
      });
      if (!cands.length) {
        pushLog(m.log, '等待技能「' + skillLabel(next.skill) + '」空席…', 30);
        return;
      }
      var seat = cands[0];
      next.status = 'assigned';
      next.seat = seat.id;
      seat.inbox.push(next.id);
      seat.state = 'idle';
      pushLog(m.log, '派 #' + next.id + ' → ' + seat.id + '（' + skillLabel(next.skill) + '）', 30);
      pushLog(seat.log, '收到子任務 #' + next.id + ' · ' + next.label, 24);
    }

    if (m.state === 'watching') {
      var open = S.children.some(function (c) {
        return c.jobId === focus.id && c.status !== 'done' && c.status !== 'failed';
      });
      if (!open) {
        focus.status = 'done';
        m.state = 'idle';
        m.focusJobId = null;
        pushLog(m.log, '大任務 #' + focus.id + ' 完成', 30);
      }
    }
  }

  function agentTick() {
    S.agents.forEach(function (a) {
      if (a.current) {
        var ch = findChild(a.current);
        if (!ch) {
          a.current = null;
          a.state = 'idle';
          return;
        }
        var started = Date.parse(ch.startedAt || ch.createdAt);
        var need = 3500 + (ch.order || 1) * 400;
        if (Date.now() - started < need) {
          a.state = 'running';
          ch.status = 'running';
          return;
        }
        ch.status = 'done';
        ch.finishedAt = nowIso();
        ch.result = '以技能 ' + skillLabel(ch.skill) + '／MCP ' + mcpLabel(ch.mcp) + ' 完成';
        a.done += 1;
        a.current = null;
        a.state = 'idle';
        pushLog(a.log, '完成 #' + ch.id + ' · ' + ch.label, 24);
        return;
      }

      if (!a.inbox.length) {
        a.state = 'idle';
        return;
      }
      var nid = a.inbox.shift();
      var child = findChild(nid);
      if (!child) return;
      child.status = 'running';
      child.startedAt = nowIso();
      child.seat = a.id;
      a.current = child.id;
      a.state = 'running';
      pushLog(a.log, '開始執行 #' + child.id + ' · MCP ' + mcpLabel(child.mcp), 24);
    });
  }

  function tick() {
    if (!visible() || document.hidden) return;
    managerTick();
    agentTick();
    S.at = nowIso();
    persist();
    paint();
  }

  /* ── 繪製 ─────────────────────────────────────────────── */
  function paintKpis() {
    var host = $('fleetKpis');
    if (!host) return;
    var busy = S.agents.filter(function (a) { return a.state === 'running'; }).length;
    var qJobs = S.jobs.filter(function (j) { return j.status === 'queued' || j.status === 'analyzing' || j.status === 'splitting'; }).length;
    var qChild = S.children.filter(function (c) { return c.status === 'queued' || c.status === 'assigned'; }).length;
    var doneJobs = S.jobs.filter(function (j) { return j.status === 'done'; }).length;
    var cells = [
      { k: '大任務', v: String(S.jobs.length), s: '排隊／處理中 ' + qJobs },
      { k: '經理', v: statusZh(S.manager.state), s: S.manager.focusJobId ? ('焦點 #' + S.manager.focusJobId) : '無焦點' },
      { k: '子任務', v: String(S.children.length), s: '待派／已派 ' + qChild },
      { k: '席位忙', v: busy + '/' + S.agents.length, s: (S.agents.length - busy) + ' 席空閒' },
      { k: '完成大單', v: String(doneJobs), s: '自動派席 ' + (S.auto ? '開' : '關') },
      { k: '空間', v: S.selected || '—', s: S.selected ? '已開啟獨立空間' : '點席位開啟' }
    ];
    host.innerHTML = cells.map(function (c) {
      return '<div class="fleet-kpi"><span class="fk-k">' + esc(c.k) + '</span>' +
        '<b class="fk-v">' + esc(c.v) + '</b><span class="fk-s">' + esc(c.s) + '</span></div>';
    }).join('');
    var bd = $('navSeatBd');
    if (bd) bd.textContent = busy + '/' + S.agents.length;
    var chip = $('fleetToolChip');
    if (chip) chip.textContent = '大任務 ' + S.jobs.length + ' · 席 ' + busy + '/' + S.agents.length;
  }

  function paintJobs() {
    var host = $('fleetJobList');
    if (!host) return;
    if (!S.jobs.length) {
      host.innerHTML = '<li class="ft-empty">尚無大任務 · 上方發起</li>';
      return;
    }
    host.innerHTML = S.jobs.slice(0, 16).map(function (j) {
      return '<li class="fp-row is-' + esc(j.status) + '" data-job="' + j.id + '">' +
        '<span class="fp-id">#' + j.id + '</span>' +
        '<span class="fp-main">' +
          '<span class="fp-title">' + esc(j.title) + '</span>' +
          '<span class="fp-meta">' + esc(j.goal) + ' · ' + esc(statusZh(j.status)) + ' · ' + esc(rel(j.createdAt)) +
          (j.childIds && j.childIds.length ? (' · 子 ' + j.childIds.length) : '') +
          '</span>' +
        '</span></li>';
    }).join('');
  }

  function paintManager() {
    var st = $('fleetMgrState');
    if (st) st.textContent = statusZh(S.manager.state);
    var skills = $('fleetMgrSkills');
    if (skills) {
      skills.innerHTML = S.manager.skills.map(function (id) {
        return '<span class="chip-mini">' + esc(skillLabel(id)) + '</span>';
      }).join('');
    }
    var log = $('fleetMgrLog');
    if (log) {
      var latest = S.manager.log[0];
      log.textContent = latest ? (rel(latest.at) + ' · ' + latest.text) : '等待用戶大任務…';
    }
    var host = $('fleetChildList');
    if (!host) return;
    var list = S.children.slice(0, 24);
    if (!list.length) {
      host.innerHTML = '<li class="ft-empty">尚未拆分</li>';
      return;
    }
    host.innerHTML = list.map(function (c) {
      return '<li class="fp-row is-' + esc(c.status) + '">' +
        '<span class="fp-id">#' + c.id + '</span>' +
        '<span class="fp-main">' +
          '<span class="fp-title">' + esc(c.label) + '</span>' +
          '<span class="fp-meta">大單 #' + c.jobId + ' · ' + esc(skillLabel(c.skill)) +
          ' · ' + esc(c.seat || '未派') + ' · ' + esc(statusZh(c.status)) + '</span>' +
        '</span></li>';
    }).join('');
  }

  function paintAgents() {
    var host = $('fleetSeats');
    if (!host) return;
    host.innerHTML = S.agents.map(function (a) {
      var sel = S.selected === a.id;
      var cur = a.current ? findChild(a.current) : null;
      var line = cur ? ('執行 #' + cur.id + ' · ' + cur.label) : (a.inbox.length ? ('收件匣 ' + a.inbox.length) : '空閒');
      return '<button type="button" class="fs-card is-' + (a.state === 'running' ? 'busy' : 'ok') +
        (sel ? ' is-sel' : '') + '" data-seat="' + esc(a.id) + '" data-hue="' + a.hue + '" aria-pressed="' + (sel ? 'true' : 'false') + '">' +
        '<div class="fs-top">' +
          '<span class="fs-badge">' + esc(a.id) + '</span>' +
          '<b class="fs-id">' + esc(a.name) + '</b>' +
          '<span class="fs-dot"></span><span class="fs-state">' + esc(statusZh(a.state)) + '</span>' +
        '</div>' +
        '<div class="fs-kind">' + esc(a.role) + '</div>' +
        '<div class="fs-tags">' +
          a.skills.slice(0, 2).map(function (s) { return '<i>' + esc(skillLabel(s)) + '</i>'; }).join('') +
          a.mcps.slice(0, 1).map(function (m) { return '<i class="mcp">' + esc(mcpLabel(m)) + '</i>'; }).join('') +
        '</div>' +
        '<div class="fs-log">' + esc(line) + '</div>' +
        '<div class="fs-meta">完成 ' + a.done + ' · 失敗 ' + a.failed + ' · 匣 ' + a.inbox.length + '</div>' +
      '</button>';
    }).join('');
  }

  function paintSpace() {
    var box = $('fleetSpace');
    if (!box) return;
    if (!S.selected) {
      box.hidden = true;
      return;
    }
    var a = findAgent(S.selected);
    if (!a) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    var nm = $('fspName');
    var role = $('fspRole');
    if (nm) nm.textContent = a.id + ' · ' + a.name;
    if (role) role.textContent = a.role + ' · 空間 ' + a.space;
    var sk = $('fspSkills');
    if (sk) {
      sk.innerHTML = a.skills.map(function (id) {
        return '<li><b>' + esc(skillLabel(id)) + '</b><span>' + esc(id) + '</span></li>';
      }).join('');
    }
    var mp = $('fspMcps');
    if (mp) {
      mp.innerHTML = a.mcps.map(function (id) {
        return '<li><b>' + esc(mcpLabel(id)) + '</b><span>獨立埠 · 不可跨席共用 session</span></li>';
      }).join('');
    }
    var tasks = $('fspTasks');
    if (tasks) {
      var own = S.children.filter(function (c) {
        return c.seat === a.id || a.inbox.indexOf(c.id) !== -1 || a.current === c.id;
      }).slice(0, 20);
      if (!own.length) tasks.innerHTML = '<li class="ft-empty">此席任務列表為空</li>';
      else {
        tasks.innerHTML = own.map(function (c) {
          return '<li class="fp-row is-' + esc(c.status) + '">' +
            '<span class="fp-id">#' + c.id + '</span>' +
            '<span class="fp-main"><span class="fp-title">' + esc(c.label) + '</span>' +
            '<span class="fp-meta">' + esc(statusZh(c.status)) + ' · ' + esc(skillLabel(c.skill)) + '</span></span></li>';
        }).join('');
      }
    }
    var lg = $('fspLog');
    if (lg) {
      if (!a.log.length) lg.innerHTML = '<li class="ft-empty">尚無日誌</li>';
      else {
        lg.innerHTML = a.log.slice(0, 16).map(function (row) {
          return '<li class="fp-row"><span class="fp-id">' + esc(rel(row.at)) + '</span>' +
            '<span class="fp-main"><span class="fp-title">' + esc(row.text) + '</span></span></li>';
        }).join('');
      }
    }
  }

  function paintChrome() {
    var live = $('fleetLive');
    var note = $('fleetNote');
    var auto = $('fleetAuto');
    if (live) {
      live.textContent = '編排模擬';
      live.className = 'fleet-live is-ok';
    }
    if (note) {
      note.textContent = '用戶大任務 → 任務經理 → 席位獨立空間 · 上次 ' + rel(S.at);
    }
    if (auto) auto.checked = !!S.auto;
    var hint = $('fleetSelHint');
    if (hint) hint.textContent = S.selected ? ('空間 ' + S.selected) : '點席位開啟獨立空間';
  }

  function boardStateForJob(st) {
    if (st === 'queued') return 'queued';
    if (st === 'analyzing' || st === 'splitting' || st === 'dispatching' || st === 'running') return 'running';
    if (st === 'done') return 'done';
    if (st === 'failed') return 'failed';
    return 'queued';
  }
  function boardStateForChild(st) {
    if (st === 'queued') return 'queued';
    if (st === 'assigned' || st === 'claimed') return 'blocked';
    if (st === 'running') return 'running';
    if (st === 'done') return 'done';
    if (st === 'failed') return 'failed';
    return 'queued';
  }

  /* 匯出給任務佇列／任務看板 */
  function boardItems() {
    var out = [];
    S.jobs.forEach(function (j) {
      if (j.status === 'done' && Date.now() - Date.parse(j.createdAt) > 3600000) return;
      out.push({
        board: 'agent-job',
        state: boardStateForJob(j.status),
        ref: 'J-' + j.id,
        title: j.title,
        detail: '大任務 · ' + j.goal + ' · ' + statusZh(j.status) +
          (j.childIds && j.childIds.length ? (' · 子 ' + j.childIds.length) : ''),
        error: '',
        source: 'seat-agent',
        jobId: j.id
      });
    });
    S.children.forEach(function (c) {
      if (c.status === 'done' && c.finishedAt && Date.now() - Date.parse(c.finishedAt) > 1800000) return;
      out.push({
        board: 'seat',
        state: boardStateForChild(c.status),
        ref: 'C-' + c.id,
        title: c.label + (c.seat ? (' · ' + c.seat) : ''),
        detail: '大單 #' + c.jobId + ' · ' + skillLabel(c.skill) + ' · MCP ' + mcpLabel(c.mcp),
        error: c.status === 'failed' ? (c.result || '失敗') : '',
        source: 'seat-agent',
        seat: c.seat || '',
        skill: c.skill,
        childId: c.id,
        jobId: c.jobId
      });
    });
    return out;
  }

  function snapshot() {
    return {
      at: S.at,
      auto: S.auto,
      manager: {
        id: S.manager.id,
        state: S.manager.state,
        focusJobId: S.manager.focusJobId,
        log: (S.manager.log && S.manager.log[0] && S.manager.log[0].text) || ''
      },
      jobs: S.jobs,
      children: S.children,
      agents: S.agents.map(function (a) {
        var cur = a.current ? findChild(a.current) : null;
        return {
          id: a.id,
          name: a.name,
          role: a.role,
          state: a.state === 'running' ? 'busy' : 'ready',
          lane: (a.skills && a.skills[0]) || '',
          skills: a.skills,
          mcps: a.mcps,
          done: a.done,
          failed: a.failed,
          inbox: a.inbox.length,
          current: cur ? { id: cur.id, label: cur.label, kind: cur.skill } : null
        };
      }),
      items: boardItems(),
      tickMs: TICK_MS
    };
  }

  function notifyBoard() {
    var ui = window.KOLINDEX_UI;
    if (ui && typeof ui.setSeatBoard === 'function') {
      try { ui.setSeatBoard(snapshot()); } catch (e) { /* ignore */ }
    }
  }

  function paint() {
    paintKpis();
    paintJobs();
    paintManager();
    paintAgents();
    paintSpace();
    paintChrome();
    notifyBoard();
  }

  /* ── 互動 ─────────────────────────────────────────────── */
  function selectSeat(id) {
    S.selected = S.selected === id ? '' : id;
    persist();
    paint();
  }

  function bind() {
    var form = $('fleetJobForm');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var titleEl = $('fleetJobTitle');
        var goalEl = $('fleetJobGoal');
        var title = titleEl && titleEl.value ? titleEl.value.trim() : '';
        if (!title) {
          toast('請填大任務標題', 'err');
          return;
        }
        createJob(title, goalEl ? goalEl.value : 'mixed');
        if (titleEl) titleEl.value = '';
      });
    }
    var auto = $('fleetAuto');
    if (auto) {
      auto.addEventListener('change', function () {
        S.auto = !!auto.checked;
        if (S.manager.state === 'idle' && S.auto) {
          /* 讓 watching／dispatching 恢復 */
          var focus = S.jobs.filter(function (j) {
            return j.status === 'dispatching' || j.status === 'running';
          })[0];
          if (focus) {
            S.manager.focusJobId = focus.id;
            S.manager.state = 'dispatching';
          }
        }
        persist();
        toast(S.auto ? '自動派席已開' : '自動派席已關', 'ok');
        paint();
      });
    }
    var rf = $('fleetRefresh');
    if (rf) rf.addEventListener('click', function () { paint(); toast('已重整畫面', 'ok'); });
    var seats = $('fleetSeats');
    if (seats) {
      seats.addEventListener('click', function (e) {
        var card = e.target.closest('[data-seat]');
        if (!card) return;
        selectSeat(card.getAttribute('data-seat'));
      });
    }
    var close = $('fspClose');
    if (close) close.addEventListener('click', function () { selectSeat(S.selected); });
  }

  function boot() {
    if (!$('fleet')) return;
    var fresh = !restore();
    if (fresh) S.agents = blankAgents();
    ensureWorld();
    if (fresh && !S.jobs.length) {
      createJob('示範：核對公開帳號候選與素材缺口', 'mixed');
    }
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

  window.KOLINDEX_SEATS = {
    version: '2.1.0',
    state: S,
    createJob: createJob,
    paint: paint,
    selectSeat: selectSeat,
    skillLabel: skillLabel,
    mcpLabel: mcpLabel,
    statusZh: statusZh,
    rel: rel,
    boardItems: boardItems,
    snapshot: snapshot,
    notifyBoard: notifyBoard,
    /* 相容舊呼叫 */
    load: function () { paint(); return Promise.resolve(S); },
    run: function () {
      createJob('手動補派巡檢', 'ops');
    },
    setAuto: function (on) {
      S.auto = !!on;
      persist();
      paint();
    }
  };
})();
