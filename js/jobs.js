/* ============================================================
   jobs.js · 「基礎設施 → 排程工作」子分頁
   唯一真實來源：GET /api/jobs（crawl_job 逐列，含狀態／嘗試／優先）
   只讀：不提供重排、重試或改優先權的入口。
   ============================================================ */
(function(){
'use strict';

var BASE=(typeof window!=='undefined'&&window.KOLINDEX_BASE)||'';
var POLL_MS=60000;
var LIMIT=100;

var STATE={
  queued:{label:'待跑',tone:''},
  running:{label:'跑中',tone:'amber'},
  waiting_review:{label:'待審',tone:'orange'},
  stopped:{label:'已停',tone:'violet'},
  timeout:{label:'逾時',tone:'orange'},
  cancelled:{label:'已取消',tone:''},
  failed:{label:'失敗',tone:'red'},
  succeeded:{label:'完成',tone:'green'}
};
var LEGACY={backoff:'timeout',blocked:'stopped'};
var ORDER=['queued','running','waiting_review','stopped','timeout','cancelled','failed','succeeded'];
var FILTER_LABEL={all:'全部',queued:'待跑',running:'跑中',waiting_review:'待審',stopped:'已停',timeout:'逾時',cancelled:'已取消',failed:'失敗',succeeded:'完成'};

var J={ok:false,loaded:false,loading:false,active:false,filter:'all',items:[],counts:{},total:0,error:'',at:0};

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
  if(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) s=s.replace(' ','T')+'Z';
  return Date.parse(s);
}
function rel(v){
  var t=ts(v);
  if(!t) return '';
  var d=Math.max(0,Math.round((Date.now()-t)/1000));
  if(d<60) return '剛剛';
  if(d<3600) return Math.floor(d/60)+'m';
  if(d<86400) return Math.floor(d/3600)+'h';
  if(d<86400*7) return Math.floor(d/86400)+'d';
  var dt=new Date(t);
  return (dt.getMonth()+1)+'/'+dt.getDate();
}
function stamp(v){ return v?esc(String(v)):''; }
function countOf(k){ return Number(J.counts&&J.counts[k])||0; }
function filterLabel(){ return FILTER_LABEL[J.filter]||J.filter||'全部'; }

/* ---------- 片段 ---------- */
function statHtml(label,n,tone){
  return '<span class="jobs-kv '+(tone||'')+'">'+esc(label)+' <b>'+esc(n)+'</b></span>';
}
function rowHtml(j){
  var raw=(j&&j.state)||'';
  var key=STATE[raw]?raw:(LEGACY[raw]||'');
  var st=STATE[key]||{label:'—',tone:''};
  var who=(j&&j.handle)?('<span class="mono">@'+esc(j.handle)+'</span> <span class="dim">'+esc(j.platform||'')+'</span>'):'<span class="dim">—</span>';
  var when=(j&&(j.finished_at||j.started_at))?(rel(j.finished_at||j.started_at)+'<span class="dim">'+(j.finished_at?' 完成':' 起')+'</span>'):'<span class="dim">—</span>';
  return '<tr class="jobs-row" data-state="'+esc(j&&j.state)+'">'+
    '<td class="mono dim">#'+esc(j&&j.id)+'</td>'+
    '<td class="strong mono">'+esc((j&&j.connector)||'—')+'</td>'+
    '<td class="mono" data-col="low">'+esc((j&&j.job_type)||'—')+'</td>'+
    '<td><span class="pill '+st.tone+'"><span class="sig'+(st.tone?' warn':'')+'"></span>'+esc(st.label)+'</span></td>'+
    '<td class="mono" data-col="low">'+esc(Number(j&&j.attempts)||0)+'</td>'+
    '<td class="mono" data-col="low">'+esc(Number(j&&j.priority)||0)+'</td>'+
    '<td>'+who+'</td>'+
    '<td class="mono">'+when+'</td>'+
    '<td class="mono" data-col="low">'+((j&&j.error_code)?'<span class="jobs-err">'+esc(j.error_code)+'</span>':'<span class="dim">—</span>')+'</td>'+
  '</tr>';
}

/* ---------- 畫面 ---------- */
function render(){
  var body=$('jobsBody'), sum=$('jobsSummary'), foot=$('jobsStatus'), tabN=$('jobsTabN');
  var total=Number(J.total)||0;
  if(tabN) tabN.textContent=total?String(total):'—';

  document.querySelectorAll('#jobsFilters [data-state]').forEach(function(b){
    var on=b.getAttribute('data-state')===J.filter;
    b.setAttribute('aria-pressed',on?'true':'false');
    b.classList.toggle('on',on);
  });

  if(sum){
    var parts=[statHtml('全部',total,'')];
    ORDER.forEach(function(k){
      var n=countOf(k);
      var key=STATE[k]?k:(LEGACY[k]||'');
      if(!STATE[key]) return;
      if(n) parts.push(statHtml(STATE[key].label,n,STATE[key].tone==='amber'?'warn':(key==='failed'?'bad':'')));
    });
    sum.innerHTML=parts.join('');
  }

  if(!J.items.length){
    if(body){
      var msg;
      if(J.error) msg='後端沒有回應 · 連不到 /api/jobs<br><span class="dim">'+(J.filter==='all'?'跑 node kolindex-api/server.mjs 後重新整理':'也可能是這個狀態目前沒有工作')+'</span>';
      else if(!J.loaded) msg='排程工作載入中…';
      else msg='這個狀態目前沒有工作（篩選：'+filterLabel()+'）';
      body.innerHTML='<tr><td colspan="9" class="jobs-empty">'+msg+'</td></tr>';
    }
  } else if(body){
    body.innerHTML=J.items.map(rowHtml).join('');
  }

  if(foot){
    if(J.error==='source'){ foot.textContent='來源錯誤 · 顯示上次結果'; foot.className='chip or'; }
    else if(J.error){ foot.textContent='後端離線 · 連不到 /api/jobs'+(J.at?' · 顯示 '+rel(new Date(J.at).toISOString())+' 的結果':''); foot.className='chip red'; }
    else if(!J.loaded){ foot.textContent='只讀 · 正在連後端'; foot.className='chip or'; }
    else { foot.textContent='只讀 · GET /api/jobs · '+filterLabel()+' '+J.items.length+' 列 · 更新 '+rel(new Date(J.at).toISOString()); foot.className='chip green'; }
  }
}

/* ---------- 取資料 ---------- */
function load(force){
  if(J.loading) return Promise.resolve(J);
  if(J.loaded && !force && (Date.now()-J.at)<POLL_MS) return Promise.resolve(J);
  J.loading=true;
  var wanted=J.filter;
  var url='/api/jobs?state='+encodeURIComponent(wanted)+'&limit='+LIMIT;
  var call=window.KOL&&window.KOL.request;
  var pending=call?call(url):fetch(url,{headers:{accept:'application/json'},cache:'no-store'}).then(function(r){
      if(!r.ok) throw new Error('HTTP '+r.status);
      return r.json();
    });
  return pending
    .then(function(d){
      if(wanted!==J.filter) return J;
      J.items=(d&&Array.isArray(d.items))?d.items:[];
      J.counts=(d&&d.counts&&typeof d.counts==='object')?d.counts:{};
      J.total=Number(d&&d.total)||0;
      J.ok=true; J.loaded=true; J.error=''; J.at=Date.now();
      render();
      return J;
    })
    .catch(function(e){
      if(wanted!==J.filter) return J;
      J.ok=false; J.error=String((e&&e.message)||e);
      if(!J.items.length) J.loaded=false;
      render();
      return J;
    })
    .then(function(v){
      J.loading=false;
      if(wanted!==J.filter) return load(true);
      return v;
    });
}

function topicOf(){
  try { return (document.body&&document.body.getAttribute)?String(document.body.getAttribute('data-topic')||''):''; }
  catch(e){ return ''; }
}
function maybeLoad(){
  if(topicOf()!=='infra') return;
  J.active=true;
  if(!J.loaded) load();
}

function onApi(detail){
  var d=detail||{};
  if(!d.ok&&d.reason){
    if(d.reason==='offline' || d.reason==='source'){
      J.ok=false; J.error=d.reason;
      if(J.loaded) render();
      return;
    }
    J.items=[]; J.counts={}; J.total=0; J.ok=false; J.loaded=false; J.error=d.reason;
    render();
    return;
  }
  if(d.ok){
    if(!J.loaded) load();
    else if(J.active && Date.now()-J.at>POLL_MS*1.5) load(true);
    return;
  }
  if(J.loaded){ J.ok=false; J.error=d.reason||'offline'; render(); }
}

/* ---------- 事件 ---------- */
(function wire(){
  var filters=$('jobsFilters');
  if(filters){
    filters.addEventListener('click',function(e){
      var b=e.target&&e.target.closest?e.target.closest('[data-state]'):null;
      if(!b) return;
      var s=b.getAttribute('data-state');
      if(!s || s===J.filter) return;
      J.filter=s;
      load(true);
    });
  }
  var tabs=$('infraTabs');
  if(tabs){
    tabs.addEventListener('click',function(e){
      var b=e.target&&e.target.closest?e.target.closest('.tab-btn'):null;
      if(!b || b.getAttribute('data-pane')!=='jobs') return;
      J.active=true;
      setTimeout(function(){ load(); },0);
    });
  }
  var pane=$('pane-jobs');
  if(pane && typeof MutationObserver==='function'){
    try { new MutationObserver(function(){ maybeLoad(); }).observe(pane,{attributes:true,attributeFilter:['class']}); } catch(e){}
  }
  if(typeof MutationObserver==='function' && document.body){
    try { new MutationObserver(maybeLoad).observe(document.body,{attributes:true,attributeFilter:['data-topic']}); } catch(e){}
  }
  try { if(typeof window.addEventListener==='function') window.addEventListener('kolindex:api',function(e){ onApi(e&&e.detail); }); } catch(e){}
})();

render();
maybeLoad();

window.KOLINDEX_JOBS={version:'1.0.0',state:J,STATE:STATE,esc:esc,rel:rel,rowHtml:rowHtml,render:render,load:load,onApi:onApi,maybeLoad:maybeLoad};
})();
