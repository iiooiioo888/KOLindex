/* ============================================================
   library.js · 「素材庫」分頁
   抖音點讚／收藏抓下來的作品索引（30.7k 件），縮圖與影片由本機靜態站給。
   後端：GET /api/library?q=&kind=&source=&sort=&limit=&offset=&author=
         GET /api/library/authors?q=&sort=&limit=&offset=（作者索引）
         GET /api/library/:id（含本機檔案清單與原始網址）
   這頁只讀，不寫任何東西。
   ============================================================ */
(function(){
'use strict';

var BASE=(typeof window!=='undefined'&&window.KOLINDEX_BASE)||'';
var MEDIA=(typeof window!=='undefined'&&window.KOLINDEX_MEDIA)||'http://127.0.0.1:5400';

var SRC_LABEL={likes:'讚',favorites:'藏',folder:'夾',unknown:'?'};
var KIND_LABEL={gallery:'圖集',video:'影片'};
var LIMIT=48, ALIMIT=120, POLL_MS=120000;

var L={ok:false,loaded:false,loading:false,active:false,q:'',kind:'all',source:'all',sort:'recent',
  items:[],total:0,offset:0,counts:null,sources:null,error:'',at:0,tok:0,view:null,detail:null,
  mode:'items',author:'',authors:[],authorTotal:0,aOffset:0,asort:'count',atok:0,authorLoading:false,
  aCounts:null};

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
  if(L.author) p.push('author='+encodeURIComponent(L.author));
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

function displayAuthor(a){
  if(!a) return '未命名';
  return a==='unnamed'?'未命名':a;
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

/* ---------- 作者索引 ---------- */
function loadAuthors(reset){
  if(L.authorLoading){ L.aQueued=!!(reset||L.aQueued); return Promise.resolve(false); }
  if(reset){ L.aOffset=0; }
  var tok=++L.atok;
  L.authorLoading=true;
  setStatus('載入作者…','or');
  var path='/api/library/authors?sort='+encodeURIComponent(L.asort)+'&limit='+ALIMIT+'&offset='+L.aOffset;
  if(L.q) path+='&q='+encodeURIComponent(L.q);
  L.aPending=req(path).then(function(res){
    if(tok!==L.atok) return false;
    L.authorLoading=false;
    if(!res.ok){
      L.ok=false; L.error=(res.data&&(res.data.error||res.data.message))||('HTTP '+res.status);
      setStatus('後端未連線','or');
      renderError();
      return false;
    }
    var d=res.data||{};
    L.ok=true; L.loaded=true; L.at=Date.now(); L.error='';
    L.aCounts=d.counts||null;
    L.authorTotal=Number(d.total)||0;
    L.authors=reset?(d.items||[]):L.authors.concat(d.items||[]);
    L.aOffset=L.authors.length;
    setStatus('API · LIVE','cyan');
    renderAuthors();
    return true;
  }).catch(function(err){
    if(tok!==L.atok) return false;
    L.authorLoading=false; L.ok=false; L.error=String(err&&err.message||err);
    setStatus('後端未連線','or');
    renderError();
    return false;
  }).then(function(v){
    if(L.aQueued){ var again=L.aQueued; L.aQueued=false; loadAuthors(again); }
    return v;
  });
  return L.aPending;
}

function authorRowHtml(a){
  var meta=[];
  if(a.works) meta.push(nfmt(a.works)+' 件');
  if(a.gallery) meta.push('圖集 '+nfmt(a.gallery));
  if(a.video) meta.push('影片 '+nfmt(a.video));
  if(a.localItems!=null&&a.localItems<a.works) meta.push('本機 '+nfmt(a.localItems));
  return '<button type="button" class="lib-author" data-author="'+esc(a.author)+'" title="只看這位作者的素材">'+
    '<span class="la-name">'+esc(displayAuthor(a.author))+'</span>'+
    '<span class="la-meta">'+esc(meta.join(' · '))+'</span>'+
    '<span class="la-right"><b>'+esc(nfmt(a.files)+' 檔 · '+bytes(a.bytes))+'</b>'+
      '<span>'+esc(day(a.lastCt))+'</span></span>'+
  '</button>';
}

function renderAuthors(){
  var box=$('libGrid');
  if(!box) return;
  box.classList.add('is-authors');
  if(!L.authors.length){
    box.innerHTML='<div class="lib-empty">'+(L.loaded?'沒有符合的作者':'尚未載入')+'</div>';
  } else {
    box.innerHTML=L.authors.map(authorRowHtml).join('');
  }
  var cnt=$('libCount');
  if(cnt) cnt.textContent=nfmt(L.authorTotal)+' 位作者';
  renderFoot();
}

function setMode(m){
  L.mode=(m==='authors')?'authors':'items';
  var authors=L.mode==='authors';
  var seg=$('libMode');
  if(seg) seg.querySelectorAll('button').forEach(function(x){ x.setAttribute('aria-pressed',String(x.getAttribute('data-mode')===L.mode)); });
  [$('libKind'),$('libSource'),$('libSort')].forEach(function(el){ if(el) el.hidden=authors; });
  var as=$('libASort'); if(as) as.hidden=!authors;
  var box=$('libGrid'); if(box&&authors) box.classList.add('is-authors');
  var foot=$('libFoot');
  if(authors){ if(foot) foot.textContent=''; loadAuthors(true); }
  else { if(box) box.classList.remove('is-authors'); load(true); }
  return L.mode;
}

function updateChip(){
  var chip=$('libAuthorChip'), nm=$('libAuthorName');
  if(chip) chip.hidden=!L.author;
  if(nm) nm.textContent=L.author?displayAuthor(L.author):'—';
}

function setAuthor(name){
  L.author=String(name||'');
  updateChip();
  setMode('items');
}

function clearAuthor(){
  if(!L.author) return;
  L.author='';
  updateChip();
  if(L.mode==='items') load(true); else loadAuthors(true);
}

function reload(reset){
  return L.mode==='authors'? loadAuthors(!!reset) : load(!!reset);
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
    ? '<img src="'+esc(cover)+'" alt="" loading="lazy" decoding="async" onerror="this.parentNode.classList.add(\'no-img\');this.remove()">'
    : '<span class="lc-noimg">無縮圖</span>';
  return '<button type="button" class="lib-card" data-id="'+esc(it.id)+'" title="'+esc(trim(it.caption,80)||it.id)+'">'+
    '<span class="lc-shot">'+img+play+badges+(srcs?'<span class="lc-src">'+esc(srcs)+'</span>':'')+'</span>'+
    '<span class="lc-meta">'+
      '<b class="lc-title">'+esc(trim(it.caption,42)||'（無標題）')+'</b>'+
      '<span class="lc-sub">'+esc(displayAuthor(it.author))+' · '+esc(day(it.ct))+'</span>'+
      '<span class="lc-foot">'+esc(it.kind==='video'?'1 支 · ':(it.images||0)+' 張 · ')+esc(bytes(it.bytes))+
        (it.hasLocal?'':' · 未下載')+'</span>'+
    '</span>'+
  '</button>';
}

function skelHtml(){
  var one='<div class="lib-card is-skel" aria-hidden="true">'+
    '<span class="lc-shot"></span>'+
    '<span class="lc-meta"><span class="sk-line sk-a"></span><span class="sk-line sk-b"></span></span>'+
  '</div>';
  var out='';
  for(var i=0;i<8;i++) out+=one;
  return out;
}

function renderGrid(){
  var box=$('libGrid');
  if(!box) return;
  box.classList.remove('is-authors');
  if(!L.items.length){
    if(L.loading&&!L.loaded){
      box.innerHTML=skelHtml();
    } else {
      box.innerHTML='<div class="lib-empty">'+(L.loaded?'沒有符合的素材':'尚未載入')+'</div>';
    }
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
  var authors=L.mode==='authors';
  var n=authors?L.authors.length:L.items.length;
  var total=authors?L.authorTotal:L.total;
  var busy=authors?L.authorLoading:L.loading;
  var unit=authors?'位':'件';
  if(more){
    var has=n<total;
    more.disabled=!has||busy;
    more.textContent=has?'載入更多（還有 '+nfmt(total-n)+' '+unit+'）':'沒有更多了';
  }
  if(foot) foot.textContent=n?('顯示 '+nfmt(n)+' / '+nfmt(total)+' '+unit+(authors?'作者':'')+' · '+(authors?'點一位看他名下的作品':'點縮圖開檢視器')):'';
}

function renderAll(){ renderKpis(); renderGrid(); renderFoot(); updateDownloadUi(); updateOptUi(); updateDerivUi(); }

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
    m.innerHTML='<div class="lv-none"><b>本機沒有這件的檔案</b>'+
      (r?'只有索引，存的網址可能已經過期。':'只有索引，抖音上的網址要即時重取。')+
      '<div class="lv-none-act"><button type="button" class="mini-btn primary" data-lv-dl>下載到本機</button></div>'+
      '<div style="margin-top:10px"><a href="'+esc(det.url)+'" target="_blank" rel="noopener">'+esc(det.url)+'</a></div></div>';
  }
  var head=$('libViewHead');
  if(head){
    head.innerHTML='<div class="lv-kicker">'+esc(KIND_LABEL[det.kind]||det.kind)+' · '+
      esc((det.sources||[]).map(function(s){return SRC_LABEL[s]||s;}).join('·'))+' · '+esc(day(det.ct))+'</div>'+
      '<div class="lv-title">'+esc(trim(det.caption,120)||'（無標題）')+'</div>'+
      '<div class="lv-sub">'+esc(displayAuthor(det.author))+' · <code>'+esc(det.id)+'</code></div>';
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
      '<button type="button" class="mini-btn primary" id="libDownload">'+(det.fileCount?'重新下載':'下載到本機')+'</button>'+
      '<a class="mini-btn" href="'+esc(det.url)+'" target="_blank" rel="noopener">原始網址</a>'+
      '<button type="button" class="mini-btn" id="libViewAuthor">這位作者</button>'+
      '<button type="button" class="mini-btn" id="libCopyPath">複製目錄</button>'+
    '</div>';
    on($('libDownload'),'click',downloadItem);
    on($('libCopyPath'),'click',function(){ copyPath(det); });
    on($('libViewAuthor'),'click',function(){
      var who=det.author;
      closeViewer();
      if(who) setAuthor(who);
    });
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
  updateDownloadUi();
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

/* ---------- 下載：單件與批次（伺服器端抓，帶磁碟守衛） ---------- */
var D={job:null,poll:0,busy:false,freeGb:null,minGb:null,missing:null};

function jobRunning(){
  return !!(D.job&&D.job.state==='running');
}

function missingNum(){
  var c=L.counts;
  if(!c||c.all==null||c.localItems==null) return null;
  return Math.max(0,Number(c.all)-Number(c.localItems));
}

function updateDownloadUi(){
  var one=$('libDownload');
  if(one){
    var det=L.detail;
    one.disabled=!!D.busy||!det;
    one.textContent=det&&det.fileCount?'重新下載':'下載到本機';
    if(D.busy) one.textContent='下載中…';
  }
  var all=$('libDownloadMissing');
  if(all){
    var m=missingNum();
    var low=D.freeGb!=null&&D.minGb!=null&&D.freeGb<D.minGb;
    if(jobRunning()){
      all.disabled=true;
      all.textContent='下載中 '+(D.job.done||0)+'/'+(D.job.total||'…');
      all.title='';
    } else if(low){
      all.disabled=true;
      all.textContent='下載缺檔 · 空間不足';
      all.title='磁碟剩 '+D.freeGb+' GB，至少要 '+D.minGb+' GB。清出空間，或把 KOL_MEDIA_ROOT 指到別顆碟再重啟 API。';
    } else {
      all.disabled=!!D.busy;
      all.textContent=m==null?'下載缺檔':('下載缺檔 '+(m>9999?nfmt(m):m));
      all.title='把只有索引、還沒有本機檔案的抓下來'+(m==null?'':'（'+m+' 件）');
    }
  }
}

function dlErrText(res){
  var d=res&&res.data||{};
  var err=d.error||('HTTP '+(res?res.status:'?'));
  if(err==='disk_low') return '磁碟空間不足：剩 '+(d.freeGb==null?'?':d.freeGb)+' GB，至少要 '+(d.minGb||2)+' GB';
  if(err==='busy') return '有一批下載正在跑，稍後再試';
  if(err==='no_images'||err==='urls_expired') return '遠端網址失效又拿不到新的（MyLike 的抖音頁要開著）';
  if(err==='not_found') return '後端找不到這件';
  return err;
}

function downloadItem(){
  var det=L.detail;
  if(!det||D.busy) return;
  D.busy=true;
  updateDownloadUi();
  post('/api/library/'+encodeURIComponent(det.id)+'/download',{force:!!det.fileCount}).then(function(res){
    D.busy=false;
    var d=res&&res.data||{};
    if(res.ok&&d.ok){
      toast(d.skipped?'本機已經有檔案':('已下載 '+d.files+' 個檔案 · '+bytes(d.bytes)));
      var it=(L.items||[]).filter(function(x){ return x.id===det.id; })[0];
      if(it){
        it.fileCount=d.files; it.bytes=d.bytes; it.dir=d.dir;
        it.hasLocal=true; if(d.cover) it.cover=d.cover;
      }
      renderGrid();
      return req('/api/library/'+encodeURIComponent(det.id)).then(function(r2){
        if(r2.ok&&r2.data&&!r2.data.error){ L.detail=r2.data; if(L.view) L.view.idx=0; paintViewer(); }
      });
    }
    toast('下載失敗：'+dlErrText(res));
    updateDownloadUi();
    return false;
  }).catch(function(e){
    D.busy=false;
    toast('下載失敗：'+String(e&&e.message||e));
    updateDownloadUi();
  });
}

function dlTick(){
  req('/api/library/download/job').then(function(res){
    var d=res.ok&&res.data?res.data:{};
    if(d.job) D.job=d.job;
    if(d.freeGb!=null) D.freeGb=d.freeGb;
    if(d.minGb!=null) D.minGb=d.minGb;
    if(d.missing!=null&&L.counts) L.counts.missing=d.missing;
    updateDownloadUi();
    if(D.job&&D.job.state==='running'){
      D.poll=setTimeout(dlTick,1500);
      return;
    }
    D.poll=0;
    D.busy=false;
    var j=D.job||{};
    var line='下載完成：'+(j.done||0)+' 件'+(j.failed?('，失敗 '+j.failed+' 件'):'')+(j.bytes?(' · '+bytes(j.bytes)):'');
    if(j.state==='error') toast('下載中斷：'+(j.error||'未知錯誤'));
    else if(j.reason==='disk_low') toast('磁碟不足，已停在 '+(j.done||0)+' 件（剩 '+(j.freeGb==null?'?':j.freeGb)+' GB，來源已清掉或改 KOL_MEDIA_ROOT 再試）');
    else if(j.reason==='cancelled') toast('已停止下載，完成 '+(j.done||0)+' 件');
    else toast(line);
    reload(true);
  }).catch(function(){
    D.poll=0;
    D.busy=false;
    updateDownloadUi();
  });
}

function downloadMissing(){
  if(D.busy||jobRunning()) return;
  if(D.freeGb!=null&&D.minGb!=null&&D.freeGb<D.minGb){
    toast('磁碟剩 '+D.freeGb+' GB，至少要 '+D.minGb+' GB；先清空間或改 KOL_MEDIA_ROOT');
    return;
  }
  D.busy=true;
  updateDownloadUi();
  post('/api/library/download',{limit:20}).then(function(res){
    if(!res.ok||!res.data||res.data.error){
      D.busy=false;
      toast('無法開始下載：'+dlErrText(res));
      updateDownloadUi();
      return;
    }
    D.job=res.data.job||null;
    D.busy=false;
    updateDownloadUi();
    dlTick();
  }).catch(function(e){
    D.busy=false;
    toast('無法開始下載：'+String(e&&e.message||e));
    updateDownloadUi();
  });
}

function syncDownload(){
  req('/api/library/download/job').then(function(res){
    var d=res.ok&&res.data?res.data:{};
    D.job=d.job||D.job;
    if(d.freeGb!=null) D.freeGb=d.freeGb;
    if(d.minGb!=null) D.minGb=d.minGb;
    if(d.missing!=null) D.missing=d.missing;
    updateDownloadUi();
    if(jobRunning()&&!D.poll) dlTick();
  }).catch(function(){ /* 後端沒開時安靜 */ });
}

/* ---------- 圖片無損壓縮：只剝中介資料，像素不動 ---------- */
var O={job:null,stats:null,poll:0};

function optRunning(){
  var j=O.job;
  return !!(j&&j.state==='running');
}

function mb(n){
  n=Number(n)||0;
  if(n<1024) return n+' B';
  if(n<1048576) return (n/1024).toFixed(1)+' KB';
  return (n/1048576).toFixed(1)+' MB';
}

function updateOptUi(){
  var b=$('libOptimize');
  if(!b) return;
  if(optRunning()){
    var j=O.job;
    b.disabled=true;
    b.textContent='壓縮 '+(j.done||0)+'/'+(j.total||'…');
    b.title='正在剝中介資料：'+(j.current||'')+'（像素不變，無損）';
    return;
  }
  b.disabled=false;
  b.textContent='無損壓縮';
  var st=O.stats&&O.stats.saved?O.stats.saved:0;
  b.title='剝掉 ICC／EXIF／XMP 等中介資料，像素完全不變'+(st?'（累計省 '+mb(st)+'，'+nfmt(O.stats.files)+' 張）':'');
}

function optTick(){
  req('/api/library/optimize/job').then(function(res){
    var d=res.ok&&res.data?res.data:{};
    if(d.job) O.job=d.job;
    if(d.stats) O.stats=d.stats;
    updateOptUi();
    if(optRunning()){ O.poll=setTimeout(optTick,1200); return; }
    O.poll=0;
    var j=O.job||{};
    if(j.state==='error') toast('壓縮中斷：'+(j.error||'未知錯誤'));
    else if(j.saved>0) toast('無損壓縮完成：掃 '+nfmt(j.scanned)+' 張，省下 '+mb(j.saved)+(j.failed?'，失敗 '+j.failed+' 張':''));
    else toast('沒有可省的中介資料（掃 '+nfmt(j.scanned||0)+' 張）');
    if(j.saved>0) reload(true);
  }).catch(function(){
    O.poll=0;
    updateOptUi();
  });
}

function optimizeImages(){
  if(optRunning()) return;
  var b=$('libOptimize');
  if(b){ b.disabled=true; b.textContent='啟動中…'; }
  post('/api/library/optimize',{limit:500}).then(function(res){
    var d=res&&res.data||{};
    if(!res.ok||d.error){
      updateOptUi();
      toast('無法開始壓縮：'+(d.error==='busy'?'已有一批在跑':'HTTP '+(res?res.status:'?')));
      return;
    }
    O.job=d.job||null;
    updateOptUi();
    optTick();
  }).catch(function(e){
    updateOptUi();
    toast('無法開始壓縮：'+String(e&&e.message||e));
  });
}

function syncOptimize(){
  req('/api/library/optimize/job').then(function(res){
    var d=res.ok&&res.data?res.data:{};
    if(d.job) O.job=d.job;
    if(d.stats) O.stats=d.stats;
    updateOptUi();
    if(optRunning()&&!O.poll) optTick();
  }).catch(function(){ /* 後端沒開時安靜 */ });
}


/* ---------- 圖片衍生層：只產生 q50 副本，原檔不動（證據與去重鍵不變） ---------- */
var DV={state:null,running:false,stats:null,poll:0};

function derivRunning(){
  var s=DV.state;
  return !!(DV.running||(s&&s.state==='running'));
}

function updateDerivUi(){
  var b=$('libDeriv');
  if(!b) return;
  if(derivRunning()){
    var s=DV.state||{};
    b.disabled=true;
    b.textContent='產生衍生層 '+(s.done||0)+'/'+(s.items||'…');
    b.title='libwebp 產生衍生檔中（品質 '+(s.quality||50)+'）'+(s.etaMin?'，約剩 '+s.etaMin+' 分鐘':'');
    return;
  }
  b.disabled=false;
  b.textContent='產生衍生層';
  var st=DV.stats&&DV.stats.saved?DV.stats.saved:0;
  var s2=DV.state||{};
  var head=s2.state==='interrupted'?('上次中斷在 '+nfmt(s2.done||0)+'/'+nfmt(s2.items||0)+' 件，按一下續跑；'):'';
  b.title=head+'用 libwebp 產生 q50 副本（原檔保留，不會覆蓋證據；容量不會因此變小）'
    +(st?'（累計省 '+mb(st)+'，'+nfmt(DV.stats.items)+' 件）':'');
}

function derivTick(){
  req('/api/library/derivative').then(function(res){
    var d=res.ok&&res.data?res.data:{};
    DV.state=d.state||null;
    DV.running=!!d.running;
    if(d.stats) DV.stats=d.stats;
    updateDerivUi();
    if(derivRunning()){ if(!L.active){ DV.poll=0; return; } DV.poll=setTimeout(derivTick,2000); return; }
    DV.poll=0;
    var s=DV.state||{};
    if(s.state==='error') toast('衍生層中斷：'+(s.error||'未知錯誤'));
    else if(s.state==='stopped'&&s.stopReason==='low_disk') toast('衍生層暫停：磁碟剩餘空間不足（原檔都還在）');
    else if(s.state==='done'&&s.savedBytes>0) toast('衍生層完成：'+nfmt(s.done||0)+' 件，可省 '+mb(s.savedBytes)+'（原檔保留）');
    else if(s.state==='done') toast('衍生層完成，沒有可省的檔案');
    if(s.savedBytes>0) reload(true);
  }).catch(function(){
    DV.poll=0;
    updateDerivUi();
  });
}

function derivativeImages(){
  if(derivRunning()) return;
  var b=$('libDeriv');
  if(b){ b.disabled=true; b.textContent='啟動中…'; }
  post('/api/library/derivative',{quality:50,method:4}).then(function(res){
    var d=res&&res.data||{};
    if(!res.ok||d.error){
      updateDerivUi();
      toast('無法開始衍生層：'+(d.error==='busy'?'已有一批在跑':'HTTP '+(res?res.status:'?')));
      return;
    }
    derivTick();
  }).catch(function(e){
    updateDerivUi();
    toast('無法開始衍生層：'+String(e&&e.message||e));
  });
}

function syncDeriv(){
  req('/api/library/derivative').then(function(res){
    var d=res.ok&&res.data?res.data:{};
    DV.state=d.state||null;
    DV.running=!!d.running;
    if(d.stats) DV.stats=d.stats;
    updateDerivUi();
    if(derivRunning()&&L.active&&!DV.poll) derivTick();
  }).catch(function(){ /* 後端沒開時安靜 */ });
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

/* ---------- MyLike 同步面板 ---------- */
var M={open:false,loading:false,data:null,job:null,polling:0,busy:false};

function toast(msg){ if(window.KOLINDEX_UI&&window.KOLINDEX_UI.toast) window.KOLINDEX_UI.toast(msg); }

function post(path,body){
  return fetch(BASE+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body||{})}).then(function(r){
    return r.text().then(function(t){
      var j={};
      try { j=t?JSON.parse(t):{}; } catch(e){ j={raw:t}; }
      return {ok:r.ok,status:r.status,data:j};
    });
  });
}

function ago(ts){
  if(!ts) return '—';
  var t=Date.parse(String(ts).replace(' ','T')+(/Z$/.test(String(ts))?'':'Z'));
  if(!t) return '—';
  var s=Math.max(0,Math.round((Date.now()-t)/1000));
  if(s<60) return '剛剛';
  if(s<3600) return Math.round(s/60)+'m';
  if(s<86400) return Math.round(s/3600)+'h';
  return Math.round(s/86400)+'d';
}

function mlCards(d){
  var box=$('mlCards');
  if(!box) return;
  if(!d){ box.innerHTML='<div class="ml-card"><span class="mc-k">狀態</span><b>讀取中…</b></div>'; return; }
  var db=d.db||{}, disk=d.disk||{};
  var cdpOk=!!(d.cdp&&d.cdp.ok), pageOk=!!(d.page&&d.page.ok);
  var h='';
  h+='<div class="ml-card"><span class="mc-k">CDP</span><b class="'+(cdpOk?'ok':'bad')+'">'+(cdpOk?'已連線':'未連線')+'</b>'+
     '<span class="mc-v">'+esc(cdpOk?(d.cdp.browser||'—'):((d.cdp&&d.cdp.error)||'—'))+'</span></div>';
  h+='<div class="ml-card"><span class="mc-k">抖音頁</span><b class="'+(pageOk?'ok':'bad')+'">'+(pageOk?'就緒':'已關閉')+'</b>'+
     '<span class="mc-v">'+esc(pageOk?(d.page.title||''):((d.page&&d.page.error)||'需要喚醒'))+'</span></div>';
  h+='<div class="ml-card"><span class="mc-k">帳號</span><b>'+esc((d.account&&d.account.name)||'—')+'</b>'+
     '<span class="mc-v">'+esc(String((d.account&&d.account.id)||'').slice(0,8))+'</span></div>';
  h+='<div class="ml-card"><span class="mc-k">索引</span><b>'+nfmt(db.items)+' 件</b>'+
     '<span class="mc-v">本機 '+nfmt(db.localItems)+' · '+bytes(db.bytes)+'</span></div>';
  h+='<div class="ml-card"><span class="mc-k">磁碟</span><b class="'+(disk.ok&&disk.freeGb<20?'bad':'ok')+'">'+(disk.ok?disk.freeGb+' GB':'—')+'</b>'+
     '<span class="mc-v">'+esc((disk.drive||'')+' 可用')+'</span></div>';
  h+='<div class="ml-card"><span class="mc-k">收藏夾</span><b>'+nfmt((d.folders||[]).length)+' 個</b>'+
     '<span class="mc-v">已標記 '+nfmt(db.folderTagged)+' 件</span></div>';
  box.innerHTML=h;
}

function mlConn(d){
  var c=$('mlConn'), dot=$('libMyLikeDot');
  var pageOk=!!(d&&d.page&&d.page.ok), cdpOk=!!(d&&d.cdp&&d.cdp.ok);
  if(c){
    c.textContent=cdpOk?(pageOk?'已連線':'待喚醒'):'未連線';
    c.className='chip '+(cdpOk&&pageOk?'cyan':'or');
  }
  if(dot){
    dot.className='ml-dot'+(pageOk?' on':'')+((M.job&&M.job.state==='running')?' run':'');
    dot.textContent='';
  }
}

function mlFolders(d){
  var box=$('mlFolders');
  if(!box) return;
  var fs=(d&&d.folders)||[];
  var c=$('mlFolderCount');
  if(c) c.textContent=fs.length?('· '+fs.length+' 個 · 共 '+nfmt(fs.reduce(function(a,b){ return a+(b.total||0); },0))+' 件'):'';
  if(!fs.length){ box.innerHTML='<div class="ml-empty">還沒有收藏夾清單。按「重新抓收藏夾」向 MyLike 要一次（約 20 秒）。</div>'; return; }
  box.innerHTML=fs.map(function(f){
    return '<div class="ml-folder" data-fid="'+esc(f.id)+'">'+
      '<span class="mf-name">'+esc(f.name)+'</span>'+
      '<span class="mf-n">'+nfmt(f.total)+'</span>'+
      '<span class="mf-tag">'+nfmt(f.dbItems)+'</span>'+
      '<span class="mf-time">'+esc(ago(f.syncedAt))+'</span>'+
      '<button type="button" class="mini-btn" data-ml-folder="'+esc(f.id)+'">抓索引</button>'+
    '</div>';
  }).join('');
}

function mlRuns(d){
  var box=$('mlRuns');
  if(!box) return;
  var runs=(d&&d.last)||[];
  if(!runs.length){ box.innerHTML='<div class="ml-empty">還沒有同步紀錄。</div>'; return; }
  var KIND={likes:'點讚',favorites:'收藏',folder:'收藏夾'};
  box.innerHTML=runs.map(function(r){
    var tag=r.kind==='folder'?(r.targetName||'收藏夾'):(KIND[r.kind]||r.kind);
    var st=r.state==='error'?'<span class="mr-state bad">失敗</span>':(r.state==='running'?'<span class="mr-state">進行中</span>':'<span class="mr-state ok">完成</span>');
    return '<div class="ml-run" title="'+esc(r.error||'')+'">'+
      '<span class="mr-kind">'+esc(tag)+'</span>'+
      '<span class="mr-num">+'+nfmt(r.added)+'</span>'+
      '<span class="mr-num dim">'+nfmt(r.updated)+'</span>'+
      '<span class="mr-pages">'+nfmt(r.pages)+' 頁</span>'+
      st+
      '<span class="mr-time">'+esc(ago(r.finishedAt||r.startedAt))+'</span>'+
    '</div>';
  }).join('');
}

function mlProg(job){
  var box=$('mlProg'), bar=$('mlBar'), txt=$('mlProgText');
  if(!box) return;
  if(!job||job.state!=='running'){ box.hidden=true; return; }
  box.hidden=false;
  var max=Number(job.maxPages)||60;
  var pct=Math.max(2,Math.min(100,Math.round((Number(job.pages)||0)/max*100)));
  if(bar) bar.style.width=pct+'%';
  var label=job.kind==='folder'?('收藏夾 · '+(job.targetName||'')):(job.kind==='likes'?'點讚':'收藏');
  if(txt) txt.textContent=label+' · 第 '+(job.pages||0)+' / '+max+' 頁 · 新增 '+nfmt(job.added)+' · 已存在 '+nfmt(job.updated);
}

function mlRenderAll(){
  mlConn(M.data);
  mlCards(M.data);
  mlFolders(M.data);
  mlRuns(M.data);
  mlProg(M.job);
}

function mlLoad(){
  if(M.loading) return Promise.resolve(false);
  M.loading=true;
  return req('/api/mylike').then(function(res){
    M.loading=false;
    if(!res.ok){
      M.data=null;
      mlRenderAll();
      return false;
    }
    M.data=res.data||{};
    M.job=M.data.job||M.job||null;
    mlRenderAll();
    if(M.job&&M.job.state==='running') mlPoll();
    return true;
  }).catch(function(){
    M.loading=false; M.data=null; mlRenderAll();
    return false;
  });
}

function mlPoll(){
  if(M.polling) return;
  M.polling=setInterval(function(){
    req('/api/mylike/job').then(function(res){
      if(!res.ok){ clearInterval(M.polling); M.polling=0; return; }
      var job=res.data&&res.data.job;
      if(job) M.job=job;
      mlProg(M.job);
      mlConn(M.data);
      if(job&&job.state==='running') return;
      clearInterval(M.polling); M.polling=0;
      mlLoad();
      reload(true);
      if(job&&job.state==='done') toast('同步完成 · 新增 '+nfmt(job.added)+' 件');
      else if(job&&job.state==='error') toast('同步失敗：'+(job.error||''));
    }).catch(function(){ clearInterval(M.polling); M.polling=0; });
  },1500);
}

function mlStart(source){
  var sel=$('mlPages');
  var pages=Number(sel&&sel.value)||5;
  post('/api/mylike/sync',{source:source,pages:pages}).then(function(res){
    if(res.status===409){ toast('已有同步在跑，等它跑完'); mlLoad(); return; }
    if(!res.ok){ toast('開始失敗：'+esc((res.data&&(res.data.error||res.data.message))||res.status)); return; }
    M.job=res.data&&res.data.job;
    mlProg(M.job); mlConn(M.data); mlPoll();
    toast(source==='likes'?'開始同步點讚':'開始同步收藏');
  }).catch(function(err){ toast('開始失敗：'+String(err&&err.message||err)); });
}

function mlFolder(id){
  post('/api/mylike/folders/'+encodeURIComponent(id)+'/sync',{pages:400}).then(function(res){
    if(res.status===404){ toast('這個收藏夾不在清單裡，先重新抓收藏夾'); return; }
    if(res.status===409){ toast('已有同步在跑，等它跑完'); mlLoad(); return; }
    if(!res.ok){ toast('開始失敗：'+esc((res.data&&(res.data.error||res.data.message))||res.status)); return; }
    M.job=res.data&&res.data.job;
    mlProg(M.job); mlConn(M.data); mlPoll();
    toast('開始抓收藏夾：'+((M.job&&M.job.targetName)||''));
  }).catch(function(err){ toast('開始失敗：'+String(err&&err.message||err)); });
}

function mlWake(){
  var btn=$('mlWake');
  if(btn){ btn.disabled=true; btn.textContent='喚醒中…'; }
  post('/api/mylike/wake',{}).then(function(res){
    if(btn){ btn.disabled=false; btn.textContent='喚醒抖音頁'; }
    if(res.ok&&res.data&&res.data.ok) toast('抖音頁已開');
    else toast('喚醒失敗：'+esc((res.data&&res.data.error)||res.status));
    mlLoad();
  }).catch(function(err){
    if(btn){ btn.disabled=false; btn.textContent='喚醒抖音頁'; }
    toast('喚醒失敗：'+String(err&&err.message||err));
  });
}

function mlRefreshFolders(){
  var btn=$('mlRefresh');
  if(btn){ btn.disabled=true; btn.textContent='抓取中…'; }
  post('/api/mylike/folders/refresh',{}).then(function(res){
    if(btn){ btn.disabled=false; btn.textContent='重新抓收藏夾'; }
    if(!res.ok){ toast('抓收藏夾失敗：'+esc((res.data&&(res.data.message||res.data.error))||res.status)); return; }
    toast('已更新 '+nfmt(res.data.fetched)+' 個收藏夾');
    mlLoad();
  }).catch(function(err){
    if(btn){ btn.disabled=false; btn.textContent='重新抓收藏夾'; }
    toast('抓收藏夾失敗：'+String(err&&err.message||err));
  });
}

function mlOpen(){
  var p=$('libMyLikePanel'), b=$('libMyLike');
  if(!p) return;
  p.hidden=false;
  M.open=true;
  if(b) b.setAttribute('aria-expanded','true');
  mlLoad();
}

function mlClose(){
  var p=$('libMyLikePanel'), b=$('libMyLike');
  if(p) p.hidden=true;
  M.open=false;
  if(b) b.setAttribute('aria-expanded','false');
  if(M.polling){ clearInterval(M.polling); M.polling=0; }
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
  updateChip();
  var grid=$('libGrid');
  on(grid,'click',function(e){
    var row=e.target.closest('.lib-author');
    if(row){ setAuthor(row.getAttribute('data-author')); return; }
    var card=e.target.closest('.lib-card');
    if(card) openViewer(card.getAttribute('data-id'));
  });

  var seg=$('libMode');
  on(seg,'click',function(e){
    var b=e.target.closest('button[data-mode]');
    if(!b) return;
    var m=b.getAttribute('data-mode');
    if(m===L.mode) return;
    setMode(m);
  });

  on($('libAuthorClear'),'click',clearAuthor);

  var more=$('libMore');
  on(more,'click',function(){ reload(false); });

  var search=$('libSearch');
  var doSearch=debounce(function(){
    L.q=String(search&&search.value||'').trim();
    reload(true);
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

  var asort=$('libASort');
  on(asort,'change',function(){ L.asort=asort.value||'count'; if(L.mode==='authors') loadAuthors(true); });

  var reset=$('libReset');
  on(reset,'click',function(){
    L.q=''; L.kind='all'; L.source='all'; L.sort='recent'; L.author='';
    if(search) search.value='';
    if(sort) sort.value='recent';
    var k=$('libKind'), s=$('libSource');
    if(k) k.querySelectorAll('button').forEach(function(x){ x.setAttribute('aria-pressed',String(x.getAttribute('data-kind')==='all')); });
    if(s) s.querySelectorAll('button').forEach(function(x){ x.setAttribute('aria-pressed',String(x.getAttribute('data-source')==='all')); });
    updateChip();
    reload(true);
  });

  /* MyLike 面板 */
  on($('libMyLike'),'click',function(){ if(M.open) mlClose(); else mlOpen(); });
  on($('libOptimize'),'click',optimizeImages);
  on($('libDeriv'),'click',derivativeImages);
  on($('libDownloadMissing'),'click',downloadMissing);
  on($('mlClose'),'click',mlClose);
  on($('mlWake'),'click',mlWake);
  on($('mlRefresh'),'click',mlRefreshFolders);
  var mlp=$('libMyLikePanel');
  on(mlp,'click',function(e){
    var b=e.target.closest('[data-ml-sync]');
    if(b){ mlStart(b.getAttribute('data-ml-sync')); return; }
    var f=e.target.closest('[data-ml-folder]');
    if(f) mlFolder(f.getAttribute('data-ml-folder'));
  });

  on($('libMedia'),'click',function(e){ if(e.target.closest('[data-lv-dl]')) downloadItem(); });
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
    if(e.key==='Escape'&&M.open){ e.preventDefault(); mlClose(); return; }
    var v=$('libViewer');
    if(!v||v.hidden) return;
    if(e.key==='Escape'){ e.preventDefault(); closeViewer(); return; }
    if(e.key==='ArrowLeft'){ e.preventDefault(); step(-1); return; }
    if(e.key==='ArrowRight'){ e.preventDefault(); step(1); }
  });

  window.addEventListener('kolindex:api',function(e){
    var d=(e&&e.detail)||{};
    if(d.ok&&!L.loaded) reload(true);
    else if(d.ok&&L.active&&Date.now()-L.at>POLL_MS) reload(true);
  });

  if(typeof MutationObserver==='function'){
    var mo=new MutationObserver(function(){
      var t=document.body.getAttribute('data-topic');
      var now=t==='library';
      if(now===L.active) return;
      if(!now&&M.open) mlClose();
      L.active=now;
      if(!now&&DV.poll){ clearTimeout(DV.poll); DV.poll=0; }
      if(now&&derivRunning()&&!DV.poll) derivTick();
      if(now&&(!L.loaded||Date.now()-L.at>POLL_MS)) reload(true);
    });
    mo.observe(document.body,{attributes:true,attributeFilter:['data-topic']});
  }
  L.active=document.body.getAttribute('data-topic')==='library';
  if(L.active) load(true);
  syncDownload();
  syncOptimize();
  syncDeriv();
}

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',bind);
else bind();

window.KOLINDEX_LIBRARY={state:L,load:load,reload:reload,loadAuthors:loadAuthors,setMode:setMode,setAuthor:setAuthor,
  clearAuthor:clearAuthor,displayAuthor:displayAuthor,authorRowHtml:authorRowHtml,renderAuthors:renderAuthors,
  openViewer:openViewer,closeViewer:closeViewer,mediaUrl:mediaUrl,esc:esc,bytes:bytes,day:day,trim:trim,nfmt:nfmt,
  download:{state:D,item:downloadItem,missing:downloadMissing,sync:syncDownload},
  optimize:{state:O,run:optimizeImages,sync:syncOptimize,tick:optTick,mb:mb},
  derivative:{state:DV,run:derivativeImages,sync:syncDeriv,tick:derivTick},
  mylike:{state:M,open:mlOpen,close:mlClose,load:mlLoad,start:mlStart,folder:mlFolder,wake:mlWake,refreshFolders:mlRefreshFolders,ago:ago}};
})();
