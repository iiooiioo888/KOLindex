/* ============================================================
   person.js · 「人物檔案」分頁
   抖音作者（18,883 位）當人物索引：兩個檢視，清單與檔案。
   後端：GET /api/library/authors?q=&sort=&limit=&offset=
         GET /api/library?author=<名>&sort=recent&limit=24&offset=
         GET /api/library/months?author=<名>   （作品時間軸）
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
  months:[],monthsLoading:false,mtok:0,
  plat:null,platLoading:false,ptok:0,
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
function asUnix(v){
  if(v==null||v==='') return 0;
  if(typeof v==='number'&&isFinite(v)) return v>1e12?Math.round(v/1000):v;
  var s=String(v).trim();
  if(/^\d+(\.\d+)?$/.test(s)){ var n=Number(s); return n>1e12?Math.round(n/1000):n; }
  var p=Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)?s.replace(' ','T')+'Z':s);
  return p&&!isNaN(p)?Math.round(p/1000):0;
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
  var e=$('pnStatus'); if(!e) return;
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
  if(A.worksLoading){
    A.wQueued=reset?true:(A.wQueued===true?true:'append');
    return Promise.resolve(false);
  }
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
    if(tok!==A.wtok||who!==A.sel) return false;
    A.worksLoading=false;
    renderSide();
    return false;
  }).then(function(v){
    if(tok!==A.wtok) return v;
    var stuck=A.worksLoading;
    A.worksLoading=false;
    if(who!==A.sel) A.wQueued=true;
    if(A.wQueued){
      var again=A.wQueued===true;
      A.wQueued=false;
      return loadWorks(again);
    }
    if(stuck) renderSide();
    return v;
  });
  return A.wPending;
}

/* 作品時間軸：一個月一條，寬度按最大值等比。只抓月份聚合，不抓全部作品。 */
function loadMonths(){
  if(!A.sel) return Promise.resolve(false);
  var tok=++A.mtok, who=A.sel;
  A.monthsLoading=true;
  A.mPending=req('/api/library/months?author='+encodeURIComponent(who)).then(function(res){
    if(tok!==A.mtok||who!==A.sel) return false;
    A.monthsLoading=false;
    var d=(res&&res.data)||{};
    A.months=res&&res.ok&&d.items?d.items:[];
    renderSide();
    return true;
  }).catch(function(){
    if(tok!==A.mtok) return false;
    A.monthsLoading=false; A.months=[]; renderSide(); return false;
  });
  return A.mPending;
}

/* 平台資料：抖音帳號（sec_uid）、互動合計與平均、互動最高的作品。
   資料來自 GET /api/library/author，統計值來自 remote_json.stats（抓取當下的平台數字）。 */
function loadPlatform(){
  if(!A.sel) return Promise.resolve(false);
  var tok=++A.ptok, who=A.sel;
  A.platLoading=true;
  A.pPending=req('/api/library/author?author='+encodeURIComponent(who)).then(function(res){
    if(tok!==A.ptok||who!==A.sel) return false;
    A.platLoading=false;
    A.plat=(res&&res.ok&&res.data&&res.data.platforms)?res.data:null;
    renderSide();
    return true;
  }).catch(function(){
    if(tok!==A.ptok) return false;
    A.platLoading=false; A.plat=null; renderSide(); return false;
  });
  return A.pPending;
}

function platformHtml(){
  if(A.platLoading) return '<div class="pn-plat"><div class="pm-cap">平台</div><div class="pm-empty">載入中…</div></div>';
  var d=A.plat, pf=d&&d.platforms&&d.platforms[0];
  if(!pf) return '';
  var st=pf.stats||{}, avg=pf.avg||{};
  var cells=[['讚',st.dg],['留言',st.cm],['分享',st.sh],['收藏',st.cl]];
  if(st.pl) cells.push(['播放',st.pl]);
  var statHtml=cells.map(function(x){
    return '<div class="pp-cell"><span>'+esc(x[0])+'</span><b>'+esc(nfmt(x[1]||0))+'</b></div>';
  }).join('');
  var avgBits=[['讚',avg.dg],['留言',avg.cm],['收藏',avg.cl]].map(function(x){
    return esc(x[0])+' '+esc(nfmt(x[1]||0));
  }).join(' · ');
  var top=(pf.top||[]).slice(0,3).map(function(w){
    return '<button type="button" class="pp-top" data-pn-top="'+esc(w.id)+'" title="'+esc(trim(w.caption,80)||w.id)+'">'+
      '<span class="ppt-dg">'+esc(nfmt(w.dg||0))+' 讚</span>'+
      '<span class="ppt-cap">'+esc(trim(w.caption,42)||w.id)+'</span>'+
    '</button>';
  }).join('');
  return '<div class="pn-plat">'+
    '<div class="pm-cap">平台<span class="pm-sub">'+esc(pf.label||'抖音')+'</span></div>'+
    (pf.profile?'<a class="pp-link" href="'+esc(pf.profile)+'" target="_blank" rel="noopener noreferrer">抖音主頁<span aria-hidden="true"> ↗</span></a>':'')+
    '<div class="pp-stats">'+statHtml+'</div>'+
    '<div class="pp-line">平均每件：'+avgBits+'</div>'+
    '<div class="pp-line">首發 '+esc(day(asUnix(pf.first)))+' · 最近 '+esc(day(asUnix(pf.last)))+'</div>'+
    (top?'<div class="pp-cap">互動最高</div><div class="pp-tops">'+top+'</div>':'')+
  '</div>';
}

function monthsHtml(){
  if(A.monthsLoading) return '<div class="pn-months"><div class="pm-cap">作品時間軸</div><div class="pm-empty">載入中…</div></div>';
  if(!A.months.length) return '';
  var top=0;
  A.months.forEach(function(x){ if(x.n>top) top=x.n; });
  var rows=A.months.map(function(x){
    var pct=top?Math.max(2,Math.round(x.n/top*100)):0;
    return '<div class="pm-row"><span class="pm-m">'+esc(x.m)+'</span>'+
      '<span class="pm-track"><i class="pm-bar" style="width:'+pct+'%"></i></span>'+
      '<span class="pm-n">'+esc(nfmt(x.n))+'</span></div>';
  }).join('');
  return '<div class="pn-months"><div class="pm-cap">作品時間軸<span class="pm-sub">'+esc(nfmt(A.months.length))+' 個月</span></div>'+
    '<div class="pm-rows">'+rows+'</div></div>';
}

/* ---------- 畫面 ---------- */
function renderKpis(){
  var box=$('pnKpis'); if(!box) return;
  var c=A.counts||{};
  var cells=[
    ['人物', nfmt(c.authors||A.total)],
    ['已命名', nfmt(c.named)],
    ['純數字帳號', nfmt(c.numeric)],
    ['未命名作品', nfmt(c.unnamedWorks)]
  ];
  box.innerHTML=cells.map(function(x){
    return '<div class="pn-kpi"><span>'+esc(x[0])+'</span><b>'+esc(x[1])+'</b></div>';
  }).join('');
  var cnt=$('pnCount');
  if(cnt) cnt.textContent=nfmt(A.total)+' 位';
  var bd=$('navPersonBd');
  if(bd&&c.authors) bd.textContent=(c.authors>=1000?(c.authors/1000).toFixed(1)+'k':String(c.authors));
}

function rowHtml(a){
  // 卡片寬度有限：容量留給側欄，清單只放件數／檔數，完整資訊掛 title
  var meta=nfmt(a.works||0)+' 件 · '+nfmt(a.files||0)+' 檔';
  var tip=displayAuthor(a.author)+' · '+meta+' · '+bytes(a.bytes)+' · 最後 '+day(a.lastCt);
  var on=A.sel===a.author?' on':'';
  return '<button type="button" class="pn-row'+on+'" data-author="'+esc(a.author)+'" title="'+esc(tip)+'" aria-pressed="'+(A.sel===a.author)+'">'+
    '<span class="pr-name">'+esc(displayAuthor(a.author))+'</span>'+
    '<span class="pr-meta">'+esc(meta)+'</span>'+
    '<span class="pr-day">'+esc(day(a.lastCt))+'</span>'+
    '<span class="pr-kind">'+esc((a.gallery||0)+'/'+(a.video||0))+'</span>'+
  '</button>';
}

function renderList(){
  var box=$('pnList'); if(!box) return;
  if(!A.items.length){
    box.innerHTML='<div class="pn-empty">'+(A.loaded?'沒有符合的人物':'尚未載入')+'</div>';
  } else {
    box.innerHTML=A.items.map(rowHtml).join('');
  }
  renderFoot();
}

function renderFoot(){
  var more=$('pnMore'), foot=$('pnFoot');
  var has=A.items.length<A.total;
  if(more){
    more.disabled=!has||A.loading;
    more.textContent=has?'載入更多（還有 '+nfmt(A.total-A.items.length)+' 位）':'沒有更多了';
  }
  if(foot) foot.textContent=A.items.length?('顯示 '+nfmt(A.items.length)+' / '+nfmt(A.total)+' 位人物'):'';
}

function workHtml(it){
  var cover=it.cover?mediaUrl(it.cover):'';
  return '<button type="button" class="pw-work" data-id="'+esc(it.id)+'" title="'+esc(trim(it.caption,80)||it.id)+'">'+
    '<span class="pw-shot">'+(cover?'<img src="'+esc(cover)+'" alt="" loading="lazy" decoding="async">':'<span class="pw-noimg">無縮圖</span>')+
      '<span class="pw-badge">'+esc(KIND_LABEL[it.kind]||it.kind)+'</span></span>'+
    '<span class="pw-meta">'+esc(day(it.ct))+' · '+esc(bytes(it.bytes))+'</span>'+
  '</button>';
}

function renderSide(){
  var box=$('pnSide'); if(!box) return;
  if(!A.sel){
    box.innerHTML='<div class="pn-empty"><b>還沒選人物。</b>點清單裡任一位，這裡會顯示他的作品時間軸、作品牆與容量。</div>';
    return;
  }
  var m=A.meta||{};
  var head='<div class="ph-head">'+
    '<div class="ph-kicker">人物</div>'+
    '<div class="ph-name">'+esc(displayAuthor(A.sel))+'</div>'+
    '<div class="ph-meta">'+
      '<span>'+esc(nfmt(m.works||A.worksTotal||0))+' 件</span>'+
      '<span>圖集 '+esc(nfmt(m.gallery||0))+'</span>'+
      '<span>影片 '+esc(nfmt(m.video||0))+'</span>'+
      '<span>'+esc(nfmt(m.files||0))+' 檔</span>'+
      '<span>'+esc(bytes(m.bytes||0))+'</span>'+
      '<span>最近 '+esc(day(m.lastCt))+'</span>'+
    '</div>'+
    '<div class="ph-actions">'+
      '<button type="button" class="mini-btn" data-pn-back="1">← 人物清單</button>'+
      '<button type="button" class="mini-btn primary" data-lib-all="1">在素材庫看全部</button>'+
    '</div>'+
  '</div>';
  var grid;
  if(!A.works.length){
    grid='<div class="pn-empty">'+(A.worksLoading?'載入作品…':'這位人物本機沒有檔案')+'</div>';
  } else {
    grid='<div class="pn-grid">'+A.works.map(workHtml).join('')+'</div>';
  }
  var more='';
  if(A.works.length<A.worksTotal){
    more='<div class="pn-more pn-more-side"><button type="button" class="mini-btn" data-work-more="1">'+(A.worksLoading?'載入中…':'更多作品（還有 '+nfmt(A.worksTotal-A.works.length)+' 件）')+'</button></div>';
  }
  box.innerHTML=head+platformHtml()+monthsHtml()+grid+more;
}

/* 兩個檢視：index＝人物清單（全寬卡片grid）、profile＝作者檔案（全寬作品牆）。
   只換 #topic-person 上的 data-pn-view，版面由 CSS 決定。 */
function applyView(){
  var box=$('topic-person');
  if(box&&box.setAttribute) box.setAttribute('data-pn-view',A.view);
}
function renderAll(){ renderKpis(); renderList(); renderSide(); applyView(); }

function renderError(){
  var box=$('pnList');
  if(box) box.innerHTML='<div class="pn-empty"><b>人物索引的後端沒開。</b>API 在 5210；跑 <code>node kolindex-api\\server.mjs</code>。<br>'+esc(A.error||'')+'</div>';
  renderFoot();
}

function selectAuthor(name){
  A.sel=String(name||'');
  A.meta=null;
  A.works=[]; A.worksTotal=0; A.worksOffset=0;
  A.months=[]; A.monthsLoading=true;
  A.plat=null; A.platLoading=true;
  A.view='profile';
  for(var i=0;i<A.items.length;i++){ if(A.items[i].author===A.sel){ A.meta=A.items[i]; break; } }
  renderAll();
  loadWorks(true);
  loadMonths();
  loadPlatform();
}

/* 回到人物清單：清單捲動位置保持不動（同一個 DOM，只是換顯示） */
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
  var list=$('pnList');
  on(list,'click',function(e){
    var row=e.target.closest('.pn-row');
    if(!row) return;
    var who=row.getAttribute('data-author');
    if(who===A.sel) return;
    selectAuthor(who);
  });

  var side=$('pnSide');
  on(side,'click',function(e){
    if(e.target.closest('[data-pn-back]')){ backToList(); return; }
    if(e.target.closest('[data-lib-all]')){ openInLibrary(); return; }
    if(e.target.closest('[data-work-more]')){ loadWorks(false); return; }
    var t=e.target.closest('.pp-top');
    if(t){ openWork(t.getAttribute('data-pn-top')); return; }
    var w=e.target.closest('.pw-work');
    if(w) openWork(w.getAttribute('data-id'));
  });

  var search=$('pnSearch');
  var doSearch=debounce(function(){
    A.q=String(search&&search.value||'').trim();
    load(true);
  },260);
  on(search,'input',doSearch);

  var sort=$('pnSort');
  on(sort,'click',function(e){
    var b=e.target.closest('button[data-sort]');
    if(!b) return;
    var s=b.getAttribute('data-sort');
    if(s===A.sort) return;
    A.sort=s;
    sort.querySelectorAll('button').forEach(function(x){ x.setAttribute('aria-pressed',String(x===b)); });
    load(true);
  });

  on($('pnReset'),'click',function(){
    A.q=''; A.sort='count';
    if(search) search.value='';
    var s=$('pnSort');
    if(s) s.querySelectorAll('button').forEach(function(x){ x.setAttribute('aria-pressed',String(x.getAttribute('data-sort')==='count')); });
    load(true);
  });

  on($('pnMore'),'click',function(){ load(false); });

  window.addEventListener('kolindex:api',function(e){
    var d=(e&&e.detail)||{};
    if(d.ok&&!A.loaded) load(true);
    else if(d.ok&&A.active&&Date.now()-A.at>POLL_MS) load(true);
  });

  if(typeof MutationObserver==='function'){
    var mo=new MutationObserver(function(){
      var now=document.body.getAttribute('data-topic')==='person';
      if(now===A.active) return;
      A.active=now;
      if(now&&(!A.loaded||Date.now()-A.at>POLL_MS)) load(true);
    });
    mo.observe(document.body,{attributes:true,attributeFilter:['data-topic']});
  }
  A.active=document.body.getAttribute('data-topic')==='person';
  if(A.active) load(true);
}

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',bind);
else bind();

window.KOLINDEX_PERSON={state:A,load:load,loadWorks:loadWorks,loadMonths:loadMonths,loadPlatform:loadPlatform,platformHtml:platformHtml,monthsHtml:monthsHtml,selectAuthor:selectAuthor,backToList:backToList,openInLibrary:openInLibrary,
  displayAuthor:displayAuthor,rowHtml:rowHtml,authorRows:function(){ return A.items; },esc:esc,bytes:bytes,day:day,nfmt:nfmt};
})();