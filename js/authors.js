/* ============================================================
   authors.js · 「作者」分頁
   抖音作者索引：一位一列，點一位在右側看他的作品。
   後端：GET /api/library/authors?q=&sort=&limit=&offset=
         GET /api/library?author=<名>&sort=recent&limit=24&offset=
   縮圖與影片由 5400 靜態站給；點作品開素材庫那個檢視器。這頁只讀。
   ============================================================ */
(function(){
'use strict';

var BASE=(typeof window!=='undefined'&&window.KOLINDEX_BASE)||'';
var LIMIT=100, WORK_LIMIT=24, POLL_MS=120000;
var KIND_LABEL={gallery:'圖集',video:'影片'};

var A={ok:false,loaded:false,loading:false,active:false,q:'',sort:'count',
  items:[],total:0,offset:0,counts:null,error:'',at:0,tok:0,
  sel:'',meta:null,works:[],worksTotal:0,worksOffset:0,worksLoading:false,wtok:0,
  view:'index',queued:false,wQueued:false};

/* ---------- 小工具 ---------- */
function $(id){ return document.getElementById(id); }
function esc(s){
  return String(s==null?'':s).replace(/[&<>"']/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}
function trim(s,n){ s=String(s==null?'':s).replace(/\s+/g,' ').trim(); return s.length>n?s.slice(0,n-1)+'…':s; }
function nfmt(n){ return String(n==null?0:n).replace(/\B(?=(\d{3})+(?!\d))/g,','); }
function bytes(n){
  n=Number(n)||0;
  if(n>=1e9) return (n/1e9).toFixed(2)+' GB';
  if(n>=1e6) return (n/1e6).toFixed(1)+' MB';
  if(n>=1e3) return Math.round(n/1e3)+' KB';
  return n+' B';
}
function day(v){
  var t=Number(v);
  if(!t) return '—';
  var d=new Date(t*1000);
  var p=function(x){ return (x<10?'0':'')+x; };
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());
}
function mediaUrl(p){
  if(!p) return '';
  if(/^https?:/i.test(p)) return p;
  return 'http://127.0.0.1:5400/'+String(p).replace(/^\/+/,'');
}
function displayAuthor(a){ if(!a) return '未命名'; return a==='unnamed'?'未命名':a; }
function on(el,ev,fn){ if(el&&el.addEventListener) el.addEventListener(ev,fn); }
function setStatus(text,tone){
  var e=$('auStatus'); if(!e) return;
  e.textContent=text; e.className='chip '+(tone||'or');
}

/* ---------- 取資料 ---------- */
function req(path){
  return fetch(BASE+path,{headers:{accept:'application/json'}}).then(function(r){
    return r.text().then(function(t){
      var j={};
      try { j=t?JSON.parse(t):{}; } catch(e){ j={raw:t}; }
      return {ok:r.ok,status:r.status,data:j};
    });
  });
}

function load(reset){
  if(A.loading){ A.queued=!!(reset||A.queued); return Promise.resolve(false); }
  if(reset) A.offset=0;
  var tok=++A.tok;
  A.loading=true;
  setStatus('載入中…','or');
  var path='/api/library/authors?sort='+encodeURIComponent(A.sort)+'&limit='+LIMIT+'&offset='+A.offset;
  if(A.q) path+='&q='+encodeURIComponent(A.q);
  A.pending=req(path).then(function(res){
    if(tok!==A.tok) return false;
    A.loading=false;
    if(!res.ok){
      A.ok=false; A.error=(res.data&&(res.data.error||res.data.message))||('HTTP '+res.status);
      setStatus('後端未連線','or'); renderError(); return false;
    }
    var d=res.data||{};
    A.ok=true; A.loaded=true; A.at=Date.now(); A.error='';
    A.counts=d.counts||null;
    A.total=Number(d.total)||0;
    A.items=reset?(d.items||[]):A.items.concat(d.items||[]);
    A.offset=A.items.length;
    setStatus('API · LIVE','cyan');
    renderAll();
    return true;
  }).catch(function(err){
    if(tok!==A.tok) return false;
    A.loading=false; A.ok=false; A.error=String(err&&err.message||err);
    setStatus('後端未連線','or'); renderError(); return false;
  }).then(function(v){
    if(A.queued){ var again=A.queued; A.queued=false; load(again); }
    return v;
  });
  return A.pending;
}

function loadWorks(reset){
  if(!A.sel) return Promise.resolve(false);
  if(A.worksLoading){ A.wQueued=!!(reset||A.wQueued); return Promise.resolve(false); }
  if(reset){ A.worksOffset=0; A.works=[]; }
  var tok=++A.wtok, who=A.sel;
  A.worksLoading=true; renderSide();
  var path='/api/library?author='+encodeURIComponent(who)+'&sort=recent&limit='+WORK_LIMIT+'&offset='+A.worksOffset;
  A.wPending=req(path).then(function(res){
    if(tok!==A.wtok||who!==A.sel) return false;
    A.worksLoading=false;
    if(!res.ok){ renderSide(); return false; }
    var d=res.data||{};
    A.works=reset?(d.items||[]):A.works.concat(d.items||[]);
    A.worksOffset=A.works.length;
    A.worksTotal=Number(d.total)||0;
    renderSide();
    return true;
  }).catch(function(){
    if(tok!==A.wtok) return false;
    A.worksLoading=false; renderSide(); return false;
  });
  return A.wPending;
}

/* ---------- 畫面 ---------- */
function renderKpis(){
  var box=$('auKpis'); if(!box) return;
  var c=A.counts||{};
  var cells=[
    ['作者', nfmt(c.authors||A.total)],
    ['已命名', nfmt(c.named)],
    ['純數字帳號', nfmt(c.numeric)],
    ['未命名作品', nfmt(c.unnamedWorks)]
  ];
  box.innerHTML=cells.map(function(x){
    return '<div class="au-kpi"><span>'+esc(x[0])+'</span><b>'+esc(x[1])+'</b></div>';
  }).join('');
  var cnt=$('auCount');
  if(cnt) cnt.textContent=nfmt(A.total)+' 位';
  var bd=$('navAuthorsBd');
  if(bd&&c.authors) bd.textContent=(c.authors>=1000?(c.authors/1000).toFixed(1)+'k':String(c.authors));
}

function rowHtml(a){
  var meta=nfmt(a.works||0)+' 件 · '+nfmt(a.files||0)+' 檔 · '+bytes(a.bytes);
  var on=A.sel===a.author?' on':'';
  return '<button type="button" class="au-row'+on+'" data-author="'+esc(a.author)+'" aria-pressed="'+(A.sel===a.author)+'">'+
    '<span class="ar-name">'+esc(displayAuthor(a.author))+'</span>'+
    '<span class="ar-meta">'+esc(meta)+'</span>'+
    '<span class="ar-day">'+esc(day(a.lastCt))+'</span>'+
    '<span class="ar-kind">'+esc((a.gallery||0)+'/'+(a.video||0))+'</span>'+
  '</button>';
}

function renderList(){
  var box=$('auList'); if(!box) return;
  if(!A.items.length){
    box.innerHTML='<div class="au-empty">'+(A.loaded?'沒有符合的作者':'尚未載入')+'</div>';
  } else {
    box.innerHTML=A.items.map(rowHtml).join('');
  }
  renderFoot();
}

function renderFoot(){
  var more=$('auMore'), foot=$('auFoot');
  var has=A.items.length<A.total;
  if(more){
    more.disabled=!has||A.loading;
    more.textContent=has?'載入更多（還有 '+nfmt(A.total-A.items.length)+' 位）':'沒有更多了';
  }
  if(foot) foot.textContent=A.items.length?('顯示 '+nfmt(A.items.length)+' / '+nfmt(A.total)+' 位作者'):'';
}

function workHtml(it){
  var cover=it.cover?mediaUrl(it.cover):'';
  return '<button type="button" class="au-work" data-id="'+esc(it.id)+'" title="'+esc(trim(it.caption,80)||it.id)+'">'+
    '<span class="aw-shot">'+(cover?'<img src="'+esc(cover)+'" alt="" loading="lazy" decoding="async">':'<span class="aw-noimg">無縮圖</span>')+
      '<span class="aw-badge">'+esc(KIND_LABEL[it.kind]||it.kind)+'</span></span>'+
    '<span class="aw-meta">'+esc(day(it.ct))+' · '+esc(bytes(it.bytes))+'</span>'+
  '</button>';
}

function renderSide(){
  var box=$('auSide'); if(!box) return;
  if(!A.sel){
    box.innerHTML='<div class="au-empty"><b>還沒選作者。</b>點左邊任一位，這裡會顯示他的作品、容量與最近發佈。</div>';
    return;
  }
  var m=A.meta||{};
  var head='<div class="au-head">'+
    '<div class="ah-kicker">作者</div>'+
    '<div class="ah-name">'+esc(displayAuthor(A.sel))+'</div>'+
    '<div class="ah-meta">'+
      '<span>'+esc(nfmt(m.works||A.worksTotal||0))+' 件</span>'+
      '<span>圖集 '+esc(nfmt(m.gallery||0))+'</span>'+
      '<span>影片 '+esc(nfmt(m.video||0))+'</span>'+
      '<span>'+esc(nfmt(m.files||0))+' 檔</span>'+
      '<span>'+esc(bytes(m.bytes||0))+'</span>'+
      '<span>最近 '+esc(day(m.lastCt))+'</span>'+
    '</div>'+
    '<div class="ah-actions">'+
      '<button type="button" class="mini-btn" data-au-back="1">← 作者清單</button>'+
      '<button type="button" class="mini-btn primary" data-lib-all="1">在素材庫看全部</button>'+
    '</div>'+
  '</div>';
  var grid;
  if(!A.works.length){
    grid='<div class="au-empty">'+(A.worksLoading?'載入作品…':'這位作者本機沒有檔案')+'</div>';
  } else {
    grid='<div class="au-grid">'+A.works.map(workHtml).join('')+'</div>';
  }
  var more='';
  if(A.works.length<A.worksTotal){
    more='<div class="au-more au-more-side"><button type="button" class="mini-btn" data-work-more="1">'+(A.worksLoading?'載入中…':'更多作品（還有 '+nfmt(A.worksTotal-A.works.length)+' 件）')+'</button></div>';
  }
  box.innerHTML=head+grid+more;
}

/* 兩個檢視：index＝作者清單（全寬卡片grid）、profile＝作者檔案（全寬作品牆）。
   只換 #topic-authors 上的 data-au-view，版面由 CSS 決定。 */
function applyView(){
  var box=$('topic-authors');
  if(box&&box.setAttribute) box.setAttribute('data-au-view',A.view);
}
function renderAll(){ renderKpis(); renderList(); renderSide(); applyView(); }

function renderError(){
  var box=$('auList');
  if(box) box.innerHTML='<div class="au-empty"><b>作者索引的後端沒開。</b>API 在 5210；跑 <code>node kolindex-api\\server.mjs</code>。<br>'+esc(A.error||'')+'</div>';
  renderFoot();
}

function selectAuthor(name){
  A.sel=String(name||'');
  A.meta=null;
  A.works=[]; A.worksTotal=0; A.worksOffset=0;
  A.view='profile';
  for(var i=0;i<A.items.length;i++){ if(A.items[i].author===A.sel){ A.meta=A.items[i]; break; } }
  renderAll();
  loadWorks(true);
}

/* 回到作者清單：清單捲動位置保持不動（同一個 DOM，只是換顯示） */
function backToList(){
  A.view='index';
  renderAll();
}

function openInLibrary(){
  var who=A.sel; if(!who) return;
  if(window.KOLINDEX_LIBRARY&&window.KOLINDEX_LIBRARY.setAuthor) window.KOLINDEX_LIBRARY.setAuthor(who);
  if(window.KOLINDEX_UI&&window.KOLINDEX_UI.setTopic) window.KOLINDEX_UI.setTopic('library');
}

function openWork(id){
  if(window.KOLINDEX_LIBRARY&&window.KOLINDEX_LIBRARY.openViewer) window.KOLINDEX_LIBRARY.openViewer(id);
}

/* ---------- 事件 ---------- */
function debounce(fn,ms){
  var t=null;
  return function(){
    var args=arguments,self=this;
    clearTimeout(t);
    t=setTimeout(function(){ fn.apply(self,args); },ms);
  };
}

function bind(){
  setStatus('待連線','or');
  renderSide();
  applyView();
  var list=$('auList');
  on(list,'click',function(e){
    var row=e.target.closest('.au-row');
    if(!row) return;
    var who=row.getAttribute('data-author');
    if(who===A.sel) return;
    selectAuthor(who);
  });

  var side=$('auSide');
  on(side,'click',function(e){
    if(e.target.closest('[data-au-back]')){ backToList(); return; }
    if(e.target.closest('[data-lib-all]')){ openInLibrary(); return; }
    if(e.target.closest('[data-work-more]')){ loadWorks(false); return; }
    var w=e.target.closest('.au-work');
    if(w) openWork(w.getAttribute('data-id'));
  });

  var search=$('auSearch');
  var doSearch=debounce(function(){
    A.q=String(search&&search.value||'').trim();
    load(true);
  },260);
  on(search,'input',doSearch);

  var sort=$('auSort');
  on(sort,'click',function(e){
    var b=e.target.closest('button[data-sort]');
    if(!b) return;
    var s=b.getAttribute('data-sort');
    if(s===A.sort) return;
    A.sort=s;
    sort.querySelectorAll('button').forEach(function(x){ x.setAttribute('aria-pressed',String(x===b)); });
    load(true);
  });

  on($('auReset'),'click',function(){
    A.q=''; A.sort='count';
    if(search) search.value='';
    var s=$('auSort');
    if(s) s.querySelectorAll('button').forEach(function(x){ x.setAttribute('aria-pressed',String(x.getAttribute('data-sort')==='count')); });
    load(true);
  });

  on($('auMore'),'click',function(){ load(false); });

  window.addEventListener('kolindex:api',function(e){
    var d=(e&&e.detail)||{};
    if(d.ok&&!A.loaded) load(true);
    else if(d.ok&&A.active&&Date.now()-A.at>POLL_MS) load(true);
  });

  if(typeof MutationObserver==='function'){
    var mo=new MutationObserver(function(){
      var now=document.body.getAttribute('data-topic')==='authors';
      if(now===A.active) return;
      A.active=now;
      if(now&&(!A.loaded||Date.now()-A.at>POLL_MS)) load(true);
    });
    mo.observe(document.body,{attributes:true,attributeFilter:['data-topic']});
  }
  A.active=document.body.getAttribute('data-topic')==='authors';
  if(A.active) load(true);
}

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',bind);
else bind();

window.KOLINDEX_AUTHORS={state:A,load:load,loadWorks:loadWorks,selectAuthor:selectAuthor,backToList:backToList,openInLibrary:openInLibrary,
  displayAuthor:displayAuthor,rowHtml:rowHtml,authorRows:function(){ return A.items; },esc:esc,bytes:bytes,day:day,nfmt:nfmt};
})();