/* 示範／離線假資料。
   - ?demo=1：index2 佇列／席位示範動畫會讀這份
   - 各模組 API 失敗時也可回退（明確標「示範」），不寫入真實庫 */
(function () {
  'use strict';

  function hoursAgo(h) {
    return new Date(Date.now() - h * 3600 * 1000).toISOString();
  }
  function minsAgo(m) {
    return new Date(Date.now() - m * 60 * 1000).toISOString();
  }

  var FIX = {
    tasks: [
      {id:'Q-121',title:'公開帳號候選複核（3 人）',pri:'p0',priLabel:'P0',lane:'queue',role:'審核席',
       sensors:['TXT-SEE','CTX-WIN'],tags:[{t:'處理',c:'t-proc'},{t:'需 審核席',c:''}],
       meta:'J-101·拆分 · <b>SLA 4m22s/6m</b>',sla:73,stamp:['等待自動拉取 <b class="warn">2m14s</b>','匹配席位 ×2']},
      {id:'Q-122',title:'素材缺口掃描 · 近 30 日',pri:'p1',priLabel:'P1',lane:'queue',role:'分析席',
       sensors:['CTX-WIN'],tags:[{t:'分析',c:'t-anlz'},{t:'需 分析席',c:''}],
       meta:'J-102 · <b>SLA 1m08s/12m</b>',sla:9,stamp:['等待自動拉取 <b>0m48s</b>','匹配席位 ×3']},
      {id:'Q-124',title:'巡檢報告版型生成',pri:'p2',priLabel:'P2',lane:'queue',role:'報告席',
       sensors:[],tags:[{t:'席位生成',c:'t-seat'},{t:'需 報告席',c:''}],
       meta:'J-103 · <b>SLA 30m</b>',sla:2,stamp:['等待自動拉取 <b>0m12s</b>','匹配席位 ×1']},
      {id:'Q-119',title:'OSS 探查結果彙整',pri:'p1',priLabel:'P1',lane:'wait',role:'分析席',
       sensors:['CTX-CMP'],tags:[{t:'待空檔',c:'t-wait'},{t:'A1 已拉取',c:''}],
       meta:'排位 <b>#1</b> · 等空檔 · 預估 3s',waitPct:35,stamp:['拉取 <b>A1 · 探查席</b>','lock 生效']},
      {id:'Q-126',title:'磁碟容量巡檢',pri:'p2',priLabel:'P2',lane:'wait',role:'工業席',
       sensors:[],tags:[{t:'待空檔',c:'t-wait'},{t:'A6 已拉取',c:''}],
       meta:'排位 <b>#2</b> · 預估 9s',waitPct:18,stamp:['拉取 <b>A6 · 磁碟席</b>','繼承 SLA 15m']},
      {id:'Q-118',title:'人物主檔時間軸對帳',pri:'p0',priLabel:'P0',lane:'proc',role:'工業席',
       sensors:['CTX-WIN'],tags:[{t:'執行中',c:'t-proc'},{t:'席位 A3',c:''}],
       meta:'A3 · 複核席 · call 中',progress:68,stamp:['進度 <b>68%</b>','剩 2m10s']},
      {id:'Q-120',title:'事件候選人工確認',pri:'p1',priLabel:'P1',lane:'proc',role:'審核席',
       sensors:['CTX-CMP'],tags:[{t:'執行中',c:'t-proc'},{t:'將再分拆',c:'t-split'}],
       meta:'A3 · 審核 · 子任務 ×2',progress:31,stamp:['進度 <b>31%</b>','剩 5m44s']},
      {id:'Q-117',title:'綜合拆分 → 回注子任務',pri:'p1',priLabel:'P1',lane:'split',role:'工業席',
       sensors:['CTX-CMP'],tags:[{t:'再分拆',c:'t-split'},{t:'槽位已釋放',c:''}],
       meta:'C-1001 / C-1002 / C-1003 已入列',progress:100,stamp:['<b style="color:var(--violet)">回注完成</b>','深度 +3']},
      {id:'Q-116',title:'報告渲染席 · 動態擴編',pri:'p2',priLabel:'P2',lane:'gen',role:'報告席',
       sensors:[],tags:[{t:'席位生成',c:'t-seat'},{t:'不佔槽位',c:''}],
       meta:'席位池示範',progress:100,stamp:['席位池 <b>8/8</b>','回收 0']},
      {id:'Q-110',title:'審計日誌抽樣完成',pri:'p2',priLabel:'P2',lane:'done',role:'審計席',
       sensors:[],tags:[{t:'完成',c:'t-done'}],
       meta:'今日 24 筆',progress:100,stamp:['完成','耗時 1.2s']}
    ],
    seats: [
      {id:'S-03',role:'工業席',color:'var(--amber)',task:'Q-118',status:'run',statusLabel:'執行中',pill:'amber',slot:'A1',prog:68,tok:'12.4K'},
      {id:'S-24',role:'分析席',color:'var(--cyan)',task:'Q-119',status:'wait',statusLabel:'待空檔',pill:'or',slot:'#1',prog:0,tok:'—'},
      {id:'S-28',role:'審核席',color:'var(--violet)',task:'Q-120',status:'run',statusLabel:'執行中',pill:'vi',slot:'B2',prog:31,tok:'2.4K'},
      {id:'S-15',role:'工業席',color:'var(--amber)',task:'Q-126',status:'wait',statusLabel:'待空檔',pill:'or',slot:'#2',prog:0,tok:'—'},
      {id:'S-GEN-07',role:'渲染席',color:'var(--violet)',task:'Q-116',status:'gen',statusLabel:'動態生成',pill:'vi',slot:'—',prog:12,tok:'0.8K'},
      {id:'S-62',role:'工業席',color:'var(--red)',task:'Q-121',status:'lock',statusLabel:'鎖定·guard',pill:'red',slot:'—',prog:0,tok:'—'}
    ],
    locks: [
      {seat:'S-03',color:'var(--amber)',li1:'Q-118 · 執行中 · 槽位 A1',li2:['工業席','心跳 3s','68%'],ttl:372,max:900},
      {seat:'S-24',color:'var(--orange)',li1:'Q-119 · 待空檔 #1',li2:['分析席','已拉取','排位 1'],ttl:185,max:900},
      {seat:'S-28',color:'var(--red)',li1:'Q-120 · 執行中 · 槽位 B2',li2:['審核席','心跳 11s','31%'],ttl:42,max:900}
    ],
    alerts: [
      {id:'al-1',tone:'or',icon:'i-slot',title:'席位收件匣堆積',desc:'3 子任務待空席 · 平均等待 4.2s',time:'剛剛'},
      {id:'al-2',tone:'amber',icon:'i-lock',title:'控制面未連線',desc:'人物／審核改讀示範資料',time:'2m'},
      {id:'al-3',tone:'red',icon:'i-warn',title:'P0 接近 SLA',desc:'Q-121 待拉取 · SLA 4m22s/6m',time:'14m'},
      {id:'al-4',tone:'cyan',icon:'i-pulse',title:'感測關鍵詞上升',desc:'「聯名」近時 hits +12%',time:'21m'}
    ],
    slots: [
      {id:'A1',state:'busy',who:'S-03·Q-118',ttl:210,max:360,reserve:false},
      {id:'A2',state:'busy',who:'S-28·Q-120',ttl:280,max:360,reserve:false},
      {id:'A3',state:'busy',who:'A3·複核',ttl:95,max:360,reserve:false},
      {id:'A4',state:'busy',who:'A1·探查',ttl:310,max:360,reserve:false},
      {id:'B1',state:'busy',who:'A7·審計',ttl:150,max:360,reserve:false},
      {id:'B2',state:'busy',who:'A2·素材',ttl:240,max:360,reserve:false},
      {id:'B3',state:'free',who:null,ttl:0,max:360,reserve:false},
      {id:'B4',state:'free',who:null,ttl:0,max:360,reserve:true}
    ],
    collect: [
      {id:'C-101',title:'小紅書公開筆記摘要待歸檔',source:'xhs',pri:'p1',priLabel:'P1',role:'分析席',state:'inbox',note:'示範 · 未寫庫'},
      {id:'C-102',title:'抖音作品連結待核對',source:'douyin-api',pri:'p1',priLabel:'P1',role:'分析席',state:'inbox',note:'示範 · 未寫庫'},
      {id:'C-103',title:'Sherlock 用戶名候選待確認',source:'sherlock',pri:'p0',priLabel:'P0',role:'審核席',state:'inbox',note:'示範 · 只產候選'},
      {id:'C-104',title:'素材缺檔補抓申請',source:'library',pri:'p2',priLabel:'P2',role:'工業席',state:'queued',note:'已入列示範'},
      {id:'C-105',title:'重複帳號合併候選',source:'subjects',pri:'p1',priLabel:'P1',role:'審核席',state:'skip',note:'示範略過'}
    ],
    metrics: {
      claimRate:6.1,slotWait:4.2,split:23,thru:31,queries:1284,guardPending:1,done:18,fail:1,
      tokenUsed:128,tokenMax:200,costUsed:84,costMax:120,rpm:42,rpmMax:100,
      bill1:72,bill2:62,bill3:88,t1:14,t2:26,t3:8,t4:58,t5:5,t6:88
    },

    /* —— 人物主檔 —— */
    subjects: {
      total: 4,
      source: 'demo.subjects',
      items: [
        {
          id: 'sub_demo_01', display_name: '林澄', status: 'active',
          created_at: hoursAgo(72), updated_at: hoursAgo(2),
          coverage: { confirmed_accounts: 2, candidate_accounts: 0 },
          accounts: [
            { platform: 'douyin', external_account_id: 'lincheng_demo', display_name: 'lincheng_demo', link_status: 'confirmed' },
            { platform: 'xhs', external_account_id: 'xc_lincheng', display_name: 'xc_lincheng', link_status: 'confirmed' }
          ],
          notes: '示範人物 · 已確認雙平台'
        },
        {
          id: 'sub_demo_02', display_name: '阿北工作室', status: 'active',
          created_at: hoursAgo(120), updated_at: hoursAgo(8),
          coverage: { confirmed_accounts: 1, candidate_accounts: 0 },
          accounts: [
            { platform: 'bilibili', external_account_id: 'abei_studio', display_name: 'abei_studio', link_status: 'confirmed' }
          ],
          notes: '示範 · 僅 B 站'
        },
        {
          id: 'sub_demo_03', display_name: 'Momo Travel', status: 'review',
          created_at: hoursAgo(30), updated_at: hoursAgo(1),
          coverage: { confirmed_accounts: 0, candidate_accounts: 2 },
          accounts: [
            { platform: 'youtube', external_account_id: 'momotravel', display_name: 'momotravel', link_status: 'candidate' },
            { platform: 'douyin', external_account_id: 'momo_dy', display_name: 'momo_dy', link_status: 'candidate' }
          ],
          notes: '示範 · 帳號待確認'
        },
        {
          id: 'sub_demo_04', display_name: '夜航電台', status: 'active',
          created_at: hoursAgo(200), updated_at: hoursAgo(12),
          coverage: { confirmed_accounts: 1, candidate_accounts: 0 },
          accounts: [
            { platform: 'weibo', external_account_id: 'yehang_fm', display_name: 'yehang_fm', link_status: 'confirmed' }
          ],
          notes: '示範'
        }
      ]
    },

    /* —— 素材庫 —— */
    library: {
      total: 6,
      counts: { all: 6, gallery: 3, video: 3, likes: 2, favorites: 2, files: 28, bytes: 43000000, authors: 4 },
      sources: { likes: 2, favorites: 2, other: 2 },
      source: 'demo.library',
      items: [
        { id: 'lib_d1', caption: '聯名開箱圖集', author: 'lincheng_demo', kind: 'gallery', sources: ['likes'],
          images: 12, bytes: 4800000, ct: Math.round(Date.now() / 1000) - 20 * 3600, cover: '', hasLocal: true },
        { id: 'lib_d2', caption: '直播預告 30s', author: 'lincheng_demo', kind: 'video', sources: ['favorites'],
          images: 0, bytes: 12000000, ct: Math.round(Date.now() / 1000) - 40 * 3600, cover: '', hasLocal: true },
        { id: 'lib_d3', caption: '幕後花絮剪輯', author: 'abei_studio', kind: 'video', sources: ['likes'],
          images: 0, bytes: 22000000, ct: Math.round(Date.now() / 1000) - 60 * 3600, cover: '', hasLocal: false },
        { id: 'lib_d4', caption: '包裝細節圖', author: 'abei_studio', kind: 'gallery', sources: ['folder'],
          images: 8, bytes: 3100000, ct: Math.round(Date.now() / 1000) - 80 * 3600, cover: '', hasLocal: true },
        { id: 'lib_d5', caption: '機場 Vlog', author: 'momo_dy', kind: 'video', sources: ['favorites'],
          images: 0, bytes: 0, ct: Math.round(Date.now() / 1000) - 10 * 3600, cover: '', hasLocal: false },
        { id: 'lib_d6', caption: '電台週報圖', author: 'yehang_fm', kind: 'gallery', sources: ['likes'],
          images: 4, bytes: 900000, ct: Math.round(Date.now() / 1000) - 5 * 3600, cover: '', hasLocal: true }
      ]
    },
    authors: {
      total: 4,
      source: 'demo.authors',
      items: [
        { author: 'lincheng_demo', name: '林澄', count: 42, works: 42, files: 120, bytes: 2100000000, gallery: 20, video: 22, lastCt: Math.round(Date.now() / 1000) - 2 * 3600, platform: 'douyin' },
        { author: 'abei_studio', name: '阿北工作室', count: 18, works: 18, files: 40, bytes: 900000000, gallery: 8, video: 10, lastCt: Math.round(Date.now() / 1000) - 8 * 3600, platform: 'bilibili' },
        { author: 'momo_dy', name: 'Momo Travel', count: 9, works: 9, files: 12, bytes: 400000000, gallery: 2, video: 7, lastCt: Math.round(Date.now() / 1000) - 10 * 3600, platform: 'douyin' },
        { author: 'yehang_fm', name: '夜航電台', count: 27, works: 27, files: 55, bytes: 300000000, gallery: 24, video: 3, lastCt: Math.round(Date.now() / 1000) - 12 * 3600, platform: 'weibo' }
      ]
    },

    /* —— 審核 —— */
    review: {
      items: [
        { id: 'rv_d1', kind: 'identity', state: 'open', display_name: 'Momo Travel',
          accounts: [{ platform: 'youtube', handle: 'momotravel' }, { platform: 'douyin', handle: 'momo_dy' }],
          created_at: hoursAgo(6), payload: { brand: '帳號歸戶' } },
        { id: 'rv_d2', kind: 'relation', state: 'open', display_name: '林澄 × 阿北工作室',
          accounts: [], created_at: hoursAgo(14), payload: { brand: '同框候選' } },
        { id: 'rv_d3', kind: 'identity', state: 'done', display_name: '林澄',
          accounts: [{ platform: 'xhs', handle: 'xc_lincheng' }], created_at: hoursAgo(48), payload: {} }
      ],
      counts: { open: 2, done: 1, all: 3, total: 3, ai_open: 2 }
    },
    aiEvents: {
      items: [
        { id: 'ai_d1', kind: 'brand_risk', severity: 3, state: 'open', person_id: 'sub_demo_01',
          display_name: '林澄', summary: '留言出現重複性負面敘事（示範候選）',
          confidence: 0.82, created_at: hoursAgo(3), evidence_ids: ['post_demo_1'] },
        { id: 'ai_d2', kind: 'coverage_gap', severity: 2, state: 'open', person_id: 'sub_demo_02',
          display_name: '阿北工作室', summary: '近 14 日公開作品入庫缺口（示範）',
          confidence: 0.71, created_at: hoursAgo(9), evidence_ids: ['post_demo_2'] }
      ]
    },
    audit: {
      items: [
        { id: 'aud_d1', action: 'subject.create', actor: 'demo-op', at: hoursAgo(72), detail: '建立 林澄' },
        { id: 'aud_d2', action: 'account.confirm', actor: 'demo-op', at: hoursAgo(70), detail: '確認 douyin/lincheng_demo' },
        { id: 'aud_d3', action: 'review.decide', actor: 'demo-rev', at: hoursAgo(48), detail: '通過歸戶候選' },
        { id: 'aud_d4', action: 'seat.dispatch', actor: 'TM-00', at: minsAgo(12), detail: '派 C-1002 → A2' }
      ]
    },

    /* —— 產出 —— */
    outputs: [
      {id:'ART-014',title:'巡檢摘要 v2',by:'Q-118',cite:'Q-120',from:'',folder:'巡檢',lang:'md',name:'巡檢摘要 v2.md',note:'示範產物',body:'# 巡檢摘要 v2\n\n示範資料。不寫真實庫。\n\n- 編號：ART-014\n- 產出：Q-118\n'},
      {id:'ART-009',title:'門檻複核稿 v1',by:'Q-120',cite:'',from:'',folder:'門檻',lang:'md',name:'門檻複核稿 v1.md',note:'示範',body:'# 門檻複核稿 v1\n\n示範資料。\n'},
      {id:'ART-021',title:'閥位調整候選',by:'Q-121',cite:'',from:'',folder:'閥位',lang:'json',name:'閥位調整候選.json',note:'候選不執行',body:'{\n  "id": "ART-021",\n  "status": "candidate",\n  "demo": true\n}\n'},
      {id:'ART-030',title:'人物主檔摘錄 · 林澄',by:'J-101',cite:'',from:'',folder:'人物',lang:'md',name:'人物主檔摘錄-林澄.md',note:'示範',body:'# 林澄\n\n- 主檔：sub_demo_01\n- 平台：抖音、小紅書（已確認）\n- 來源：示範 fixtures\n'},
      {id:'ART-031',title:'素材缺口清單',by:'J-102',cite:'',from:'',folder:'素材',lang:'json',name:'素材缺口清單.json',note:'示範',body:'{\n  "author": "abei_studio",\n  "missingDays": 14,\n  "demo": true\n}\n'}
    ],

    /* —— 席位大任務種子 —— */
    seatJobs: [
      { title: '核對三位 KOL 的公開帳號與素材缺口', goal: 'mixed' },
      { title: '本週合規審計抽樣', goal: 'audit' },
      { title: '抖音／小紅書帳號發現', goal: 'discover' }
    ],

    /* —— 系統／健康示意 —— */
    rail: {
      diskUsedPct: 62, diskFreeGb: 418, queueDepth: 7, seatsBusy: 3, seatsTotal: 8,
      source: 'demo.rail'
    },
    health: {
      items: [
        { id: 'web', ok: true, label: '網頁', detail: '示範' },
        { id: 'postgres', ok: false, label: 'PostgreSQL', detail: '未連線 · 示範' },
        { id: 'meili', ok: false, label: 'Meilisearch', detail: '未連線 · 示範' },
        { id: 'control', ok: false, label: '控制面', detail: '未連線 · 示範' },
        { id: 'api', ok: false, label: 'kolindex-api', detail: '未連線 · 示範' }
      ]
    }
  };

  function clone(v) {
    try { return JSON.parse(JSON.stringify(v)); }
    catch (e) { return v; }
  }

  window.KOL_FIXTURES = FIX;
  window.KOL_demoFallback = function (key) {
    if (!FIX || FIX[key] == null) return null;
    return clone(FIX[key]);
  };
  window.KOL_isDemoAttr = function () {
    return document.documentElement.getAttribute('data-demo') === '1';
  };
})();
