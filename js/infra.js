/* ============================================================
   infra.js · 「基礎設施 → 連接器」子分頁
   唯一真實來源：GET /api/health/connectors（8 組憑證 + 各 connector 任務數）
   只讀：不提供重新授權／改憑證的入口，憑證輪換留在 vault。
   ============================================================ */
(function(){
'use strict';

var BASE=(typeof window!=='undefined'&&window.KOLINDEX_BASE)||'';
var POLL_MS=60000;

var STATUS={
  active:{label:'正常',tone:'green',sig:'ok'},
  cooling:{label:'冷卻',tone:'amber',sig:'warn'},
  expired:{label:'已過期',tone:'red',sig:'warn'},
  disabled:{label:'停用',tone:'',sig:'warn'}
};
var JOB_ORDER=['queued','running','backoff','failed','blocked','succeeded'];
var JOB_LABEL={queued:'待跑',running:'跑中',backoff:'退避',failed:'失敗',blocked:'受阻',succeeded:'完成'};

var C={ok:false,loaded:false,loading:false,active:false,items:[],error:'',at:0,lastErr:''};

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
function hoursUntil(v){
  var t=ts(v);
  if(!t) return null;
  return (t-Date.now())/3600000;
}
function hnum(h){
  if(h==null) return '—';
  if(h<1) return '<1';
  if(h<10) return String(Math.round(h*10)/10);
  return String(Math.round(h));
}

/* ---------- 片段 ---------- */
function credHtml(item){
  var st=String((item&&item.status)||'');
  if(st==='expired') return '<span class="pill red"><span class="sig warn"></span>已失效</span>';
  var h=hoursUntil(item&&item.expires_hint);
  if(h==null) return '<span class="dim">—</span>';
  if(h<=0) return '<span class="pill red"><span class="sig warn"></span>逾期 '+esc(hnum(Math.abs(h)))+'h</span>';
  return '<span class="pill '+(h<6?'amber':'')+'">尚餘 '+esc(hnum(h))+'h</span>';
}
function jobsHtml(jobs){
  if(!jobs||typeof jobs!=='object') return '<span class="dim">—</span>';
  var keys=Object.keys(jobs).filter(function(k){ return Number(jobs[k])>0; });
  keys.sort(function(a,b){
    var ia=JOB_ORDER.indexOf(a), ib=JOB_ORDER.indexOf(b);
    if(ia<0) ia=99;
    if(ib<0) ib=99;
    return ia-ib;
  });
  if(!keys.length) return '<span class="dim">—</span>';
  return '<span class="conn-jobs">'+keys.map(function(k){
    return '<span class="job-chip j-'+esc(k)+'">'+esc(JOB_LABEL[k]||k)+' '+esc(jobs[k])+'</span>';
  }).join('')+'</span>';
}
function rowHtml(item){
  var st=STATUS[item&&item.status]||{label:(item&&item.status)||'—',tone:'',sig:'warn'};
  return '<tr class="conn-row" data-platform="'+esc(item&&item.platform)+'" data-status="'+esc(item&&item.status)+'">'+
    '<td class="strong">'+esc(item&&(item.label||item.platform))+'</td>'+
    '<td class="mono dim">'+esc(item&&item.platform)+'</td>'+
    '<td><span class="pill '+st.tone+'"><span class="sig '+st.sig+'"></span>'+esc(st.label)+'</span></td>'+
    '<td class="mono" data-col="low">'+esc(rel(item&&item.last_ok_at)||'—')+'</td>'+
    '<td>'+credHtml(item)+'</td>'+
    '<td class="mono" data-col="low">'+esc(Number(item&&item.fail_streak)||0)+'</td>'+
    '<td>'+jobsHtml(item&&item.jobs)+'</td>'+
  '</tr>';
}
function statHtml(label,n,tone){
  return '<span class="conn-kv '+(tone||'')+'">'+esc(label)+' <b>'+esc(n)+'</b></span>';
}

/* ---------- 畫面 ---------- */
function render(){
  var items=C.items||[];
  var sum=$('connSummary'), body=$('connBody'), foot=$('connStatus'), chip=$('connChip'), tabN=$('connTabN');
  if(tabN) tabN.textContent=items.length?String(items.length):'—';
  if(!items.length){
    if(body) body.innerHTML='<tr><td colspan="7" class="conn-empty">'+(C.error?'後端沒有回應 · 連不到 /api/health/connectors':'連接器資料載入中…')+'<br><span class="dim">跑 node kolindex-api/server.mjs 後重新整理</span></td></tr>';
    if(sum) sum.innerHTML=statHtml('連接器',0,'')+'<span class="dim">'+(C.error?'離線':'等待中')+'</span>';
    if(foot){ foot.textContent=C.error?'後端離線 · '+C.error:'只讀 · 正在連後端'; foot.className='chip '+(C.error?'red':'or'); }
    if(chip){ chip.textContent=C.error?'連接器 · 離線':'連接器 · 連線中'; chip.className='chip '+(C.error?'red':'or'); }
    return;
  }
  var by={};
  var q=0, run=0;
  items.forEach(function(x){
    by[x.status]=(by[x.status]||0)+1;
    if(x.jobs){
      q+=Number(x.jobs.queued)||0;
      run+=Number(x.jobs.running)||0;
    }
  });
  if(sum){
    var parts=[];
    parts.push(statHtml('連接器',items.length,''));
    if(by.active) parts.push(statHtml('正常',by.active,'ok'));
    if(by.cooling) parts.push(statHtml('冷卻',by.cooling,'warn'));
    if(by.expired) parts.push(statHtml('過期',by.expired,'bad'));
    if(by.disabled) parts.push(statHtml('停用',by.disabled,''));
    if(q) parts.push(statHtml('待跑任務',q,''));
    if(run) parts.push(statHtml('跑中任務',run,''));
    sum.innerHTML=parts.join('');
  }
  if(body) body.innerHTML=items.map(rowHtml).join('');
  if(foot){
    foot.textContent='只讀 · GET /api/health/connectors · 更新 '+rel(new Date(C.at).toISOString())+(C.error?'（最近一次連線失敗）':'');
    foot.className='chip '+(C.error?'or':'green');
  }
  if(chip){
    var bad=(by.expired||0)+(by.cooling||0);
    chip.textContent='連接器 '+items.length+' · '+(bad?bad+' 需注意':'全部正常');
    chip.className='chip '+(by.expired?'red':(by.cooling?'amber':'green'));
  }
}

/* ---------- 取資料 ---------- */
function load(force){
  if(C.loading) return Promise.resolve(C);
  if(C.loaded && !force && (Date.now()-C.at)<POLL_MS) return Promise.resolve(C);
  C.loading=true;
  return fetch(BASE+'/api/health/connectors',{headers:{accept:'application/json'},cache:'no-store'})
    .then(function(r){
      if(!r.ok) throw new Error('HTTP '+r.status);
      return r.json();
    })
    .then(function(d){
      var items=(d&&Array.isArray(d.items))?d.items:[];
      C.items=items; C.ok=true; C.loaded=true; C.error=''; C.at=Date.now();
      render();
      return C;
    })
    .catch(function(e){
      C.ok=false; C.error=String((e&&e.message)||e); C.lastErr=C.error;
      if(!C.items.length) C.loaded=false;
      render();
      return C;
    })
    .then(function(v){ C.loading=false; return v; });
}

function onApi(detail){
  var d=detail||{};
  if(d.ok){
    if(!C.loaded) load();
    else if(Date.now()-C.at>POLL_MS*1.5) load(true);
    return;
  }
  if(C.loaded){ C.ok=false; C.error=d.reason||'offline'; render(); }
}

/* ---------- 進場 ---------- */
function topicOf(){
  try { return (document.body&&document.body.getAttribute)?String(document.body.getAttribute('data-topic')||''):''; }
  catch(e){ return ''; }
}
function onTopic(){
  var t=topicOf();
  if(t==='infra'){ C.active=true; if(!C.loaded) load(); }
}
if(typeof MutationObserver==='function' && document.body){
  try { new MutationObserver(onTopic).observe(document.body,{attributes:true,attributeFilter:['data-topic']}); } catch(e){}
}
try { if(typeof window.addEventListener==='function') window.addEventListener('kolindex:api',function(e){ onApi(e&&e.detail); }); } catch(e){}

render();
onTopic();

window.KOLINDEX_CONN={version:'1.0.0',state:C,esc:esc,rel:rel,hoursUntil:hoursUntil,credHtml:credHtml,jobsHtml:jobsHtml,rowHtml:rowHtml,render:render,load:load,onApi:onApi};
})();