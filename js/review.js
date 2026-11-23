/* ============================================================
   review.js · 「審核台」分頁
   AI 只產候選，人工裁決後寫回 review_task 並留一筆 audit_log。
   後端：GET /api/review/queue?state=all · POST /api/review/:id/verdict
         GET /api/ai/events · POST /api/ai/events/:id/ack · GET /api/audit
   ============================================================ */
(function(){
'use strict';

var BASE=(typeof window!=='undefined'&&window.KOLINDEX_BASE)||'';

var AI_KIND={sentiment_shift:'情緒轉向',burst:'互動爆量',brand_collab:'品牌合作',anomaly:'異常模式',label_shift:'標籤漂移'};
var KIND_SHORT={identity:'歸戶',brand_collab:'品牌',safety:'安全'};
var VERDICT_LABEL={confirm:'確認',reject:'駁回',defer:'延後'};
var STATE_LABEL={open:'待處理',confirmed:'已確認',rejected:'已駁回',deferred:'已延後',acked:'已處理'};
var ACT_LABEL={'review.verdict':'裁決','ai.ack':'AI 處理'};

var R={ok:false,loaded:false,loading:false,active:false,mode:'review',items:[],events:[],
  counts:null,sel:null,audit:[],busy:false,error:'',at:0,lastErr:''};

/* ---------- 小工具 ---------- */
function $(id){ return document.getElementById(id); }
function esc(s){
  return String(s==null?'':s).replace(/[&<>"']/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}
function ts(v){
  if(!v) return NaN;
  var s=String(v);
  if(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) s=s.replace(' ','T')+'Z';  // sqlite datetime('now') 是 UTC
  return Date.parse(s);
}
function rel(v){
  var t=ts(v);
  if(!t) return '';
  var d=Math.max(0,Math.round((Date.now()-t)/1000));
  if(d<45) return '剛剛';
  if(d<3600) return Math.round(d/60)+'m';
  if(d<86400) return Math.round(d/3600)+'h';
  return Math.round(d/86400)+'d';
}
function trim(s,n){ s=String(s==null?'':s); return s.length>n?s.slice(0,n-1)+'…':s; }
function on(el,ev,fn){ if(el&&el.addEventListener) el.addEventListener(ev,fn); }

function setStatus(text,tone){
  var e=$('reviewStatus');
  if(!e) return;
  e.textContent=text;
  e.className='chip '+(tone||'or');
}
function setCounts(){
  var c=R.counts||{};
  var box=$('reviewCounts');
  if(box) box.textContent=(c.open||0)+' 待處理 · '+(c.total||0)+' 總計';
  var a=$('reviewOpenN'), b=$('reviewAiN');
  if(a) a.textContent=String(c.open||0);
  if(b) b.textContent=String(c.ai_open||0);
  var bd=$('navReviewBd');
  if(bd&&R.loaded) bd.textContent=String(c.open||0);
}

/* ---------- 取資料 ---------- */
function req(path,opt){
  return fetch(BASE+path,opt).then(function(r){
    return r.text().then(function(t){
      var j={};
      try { j=t?JSON.parse(t):{}; } catch(e){ j={raw:t}; }
      return {ok:r.ok,status:r.status,data:j};
    });
  });
}

function sameId(a,b){ return a!=null&&b!=null&&String(a)===String(b); }
function listOf(){ return R.mode==='ai'?R.events:R.items; }
function current(){ var rows=listOf(); for(var i=0;i<rows.length;i++) if(sameId(rows[i].id,R.sel)) return rows[i]; return null; }
function firstOpen(){
  var rows=listOf();
  for(var i=0;i<rows.length;i++) if(rows[i].state==='open') return rows[i].id;
  return rows.length?rows[0].id:null;
}

function load(force){
  if(R.loading) return R.pending||Promise.resolve(false);
  if(R.loaded&&!force) return Promise.resolve(true);
  R.loading=true; R.error='';
  setStatus('載入中…','or');
  R.pending=Promise.all([
    req('/api/review/queue?state=all'),
    req('/api/ai/events'),
    req('/api/audit?limit=8')
  ]).then(function(res){
    R.loading=false;
    var q=res[0], e=res[1], a=res[2];
    if(!q.ok||!e.ok){
      R.ok=false;
      R.error='後端回應 '+(q.ok?e.status:q.status);
      setStatus('後端不在 · 顯示上次結果','red');
      render();
      return false;
    }
    R.ok=true; R.at=Date.now(); R.loaded=true;
    R.items=q.data.items||[];
    R.counts=q.data.counts||R.counts;
    R.events=e.data.items||[];
    R.audit=(a.ok&&a.data.items)||[];
    if(R.sel==null||!current()) R.sel=firstOpen();
    setStatus('已連線 · '+((R.counts&&R.counts.open)||0)+' 待處理','green');
    render();
    return true;
  }).catch(function(err){
    R.loading=false; R.ok=false;
    R.error=String((err&&err.message)||err);
    setStatus('後端不在 · 顯示上次結果','red');
    render();
    return false;
  }).then(function(v){ R.pending=null; return v; });
  return R.pending;
}

/* ---------- 畫左邊清單 ---------- */
function cardHtml(x){
  var on=sameId(x.id,R.sel)?'true':'false';
  if(R.mode==='ai'){
    var sev=Number(x.severity)||1;
    return '<button type="button" class="rv-item ai sev'+sev+' s-'+esc(x.state)+'" data-id="'+esc(x.id)+'" aria-pressed="'+on+'">'+
      '<span class="ri-top"><span class="rv-tag ai">AI</span>'+
        '<span class="ri-sub">'+esc(AI_KIND[x.kind]||x.kind||'事件')+'</span>'+
        '<span class="ri-state s-'+esc(x.state)+'">'+esc(STATE_LABEL[x.state]||x.state||'')+'</span></span>'+
      '<span class="ri-name">'+esc(x.display_name||('人物 #'+x.person_id))+'</span>'+
      '<span class="ri-meta">'+esc(trim(x.summary,46))+' · '+esc(rel(x.created_at))+'</span>'+
    '</button>';
  }
  var kind=x.kind||'identity';
  var detail=x.accounts&&x.accounts.length?x.accounts.length+' 個帳號':(x.payload&&x.payload.brand?x.payload.brand:'—');
  return '<button type="button" class="rv-item s-'+esc(x.state)+'" data-id="'+esc(x.id)+'" aria-pressed="'+on+'">'+
    '<span class="ri-top"><span class="rv-tag '+esc(kind)+'">'+esc(KIND_SHORT[kind]||kind)+'</span>'+
      '<span class="ri-sub">'+esc(detail)+'</span>'+
      '<span class="ri-state s-'+esc(x.state)+'">'+esc(STATE_LABEL[x.state]||x.state||'')+'</span></span>'+
    '<span class="ri-name">'+esc(x.subject||('#'+x.id))+'</span>'+
    '<span class="ri-meta">'+(x.score==null?'—':'F2 '+Number(x.score).toFixed(2))+' · '+esc(trim(x.payload&&x.payload.reason,40))+'</span>'+
  '</button>';
}

function renderModes(){
  var box=$('reviewModes');
  if(!box||!box.querySelectorAll) return;
  var btns=box.querySelectorAll('button[data-mode]');
  for(var i=0;i<btns.length;i++){
    var b=btns[i];
    b.setAttribute('aria-pressed',b.getAttribute('data-mode')===R.mode?'true':'false');
  }
}

function renderList(){
  var box=$('reviewList');
  if(!box) return;
  var rows=listOf();
  if(!rows.length){
    box.innerHTML='<div class="rv-empty">'+(R.loaded?'目前沒有待辦':'尚未連上後端')+'</div>';
    return;
  }
  var out=[];
  for(var i=0;i<rows.length;i++) out.push(cardHtml(rows[i]));
  box.innerHTML=out.join('');
}

/* ---------- 畫右邊詳情 ---------- */
function gaugeHtml(score){
  if(score==null) return '';
  var pct=Math.max(2,Math.min(100,Math.round(Number(score)*100)));
  return '<div class="rv-score"><b>'+Number(score).toFixed(2)+'</b>'+
    '<div class="rv-gauge"><i style="width:'+pct+'%"></i><span style="left:50%"></span><span style="left:85%"></span></div>'+
    '<small>0.5 / 0.85 閾值</small></div>';
}

function reviewDetailHtml(x){
  var rows='';
  for(var i=0;i<(x.evidence||[]).length;i++){
    var e=x.evidence[i];
    rows+='<li class="'+esc(e.kind||'')+'"><span class="k">'+esc(e.k)+'</span><span class="v">'+esc(e.v)+'</span></li>';
  }
  var acts;
  if(x.state==='open'){
    acts='<div class="rv-acts">'+
      '<button type="button" class="rv-btn ok" data-act="confirm">確認歸戶</button>'+
      '<button type="button" class="rv-btn no" data-act="reject">駁回</button>'+
      '<button type="button" class="rv-btn hold" data-act="defer">延後</button>'+
      '<span class="rv-ask">'+(R.busy?'寫入中…':'寫回 review_task · 留一筆 audit_log')+'</span>'+
    '</div>';
  }else{
    acts='<div class="rv-acts done">已' +esc(STATE_LABEL[x.state]||x.state)+' by '+esc(x.decided_by||'—')+
      (x.decided_at?' · '+esc(rel(x.decided_at)):'')+' · audit_log 已留存</div>';
  }
  return '<div class="rv-head"><div class="rv-hd">'+
      '<div class="rv-kicker">'+esc(x.kind_label||x.kind)+' · '+esc(x.scope||'general')+' · #'+esc(x.id)+'</div>'+
      '<h3 class="rv-subject">'+esc(x.subject||('#'+x.id))+'</h3>'+
      '<div class="rv-state '+esc(x.state)+'">'+esc(STATE_LABEL[x.state]||x.state)+'</div>'+
    '</div>'+gaugeHtml(x.score)+'</div>'+
    '<div class="rv-body"><ul class="rv-ev">'+(rows||'<li><span class="k">—</span><span class="v">沒有附帶證據</span></li>')+'</ul></div>'+
    (R.error?'<div class="rv-err">'+esc(R.error)+'</div>':'')+
    acts;
}

function aiDetailHtml(x){
  var ev=x.evidence&&typeof x.evidence==='object'?x.evidence:{};
  var rows='';
  Object.keys(ev).forEach(function(k){
    var v=ev[k];
    if(v==null) return;
    rows+='<li><span class="k">'+esc(k)+'</span><span class="v">'+esc(typeof v==='object'?JSON.stringify(v):v)+'</span></li>';
  });
  rows='<li class="score"><span class="k">嚴重度</span><span class="v">'+esc(x.severity)+'</span></li>'+
    '<li><span class="k">類型</span><span class="v">'+esc(AI_KIND[x.kind]||x.kind)+'</span></li>'+
    '<li><span class="k">摘要</span><span class="v">'+esc(x.summary||'')+'</span></li>'+rows;
  var acts=x.state==='open'
    ? '<div class="rv-acts"><button type="button" class="rv-btn ok" data-act="ack">標記已處理</button>'+
      '<span class="rv-ask">AI 只產候選 · 處理後寫 audit_log</span></div>'
    : '<div class="rv-acts done">已處理 · audit_log 已留存</div>';
  return '<div class="rv-head"><div class="rv-hd">'+
      '<div class="rv-kicker">AI 事件 · sev '+esc(x.severity)+' · #'+esc(x.id)+'</div>'+
      '<h3 class="rv-subject">'+esc(x.display_name||('人物 #'+x.person_id))+'</h3>'+
      '<div class="rv-state '+esc(x.state)+'">'+esc(STATE_LABEL[x.state]||x.state)+'</div>'+
    '</div></div>'+
    '<div class="rv-body"><ul class="rv-ev">'+rows+'</ul></div>'+
    (R.error?'<div class="rv-err">'+esc(R.error)+'</div>':'')+
    acts;
}

function detailHtml(x){
  if(!x) return '<div class="rv-body"><div class="rv-empty">'+(R.loaded?'左邊沒有可處理的項目':'尚未連上後端 · 請確認 kolindex-api 在 5210')+'</div></div>';
  return R.mode==='ai'?aiDetailHtml(x):reviewDetailHtml(x);
}

function renderDetail(){
  var box=$('reviewDetail');
  if(!box) return;
  box.innerHTML=detailHtml(current());
  if(R.busy) box.className='review-detail rv-busy';
  else box.className='review-detail';
}

function renderLog(){
  var box=$('reviewLog');
  if(!box) return;
  var rows=R.audit||[];
  var head='<div class="rl-head">最近裁決 <span>audit_log · append-only</span></div>';
  if(!rows.length){ box.innerHTML=head+'<div class="rl-empty">還沒有裁決紀錄</div>'; return; }
  var out=[];
  for(var i=0;i<rows.length;i++){
    var a=rows[i], d=a.detail||{};
    out.push('<li><span class="rl-act">'+esc(ACT_LABEL[a.action]||a.action)+'</span>'+
      '<span class="rl-sub">'+esc(a.subject_type)+' #'+esc(a.subject_id)+' · '+esc(d.verdict||d.kind||'')+'</span>'+
      '<span class="rl-who">'+esc(a.actor||'—')+'</span>'+
      '<span class="rl-when">'+esc(rel(a.created_at))+'</span>'+
      (d.note?'<span class="rl-note">'+esc(trim(d.note,90))+'</span>':'')+'</li>');
  }
  box.innerHTML=head+'<ul class="rl-list">'+out.join('')+'</ul>';
}

function render(){
  renderModes(); renderList(); renderDetail(); renderLog(); setCounts();
}

/* ---------- 裁決 ---------- */
function select(id){ R.sel=id; renderList(); renderDetail(); }

function nextAfter(id){
  var rows=listOf(), idx=-1, i;
  for(i=0;i<rows.length;i++) if(sameId(rows[i].id,id)) idx=i;
  for(i=idx+1;i<rows.length;i++) if(rows[i].state==='open') return rows[i].id;
  for(i=0;i<rows.length;i++) if(rows[i].state==='open'&&!sameId(rows[i].id,id)) return rows[i].id;
  return id;
}

function toast(msg,tone){
  var ui=window.KOLINDEX_UI;
  if(ui&&typeof ui.toast==='function') ui.toast(msg,tone);
}

function finish(res,okMsg,failMsg){
  R.busy=false;
  if(!res.ok){
    R.error=(res.data&&(res.data.error||res.data.message))||('HTTP '+res.status);
    setStatus('寫入失敗 · '+R.error,'red');
    toast(failMsg||'寫入失敗：'+R.error,'err');
    render();
    return false;
  }
  R.error='';
  if(res.data.counts) R.counts=res.data.counts;
  toast(okMsg,'ok');
  setStatus('已寫入 · audit_log 留痕','green');
  return true;
}

function sendVerdict(id,verdict,who,reason){
  if(R.busy) return Promise.resolve(false);
  R.busy=true; renderDetail();
  return req('/api/review/'+encodeURIComponent(id)+'/verdict',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({verdict:verdict,actor:who||'local-operator',note:reason||''})
  }).then(function(res){
    var nice=VERDICT_LABEL[verdict]||verdict;
    var ok=finish(res,'已'+nice+' · 寫入 audit_log','裁決失敗');
    if(ok){
      for(var i=0;i<R.items.length;i++){
        if(sameId(R.items[i].id,id)){
          R.items[i].state=res.data.state;
          R.items[i].decided_by=who||'local-operator';
          R.items[i].decided_at=new Date().toISOString();
        }
      }
      R.sel=nextAfter(id);
      loadAudit();
    }
    render();
    return ok;
  }).catch(function(err){
    R.busy=false;
    R.error=String((err&&err.message)||err);
    setStatus('後端不在 · 沒有寫入','red');
    render();
    return false;
  });
}

function sendAck(id){
  if(R.busy) return Promise.resolve(false);
  R.busy=true; renderDetail();
  return req('/api/ai/events/'+encodeURIComponent(id)+'/ack',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({actor:'local-operator'})
  }).then(function(res){
    var ok=finish(res,'已標記處理','處理失敗');
    if(ok){
      for(var i=0;i<R.events.length;i++) if(sameId(R.events[i].id,id)) R.events[i].state='acked';
      loadAudit();
    }
    render();
    return ok;
  }).catch(function(err){
    R.busy=false;
    R.error=String((err&&err.message)||err);
    render();
    return false;
  });
}

function loadAudit(){
  return req('/api/audit?limit=8').then(function(res){
    if(res.ok&&res.data.items) R.audit=res.data.items;
    renderLog();
  }).catch(function(){});
}

// 裁決入口：有全域二次確認就用（原因必填 → 進 audit note），沒有就直接寫
function decide(verdict){
  var x=current();
  if(!x||x.state!=='open'||R.busy) return Promise.resolve(false);
  var ui=window.KOLINDEX_UI;
  var nice=VERDICT_LABEL[verdict]||verdict;
  if(ui&&typeof ui.confirm==='function'){
    ui.confirm({
      title:nice+' · '+(x.kind_label||x.kind)+' #'+x.id,
      desc:'對象 '+(x.subject||'#'+x.id)+(x.score==null?'':' · F2 '+Number(x.score).toFixed(2))+
        '。確認後寫回 review_task，並在 audit_log 留一筆（含操作者與原因）。',
      onConfirm:function(who,reason){ sendVerdict(x.id,verdict,who,reason); }
    });
    return Promise.resolve(true);
  }
  return sendVerdict(x.id,verdict,'local-operator','（前端未提供確認框）');
}

function ack(){
  var x=current();
  if(!x||x.state!=='open'||R.busy) return Promise.resolve(false);
  return sendAck(x.id);
}

function act(name){
  if(R.mode==='ai'){
    if(name!=='confirm'&&name!=='ack') return Promise.resolve(false);
    return ack();
  }
  var map={confirm:'confirm',reject:'reject',defer:'defer'};
  if(!map[name]) return Promise.resolve(false);
  return decide(name);
}

function move(delta){
  var rows=listOf();
  if(!rows.length) return;
  var idx=-1, i;
  for(i=0;i<rows.length;i++) if(sameId(rows[i].id,R.sel)) idx=i;
  var n=(idx+delta+rows.length)%rows.length;
  select(rows[n].id);
}

/* ---------- 事件 ---------- */
function setMode(mode){
  if(mode!==R.mode){
    R.mode=mode;
    R.sel=firstOpen();
    render();
  }
  if(!R.loaded) load();
}

on($('reviewModes'),'click',function(e){
  var b=e.target&&e.target.closest?e.target.closest('[data-mode]'):null;
  if(!b) return;
  setMode(b.getAttribute('data-mode')==='ai'?'ai':'review');
});

on($('reviewList'),'click',function(e){
  var b=e.target&&e.target.closest?e.target.closest('[data-id]'):null;
  if(!b) return;
  select(b.getAttribute('data-id'));
});

on($('reviewDetail'),'click',function(e){
  var b=e.target&&e.target.closest?e.target.closest('[data-act]'):null;
  if(!b) return;
  act(b.getAttribute('data-act'));
});

function onTopic(topic){
  var on=topic==='review';
  R.active=on;
  if(!on) return Promise.resolve(false);
  if(!R.loaded) return load();
  if(Date.now()-R.at>30000) return load(true);
  return Promise.resolve(true);
}

on(window,'kolindex:api',function(e){
  var d=(e&&e.detail)||{};
  if(!d.ok) return;
  if(R.active){
    if(!R.loaded) load();
    else if(Date.now()-R.at>20000) load(true);
  }
});

if(typeof MutationObserver==='function'&&document.body){
  new MutationObserver(function(){
    onTopic(document.body.getAttribute('data-topic'));
  }).observe(document.body,{attributes:true,attributeFilter:['data-topic']});
}

/* ---------- 啟動 ---------- */
if(document.body&&document.body.getAttribute('data-topic')==='review') onTopic('review');
render();
setStatus(R.loaded?'已連線':'待連線','or');

window.KOLINDEX_REVIEW={
  version:'2026-11-21',
  state:function(){ return R; },
  esc:esc, rel:rel, ts:ts, trim:trim, sameId:sameId,
  req:req, load:load, loadAudit:loadAudit,
  render:render, renderList:renderList, renderDetail:renderDetail, renderLog:renderLog,
  cardHtml:cardHtml, detailHtml:detailHtml, gaugeHtml:gaugeHtml,
  listOf:listOf, current:current, firstOpen:firstOpen, nextAfter:nextAfter,
  select:select, setMode:setMode, decide:decide, ack:ack, act:act, move:move,
  sendVerdict:sendVerdict, sendAck:sendAck, onTopic:onTopic
};
})();
