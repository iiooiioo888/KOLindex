/* ============================================================
   library.js · 「素材庫」分頁
   抖音點讚／收藏抓下來的作品索引（30.7k 件），縮圖與影片由本機靜態站給。
   後端：GET /api/library?q=&kind=&source=&sort=&limit=&offset=
         GET /api/library/:id（含本機檔案清單與原始網址）
   這頁只讀，不寫任何東西。
   ============================================================ */
(function(){
'use strict';

var BASE=(typeof window!=='undefined'&&window.KOLINDEX_BASE)||'';
var MEDIA=(typeof window!=='undefined'&&window.KOLINDEX_MEDIA)||'http://127.0.0.1:5400';

var SRC_LABEL={likes:'讚',favorites:'藏',folder:'夾',unknown:'?'};
var KIND_LABEL={gallery:'圖集',video:'影片'};
var LIMIT=48, POLL_MS=120000;

var L={ok:false,loaded:false,loading:false,active:false,q:'',kind:'all',source:'all',sort:'recent',
  items:[],total:0,offset:0,counts:null,sources:null,error:'',at:0,tok:0,view:null,detail:null};

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
  return MEDIA.replace(/\/$/,'')+'/'+p;
}
function on(el,ev,fn){ if(el&&el.addEventListener) el.addEventListener(ev,fn); }

function setStatus(text,tone){
  var e=$('libStatus');
  if(!e) return;
  e.textContent=text;
  e.className='chip '+(tone||'or');
}

/* ---------- 取資料 ---------- */
function query(){
  var p=[];
  p.push('limit='+LIMIT);
  p.push('offset='+L.offset);
  if(L.q) p.push('q='+encodeURIComponent(L.q));
  if(L.kind!=='all') p.push('kind='+encodeURIComponent(L.kind));
  if(L.source!=='all') p.push('source='+encodeURIComponent(L.source));
  p.push('sort='+encodeURIComponent(L.sort));
  return '/api/library?'+p.join('&');
}

function req(path){
  return fetch(BASE+path,{headers:{'accept':'application/json'}}).then(function(r){
    return r.text().then(function(t){
      var j={};
      try { j=t?JSON.parse(t):{}; } catch(e){ j={raw:t}; }
      return {ok:r.ok,status:r.status,data:j};
    });
  });
}

function load(reset){
  if(L.loading){ L.queued=!!(reset||L.queued); return Promise.resolve(false); }
  if(reset){ L.offset=0; }
  var tok=++L.tok;
  L.loading=true;
  setStatus('載入中…','or');
  L.pending=req(query()).then(function(res){
    if(tok!==L.tok) return false;
    L.loading=false;
    if(!res.ok){
      L.ok=false; L.error=(res.data&&(res.data.error||res.data.message))||('HTTP '+res.status);
      setStatus('後端未連線','or');
      renderError();
      return false;
    }
    var d=res.data||{};
    L.ok=true; L.loaded=true; L.at=Date.now(); L.error='';
    L.counts=d.counts||null; L.sources=d.sources||null;
    L.total=Number(d.total)||0;
    L.items=reset? (d.items||[]) : L.items.concat(d.items||[]);
    L.offset=L.items.length;
    setStatus('API · LIVE','cyan');
    renderAll();
    return true;
  }).catch(function(err){
    if(tok!==L.tok) return false;
    L.loading=false; L.ok=false; L.error=String(err&&err.message||err);
    setStatus('後端未連線','or');
    renderError();
    return false;
  }).then(function(v){
    if(L.queued){ var again=L.queued; L.queued=false; load(again); }
    return v;
  });
  return L.pending;
}

/* ---------- 畫面 ---------- */
function renderKpis(){
  var box=$('libKpis');
  if(!box) return;
  var c=L.counts||{};
  var cells=[
    ['作品', nfmt(c.all)],
    ['圖集', nfmt(c.gallery)],
    ['影片', nfmt(c.video)],
    ['本機檔案', nfmt(c.files)],
    ['容量', bytes(c.bytes)],
    ['作者', nfmt(c.authors)]
  ];
  box.innerHTML=cells.map(function(x){
    return '<div class="lib-kpi"><span>'+esc(x[0])+'</span><b>'+esc(x[1])+'</b></div>';
  }).join('');
  var cnt=$('libCount');
  if(cnt) cnt.textContent=nfmt(L.total)+' / '+nfmt(c.all||0);
  var bd=$('navLibraryBd');
  if(bd&&c.all) bd.textContent=(c.all>=1000?(c.all/1000).toFixed(1)+'k':String(c.all));
}

function cardHtml(it){
  var cover=it.cover?mediaUrl(it.cover):'';
  var badges='<span class="lc-badge">'+esc(KIND_LABEL[it.kind]||it.kind)+'</span>';
  if(it.kind==='gallery') badges+='<span class="lc-shot-n">'+(it.images||0)+'</span>';
  var srcs=(it.sources||[]).map(function(s){ return SRC_LABEL[s]||s; }).join('·');
  var play=it.kind==='video'?'<span class="lc-play" aria-hidden="true">▶</span>':'';
  var img=cover
    ? '<img src="'+esc(cover)+'" alt="" loading="lazy" decoding="async" onerror="this.style.display=\'none\'">'
    : '<span class="lc-noimg">無縮圖</span>';
  return '<button type="button" class="lib-card" data-id="'+esc(it.id)+'" title="'+esc(trim(it.caption,80)||it.id)+'">'+
    '<span class="lc-shot">'+img+play+badges+(srcs?'<span class="lc-src">'+esc(srcs)+'</span>':'')+'</span>'+
    '<span class="lc-meta">'+
      '<b class="lc-title">'+esc(trim(it.caption,42)||'（無標題）')+'</b>'+
      '<span class="lc-sub">'+esc(it.author||'未命名')+' · '+esc(day(it.ct))+'</span>'+
      '<span class="lc-foot">'+esc(it.kind==='video'?'1 支 · ':(it.images||0)+' 張 · ')+esc(bytes(it.bytes))+
        (it.hasLocal?'':' · 未下載')+'</span>'+
    '</span>'+
  '</button>';
}

function renderGrid(){
  var box=$('libGrid');
  if(!box) return;
  if(!L.items.length){
    box.innerHTML='<div class="lib-empty">'+(L.loaded?'沒有符合的素材':'尚未載入')+'</div>';
    renderFoot();
    return;
  }
  var at=box.scrollTop;
  box.innerHTML=L.items.map(cardHtml).join('');
  box.scrollTop=at;
  renderFoot();
}

function renderFoot(){
  var more=$('libMore'), foot=$('libFoot');
  if(more){
    var has=L.items.length<L.total;
    more.disabled=!has||L.loading;
    more.textContent=has?'載入更多（還有 '+nfmt(L.total-L.items.length)+' 件）':'沒有更多了';
  }
  if(foot) foot.textContent=L.items.length?('顯示 '+nfmt(L.items.length)+' / '+nfmt(L.total)+' 件'):'';
}

function renderAll(){ renderKpis(); renderGrid(); renderFoot(); }

function renderError(){
  var box=$('libGrid');
  if(box) box.innerHTML='<div class="lib-empty">'+
    '<b>素材庫後端沒開。</b>API 在 5210，靜態站在 5400；跑 <code>node kolindex-api\\server.mjs</code> 與 '+
    '<code>node KOLindex-dev\\dev-server.mjs KOLindex-dev\\douyin 5400</code>。<br>'+esc(L.error||'')+'</div>';
  renderFoot();
}

/* ---------- 檢視器 ---------- */
function closeViewer(){
  var v=$('libViewer');
  if(!v||v.hidden) return;
  v.hidden=true;
  document.body.removeAttribute('data-lib-open');
  var m=$('libMedia');
  if(m) m.innerHTML='';
  var th=$('libThumbs');
  if(th) th.innerHTML='';
  L.view=null; L.detail=null;
}

function paintViewer(){
  var det=L.detail, v=L.view;
  if(!det||!v) return;
  var m=$('libMedia');
  var files=det.files||[];
  if(det.kind==='video'&&files.length){
    m.innerHTML='<video controls autoplay playsinline src="'+esc(mediaUrl(files[0]))+'"></video>';
  } else if(files.length){
    m.innerHTML='<img src="'+esc(mediaUrl(files[v.idx]))+'" alt="">';
  } else {
    var r=(det.remote||[])[0];
    m.innerHTML=r
      ? '<div class="lv-none"><b>本機沒有這件的檔案。</b>原始網址可能已經過期：<br><a href="'+esc(det.url)+'" target="_blank" rel="noopener">'+esc(det.url)+'</a></div>'
      : '<div class="lv-none"><b>本機沒有這件的檔案。</b><br><a href="'+esc(det.url)+'" target="_blank" rel="noopener">'+esc(det.url)+'</a></div>';
  }
  var head=$('libViewHead');
  if(head){
    head.innerHTML='<div class="lv-kicker">'+esc(KIND_LABEL[det.kind]||det.kind)+' · '+
      esc((det.sources||[]).map(function(s){return SRC_LABEL[s]||s;}).join('·'))+' · '+esc(day(det.ct))+'</div>'+
      '<div class="lv-title">'+esc(trim(det.caption,120)||'（無標題）')+'</div>'+
      '<div class="lv-sub">'+esc(det.author||'未命名')+' · <code>'+esc(det.id)+'</code></div>';
  }
  var body=$('libViewBody');
  if(body){
    var rows=[
      ['本機檔案', det.fileCount?nfmt(det.fileCount)+' 個':'-'],
      ['容量', bytes(det.bytes)],
      ['發佈', day(det.ct)],
      ['目錄', det.dir||'-']
    ];
    body.innerHTML=rows.map(function(r){
      return '<div class="lv-row"><span>'+esc(r[0])+'</span><b>'+esc(r[1])+'</b></div>';
    }).join('')+
    '<div class="lv-actions">'+
      '<a class="mini-btn" href="'+esc(det.url)+'" target="_blank" rel="noopener">原始網址</a>'+
      '<button type="button" class="mini-btn" id="libCopyPath">複製目錄</button>'+
    '</div>';
    on($('libCopyPath'),'click',function(){ copyPath(det); });
  }
  var th=$('libThumbs');
  if(th){
    th.innerHTML=files.slice(0,40).map(function(f,i){
      return '<button type="button" class="lv-th'+(i===v.idx?' on':'')+'" data-idx="'+i+'">'+
        '<img src="'+esc(mediaUrl(f))+'" alt="" loading="lazy"></button>';
    }).join('');
    th.hidden=files.length<2;
  }
  var counter=$('libCounter');
  if(counter) counter.textContent=files.length?(Math.min(v.idx+1,files.length)+' / '+files.length):'';
}

function copyPath(det){
  var txt=(det.dir||det.id).replace(/\//g,'\\');
  var done=function(){
    if(window.KOLINDEX_UI&&window.KOLINDEX_UI.toast) window.KOLINDEX_UI.toast('已複製目錄');
  };
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(txt).then(done,function(){ /* 沒有剪貼簿權限就算了 */ });
  }
}

function openViewer(id){
  var v=$('libViewer');
  if(!v) return;
  L.view={id:id,idx:0};
  L.detail=null;
  v.hidden=false;
  document.body.setAttribute('data-lib-open','1');
  var head=$('libViewHead');
  if(head) head.innerHTML='<div class="lv-title">載入中…</div>';
  var body=$('libViewBody'); if(body) body.innerHTML='';
  var med=$('libMedia'); if(med) med.innerHTML='';
  var th=$('libThumbs'); if(th) th.innerHTML='';
  req('/api/library/'+encodeURIComponent(id)).then(function(res){
    if(!L.view||L.view.id!==id) return;
    if(!res.ok||!res.data||res.data.error){
      if(head) head.innerHTML='<div class="lv-title">讀不到這件</div>';
      return;
    }
    L.detail=res.data;
    paintViewer();
  }).catch(function(err){
    if(head) head.innerHTML='<div class="lv-title">讀不到這件：'+esc(String(err&&err.message||err))+'</div>';
  });
}

function step(delta){
  var det=L.detail, v=L.view;
  if(!det||!v) return;
  var n=(det.files||[]).length;
  if(n<2) return;
  v.idx=(v.idx+delta+n)%n;
  paintViewer();
}

/* ---------- 事件 ---------- */
function debounce(fn,ms){
  var t=null;
  return function(){
    var args=arguments, self=this;
    clearTimeout(t);
    t=setTimeout(function(){ fn.apply(self,args); },ms);
  };
}

function bind(){
  var grid=$('libGrid');
  on(grid,'click',function(e){
    var card=e.target.closest('.lib-card');
    if(card) openViewer(card.getAttribute('data-id'));
  });

  var more=$('libMore');
  on(more,'click',function(){ load(false); });

  var search=$('libSearch');
  var doSearch=debounce(function(){
    L.q=String(search&&search.value||'').trim();
    load(true);
  },260);
  on(search,'input',doSearch);

  var kind=$('libKind');
  on(kind,'click',function(e){
    var b=e.target.closest('button[data-kind]');
    if(!b) return;
    L.kind=b.getAttribute('data-kind');
    kind.querySelectorAll('button').forEach(function(x){ x.setAttribute('aria-pressed',String(x===b)); });
    load(true);
  });

  var src=$('libSource');
  on(src,'click',function(e){
    var b=e.target.closest('button[data-source]');
    if(!b) return;
    L.source=b.getAttribute('data-source');
    src.querySelectorAll('button').forEach(function(x){ x.setAttribute('aria-pressed',String(x===b)); });
    load(true);
  });

  var sort=$('libSort');
  on(sort,'change',function(){ L.sort=sort.value||'recent'; load(true); });

  var reset=$('libReset');
  on(reset,'click',function(){
    L.q=''; L.kind='all'; L.source='all'; L.sort='recent';
    if(search) search.value='';
    if(sort) sort.value='recent';
    var k=$('libKind'), s=$('libSource');
    if(k) k.querySelectorAll('button').forEach(function(x){ x.setAttribute('aria-pressed',String(x.getAttribute('data-kind')==='all')); });
    if(s) s.querySelectorAll('button').forEach(function(x){ x.setAttribute('aria-pressed',String(x.getAttribute('data-source')==='all')); });
    load(true);
  });

  on($('libClose'),'click',closeViewer);
  on($('libPrev'),'click',function(){ step(-1); });
  on($('libNext'),'click',function(){ step(1); });
  on($('libThumbs'),'click',function(e){
    var b=e.target.closest('.lv-th');
    if(!b||!L.view) return;
    L.view.idx=Number(b.getAttribute('data-idx'))||0;
    paintViewer();
  });
  on($('libViewer'),'click',function(e){
    if(e.target===$('libViewer')) closeViewer();
  });

  document.addEventListener('keydown',function(e){
    var v=$('libViewer');
    if(!v||v.hidden) return;
    if(e.key==='Escape'){ e.preventDefault(); closeViewer(); return; }
    if(e.key==='ArrowLeft'){ e.preventDefault(); step(-1); return; }
    if(e.key==='ArrowRight'){ e.preventDefault(); step(1); }
  });

  window.addEventListener('kolindex:api',function(e){
    var d=(e&&e.detail)||{};
    if(d.ok&&!L.loaded) load(true);
    else if(d.ok&&L.active&&Date.now()-L.at>POLL_MS) load(true);
  });

  if(typeof MutationObserver==='function'){
    var mo=new MutationObserver(function(){
      var t=document.body.getAttribute('data-topic');
      var now=t==='library';
      if(now===L.active) return;
      L.active=now;
      if(now&&(!L.loaded||Date.now()-L.at>POLL_MS)) load(true);
    });
    mo.observe(document.body,{attributes:true,attributeFilter:['data-topic']});
  }
  L.active=document.body.getAttribute('data-topic')==='library';
  if(L.active) load(true);
}

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',bind);
else bind();

window.KOLINDEX_LIBRARY={state:L,load:load,openViewer:openViewer,closeViewer:closeViewer,mediaUrl:mediaUrl,esc:esc,bytes:bytes,day:day,trim:trim};
})();
