/* 示範資料。只有 html[data-demo="1"]（網址 ?demo=1）會用到。真資料畫面不讀這份。 */
window.KOL_FIXTURES = {
  tasks: [
    {id:'Q-121',title:'V-22 閥開度調整（62%→54%）並複核回饋',pri:'p0',priLabel:'P0',lane:'queue',role:'工業席',
     sensors:['TXT-SEE','CTX-WIN'],tags:[{t:'處理',c:'t-proc'},{t:'需 工業席',c:''},{t:'行動候選',c:''}],
     meta:'T-2841·M3 · <b>SLA 4m22s/6m</b> · 保留槽位可搶',sla:73,stamp:['等待自動拉取 <b class="warn">2m14s</b>','匹配席位 ×2']},
    {id:'Q-122',title:'TT-101／PT-207 異常門檻再校準',pri:'p1',priLabel:'P1',lane:'queue',role:'分析席',
     sensors:['CTX-WIN','CTX-CMP'],tags:[{t:'分析',c:'t-anlz'},{t:'需 分析席',c:''}],
     meta:'T-2841·M2 · <b>SLA 1m08s/12m</b>',sla:9,stamp:['等待自動拉取 <b>0m48s</b>','匹配席位 ×3']},
    {id:'Q-124',title:'巡檢報告版型生成功能席',pri:'p2',priLabel:'P2',lane:'queue',role:'報告席',
     sensors:[],tags:[{t:'席位生成',c:'t-seat'},{t:'需 報告席',c:''}],
     meta:'T-2841·M4 · <b>SLA 30m</b>',sla:2,stamp:['等待自動拉取 <b>0m12s</b>','匹配席位 ×1']},
    {id:'Q-119',title:'M1 補採 XV-12 閥位回饋（5m 窗口）',pri:'p1',priLabel:'P1',lane:'wait',role:'分析席',
     sensors:['CTX-CMP'],tags:[{t:'待空檔',c:'t-wait'},{t:'S-24 已拉取',c:''}],
     meta:'排位 <b>#1</b> · 等 LLM 空檔 · 預估 3s',waitPct:35,stamp:['拉取 <b>S-24 · 分析席</b>','lock 生效']},
    {id:'Q-126',title:'泵浦效率比對（Q-117 子任務）',pri:'p2',priLabel:'P2',lane:'wait',role:'工業席',
     sensors:[],tags:[{t:'待空檔',c:'t-wait'},{t:'S-15 已拉取',c:''}],
     meta:'排位 <b>#2</b> · 等 LLM 空檔 · 預估 9s',waitPct:18,stamp:['拉取 <b>S-15 · 工業席</b>','繼承 SLA 15m']},
    {id:'Q-118',title:'T-301 溫度趨勢分析與基準比對',pri:'p0',priLabel:'P0',lane:'proc',role:'工業席',
     sensors:['CTX-WIN'],tags:[{t:'執行中',c:'t-proc'},{t:'槽位 A1',c:''}],
     meta:'S-03 · 工業席 · 12.4K tok · call_llm 中',progress:68,stamp:['進度 <b>68%</b>','槽位剩 2m10s']},
    {id:'Q-120',title:'異常門檻判定邏輯複核',pri:'p1',priLabel:'P1',lane:'proc',role:'審核席',
     sensors:['CTX-CMP'],tags:[{t:'執行中',c:'t-proc'},{t:'將再分拆',c:'t-split'}],
     meta:'S-28 · 審核席 · 槽位 B2 · 子任務 ×2',progress:31,stamp:['進度 <b>31%</b>','槽位剩 5m44s']},
    {id:'Q-117',title:'冷卻迴路建模 → 拆 3 子任務回注',pri:'p1',priLabel:'P1',lane:'split',role:'工業席',
     sensors:['CTX-CMP'],tags:[{t:'再分拆',c:'t-split'},{t:'槽位已釋放',c:''}],
     meta:'Q-125 / Q-126 / Q-127 已入列',progress:100,stamp:['<b style="color:var(--violet)">回注完成</b>','深度 +3']},
    {id:'Q-116',title:'報表渲染席 · 動態擴編',pri:'p2',priLabel:'P2',lane:'gen',role:'報告席',
     sensors:[],tags:[{t:'席位生成',c:'t-seat'},{t:'不佔槽位',c:''}],
     meta:'S-GEN-07 已啟用 · report_render',progress:100,stamp:['席位池 <b>87/120</b>','回收 3']}
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
    {id:'al-1',tone:'or',icon:'i-slot',title:'槽位佔滿 · 待空檔排隊',desc:'3 項待空檔 · 平均等待 4.2s',time:'剛剛'},
    {id:'al-2',tone:'amber',icon:'i-lock',title:'claim lock 心跳過慢',desc:'S-28 心跳 11s · 建議重派',time:'2m'},
    {id:'al-3',tone:'red',icon:'i-warn',title:'P0 接近 SLA',desc:'Q-121 待拉取 · SLA 4m22s/6m',time:'14m'}
  ],
  slots: [
    {id:'A1',state:'busy',who:'S-03·Q-118',ttl:210,max:360,reserve:false},
    {id:'A2',state:'busy',who:'S-28·Q-120',ttl:280,max:360,reserve:false},
    {id:'A3',state:'busy',who:'S-41·Q-98',ttl:95,max:360,reserve:false},
    {id:'A4',state:'busy',who:'S-55·Q-101',ttl:310,max:360,reserve:false},
    {id:'B1',state:'busy',who:'S-07·Q-112',ttl:150,max:360,reserve:false},
    {id:'B2',state:'busy',who:'S-19·Q-105',ttl:240,max:360,reserve:false},
    {id:'B3',state:'free',who:null,ttl:0,max:360,reserve:false},
    {id:'B4',state:'free',who:null,ttl:0,max:360,reserve:true}
  ],
  collect: [
    {id:'C-101',title:'小紅書筆記摘要待歸檔',source:'xhs',pri:'p1',priLabel:'P1',role:'分析席',state:'inbox',note:'示範卡片。'},
    {id:'C-102',title:'抖音作品連結待核對',source:'douyin-api',pri:'p1',priLabel:'P1',role:'分析席',state:'inbox',note:'示範卡片。'}
  ],
  metrics: {
    claimRate:6.1,slotWait:4.2,split:23,thru:31,queries:1284,guardPending:1,done:18,fail:1,
    tokenUsed:128,tokenMax:200,costUsed:84,costMax:120,rpm:42,rpmMax:100,
    bill1:72,bill2:62,bill3:88,t1:14,t2:26,t3:8,t4:58,t5:5,t6:88
  }
};
