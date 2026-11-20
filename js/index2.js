(function(){
  'use strict';

  /* ================= utils ================= */
  function esc(s){
    return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function $(sel,root){ return (root||document).querySelector(sel); }
  function $$(sel,root){ return Array.prototype.slice.call((root||document).querySelectorAll(sel)); }
  function fmtTime(d){ var p=function(n){return String(n).padStart(2,'0');}; return p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds()); }
  var tickerJobs=[];
  function every(ms, fn, opt){
    tickerJobs.push({ms:ms, acc:0, fn:fn, clock:!!(opt&&opt.clock)});
  }
  var tickerStamp=0;
  function pumpTicker(now){
    if (!tickerStamp) tickerStamp=now;
    var dt=now-tickerStamp;
    tickerStamp=now;
    if (dt>1500) dt=1500;
    if (dt<0) dt=0;
    if (!document.hidden){
      var paused=store.paused;
      for (var i=0;i<tickerJobs.length;i++){
        var job=tickerJobs[i];
        job.acc+=dt;
        if (job.acc<job.ms) continue;
        job.acc%=job.ms;
        if (paused && !job.clock) continue;
        try { job.fn(); }
        catch (err) { if (window.console) console.error(err); }
      }
    }
    requestAnimationFrame(pumpTicker);
  }
  document.addEventListener('visibilitychange', function(){
    tickerStamp=0;
    if (!document.hidden) tickClock();
  });
  /* [P0-8] 輸入框防護 */
  function isTyping(t){
    return !!(t && (t.matches && t.matches('input,textarea,select,[contenteditable="true"]') || t.isContentEditable));
  }

  /* ================= FIXTURES ================= */
  var FIXTURES={
    tasks:[
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
    seats:[
      {id:'S-03',role:'工業席',color:'var(--amber)',task:'Q-118',status:'run',statusLabel:'執行中',pill:'amber',slot:'A1',prog:68,tok:'12.4K'},
      {id:'S-24',role:'分析席',color:'var(--cyan)',task:'Q-119',status:'wait',statusLabel:'待空檔',pill:'or',slot:'#1',prog:0,tok:'—'},
      {id:'S-28',role:'審核席',color:'var(--violet)',task:'Q-120',status:'run',statusLabel:'執行中',pill:'amber',slot:'B2',prog:31,tok:'2.4K'},
      {id:'S-15',role:'工業席',color:'var(--amber)',task:'Q-126',status:'wait',statusLabel:'待空檔',pill:'or',slot:'#2',prog:0,tok:'—'},
      {id:'S-GEN-07',role:'渲染席',color:'var(--violet)',task:'Q-116',status:'gen',statusLabel:'動態生成',pill:'vi',slot:'—',prog:12,tok:'0.8K'},
      {id:'S-62',role:'工業席',color:'var(--red)',task:'Q-121',status:'lock',statusLabel:'鎖定·guard',pill:'red',slot:'—',prog:0,tok:'—'}
    ],
    locks:[
      {seat:'S-03',color:'var(--amber)',li1:'Q-118 · 執行中 · 槽位 A1',li2:['工業席','心跳 3s','68%'],ttl:372,max:900},
      {seat:'S-24',color:'var(--orange)',li1:'Q-119 · 待空檔 #1',li2:['分析席','已拉取','排位 1'],ttl:185,max:900},
      {seat:'S-28',color:'var(--red)',li1:'Q-120 · 執行中 · 槽位 B2',li2:['審核席','心跳 11s','31%'],ttl:42,max:900}
    ],
    alerts:[
      {id:'al-1',tone:'or',icon:'i-slot',title:'槽位佔滿 · 待空檔排隊',desc:'3 項待空檔 · 平均等待 4.2s',time:'剛剛'},
      {id:'al-2',tone:'amber',icon:'i-lock',title:'claim lock 心跳過慢',desc:'S-28 心跳 11s · 建議重派',time:'2m'},
      {id:'al-3',tone:'red',icon:'i-warn',title:'P0 接近 SLA',desc:'Q-121 待拉取 · SLA 4m22s/6m',time:'14m'}
    ],
    slots:[
      {id:'A1',state:'busy',who:'S-03·Q-118',ttl:210,max:360,reserve:false},
      {id:'A2',state:'busy',who:'S-28·Q-120',ttl:280,max:360,reserve:false},
      {id:'A3',state:'busy',who:'S-41·Q-98',ttl:95,max:360,reserve:false},
      {id:'A4',state:'busy',who:'S-55·Q-101',ttl:310,max:360,reserve:false},
      {id:'B1',state:'busy',who:'S-07·Q-112',ttl:150,max:360,reserve:false},
      {id:'B2',state:'busy',who:'S-19·Q-105',ttl:240,max:360,reserve:false},
      {id:'B3',state:'free',who:null,ttl:0,max:360,reserve:false},
      {id:'B4',state:'free',who:null,ttl:0,max:360,reserve:true}
    ]
  };

  var ROLES={
    '工業席':{code:'industrial_ops',color:'var(--amber)',duty:'讀現場證據，提出調整方案',prompt:'依閥位與溫度提出現場調整，不直接寫入',cannot:'不得寫入現場，行動句只做候選',reads:'本槽壓縮稿 · 世界庫',writes:'任務庫增量',skills:'上下文壓縮 · 文本感知'},
    '分析席':{code:'analysis',color:'var(--cyan)',duty:'只讀資料，整理趨勢與門檻',prompt:'只讀感測與壓縮摘要，整理趨勢與門檻',cannot:'不得提案寫入，不得改世界庫',reads:'世界庫 · 任務庫',writes:'趨勢條目回任務庫',skills:'上下文壓縮 · 世界庫閱讀'},
    '審核席':{code:'review',color:'var(--violet)',duty:'複核成敗標準與未完成步',prompt:'複核成敗標準，不直接寫入',cannot:'不得跳過 guard，不得代工業席下達',reads:'任務庫 · 世界庫規則',writes:'複核結論',skills:'文本感知 · 任務庫回寫'},
    '報告席':{code:'report',color:'var(--green)',duty:'把已完成步驟收成報告',prompt:'把已完成步驟收成巡檢報告',cannot:'不得補寫未完成步驟，不得觸發寫入',reads:'任務庫已完成條目',writes:'報告草稿',skills:'craft-anything 草稿'},
    '渲染席':{code:'render',color:'var(--violet)',duty:'把報告草稿排成可讀版面',prompt:'只渲染已定稿內容，不新增事實',cannot:'不得改結論，不佔 LLM 槽位',reads:'報告席草稿',writes:'版面',skills:'無'}
  };
  var ROLE_ORDER=['工業席','分析席','審核席','報告席','渲染席'];
  var ROLE_PROMPT={};
  ROLE_ORDER.forEach(function(name){ ROLE_PROMPT[name]=ROLES[name].prompt; });
  var roleFilter='';
  var FLOW_SEED={
    'Q-119':{step:1,wave:1,seat:'S-24',slot:''},
    'Q-118':{step:2,wave:1,seat:'S-03',slot:'A1'},
    'Q-122':{step:3,wave:2,seat:'',slot:''},
    'Q-120':{step:4,wave:2,seat:'S-28',slot:'A2'},
    'Q-117':{step:5,wave:3,seat:'',slot:''},
    'Q-126':{step:6,wave:3,seat:'S-15',slot:''},
    'Q-121':{step:7,wave:4,seat:'',slot:''},
    'Q-124':{step:8,wave:5,seat:'',slot:''},
    'Q-116':{step:9,wave:5,seat:'S-GEN-07',slot:''}
  };
  var WAVE_NAME={1:'採集',2:'門檻',3:'分拆',4:'調整',5:'成稿'};
  var PARENT_TITLE={'T-2841':'工業區閥門巡檢與異常讀數彙報'};

  /* ================= STORE ================= */
  var store={
    tasks:FIXTURES.tasks.map(function(t){
      var seed=FLOW_SEED[t.id]||{};
      var copy=Object.assign({},t,seed,{parent:'T-2841',prompt:ROLE_PROMPT[t.role]||''});
      if (copy.lane==='split'||copy.lane==='gen') copy.departAt=Date.now()+7000;
      return copy;
    }),
    seats:FIXTURES.seats.slice(),
    locks:FIXTURES.locks.map(function(l){ return Object.assign({},l); }),
    alerts:FIXTURES.alerts.slice(),
    slots:FIXTURES.slots.map(function(s){ return Object.assign({},s); }),
    audits:[],
    paused:false, autoClaim:true, evPaused:false, lastSync:new Date(),
    metrics:{claimRate:6.1,slotWait:4.2,split:23,thru:31,queries:1284,guardPending:1,done:18,fail:1,
      tokenUsed:128,tokenMax:200,costUsed:84,costMax:120,rpm:42,rpmMax:100,
      bill1:72,bill2:62,bill3:88,t1:14,t2:26,t3:8,t4:58,t5:5,t6:88}
  };
  var tipInstances=[];
  var tipSingleton=null;
  var tipHide=function(){
    if (tipSingleton && tipSingleton.hide) tipSingleton.hide();
  };
  function hideTip(){ tipHide(); }

  /* ================= SELECTORS（所有數字/百分比唯一來源） ================= */
  function laneCount(lane){ return store.tasks.filter(function(t){ return t.lane===lane; }).length; }
  function derived(){
    var m=store.metrics;
    var slotUsed=store.slots.filter(function(s){ return s.state==='busy'; }).length;
    return {
      queueDepth:laneCount('queue'),claimedWait:laneCount('wait'),executing:laneCount('proc'),
      slotUsed:slotUsed,
      claimRate:m.claimRate,slotWait:m.slotWait,split:m.split,thru:m.thru,
      guardPending:m.guardPending,done:m.done,fail:m.fail,
      quotaToken:m.tokenUsed+'K / '+m.tokenMax+'K',
      quotaCost:'¥'+m.costUsed+' / ¥'+m.costMax,
      quotaRpm:m.rpm+' / '+m.rpmMax+' rpm',
      bars:{
        claimRate:Math.min(100,m.claimRate/8.5*100),
        queue:Math.min(100,laneCount('queue')/6*100),
        wait:Math.min(100,laneCount('wait')/8*100),
        exec:Math.min(100,laneCount('proc')/6*100),
        slot:slotUsed/8*100,
        slotWait:Math.min(100,m.slotWait/7.5*100),
        split:Math.min(100,m.split/60*100),
        thru:Math.min(100,m.thru/52*100),
        qToken:m.tokenUsed/m.tokenMax*100,
        qCost:m.costUsed/m.costMax*100,
        qRate:m.rpm/m.rpmMax*100,
        t1:m.t1,t2:m.t2,t3:m.t3,t4:m.t4,t5:m.t5,t6:m.t6,
        bill1:m.bill1,bill2:m.bill2,bill3:m.bill3
      }
    };
  }
  function motionOn(){
    return !document.body.classList.contains('reduce-motion');
  }
  function formatNum(v,decimals){
    if (decimals) return v.toFixed(decimals);
    var n=Math.round(v);
    return n>=1000?n.toLocaleString('en-US'):String(n);
  }
  function easeOutExpo(t){ return t>=1?1:(1-Math.pow(2,-10*t)); }
  function rise(el, dy, dur){
    if (!motionOn()||!el||!el.animate) return;
    el.style.animation='none';
    el.animate(
      [{transform:'translateY('+dy+'px)',opacity:0},{transform:'none',opacity:1}],
      {duration:dur,easing:'cubic-bezier(0.16, 1, 0.3, 1)',fill:'both'}
    );
  }
  function tweenText(el,nextText,nextNum,decimals){
    if (!motionOn() || nextNum==null || isNaN(nextNum)){
      el.textContent=nextText;
      if (nextNum!=null && !isNaN(nextNum)) el.dataset.n=String(nextNum);
      return;
    }
    var from=parseFloat(el.dataset.n);
    if (isNaN(from)){
      el.textContent=nextText;
      el.dataset.n=String(nextNum);
      return;
    }
    if (Math.abs(from-nextNum)<(decimals?0.05:0.5)){
      el.textContent=nextText;
      el.dataset.n=String(nextNum);
      return;
    }
    if (el._raf) cancelAnimationFrame(el._raf);
    var start=performance.now();
    function frame(now){
      var t=Math.min(1,(now-start)/560);
      var v=from+(nextNum-from)*easeOutExpo(t);
      el.dataset.n=String(v);
      el.textContent=t<1?formatNum(v,decimals):nextText;
      if (t<1) el._raf=requestAnimationFrame(frame);
      else { el.dataset.n=String(nextNum); el._raf=0; }
    }
    el._raf=requestAnimationFrame(frame);
  }
  var metricNodes={nums:[],pcts:[],counts:[],rc:null,nb:null,ls:null,gc:null,clock:null,depthDelta:null,dispTick:null,dispScan:null,dispDispatch:null,dispReclaim:null};
  function cacheMetrics(){
    metricNodes.nums=$$('[data-num]');
    metricNodes.pcts=$$('[data-pct]');
    metricNodes.counts=$$('[data-count]');
    metricNodes.rc=$('#railQueueCount');
    metricNodes.nb=$('#navQueueBd');
    metricNodes.ls=$('#lastSync');
    metricNodes.gc=$('#guardChip');
    metricNodes.clock=$('#clock');
    metricNodes.depthDelta=$('#depthDelta');
    metricNodes.dispTick=$('#dispTick');
    metricNodes.dispScan=$('#dispScan');
    metricNodes.dispDispatch=$('#dispDispatch');
    metricNodes.dispReclaim=$('#dispReclaim');
  }
  function renderNumbers(){
    if (!metricNodes.nums.length) cacheMetrics();
    var d=derived();
    var laneN={queue:0,wait:0,proc:0,split:0,gen:0};
    store.tasks.forEach(function(t){
      var k=t.exiting?t.leftFrom:t.lane;
      if (laneN[k]!==undefined) laneN[k]++;
    });
    metricNodes.nums.forEach(function(el){
      var k=el.getAttribute('data-num');
      if (d[k]===undefined) return;
      var v=d[k];
      var decimals=(k==='claimRate'||k==='slotWait')?1:0;
      var text=(typeof v==='number')?formatNum(v,decimals):String(v);
      if (typeof v==='number') tweenText(el,text,v,decimals);
      else if (el.textContent!==text) el.textContent=text;
    });
    metricNodes.pcts.forEach(function(el){
      var k=el.getAttribute('data-pct');
      if (d.bars[k]===undefined) return;
      var pct=d.bars[k].toFixed(1)+'%';
      if (el.style.getPropertyValue('--pct')!==pct) el.style.setProperty('--pct',pct);
    });
    metricNodes.counts.forEach(function(el){
      var k=el.getAttribute('data-count');
      if (laneN[k]===undefined) return;
      var text=String(laneN[k]);
      if (el.textContent!==text){ el.textContent=text; el.dataset.n=text; }
    });
    if (metricNodes.rc){
      var rail=(d.queueDepth+d.claimedWait+d.executing)+' 在列';
      if (metricNodes.rc.textContent!==rail) metricNodes.rc.textContent=rail;
    }
    if (metricNodes.nb){
      var badge=String(d.queueDepth+d.claimedWait);
      if (metricNodes.nb.textContent!==badge) metricNodes.nb.textContent=badge;
    }
    if (metricNodes.ls){
      var sync=fmtTime(store.lastSync);
      if (metricNodes.ls.textContent!==sync) metricNodes.ls.textContent=sync;
    }
    if (metricNodes.gc){
      var chip='chip '+(d.guardPending>0?'red':'green');
      if (metricNodes.gc.className!==chip) metricNodes.gc.className=chip;
    }
  }

  /* ================= RENDER：佇列卡 ================= */
  function taskCard(t){
    var lane=t.exiting?t.leftFrom:t.lane;
    var tags=(t.tags||[]).map(function(g){ return '<span class="qtag '+g.c+'">'+esc(g.t)+'</span>'; }).join('');
    var bar='';
    var prog='—';
    if (lane==='queue'){
      var sla=Math.round(t.sla||0);
      bar='<div class="slabar" role="progressbar" aria-valuenow="'+sla+'" aria-valuemin="0" aria-valuemax="100"><i data-f="bar" data-mark="'+sla+'%" style="--pct:'+sla+'%;background:linear-gradient(90deg,#8c3a30,var(--red))"></i></div>';
      prog='SLA '+sla+'% · 等待席位拉取';
    } else if (lane==='wait'){
      var waitN=Math.round(t.waitPct||0);
      bar='<div class="waitbar" role="progressbar" aria-valuenow="'+waitN+'" aria-valuemin="0" aria-valuemax="100"><i data-f="bar" data-mark="'+waitN+'%" style="--pct:'+waitN+'%"></i></div>';
      prog='等空檔 '+waitN+'%';
    } else if (t.progress!==undefined){
      var progN=Math.round(t.progress);
      bar='<div class="qbar" role="progressbar" aria-valuenow="'+progN+'" aria-valuemin="0" aria-valuemax="100"><i data-f="bar" data-mark="'+progN+'%" style="--pct:'+progN+'%"></i></div>';
      prog=progN+'%';
    }
    var btn=(lane==='queue'&&!t.exiting)?'<button class="claim-btn" data-force data-id="'+esc(t.id)+'">強制派發</button>':'';
    var seatLine=t.seat?('席位 '+t.seat+' 已接'):'尚未被席位拉取';
    var sense=(t.sensors&&t.sensors.length)?t.sensors.join('、'):'無';
    var par=parallelLine(t);
    var detail='<dl class="qdetail">'+
      '<div><dt>狀態</dt><dd>'+esc(t.exiting?'此步完成 · 離開狀態欄':statusText(t))+'</dd></div>'+
      '<div><dt>總任務</dt><dd>'+esc((t.parent||'—')+' · '+waveTitle(t))+'</dd></div>'+
      '<div><dt>席位</dt><dd>'+esc(seatLine+' · '+(t.role||'未指定'))+'</dd></div>'+
      '<div><dt>提示詞</dt><dd>'+esc(t.prompt||'—')+'</dd></div>'+
      '<div><dt>上下文</dt><dd>'+esc(sense)+'</dd></div>'+
      '<div><dt>進度</dt><dd data-f="prog">'+esc(prog)+'</dd></div>'+
      '</dl>';
    return '<article class="qcard'+(t.exiting?' is-out':'')+'" data-id="'+esc(t.id)+'" data-sensors="'+esc((t.sensors||[]).join(','))+'" data-role="'+esc(t.role)+'" data-search>'+
      '<div class="qtop"><span class="qid">'+esc(t.id)+'</span><span class="pri '+t.pri+'"><span class="sig '+(t.pri==='p0'?'warn':'ok')+'"></span>'+esc(t.priLabel)+'</span></div>'+
      '<h4 class="qtitle">'+esc(t.title)+'</h4><div class="qtags">'+tags+'</div>'+bar+par+
      '<div class="qmeta">'+(t.exiting?'此步完成 · 離開狀態欄':t.meta)+'</div>'+detail+btn+
      '<div class="claim-stamp"><span data-f="stamp0">'+(t.stamp&&t.stamp[0]||'')+'</span><span>'+(t.stamp&&t.stamp[1]||'')+'</span></div></article>';
  }
  var QUEUE_LANES=['queue','wait','proc','split','gen'];
  var laneSigSeen={};
  function laneOf(t){
    if (t.lane==='done' && !t.exiting) return '';
    return t.exiting ? (t.leftFrom||'') : t.lane;
  }
  function tasksInLane(lane){
    return store.tasks.filter(function(t){ return laneOf(t)===lane; });
  }
  function laneStructSig(lane){
    return tasksInLane(lane).map(function(t){
      var tags=(t.tags||[]).map(function(g){ return g.t+'/'+g.c; }).join(',');
      return [t.id, t.exiting?1:0, t.pri, t.title, t.role||'', t.seat||'', t.slot||'', t.wave||'', tags, t.meta||'', (t.stamp&&t.stamp[1])||'', t.prompt||'', (t.sensors||[]).join(','), parallelLine(t)].join('|');
    }).join('~');
  }
  function cardValue(t){
    var lane=laneOf(t);
    var stamp0=(t.stamp&&t.stamp[0])||'';
    if (lane==='queue'){
      var sla=Math.round(t.sla||0);
      return {pct:sla, prog:'SLA '+sla+'% · 等待席位拉取', stamp0:stamp0};
    }
    if (lane==='wait'){
      var waitN=Math.round(t.waitPct||0);
      return {pct:waitN, prog:'等空檔 '+waitN+'%', stamp0:stamp0};
    }
    if (t.progress!==undefined){
      var progN=Math.round(t.progress);
      return {pct:progN, prog:progN+'%', stamp0:stamp0};
    }
    return null;
  }
  function paintCardValues(t){
    var card=document.querySelector('#lanes .qcard[data-id="'+String(t.id).replace(/"/g,'')+'"]');
    if (!card) return;
    var v=cardValue(t);
    if (!v) return;
    var bar=card.querySelector('[data-f="bar"]');
    if (bar){
      var mark=v.pct+'%';
      if (bar.getAttribute('data-mark')!==mark){
        bar.style.setProperty('--pct', mark);
        bar.setAttribute('data-mark', mark);
        if (bar.parentElement) bar.parentElement.setAttribute('aria-valuenow', String(v.pct));
      }
    }
    var prog=card.querySelector('[data-f="prog"]');
    if (prog && prog.textContent!==v.prog) prog.textContent=v.prog;
    var stamp=card.querySelector('[data-f="stamp0"]');
    if (stamp && stamp._raw!==v.stamp0){
      stamp.innerHTML=v.stamp0;
      stamp._raw=v.stamp0;
    }
  }
  function paintLane(lane, seen){
    var body=document.getElementById('body-'+lane);
    if (!body) return false;
    var items=tasksInLane(lane);
    var sig=laneStructSig(lane);
    var par=body.parentElement && $('.lane-par', body.parentElement);
    if (par) par.hidden=items.length<2;
    if (laneSigSeen[lane]===sig && body.childElementCount){
      items.forEach(paintCardValues);
      return false;
    }
    laneSigSeen[lane]=sig;
    var scroll=body.scrollTop;
    hideTip();
    body.innerHTML=items.length?items.map(taskCard).join('')
      :'<div class="lane-empty"><span class="sig ok" style="width:10px;height:10px;color:var(--faint)"></span> EMPTY<br>暫無項目</div>';
    body.scrollTop=scroll||0;
    if (seen && !document.body.classList.contains('reduce-motion')){
      $$('.qcard', body).forEach(function(n){
        if (n.classList.contains('is-out')) return;
        if (!seen[n.getAttribute('data-id')]) n.classList.add('is-in');
      });
    }
    return true;
  }
  function paintQueueValues(){
    store.tasks.forEach(function(t){
      var lane=laneOf(t);
      if (lane==='queue'||lane==='wait'||lane==='proc') paintCardValues(t);
    });
    if (currentQuery) applyQuery();
  }
  function renderQueue(only){
    var partial=!!(only && only.length);
    var lanes=partial
      ? QUEUE_LANES.filter(function(lane){ return only.indexOf(lane)>=0 || laneStructSig(lane)!==laneSigSeen[lane]; })
      : QUEUE_LANES;
    var root=$('#lanes');
    var seen={};
    if (root) $$('.qcard', root).forEach(function(n){ seen[n.getAttribute('data-id')]=1; });
    var rebuilt=false;
    lanes.forEach(function(lane){ if (paintLane(lane, seen)) rebuilt=true; });
    if (!partial || rebuilt){
      renderParallel();
      renderFlow();
    }
    renderNumbers();
    applyQuery();
    if (routeState && routeState.topic==='queue' && routeState.focus){
      var fid=String(routeState.focus).replace(/"/g,'');
      var keep=document.querySelector('.qcard[data-id="'+fid+'"]');
      var flow=document.querySelector('.flow-node[data-id="'+fid+'"]');
      if (keep) keep.classList.add('linked');
      if (flow) flow.classList.add('linked');
    }
  }
  var flowSeen=null;
  function laneState(t){ return t.lane==='done'?'done':(t.exiting?t.leftFrom:t.lane); }
  function statusText(t){
    var s=laneState(t);
    if (s==='queue') return '待席位拉取';
    if (s==='wait') return '席位已接 · 待空檔';
    if (s==='proc') return '席位執行中';
    if (s==='split') return '席位再分拆';
    if (s==='gen') return '席位收成';
    if (s==='done') return '此步完成';
    return s;
  }
  function liveTasks(parent){
    return store.tasks.filter(function(t){
      return (!parent||t.parent===parent) && !t.flowGone && t.lane!=='done' && !t.exiting;
    });
  }
  function waveGroup(t){
    return store.tasks.filter(function(x){
      return x!==t && x.parent===t.parent && !x.flowGone && x.wave===t.wave;
    });
  }
  function waveTitle(t){
    var name=WAVE_NAME[t.wave]||('第 '+(t.wave||'?')+' 波');
    return (waveGroup(t).length?'同一波':'單行')+' · '+name;
  }
  function parallelLine(t){
    var mates=waveGroup(t);
    if (!mates.length) return '';
    var slot=t.slot?('佔 '+t.slot+' · '):'';
    return '<div class="qpar">'+esc(slot+waveTitle(t)+' · '+mates.map(function(x){ return x.id+' '+statusText(x); }).join('、'))+'</div>';
  }
  function renderParallel(){
    var host=$('#parNow'); if (!host) return;
    var live=store.tasks.filter(function(t){ return !t.flowGone && !t.exiting && (t.lane==='proc'||t.lane==='split'||t.lane==='gen'); });
    var wait=store.tasks.filter(function(t){ return t.lane==='wait' && !t.exiting; });
    var queued=store.tasks.filter(function(t){ return t.lane==='queue' && !t.exiting; });
    var free=store.slots.filter(function(s){ return s.state==='free' && !s.reserve; });
    var runs=live.map(function(t){
      return '<span class="par-chip run">'+esc(t.id+(t.slot?' @'+t.slot:'')+' · '+statusText(t))+'</span>';
    }).join('')||'<span class="par-chip">此刻沒有同時在跑的步驟</span>';
    var waitText=wait.length
      ?(free.length?('待空檔 '+wait.length+' · 空槽 '+free.map(function(s){ return s.id; }).join('、')+' 還能再接'):('待空檔 '+wait.length+' · 槽已滿，這批在等並行中的步驟讓出'))
      :'沒有步驟在等槽';
    host.innerHTML='<b>此刻並行 '+live.length+'</b>'+runs+
      '<span class="par-chip wait">'+esc(waitText)+'</span>'+
      '<span class="par-chip">佇列 '+queued.length+' 還沒進並行</span>';
  }
  function waveColumns(items){
    var map={}, order=[];
    items.forEach(function(t){
      var w=t.wave||t.step||0;
      if (!map[w]){ map[w]=[]; order.push(w); }
      map[w].push(t);
    });
    order.sort(function(a,b){ return a-b; });
    return order.map(function(w){ return map[w].sort(function(a,b){ return (a.step||0)-(b.step||0); }); });
  }
  function renderFlow(){
    var host=$('#flowBoard'); if (!host) return;
    var groups={};
    store.tasks.forEach(function(t){
      if (!t.parent||t.flowGone) return;
      (groups[t.parent]=groups[t.parent]||[]).push(t);
    });
    var ids=Object.keys(groups);
    if (!ids.length){
      host.innerHTML='<div class="flow-empty">任務經理尚未把任務交給席位</div>';
      return;
    }
    host.innerHTML=ids.map(function(pid){
      var items=groups[pid].slice().sort(function(a,b){ return (a.wave||0)-(b.wave||0)||(a.step||0)-(b.step||0); });
      var done=items.filter(function(t){ return t.lane==='done'; }).length;
      var closing=items.every(function(t){ return t.flowClosing; });
      var waves=waveColumns(items).map(function(col,i){
        var sample=col[0];
        var n=col.length;
        var running=col.filter(function(t){ var s=laneState(t); return s==='proc'||s==='split'||s==='gen'; }).length;
        var waiting=col.filter(function(t){ return laneState(t)==='wait'; }).length;
        var tail=' · 1 步';
        if (n>1){
          if (running>1) tail=' · '+running+' 步同時';
          else if (running&&waiting) tail=' · '+running+' 在跑 · '+waiting+' 等槽';
          else if (waiting>1) tail=' · '+waiting+' 步等槽';
          else tail=' · 可重疊';
        }
        var nodes=col.map(function(t){
          var st=laneState(t);
          var seat=t.seat?('席位 '+t.seat+' 已接'):'尚未被席位拉取';
          var hold=t.slot?(' · 槽 '+t.slot):'';
          return '<article class="flow-node" data-state="'+esc(st)+'" data-id="'+esc(t.id)+'" data-wave="'+esc(t.wave||'')+'" data-search>'+
            '<div class="fn-top"><span class="fn-step">'+String(t.step||0).padStart(2,'0')+'</span><span class="qid">'+esc(t.id)+'</span><span class="fn-st">'+esc(statusText(t))+'</span></div>'+
            '<div class="fn-title">'+esc(t.title)+'</div>'+
            '<div class="fn-role">'+esc(t.role)+' · 角色提示詞</div>'+
            '<div class="fn-prompt">「'+esc(t.prompt||'')+'」</div>'+
            '<div class="fn-seat">'+esc(seat+hold)+'</div>'+
            (n>1?'<div class="fn-par">'+esc(waveTitle(t))+'</div>':'')+
          '</article>';
        }).join('');
        return (i?'<div class="flow-join" aria-hidden="true"></div>':'')+
          '<div class="flow-wave'+(n>1?' is-par':'')+'" data-span="'+n+'">'+
            '<div class="flow-wave-h">'+esc(waveTitle(sample)+tail)+'</div>'+
            '<div class="flow-col">'+nodes+'</div></div>';
      }).join('');
      var parN=items.filter(function(t){ return t.lane==='proc'||t.lane==='split'||t.lane==='gen'; }).length;
      return '<div class="flow-track'+(closing?' is-out':'')+'" data-parent="'+esc(pid)+'">'+
        '<div class="flow-src"><div class="fs-k">任務經理</div><div class="fs-id">'+esc(pid)+'</div>'+
        '<div class="fs-t">'+esc(PARENT_TITLE[pid]||'總任務')+'</div>'+
        '<div class="fs-m">'+done+' / '+items.length+' 步完成 · 此刻 '+parN+' 步同時在跑</div></div>'+
        '<div class="flow-join" aria-hidden="true"></div>'+waves+'</div>';
    }).join('');
    if (!flowSeen){
      flowSeen={};
      $$('.flow-node',host).forEach(function(n){ flowSeen[n.getAttribute('data-id')]=1; });
      return;
    }
    $$('.flow-node',host).forEach(function(n){
      var id=n.getAttribute('data-id');
      if (!flowSeen[id]) n.classList.add('is-in');
      flowSeen[id]=1;
    });
  }

  /* ================= RENDER：席位表 / 席位圖 / 槽位 / locks / alerts / audit ================= */
  var STD_ROLES=[
    [0,'manager','任務經理','管理','reasoning','分析使用者任務，產出里程碑與成敗標準；再經 decomposer 分解為原子工作項 DAG，並指派執行者'],
    [1,'ai_lead','AI 主管','AI / Prompt','reasoning','制定模型評測、RAG 與 Prompt 策略；審查幻覺、成本與降級鏈'],
    [1,'architect','架構師','管理','critical','設計系統架構與技術選型；制定技術規範與最佳實踐'],
    [1,'creative_lead','創意主管','創意／敘事','reasoning','制定敘事基調、世界觀與角色聖經；審查故事、文案與在地化一致性'],
    [1,'finance_lead','金融主管','金融／量化','reasoning','制定估值方法、風險上限與研究日曆；審查量化分析師的假設與數據來源'],
    [1,'growth_lead','成長主管','成長／客戶成功','reasoning','規劃獲客、啟用與留存實驗；審查文案與對話漏斗'],
    [1,'industrial_lead','工業主管','工業／OPC','reasoning','規劃 OPC 感知-診斷-執行閉環；審查寫入護欄、白名單與事故升級'],
    [1,'platform_lead','平台主管','平台／GitHub','reasoning','統籌 GitHub 工作流、發布節奏與內部平台；審查 PR 策略、版本標記與回滾計畫'],
    [1,'product_lead','產品主管','產品','reasoning','釐清使用者目標與驗收標準；排定需求優先序與範圍取捨'],
    [1,'security_lead','資安主管','資安','reasoning','制定威脅模型與安全閘門；審查認證、授權與敏感資料流向'],
    [1,'tech_lead','技術主管','管理','reasoning','制定技術方向與架構決策；審查程式碼品質與技術方案'],
    [2,'backend_lead','後端主管','後端','reasoning','設計 API 架構與資料庫模型；審查後端程式碼品質'],
    [2,'data_lead','資料主管','資料','reasoning','制定資料資產與分析策略；審查管線品質、指標定義與倉儲設計'],
    [2,'frontend_lead','前端主管','前端邏輯','reasoning','制定前端架構與技術選型；審查 UI/JS/CSS 交付物品質'],
    [2,'test_lead','測試主管','測試','routine','制定測試策略（單元/整合/E2E）；審查測試案例覆蓋率'],
    [3,'accessibility_eng','無障礙工程師','UI 設計','routine','檢查對比、鍵盤操作與讀屏標籤；產出 WCAG 修復清單'],
    [3,'api_engineer','API 契約工程師','後端','reasoning','維護 OpenAPI 欄位、錯誤碼與相容性；檢查 Header 與邊界條件'],
    [3,'backend_dev','後端開發者','後端','routine','實作 RESTful API 與業務邏輯；設計資料庫 schema 與查詢'],
    [3,'billing_ops','計費運維','AI Hub','routine','核對用量、發票與異常扣款；對齊角色日預算與 Hub 攔截'],
    [3,'cache_engineer','快取工程師','維運','reasoning','設計 Key、TTL 與失效；追蹤命中率與雪崩'],
    [3,'chaos_eng','混沌工程師','維運','reasoning','設計故障注入實驗；驗證超時、重試與熔斷'],
    [3,'cloud_architect','雲架構師','維運','critical','規劃帳號、網路與身分；估算成本與備援'],
    [3,'conversation_designer','對話設計師','AI / Prompt','reasoning','設計意圖、槽位與降級話術；處理拒答與敏感話題'],
    [3,'copy_editor','文案編輯','創意／敘事','summary','校對語氣、錯字與品牌用詞；統一繁中用詞'],
    [3,'crawler','爬蟲工程師','爬蟲／採集','routine','設計採集任務與選擇器；處理重試、去重與速率限制。不在主棧執行'],
    [3,'css_dev','CSS 開發者','樣式','routine','依設計稿實作樣式；確保響應式與跨瀏覽器相容'],
    [3,'customer_success','客戶成功','成長／客戶成功','summary','追蹤健康度與升級條件；把回饋轉成需求或缺陷'],
    [3,'data_engineer','資料工程師','資料','routine','設計 ETL／ELT 與資料品質檢查；建置倉儲與批次／串流作業'],
    [3,'data_scientist','資料科學家','資料','reasoning','提出可驗證假設與實驗設計；解釋模型與業務指標'],
    [3,'dba','資料庫管理員','資料','routine','設計 schema、索引與遷移；規劃備份、還原與權限'],
    [3,'developer','通用開發者','後端','routine','執行被指派的工作項；遇到阻塞時主動回報'],
    [3,'devops','維運工程師','維運','routine','設定 CI／CD；管理部署環境'],
    [3,'eval_engineer','評測工程師','AI / Prompt','reasoning','建立基準集、回歸閘與紅隊題；對比模型成本與品質'],
    [3,'feature_flag_eng','功能開關工程師','後端','routine','設計灰度、受眾與回滾；避免旗標永久化'],
    [3,'github_ops','GitHub 工程師','平台／GitHub','routine','整理 PR、Issue、檢查狀態與分支保護'],
    [3,'hub_operator','Hub 值班','AI Hub','routine','監控模型池延遲、熔斷與預算；依路由策略建議切換或降級'],
    [3,'incident_cmd','事故指揮官','維運','reasoning','事故分級、溝通與時間線；協調緩解與事後檢討'],
    [3,'integration_eng','整合工程師','後端','reasoning','對接外部 API 與 Webhook；處理冪等、重試與簽名'],
    [3,'iot_engineer','IoT 工程師','工業／OPC','routine','規劃邊緣裝置與協定；處理斷線緩存與韌體版本'],
    [3,'js_dev','JS 開發者','前端邏輯','routine','實作前端互動、狀態管理與 API 串接'],
    [3,'load_tester','負載測試工程師','測試','reasoning','設計負載模型與飽和點；量測 p95／p99 與錯誤率'],
    [3,'market_data_eng','行情工程師','金融／量化','routine','檢查行情時效、欄位與異常值；對齊幣別、復權與交易時段'],
    [3,'ml_engineer','機器學習工程師','AI / Prompt','reasoning','設計特徵、訓練與推論服務；標明資料切分、指標與偏差'],
    [3,'mlops','MLOps 工程師','AI / Prompt','reasoning','部署模型、監控漂移與回滾；管理特徵商店與推論 SLA'],
    [3,'mobile_dev','行動開發者','行動端','routine','實作行動介面與導航；處理離線快取、推播與裝置權限'],
    [3,'narrative_editor','敘事編輯','創意／敘事','reasoning','審查情節節奏、角色一致性與對白'],
    [3,'observability_eng','可觀測性工程師','維運','reasoning','設計 Tracing ID、指標與告警門檻'],
    [3,'opc_engineer','OPC 工業工程師','工業／OPC','reasoning','讀取 OPC 標籤、診斷品質與越界；寫入建議必須通過護欄'],
    [3,'pen_tester','滲透測試工程師','資安','reasoning','盤點攻擊面與優先序；驗證認證、注入與越權。本頁不提供操作步驟'],
    [3,'perf_eng','效能工程師','維運','reasoning','量測延遲、吞吐與資源瓶頸；提出快取、查詢與渲染優化'],
    [3,'plc_engineer','PLC 工程師','工業／OPC','reasoning','設計連鎖與安全回路；對齊 OPC 標籤與寫入護欄'],
    [3,'portfolio_mgr','投資組合經理','金融／量化','reasoning','配置權重與再平衡規則；檢查集中度與上限'],
    [3,'privacy_officer','隱私長','合規','reasoning','盤點個資欄位與留存；檢查出境與最小化'],
    [3,'product_designer','產品設計師','產品','reasoning','設計使用者旅程與資訊架構'],
    [3,'qa_automation','自動化 QA','測試','routine','撰寫 E2E／回歸閘；穩定選擇器與重試策略'],
    [3,'quant_analyst','量化分析師','金融／量化','reasoning','拉取行情、估值與基本面；以策略目錄選策略，必要時看工作流與走勢'],
    [3,'rag_engineer','RAG 工程師','AI / Prompt','reasoning','設計切片、嵌入與重排；檢查檢索命中與引用'],
    [3,'release_eng','發布工程師','平台／GitHub','reasoning','準備版本號、變更紀錄與發布清單；檢查遷移、設定與回滾'],
    [3,'risk_analyst','風險分析師','金融／量化','reasoning','評估倉位、情境與最大回撤'],
    [3,'router_eng','路由工程師','AI Hub','reasoning','調整權重、故障轉移與競速'],
    [3,'security_eng','資安工程師','資安','reasoning','檢查認證授權、注入與敏感資料外洩；撰寫防護清單'],
    [3,'sentiment_analyst','情緒分析師','金融／量化','routine','整理新聞／社群事件衝擊；區分事實、傳聞與情緒'],
    [3,'sre','可靠性工程師','維運','routine','定義 SLO／錯誤預算與告警；處理事故、容量與降級'],
    [3,'story_writer','故事創作者','創意／敘事','reasoning','撰寫情節、對白與角色弧線；維持世界觀與語氣'],
    [3,'tech_writer','技術文件工程師','文件','summary','撰寫 API 文件、操作手冊與架構說明'],
    [3,'tester','測試工程師','測試','routine','撰寫並執行單元、整合與 E2E 測試'],
    [3,'translator','在地化專員','文件','summary','將介面與文件轉為自然繁中或其他語系'],
    [3,'ui_designer','UI 設計師','UI 設計','routine','設計版面、線框、元件稿與互動原型'],
    [3,'ux_researcher','UX 研究員','產品','routine','規劃可用性測試與訪談；整理痛點與改進假設'],
    [4,'analyst','分析師','資料','routine','研究、分析與收集資料；提供數據驅動的見解'],
    [4,'content_writer','內容撰寫','文件','summary','撰寫對外文案、報告敘事與摘要'],
    [4,'coordinator','協調者','管理','routine','跨角色溝通，處理阻塞與依賴'],
    [4,'knowledge_mgr','知識庫管理員','記憶／知識庫','summary','維護 runbook、FAQ 與術語表；把完成工作沉澱成可重用知識'],
    [4,'legal','合規審查','合規','reasoning','檢查個資、授權與敏感內容；標示出境與留存風險'],
    [4,'memory_curator','記憶庫策展','記憶／知識庫','routine','整理向量記憶、去重與過期；檢查檢索是否與任務相關'],
    [4,'prompt_engineer','Prompt 工程師','AI / Prompt','reasoning','設計角色系統提示與評估標準；規劃路由與成本'],
    [4,'researcher','研究員','研究','reasoning','蒐集文獻、競品與領域背景；提出可驗證假設'],
    [4,'reviewer','審查者','審查','reasoning','審查交付品質，決定通過或退回；回饋必須具體可執行'],
    [4,'support','支援專員','產品','summary','整理工單、FAQ 與回饋；把問題轉成可指派的缺陷或需求'],
    [4,'synthesizer','整合者','審查','reasoning','合併多個交付物；解決矛盾與重複']
  ];
  var RAHO_SPINE=[
    ['L4','需求審計官','requirement_auditor'],
    ['L3','戰術指揮官','tactical_commander'],
    ['L2','原子執行席','atomic_executor'],
    ['L1','憲法檢察官','constitutional_inspector'],
    ['L0','環境核心','environment_kernel']
  ];
  var ROLE_TEMPLATES=[
    ['page_dev','頁面開發團隊','頁面／行動前後端＋測試','architect、backend、css、frontend、js、manager、synthesizer 等 12 席'],
    ['fullstack_app','全端開發團隊','全端開發＋審查','backend、frontend、css、js、manager、reviewer 等 10 席'],
    ['research_report','研究報告團隊','研究調查與報告','analyst、content_writer、manager、researcher、reviewer、synthesizer'],
    ['quick_task','快速任務團隊','單一任務、成本最低','developer、manager'],
    ['full_company','完整公司','全席啟用','STANDARD_ROLES 全部 80 席'],
    ['quant_desk','量化研究桌','行情／回測／組合','finance_lead、market_data_eng、portfolio_mgr、quant_analyst 等 11 席'],
    ['industrial_ops','工業運維團隊','OPC／PLC／IoT','industrial_lead、iot、opc、plc、reviewer、security 等 9 席'],
    ['story_studio','故事工作室','敘事／世界觀','creative_lead、narrative_editor、story_writer、copy_editor 等 9 席']
  ];
  var stdLevel='all';
  function renderStdRows(){
    var body=$('#stdRoles tbody'); if (!body) return;
    var rows=STD_ROLES.filter(function(r){ return stdLevel==='all'||r[0]===stdLevel; });
    body.innerHTML=rows.map(function(r){
      return '<tr data-search><td class="mono">'+esc(r[1])+'</td><td>'+esc(r[2])+'</td><td>'+esc(r[3])+'</td><td class="mono">L'+r[0]+' · '+esc(r[4])+'</td><td>'+esc(r[5])+'</td></tr>';
    }).join('');
  }
  function renderRoleCatalog(){
    var kinds=$('#roleKinds'); if (!kinds || kinds.dataset.built==='1') { renderStdRows(); return; }
    kinds.dataset.built='1';
    kinds.innerHTML=[
      ['std','80','公司 STANDARD_ROLES','backend/company/roles/','任務經理調度的代理人席位'],
      ['raho','5','RAHO 脊柱席位','seat_table.py · _RAHO_SPINE','L0–L4 固定席，不屬公司角色表'],
      ['linkin','16','靈境子角色','linkin/roles.py · role_catalog','建築／敘事／NPC／道具四部門'],
      ['tpl','8','組織模板','同 roles.py','預組團隊，不是獨立角色']
    ].map(function(k){
      return '<article class="kind-card" data-kind="'+esc(k[0])+'"><div class="kn">'+k[1]+'</div><div class="kt">'+esc(k[2])+'</div><div class="kd">'+esc(k[3])+'</div><div class="kd">'+esc(k[4])+'</div></article>';
    }).join('');
    var raho=$('#rahoWrap');
    if (raho) raho.innerHTML='<table class="table"><thead><tr><th>層</th><th>席位</th><th>role_id</th></tr></thead><tbody>'+
      RAHO_SPINE.map(function(r){ return '<tr data-raho="'+esc(r[2])+'"><td class="mono">'+esc(r[0])+'</td><td>'+esc(r[1])+'</td><td class="mono">'+esc(r[2])+'</td></tr>'; }).join('')+
      '</tbody></table>';
    var tabs=$('#levelTabs');
    var counts={0:0,1:0,2:0,3:0,4:0};
    STD_ROLES.forEach(function(r){ counts[r[0]]++; });
    var names={0:'最高決策層',1:'技術領導層',2:'領域領導層',3:'執行層',4:'支援角色'};
    if (tabs){
      var btns=[{id:'all',label:'全部 '+STD_ROLES.length}].concat([0,1,2,3,4].map(function(n){
        return {id:String(n),label:'L'+n+' '+names[n]+' '+counts[n]};
      }));
      tabs.innerHTML=btns.map(function(b){
        return '<button type="button" class="mini-btn" data-std-level="'+b.id+'" aria-pressed="'+(b.id==='all'?'true':'false')+'">'+esc(b.label)+'</button>';
      }).join('');
    }
    var tpls=$('#tplGrid');
    if (tpls) tpls.innerHTML=ROLE_TEMPLATES.map(function(t){
      return '<article class="tpl-card" data-tpl="'+esc(t[0])+'"><b>'+esc(t[1])+'</b><span>'+esc(t[0])+' · '+esc(t[2])+'</span><span>'+esc(t[3])+'</span></article>';
    }).join('');
    renderStdRows();
  }
  function renderRoles(){
    renderRoleCatalog();
    var host=$('#roleBoard'); if (!host) return;
    host.innerHTML=ROLE_ORDER.map(function(name){
      var role=ROLES[name];
      var seats=store.seats.filter(function(s){ return s.role===name; });
      var tasks=store.tasks.filter(function(t){ return t.role===name && t.lane!=='done' && !t.flowGone; });
      var live=seats.length?seats.map(function(s){ return s.id+' '+s.statusLabel; }).join(' · '):'尚無席位承接';
      var work=tasks.length?tasks.map(function(t){ return t.id; }).join(' · '):'沒有在途步驟';
      return '<button type="button" class="role-card'+(roleFilter===name?' selected':'')+'" data-role-name="'+esc(name)+'">'+
        '<div class="role-code">'+esc(role.code)+'</div>'+
        '<h3><i style="background:'+role.color+'"></i>'+esc(name)+'</h3>'+
        '<p class="role-prompt">「'+esc(role.prompt)+'」</p>'+
        '<p class="role-line">做：'+esc(role.duty)+'</p>'+
        '<p class="role-line">不做：'+esc(role.cannot)+'</p>'+
        '<p class="role-line">讀 '+esc(role.reads)+' · 寫 '+esc(role.writes)+'</p>'+
        '<p class="role-line">技能 '+esc(role.skills)+'</p>'+
        '<p class="role-live">'+esc(live)+'</p>'+
        '<p class="role-live">在途 '+esc(work)+'</p></button>';
    }).join('');
  }
  function applyRoleFilter(){
    $$('#seatRoster tbody tr').forEach(function(row){
      var seat=row.getAttribute('data-seat');
      var known=store.seats.filter(function(s){ return s.id===seat; })[0];
      row.classList.toggle('role-off',!!roleFilter && (!known || known.role!==roleFilter));
    });
    $$('#seats .seat').forEach(function(cell){
      var known=store.seats.filter(function(s){ return s.id===cell.getAttribute('data-seat'); })[0];
      cell.classList.toggle('role-off',!!roleFilter && (!known || known.role!==roleFilter));
    });
  }
  function renderRoster(){
    var tb=$('#seatRosterBody'); if (!tb) return;
    tb.innerHTML=store.seats.map(function(s){
      var role=ROLES[s.role]||{};
      return '<tr data-seat="'+esc(s.id)+'" data-status="'+esc(s.status)+'" data-role="'+esc(s.role)+'" data-search>'+
        '<td class="strong mono">'+esc(s.id)+'</td>'+
        '<td><span class="role-tag"><i style="background:'+s.color+'"></i>'+esc(s.role)+'</span><div class="role-sub">'+esc(role.prompt||'')+'</div></td>'+
        '<td class="mono">'+esc(s.task)+'</td>'+
        '<td><span class="pill '+s.pill+'"><span class="sig '+(s.status==='run'?'busy':s.status==='lock'?'lock':s.status==='wait'?'warn':'ok')+'"></span>'+esc(s.statusLabel)+'</span></td>'+
        '<td class="mono" data-col="low">'+esc(s.slot)+'</td>'+
        '<td><div class="mini-progress"><div class="mp-track"><div class="mp-fill'+(s.status==='gen'?' cy':'')+'" style="--pct:'+s.prog+'%" role="progressbar" aria-valuenow="'+s.prog+'" aria-valuemin="0" aria-valuemax="100"></div></div><span class="mp-num">'+(s.prog?s.prog+'%':'—')+'</span></div></td>'+
        '<td class="mono" data-col="low">'+esc(s.tok)+'</td></tr>';
    }).join('');
    renderRoles();
    applyRoleFilter();
  }
  function renderSeats(){
    var wrap=$('#seats'); if (!wrap||wrap.dataset.built==='1') return;
    var running=[2,5,11,14,18,23],waitS=[27,31,38,44],queued=[8,21,35,47,58,70],
        doneS=[0,3,6,12,16,19,25,29,33,41,49,55,63,72],locked=[13,36,57,77],genS=[73,75,76,78,79,42,45];
    var html='';
    for (var i=0;i<80;i++){
      var st='';
      if (running.indexOf(i)>-1) st='run';
      else if (waitS.indexOf(i)>-1) st='wait';
      else if (queued.indexOf(i)>-1) st='queue';
      else if (doneS.indexOf(i)>-1) st='done';
      else if (locked.indexOf(i)>-1) st='lock';
      else if (genS.indexOf(i)>-1) st='gen';
      var id='S-'+String(i+1).padStart(2,'0');
      html+='<button class="seat '+st+'" data-status="'+st+'" data-seat="'+id+'" tabindex="'+(i===0?0:-1)+'" aria-label="席位 '+id+'"></button>';
    }
    wrap.innerHTML=html;
    wrap.dataset.built='1';
  }
  function slotWho(s){
    var who=s.reserve?'P0 專用 · 可搶佔':(s.who||'— 等派發 —');
    return who.replace(/([^ \u00a0])·([^ \u00a0])/g,'$1 · $2');
  }
  function sensePack(s){
    var base={
      A1:{raw:6100,keep:31,see:0.71,percept:'趨勢句：溫度仍在警戒帶',task:'T-2841 · M1 巡檢摘要',sync:'本槽增量已入任務庫',kept:'目標：彙整巡檢，不直接改閥位',drop:'重複開場與昨日三段日誌'},
      A2:{raw:5400,keep:28,see:0.66,percept:'門檻句：複核尚未關閉',task:'T-2841 · M2 門檻複核',sync:'增量整理中',kept:'未完成：門檻複核仍開著',drop:'已關閉子任務清單'},
      A3:{raw:4800,keep:36,see:0.58,percept:'對照句：不含行動候選',task:'對照稿 · 無行動句',sync:'待本槽收尾再入庫',kept:'對照只保留差異，沒有行動句',drop:'上週巡檢版型'},
      A4:{raw:3900,keep:24,see:0.63,percept:'窗尾：重複開場已丟',task:'窗尾去重條目',sync:'去重結果已入任務庫',kept:'窗尾只留最新一句',drop:'同一句開場的三次重複'},
      B1:{raw:4500,keep:33,see:0.69,percept:'未完成步：Q-120、Q-124',task:'未完成步驟索引',sync:'步驟索引已更新',kept:'未完成步：Q-120、Q-124',drop:'只剩時間戳的空行'},
      B2:{raw:4200,keep:29,see:0.74,percept:'證據句：占用與保留率',task:'窗口與保留率證據',sync:'證據卡已入任務庫',kept:'證據：窗口偏滿，保留約三分之一',drop:'過期附件'},
      B3:{raw:0,keep:0,see:0,percept:'空檔，不掛感知',task:'',sync:'未掛載',kept:'',drop:''},
      B4:{raw:2200,keep:40,see:0.81,percept:'P0 守門：行動句只做候選',task:'P0 行動候選 · 待 guard',sync:'預留增量，核可前不入正式條目',kept:'行動候選：62% → 54%，未核可',drop:'不把世界庫抄進這份預留稿'}
    };
    var pack=base[s.id]||base.B3;
    var live=s.state==='busy'&&!s.reserve;
    var keep=live?Math.max(18,Math.min(62,pack.keep+(s.ttl%5)-2)):pack.keep;
    var tok=live?Math.round(pack.raw*keep/100):pack.raw;
    var see=live?Math.max(0.4,Math.min(0.92,pack.see+((s.ttl%7)-3)*0.01)):pack.see;
    return {pack:pack,live:live,keep:keep,tok:tok,see:see};
  }
  function renderKnowledge(){
    var taskHost=$('#taskKbList'), worldHost=$('#worldKbList');
    if (!taskHost||!worldHost) return;
    var writers=store.slots.filter(function(s){ return s.state==='busy'||s.reserve; });
    var readers=store.slots.filter(function(s){ return s.state==='busy'&&!s.reserve; });
    var taskMeta=$('#taskKbMeta'), worldMeta=$('#worldKbMeta');
    if (taskMeta) taskMeta.textContent=writers.length+' 槽回寫';
    if (worldMeta) worldMeta.textContent=readers.length+' 槽在讀';
    taskHost.innerHTML=store.slots.map(function(s){
      var info=sensePack(s);
      var on=info.live||s.reserve;
      var title=on?info.pack.task:'本槽沒有增量';
      var detail=on
        ?(info.pack.sync+' · 感知「'+info.pack.percept+'」')
        :'空檔不回寫。派發後才為這一槽新開一條。';
      return '<article class="kb-item" data-kb="task" data-slot="'+esc(s.id)+'"><div class="kb-slot">'+esc(s.id)+'</div><div><b>'+esc(title)+'</b><span>'+esc(detail)+'</span></div></article>';
    }).join('');
    var world=[
      ['共用','閥位正常帶 40–65%。超過 85% 只標成行動候選，不直接寫入。'],
      ['共用','溫度警戒 68–72，告警線大於 72。八個佔用槽讀同一條，不各自複製。'],
      ['共用','行動句必須經過 guard。模型感知只產生候選，不觸發寫入。'],
      ['共用','角色邊界：分析席只讀，工業席可提案，報告席負責收成。'],
      ['讀鎖', readers.length?('正在閱讀：'+readers.map(function(s){ return s.id; }).join(' · ')): '目前沒有佔用槽掛閱讀鎖。']
    ];
    worldHost.innerHTML=world.map(function(row){
      return '<article class="kb-item" data-kb="world"><div class="kb-slot">'+esc(row[0])+'</div><div><b>'+esc(row[1])+'</b><span>世界庫只讀。槽位釋放時歸還閱讀鎖，不修改這條。</span></div></article>';
    }).join('');
    renderOutputs();
  }
  var OUTPUTS=[
    {id:'ART-014',title:'巡檢摘要 v2',by:'Q-118',cite:'Q-120',from:'',folder:'巡檢',lang:'md',name:'巡檢摘要 v2.md',note:'Q-120 複核時引用。不改 v2，意見另記。',body:'# 巡檢摘要 v2\n\n- 編號：ART-014\n- 產出：Q-118\n- 引用：Q-120 只加意見，不改這一版\n\n## 窗口\n\n原文窗口仍在警戒帶。這一版只留最新一句，重複開場已丟。\n\n## 現場\n\n| 點位 | 讀數 | 判斷 |\n| --- | --- | --- |\n| TT-101 | 警戒帶內 | 繼續看 |\n| V-22 | 62% | 調整只是候選 |\n\n## 未完成\n\n- Q-120 門檻複核還沒關\n- Q-121 要等 guard 核可\n'},
    {id:'ART-009',title:'門檻複核稿 v1',by:'Q-120',cite:'',from:'',folder:'門檻',lang:'md',name:'門檻複核稿 v1.md',note:'仍在執行。完成後才可被後續任務引用。',body:'# 門檻複核稿 v1\n\n- 編號：ART-009\n- 產出：Q-120\n- 狀態：仍在執行，完成前只供閱讀\n\n## 對照\n\n世界庫寫著溫度警戒 68–72，告警線大於 72。\n閥位正常帶 40–65%。超過 85% 只標成行動候選。\n\n## 尚未關閉\n\n複核結論還沒寫完。這份不能被當成已通過的標準。\n'},
    {id:'ART-021',title:'閥位調整候選',by:'Q-121',cite:'',from:'',folder:'閥位',lang:'json',name:'閥位調整候選.json',note:'62% → 54%。guard 未核可前，其他任務只能看，不能當已執行結果。',body:'{\n  "id": "ART-021",\n  "by": "Q-121",\n  "point": "V-22",\n  "from": 62,\n  "to": 54,\n  "unit": "%",\n  "status": "candidate",\n  "guard": "pending",\n  "mayExecute": false,\n  "note": "未核可前只能看，不能當成已執行結果"\n}\n'},
    {id:'ART-006',title:'報告版型 v3',by:'Q-116',cite:'Q-124',from:'ART-003',folder:'報告',lang:'html',name:'報告版型 v3.html',note:'改自 ART-003。Q-124 可再改進，舊版留著。',body:'<article data-art="ART-006">\n  <h1>巡檢報告</h1>\n  <p data-slot="summary">摘要由 ART-014 引用，不把 v2 改掉。</p>\n  <section data-slot="threshold">門檻仍以 ART-009 為準。</section>\n  <section data-slot="action">行動句維持候選，guard 未核可不渲染成已執行。</section>\n</article>\n'},
    {id:'ART-003',title:'報告版型 v2',by:'Q-116',cite:'',from:'',folder:'報告',lang:'md',name:'報告版型 v2.md',note:'已被 v3 取代。保留以便對照，不再覆蓋。',body:'# 報告版型 v2\n\n已被 ART-006 取代。這一版留下對照，不再覆蓋。\n\n- 產出：Q-116\n- 後續：Q-124 若要改，另存新版\n'}
  ];
  var ide={open:[],active:'',side:'files',booted:false,folders:{},findAt:-1};
  function fileBy(id){ return OUTPUTS.filter(function(f){ return f.id===id; })[0]; }
  function textOf(f){ return f&&f.draft!=null?f.draft:f?f.body:''; }
  function dirtyOf(f){ return !!(f&&f.draft!=null&&f.draft!==f.body); }
  function langName(lang){ return {md:'Markdown',json:'JSON',html:'HTML',txt:'純文字'}[lang]||lang; }
  function caretInfo(ta){
    var pos=ta.selectionStart||0;
    var before=ta.value.slice(0,pos);
    return {line:before.split('\n').length, col:pos-before.lastIndexOf('\n')};
  }
  function commitIde(){
    var f=fileBy(ide.active), ta=$('#outCode');
    if (!f||!ta) return;
    f.draft=ta.value===f.body?null:ta.value;
  }
  function fileBtn(f){
    return '<button type="button" class="ide-file'+(f.id===ide.active?' on':'')+'" data-file="'+esc(f.id)+'" role="treeitem"><i class="'+esc(f.lang)+'">'+esc(f.lang.charAt(0).toUpperCase())+'</i><span class="fn">'+esc(f.name)+'</span><span class="fid">'+esc(f.id)+'</span>'+(dirtyOf(f)?'<b class="dirty"></b>':'')+'</button>';
  }
  function paintTree(){
    var host=$('#outTree'); if (!host) return;
    var q=($('#outFilter')&&ide.side==='search')?$('#outFilter').value.trim().toLowerCase():'';
    var files=OUTPUTS.filter(function(f){
      if (!q) return true;
      return (f.name+' '+f.id+' '+textOf(f)).toLowerCase().indexOf(q)>=0;
    });
    if (ide.side==='search'){
      host.innerHTML=files.map(fileBtn).join('')||'<div class="ide-empty">沒有相符的產物</div>';
      ide.treeSig=treeSig();
      return;
    }
    var order=['巡檢','門檻','閥位','報告'];
    files.forEach(function(f){ if (order.indexOf(f.folder)<0) order.push(f.folder); });
    host.innerHTML=order.filter(function(folder){ return files.some(function(f){ return f.folder===folder; }); }).map(function(folder){
      var open=ide.folders[folder]!==false;
      var kids=files.filter(function(f){ return f.folder===folder; }).map(fileBtn).join('');
      return '<div class="ide-dir"><button type="button" class="ide-fold" data-fold="'+esc(folder)+'">'+(open?'▾':'▸')+' '+esc(folder)+'</button>'+(open?'<div>'+kids+'</div>':'')+'</div>';
    }).join('');
    ide.treeSig=treeSig();
  }
  function paintTabs(){
    var host=$('#outTabs'); if (!host) return;
    host.innerHTML=ide.open.map(function(id){
      var f=fileBy(id); if (!f) return '';
      return '<div class="ide-tab'+(id===ide.active?' on':'')+'" role="tab"><button type="button" data-file="'+esc(id)+'"><span>'+esc(f.name)+'</span>'+(dirtyOf(f)?'<b class="dirty"></b>':'')+'</button><button type="button" class="x" data-close="'+esc(id)+'" aria-label="關閉 '+esc(f.name)+'">×</button></div>';
    }).join('');
    ide.tabSig=tabSig();
  }
  function treeSig(){
    var q=$('#outFilter')&&ide.side==='search'?$('#outFilter').value:'';
    return [ide.side,q,ide.active,OUTPUTS.map(function(f){ return f.id+(dirtyOf(f)?'*':'')+f.name; }).join('|'),
      Object.keys(ide.folders).map(function(k){ return k+(ide.folders[k]===false?'0':'1'); }).join(',')].join('~');
  }
  function tabSig(){
    return ide.open.map(function(id){ var f=fileBy(id); return id+(f&&dirtyOf(f)?'*':''); }).join('|')+':'+ide.active;
  }
  var HL_CSS='https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.10.0/build/styles/github-dark.min.css';
  var HL_CSS_SRI='sha384-wH75j6z1lH97ZOpMOInqhgKzFkAInZPPSPlZpYKYTOqsaizPvhQZmAtLcPKXpLyH';
  var HL_JS='https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.10.0/build/highlight.min.js';
  var HL_JS_SRI='sha384-GdEWAbCjn+ghjX0gLx7/N1hyTVmPAjdC2OvoAA0RyNcAOhqwtT8qnbCxWle2+uJX';
  var hlPromise=null;
  function ensureHighlight(){
    if (window.hljs) return Promise.resolve(window.hljs);
    if (hlPromise) return hlPromise;
    hlPromise=new Promise(function(resolve){
      if (!document.querySelector('link[data-hlcss]')){
        var link=document.createElement('link');
        link.rel='stylesheet';
        link.href=HL_CSS;
        link.integrity=HL_CSS_SRI;
        link.crossOrigin='anonymous';
        link.setAttribute('data-hlcss','1');
        document.head.appendChild(link);
      }
      var script=document.createElement('script');
      script.integrity=HL_JS_SRI;
      script.crossOrigin='anonymous';
      script.onload=function(){ resolve(window.hljs||null); };
      script.onerror=function(){ hlPromise=null; resolve(null); };
      script.src=HL_JS;
      document.head.appendChild(script);
    });
    return hlPromise;
  }
  function paintEditor(){
    var f=fileBy(ide.active);
    var ta=$('#outCode'), sheet=$('#outSheet'), gutter=$('#outGutter'), line=$('#outLine'), crumb=$('#outCrumb'), status=$('#outStatus');
    var root=$('#outIde');
    if (!ta||!sheet||!gutter||!root) return;
    root.classList.toggle('is-editing', !!f);
    if (!f){
      ta.value='';
      if ($('#outHl')) $('#outHl').textContent='';
      gutter.innerHTML='';
      if (line) line.hidden=true;
      if (crumb) crumb.textContent='';
      if (status) status.textContent='選擇左側產物';
      return;
    }
    var text=ta.value;
    var rows=text.split('\n');
    var info=caretInfo(ta);
    var lh=22;
    gutter.innerHTML=rows.map(function(_,i){ return '<div'+(i+1===info.line?' class="on"':'')+'>'+(i+1)+'</div>'; }).join('');
    var code=$('#outHl');
    var hl=window.hljs;
    var map={md:'markdown',json:'json',html:'xml'};
    if (hl && map[f.lang] && code){
      try {
        code.innerHTML=hl.highlight(text,{language:map[f.lang]}).value;
        var shown=code.innerText.split('\n').length;
        if (shown<rows.length) code.appendChild(document.createTextNode(new Array(rows.length-shown+1).join('\n')));
        root.classList.add('hl-on');
      } catch (err) {
        code.textContent=text;
        root.classList.remove('hl-on');
      }
    } else if (code) {
      code.textContent=text;
      root.classList.remove('hl-on');
    }
    ta.style.height='0px';
    ta.style.height=Math.max(ta.scrollHeight, sheet.clientHeight)+'px';
    if (line){ line.hidden=false; line.style.top=(16+(info.line-1)*lh)+'px'; }
    var mapEl=$('#outMap'), mapView=$('#outMapView');
    if (mapEl){
      var marks=rows.slice(0,90).map(function(row){
        return '<i style="width:'+Math.max(12,Math.min(100,row.length*2.4))+'%"></i>';
      }).join('');
      mapEl.querySelectorAll('i').forEach(function(node){ node.remove(); });
      mapEl.insertAdjacentHTML('afterbegin', marks);
      var span=Math.max(1, sheet.scrollHeight);
      var view=Math.max(28, sheet.clientHeight/span*mapEl.clientHeight);
      var off=16+(sheet.scrollTop/span)*Math.max(0, mapEl.clientHeight-16);
      if (mapView){
        mapView.style.setProperty('--view', view+'px');
        mapView.style.setProperty('--off', Math.min(off, mapEl.clientHeight-view)+'px');
      }
    }
    if (crumb) crumb.innerHTML='產出庫 <span>›</span> '+esc(f.folder)+' <span>›</span> <b>'+esc(f.name)+'</b>';
    var cite=f.cite?'引用 '+f.cite:(f.from?'改自 '+f.from:'尚無引用');
    if (status) status.innerHTML='<span>Ln '+info.line+', Col '+info.col+'</span><span>'+esc(langName(f.lang))+'</span><span>'+esc(f.id)+'</span><span>'+esc(cite)+'</span><span>'+(text!==f.body?'未存檔':'已對齊')+'</span><span class="sp"><button type="button" class="ide-tool" id="outSave">另存新版</button></span>';
    gutter.scrollTop=sheet.scrollTop;
  }
  function syncOutRoute(){
    if (!ide.booted || !routeState || routeState.topic!=='out') return;
    if ((routeState.focus||'')===(ide.active||'')) return;
    go({topic:'out', focus:ide.active||null}, 'replace');
  }
  function openFile(id, opt){
    opt=opt||{};
    var f=fileBy(id); if (!f) return;
    var ta=$('#outCode');
    var same=ide.active===id && ta && ta.value===textOf(f);
    if (!same){
      commitIde();
      if (ide.open.indexOf(id)<0) ide.open.push(id);
      ide.active=id;
      if (ta){ ta.value=textOf(f); ta.setSelectionRange(0,0); }
      paintEditor();
    }
    paintTree();
    paintTabs();
    if (!opt.silent) syncOutRoute();
  }
  function closeTab(id){
    commitIde();
    ide.open=ide.open.filter(function(x){ return x!==id; });
    if (ide.active===id){
      ide.active=ide.open[ide.open.length-1]||'';
      var ta=$('#outCode');
      var next=fileBy(ide.active);
      if (ta) ta.value=next?textOf(next):'';
    }
    paintEditor();
    paintTree();
    paintTabs();
    syncOutRoute();
  }
  function saveAsNew(){
    commitIde();
    var cur=fileBy(ide.active), ta=$('#outCode');
    if (!cur||!ta) return;
    if (ta.value===cur.body){ toast('內容與這一版相同，未另存',''); return; }
    var n=OUTPUTS.reduce(function(m,f){ var x=parseInt(String(f.id).replace(/\D/g,''),10); return isNaN(x)?m:Math.max(m,x); },0)+1;
    var id='ART-'+String(n).padStart(3,'0');
    var name=cur.name.replace(/v(\d+)(?=\.)/i, function(_,d){ return 'v'+(parseInt(d,10)+1); });
    if (name===cur.name) name=cur.name.replace(/(\.[^.]+)$/,' 修訂$1');
    var title=cur.title.replace(/v(\d+)/i, function(_,d){ return 'v'+(parseInt(d,10)+1); });
    if (title===cur.title) title=cur.title+' 修訂';
    OUTPUTS.unshift({
      id:id,title:title,by:cur.by,cite:'',from:cur.id,folder:cur.folder,lang:cur.lang,name:name,
      note:'另存自 '+cur.id+'。舊版保留，沒有覆蓋。',body:ta.value,draft:null
    });
    cur.draft=null;
    openFile(id);
    var meta=$('#outKbMeta'); if (meta) meta.textContent=String(OUTPUTS.length);
    toast('已另存 '+id+'，'+cur.id+' 仍在','ok');
    audit('產出庫另存 '+id+'，保留 '+cur.id);
  }
  function findHits(){
    var q=($('#outFindq')&&$('#outFindq').value)||'';
    var text=$('#outCode')?$('#outCode').value:'';
    if (!q) return [];
    var hits=[], from=0, src=text.toLowerCase(), needle=q.toLowerCase();
    while (needle){
      var i=src.indexOf(needle, from);
      if (i<0) break;
      hits.push(i);
      from=i+Math.max(needle.length,1);
    }
    return hits;
  }
  function findNext(){
    var ta=$('#outCode'); if (!ta) return;
    var hits=findHits();
    var label=$('#outFindn');
    if (!hits.length){ if (label) label.textContent='沒有'; return; }
    ide.findAt=(ide.findAt+1)%hits.length;
    var at=hits[ide.findAt];
    var q=$('#outFindq').value;
    ta.focus();
    ta.setSelectionRange(at, at+q.length);
    if (label) label.textContent=(ide.findAt+1)+' / '+hits.length;
    paintEditor();
  }
  function renderOutputs(){
    if (!$('#outTree')) return;
    var meta=$('#outKbMeta');
    if (meta && meta.textContent!==String(OUTPUTS.length)) meta.textContent=String(OUTPUTS.length);
    var nav=$('#navOutBd');
    if (nav && nav.textContent!==String(OUTPUTS.length)) nav.textContent=String(OUTPUTS.length);
    if (!ide.booted){ ide.booted=1; openFile('ART-014'); return; }
    if (treeSig()!==ide.treeSig) paintTree();
    if (tabSig()!==ide.tabSig) paintTabs();
  }
  (function bindIde(){
    var root=$('#outIde'); if (!root) return;
    root.addEventListener('click', function(e){
      var act=e.target.closest('[data-ide]');
      if (act){
        ide.side=act.getAttribute('data-ide');
        $$('.ide-act').forEach(function(b){ b.classList.toggle('on', b===act); });
        $('#outSideTitle').textContent=ide.side==='search'?'尋找':'產出庫';
        $('#outFilterWrap').hidden=ide.side!=='search';
        paintTree();
        return;
      }
      var close=e.target.closest('[data-close]');
      if (close){ closeTab(close.getAttribute('data-close')); return; }
      var fold=e.target.closest('[data-fold]');
      if (fold){
        var name=fold.getAttribute('data-fold');
        ide.folders[name]=ide.folders[name]===false;
        paintTree();
        return;
      }
      var file=e.target.closest('[data-file]');
      if (file){ openFile(file.getAttribute('data-file')); return; }
      if (e.target.closest('#outSave')){ saveAsNew(); return; }
      if (e.target.closest('#outFindNext')){ findNext(); return; }
    });
    $('#outFilter').addEventListener('input', function(){ paintTree(); });
    var ta=$('#outCode');
    ta.addEventListener('input', function(){ commitIde(); paintEditor(); paintTabs(); paintTree(); });
    ta.addEventListener('keyup', paintEditor);
    ta.addEventListener('click', paintEditor);
    $('#outSheet').addEventListener('scroll', function(){ $('#outGutter').scrollTop=$('#outSheet').scrollTop; });
    $('#outMap').addEventListener('click', function(e){
      var box=this.getBoundingClientRect();
      var p=(e.clientY-box.top)/box.height;
      var sheet=$('#outSheet');
      sheet.scrollTop=p*Math.max(0, sheet.scrollHeight-sheet.clientHeight);
    });
    $('#outFindq').addEventListener('input', function(){ ide.findAt=-1; findNext(); });
    document.addEventListener('keydown', function(e){
      var inEditor=document.activeElement===$('#outCode')||document.activeElement===$('#outFindq');
      if (!inEditor) return;
      if (e.key==='Escape'){ $('#outFind').hidden=true; return; }
      if ((e.metaKey||e.ctrlKey) && (e.key==='s'||e.key==='S')){ e.preventDefault(); saveAsNew(); }
      if ((e.metaKey||e.ctrlKey) && (e.key==='f'||e.key==='F')){
        e.preventDefault();
        $('#outFind').hidden=false;
        $('#outFindq').focus();
        $('#outFindq').select();
      }
    });
  })();
  var SLOT_HOSTS=['slotGrid','slotGridRR','senseSlots','compressBoard','slotRail','pipeLive'];
  var SLOT_KIND={slotGrid:'slot',slotGridRR:'slot',senseSlots:'sync-card',compressBoard:'cmp-card',slotRail:'pip-row',pipeLive:'pipe-slot'};
  var slotNodes={};
  var slotStructSig='';
  function bindCard(card){
    var map={};
    var nodes=card.querySelectorAll('[data-f]');
    for (var i=0;i<nodes.length;i++) map[nodes[i].getAttribute('data-f')]=nodes[i];
    card._f=map;
    return card;
  }
  function indexSlotHosts(){
    slotNodes={};
    SLOT_HOSTS.forEach(function(id){
      var host=document.getElementById(id);
      if (!host) return;
      var bag={};
      var cards=host.querySelectorAll('[data-slot]');
      for (var i=0;i<cards.length;i++) bag[cards[i].getAttribute('data-slot')]=bindCard(cards[i]);
      slotNodes[id]=bag;
    });
  }
  function putText(card, name, text){
    var el=card._f&&card._f[name];
    if (el && el.textContent!==text) el.textContent=text;
  }
  function putBar(card, pct, color){
    var bar=card._f&&card._f.bar;
    if (!bar) return;
    var mark=(pct|0)+'|'+color;
    if (bar.getAttribute('data-mark')===mark) return;
    bar.style.setProperty('--pct',(pct|0)+'%');
    bar.style.background=color;
    bar.setAttribute('data-mark', mark);
  }
  function slotStructKey(){
    return store.slots.map(function(s){ return s.id+'|'+(s.reserve?'r':s.state)+'|'+(s.who||''); }).join(';');
  }
  function slotView(s){
    var info=sensePack(s);
    var cls=s.reserve?'reserve':s.state;
    var st=s.reserve?'保留':(s.state==='busy'?'佔用':'空閒');
    var who=slotWho(s);
    var pct=s.state==='busy'?Math.max(2,Math.min(100,(s.ttl/(s.max||1))*100)):100;
    var color=s.reserve?'linear-gradient(90deg,#8c3a30,var(--red))':s.state==='busy'?'linear-gradient(90deg,#8c6a12,var(--amber))':'linear-gradient(90deg,#2f8a4c,var(--green))';
    var meta=s.reserve?'保留給 P0 搶佔':(s.state==='busy'?'剩餘 '+fmtTtl(s.ttl):'空檔可派發');
    var sensePct=info.live?Math.max(2,Math.min(100,(s.ttl/(s.max||1))*100)):(s.reserve?100:0);
    var senseColor=s.reserve?'linear-gradient(90deg,#8c3a30,var(--red))':info.live?'linear-gradient(90deg,#8c6a12,var(--amber))':'linear-gradient(90deg,#2f8a4c,var(--green))';
    var compress=info.live
      ?('自有稿 '+info.tok+' / '+info.pack.raw+' tok · 留 '+info.keep+'%')
      :(s.reserve?'自備 P0 壓縮包 '+info.pack.raw+' tok，不併入其他槽':'無壓縮稿');
    var perceive=info.live||s.reserve?info.pack.percept+' · 置信 '+info.see.toFixed(2):'無感知鎖';
    var knowledge=info.live||s.reserve?'回寫任務庫 · 只讀世界庫':'兩庫都未掛';
    var bus=s.reserve
      ?'自有壓縮與感知。搶佔時用自己的稿，不接管別槽上下文。增量先停在預留，guard 核可才入任務庫。'
      :(info.live
        ?'只鎖自己的壓縮稿與感知。空檔釋放後銷毀本槽稿，任務庫留下這一條增量，世界庫只歸還閱讀鎖。'
        :'空檔不建壓縮稿、不掛感知、不碰兩座知識庫。派發進來才為本槽新開一份。');
    var head=info.live?(info.tok+' / '+info.pack.raw+' · 留 '+info.keep+'%'):(s.reserve?'P0 預留稿':'無壓縮稿');
    var pipeLine=s.reserve?'P0 預留':(s.state==='busy'?who:'等空檔');
    return {cls:cls,st:st,who:who,pct:pct,color:color,meta:meta,sensePct:sensePct,senseColor:senseColor,
      compress:compress,perceive:perceive,knowledge:knowledge,bus:bus,head:head,pipeLine:pipeLine,info:info};
  }
  function ensureSlotDom(){
    var sig=slotStructKey();
    if (sig===slotStructSig && slotNodes.slotGrid && slotNodes.slotGrid.A1) return false;
    var gridHtml=store.slots.map(function(s){
      return '<div class="slot" data-slot="'+esc(s.id)+'"><div class="s-id"><span>'+esc(s.id)+'</span><span class="st" data-f="st"></span></div>'+
        '<div class="s-who" data-f="who"></div><div class="s-meta" data-f="meta"></div><div class="s-ttl"><i data-f="bar"></i></div></div>';
    }).join('');
    ['slotGrid','slotGridRR'].forEach(function(id){ var g=document.getElementById(id); if (g) g.innerHTML=gridHtml; });
    var sense=document.getElementById('senseSlots');
    if (sense) sense.innerHTML=store.slots.map(function(s){
      return '<article class="sync-card" data-slot="'+esc(s.id)+'">'+
        '<div class="sync-top"><span class="sync-id">'+esc(s.id)+'</span><span class="sync-st" data-f="st"></span></div>'+
        '<div class="sync-who" data-f="who"></div>'+
        '<div class="sync-row"><span class="sync-k">壓縮</span><span class="sync-v" data-f="compress"></span></div>'+
        '<div class="sync-row"><span class="sync-k">感知</span><span class="sync-v" data-f="perceive"></span></div>'+
        '<div class="sync-row"><span class="sync-k">知識庫</span><span class="sync-v" data-f="knowledge"></span></div>'+
        '<div class="sync-ttl"><i data-f="bar"></i></div><div class="sync-bus" data-f="bus"></div></article>';
    }).join('');
    var cmp=document.getElementById('compressBoard');
    if (cmp) cmp.innerHTML=store.slots.map(function(s){
      var info=sensePack(s);
      var body=info.live||s.reserve
        ?'<p class="cmp-line">留 '+esc(info.pack.kept)+'</p><p class="cmp-line drop">丟 '+esc(info.pack.drop)+'</p>'
        :'<p class="cmp-line">空檔不建稿。派發進來才為本槽新壓一份。</p>';
      return '<article class="cmp-card" data-slot="'+esc(s.id)+'"><div class="cmp-top"><b>'+esc(s.id)+'</b><span data-f="head"></span></div>'+body+'</article>';
    }).join('');
    var rail=document.getElementById('slotRail');
    if (rail) rail.innerHTML=store.slots.map(function(s){
      return '<div class="pip-row" data-slot="'+esc(s.id)+'"><b>'+esc(s.id)+'</b><em data-f="st"></em><span data-f="who"></span></div>';
    }).join('');
    var pipe=document.getElementById('pipeLive');
    if (pipe) pipe.innerHTML=store.slots.map(function(s){
      return '<div class="pipe-slot" data-slot="'+esc(s.id)+'"><b data-f="title"></b><span data-f="line"></span></div>';
    }).join('');
    indexSlotHosts();
    renderKnowledge();
    slotStructSig=sig;
    return true;
  }
  function paintSlotValues(){
    if (!slotNodes.slotGrid) ensureSlotDom();
    var views={};
    store.slots.forEach(function(s){ views[s.id]=slotView(s); });
    SLOT_HOSTS.forEach(function(id){
      var bag=slotNodes[id];
      if (!bag) return;
      var kind=SLOT_KIND[id];
      store.slots.forEach(function(s){
        var card=bag[s.id];
        if (!card) return;
        var view=views[s.id];
        if (card.getAttribute('data-cls')!==view.cls){
          card.className=kind+' '+view.cls;
          card.setAttribute('data-cls', view.cls);
        }
        if (id==='slotGrid'||id==='slotGridRR'){
          putText(card,'st',view.st); putText(card,'who',view.who); putText(card,'meta',view.meta);
          putBar(card, view.pct, view.color);
        } else if (id==='senseSlots'){
          putText(card,'st',view.st); putText(card,'who',view.who);
          putText(card,'compress',view.compress); putText(card,'perceive',view.perceive);
          putText(card,'knowledge',view.knowledge); putText(card,'bus',view.bus);
          putBar(card, view.sensePct, view.senseColor);
        } else if (id==='compressBoard'){
          putText(card,'head',view.head);
        } else if (id==='slotRail'){
          putText(card,'st',view.st); putText(card,'who',view.who);
        } else {
          putText(card,'title',s.id+' '+view.st); putText(card,'line',view.pipeLine);
        }
      });
    });
  }
  function renderSlots(){
    var built=ensureSlotDom();
    paintSlotValues();
    if (built) renderNumbers();
  }
  var pipeFocus='route';
  function applyPipeFocus(){
    $$('#pipeTel .tcell').forEach(function(el){ el.classList.toggle('on',el.getAttribute('data-pipe')===pipeFocus); });
    $$('#topic-pipe .pipe-step').forEach(function(el){ el.classList.toggle('on',el.getAttribute('data-stage')===pipeFocus); });
  }
  document.addEventListener('click',function(e){
    var cell=e.target.closest('#pipeTel [data-pipe]');
    if (!cell) return;
    pipeFocus=cell.getAttribute('data-pipe');
    applyPipeFocus();
  });
  var lockRows=[];
  function cacheLocks(){
    lockRows=$$('#lockList .lock-row');
    lockRows.forEach(function(row){
      row._ttlEl=$('.lock-ttl',row);
      row._barEl=$('.ttl-track i',row);
    });
  }
  function renderLocks(){
    var el=$('#lockList'); if (!el) return;
    el.innerHTML=store.locks.map(function(l){
      var cls=l.ttl>300?'ok':l.ttl>90?'warn':'bad';
      return '<div class="lock-row" data-seat="'+esc(l.seat)+'" data-ttl="'+l.ttl+'" data-max="'+l.max+'">'+
        '<div class="lock-seat"><i style="background:'+l.color+'"></i>'+esc(l.seat)+'</div>'+
        '<div class="lock-info"><div class="li-1">'+esc(l.li1)+'</div>'+
        '<div class="li-2">'+l.li2.map(function(x){return '<span>'+esc(x)+'</span>';}).join('')+'</div>'+
        '<div class="ttl-track"><i style="--pct:'+((l.ttl/l.max)*100).toFixed(0)+'%"></i></div></div>'+
        '<div class="lock-ttl '+cls+'">--:--</div></div>';
    }).join('');
    cacheLocks();
  }
  function renderAlerts(){
    var el=$('#alertList'); if (!el) return;
    el.innerHTML=store.alerts.map(function(a){
      var c=a.tone==='red'?'red':a.tone==='amber'?'amber':'orange';
      return '<div class="alert" data-alert="'+esc(a.id)+'">'+
        '<div class="a-ic" style="color:var(--'+c+');border-color:rgba(238,92,76,.3);background:rgba(238,92,76,.07)"><svg><use href="#'+a.icon+'"/></svg></div>'+
        '<div class="a-main"><div class="a-t" style="color:var(--'+c+')">'+esc(a.title)+'</div>'+
        '<div class="a-d">'+esc(a.desc)+'</div></div>'+
        '<div class="a-side"><div class="a-time">'+esc(a.time)+'</div><button class="a-x" aria-label="消除告警">✕</button></div></div>';
    }).join('')||'<div class="lane-empty">無活動告警</div>';
    $('#alertCount').textContent=store.alerts.length;
  }
  function renderAudit(){
    var el=$('#auditList'); if (!el) return;
    el.innerHTML=store.audits.length
      ? store.audits.slice(0,6).map(function(a){
          return '<div class="audit-row"><span class="who">'+esc(a.who)+'</span><span class="act">'+esc(a.act)+'</span><span>'+esc(a.time)+'</span></div>';
        }).join('')
      : '<div class="lane-empty" style="padding:10px 4px">尚無操作</div>';
  }
  function audit(act,who,reason){
    store.audits.unshift({who:who||'AD',act:act+(reason?' · 原因：'+reason:''),time:fmtTime(new Date())});
    renderAudit();
  }

  /* ================= TOAST ================= */
  function toast(msg,tone){
    var wrap=$('#toastWrap'); if (!wrap) return;
    var el=document.createElement('div');
    el.className='toast '+(tone||'ok');
    el.innerHTML='<div class="t-msg">'+esc(msg)+'</div><button class="t-x" aria-label="關閉">✕</button>';
    el.querySelector('.t-x').addEventListener('click',function(){ el.remove(); });
    wrap.appendChild(el);
    rise(el, 16, 420);
    setTimeout(function(){ if (el.parentNode) el.remove(); },4200);
  }

  /* ================= 事件流（上限 200） ================= */
  var stream=$('#eventStream');
  function pushEvent(color,html){
    if (!stream) return;
    var el=document.createElement('div');
    el.className='ev new';
    el.innerHTML='<span class="ts">'+fmtTime(new Date())+'</span><span class="bul" style="background:'+color+'"></span><span class="msg">'+html+'</span>';
    stream.prepend(el);
    rise(el, -8, 340);
    while (stream.children.length>200) stream.removeChild(stream.lastChild);
    store.lastSync=new Date();
    renderNumbers();
  }

  /* ================= optimistic ================= */
  function optimistic(apply,rollback,okMsg,failMsg){
    try{
      apply();
      if (Math.random()<0.12) throw new Error('simulated');
      toast(okMsg,'ok'); pushEvent('#5fd97d','<b>ok</b> '+esc(okMsg));
    }catch(err){
      rollback();
      toast(failMsg||'操作失敗，已回滾','err');
      pushEvent('#ee5c4c','<b>rollback</b> '+esc(failMsg||'操作失敗'));
    }
  }

  /* ================= DIALOG（二次確認 + 原因） ================= */
  var dlgMask=$('#dlgMask'), dlgPrevFocus=null;
  function openDialog(opt){
    dlgPrevFocus=document.activeElement;
    $('#dlgTitle').textContent=opt.title||'確認操作';
    $('#dlgDesc').textContent=opt.desc||'';
    $('#dlgReason').value='';
    dlgMask.hidden=false;
    var panel=$('.dlg',dlgMask);
    if (panel) rise(panel, 12, 280);
    $('#dlgReason').focus();
    function close(){ dlgMask.hidden=true; if (dlgPrevFocus&&dlgPrevFocus.focus) dlgPrevFocus.focus(); }
    $('#dlgCancel').onclick=close;
    $('#dlgOk').onclick=function(){
      var reason=$('#dlgReason').value.trim();
      if (!reason){ $('#dlgReason').focus(); toast('請填寫操作原因','err'); return; }
      var who=$('#dlgWho').value.trim()||'AD';
      close();
      opt.onConfirm(who,reason);
    };
    /* 簡易 focus trap */
    dlgMask.onkeydown=function(e){
      if (e.key==='Escape'){ e.preventDefault(); close(); return; }
      if (e.key!=='Tab') return;
      var f=$$('button,input',dlgMask);
      var first=f[0],last=f[f.length-1];
      if (e.shiftKey&&document.activeElement===first){ e.preventDefault(); last.focus(); }
      else if (!e.shiftKey&&document.activeElement===last){ e.preventDefault(); first.focus(); }
    };
  }

  /* ================= SEARCH（debounce + 安全高亮） ================= */
  var searchTimer=null, currentQuery='';
  function clearHighlight(root){
    $$('mark',root).forEach(function(m){
      var parent=m.parentNode;
      parent.replaceChild(document.createTextNode(m.textContent),m);
      parent.normalize();
    });
  }
  function highlight(el,q){
    var walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT,null);
    var nodes=[];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function(node){
      if (!node.nodeValue||node.nodeValue.toLowerCase().indexOf(q)<0) return;
      var frag=document.createDocumentFragment(), rest=node.nodeValue;
      for(;;){
        var i=rest.toLowerCase().indexOf(q);
        if (i<0){ frag.appendChild(document.createTextNode(rest)); break; }
        frag.appendChild(document.createTextNode(rest.slice(0,i)));
        var mk=document.createElement('mark');
        mk.textContent=rest.slice(i,i+q.length); /* textContent，不注入 HTML */
        frag.appendChild(mk);
        rest=rest.slice(i+q.length);
      }
      node.parentNode.replaceChild(frag,node);
    });
  }
  function applyQuery(){
    var active=$('.waterfall.on'); if (!active) return 0;
    var q=currentQuery, hits=0;
    if (!q){
      if (active.getAttribute('data-queried')==='1'){
        clearHighlight(active);
        $$('.hide',active).forEach(function(el){ el.classList.remove('hide'); });
        $$('.dimmed',active).forEach(function(el){ el.classList.remove('dimmed'); });
        $$('.scard',active).forEach(function(el){ if (el.style.opacity) el.style.opacity=''; });
        active.removeAttribute('data-queried');
      }
      var ce0=$('#searchCount'); if (ce0 && ce0.textContent) ce0.textContent='';
      var mc0=$('#mobileSearchCount'); if (mc0 && mc0.textContent) mc0.textContent='';
      return 0;
    }
    active.setAttribute('data-queried','1');
    clearHighlight(active);
    $$('.qcard',active).forEach(function(el){
      var m=!q||el.textContent.toLowerCase().indexOf(q)>-1;
      el.classList.toggle('hide',!!q&&!m);
      if (m&&q){ hits++; highlight(el,q); }
    });
    $$('.ccard',active).forEach(function(el){
      var m=!q||el.textContent.toLowerCase().indexOf(q)>-1;
      el.classList.toggle('hide',!!q&&!m);
      if (m&&q){ hits++; highlight(el,q); }
    });
    $$('.flow-node',active).forEach(function(el){
      var m=!q||el.textContent.toLowerCase().indexOf(q)>-1;
      el.classList.toggle('hide',!!q&&!m);
      if (m&&q){ hits++; highlight(el,q); }
    });
    $$('table tbody tr',active).forEach(function(row){
      var m=!q||row.textContent.toLowerCase().indexOf(q)>-1;
      row.classList.toggle('dimmed',!!q&&!m);
      if (m&&q){ hits++; if (hits<40) highlight(row,q); }
    });
    $$('.scard',active).forEach(function(el){
      var m=!q||el.textContent.toLowerCase().indexOf(q)>-1;
      el.style.opacity=m?'':'.35';
      if (m&&q) hits++;
    });
    $$('.oss-card',active).forEach(function(el){
      var m=!q||el.textContent.toLowerCase().indexOf(q)>-1;
      el.classList.toggle('hide',!!q&&!m);
      if (m&&q) hits++;
    });
    $$('.par-lane',active).forEach(function(el){
      var m=!q||el.textContent.toLowerCase().indexOf(q)>-1;
      el.classList.toggle('hide',!!q&&!m);
      if (m&&q) hits++;
    });
    $$('.acq-row',active).forEach(function(el){
      var m=!q||el.textContent.toLowerCase().indexOf(q)>-1;
      el.classList.toggle('hide',!!q&&!m);
      if (m&&q) hits++;
    });
    var ce=$('#searchCount');
    if (ce) ce.textContent=q?(hits?'命中 '+hits:'無命中'):'';
    var mc=$('#mobileSearchCount');
    if (mc) mc.textContent=q?(hits?'命中 '+hits+' 筆':'無符合結果'):'';
    return hits;
  }
  function runSearch(q){ currentQuery=(q||'').trim().toLowerCase(); applyQuery(); }
  function onSearchInput(val){
    clearTimeout(searchTimer);
    searchTimer=setTimeout(function(){ runSearch(val); },300);
  }

  /* ================= clock ================= */
  function tickClock(){
    var el=metricNodes.clock||document.getElementById('clock');
    if (el) el.textContent=fmtTime(new Date());
  }
  tickClock();
  every(1000, tickClock, {clock:true});

  /* ================= [P0-4] motion：CSS + SMIL 同步 ================= */
  var motionBtn=$('#motionBtn');
  function applyMotion(reduced){
    document.body.classList.toggle('reduce-motion',reduced);
    $$('svg.pipeline-svg, .trav').forEach(function(s){
      var root=s.ownerSVGElement||s;
      if (reduced&&root.pauseAnimations) root.pauseAnimations();
      else if (!reduced&&root.unpauseAnimations) root.unpauseAnimations();
    });
    if (motionBtn){
      motionBtn.classList.toggle('on',reduced);
      motionBtn.setAttribute('aria-pressed',String(reduced));
    }
    tipInstances.forEach(function(t){
      if (t&&t.setProps) t.setProps({duration:reduced?0:[180,120],animation:reduced?'fade':'shift-away-subtle'});
    });
  }
  var mq=window.matchMedia('(prefers-reduced-motion: reduce)');
  applyMotion(mq.matches);
  if (mq.addEventListener) mq.addEventListener('change',function(e){ applyMotion(e.matches); });
  motionBtn.addEventListener('click',function(){
    applyMotion(!document.body.classList.contains('reduce-motion'));
    toast(document.body.classList.contains('reduce-motion')?'已開啟減少動畫（含 SMIL）':'已恢復動畫','ok');
  });

  /* ================= pause（暫停渲染，訂閱保留） ================= */
  function togglePause(){
    store.paused=!store.paused;
    var b=$('#pauseBtn');
    b.textContent=store.paused?'▶':'⏸';
    b.classList.toggle('on',store.paused);
    b.setAttribute('aria-pressed',String(store.paused));
    var lt=$('#liveTag');
    lt.innerHTML=store.paused?'<span class="dot" style="background:var(--amber);animation:none"></span>PAUSED':'<span class="dot"></span>LIVE';
    lt.style.color=store.paused?'var(--amber)':'';
    toast(store.paused?('暫停渲染（訂閱保留）· 最後同步 '+fmtTime(store.lastSync)):'已恢復渲染','ok');
    pushEvent('#f0a500', store.paused?'<b>system</b> 渲染暫停 · 訂閱保留':'<b>system</b> 渲染已恢復');
  }
  $('#pauseBtn').addEventListener('click',togglePause);

  function toggleAuto(){
    store.autoClaim=!store.autoClaim;
    var b=$('#autoClaimBtn');
    b.classList.toggle('on',store.autoClaim);
    b.textContent=store.autoClaim?'AUTO':'MANUAL';
    b.setAttribute('aria-pressed',String(store.autoClaim));
    var chip=$('#autoChip');
    if (chip){ chip.textContent=store.autoClaim?'AUTO-CLAIM ON':'AUTO-CLAIM OFF'; chip.className='chip '+(store.autoClaim?'green':'red'); }
    pushEvent(store.autoClaim?'#5fd97d':'#ee5c4c','<b>auto-claim</b> '+(store.autoClaim?'已啟用':'已停用'));
    toast(store.autoClaim?'自動認領已啟用':'自動認領已停用','ok');
    audit('切換自動認領 → '+(store.autoClaim?'ON':'OFF'));
  }
  $('#autoClaimBtn').addEventListener('click',toggleAuto);

  /* ================= 路由 + 轉頁 ================= */
  var TOPICS=['collect','queue','sense','out','seat','pipe','infra','oss','studio'];
  var TOPIC_META={
    collect:{label:'任務收集',hint:'待收項確認後才進隊列 · 這頁不拉取外部內容'},
    queue:{label:'任務隊列',hint:'席位自動拉取任務 · 等 LLM 空檔才執行'},
    sense:{label:'感測上下文',hint:'壓縮與文本感知 · 8 槽各自回寫'},
    out:{label:'產出庫',hint:'另存新版 · 舊檔不覆蓋'},
    seat:{label:'席位執行',hint:'任務經理拆分 · 席位自動拉取'},
    pipe:{label:'統一管線',hint:'resolve_execution_path · 唯一判斷源'},
    infra:{label:'基礎設施',hint:'Docker Compose · 阿里雲唯讀'},
    oss:{label:'開源組件',hint:'GitHub 鎖定版本 · 候選不進主棧'},
    studio:{label:'UI 生成',hint:'一句話需求 → 線框圖 · 只出結構不出像素'}
  };
  var INFRA_PANES=['docker','ecs','bill','cost'];
  var INFRA_LABEL={docker:'Docker',ecs:'ECS',bill:'帳單',cost:'成本預算'};
  var routeState={topic:'',pane:null,focus:null};
  var lastInfra='docker';
  var routeAnimToken=0;
  if ('scrollRestoration' in history) history.scrollRestoration='manual';

  function sameRoute(a,b){
    if (!a||!b) return false;
    return a.topic===b.topic && (a.pane||null)===(b.pane||null) && (a.focus||null)===(b.focus||null);
  }
  function routePath(r){
    var topic=r.topic||'queue';
    if (topic==='infra') return topic+'/'+(r.pane||'docker');
    if (r.focus) return topic+'/'+encodeURIComponent(r.focus);
    return topic;
  }
  function parseLocation(){
    var raw='';
    try { raw=decodeURIComponent((location.hash||'').replace(/^#/,'')); }
    catch (err) { raw=(location.hash||'').replace(/^#/,''); }
    raw=raw.replace(/^\/+/,'').replace(/\/+$/,'');
    var parts=raw.split('/').filter(Boolean);
    var topic=TOPICS.indexOf(parts[0])>=0?parts[0]:'queue';
    var pane=null,focus=null;
    if (topic==='infra') pane=INFRA_PANES.indexOf(parts[1])>=0?parts[1]:'docker';
    else if (parts[1] && /^[A-Za-z0-9][A-Za-z0-9._-]{0,40}$/.test(parts[1])) focus=parts[1];
    return {topic:topic,pane:pane,focus:focus};
  }
  function normalizeRoute(partial){
    var topic=partial.topic && TOPICS.indexOf(partial.topic)>=0 ? partial.topic : (routeState.topic||'queue');
    var pane=null,focus=null;
    if (topic==='infra'){
      var want=partial.pane || (topic===routeState.topic ? routeState.pane : lastInfra);
      pane=INFRA_PANES.indexOf(want)>=0?want:'docker';
    } else if (partial.focus) focus=String(partial.focus);
    return {topic:topic,pane:pane,focus:focus};
  }
  function writeHash(hash,mode){
    if (location.hash===hash) return;
    try {
      if (mode==='replace') history.replaceState(null,'',hash);
      else location.hash=hash;
    } catch (err) {
      location.hash=hash;
    }
  }
  function clearLeave(el){
    el.classList.remove('is-leave','dir-fwd','dir-back');
    el.style.top='';
    el.removeAttribute('data-leave-token');
  }
  function pulseSweep(dir){
    if (document.body.classList.contains('reduce-motion')) return;
    var bar=$('#topicBar'); if (!bar) return;
    bar.classList.remove('sweep','sweep-back');
    void bar.offsetWidth;
    bar.classList.add(dir<0?'sweep-back':'sweep');
  }
  function scrollPanelsTop(){
    var stage=$('.stage');
    if (stage) stage.scrollTop=0;
    if (window.scrollY>0) window.scrollTo(0,0);
  }
  function showTopic(topic,dir,animate){
    scrollPanelsTop();
    $$('.waterfall.is-leave').forEach(clearLeave);
    var to=document.getElementById('topic-'+topic);
    var from=$('.waterfall.on');
    if (!to) return;
    var motion=!!(animate && from && from!==to && dir!==0 && !document.body.classList.contains('reduce-motion'));
    if (!motion){
      $$('.waterfall').forEach(function(w){
        clearLeave(w);
        w.classList.remove('on');
        w.setAttribute('aria-hidden','true');
      });
      to.classList.add('on');
      to.setAttribute('aria-hidden','false');
      return;
    }
    var token=++routeAnimToken;
    var dirClass=dir>0?'dir-fwd':'dir-back';
    var top=from.offsetTop;
    to.classList.remove('is-leave','dir-fwd','dir-back');
    to.classList.add('on');
    from.classList.remove('on','dir-fwd','dir-back');
    from.classList.add('is-leave',dirClass);
    from.style.top=top+'px';
    from.setAttribute('data-leave-token',String(token));
    from.setAttribute('aria-hidden','true');
    void to.offsetWidth;
    to.classList.add(dirClass);
    to.setAttribute('aria-hidden','false');
    pulseSweep(dir);
    var finish=function(){
      if (from.getAttribute('data-leave-token')!==String(token)) return;
      if (from.classList.contains('on')) return;
      clearLeave(from);
      from.setAttribute('aria-hidden','true');
    };
    from.addEventListener('animationend',function onEnd(ev){
      if (ev.target!==from) return;
      from.removeEventListener('animationend',onEnd);
      finish();
    });
    setTimeout(finish,560);
  }
  function showInfraPane(pane,animate){
    $$('#infraTabs .tab-btn').forEach(function(x){
      var on=x.getAttribute('data-pane')===pane;
      x.setAttribute('aria-selected',on?'true':'false');
      x.tabIndex=on?0:-1;
    });
    var next=document.getElementById('pane-'+pane);
    $$('.tab-pane').forEach(function(p){
      p.classList.remove('on','pane-in');
      p.setAttribute('aria-hidden','true');
    });
    if (!next) return;
    next.classList.add('on');
    next.setAttribute('aria-hidden','false');
    if (animate && !document.body.classList.contains('reduce-motion')){
      void next.offsetWidth;
      next.classList.add('pane-in');
    }
    var stage=$('.stage');
    if (animate && stage) scrollPanelsTop();
    if (pane==='cost') ensureCostCharts();
  }
  function syncChrome(r){
    var t=r.topic;
    $$('#topicBar .topic-btn').forEach(function(b){
      var on=b.getAttribute('data-topic')===t;
      b.setAttribute('aria-selected',String(on));
      b.tabIndex=on?0:-1;
    });
    $$('.nav-item[data-topic]').forEach(function(n){
      var on=n.getAttribute('data-topic')===t;
      n.classList.toggle('active',on);
      if (on) n.setAttribute('aria-current','page');
      else n.removeAttribute('aria-current');
    });
    $$('.tabs .tab').forEach(function(x){
      var on=x.getAttribute('data-topic')===t;
      x.classList.toggle('active',on);
      if (on) x.setAttribute('aria-current','page');
      else x.removeAttribute('aria-current');
    });
    var meta=TOPIC_META[t]||TOPIC_META.queue;
    var hintText=meta.hint;
    if (t==='infra') hintText='基礎設施 / '+(INFRA_LABEL[r.pane]||r.pane);
    else if (r.focus) hintText=meta.label+' / '+r.focus;
    var hint=$('#topicHint');
    if (hint) hint.textContent='#/'+routePath(r)+'  ·  '+hintText;
    var bar=$('#topicBar');
    if (bar) bar.setAttribute('data-route',routePath(r));
    document.title='靈境·Linkin · '+meta.label+(t==='infra'&&r.pane?' / '+INFRA_LABEL[r.pane]:r.focus?' / '+r.focus:'');
    document.body.setAttribute('data-topic', t);
  }
  function revealFocus(r,fromNav){
    if (!(r.topic==='sense' && r.focus)){
      if ($('.scard.selected')) clearSensorFilter();
    $$('.qcard.linked,.flow-node.linked,.ccard.linked').forEach(function(q){ q.classList.remove('linked'); });
    }
    if (!r.focus) return;
    var behave=document.body.classList.contains('reduce-motion')?'auto':'smooth';
    if (r.topic==='collect'){
      renderCollect();
      var inbox=document.querySelector('.ccard[data-id="'+r.focus+'"]');
      if (inbox){
        inbox.classList.add('linked');
        if (fromNav) inbox.scrollIntoView({behavior:behave,block:'center'});
      }
    } else if (r.topic==='queue'){
      var card=document.querySelector('.qcard[data-id="'+r.focus+'"]');
      var flow=document.querySelector('.flow-node[data-id="'+r.focus+'"]');
      if (card){
        card.classList.add('linked');
        if (fromNav) card.scrollIntoView({behavior:behave,block:'center'});
      }
      if (flow){
        flow.classList.add('linked');
        if (fromNav && !card) flow.scrollIntoView({behavior:behave,block:'nearest',inline:'center'});
      }
    } else if (r.topic==='seat'){
      if (r.focus==='T-2841'){
        var head=$('#topic-seat .t-id');
        if (head && fromNav) head.scrollIntoView({behavior:behave,block:'center'});
        return;
      }
      var cell=document.querySelector('#seats .seat[data-seat="'+r.focus+'"]');
      if (cell) selectSeat(cell,{fromRoute:true,scroll:!!fromNav});
      else {
        var row=document.querySelector('#seatRoster tr[data-seat="'+r.focus+'"]');
        $$('.seat').forEach(function(s){ s.classList.remove('selected'); });
        $$('#seatRoster tbody tr').forEach(function(tr){ tr.classList.remove('sel'); });
        if (row){
          row.classList.add('sel');
          if (fromNav) row.scrollIntoView({behavior:behave,block:'nearest'});
        }
      }
    } else if (r.topic==='oss'){
      if (OSS_LIST.some(function(x){ return x.id===r.focus; })) ossPick=r.focus;
      renderOss();
      var picked=document.querySelector('.oss-card[data-oss-id="'+r.focus+'"]');
      if (picked && fromNav) picked.scrollIntoView({behavior:behave,block:'nearest'});
    } else if (r.topic==='sense'){
      var sc=document.querySelector('.scard[data-sensor="'+r.focus+'"]');
      if (sc) applySensorFilter(r.focus,sc,true);
    } else if (r.topic==='out'){
      if (OUTPUTS.some(function(f){ return f.id===r.focus; })) openFile(r.focus,{silent:true});
    }
  }
  function paintRoute(prev,next){
    syncChrome(next);
    var topicChanged=!prev || prev.topic!==next.topic;
    var paneChanged=next.topic==='infra' && (!prev || prev.pane!==next.pane);
    var dir=prev ? TOPICS.indexOf(next.topic)-TOPICS.indexOf(prev.topic) : 0;
    if (topicChanged) showTopic(next.topic,dir,!!prev && prev.topic!=='');
    else $$('.waterfall.is-leave').forEach(clearLeave);
    if (next.topic==='infra' && (topicChanged || paneChanged)){
      showInfraPane(next.pane,!!(prev && prev.topic==='infra' && paneChanged));
    }
    revealFocus(next,!!(next.focus || (prev && prev.topic)));
    if (next.topic==='out'){
      ensureHighlight().then(function(hl){ if (hl) paintEditor(); });
      requestAnimationFrame(paintEditor);
    }
    var gs=$('#globalSearch');
    runSearch(gs?gs.value:'');
  }
  function go(partial,mode){
    var next=normalizeRoute(partial);
    if (sameRoute(next,routeState)) return;
    var prev=routeState.topic?routeState:null;
    routeState=next;
    if (next.topic==='infra') lastInfra=next.pane;
    paintRoute(prev,next);
    writeHash('#/'+routePath(next), mode==='replace'?'replace':'push');
  }
  function syncFromBrowser(){
    var parsed=parseLocation();
    var hash='#/'+routePath(parsed);
    if (location.hash!==hash) writeHash(hash,'replace');
    if (sameRoute(parsed,routeState)) return;
    var prev=routeState.topic?routeState:null;
    routeState=parsed;
    if (parsed.topic==='infra') lastInfra=parsed.pane;
    paintRoute(prev,parsed);
  }
  function setTopic(t){
    if (TOPICS.indexOf(t)<0) return;
    if (t==='infra') go({topic:'infra',pane:routeState.topic==='infra'?routeState.pane:lastInfra,focus:null});
    else go({topic:t,pane:null,focus:null});
  }
  function bootRouter(){ syncFromBrowser(); }
  window.addEventListener('hashchange',syncFromBrowser);
  window.addEventListener('popstate',syncFromBrowser);
  $$('[data-topic]').forEach(function(el){
    if (el.matches('.topic-btn, .nav-item, .tab, .mini-btn[data-topic]'))
      el.addEventListener('click',function(){ setTopic(el.getAttribute('data-topic')); });
  });
  function setupRoving(container,itemSel,onMove){
    var items=$$(itemSel,container);
    items.forEach(function(it){ it.tabIndex=it.getAttribute('aria-selected')==='true'?0:-1; });
    container.addEventListener('keydown',function(e){
      var idx=items.indexOf(document.activeElement); if (idx<0) return;
      var next=null;
      if (e.key==='ArrowRight') next=(idx+1)%items.length;
      else if (e.key==='ArrowLeft') next=(idx-1+items.length)%items.length;
      else if (e.key==='Home') next=0;
      else if (e.key==='End') next=items.length-1;
      if (next!==null){
        e.preventDefault();
        items.forEach(function(x){ x.tabIndex=-1; });
        items[next].tabIndex=0; items[next].focus();
        if (onMove) onMove(items[next]);
      }
    });
  }
  setupRoving($('#topicBar'),'.topic-btn');
  setupRoving($('#infraTabs'),'.tab-btn',function(btn){ btn.click(); });

  /* infra 子分頁 → #/infra/<pane> */
  $('#infraTabs').addEventListener('click',function(e){
    var b=e.target.closest('.tab-btn'); if (!b) return;
    go({topic:'infra',pane:b.getAttribute('data-pane'),focus:null});
  });

  /* ================= sparkline ================= */
  function drawSpark(svg,data,color,h){
    h=h||30; var w=100,pad=2,min=Math.min.apply(null,data),max=Math.max.apply(null,data),span=(max-min)||1;
    var pts=data.map(function(v,i){
      var x=pad+(i/(data.length-1))*(w-pad*2),y=h-pad-((v-min)/span)*(h-pad*2);
      return x.toFixed(1)+','+y.toFixed(1);});
    svg.setAttribute('viewBox','0 0 '+w+' '+h); svg.setAttribute('preserveAspectRatio','none');
    var thr=svg.getAttribute('data-threshold'),thrLine='';
    if (thr!==null){ var tv=parseFloat(thr);
      if (tv>=min&&tv<=max){ var ty=(h-pad-((tv-min)/span)*(h-pad*2)).toFixed(1);
        thrLine='<line x1="0" y1="'+ty+'" x2="100" y2="'+ty+'" stroke="#ee5c4c" stroke-width="1" stroke-dasharray="3 3" opacity=".8"/>'; } }
    svg.innerHTML=thrLine+
      '<polyline points="'+pts.join(' ')+'" fill="none" stroke="'+color+'" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" opacity=".9"/>'+
      '<polygon points="'+pad+','+(h-pad)+' '+pts.join(' ')+' '+(w-pad)+','+(h-pad)+'" fill="'+color+'" opacity=".1"/>'+
      '<circle cx="'+pts[pts.length-1].split(',')[0]+'" cy="'+pts[pts.length-1].split(',')[1]+'" r="2" fill="'+color+'"/>';
  }
  $$('svg[data-spark]').forEach(function(svg){
    drawSpark(svg,svg.getAttribute('data-spark').split(',').map(Number),svg.getAttribute('data-color')||'#f0a500',svg.classList.contains('mspark')?17:32);
  });

  /* ================= 感測模組 ================= */
  var sensors={
    'CTX-WIN':{val:76,dec:0,warn:[72,88],drift:1.4,win:[]},
    'CTX-CMP':{val:34,dec:0,warn:[48,62],drift:1.2,win:[]},
    'TXT-SEE':{val:0.74,dec:2,warn:[0.62,0.85],drift:0.02,win:[]}
  };
  Object.keys(sensors).forEach(function(id){ for(var i=0;i<24;i++) sensors[id].win.push(sensors[id].val); });
  function pct(a,q){ var s=a.slice().sort(function(x,y){return x-y;}); return s[Math.min(s.length-1,Math.floor(q*s.length))]; }
  function renderSensor(id){
    var cfg=sensors[id],card=$('.scard[data-sensor="'+id+'"]');
    if (!card) return;
    var st=cfg.val<cfg.warn[0]?'ok':cfg.val<cfg.warn[1]?'warn':'alarm';
    var changed=card.getAttribute('data-state')!==st;
    card.setAttribute('data-state',st);
    $('.sc-state',card).innerHTML='<span class="sig '+(st==='ok'?'ok':st==='warn'?'warn':'lock')+'"></span>'+(st==='ok'?'正常':st==='warn'?'警戒':'告警');
    var vEl=$('[data-sensor-val]',card); if (vEl) vEl.textContent=cfg.val.toFixed(cfg.dec);
    var dEl=$('[data-sensor-delta]',card);
    if (dEl){ var d=cfg.val-cfg.win[cfg.win.length-2];
      dEl.textContent=(d>=0?'▲ +':'▼ ')+Math.abs(d).toFixed(cfg.dec);
      dEl.className='delta '+(d>=0?'up':'down'); }
    var mk=$('[data-thr-marker]',card);
    if (mk){ var lo=Math.min.apply(null,cfg.win)-cfg.drift*3,hi=cfg.warn[1]+cfg.drift*3;
      mk.style.left=Math.max(2,Math.min(96,(cfg.val-lo)/(hi-lo)*100)).toFixed(0)+'%'; }
    ['min','avg','max','p95'].forEach(function(k){
      var el=$('[data-stat="'+id+':'+k+'"]',card); if (!el) return;
      var w=cfg.win;
      var v=k==='min'?Math.min.apply(null,w):k==='max'?Math.max.apply(null,w):
            k==='avg'?w.reduce(function(a,b){return a+b;},0)/w.length:pct(w,0.95);
      el.textContent=v.toFixed(cfg.dec); });
    var fresh=$('[data-fresh]',card);
    if (fresh) fresh.innerHTML='<i></i>'+(Math.random()*0.8+0.2).toFixed(1)+'s';
    var spark=$('svg[data-spark]',card);
    if (spark){ var data=cfg.win.slice(-14); spark.setAttribute('data-spark',data.join(','));
      drawSpark(spark,data,spark.getAttribute('data-color'),32); }
    if (changed&&st==='alarm'){
      pushEvent('#ee5c4c','<b>'+esc(id)+'</b> 上下文壓力超過告警線');
      addAlert('alarm-'+id,id+' 超過告警線','壓縮或感知已進入告警，只建立候選');
    }
  }
  function addAlert(id,title,desc){
    if (store.alerts.some(function(a){ return a.id===id; })) return;
    store.alerts.unshift({id:id,tone:'red',icon:'i-warn',title:title,desc:desc,time:'剛剛'});
    renderAlerts();
  }
  every(2200, function(){
    if (store.paused||document.hidden) return;
    Object.keys(sensors).forEach(function(id){
      var cfg=sensors[id];
      cfg.val=Math.round((cfg.val+(Math.random()-0.5)*cfg.drift*2)*1000)/1000;
      cfg.win.push(cfg.val); if (cfg.win.length>24) cfg.win.shift();
      renderSensor(id); });
  });

  /* 感測過濾 */
  var filterBtn=$('#clearSensorFilter');
  function applySensorFilter(sid,card,quiet){
    $$('.scard').forEach(function(c){ c.classList.toggle('selected',c===card); });
    var related=[];
    $$('.qcard').forEach(function(q){
      var list=(q.getAttribute('data-sensors')||'').split(',').map(function(s){return s.trim();});
      var hit=list.indexOf(sid)>-1;
      q.classList.toggle('linked',hit); q.classList.toggle('dimmed',!hit);
      if (hit) related.push(q.getAttribute('data-id')); });
    $$('#seatRoster tbody tr').forEach(function(r){
      var hit=related.some(function(id){ return r.textContent.indexOf(id)>-1; });
      r.classList.toggle('linked',hit); r.classList.toggle('dimmed',!hit); });
    filterBtn.style.display='inline-block';
    filterBtn.textContent='✕ '+sid+'（'+related.length+'）';
    if (!quiet){
      pushEvent('#43d4e4','<b>filter</b> '+esc(sid)+' 命中 '+(related.join('/')||'無'));
      toast('已依 '+sid+' 過濾關聯項目','ok');
    }
  }
  function clearSensorFilter(){
    $$('.scard').forEach(function(c){ c.classList.remove('selected'); });
    $$('.qcard').forEach(function(q){ q.classList.remove('linked','dimmed'); });
    $$('#seatRoster tbody tr').forEach(function(r){ r.classList.remove('linked','dimmed'); });
    filterBtn.style.display='none';
  }
  filterBtn.addEventListener('click',clearSensorFilter);

  document.addEventListener('click',function(e){
    var fb=e.target.closest('[data-filter-sensor]');
    if (fb){ applySensorFilter(fb.getAttribute('data-filter-sensor'),fb.closest('.scard')); return; }
    var ab=e.target.closest('[data-alarm-log]');
    if (ab){
      var sid=ab.getAttribute('data-alarm-log');
      audit('記錄異常 '+sid);
      pushEvent('#f0a500','<b>alarm-log</b> '+esc(sid)+' 已記錄');
      toast('異常已記錄並寫入審計','ok');
      return;
    }
    var jb=e.target.closest('[data-jump]');
    if (jb){ jumpTo(jb.getAttribute('data-jump')); return; }
  });

  function jumpTo(id){
    if (id==='T-2841'){
      go({topic:'seat',pane:null,focus:'T-2841'});
      toast('導向 T-2841 席位執行','ok');
      return;
    }
    go({topic:'queue',pane:null,focus:id});
    toast('導向 '+id,'ok');
  }

  /* ================= [P2-11] guard 核准（二次確認 + 原因 + 樂觀 + 審計） ================= */
  var gb=$('#guardApprove');
  if (gb) gb.addEventListener('click',function(){
    if (gb.disabled) return;
    openDialog({
      title:'核准感知行動 · guard.py',
      desc:'文本感知抽出行動句「閥位 62% → 54%」。核可後才成為寫入候選，模型不會直接執行。',
      onConfirm:function(who,reason){
        var before=JSON.stringify(store.metrics);
        gb.disabled=true; gb.textContent='執行中…';
        optimistic(
          function(){
            store.metrics.guardPending=Math.max(0,store.metrics.guardPending-1);
            renderNumbers();
            var box=$('#writeBox');
            if (box) box.innerHTML='<div class="swt" style="color:var(--green)"><span class="sig ok"></span> 候選已核可 · 進入佇列</div>'+
              '<div class="swd">感知句「閥位 <b>62% → 54%</b>」已成為寫入候選。</div>';
          },
          function(){
            store.metrics=JSON.parse(before);
            renderNumbers();
            gb.disabled=false; gb.textContent='核准候選';
          },
          '感知行動已核可（'+who+'）',
          '核可失敗，已回滾'
        );
        audit('核准感知行動 閥位 62%→54%',who,reason);
        pushEvent('#5fd97d','<b>guard</b> 核可感知行動 · 審批人 '+esc(who));
      }
    });
  });

  /* ================= 佇列流轉引擎 ================= */
  function moveCard(id,targetLane,mutate){
    var t=store.tasks.filter(function(x){ return x.id===id; })[0];
    if (!t) return;
    var from=laneOf(t);
    t.lane=targetLane;
    t.exiting=false;
    if (targetLane!=='split'&&targetLane!=='gen') t.departAt=0;
    if (mutate) mutate(t);
    renderQueue([from, targetLane]);
  }
  function markDone(t, opt){
    if (!t||t.lane==='done'||t.exiting||t.flowClosing) return;
    var from=t.lane;
    t.leftFrom=t.lane;
    t.exiting=true;
    t.departAt=0;
    if (!opt || !opt.silent) renderQueue([from]);
    setTimeout(function(){
      t.exiting=false;
      t.lane='done';
      t.leftFrom='';
      store.metrics.done++;
      pushEvent('#5fd97d','<b>step</b> '+esc(t.id)+' 此步完成 · 仍留在總任務進程');
      renderQueue();
      maybeCloseParent(t.parent);
    },560);
  }
  function maybeCloseParent(parent){
    if (!parent) return;
    var kids=store.tasks.filter(function(t){ return t.parent===parent && !t.flowGone; });
    if (!kids.length || kids.some(function(t){ return t.lane!=='done'||t.exiting; })) return;
    kids.forEach(function(t){ t.flowClosing=true; });
    renderQueue();
    pushEvent('#f0a500','<b>task</b> '+esc(parent)+' 全部分拆步驟完成 · 進程即將移出');
    setTimeout(function(){
      store.tasks=store.tasks.filter(function(t){ return t.parent!==parent; });
      renderQueue();
    },700);
  }
  var lifeSeq=130;
  var lifeSpecs=[
    ['閥位趨勢複核','工業席','p1','P1'],
    ['壓力窗格對','分析席','p2','P2'],
    ['報告小節起草','報告席','p2','P2'],
    ['門檻漂移檢查','審核席','p1','P1']
  ];
  function nextStep(parent){
    var max=0;
    store.tasks.forEach(function(t){ if (t.parent===parent && t.step>max) max=t.step; });
    return max+1;
  }
  function nextWave(parent){
    var open=liveTasks(parent);
    var max=0;
    open.forEach(function(t){ if ((t.wave||0)>max) max=t.wave; });
    var sharing=open.filter(function(t){ return t.wave===max; });
    if (max && sharing.length<2) return max;
    return max+1;
  }
  function decomposeOne(){
    if (store.paused||document.hidden||!store.autoClaim) return;
    if (store.tasks.some(function(t){ return t.parent==='T-2841' && t.flowClosing; })) return;
    var open=store.tasks.filter(function(t){ return t.parent==='T-2841' && t.lane!=='done'; }).length;
    var total=store.tasks.filter(function(t){ return t.parent==='T-2841'; }).length;
    if (open>=8 || total>=12) return;
    var spec=lifeSpecs[lifeSeq%lifeSpecs.length];
    var role=spec[1];
    var id='Q-'+(lifeSeq++);
    var task={id:id,title:spec[0],pri:spec[2],priLabel:spec[3],lane:'queue',role:role,
      parent:'T-2841',step:nextStep('T-2841'),wave:nextWave('T-2841'),seat:'',slot:'',prompt:ROLE_PROMPT[role]||'',
      sensors:[],tags:[{t:'待拉取',c:''},{t:role,c:''}],
      meta:'已交給 <b>'+role+'</b> · 角色提示詞',sla:4,
      stamp:['席位角色 <b>'+role+'</b>','等待該席拉取']};
    store.tasks.push(task);
    renderQueue();
    pushEvent('#f0a500','<b>decompose</b> '+esc(id)+' 分拆後交給 '+esc(role));
  }
  setTimeout(decomposeOne,2800);
  every(14000, decomposeOne);
  function autoClaim(){
    if (!store.autoClaim||store.paused||document.hidden) return;
    var q=store.tasks.filter(function(t){ return t.lane==='queue'; })[0];
    if (!q) return;
    var seatPick={'工業席':'S-15','分析席':'S-24','審核席':'S-28','報告席':'S-19'}[q.role]||'S-24';
    moveCard(q.id,'wait',function(t){
      t.seat=seatPick;
      t.tags=[{t:'待空檔',c:'t-wait'},{t:seatPick+' 已拉取',c:''}];
      t.waitPct=8;
      t.meta='排位 <b>#1</b> · 等 LLM 空檔 · '+t.role;
      t.stamp=['拉取 <b>'+seatPick+' · '+t.role+'</b>','lock TTL 15m'];
    });
    pushEvent('#5fd97d','<b>auto-claim</b> '+esc(seatPick)+' 拉取 '+esc(q.id)+' · 待空檔');
    dispatchFromWait();
  }
  every(5200, autoClaim);

  function freeSlotOf(t){
    if (!t) return;
    var slot=store.slots.filter(function(s){ return t.slot?s.id===t.slot:(s.who&&s.who.indexOf(t.id)>=0); })[0];
    if (slot && slot.state==='busy'){
      slot.state='free'; slot.who=null; slot.ttl=0;
      pushEvent('#5fd97d','<b>slot</b> '+slot.id+' 空檔釋放');
    }
    t.slot='';
  }
  function dispatchFromWait(){
    var n=0;
    while (n<8){
      var w=store.tasks.filter(function(t){ return t.lane==='wait' && !t.exiting; })
        .sort(function(a,b){ return (a.pri==='p0'?0:1)-(b.pri==='p0'?0:1); })[0];
      if (!w) break;
      var slot=store.slots.filter(function(s){ return !s.reserve&&s.state==='free'; })[0] ||
               (w.pri==='p0'?store.slots.filter(function(s){ return s.reserve&&s.state==='free'; })[0]:null);
      if (!slot) break;
      var seatId=w.seat||'S-24';
      slot.state='busy'; slot.who=seatId+'·'+w.id; slot.ttl=Math.round(90+Math.random()*280); slot.max=slot.ttl;
      var taken=slot.id;
      moveCard(w.id,'proc',function(t){
        t.slot=taken;
        t.tags=[{t:'執行中',c:'t-proc'},{t:'槽位 '+taken,c:''},{t:'並行',c:''}];
        t.progress=4;
        t.meta=seatId+'·'+t.id+' · call_llm 中 · 槽位 <b>'+taken+'</b>';
        t.stamp=['進度 <b>4%</b>','與同波其他步驟同時跑'];
      });
      var seat=store.seats.filter(function(s){ return s.id===seatId || s.task===w.id; })[0];
      if (seat){ seat.status='run'; seat.statusLabel='執行中'; seat.slot=taken; seat.prog=4; seat.pill='amber'; }
      pushEvent('#5fd97d','<b>slot</b> '+esc(w.id)+' 取得空檔 '+esc(taken)+' · 與其他步驟並行');
      n++;
    }
    if (n){ renderSlots(); renderRoster(); }
  }

  /* 強制派發（二次確認 + 原因 + 是否動用保留槽） */
  document.addEventListener('click',function(e){
    var btn=e.target.closest('.claim-btn[data-force]'); if (!btn) return;
    var id=btn.getAttribute('data-id');
    openDialog({
      title:'強制派發 · 手動覆寫',
      desc:'將 '+id+' 直接送入待空檔並優先搶空檔（可能動用 P0 保留槽位）。操作將記錄審計。',
      onConfirm:function(who,reason){
        btn.disabled=true; btn.textContent='派發中…';
        var before=JSON.stringify(store.tasks);
        optimistic(
          function(){
            moveCard(id,'wait',function(t){
              t.tags=[{t:'待空檔',c:'t-wait'},{t:'強制派發',c:''}];
              t.waitPct=12;
              t.meta='優先排位 <b>#0</b> · 手動覆寫';
              t.stamp=['強制派發 <b>手動覆寫</b>','跳過自動排隊'];
            });
          },
          function(){ store.tasks=JSON.parse(before); renderQueue(); },
          '強制派發 '+id+'（'+who+'）',
          '派發失敗，已回滾'
        );
        audit('強制派發 '+id,who,reason);
        pushEvent('#f0a500','<b>force</b> '+esc(id)+' 強制派發 · 操作者 '+esc(who));
        setTimeout(dispatchFromWait,900);
      }
    });
  });

  /* 執行進度：數值只改 --pct / 文字，換道才重建相關欄 */
  every(4200, function(){
    if (store.paused||document.hidden) return;
    var touched=[];
    var slotMoved=false;
    function touch(lane){ if (lane && touched.indexOf(lane)<0) touched.push(lane); }
    store.tasks.forEach(function(t){
      if (t.lane!=='proc' || t.exiting) return;
      t.progress=Math.min(96,(t.progress||0)+Math.random()*3);
      t.stamp=['進度 <b>'+Math.round(t.progress)+'%</b>', t.stamp[1]];
      if (t.progress>=96&&Math.random()>0.7){
        var from=t.lane;
        if (Math.random()>0.5){
          t.lane='split';
          t.tags=[{t:'再分拆',c:'t-split'},{t:'槽位已釋放',c:''}];
          t.stamp=['<b style="color:var(--violet)">回注完成</b>','即將移出'];
          store.metrics.split++;
          pushEvent('#a493ff','<b>re-split</b> '+esc(t.id)+' 走向再分拆');
        } else {
          t.lane='gen';
          t.tags=[{t:'席位生成',c:'t-seat'},{t:'完成',c:''}];
          t.stamp=['席位池 <b>87/120</b>','即將移出'];
          pushEvent('#5fd97d','<b>seat-gen</b> '+esc(t.id)+' 走向席位生成');
        }
        t.departAt=Date.now()+4500;
        touch(from);
        touch(t.lane);
        freeSlotOf(t);
        slotMoved=true;
        setTimeout(dispatchFromWait,700);
      }
    });
    store.tasks.forEach(function(t){
      if (t.lane==='wait'&&!t.exiting&&t.waitPct!==undefined&&t.waitPct<92) t.waitPct+=Math.random()*4;
      if ((t.lane==='split'||t.lane==='gen')&&!t.departAt) t.departAt=Date.now()+4500;
      if (t.departAt&&(t.lane==='split'||t.lane==='gen')&&Date.now()>=t.departAt){
        var from=t.lane;
        var was=t.exiting;
        markDone(t,{silent:true});
        if (!was && t.exiting) touch(from);
      }
    });
    if (touched.length){
      renderQueue(touched);
      if (slotMoved) renderSlots();
    } else {
      paintQueueValues();
    }
    $$('#seatRoster .mp-fill').forEach(function(f){
      var v=parseFloat(f.getAttribute('aria-valuenow'))||0;
      if (v>0&&v<99){
        v=Math.min(99,v+Math.random()*1.5);
        var next=v.toFixed(0);
        if (f.getAttribute('aria-valuenow')===next) return;
        f.setAttribute('aria-valuenow', next);
        f.style.setProperty('--pct', next+'%');
        var n=f._num||(f._num=f.closest('.mini-progress').querySelector('.mp-num'));
        if (n && n.textContent!==next+'%') n.textContent=next+'%';
      }
    });
  });

  /* ================= [P0-7] 席位圖 roving tabindex + 方向鍵 ================= */
  renderSeats();
  var seatWrap=$('#seats');
  seatWrap.addEventListener('click',function(e){
    var cell=e.target.closest('.seat'); if (!cell) return;
    selectSeat(cell,{scroll:true});
  });
  function selectSeat(cell,opt){
    if (!cell) return;
    opt=opt||{};
    $$('.seat').forEach(function(s){ s.classList.remove('selected'); s.tabIndex=-1; });
    cell.classList.add('selected'); cell.tabIndex=0;
    var id=cell.getAttribute('data-seat');
    $$('#seatRoster tbody tr').forEach(function(r){ r.classList.remove('sel'); });
    var row=$('#seatRoster tr[data-seat="'+id+'"]');
    if (row){
      row.classList.add('sel');
      if (opt.scroll) row.scrollIntoView({behavior:document.body.classList.contains('reduce-motion')?'auto':'smooth',block:'nearest'});
    }
    if (!opt.fromRoute){
      go({topic:'seat',pane:null,focus:id},'replace');
      toast('席位 '+id,'ok');
    }
  }
  var seatTable=$('#seatRoster');
  if (seatTable) seatTable.addEventListener('click',function(e){
    var row=e.target.closest('tr[data-seat]'); if (!row) return;
    var id=row.getAttribute('data-seat');
    var cell=document.querySelector('#seats .seat[data-seat="'+id+'"]');
    if (cell){ selectSeat(cell,{scroll:true}); return; }
    $$('.seat').forEach(function(s){ s.classList.remove('selected'); });
    $$('#seatRoster tbody tr').forEach(function(r){ r.classList.remove('sel'); });
    row.classList.add('sel');
    go({topic:'seat',pane:null,focus:id},'replace');
    toast('席位 '+id,'ok');
  });
  seatWrap.addEventListener('keydown',function(e){
    var seats=$$('.seat',seatWrap);
    var idx=seats.indexOf(document.activeElement); if (idx<0) return;
    var next=null;
    if (e.key==='ArrowRight') next=Math.min(seats.length-1,idx+1);
    else if (e.key==='ArrowLeft') next=Math.max(0,idx-1);
    else if (e.key==='ArrowDown') next=Math.min(seats.length-1,idx+10);
    else if (e.key==='ArrowUp') next=Math.max(0,idx-10);
    else if (e.key==='Home') next=0;
    else if (e.key==='End') next=seats.length-1;
    if (next!==null){
      e.preventDefault();
      seats.forEach(function(s){ s.tabIndex=-1; });
      seats[next].tabIndex=0; seats[next].focus();
    }
  });

  $('#seatLegend').addEventListener('click',function(e){
    var b=e.target.closest('.legend-btn'); if (!b) return;
    var f=b.getAttribute('data-filter');
    var on=b.getAttribute('aria-pressed')!=='true';
    $$('#seatLegend .legend-btn').forEach(function(x){ x.setAttribute('aria-pressed','false'); });
    b.setAttribute('aria-pressed',String(on));
    $$('.seat').forEach(function(c){ c.classList.toggle('dimmed',on&&c.getAttribute('data-status')!==f); });
    $$('#seatRoster tbody tr').forEach(function(r){ r.classList.toggle('dimmed',on&&r.getAttribute('data-status')!==f); });
    toast('席位過濾：'+(on?f:'全部'),'ok');
  });

  /* ================= 搜尋事件 ================= */
  var si=$('#globalSearch'),ms=$('#mobileSearch'),overlay=$('#searchOverlay');
  if (si) si.addEventListener('input',function(){ onSearchInput(si.value); });
  if (ms) ms.addEventListener('input',function(){ onSearchInput(ms.value); });

  /* [P0-2] overlay：focus trap + ESC + 焦點歸還 */
  function openSearchOverlay(){
    overlay.classList.add('on');
    ms.focus();
  }
  function closeSearchOverlay(){
    overlay.classList.remove('on');
    ms.value=''; runSearch('');
    $('#searchOpen').focus();
  }
  $('#searchOpen').addEventListener('click',openSearchOverlay);
  $('#searchClose').addEventListener('click',closeSearchOverlay);
  overlay.addEventListener('keydown',function(e){
    if (e.key==='Escape'){ e.preventDefault(); closeSearchOverlay(); return; }
    if (e.key!=='Tab') return;
    var f=$$('input,button',overlay);
    var first=f[0],last=f[f.length-1];
    if (e.shiftKey&&document.activeElement===first){ e.preventDefault(); last.focus(); }
    else if (!e.shiftKey&&document.activeElement===last){ e.preventDefault(); first.focus(); }
  });

  /* ================= [P0-8] 全域快捷鍵（避開輸入框） ================= */
  window.addEventListener('keydown',function(e){
    var typing=isTyping(e.target);
    if ((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){
      e.preventDefault();
      if (window.innerWidth<=767) openSearchOverlay();
      else if (si){ si.focus(); si.select(); }
      return;
    }
    if (e.key==='Escape'){
      if (overlay.classList.contains('on')){ e.preventDefault(); closeSearchOverlay(); }
      else if (si&&document.activeElement===si){ si.value=''; runSearch(''); si.blur(); }
      return;
    }
    if (typing) return;
    if (e.code==='Space'&&!e.target.closest('button')){ e.preventDefault(); togglePause(); return; }
    if ((e.metaKey||e.ctrlKey)&&e.shiftKey&&e.key.toLowerCase()==='a'){ e.preventDefault(); toggleAuto(); return; }
    if ((e.metaKey||e.ctrlKey)&&e.key>='1'&&e.key<='9'){ var kb=TOPICS[parseInt(e.key,10)-1]; if (kb){ e.preventDefault(); setTopic(kb); } return; }
    if (!e.metaKey && !e.ctrlKey && !e.altKey && (e.key==='ArrowLeft'||e.key==='ArrowRight')){
      if (overlay.classList.contains('on') || ($('#dlgMask') && !$('#dlgMask').hidden)) return;
      if (e.target.closest('#seats,#topicBar,#infraTabs,#seatLegend,#rangeRow')) return;
      e.preventDefault();
      var i=TOPICS.indexOf(routeState.topic||'queue');
      var n=e.key==='ArrowRight'?(i+1)%TOPICS.length:(i-1+TOPICS.length)%TOPICS.length;
      setTopic(TOPICS[n]);
    }
  });

  /* ================= depth chart + cost charts（頁內 SVG / conic） ================= */
  var depthSeries=[6,7,5,8,7,9,11,10,12,9,13,11,12,16,14,13,15,12,14,16,13,15,14,14];
  function renderDepth(){
    var c=document.getElementById('depthChart'); if (!c) return;
    var w=300,h=62,pad=4,len=depthSeries.length;
    var min=Math.min.apply(null,depthSeries)-2,max=Math.max.apply(null,depthSeries)+2,span=(max-min)||1;
    var pts=depthSeries.map(function(v,i){
      var x=pad+(len<2?0:(i/(len-1))*(w-pad*2));
      var y=h-pad-((v-min)/span)*(h-pad*2);
      return x.toFixed(1)+','+y.toFixed(1);
    });
    var svg=c.querySelector('svg.chart');
    if (!svg){
      c.innerHTML='<svg class="chart" viewBox="0 0 300 62" preserveAspectRatio="none" aria-hidden="true">'+
        '<defs><linearGradient id="dg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#43d4e4" stop-opacity=".35"/><stop offset="100%" stop-color="#43d4e4" stop-opacity="0"/></linearGradient></defs>'+
        '<polygon fill="url(#dg)"/><polyline fill="none" stroke="#43d4e4" stroke-width="1.7" stroke-linejoin="round"/>'+
        '<circle r="2.6" fill="#43d4e4"/></svg>';
      svg=c.querySelector('svg.chart');
    }
    var area=pad+','+(h-pad)+' '+pts.join(' ')+' '+(w-pad)+','+(h-pad);
    var line=pts.join(' ');
    var poly=svg.querySelector('polygon');
    var stroke=svg.querySelector('polyline');
    var dot=svg.querySelector('circle');
    if (poly && poly.getAttribute('points')!==area) poly.setAttribute('points', area);
    if (stroke && stroke.getAttribute('points')!==line) stroke.setAttribute('points', line);
    if (dot){
      var last=pts[pts.length-1].split(',');
      dot.setAttribute('cx', last[0]);
      dot.setAttribute('cy', last[1]);
    }
  }
  function ringPoint(cx,cy,r,deg){
    var a=(deg-90)*Math.PI/180;
    return [cx+r*Math.cos(a), cy+r*Math.sin(a)];
  }
  function ringSlice(cx,cy,r,ir,a0,a1){
    var large=(a1-a0)>180?1:0;
    var p0=ringPoint(cx,cy,r,a0), p1=ringPoint(cx,cy,r,a1);
    var q1=ringPoint(cx,cy,ir,a1), q0=ringPoint(cx,cy,ir,a0);
    function n(v){ return v.toFixed(2); }
    return 'M'+n(p0[0])+','+n(p0[1])+'A'+r+','+r+' 0 '+large+' 1 '+n(p1[0])+','+n(p1[1])+
      'L'+n(q1[0])+','+n(q1[1])+'A'+ir+','+ir+' 0 '+large+' 0 '+n(q0[0])+','+n(q0[1])+'Z';
  }
  function ensureCostCharts(){
    var budget=document.getElementById('budgetRadial');
    var donut=document.getElementById('costDonut');
    if (budget && !budget.querySelector('.gauge')){
      budget.innerHTML='<div class="gauge" style="--pct:77.2"><div class="gauge-hole"><b>77.2%</b><span>預算使用</span></div></div>';
    }
    if (!donut || donut.querySelector('svg')) return;
    var parts=[
      {n:'ECS',v:3240,c:'#ff8b3d'},
      {n:'RDS',v:1880,c:'#43d4e4'},
      {n:'OSS',v:420,c:'#a493ff'},
      {n:'網路',v:380,c:'#f0a500'},
      {n:'SLB',v:260,c:'#5fd97d'}
    ];
    var total=0;
    parts.forEach(function(p){ total+=p.v; });
    var ang=0, paths='';
    parts.forEach(function(p){
      var sweep=p.v/total*360;
      var a0=ang+0.8, a1=ang+Math.max(sweep-0.8, 0.8);
      paths+='<path d="'+ringSlice(80,80,68,46,a0,a1)+'" fill="'+p.c+'"/>';
      ang+=sweep;
    });
    var legend=parts.map(function(p){
      return '<span><i style="background:'+p.c+'"></i>'+esc(p.n)+' ¥'+p.v.toLocaleString('en-US')+'</span>';
    }).join('');
    donut.innerHTML='<div class="donut-wrap"><svg viewBox="0 0 160 160" aria-hidden="true">'+
      paths+'<text class="donut-k" x="80" y="74" text-anchor="middle">本月</text>'+
      '<text class="donut-v" x="80" y="94" text-anchor="middle">¥6,180</text></svg>'+
      '<div class="donut-legend">'+legend+'</div></div>';
  }

  function tipText(el){
    if (!el) return '';
    if (el.hasAttribute('title')){
      el.setAttribute('data-tip', el.getAttribute('title'));
      el.removeAttribute('title');
    }
    if (el.hasAttribute('data-tip')) return el.getAttribute('data-tip')||'';
    if (el.matches('#topicBar .topic-btn')) return '#/'+(el.getAttribute('data-topic')||'');
    if (el.classList.contains('kpi')){
      var a=el.querySelector('.kl'), b=el.querySelector('.ks');
      return ((a&&a.textContent)||'')+(b?' · '+b.textContent:'');
    }
    if (el.classList.contains('seat')){
      var map={run:'執行中',wait:'待空檔',queue:'待拉取',done:'完成',lock:'鎖定',gen:'生成'};
      var st=el.getAttribute('data-status')||'';
      return (el.getAttribute('data-seat')||'席位')+' · '+(map[st]||'空閒');
    }
    return '';
  }
  function tipAnchor(node){
    if (!node || !node.closest) return null;
    return node.closest('[data-tip], [title], #topicBar .topic-btn, .kpi, #seats .seat');
  }
  function mountTips(){
    if (typeof tippy==='undefined' || tipSingleton) return;
    $$('[title]').forEach(function(el){
      var text=el.getAttribute('title');
      if (!text) return;
      el.setAttribute('data-tip', text);
      el.removeAttribute('title');
    });
    var reduced=document.body.classList.contains('reduce-motion');
    var holder=document.createElement('span');
    holder.id='tipAnchor';
    holder.setAttribute('aria-hidden','true');
    holder.style.cssText='position:fixed;width:1px;height:1px;overflow:hidden;pointer-events:none';
    document.body.appendChild(holder);
    var current=null;
    var showTimer=0;
    tipSingleton=tippy(holder,{
      theme:'linkin',
      trigger:'manual',
      animation:reduced?'fade':'shift-away-subtle',
      duration:reduced?0:[180,120],
      delay:0,
      arrow:true,
      offset:[0,8],
      appendTo:function(){ return document.body; },
      maxWidth:280,
      content:''
    });
    tipInstances.push(tipSingleton);
    function hide(){
      clearTimeout(showTimer);
      current=null;
      tipSingleton.hide();
    }
    function show(el){
      if (current===el) return;
      var text=tipText(el);
      if (!text){ hide(); return; }
      current=el;
      clearTimeout(showTimer);
      var delay=reduced?0:(el.classList.contains('seat')?80:el.classList.contains('kpi')?380:240);
      tipSingleton.setProps({
        getReferenceClientRect:function(){ return el.getBoundingClientRect(); },
        content:text
      });
      showTimer=setTimeout(function(){
        if (current!==el) return;
        tipSingleton.setContent(text);
        tipSingleton.show();
      }, delay);
    }
    document.addEventListener('mouseover', function(e){
      var el=tipAnchor(e.target);
      if (el) show(el);
    });
    document.addEventListener('mouseout', function(e){
      var el=tipAnchor(e.target);
      if (!el || current!==el) return;
      var next=e.relatedTarget && tipAnchor(e.relatedTarget);
      if (next===el) return;
      hide();
    });
    document.addEventListener('focusin', function(e){
      var el=tipAnchor(e.target);
      if (el) show(el);
    });
    document.addEventListener('focusout', function(e){
      if (tipAnchor(e.target)) hide();
    });
    document.addEventListener('scroll', hide, true);
    tipHide=hide;
  }
  renderDepth();
  $('#rangeRow').addEventListener('click',function(e){
    var b=e.target.closest('.range-btn'); if (!b) return;
    $$('#rangeRow .range-btn').forEach(function(x){ x.setAttribute('aria-pressed','false'); });
    b.setAttribute('aria-pressed','true');
    var r=b.getAttribute('data-range');
    var n=r==='1H'?12:r==='6H'?18:24,base=r==='1H'?12:r==='6H'?13:8;
    depthSeries=[];
    for (var i=0;i<n;i++) depthSeries.push(Math.max(3,Math.round(base+Math.sin(i/2)*3+Math.random()*4)));
    $('#rangeStart').textContent='-'+r;
    renderDepth(); toast('走勢範圍 '+r,'ok');
  });

  /* ================= dispatcher ================= */
  var strip=$('#pulseStrip');
  if (strip){ for (var s2=0;s2<24;s2++){ var bar=document.createElement('i');
    bar.style.height=(20+Math.random()*70)+'%';
    if (Math.random()>0.7) bar.classList.add('hot'); else if (Math.random()>0.5) bar.classList.add('cool');
    strip.appendChild(bar); } }
  every(1000, function(){
    if (store.paused||document.hidden) return;
    var t=metricNodes.dispTick; if (!t) return;
    var v=parseInt(t.textContent,10)-1;
    if (v<=0){ v=5;
      if (metricNodes.dispScan) metricNodes.dispScan.textContent=Math.round(18+Math.random()*12)+' 項掃描';
      if (metricNodes.dispDispatch) metricNodes.dispDispatch.textContent=String(store.autoClaim?Math.round(1+Math.random()*3):0);
      if (metricNodes.dispReclaim) metricNodes.dispReclaim.textContent=String(Math.round(Math.random()*2));
      if (strip) Array.prototype.forEach.call(strip.children,function(b){
        b.style.height=(20+Math.random()*70)+'%';
        b.className=Math.random()>0.7?'hot':(Math.random()>0.5?'cool':''); }); }
    t.textContent=String(v).padStart(2,'0');
  });

  /* ================= lock TTL + slot TTL ================= */
  function fmtTtl(s){ s=Math.max(0,Math.round(s)); return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0'); }
  every(1000, function(){
    if (store.paused||document.hidden) return;
    for (var i=0;i<lockRows.length;i++){
      var row=lockRows[i];
      var ttl=parseFloat(row.getAttribute('data-ttl'))-1,max=parseFloat(row.getAttribute('data-max'))||1;
      if (ttl<=0) ttl=max;
      row.setAttribute('data-ttl',ttl);
      var cell=row._ttlEl;
      if (cell){
        var text=fmtTtl(ttl);
        var cls='lock-ttl '+(ttl>300?'ok':ttl>90?'warn':'bad');
        if (cell.textContent!==text) cell.textContent=text;
        if (cell.className!==cls) cell.className=cls;
      }
      var bar=row._barEl;
      if (bar){
        var pct=Math.max(0,Math.min(100,(ttl/max)*100)).toFixed(0)+'%';
        var bg=ttl>300?'linear-gradient(90deg,#2f8a4c,var(--green))':ttl>90?'linear-gradient(90deg,#8c6a12,var(--amber))':'linear-gradient(90deg,#8c3a30,var(--red))';
        if (bar.style.getPropertyValue('--pct')!==pct) bar.style.setProperty('--pct',pct);
        if (bar.style.background!==bg && bar.getAttribute('data-bg')!==bg){
          bar.style.background=bg;
          bar.setAttribute('data-bg',bg);
        }
      }
    }
    var changed=false;
    store.slots.forEach(function(s){
      if (s.state==='busy'&&s.ttl>0){ s.ttl-=1;
        if (s.ttl<=0){ s.state='free'; s.who=null; changed=true; pushEvent('#5fd97d','<b>slot</b> '+s.id+' 空檔釋放'); dispatchFromWait(); } }
    });
    if (changed) renderSlots();
    else paintSlotValues();
  });

  /* ================= 全域指標推移 ================= */
  function bump(v,a,mn,mx){ return Math.max(mn,Math.min(mx,v+a)); }
  every(3000, function(){
    if (store.paused||document.hidden) return;
    var m=store.metrics;
    m.claimRate=Math.round(bump(m.claimRate,(Math.random()-0.5)*0.5,3.2,8.5)*10)/10;
    m.slotWait=Math.round(bump(m.slotWait,(Math.random()-0.5)*0.8,1.6,7.5)*10)/10;
    m.thru=Math.round(bump(m.thru,Math.round((Math.random()-0.5)*4),18,52));
    m.queries+=Math.round(Math.random()*3);
    m.rpm=Math.round(bump(m.rpm,Math.round((Math.random()-0.5)*6),20,95));
    depthSeries.push(derived().queueDepth+derived().claimedWait);
    if (depthSeries.length>24) depthSeries.shift();
    renderDepth();
    var delta=metricNodes.depthDelta;
    if (delta){ var diff=depthSeries[depthSeries.length-1]-depthSeries[depthSeries.length-2];
      var text=(diff>=0?'▲ +':'▼ ')+Math.abs(diff);
      var cls='hc-delta '+(diff>=0?'up':'down');
      if (delta.textContent!==text) delta.textContent=text;
      if (delta.className!==cls) delta.className=cls; }
    renderNumbers();
  });

  /* ================= 事件流自動（上限 200） ================= */
  var autoEvents=[
    ['#5fd97d','<b>auto-claim</b> 席位自動拉取循環'],
    ['#ff8b3d','<b>slot</b> 待空檔排位等待釋放'],
    ['#a493ff','<b>re-split</b> 子任務回注佇列'],
    ['#5fd97d','<b>slot</b> 空檔釋放 → 按排位派發'],
    ['#43d4e4','<b>queue</b> FIFO 重排 · P0 優先']
  ]; var ai=0;
  every(5800, function(){
    if (store.paused||store.evPaused||document.hidden) return;
    var e=autoEvents[ai%autoEvents.length]; ai++; pushEvent(e[0],e[1]);
  });
  $('#evPause').addEventListener('click',function(){
    store.evPaused=!store.evPaused;
    this.textContent=store.evPaused?'RESUME':'PAUSE';
  });
  $('#evClear').addEventListener('click',function(){
    stream.innerHTML='';
    pushEvent('#9aa2a9','<b>system</b> 事件流已清空');
  });

  /* ================= 告警消除 ================= */
  $('#alertList').addEventListener('click',function(e){
    if (!e.target.classList.contains('a-x')) return;
    var card=e.target.closest('.alert');
    var id=card.getAttribute('data-alert');
    store.alerts=store.alerts.filter(function(a){ return a.id!==id; });
    renderAlerts();
    pushEvent('#9aa2a9','<b>alert</b> 告警已消除');
    audit('消除告警 '+id);
  });

  /* ================= 容器兩段確認 ================= */
  document.addEventListener('click',function(e){
    var btn=e.target.closest('.act-btn'); if (!btn) return;
    if (btn.classList.contains('confirm')){
      clearTimeout(btn._tm); btn.classList.remove('confirm');
      btn.textContent=btn.getAttribute('data-act');
      audit('Docker '+btn.getAttribute('data-act')+' 已排程');
      pushEvent('#5fd97d','<b>docker</b> '+btn.getAttribute('data-act')+' 已排程（DEMO 不執行）');
      toast('已排程 '+btn.getAttribute('data-act')+'（DEMO）','ok');
      return;
    }
    var orig=btn.getAttribute('data-act');
    btn.classList.add('confirm'); btn.textContent='再點確認';
    btn._tm=setTimeout(function(){ btn.classList.remove('confirm'); btn.textContent=orig; },2600);
  });

  /* ================= 官方容器採集目錄 ================= */
  var ACQ=[
    {id:'xhs',cat:'小紅書採集',name:'XHS-Downloader',repo:'JoeanAmier/XHS-Downloader',image:'joeanamier/xhs-downloader',imageSrc:'Docker Hub · joeanamier',compose:'—',license:'GPL-3.0',deploy:'docker run · :5556',pin:'joeanamier/xhs-downloader',file:'倉庫根目錄 Dockerfile',use:'官方鏡像在 Docker Hub，倉庫根目錄也有 Dockerfile。CLI、API、MCP、TUI 同一行程，埠 5556。這頁只登記，不拉取、不啟動。',cmd:'docker pull joeanamier/xhs-downloader\ndocker run -p 5556:5556 -v xhs_data:/app/Volume joeanamier/xhs-downloader'},
    {id:'douyin-api',cat:'抖音／TikTok／B站',name:'Douyin_TikTok_Download_API',repo:'Evil0ctal/Douyin_TikTok_Download_API',image:'evil0ctal/douyin_tiktok_download_api',imageSrc:'Docker Hub · evil0ctal',compose:'docker/compose.yml',license:'Apache-2.0',deploy:'compose up -d',pin:'docker/compose.yml',file:'docker/Dockerfile · docker/compose.yml',use:'官方主推 Docker Compose。生產編排含身份池、PostgreSQL 17 + TimescaleDB、Redis 8，另有 browser、downloader、transcriber 三個可選 profile。這頁只登記，不拉取、不啟動。',cmd:'git clone https://github.com/Evil0ctal/Douyin_TikTok_Download_API.git\ncd Douyin_TikTok_Download_API\ndocker compose -p dtk -f docker/compose.yml up -d'},
    {id:'douyin-dl',cat:'抖音（個人輕量）',name:'douyin-dl',repo:'Achaiccccc/douyin-dl',image:'—',imageSrc:'倉庫 Dockerfile，compose --build',compose:'docker-compose.yml',license:'Apache-2.0',deploy:'compose up -d --build · :18080',pin:'docker-compose.yml',file:'Dockerfile · docker-compose.yml',use:'DTK 的個人／家庭裁剪。沒有獨立的 Docker Hub 鏡像名，靠倉庫裡的 Dockerfile 與 compose 建置。對外埠 18080。compose 裡的 APP_PASSWORD 是範例 123456，註解要求暴露到公網前先改掉。這頁只登記，不建置、不啟動。',cmd:'git clone https://github.com/Achaiccccc/douyin-dl.git\ncd douyin-dl\ndocker compose up -d --build'},
    {id:'maigret',cat:'帳號發現／OSINT',name:'Maigret',repo:'soxoj/maigret',image:'soxoj/maigret',imageSrc:'Docker Hub · soxoj',compose:'—',license:'MIT',deploy:'docker run CLI',pin:'soxoj/maigret',file:'倉庫根目錄 Dockerfile',use:'作者 soxoj 維護的官方鏡像。Dockerfile 有 CLI 與 Web UI 兩個 stage。這頁只登記鏡像，不對任何帳號執行搜尋。',cmd:'docker pull soxoj/maigret\ndocker run -v "$(pwd)/reports:/app/reports" soxoj/maigret:latest USERNAME'},
    {id:'sherlock',cat:'帳號發現／OSINT',name:'Sherlock',repo:'sherlock-project/sherlock',image:'sherlock/sherlock',imageSrc:'Docker Hub · sherlock',compose:'—',license:'MIT',deploy:'docker run CLI',pin:'sherlock/sherlock',file:'倉庫根目錄 Dockerfile',use:'Sherlock Project 維護的官方鏡像，一次跑完的 CLI。這頁只登記鏡像，不對任何帳號執行搜尋。',cmd:'docker pull sherlock/sherlock\ndocker run --rm -t -v "$PWD/results:/opt/sherlock/results" sherlock/sherlock USERNAME'}
  ];
  var ACQ_OUT=[
    {name:'MediaCrawler',why:'沒有官方 Dockerfile，也沒有官方命名鏡像。網上流傳的容器方案是第三方自己寫的，不要照搬那些鏡像位址。'},
    {name:'feedgrab',why:'官方安裝是 pip install。沒有官方 Dockerfile，也沒有官方鏡像。'},
    {name:'sociopath',why:'Go CLI／函式庫，官方沒有容器交付。搜尋結果裡的 Docker 是它能讀 Docker Hub 用戶資料，不是這個專案自己的容器方案。'}
  ];
  function acqById(id){ return ACQ.filter(function(x){ return x.id===id; })[0]; }

  /* ================= GitHub 開源組件 ================= */
  var OSS_LIST=[
    {id:'skill-evaluator',name:'SkillEvaluator',repo:'NVIDIA/SkillEvaluator',license:'以倉庫 LICENSE 為準',pin:'未鎖定',face:'技能評估閘門 · 候選',state:'candidate',load:'off',sample:true,use:'多層技能與外掛評估框架：品質閘、安全掃描、相容性、語意重疊、合成評估集，以及技能對代理行為的影響。加載只登記閘門，不在這頁執行掃描或即時代理評估。'},
    {id:'scrapling',name:'Scrapling',repo:'D4Vinci/Scrapling',license:'以倉庫 LICENSE 為準',pin:'未鎖定',face:'爬蟲框架 · 沙箱候選',state:'candidate',load:'block',sample:true,use:'GitHub 上的 Python 網頁抓取框架。這頁只登記來源與評估狀態。第三方爬蟲不得在主棧執行，版本也還沒鎖定，所以它不是已接入組件。'},
    {id:'craft-anything',name:'Craft Anything',repo:'storytold/craft-anything',license:'以倉庫 LICENSE 為準',pin:'未鎖定',face:'設計參考 · 候選',state:'candidate',load:'off',sample:true,use:'倉庫自述是理解軟體如何運作，再做出自己的東西。可以加載為唯讀工藝草稿，不寫倉庫、不在主棧跑它的工具。'},
    {id:'animejs',name:'anime.js',repo:'juliangarnier/anime',license:'MIT',pin:'WAAPI',face:'頁面動效',state:'wired',use:'進場改由 Web Animations API。不再載入 anime.js。'},
    {id:'apexcharts',name:'ApexCharts',repo:'apexcharts/apexcharts.js',license:'MIT',pin:'頁內 SVG',face:'圖表',state:'wired',use:'佇列深度用手繪 SVG，預算環用 conic-gradient，成本組成用 SVG 環。不再載入 ApexCharts。'},
    {id:'tippyjs',name:'Tippy.js',repo:'atomiks/tippyjs',license:'MIT',pin:'6.3.7',face:'提示',state:'wired',use:'單一實例跟著滑鼠委派。重繪後的新卡片不用重新掛載，也不留舊 instance。需先載入 Popper。'},
    {id:'popper',name:'Popper',repo:'floating-ui/floating-ui',license:'MIT',pin:'2.11.8',face:'定位',state:'wired',use:'Tippy 的定位核心。只負責座標，不讀業務資料。'},
    {id:'lucide',name:'Lucide',repo:'lucide-icons/lucide',license:'ISC',pin:'頁內 sprite',face:'圖示',state:'wired',use:'導覽與告警圖示只用頁內 sprite。不再載入 Lucide。'},
    {id:'noto',name:'Noto Sans TC',repo:'notofonts/noto-cjk',license:'OFL',pin:'系統字',face:'正文字型',state:'wired',use:'中文走系統字堆疊（蘋方、微軟正黑體、思源黑體）。不向 Google Fonts 取字。'},
    {id:'plex',name:'IBM Plex Mono',repo:'IBM/plex',license:'OFL',pin:'自託管 5.2.6',face:'等寬字型',state:'wired',use:'拉丁子集 woff2 放在 fonts/。編號、槽位、路由與計數。'},
    {id:'chakra',name:'Chakra Petch',repo:'google/fonts',license:'OFL',pin:'自託管 5.2.6',face:'標題字型',state:'wired',use:'拉丁子集 woff2 放在 fonts/。品牌與大數字的英文。漢字改走系統字。'},
    {id:'xhs',name:'XHS-Downloader',repo:'JoeanAmier/XHS-Downloader',license:'待核對',pin:'未鎖定',face:'Sandbox 候選',state:'candidate',use:'規格中的採集候選。未批准，不進主棧，也不在這頁執行。'},
    {id:'douyin-api',name:'Douyin_TikTok_Download_API',repo:'Evil0ctal/Douyin_TikTok_Download_API',license:'待核對',pin:'未鎖定',face:'Sandbox 候選',state:'candidate',use:'規格中的採集候選。版本、授權與摘要都要另建 ConnectorVersion 才可測試。'},
    {id:'douyin-dl',name:'douyin-dl',repo:'官方倉庫待核對',license:'待核對',pin:'未鎖定',face:'Sandbox 候選',state:'candidate',use:'名稱在候選清單。官方來源未核對前不給連結、不拉取。'},
    {id:'maigret',name:'Maigret',repo:'soxoj/maigret',license:'待核對',pin:'未鎖定',face:'Sandbox 候選',state:'candidate',use:'帳號發現候選。只許在隔離沙箱評估，不能直連主庫。'},
    {id:'sherlock',name:'Sherlock',repo:'sherlock-project/sherlock',license:'待核對',pin:'未鎖定',face:'Sandbox 候選',state:'candidate',use:'帳號發現候選。候選不是能力，不能當已接入的 Connector。'}
  ];
  ACQ.forEach(function(a){
    if (a.lane==null) a.lane=2;
    var item=OSS_LIST.filter(function(x){ return x.id===a.id; })[0];
    if (!item) return;
    item.name=a.name;
    item.repo=a.repo;
    item.license=a.license;
    item.pin=a.pin;
    item.face=a.cat;
    item.use=a.use;
    item.image=a.image;
    item.imageSrc=a.imageSrc;
    item.compose=a.compose;
    item.deploy=a.deploy;
    item.cmd=a.cmd;
    item.file=a.file;
    item.checked=true;
  });
  var ossFilter='all';
  var ossPick='skill-evaluator';
  var OSS_BLOCK={scrapling:1,xhs:1,'douyin-api':1,'douyin-dl':1,maigret:1,sherlock:1};
  function ossLoadOf(x){
    if (x.load) return x.load;
    if (x.state==='wired') return 'on';
    if (OSS_BLOCK[x.id]) return 'block';
    return 'off';
  }
  function ossById(id){ return OSS_LIST.filter(function(x){ return x.id===id; })[0]||OSS_LIST[0]; }
  function renderOss(){
    var kpis=$('#ossKpis'), list=$('#ossList'), detail=$('#ossDetail');
    if (!list||!detail) return;
    var wired=OSS_LIST.filter(function(x){ return x.state==='wired'; }).length;
    var cand=OSS_LIST.length-wired;
    if (kpis){
      kpis.innerHTML=[
        ['組件',OSS_LIST.length,'全部列管'],
        ['已接入',wired,'版本已鎖'],
        ['候選',cand,'未批准'],
        ['主棧執行',0,'候選不進主棧']
      ].map(function(row){
        return '<div class="oss-kpi" data-oss-kpi="'+esc(row[0])+'"><div class="ok-l">'+esc(row[2])+'</div><div class="ok-v">'+esc(row[1])+'</div><div class="ok-l">'+esc(row[0])+'</div></div>';
      }).join('');
    }
    var shown=OSS_LIST.filter(function(x){ return ossFilter==='all'||x.state===ossFilter; });
    list.innerHTML=shown.map(function(x){
      var load=ossLoadOf(x);
      var st=x.state==='wired'?'已接入':(load==='on'?'已加載':(load==='block'?'禁止':'未加載'));
      var btn=x.state==='wired'?'已鎖':(load==='block'?'禁止':(load==='on'?'卸下':'加載'));
      var disabled=x.state==='wired'||load==='block';
      return '<article class="oss-card'+(x.id===ossPick?' selected':'')+(load==='on'?' on':'')+'" data-oss-id="'+esc(x.id)+'" data-search>'+
        '<div class="oc-top"><span class="oc-name">'+esc(x.name)+'</span>'+(x.sample?'<span class="oc-sample">範例</span>':'')+'<span class="oss-st '+(load==='on'?'wired':x.state)+'">'+st+'</span></div>'+
        '<div class="oc-repo">'+esc(x.repo)+'</div>'+
        '<div class="oc-use">'+esc(x.use)+'</div>'+
        '<div class="oc-actions"><button type="button" class="mini-btn" data-oss-open="'+esc(x.id)+'">檢視</button>'+
        '<button type="button" class="load-btn'+(load==='on'?' on':'')+'" data-oss-load="'+esc(x.id)+'"'+(disabled?' disabled':'')+'>'+btn+'</button></div></article>';
    }).join('')||'<div class="flow-empty">這個狀態下沒有組件</div>';
    var cur=ossById(ossPick);
    var href=cur.repo.indexOf('/')>0?'https://github.com/'+cur.repo:'';
    var repoHtml=href?'<a href="'+esc(href)+'" target="_blank" rel="noopener noreferrer">'+esc(cur.repo)+'</a>':esc(cur.repo);
    renderPacks();
    renderAcq();
    var imageHtml=cur.image && cur.image!=='—'
      ? '<a href="https://hub.docker.com/r/'+esc(cur.image)+'" target="_blank" rel="noopener noreferrer">'+esc(cur.image)+'</a>'
      : esc(cur.image||'');
    detail.innerHTML=
      '<div class="oss-st '+cur.state+'">'+(cur.state==='wired'?'已接入':'候選 · 未批准')+'</div>'+
      '<h3>'+esc(cur.name)+'</h3>'+
      '<div class="od-repo">'+repoHtml+'</div>'+
      '<p class="od-use">'+esc(cur.use)+'</p>'+
      '<div class="kv"><span>接入面</span><b>'+esc(cur.face)+'</b></div>'+
      (cur.image?'<div class="kv"><span>官方鏡像</span><b>'+imageHtml+'</b></div>':'')+
      (cur.imageSrc?'<div class="kv"><span>鏡像來源</span><b>'+esc(cur.imageSrc)+'</b></div>':'')+
      (cur.compose?'<div class="kv"><span>官方 Compose</span><b>'+esc(cur.compose)+'</b></div>':'')+
      (cur.deploy?'<div class="kv"><span>部署</span><b>'+esc(cur.deploy)+'</b></div>':'')+
      (cur.file?'<div class="kv"><span>倉庫檔案</span><b>'+esc(cur.file)+'</b></div>':'')+
      '<div class="kv"><span>鎖定</span><b>'+esc(cur.pin)+'</b></div>'+
      '<div class="kv"><span>授權</span><b>'+esc(cur.license)+'</b></div>'+
      '<div class="kv"><span>變更</span><b>'+(cur.state==='wired'?'改版本就要改這頁的鎖定':'新版本從 candidate 重走')+'</b></div>'+
      (cur.cmd?'<pre class="acq-cmd">'+esc(cur.cmd)+'</pre>':'')+
      '<div class="note">'+(cur.state==='wired'
        ?'這顆已經接在運行時頁面。不使用 latest，也不會因為上游更新自動換版本。'
        :(cur.checked
          ?'官方鏡像或倉庫 Dockerfile 已核對。這頁只登記來源、許可和部署方式，不拉取、不建置、不啟動，也不進主棧。'
          :'候選只代表可以評估。未核對官方來源、授權與摘要前，不得放進主棧，也不得在這頁啟動。'))+'</div>';
  }
  function renderPar(){
    var host=$('#parLanes'); if (!host) return;
    var ready=ACQ.filter(function(a){ return (a.lane||2)>=3; }).length;
    var meta=$('#parMeta');
    if (meta) meta.textContent=ready+'/'+ACQ.length+' 沙箱就緒 · 主棧 0';
    var allBtn=$('#parAll');
    if (allBtn){
      allBtn.disabled=ready===ACQ.length;
      allBtn.textContent=ready===ACQ.length?'五條都停在沙箱':'五條一起推進';
    }
    host.innerHTML=ACQ.map(function(a){
      var lane=a.lane||2;
      var steps=['來源核對','契約鎖定','沙箱邊界','主棧'].map(function(name,i){
        var cls=i===3?'stop':(i<lane?'done':(i===lane?'now':''));
        return '<i class="par-step '+cls+'" title="'+esc(name)+'"></i>';
      }).join('');
      var img=a.image==='—'?'倉庫 Dockerfile 建置':a.image;
      var done=lane>=3;
      return '<article class="par-lane'+(a.id===ossPick?' sel':'')+'" data-lane="'+esc(a.id)+'">'+
        '<div class="pl-cat">'+esc(a.cat)+'</div>'+
        '<div class="pl-name">'+esc(a.name)+'</div>'+
        '<div class="par-steps" aria-hidden="true">'+steps+'</div>'+
        '<div class="pl-now">'+(done?'沙箱就緒 · 主棧拒絕':'進行中 · 沙箱邊界')+'</div>'+
        '<div class="pl-meta" title="'+esc(a.license)+' · '+esc(a.deploy)+'">'+esc(a.license)+' · '+esc(a.deploy)+'</div>'+
        '<div class="pl-meta" title="'+esc(img)+'">'+esc(img)+'</div>'+
        '<button type="button" class="mini-btn" data-par="'+esc(a.id)+'"'+(done?' disabled':'')+'>'+(done?'主棧拒絕':'推進這一條')+'</button>'+
        '</article>';
    }).join('');
  }
  function advanceLane(id){
    var a=acqById(id); if (!a) return;
    if ((a.lane||2)>=3){
      toast(a.name+' 停在沙箱，不進主棧','err');
      return;
    }
    a.lane=3;
    ossPick=id;
    renderOss();
    toast(a.name+' 已到沙箱邊界','ok');
    audit('并行開發 '+a.name+' 沙箱就緒');
    pushEvent('#f0a500','<b>parallel</b> '+esc(a.name)+' 沙箱就緒 · 主棧拒絕');
  }
  function advanceAll(){
    var moved=[];
    ACQ.forEach(function(a){
      if ((a.lane||2)<3){ a.lane=3; moved.push(a.name); }
    });
    renderOss();
    if (!moved.length){
      toast('五條都已停在沙箱，主棧不開','err');
      return;
    }
    toast('並行推進 '+moved.length+' 條到沙箱邊界','ok');
    audit('并行開發 一次推進 '+moved.join('、'));
    pushEvent('#43d4e4','<b>parallel</b> '+moved.length+' 條同時到沙箱邊界');
  }
  function renderAcq(){
    var host=$('#acqTable'); if (!host) return;
    renderPar();
    var meta=$('#acqMeta');
    if (meta) meta.textContent=ACQ.length+' 官方容器 · '+ACQ_OUT.length+' 未收錄';
    host.innerHTML=ACQ.map(function(a){
      var img=a.image!=='—'
        ? '<a href="https://hub.docker.com/r/'+esc(a.image)+'" target="_blank" rel="noopener noreferrer">'+esc(a.image)+'</a>'
        : '倉庫 Dockerfile';
      var repo='<a href="https://github.com/'+esc(a.repo)+'" target="_blank" rel="noopener noreferrer">'+esc(a.name)+'</a>';
      var compose=a.compose==='—'?'無 Compose':a.compose;
      return '<article class="acq-row'+(a.id===ossPick?' sel':'')+'" data-acq="'+esc(a.id)+'">'+
        '<div class="acq-main"><span class="acq-cat">'+esc(a.cat)+'</span><span class="acq-name">'+repo+'</span><span class="acq-lic">'+esc(a.license)+'</span></div>'+
        '<div class="acq-sub"><span class="acq-img">'+img+'</span><span>'+esc(a.imageSrc)+'</span><span>'+esc(compose)+'</span><span>'+esc(a.deploy)+'</span></div>'+
        '</article>';
    }).join('');
    var out=$('#acqOut');
    if (out){
      out.innerHTML='<h4>未收錄 · 沒有官方 Docker</h4><ul>'+ACQ_OUT.map(function(x){
        return '<li><b>'+esc(x.name)+'</b>　'+esc(x.why)+'</li>';
      }).join('')+'</ul>';
    }
  }
  function openAcq(id){
    var a=acqById(id); if (!a) return;
    ossPick=id;
    renderOss();
    var repoHref='https://github.com/'+a.repo;
    var imageRow=a.image!=='—'
      ? ['官方鏡像','<a href="https://hub.docker.com/r/'+esc(a.image)+'" target="_blank" rel="noopener noreferrer">'+esc(a.image)+'</a>', true]
      : ['官方鏡像','沒有獨立鏡像名，用倉庫 Dockerfile 建置'];
    openPeek({
      kicker:a.cat,
      title:a.name,
      status:a.license,
      tone:'warn',
      lead:a.use,
      chips:[{t:a.deploy},{t:a.compose==='—'?'無 Compose':a.compose}],
      sections:[{h:'官方交付', rows:[
        ['倉庫','<a href="'+esc(repoHref)+'" target="_blank" rel="noopener noreferrer">'+esc(a.repo)+'</a>', true],
        imageRow,
        ['鏡像來源', a.imageSrc],
        ['倉庫檔案', a.file],
        ['官方 Compose', a.compose],
        ['許可', a.license],
        ['部署', '<pre class="acq-cmd">'+esc(a.cmd)+'</pre>', true],
        ['主棧','只登記。這頁不拉取、不建置、不啟動。']
      ]}]
    });
  }
  var SKILLS=[
    {id:'sk-evaluator',name:'SkillEvaluator',ver:'未鎖定',bind:'NVIDIA/SkillEvaluator',state:'idle',note:'技能閘門。加載後只登記要先過評估，不在這頁跑掃描或即時評估。'},
    {id:'sk-compress',name:'上下文壓縮',ver:'1.4.0',bind:'八槽各自一份',state:'loaded',note:'每個槽位壓自己的稿。增量回任務庫，不跟其他槽共讀。'},
    {id:'sk-perceive',name:'文本感知',ver:'1.2.0',bind:'TXT-SEE',state:'loaded',note:'只產出候選。行動句仍要經過 guard。'},
    {id:'sk-taskkb',name:'任務庫回寫',ver:'1.0.3',bind:'任務知識庫',state:'idle',note:'槽位釋放後，只留下該槽自己的增量。'},
    {id:'sk-world',name:'世界庫閱讀',ver:'1.0.1',bind:'世界知識庫',state:'idle',note:'佔用槽掛閱讀鎖。釋放時還鎖，不改世界庫。'},
    {id:'sk-craft',name:'craft-anything',ver:'未鎖定',bind:'storytold/craft-anything',state:'idle',note:'唯讀工藝草稿。不寫倉庫，也不在主棧執行。'},
    {id:'sk-scrapling',name:'Scrapling',ver:'未鎖定',bind:'D4Vinci/Scrapling',state:'blocked',note:'抓取框架。主棧禁止加載，這頁也不啟動。'}
  ];
  var MCPS=[
    {id:'mcp-github',name:'GitHub',src:'github',state:'loaded',note:'只讀組件倉庫頁。不寫入、不合併。'},
    {id:'mcp-kb',name:'知識庫',src:'linkin.kb',state:'idle',note:'分開接任務庫回寫與世界庫只讀。'},
    {id:'mcp-slot',name:'槽位總線',src:'linkin.slots',state:'loaded',note:'回報 A1–B4 的佔用、空檔與本槽上下文。'},
    {id:'mcp-browser',name:'瀏覽器',src:'playwright',state:'blocked',note:'瀏覽器不在主棧加載。'},
    {id:'mcp-scrapling',name:'Scrapling',src:'D4Vinci/Scrapling',state:'blocked',note:'抓取連線不進主棧，也不經 MCP 轉發。'}
  ];
  function renderPack(host,meta,list,kind){
    if (!host) return;
    var on=list.filter(function(x){ return x.state==='loaded'; }).length;
    var blocked=list.filter(function(x){ return x.state==='blocked'; }).length;
    if (meta) meta.textContent=on+' 已加載 · '+blocked+' 禁止';
    host.innerHTML=list.map(function(x){
      var label=x.state==='loaded'?'卸下':(x.state==='blocked'?'禁止':'加載');
      return '<article class="load-card '+(x.state==='loaded'?'on':x.state)+'" data-load-kind="'+kind+'" data-load-id="'+esc(x.id)+'" data-search>'+
        '<div><b>'+esc(x.name)+'</b><span>'+esc((x.ver||x.src)+' · '+(x.bind||x.src))+'</span><span>'+esc(x.note)+'</span></div>'+
        '<button type="button" class="load-btn'+(x.state==='loaded'?' on':'')+'" data-load-kind="'+kind+'" data-load-id="'+esc(x.id)+'"'+(x.state==='blocked'?' disabled':'')+'>'+label+'</button></article>';
    }).join('');
  }
  var SKILL_SOURCES=[
    {repo:'mattpocock/skills',n:37,what:'工程化工作流（TDD、grill、spec→tickets）',note:'skills-only',gate:'目錄'},
    {repo:'anthropics/skills',n:20,what:'文件、前端設計、mcp-builder',note:'作者頁',gate:'目錄'},
    {repo:'openai/skills',n:43,what:'Codex 技能（Figma、部署、安全、Playwright）',note:'作者頁',gate:'目錄'},
    {repo:'scrapegraphai/just-scrape',n:1,what:'just-scrape CLI，需 SGAI_API_KEY',note:'作者頁',gate:'禁止'},
    {repo:'vercel-labs/agent-browser',n:1,what:'agent-browser 瀏覽器自動化 CLI',note:'技能頁',gate:'禁止'},
    {repo:'Panniantong/Agent-Reach',n:1,what:'agent-reach 網際網路閱讀／搜尋路由（CLI，非包裝層）',note:'—',gate:'只登記'},
    {repo:'HKUDS/CLI-Anything',n:1,what:'cli-hub 軟體命令列目錄（Linkin 只查目錄）',note:'首頁',gate:'只查'}
  ];
  function renderSkillSources(){
    var body=$('#skillSources tbody'); if (!body) return;
    var total=SKILL_SOURCES.reduce(function(sum,s){ return sum+s.n; },0);
    var meta=$('#skillSrcMeta');
    if (meta) meta.textContent=SKILL_SOURCES.length+' 個來源 · '+total+' 項';
    body.innerHTML=SKILL_SOURCES.map(function(s){
      var href='https://github.com/'+s.repo;
      var gate=s.gate==='禁止'?'<span class="pill red">禁止主棧</span>':(s.gate==='只登記'?'<span class="pill amber">只登記</span>':(s.gate==='只查'?'<span class="pill cyan">只查目錄</span>':'<span class="pill">目錄</span>'));
      return '<tr data-search><td class="mono"><a href="'+esc(href)+'" target="_blank" rel="noopener noreferrer">'+esc(s.repo)+'</a></td>'+
        '<td>'+s.n+'</td><td>'+esc(s.what)+'</td><td class="mono">'+esc(s.note)+'</td><td>'+gate+'</td></tr>';
    }).join('');
  }
  function renderPacks(){
    renderPack($('#skillList'),$('#skillMeta'),SKILLS,'skill');
    renderPack($('#mcpList'),$('#mcpMeta'),MCPS,'mcp');
    renderSkillSources();
  }
  function togglePack(kind,id){
    var list=kind==='mcp'?MCPS:SKILLS;
    var item=list.filter(function(x){ return x.id===id; })[0];
    if (!item) return;
    if (item.state==='blocked'){
      toast(item.name+' 不能在主棧加載','err');
      pushEvent('#ee5c4c','<b>'+kind+'</b> '+esc(item.name)+' 主棧拒絕加載');
      return;
    }
    item.state=item.state==='loaded'?'idle':'loaded';
    renderPacks();
    var on=item.state==='loaded';
    toast((on?'已加載 ':'已卸下 ')+item.name, on?'ok':'');
    audit((on?'加載':'卸下')+(kind==='mcp'?' MCP ':' 技能 ')+item.name);
    pushEvent(on?'#5fd97d':'#f0a500','<b>'+kind+'</b> '+(on?'加載':'卸下')+' '+esc(item.name));
  }
  function toggleOss(id){
    var item=ossById(id);
    if (!item||item.id!==id) return;
    var load=ossLoadOf(item);
    if (load==='block'){
      toast(item.name+' 不能在主棧加載','err');
      pushEvent('#ee5c4c','<b>oss</b> '+esc(item.name)+' 主棧拒絕加載');
      return;
    }
    if (item.state==='wired'){
      toast(item.name+' 已鎖在頁面裡','ok');
      return;
    }
    item.load=load==='on'?'off':'on';
    ossPick=id;
    if (id==='skill-evaluator'){
      var gate=SKILLS.filter(function(x){ return x.id==='sk-evaluator'; })[0];
      if (gate) gate.state=item.load==='on'?'loaded':'idle';
    }
    if (id==='craft-anything'){
      var craft=SKILLS.filter(function(x){ return x.id==='sk-craft'; })[0];
      if (craft) craft.state=item.load==='on'?'loaded':'idle';
    }
    renderOss();
    var on=item.load==='on';
    toast((on?'已加載 ':'已卸下 ')+item.name, on?'ok':'');
    audit((on?'加載':'卸下')+' 開源組件 '+item.name);
    pushEvent(on?'#5fd97d':'#f0a500','<b>oss</b> '+(on?'加載':'卸下')+' '+esc(item.name));
  }
  document.addEventListener('click',function(e){
    var f=e.target.closest('#ossFilters [data-oss]');
    if (f){
      ossFilter=f.getAttribute('data-oss')||'all';
      $$('#ossFilters [data-oss]').forEach(function(b){ b.setAttribute('aria-pressed',b===f?'true':'false'); });
      renderOss();
      return;
    }
    var roleBtn=e.target.closest('[data-role-name]');
    if (roleBtn){
      var roleName=roleBtn.getAttribute('data-role-name');
      roleFilter=roleFilter===roleName?'':roleName;
      renderRoles();
      applyRoleFilter();
      return;
    }
    var load=e.target.closest('.load-btn[data-load-id]');
    if (load){ togglePack(load.getAttribute('data-load-kind'),load.getAttribute('data-load-id')); return; }
    var ossLoad=e.target.closest('[data-oss-load]');
    if (ossLoad){ toggleOss(ossLoad.getAttribute('data-oss-load')); return; }
    var open=e.target.closest('[data-oss-open]');
    if (open){ go({topic:'oss',pane:null,focus:open.getAttribute('data-oss-open')},'replace'); return; }
    var card=e.target.closest('.oss-card[data-oss-id]');
    if (card && !e.target.closest('a,button')) go({topic:'oss',pane:null,focus:card.getAttribute('data-oss-id')},'replace');
  });
  var acqTable=$('#acqTable');
  if (acqTable) acqTable.addEventListener('click', function(e){
    if (e.target.closest('a')) return;
    var row=e.target.closest('[data-acq]');
    if (!row) return;
    openAcq(row.getAttribute('data-acq'));
  });
  var parLanes=$('#parLanes');
  if (parLanes) parLanes.addEventListener('click', function(e){
    var btn=e.target.closest('[data-par]');
    if (btn){ advanceLane(btn.getAttribute('data-par')); return; }
    var lane=e.target.closest('.par-lane');
    if (lane && !e.target.closest('a,button')) openAcq(lane.getAttribute('data-lane'));
  });
  var parAll=$('#parAll');
  if (parAll) parAll.addEventListener('click', advanceAll);

  document.addEventListener('click',function(e){
    var b=e.target.closest('[data-std-level]'); if (!b) return;
    var v=b.getAttribute('data-std-level');
    stdLevel=v==='all'?'all':parseInt(v,10);
    $$('#levelTabs [data-std-level]').forEach(function(x){ x.setAttribute('aria-pressed',x===b?'true':'false'); });
    renderStdRows();
  });

  /* ================= 任務收集 ================= */
  var COLLECT=[
    {id:'C-101',title:'小紅書筆記摘要待歸檔',source:'xhs',pri:'p1',priLabel:'P1',role:'分析席',state:'inbox',note:'官方容器只登記。這頁不拉取內容，確認後才進任務隊列。'},
    {id:'C-102',title:'抖音作品連結待核對',source:'douyin-api',pri:'p1',priLabel:'P1',role:'分析席',state:'inbox',note:'來源是 DTK 官方 Compose。入列前不呼叫下載。'},
    {id:'C-103',title:'個人庫作品批次待整理',source:'douyin-dl',pri:'p2',priLabel:'P2',role:'報告席',state:'inbox',note:'輕量 compose 的登記項。入列後由席位拉取，不在這頁建置容器。'},
    {id:'C-104',title:'公開帳號線索待判讀',source:'maigret',pri:'p2',priLabel:'P2',role:'審核席',state:'inbox',note:'只收線索標題。這頁不對任何帳號執行搜尋。'},
    {id:'C-105',title:'補充帳號線索交叉核對',source:'sherlock',pri:'p2',priLabel:'P2',role:'審核席',state:'inbox',note:'與 Maigret 分開收。入列前不跑官方鏡像。'},
    {id:'C-106',title:'現場巡檢補充項',source:'manual',pri:'p0',priLabel:'P0',role:'工業席',state:'inbox',note:'手動收集，不經過外部容器。'}
  ];
  var collectFilter='inbox';
  var collectSeq=107;
  var COLLECT_SRC={};   // 後端補的來源說明：connector id → {name,cat,license}
  function collectById(id){ return COLLECT.filter(function(x){ return x.id===id; })[0]; }
  function collectSourceOf(id){
    if (COLLECT_SRC[id]) return COLLECT_SRC[id];
    if (id==='manual') return {name:'手動收集',cat:'本頁',license:'—'};
    var a=acqById(id);
    return a?{name:a.name,cat:a.cat,license:a.license}:{name:id,cat:'—',license:'—'};
  }
  function renderCollect(){
    var kpis=$('#collectKpis'), list=$('#collectList');
    if (!list) return;
    var counts={inbox:0,queued:0,skip:0};
    COLLECT.forEach(function(x){ if (counts[x.state]!=null) counts[x.state]++; });
    var bd=$('#navCollectBd');
    if (bd && bd.textContent!==String(counts.inbox)) bd.textContent=String(counts.inbox);
    if (kpis){
      kpis.innerHTML=[
        ['待收',counts.inbox],
        ['已入列',counts.queued],
        ['已略過',counts.skip],
        ['全部',COLLECT.length]
      ].map(function(row){
        return '<div class="collect-stat"><span>'+esc(row[0])+'</span><b>'+esc(row[1])+'</b></div>';
      }).join('');
    }
    var src=$('#collectSource');
    if (src && !src.options.length){
      src.innerHTML='<option value="manual">手動收集</option>'+ACQ.map(function(a){
        return '<option value="'+esc(a.id)+'">'+esc(a.cat+' · '+a.name)+'</option>';
      }).join('');
    }
    var shown=COLLECT.filter(function(x){ return collectFilter==='all'||x.state===collectFilter; });
    list.innerHTML=shown.map(function(x){
      var s=collectSourceOf(x.source);
      var actions=x.state==='inbox'
        ? '<button type="button" class="mini-btn" data-collect-take="'+esc(x.id)+'">收入隊列</button><button type="button" class="mini-btn" data-collect-skip="'+esc(x.id)+'">略過</button>'
        : '<span class="pill '+(x.state==='queued'?'green':'')+'">'+(x.state==='queued'?'已入列 '+(x.taskId||''):'已略過')+'</span>';
      return '<article class="ccard'+(routeState.focus===x.id&&routeState.topic==='collect'?' linked':'')+'" data-id="'+esc(x.id)+'" data-search>'+
        '<div class="ccard-top"><span class="qid">'+esc(x.id)+'</span><span class="pri '+esc(x.pri)+'">'+esc(x.priLabel)+'</span><span class="pill">'+esc(s.cat)+'</span></div>'+
        '<h4>'+esc(x.title)+'</h4>'+
        '<div class="cmeta">'+esc(s.name)+' · '+esc(x.role)+' · '+esc(s.license)+'</div>'+
        '<div class="cmeta">'+esc(x.note)+'</div>'+
        '<div class="ccard-actions">'+actions+'</div></article>';
    }).join('')||'<div class="collect-empty">這個狀態下沒有收集項</div>';
  }
  function admitCollect(id){
    var item=collectById(id);
    if (!item||item.state!=='inbox') return;
    var src=collectSourceOf(item.source);
    var qid='Q-'+(lifeSeq++);
    item.state='queued';
    item.taskId=qid;
    store.tasks.push({
      id:qid,title:item.title,pri:item.pri,priLabel:item.priLabel,lane:'queue',role:item.role,
      parent:'T-2841',step:nextStep('T-2841'),wave:nextWave('T-2841'),seat:'',slot:'',
      prompt:ROLE_PROMPT[item.role]||'',sensors:[],
      tags:[{t:'收集入列',c:''},{t:item.role,c:''}],
      meta:'來自任務收集 <b>'+esc(item.id)+'</b> · '+esc(src.name),sla:4,
      stamp:['來源 <b>'+esc(src.cat)+'</b>','等待該席拉取'],
      fromCollect:item.id
    });
    renderQueue();
    renderCollect();
    toast(item.id+' 已入列 '+qid,'ok');
    audit('任務收集 '+item.id+' → '+qid);
    pushEvent('#5fd97d','<b>collect</b> '+esc(item.id)+' 入列 '+esc(qid));
  }
  function skipCollect(id){
    var item=collectById(id);
    if (!item||item.state!=='inbox') return;
    item.state='skip';
    renderCollect();
    toast(item.id+' 已略過','');
    audit('任務收集略過 '+item.id);
    pushEvent('#9aa2a9','<b>collect</b> '+esc(item.id)+' 略過');
  }
  function addCollect(fields){
    var title=(fields.title||'').trim();
    if (!title){ toast('標題不能是空的','err'); return; }
    var pri=fields.pri==='p0'||fields.pri==='p2'?fields.pri:'p1';
    var role=ROLES[fields.role]?fields.role:'分析席';
    var source=fields.source==='manual'||acqById(fields.source)?fields.source:'manual';
    var item={
      id:'C-'+(collectSeq++),title:title,source:source,pri:pri,priLabel:pri.toUpperCase(),
      role:role,state:'inbox',note:'本頁新增。確認後才進隊列，不在這裡拉取外部內容。'
    };
    COLLECT.unshift(item);
    collectFilter='inbox';
    $$('#collectFilters [data-collect]').forEach(function(b){
      b.setAttribute('aria-pressed',b.getAttribute('data-collect')==='inbox'?'true':'false');
    });
    renderCollect();
    toast(item.id+' 已放入待收','ok');
    audit('任務收集新增 '+item.id);
    pushEvent('#43d4e4','<b>collect</b> 新增 '+esc(item.id));
  }
  var collectRoot=$('#topic-collect');
  if (collectRoot) collectRoot.addEventListener('click', function(e){
    var f=e.target.closest('#collectFilters [data-collect]');
    if (f){
      collectFilter=f.getAttribute('data-collect')||'inbox';
      $$('#collectFilters [data-collect]').forEach(function(b){ b.setAttribute('aria-pressed',b===f?'true':'false'); });
      renderCollect();
      return;
    }
    var take=e.target.closest('[data-collect-take]');
    if (take){ admitCollect(take.getAttribute('data-collect-take')); return; }
    var skip=e.target.closest('[data-collect-skip]');
    if (skip){ skipCollect(skip.getAttribute('data-collect-skip')); return; }
    var card=e.target.closest('.ccard');
    if (!card||e.target.closest('button')) return;
    var id=card.getAttribute('data-id');
    var item=collectById(id); if (!item) return;
    var src=collectSourceOf(item.source);
    go({topic:'collect',pane:null,focus:id},'replace');
    openPeek({
      kicker:'任務收集 · '+src.cat,
      title:item.title,
      status:item.state==='inbox'?'待收':(item.state==='queued'?'已入列 '+(item.taskId||''):'已略過'),
      tone:item.state==='queued'?'ok':(item.state==='skip'?'':'warn'),
      lead:item.note,
      chips:[{t:item.id},{t:item.priLabel},{t:item.role}],
      sections:[{h:'這筆收集', rows:[
        ['來源', src.name+' · '+src.cat],
        ['許可', src.license],
        ['席位', item.role],
        ['隊列', item.taskId||'還沒入列'],
        ['邊界','確認前不進任務隊列，也不在這頁拉取、搜尋或啟動容器。']
      ]}]
    });
  });
  var collectForm=$('#collectForm');
  if (collectForm) collectForm.addEventListener('submit', function(e){
    e.preventDefault();
    addCollect({
      title:$('#collectTitle').value,
      pri:$('#collectPri').value,
      role:$('#collectRole').value,
      source:$('#collectSource').value
    });
    collectForm.reset();
    $('#collectPri').value='p1';
  });

  /* ================= init ================= */
  cacheMetrics();
  renderQueue();
  dispatchFromWait();
  renderRoster();
  renderSlots();
  renderLocks();
  renderAlerts();
  renderAudit();
  renderOss();
  renderCollect();
  pushEvent('#5fd97d','<b>auto-claim</b> 席位自動拉取已啟用');
  pushEvent('#43d4e4','<b>Q-118</b> 佔用槽位 A1 · call_llm 中');
  pushEvent('#ff8b3d','<b>Q-119</b> 已拉取 · 待空檔 #1');
  var peekEl=$('#peek');
  var PIPE_DETAIL={
    query:{kicker:'00 · 入口',title:'查詢',status:'POST /chat',lead:'使用者這一句先進入管線。這一步不選路、不佔槽、不寫任何庫。',rows:[['讀取','這一輪的問題'],['寫入','不寫'],['下一站','記憶注入']]},
    inject:{kicker:'01 · INJECT',title:'記憶注入',status:'42ms · 1.2K tok',lead:'從 Chroma 與 Redis 取出可引用記憶，放進本輪上下文。還沒選路，也不佔 LLM 槽。',rows:[['讀取','向量記憶與短時快取'],['寫入','只進入本輪上下文'],['不做','不改世界庫，不觸發任務']]},
    sense:{kicker:'02 · SENSE',title:'感測上下文',status:'88ms',lead:'八個槽各自壓縮、各自感知，不共讀同一份稿。空檔槽不建稿。',rows:[['讀取','本槽原文窗口'],['留下','目標、最新證據、未完成步'],['丟棄','重複開場、過期附件、空行']]},
    context:{kicker:'03 · CONTEXT',title:'靈境上下文',status:'15ms · 0.9K tok',lead:'建築、敘事、NPC、道具四部門，共 16 個子角色。只提供場景，不調度公司席位。編號不在本倉庫，這裡不臆造。',rows:[['讀取','場景與角色邊界'],['寫入','不寫公司席位'],['下一站','整合召回']]},
    recall:{kicker:'04 · RECALL',title:'整合召回',status:'210ms · 2.4K tok',lead:'任務庫收回各槽自己的增量，世界庫只讀。召回結果交給選路，不直接寫入。',rows:[['任務庫','讀本槽增量，舊版保留'],['世界庫','掛閱讀鎖，用完歸還'],['不做','不把世界庫抄進壓縮稿']]},
    route:{kicker:'05 · ROUTE',title:'選路',status:'8ms · company · rule #1',tone:'warn',lead:'resolve_execution_path 是唯一判斷源。目前走 company。simple 才會進入上方的長度守門。',rows:[['simple','長度守門 → 評估 → 反思迴圈 → SSE'],['company','任務經理 → 認領 → 等空檔 → call_llm'],['判斷','同一輸入與政策版本，結果必須相同']]},
    length:{kicker:'simple',title:'長度守門',status:'18ms',tone:'warn',lead:'只有 simple 路徑檢查長度。超長先縮本輪上下文，不改已經入庫的增量。',rows:[['看什麼','本輪即將送出的字數'],['過長','退回壓縮，不呼叫模型'],['不過','交給評估']]},
    eval:{kicker:'simple',title:'評估',status:'12ms',lead:'對照成敗標準，看這一步是不是還缺證據。評估只產生命題，不觸發寫入。',rows:[['通過','進入收尾'],['不足','可進反思迴圈，次數有上限'],['不做','不改政策、不簽批准']]},
    reflect:{kicker:'simple',title:'反思迴圈',status:'SSE · 不佔槽',lead:'反思把缺的證據說清楚，再走一次 simple。迴圈有次數上限，結束後用 SSE 把這一輪送出。',rows:[['佔槽','不佔'],['輸出','SSE'],['上限','到頂就停，轉人工']]},
    manager:{kicker:'company',title:'任務經理',status:'拆步指派',tone:'warn',lead:'把總任務拆成有順序的步驟，再交給角色席位。節點從這時才出現，整份總任務結束才移走。',rows:[['產出','步驟、角色、成敗標準'],['不產出','不直接 call_llm'],['下一站','席位認領']]},
    claim:{kicker:'company',title:'認領',status:'不佔 LLM',lead:'席位把步驟拉走，鎖只綁這一步。認領本身不呼叫模型，也不占用 A1–B4。',rows:[['鎖','席位 + 步驟'],['釋放','這一步結束或被取消'],['下一站','等該槽空檔']]},
    act:{kicker:'06 · ACT',title:'空檔後的 LLM',status:'2.4s · 3.8K tok',lead:'company 路徑要等到該槽空檔才 call_llm。這一段約佔整輪 79%。寫入仍要經過 guard。',rows:[['條件','槽位空檔，且認領仍有效'],['產出','候選，不是動作'],['寫入','guard 未核可不得執行']]}
  };
  var FALL_DETAIL={
    '接入':'請求進入管線的固定開銷，發生在任何選路之前。',
    '記憶注入':'取出可引用記憶。失敗時這一步重試，不跳去呼叫模型。',
    '感測壓縮':'各槽壓縮自己的上下文。空檔槽這一段是空的。',
    '靈境上下文':'掛上場景。16 個子角色只提供語境，不調度公司席位。',
    '整合召回':'對任務庫與世界庫做召回。世界庫只讀。',
    '選路':'決定走 simple 或 company。這是後面分叉的唯一來源。',
    '守門／評估':'simple 的長度守門與評估。company 不走這一段。',
    'LLM 生成':'本輪最長的一段，約佔總時間 79%。company 還要先等到槽位空檔。',
    '收尾':'SSE 輸出並關閉這一輪。產出另存，不覆蓋舊版。'
  };
  var GATE_DETAIL={
    '唯讀':{tone:'ok',lead:'感測與世界庫在這一輪只能讀。讀到的內容不會自動變成寫入許可。',rows:[['通過條件','沒有寫入意圖'],['擋下','把閱讀結果直接回寫現場或世界庫'],['下一閘','白名單']]},
    '白名單':{tone:'ok',lead:'工具與出口必須已經在白名單。名單外的呼叫在這裡停下。',rows:[['通過條件','工具、網域都在名單內'],['擋下','臨時出口、未登記工具'],['下一閘','長度守門或護欄']]},
    '長度守門':{tone:'ok',lead:'simple 路徑才檢查長度。company 的長度由各槽自己的壓縮稿負責。',rows:[['通過條件','本輪上下文未超窗'],['擋下','超長仍送進模型'],['下一閘','評估迴圈']]},
    '評估迴圈':{tone:'warn',lead:'反思可以再走一輪，但有次數上限。到頂就停，不無限重試。',rows:[['通過條件','成敗標準已滿足，或迴圈到頂'],['擋下','用迴圈改政策或觸發動作'],['下一閘','護欄']]},
    '護欄':{tone:'bad',lead:'guard.py 未核可不得寫入。模型看出的行動句只留候選。',rows:[['現況','ARMED，Q-121 的 62%→54% 尚未核可'],['通過條件','人工核可這一條候選'],['擋下','模型輸出直接執行']]},
    '存檔':{tone:'',lead:'這一輪真的產出新東西才存。存的是新版本，舊版留在產出庫。',rows:[['通過條件','有可保存的新產物'],['不做','覆蓋 ART 舊版'],['下一閘','收尾']]},
    '收尾':{tone:'',lead:'SSE 把這一輪送出，然後關閉。槽位稿銷毀，任務庫增量與產出留著。',rows:[['送出','SSE'],['留下','任務庫增量、產出新版本'],['清掉','本槽這一次的壓縮稿']]}
  };
  var SENSOR_DETAIL={
    'CTX-WIN':{title:'原文窗口',lead:'進模型之前，還沒壓縮的原文占了窗口多少。偏滿時先丟重複句，不先砍掉任務目標。',unit:'% 占用',bands:'小於 72 充裕，72–88 偏滿，大於 88 會截斷。',keeps:'任務目標留在窗首。',drops:'同一段開場的重複。'},
    'CTX-CMP':{title:'上下文壓縮',lead:'每個佔用槽壓自己的一份。保留率是留下的 token 占原文的比例，不是八槽共用的一條平均。',unit:'% 保留',bands:'小於 48 夠瘦，48–62 偏肥，大於 62 幾乎沒壓。',keeps:'目標、最新證據、未完成步。',drops:'已關閉清單、過期附件、空行。'},
    'TXT-SEE':{title:'文本感知',lead:'從壓縮稿裡看出事實、未完成步和行動句。行動句只做候選，置信再高也不直接寫入。',unit:'置信',bands:'小於 0.62 只供參考，0.62–0.85 可成候選，大於 0.85 必須再過護欄。',keeps:'可對上證據的句子。',drops:'沒有證據編號的推論。'}
  };
  var KPI_DETAIL={
    'Auto-claim':['席位自動拉取每分鐘幾次。','數字來自席位拉取，不是模型呼叫次數。'],
    'Queue depth':['還在佇列、尚未被席位拉走的步驟。','P0 可以插隊，其餘按等待時間。'],
    'Claimed / 待空檔':['席位已經拉走，但還在等 LLM 空檔。','這時不佔槽，也不算執行中。'],
    'Executing':['正在佔用槽位、呼叫模型的步驟。','完成或再分拆後，槽位釋放。'],
    'Slot util':['A1–B4 八個槽裡幾個在忙。','B4 是 P0 保留，不算一般空檔。'],
    'Avg slot wait':['從認領到真正拿到槽位的平均秒數。','升高時先看有沒有步驟佔著不放。'],
    'Re-split':['已完成步驟又拆回佇列的次數。','子任務是新步驟，不覆蓋原步驟。'],
    'Throughput':['每小時完成幾步，旁邊是完成與失敗累計。','失敗不自動重試超過政策次數。']
  };
  var LEVEL_NAME={0:'最高決策層',1:'技術領導層',2:'領域領導層',3:'執行層',4:'支援角色'};
  var BUDGET_NOTE={
    reasoning:'推理預算。可以拆開想，仍受日預算與令牌上限。',
    critical:'關鍵預算。這一步擋住下游時不能靜默降級。',
    routine:'日常預算。重複工作，超支先降頻。',
    summary:'摘要預算。只收成已有內容，不新增事實。'
  };
  var KIND_DETAIL={
    std:{title:'公司 STANDARD_ROLES',lead:'80 個代理人席位，供任務經理指派。點表格裡的一列可看該角色的層級、預算和職責。',rows:[['數量','80'],['來源','backend/company/roles/'],['不是','不是 RAHO 脊柱，也不是靈境 16 子角色']]},
    raho:{title:'RAHO 脊柱席位',lead:'L0 到 L4 五個固定席。它們在席位表裡，但不在 STANDARD_ROLES 那 80 列之中。',rows:[['數量','5'],['來源','seat_table.py · _RAHO_SPINE'],['關係','公司角色被指派時，仍要經過這條脊柱的層級']]},
    linkin:{title:'靈境子角色',lead:'建築、敘事、NPC、道具四部門，共 16 個。編號不在本倉庫，這頁不臆造 ID。',rows:[['數量','16'],['來源','linkin/roles.py · role_catalog'],['用途','只提供場景，不調度公司席位']]},
    tpl:{title:'組織模板',lead:'八組預組團隊。模板是席位組合，不是另一個角色，也不能把 16 個靈境子角色塞進模板充數。',rows:[['數量','8'],['來源','同 roles.py'],['啟用','點下面的模板卡可看這一組包含哪些席']]}
  };
  var SEAT_WORD={run:'執行中',wait:'待空檔',queue:'佇列中',done:'已完成',lock:'鎖定',gen:'動態生成','':'空閒'};
  function peekStrip(s){ return String(s==null?'':s).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(); }
  function peekCell(r){
    var plain=r[2]?String(r[1]).replace(/<[^>]+>/g,' '):String(r[1]);
    var val=r[2]?r[1]:esc(r[1]);
    var long=plain.trim().length>28;
    return '<div class="peek-cell'+(long?' wide':'')+'"><span>'+esc(r[0])+'</span><b>'+val+'</b></div>';
  }
  function openPeek(spec){
    if (!peekEl) return;
    $('#peekKicker').textContent=spec.kicker||'詳細';
    $('#peekTitle').textContent=spec.title||'詳細內容';
    var st=$('#peekStatus');
    if (spec.status){ st.hidden=false; st.className='peek-status '+(spec.tone||''); st.textContent=spec.status; }
    else { st.hidden=true; st.textContent=''; }
    $('#peekChips').innerHTML=(spec.chips||[]).filter(function(c){ return c&&c.t; }).map(function(c){
      return '<span class="peek-chip">'+esc(c.t)+'</span>';
    }).join('');
    $('#peekLead').textContent=spec.lead||'';
    var quote=$('#peekQuote');
    quote.hidden=!spec.quote;
    quote.textContent=spec.quote||'';
    var bar=$('#peekBar');
    if (spec.bar!=null && !isNaN(spec.bar)){
      var n=Math.max(0,Math.min(100,Math.round(spec.bar)));
      bar.hidden=false;
      bar.innerHTML='<i style="--pct:'+n+'%"></i><b>'+n+'%</b>';
    } else { bar.hidden=true; bar.innerHTML=''; }
    $('#peekBody').innerHTML=(spec.sections||[]).map(function(sec){
      var rows=(sec.rows||[]).filter(function(r){ return r && r[1]; });
      if (!rows.length) return '';
      return '<section class="peek-sec"><h4>'+esc(sec.h)+'</h4><div class="peek-grid">'+rows.map(peekCell).join('')+'</div></section>';
    }).join('');
    peekEl.hidden=false;
  }
  function openPipe(key){
    var d=PIPE_DETAIL[key]; if (!d) return;
    openPeek({kicker:d.kicker,title:d.title,status:d.status,tone:d.tone||'',lead:d.lead,sections:[{h:'這一步',rows:d.rows}]});
  }
  function closePeek(){ if (peekEl) peekEl.hidden=true; }
  $('#peekClose').addEventListener('click', closePeek);
  peekEl.addEventListener('click', function(e){ if (e.target===peekEl) closePeek(); });
  document.addEventListener('keydown', function(e){ if (e.key==='Escape' && peekEl && !peekEl.hidden) closePeek(); });
  function taskPeek(task, angle){
    var role=ROLES[task.role]||{};
    var prog=task.progress!=null?Math.round(task.progress):(task.waitPct!=null?Math.round(task.waitPct):null);
    var seat=store.seats.filter(function(s){ return s.task===task.id; })[0];
    var seatId=task.seat||(seat&&seat.id)||'';
    openPeek({
      kicker:(angle==='flow'?'總任務進程':'任務狀態')+' · '+(task.parent||'獨立任務'),
      title:task.title,
      status:(typeof statusText==='function'?statusText(task):task.lane)+(task.priLabel?' · '+task.priLabel:''),
      tone:task.lane==='proc'||task.lane==='wait'?'warn':(task.lane==='done'?'ok':''),
      lead:(PARENT_TITLE[task.parent]?PARENT_TITLE[task.parent]+'。':'')+peekStrip(task.meta),
      quote:task.prompt||role.prompt||'',
      bar:prog,
      chips:[{t:task.id},{t:waveTitle(task)},{t:task.role},{t:seatId?seatId+' 已接':'尚未被席位拉取'}],
      sections:[
        {h:'這一步', rows:[
          ['編號', task.id],
          ['狀態', typeof statusText==='function'?statusText(task):task.lane],
          ['並行', waveTitle(task)+(waveGroup(task).length?(' · '+waveGroup(task).map(function(x){ return x.id+' '+statusText(x); }).join('、')):' · 這一波只有這一步')],
          ['角色', task.role],
          ['席位', seatId?seatId+' · '+(seat?seat.statusLabel:'已指派'):'尚未被席位拉取'],
          ['進度', prog!=null?(task.progress!=null?'執行 ':'等待 ')+prog+'%':'尚未開始'],
          ['槽位', task.slot||(seat&&seat.slot&&seat.slot!=='—'&&seat.slot.charAt(0)!=='#'?seat.slot:'')||'未佔槽']
        ]},
        {h:'角色邊界', rows:[
          ['職責', role.duty],
          ['不做', role.cannot],
          ['讀取', role.reads],
          ['寫入', role.writes],
          ['技能', role.skills]
        ]},
        {h:'上下文', rows:[
          ['感測', (task.sensors||[]).join('、')||'這一步沒有掛感測'],
          ['標記', (task.tags||[]).map(function(g){ return g.t; }).join('、')],
          ['紀錄', (task.stamp||[]).map(peekStrip).join(' · ')]
        ]}
      ]
    });
  }
  document.addEventListener('click', function(e){
    if (e.target.closest('#peek,#outIde,.oss-card,.oss-detail,.oss-kpi,a,input,textarea,select,.claim-btn,.load-btn,.mini-btn,.act-btn,.cref,.a-x')) return;
    var pipeHit=e.target.closest('.pipe-hit');
    if (pipeHit){ openPipe(pipeHit.getAttribute('data-step')); return; }
    var el=e.target.closest('.qcard,.flow-node,.scard,.sync-card,.cmp-card,.kb-item,.role-card,.load-card,.kpi,.tcell,.slot,.pipe-slot,.fall-row,.gate-row,.alert,.mtile,.kind-card,.tpl-card,.ms,.lock-row,tr[data-seat],tr[data-raho],tr[data-search],.seat');
    if (!el) return;
    var id=el.getAttribute('data-id')||el.getAttribute('data-seat')||el.getAttribute('data-slot')||el.getAttribute('data-sensor')||el.getAttribute('data-role-name')||el.getAttribute('data-load-id');
    var task=id && store.tasks.filter(function(t){ return t.id===id; })[0];
    if (task && (el.classList.contains('qcard')||el.classList.contains('flow-node'))){ taskPeek(task, el.classList.contains('flow-node')?'flow':'lane'); return; }
    var roleName=el.getAttribute('data-role-name');
    if (roleName && ROLES[roleName]){
      var role=ROLES[roleName];
      var seats=store.seats.filter(function(s){ return s.role===roleName; });
      var tasks=store.tasks.filter(function(t){ return t.role===roleName && t.lane!=='done'; });
      openPeek({
        kicker:role.code,
        title:roleName,
        status:seats.length+' 個席位承接',
        quote:role.prompt,
        chips:seats.map(function(s){ return {t:s.id+' '+s.statusLabel}; }),
        sections:[
          {h:'邊界', rows:[['職責', role.duty],['不做', role.cannot],['讀取', role.reads],['寫入', role.writes],['技能', role.skills]]},
          {h:'現在', rows:[
            ['席位', seats.map(function(s){ return s.id+' · '+s.statusLabel+' · '+s.task; }).join('；')||'尚無席位承接'],
            ['在途步驟', tasks.map(function(t){ return t.id+' '+t.title; }).join('；')||'沒有在途步驟']
          ]}
        ]
      });
      return;
    }
    var seatId=el.getAttribute('data-seat');
    if (seatId && (el.classList.contains('seat')||el.matches('tr'))){
      var seat=store.seats.filter(function(s){ return s.id===seatId; })[0];
      var sRole=seat&&ROLES[seat.role];
      var sTask=seat&&store.tasks.filter(function(t){ return t.id===seat.task; })[0];
      var rawSt=el.getAttribute('data-status')||'';
      openPeek({
        kicker:seat?seat.role:'席位圖',
        title:seatId,
        status:seat?seat.statusLabel:(SEAT_WORD[rawSt]||'空閒'),
        tone:seat&&(seat.status==='run'||seat.status==='wait')?'warn':(seat&&seat.status==='lock'?'bad':'ok'),
        quote:sRole?sRole.prompt:'',
        lead:seat?'這個席位正在承接指定步驟。提示詞跟著角色，不跟著格子編號。':'80 格總圖裡的未指名席位。有顏色只代表當下狀態，還沒有角色和任務。',
        bar:seat?seat.prog:null,
        chips:seat?[{t:seat.task},{t:seat.slot&&seat.slot!=='—'?'槽 '+seat.slot:'未佔槽'},{t:seat.tok&&seat.tok!=='—'?seat.tok+' tok':''}]:[{t:SEAT_WORD[rawSt]||'空閒'}],
        sections:[{h:'承載', rows: seat?[
          ['任務', seat.task+(sTask?' · '+sTask.title:'')],
          ['狀態', seat.statusLabel],
          ['槽位', seat.slot&&seat.slot!=='—'?seat.slot:'未佔用 LLM 槽'],
          ['進度', seat.prog?seat.prog+'%':'尚未開始'],
          ['Token', seat.tok],
          ['不做', sRole?sRole.cannot:'']
        ]:[['狀態', SEAT_WORD[rawSt]||'空閒'],['說明','尚未指派角色，也沒有可拉取的步驟。']]}]
      });
      return;
    }
    if (el.classList.contains('scard')){
      var sid=el.getAttribute('data-sensor');
      var cfg=sensors[sid];
      var meta=SENSOR_DETAIL[sid]||{};
      var stName=($('.sc-state',el)||{}).textContent||'';
      var delta=($('[data-sensor-delta]',el)||{}).textContent||'';
      openPeek({
        kicker:sid+' · 感測',
        title:meta.title||($('.sc-name',el)||{}).textContent||sid,
        status:stName.replace(/\s+/g,' ').trim(),
        tone:el.getAttribute('data-state')==='ok'?'ok':(el.getAttribute('data-state')==='alarm'?'bad':'warn'),
        lead:meta.lead||'',
        chips:[{t:cfg?cfg.val.toFixed(cfg.dec)+' '+meta.unit:''},{t:delta.replace(/\s+/g,' ').trim()}],
        sections:[
          {h:'讀數', rows:[
            ['現值', cfg?cfg.val.toFixed(cfg.dec):''],
            ['變化', delta.replace(/\s+/g,' ').trim()],
            ['最小', ($('[data-stat="'+sid+':min"]',el)||{}).textContent],
            ['平均', ($('[data-stat="'+sid+':avg"]',el)||{}).textContent],
            ['最大', ($('[data-stat="'+sid+':max"]',el)||{}).textContent],
            ['P95', ($('[data-stat="'+sid+':p95"]',el)||{}).textContent]
          ]},
          {h:'怎麼讀', rows:[
            ['門檻', meta.bands],
            ['留下', meta.keeps],
            ['丟棄', meta.drops],
            ['注入', $$('.cref',el).map(function(b){ return b.textContent; }).join('、')||'這一卡目前沒有注入對象'],
            ['新鮮度', ($('[data-fresh]',el)||{}).textContent]
          ]}
        ]
      });
      return;
    }
    var slotId=el.getAttribute('data-slot')||((el.classList.contains('slot')&&$('.s-id span',el))?$('.s-id span',el).textContent:'');
    if (slotId && (el.classList.contains('sync-card')||el.classList.contains('cmp-card')||el.classList.contains('pipe-slot')||el.classList.contains('slot'))){
      var slot=store.slots.filter(function(s){ return s.id===slotId; })[0];
      var info=slot?sensePack(slot):null;
      var slotKind=el.classList.contains('cmp-card')?'壓縮稿':(el.classList.contains('sync-card')?'槽位同步':(el.classList.contains('pipe-slot')?'管線槽位':'LLM 槽位'));
      openPeek({
        kicker:slotKind,
        title:slotId,
        status:slot?(slot.reserve?'P0 保留':(slot.state==='busy'?'佔用':'空閒')):'',
        tone:slot&&slot.state==='busy'&&!slot.reserve?'warn':(slot&&slot.reserve?'bad':'ok'),
        lead:slot?(slot.reserve?'這份預留稿只給 P0 搶佔。不併入其他槽，guard 核可前也不進正式條目。':(info&&info.live?'壓縮、感知和任務庫增量都只屬於本槽。空檔釋放後銷毀稿，增量留下，世界庫只還閱讀鎖。':'空檔不建壓縮稿、不掛感知、不碰兩座知識庫。')):'',
        bar:info&&info.live?info.keep:null,
        chips:[{t:slot?slotWho(slot):''},{t:info&&info.live?'留 '+info.keep+'%':''}],
        sections:[{h:'本槽', rows: info?[
          ['誰在用', slotWho(slot)],
          ['壓縮', info.live?(info.tok+' / '+info.pack.raw+' tok'):(slot.reserve?'預留 '+info.pack.raw+' tok':'無壓縮稿')],
          ['留下', info.pack.kept||'無'],
          ['丟棄', info.pack.drop||'無'],
          ['感知', info.pack.percept],
          ['置信', info.see?info.see.toFixed(2):'無'],
          ['任務庫', info.pack.task||'未回寫'],
          ['同步', info.pack.sync]
        ]:[]}]
      });
      return;
    }
    if (el.classList.contains('kb-item')){
      var kb=el.getAttribute('data-kb');
      var kbSlot=el.getAttribute('data-slot');
      if (kb==='task' && kbSlot){
        var kbS=store.slots.filter(function(s){ return s.id===kbSlot; })[0];
        var kbInfo=kbS?sensePack(kbS):null;
        openPeek({
          kicker:'任務知識庫 · '+kbSlot,
          title:($('b',el)||{}).textContent||kbSlot,
          status:kbS&&(kbInfo.live||kbS.reserve)?'有增量':'空檔',
          tone:kbS&&kbInfo.live?'warn':'ok',
          lead:'任務庫按槽位累積。新的一條加上去，舊版留著。空檔槽不開新條。',
          sections:[{h:'這一條', rows: kbInfo?[
            ['增量', kbInfo.pack.task||'沒有'],
            ['同步', kbInfo.pack.sync],
            ['感知', kbInfo.pack.percept],
            ['留下', kbInfo.pack.kept||'無'],
            ['世界庫', '只讀，不抄進這條']
          ]:[]}]
        });
        return;
      }
      if (kb==='out'){
        var art=OUTPUTS.filter(function(r){ return r.id===el.getAttribute('data-art'); })[0];
        if (art){
          openPeek({
            kicker:'產出庫',
            title:art.title,
            status:art.cite?'已被引用':'可被後續引用',
            tone:art.cite?'ok':'warn',
            lead:art.note,
            chips:[{t:art.id},{t:'產出 '+art.by}],
            sections:[{h:'版本', rows:[
              ['編號', art.id],
              ['產出任務', art.by],
              ['引用', art.cite||'尚無'],
              ['改自', art.from||'沒有前版'],
              ['保留', '舊版不覆蓋。後續任務只能引用或另存新版。']
            ]}]
          });
          return;
        }
      }
      openPeek({
        kicker:'世界知識庫',
        title:($('b',el)||{}).textContent||'條目',
        status:'只讀',
        tone:'ok',
        lead:'八個佔用槽讀的是同一條。閱讀時掛鎖，釋放時歸還，不把這條複製進自己的壓縮稿。',
        sections:[{h:'使用', rows:[
          ['誰在讀', store.slots.filter(function(s){ return s.state==='busy'&&!s.reserve; }).map(function(s){ return s.id; }).join(' · ')||'目前沒有'],
          ['可做', '引用這條規則'],
          ['不可做', '改寫、分叉成槽位私有副本']
        ]}]
      });
      return;
    }
    if (el.classList.contains('load-card')){
      var kind=el.getAttribute('data-load-kind');
      var pack=(kind==='mcp'?MCPS:SKILLS).filter(function(x){ return x.id===el.getAttribute('data-load-id'); })[0];
      if (pack){
        openPeek({
          kicker:kind==='mcp'?'MCP':'技能',
          title:pack.name,
          status:pack.state==='loaded'?'已加載':(pack.state==='blocked'?'禁止主棧':'未加載'),
          tone:pack.state==='loaded'?'ok':(pack.state==='blocked'?'bad':'warn'),
          lead:pack.note,
          chips:[{t:pack.ver||pack.src},{t:pack.bind||''}],
          sections:[{h:'登記', rows:[
            ['版本或來源', pack.ver||pack.src],
            ['綁定', pack.bind||pack.src],
            ['主棧', pack.state==='blocked'?'禁止加載，也不收集金鑰':'加載只改這頁的登記狀態']
          ]}]
        });
        return;
      }
    }
    if (el.classList.contains('kpi')||el.classList.contains('mtile')){
      var metricName=($('.kl',el)||$('.ml',el)||{}).textContent||'指標';
      var metricAlias={'自動拉取':'Auto-claim','待空檔':'Claimed / 待空檔','槽位利用':'Slot util','待空檔時間':'Avg slot wait','再分拆':'Re-split','吞吐':'Throughput'};
      var metricNote=KPI_DETAIL[metricName]||KPI_DETAIL[metricAlias[metricName]]||[];
      var metricVal=($('.kv2',el)||$('.mv',el)||{}).textContent.replace(/\s+/g,' ').trim();
      openPeek({
        kicker:el.classList.contains('mtile')?'席位指標':'佇列指標',
        title:metricName,
        status:metricVal,
        lead:metricNote[0]||($('.ks',el)||{}).textContent||'',
        sections:[{h:'怎麼讀', rows:[
          ['現值', metricVal],
          ['含義', ($('.ks',el)||{}).textContent||metricNote[0]],
          ['邊界', metricNote[1]||'數字只描述目前看板，不構成新的預算批准。']
        ]}]
      });
      return;
    }
    if (el.classList.contains('tcell')){ openPipe(el.getAttribute('data-pipe')); return; }
    if (el.classList.contains('fall-row')||el.classList.contains('gate-row')){
      var name=($('span',el)||{}).textContent||'';
      var mark=($('b',el)||{}).textContent||'';
      var gate=GATE_DETAIL[name];
      openPeek({
        kicker:el.classList.contains('fall-row')?'請求時序':'執行閘口',
        title:name,
        status:mark,
        tone:el.classList.contains('gate-row')&&gate?gate.tone:(/通過/.test(mark)?'ok':(/ARMED|告警/.test(mark)?'bad':(/進行/.test(mark)?'warn':''))),
        lead:el.classList.contains('fall-row')?(FALL_DETAIL[name]||''):(gate?gate.lead:($('em',el)||{}).textContent||''),
        bar:el.classList.contains('fall-row')?parseInt(mark,10):null,
        sections:[{h:el.classList.contains('fall-row')?'占比':'放行', rows: el.classList.contains('fall-row')?[
          ['占比', mark],
          ['位置', name==='LLM 生成'?'整段瀑布的主體':'其餘八段分享剩下的 21%'],
          ['選路', name==='守門／評估'||name==='LLM 生成'?'simple 與 company 在這裡才分開':'兩條路都會經過']
        ]:(gate?gate.rows:[])}]
      });
      return;
    }
    if (el.classList.contains('alert')){
      openPeek({kicker:'告警', title:($('.a-t',el)||{}).textContent||'告警', lead:($('.a-d',el)||{}).textContent||'', status:($('.a-time',el)||{}).textContent||'', tone:'warn', sections:[{h:'處理', rows:[['時間', ($('.a-time',el)||{}).textContent],['下一步','先看對應槽位或任務。消除只收起這張卡，不改變任務狀態。']]}]});
      return;
    }
    if (el.classList.contains('oss-kpi')){
      var ok=el.getAttribute('data-oss-kpi');
      var okMap={
        '組件':['目錄裡的全部組件。','有倉庫頁不代表可以在主棧執行。'],
        '已接入':['版本已經寫死在這頁。','改版本就要改鎖定，不跟 latest。'],
        '候選':['來源已登記，尚未批准。','新版本從 candidate 重走。'],
        '主棧執行':['這頁允許在主棧跑起來的第三方爬蟲與瀏覽器數量。','維持 0。沙箱候選只登記。']
      };
      var okNote=okMap[ok]||[];
      openPeek({kicker:'開源組件', title:ok||'指標', status:($('.ok-v',el)||{}).textContent, lead:okNote[0]||'', sections:[{h:'邊界', rows:[['現值', ($('.ok-v',el)||{}).textContent],['說明', okNote[1]||'']]}]});
      return;
    }
    if (el.classList.contains('ms')){
      var msTitle=($('.txt',el)||{}).textContent||'';
      var msKey=(msTitle.match(/^M\d/)||[''])[0];
      var msMap={
        M1:['原文窗口、壓縮摘要、文本感知都要齊。','對應感測頁的三張卡，不是現場 OPC 點位。'],
        M2:['先定異常門檻和成敗標準。','門檻寫在世界庫，分析席只讀。'],
        M3:['閥位調整只是候選。','Q-121 要等 guard 核可，席位不能直接寫入。'],
        M4:['把已完成步驟收成報告。','報告席不補寫未完成步驟，產出另存新版。']
      };
      var msNote=msMap[msKey]||[];
      openPeek({
        kicker:'總任務 T-2841',
        title:msTitle||'里程碑',
        status:($('.st',el)||{}).textContent||'',
        tone:/DONE/.test(($('.st',el)||{}).textContent)?'ok':(/RUNNING/.test(($('.st',el)||{}).textContent)?'warn':''),
        lead:msNote[0]||'',
        chips:[{t:($('.seat-cnt',el)||{}).textContent}],
        sections:[{h:'這一階', rows:[['席位', ($('.seat-cnt',el)||{}).textContent],['邊界', msNote[1]||'']]}]
      });
      return;
    }
    if (el.classList.contains('kind-card')){
      var kindInfo=KIND_DETAIL[el.getAttribute('data-kind')];
      if (kindInfo){ openPeek({kicker:'角色目錄', title:kindInfo.title, status:($('.kn',el)||{}).textContent, lead:kindInfo.lead, sections:[{h:'範圍', rows:kindInfo.rows}]}); return; }
    }
    if (el.classList.contains('tpl-card')){
      var tpl=ROLE_TEMPLATES.filter(function(t){ return t[0]===el.getAttribute('data-tpl'); })[0];
      if (tpl){
        openPeek({kicker:'組織模板', title:tpl[1], status:tpl[0], lead:tpl[2], sections:[{h:'組成', rows:[['代碼', tpl[0]],['範圍', tpl[2]],['席位', tpl[3]],['不是','模板不是新角色，啟用前仍走任務經理指派。']]}]});
        return;
      }
    }
    if (el.getAttribute('data-raho')){
      var raho=RAHO_SPINE.filter(function(r){ return r[2]===el.getAttribute('data-raho'); })[0];
      if (raho){
        openPeek({kicker:'RAHO 脊柱', title:raho[1], status:raho[0], chips:[{t:raho[2]}], lead:'固定席位，不在 STANDARD_ROLES 的 80 列裡。任務經理不能把這一席改名或併進公司角色表。', sections:[{h:'定義', rows:[['層級', raho[0]],['role_id', raho[2]],['來源','seat_table.py · _RAHO_SPINE']]}]});
        return;
      }
    }
    if (el.classList.contains('lock-row')){
      var lock=store.locks.filter(function(l){ return l.seat===el.getAttribute('data-seat'); })[0];
      if (lock){
        openPeek({kicker:'認領鎖', title:lock.seat, status:lock.ttl+'s / '+lock.max+'s', tone:lock.ttl<90?'bad':(lock.ttl<300?'warn':'ok'), lead:lock.li1, bar:lock.ttl/lock.max*100, sections:[{h:'這把鎖', rows:[['剩餘', lock.ttl+' 秒'],['上限', lock.max+' 秒'],['內容', lock.li2.join(' · ')],['釋放','步驟完成、取消，或心跳超時後回收。']]}]});
        return;
      }
    }
    if (el.closest('#stdRoles')){
      var cells=$$('td',el).map(function(td){ return td.textContent.trim(); });
      var budget=(cells[3]||'').split('·').pop().trim();
      var lvl=(cells[3]||'').match(/L(\d)/);
      openPeek({
        kicker:'STANDARD_ROLES · '+(cells[3]||''),
        title:cells[1]||'角色',
        status:(lvl&&LEVEL_NAME[lvl[1]])||cells[3]||'',
        lead:cells[4]||'',
        chips:[{t:cells[0]},{t:cells[2]}],
        sections:[{h:'定義', rows:[
          ['ID', cells[0]],
          ['分類', cells[2]],
          ['預算層', cells[3]],
          ['預算含義', BUDGET_NOTE[budget]||''],
          ['主要職責', cells[4]],
          ['邊界','這是目錄定義。點開不代表這個角色已經坐上席位。']
        ]}]
      });
      return;
    }
    if (el.closest('#skillSources')){
      var src=$$('td',el).map(function(td){ return td.textContent.trim(); });
      var repoCell=src[0]||'';
      openPeek({
        kicker:'技能來源',
        title:repoCell,
        status:src[4]||src[3]||'',
        tone:/禁止/.test(src[4]||'')?'bad':(/只/.test(src[4]||'')?'warn':'ok'),
        lead:src[2]||'',
        chips:[{t:(src[1]||'')+' 項'},{t:src[3]||''}],
        sections:[{h:'目錄', rows:[
          ['倉庫', repoCell.indexOf('/')>0?'<a href="https://github.com/'+esc(repoCell)+'" target="_blank" rel="noopener noreferrer">'+esc(repoCell)+'</a>':repoCell, repoCell.indexOf('/')>0],
          ['數量', src[1]],
          ['內容', src[2]],
          ['標記', src[3]],
          ['主棧', src[4]],
          ['金鑰','這頁不收集、不代填任何 API 金鑰。']
        ]}]
      });
      return;
    }
  });
  /* ---------- 對外接口：讓 js/api.js 用真資料覆蓋這頁的示範資料 ---------- */
  window.KOLINDEX_UI={
    version:'2026-11-21',
    /* 用 kolindex-api 的收集清單換掉 COLLECT 並重繪 */
    setCollect:function(items){
      if (!Array.isArray(items)||!items.length) return false;
      COLLECT=items.map(function(x){
        if (x.srcName) COLLECT_SRC[String(x.source)]={name:String(x.srcName),cat:String(x.srcCat||'—'),license:String(x.srcLicense||'—')};
        return {
          id:String(x.id), title:String(x.title||''), source:String(x.source||'manual'),
          pri:String(x.pri||'p2'), priLabel:String(x.priLabel||'P2'),
          role:String(x.role||'審核席'), state:String(x.state||'inbox'), note:String(x.note||'')
        };
      });
      collectFilter='inbox';
      renderCollect();
      return true;
    },
    /* 用 /api/alerts 的 ui 形狀換掉 store.alerts 並重繪 */
    setAlerts:function(items){
      if (!Array.isArray(items)) return false;
      store.alerts=items.map(function(a){
        return {
          id:String(a.id), tone:a.tone==='red'?'red':(a.tone==='amber'?'amber':'orange'),
          icon:String(a.icon||'i-warn'), title:String(a.title||''),
          desc:String(a.desc||''), time:String(a.time||'')
        };
      });
      renderAlerts();
      return true;
    },
    /* 目前頁面上的收集項 / 告警數，方便測試腳本檢查 */
    counts:function(){ return {collect:COLLECT.length, alerts:store.alerts.length}; }
  };

  bootRouter();
  mountTips();
  requestAnimationFrame(pumpTicker);
})();
