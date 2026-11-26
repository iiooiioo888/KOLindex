/* ============================================================
   person.js · 「人物檔案」分頁
   模式 subjects：控制面人物主檔 GET/POST /__control/subjects
   模式 douyin：舊抖音作者索引 GET /api/library/authors
   ============================================================ */
(function(){
'use strict';

var BASE=(typeof window!=='undefined'&&window.KOLINDEX_BASE)||'';
var LIMIT=100, WORK_LIMIT=24, POLL_MS=120000;
var KIND_LABEL={gallery:'圖集',video:'影片'};

var A={ok:false,loaded:false,loading:false,active:false,q:'',sort:'count',
  mode:'subjects',subjects:[],subjectSel:null,discover:[],discoverSkip:[],discoverBusy:false,ossLive:[],
  mediaIndex:null,mediaBusy:false,inbox:[],inboxBusy:false,inboxSource:'',
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
  var raw=String(p);
  if(/^https?:/i.test(raw)) return raw;
  var base=((typeof window!=='undefined'&&window.KOLINDEX_MEDIA)||'/media').replace(/\/$/,'');
  var rel=raw.replace(/^\/+/,'');
  if(/\/media$/.test(base) && rel.indexOf('media/')===0) rel=rel.slice(6);
  return base+'/'+rel;
}
function displayAuthor(a){ if(!a) return '未命名'; return a==='unnamed'?'未命名':a; }
function on(el,ev,fn){ if(el&&el.addEventListener) el.addEventListener(ev,fn); }
function setStatus(text,tone){
  var e=$('pnStatus'); if(!e) return;
  e.textContent=text; e.className='chip '+(tone||'or');
}

/* ---------- 取資料 ---------- */
function req(path){
  var call=window.KOL&&window.KOL.requestStatus;
  if(call) return call(path);
  return fetch(BASE+path,{headers:{accept:'application/json'}}).then(function(r){
    return r.text().then(function(t){
      var j={};
      try { j=t?JSON.parse(t):{}; } catch(e){ j={raw:t}; }
      return {ok:r.ok,status:r.status,data:j};
    });
  });
}

function loadSubjects(){
  var tok=++A.tok;
  A.loading=true;
  setStatus('載入人物主檔…','or');
  var path='/__control/subjects';
  if(A.q) path+='?q='+encodeURIComponent(A.q);
  return req(path).then(function(res){
    if(tok!==A.tok) return false;
    A.loading=false;
    if(!res.ok){
      A.ok=false;
      A.error=(res.data&&(res.data.error||res.data.message))||('HTTP '+res.status);
      A.subjects=[];
      A.total=0;
      setStatus(res.status===503?'控制面未連線':'人物主檔失敗','or');
      renderAll();
      return false;
    }
    var d=res.data||{};
    A.ok=true; A.loaded=true; A.at=Date.now(); A.error='';
    A.subjects=Array.isArray(d.items)?d.items:[];
    A.total=Number(d.total)||A.subjects.length;
    A.counts={source:d.source||'control.subjects'};
    setStatus('主檔 · LIVE','cyan');
    renderAll();
    loadInbox();
    return true;
  }).catch(function(err){
    if(tok!==A.tok) return false;
    A.loading=false; A.ok=false; A.error=String(err&&err.message||err);
    setStatus('控制面未連線','or'); renderAll(); return false;
  });
}

function load(reset){
  if(A.mode==='subjects') return loadSubjects();
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

function syncModeChrome(){
  var form=$('pnSubjectForm');
  var sort=$('pnSort');
  var more=$('pnMore');
  var cap=$('pnCap');
  var title=$('pnSideTitle');
  var crumb=$('pnTitleEn');
  /* 建立表單只在「新建」工具列開啟時顯示；模式切回時預設藏起 */
  if(sort) sort.hidden=A.mode==='subjects';
  if(more) more.hidden=A.mode==='subjects';
  if(title) title.textContent=A.mode==='subjects'?'人物主檔':'抖音索引';
  if(crumb) crumb.textContent=A.mode==='subjects'?'subjects':'douyin authors';
  if(cap){
    cap.innerHTML=A.mode==='subjects'
      ? '<b>人物主檔</b>是一個人對多個已確認平台帳號。覆蓋缺口沒有測量數字時顯示「—」。抖音、小紅書發現若未開放，只會列在略過清單。'
      : '<b>抖音作者索引</b>來自 <code>/api/library/authors</code>。這是素材來源清單，不是歸戶後的人物主檔。';
  }
  var mode=$('pnMode');
  if(mode) mode.querySelectorAll('[data-pn-mode]').forEach(function(btn){
    btn.setAttribute('aria-pressed', String(btn.getAttribute('data-pn-mode')===A.mode));
  });
  /* 非 subjects 時強制關閉建立表單 */
  if(form && A.mode!=='subjects') form.hidden=true;
}

/* ---------- 畫面 ---------- */
function renderKpis(){
  var box=$('pnKpis'); if(!box) return;
  syncModeChrome();
  if(!A.loaded){
    box.innerHTML=(A.mode==='subjects'
      ?['人物主檔','已確認帳號','候選帳號','覆蓋缺口']
      :['人物','已命名','純數字帳號','未命名作品']
    ).map(function(name){
      return '<div class="pn-kpi"><span>'+esc(name)+'</span><b>—</b></div>';
    }).join('');
    var cnt0=$('pnCount'); if(cnt0) cnt0.textContent='—';
    var bd0=$('navPersonBd'); if(bd0) bd0.textContent='—';
    var en0=$('pnTitleEn'); if(en0) en0.textContent=A.mode==='subjects'?'subjects':'douyin authors';
    return;
  }
  if(A.mode==='subjects'){
    var confirmed=0, candidates=0;
    A.subjects.forEach(function(s){
      confirmed+=(s.coverage&&s.coverage.confirmed_accounts)||0;
      candidates+=(s.coverage&&s.coverage.candidate_accounts)||0;
    });
    box.innerHTML=[
      ['人物主檔', nfmt(A.total)],
      ['已確認帳號', nfmt(confirmed)],
      ['候選帳號', nfmt(candidates)],
      ['覆蓋缺口', '—']
    ].map(function(x){
      return '<div class="pn-kpi"><span>'+esc(x[0])+'</span><b>'+esc(x[1])+'</b></div>';
    }).join('');
    var cntS=$('pnCount'); if(cntS) cntS.textContent=nfmt(A.total)+' 位';
    var bdS=$('navPersonBd'); if(bdS) bdS.textContent=compactCount(A.total);
    var enS=$('pnTitleEn'); if(enS) enS.textContent='subjects · '+compactCount(A.total);
    return;
  }
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
  if(cnt) cnt.textContent=A.loaded?(nfmt(A.total)+' 位'):'—';
  var bd=$('navPersonBd');
  var en=$('pnTitleEn');
  if(!A.loaded){
    if(bd) bd.textContent='—';
    if(en) en.textContent='douyin authors';
    return;
  }
  var authors=c.authors!=null?Number(c.authors):Number(A.total);
  var label=compactCount(authors);
  if(bd) bd.textContent=label;
  if(en) en.textContent='douyin authors · '+label;
}

function compactCount(n){
  n=Number(n);
  if(!isFinite(n)) return '—';
  if(n>=1000) return (n/1000).toFixed(1).replace(/\.0$/,'')+'k';
  return String(Math.round(n));
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

function subjectRowHtml(s){
  var cov=s.coverage||{};
  var meta=nfmt(cov.confirmed_accounts||0)+' 已確認 · '+nfmt(cov.candidate_accounts||0)+' 候選';
  var on=A.subjectSel&&A.subjectSel.id===s.id?' on':'';
  return '<button type="button" class="pn-row'+on+'" data-subject="'+esc(s.id)+'" title="'+esc(s.display_name)+'" aria-pressed="'+(on?'true':'false')+'">'+
    '<span class="pr-name">'+esc(s.display_name)+'</span>'+
    '<span class="pr-meta">'+esc(meta)+'</span>'+
    '<span class="pr-day">'+esc((s.updated_at||'').slice(0,10)||'—')+'</span>'+
    '<span class="pr-kind">缺口 —</span>'+
  '</button>';
}

function renderList(){
  var box=$('pnList'); if(!box) return;
  if(A.mode==='subjects'){
    if(!A.subjects.length){
      box.innerHTML='<div class="pn-empty">'+(A.loaded?(A.error?'控制面：'+esc(A.error):'還沒有人物主檔。上方可建立一位。'):'尚未載入')+'</div>';
    } else {
      box.innerHTML=A.subjects.map(subjectRowHtml).join('');
    }
    renderFoot();
    return;
  }
  if(!A.items.length){
    box.innerHTML='<div class="pn-empty">'+(A.loaded?'沒有符合的人物':'尚未載入')+'</div>';
  } else {
    box.innerHTML=A.items.map(rowHtml).join('');
  }
  renderFoot();
}

function renderFoot(){
  var more=$('pnMore'), foot=$('pnFoot');
  if(A.mode==='subjects'){
    if(more){ more.disabled=true; more.textContent='人物主檔一次載入'; }
    if(foot) foot.textContent=A.subjects.length?('顯示 '+nfmt(A.subjects.length)+' 位人物主檔 · 來源 control.subjects'):'';
    return;
  }
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

function loadOssLive(){
  return fetch(BASE+'/__oss/status',{credentials:'same-origin',cache:'no-store',headers:{accept:'application/json'}})
    .then(function(r){ return r.json().then(function(j){ return {ok:r.ok,data:j||{}}; }); })
    .then(function(res){
      A.ossLive=res.ok&&Array.isArray(res.data.items)?res.data.items:[];
    }).catch(function(){ A.ossLive=[]; });
}

function loadInbox(){
  if(A.mode!=='subjects'||A.inboxBusy) return Promise.resolve();
  A.inboxBusy=true;
  return fetch(BASE+'/__control/intelligence/inbox',{
    credentials:'same-origin',cache:'no-store',headers:{accept:'application/json'}
  }).then(function(r){
    return r.json().then(function(j){ return {ok:r.ok,data:j||{}}; });
  }).then(function(res){
    A.inboxBusy=false;
    A.inbox=res.ok&&Array.isArray(res.data.items)?res.data.items:[];
    A.inboxSource=res.ok?(res.data.source||'control.intelligence'):'';
    if(A.subjectSel) renderSubjectSide();
  }).catch(function(){
    A.inboxBusy=false;
    A.inbox=[];
    A.inboxSource='';
    if(A.subjectSel) renderSubjectSide();
  });
}

function renderSubjectSide(){
  var box=$('pnSide'); if(!box) return;
  var s=A.subjectSel;
  if(!s){
    box.innerHTML='<div class="pn-empty"><b>還沒選人物主檔。</b>點清單建立或選一位。</div>';
    return;
  }
  var cov=s.coverage||{};
  var posts=((A.mediaIndex&&A.mediaIndex.posts)||[]).slice(0,8);
  var media=((A.mediaIndex&&A.mediaIndex.media)||[]).slice(0,8);
  var sims=((A.mediaIndex&&A.mediaIndex.similarity_links)||[]).filter(function(l){ return l.status==='waiting_review'; }).slice(0,5);
  var accounts=(s.accounts||[]).map(function(a){
    var href=a.profile_url?('<a href="'+esc(a.profile_url)+'" target="_blank" rel="noopener noreferrer">開</a>'):'';
    return '<tr><td>'+esc(a.platform)+'</td><td>'+esc(a.display_name)+'</td><td>'+esc(a.link_status)+'</td><td>'+href+'</td></tr>';
  }).join('')||'<tr><td colspan="4">無帳號</td></tr>';
  var discover=(A.discover||[]).slice(0,8).map(function(c){
    var conf=c.confidence==null?'':(' '+Number(c.confidence).toFixed(2));
    return '<button type="button" class="mini-btn" data-link-cand="1" data-platform="'+esc(c.platform)+'" data-ext="'+esc(c.external_account_id)+'" data-name="'+esc(c.display_name)+'" data-url="'+esc(c.profile_url||'')+'">'+esc(c.platform)+' · '+esc(c.display_name)+esc(conf)+'</button>';
  }).join('')||'<span class="note">按「發現」取得候選</span>';
  var todo=[];
  (A.inbox||[]).slice(0,5).forEach(function(it){
    var sid=(it.subject_ids&&it.subject_ids[0])||'';
    var score=it.score==null?'':(' '+Number(it.score).toFixed(2));
    todo.push('<li>'+esc(it.title||it.kind||'待辦')+esc(score)+(sid?(' <button type="button" class="mini-btn" data-open-subject="'+esc(sid)+'">開</button>'):'')+'</li>');
  });
  sims.forEach(function(l){
    var label=l.kind==='copy_suspect'?'抄襲嫌疑':'近似重複';
    todo.push('<li>'+esc(label)+' '+esc(Number(l.score).toFixed(2))+'</li>');
  });
  var skipLine=(A.discoverSkip||[]).map(function(x){ return (x.platform||'?')+':'+((x.status||'').replace('not_enabled','關')); }).join(' · ')||'—';
  var ossLine=(A.ossLive||[]).filter(function(x){ return x.id==='xhs'||x.id==='douyin-api'||x.id==='sherlock'; }).map(function(x){
    return (x.name||x.id)+':'+(x.discovery||x.state||'—');
  }).join(' · ')||'—';
  var stock=
    '作品 '+(cov.indexed_posts==null?'—':nfmt(cov.indexed_posts))+
    ' · 圖 '+(cov.media_assets==null?'—':nfmt(cov.media_assets))+
    ' · 待審 '+(cov.similarity_pending==null?'—':nfmt(cov.similarity_pending));
  var stockRows='';
  if(A.mediaIndex){
    stockRows=
      '<table class="plain"><thead><tr><th>作品</th><th>圖</th></tr></thead><tbody><tr><td>'+
      (posts.map(function(p){ return esc(trim(p.title||p.external_post_id||'—',28)); }).join('<br>')||'—')+
      '</td><td>'+
      (media.map(function(m){ return esc(m.media_kind)+' '+esc(String(m.checksum||'').slice(0,8)); }).join('<br>')||'—')+
      '</td></tr></tbody></table>';
  }
  box.innerHTML=
    '<div class="ph-head"><div class="ph-kicker">人物主檔</div><div class="ph-name">'+esc(s.display_name)+'</div>'+
    '<div class="ph-meta"><span>確認 '+esc(nfmt(cov.confirmed_accounts||0))+'</span><span>候選 '+esc(nfmt(cov.candidate_accounts||0))+'</span><span>'+esc(stock)+'</span></div>'+
    '<div class="ph-actions"><button type="button" class="mini-btn" data-pn-back="1">← 清單</button>'+
    '<button type="button" class="mini-btn primary" data-cap="operate" data-discover="1"'+(A.discoverBusy?' disabled':'')+'>'+(A.discoverBusy?'發現中…':'發現')+'</button>'+
    '<button type="button" class="mini-btn" data-media-index="1"'+(A.mediaBusy?' disabled':'')+'>'+(A.mediaBusy?'讀取中…':'索引')+'</button></div></div>'+
    '<div class="pn-months"><div class="pm-cap">帳號</div><table class="plain"><thead><tr><th>平台</th><th>名稱</th><th>狀態</th><th></th></tr></thead><tbody>'+accounts+'</tbody></table></div>'+
    '<div class="pn-months"><div class="pm-cap">發現</div><div class="ph-actions">'+discover+'</div><p class="note">略過 '+esc(skipLine)+'</p></div>'+
    '<div class="pn-months"><div class="pm-cap">待辦</div>'+(todo.length?'<ul class="plain-list">'+todo.join('')+'</ul>':'<p class="note">無</p>')+'</div>'+
    '<div class="pn-months"><div class="pm-cap">庫存</div>'+(stockRows||'<p class="note">按「索引」載入</p>')+'</div>'+
    '<p class="note">OSS '+esc(ossLine)+'</p>';
}

function renderSide(){
  var box=$('pnSide'); if(!box) return;
  if(A.mode==='subjects') return renderSubjectSide();
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

/* 兩個檢視：index＝歡迎頁、profile＝右側人物空間。殼層與產出庫相同。 */
function applyView(){
  var box=$('topic-person');
  if(box&&box.setAttribute) box.setAttribute('data-pn-view',A.view);
  var label=$('pnTabLabel');
  var name='未選人物';
  if(A.view==='profile'){
    if(A.mode==='subjects'&&A.subjectSel) name=A.subjectSel.display_name||A.subjectSel.id;
    else if(A.sel) name=displayAuthor(A.sel);
  }
  if(label) label.textContent=name;
  var crumb=$('pnCrumb');
  if(crumb){
    var src=A.mode==='subjects'?'subjects':'douyin authors';
    crumb.innerHTML='人物檔案 · <span id="pnTitleEn">'+esc(src)+'</span>'+(A.view==='profile'?' / '+esc(name):'');
  }
}
function renderAll(){ renderKpis(); renderList(); renderSide(); applyView(); syncModeChrome(); }

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
  A.sel=''; A.meta=null; A.works=[]; A.months=[]; A.plat=null;
  A.subjectSel=null; A.discover=[]; A.view='index';
  renderAll();
}

function openInLibrary(){
  var who=A.sel; if(!who) return;
  if(window.KOLINDEX_LIBRARY&&window.KOLINDEX_LIBRARY.openWithAuthor){
    window.KOLINDEX_LIBRARY.openWithAuthor(who);
    return;
  }
  if(window.KOLINDEX_LIBRARY&&window.KOLINDEX_LIBRARY.setAuthor) window.KOLINDEX_LIBRARY.setAuthor(who);
  if(window.KOLINDEX_UI&&window.KOLINDEX_UI.setTopic) window.KOLINDEX_UI.setTopic('library');
}

function openAuthor(name){
  A.mode='douyin';
  syncModeChrome();
  if(window.KOLINDEX_UI&&window.KOLINDEX_UI.setTopic) window.KOLINDEX_UI.setTopic('person');
  selectAuthor(name);
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
  syncModeChrome();

  var ideSide='files';
  function setIdeSide(next){
    ideSide=next||'files';
    var root=$('pnIde');
    if(root){
      root.querySelectorAll('[data-pn-ide]').forEach(function(b){
        b.classList.toggle('on', b.getAttribute('data-pn-ide')===ideSide);
      });
    }
    var filter=$('pnFilterWrap');
    var form=$('pnSubjectForm');
    if(filter) filter.hidden=ideSide!=='search';
    if(form) form.hidden=!(ideSide==='new' && A.mode==='subjects');
    var title=$('pnSideTitle');
    if(title){
      title.textContent=ideSide==='search'?'尋找人物':(ideSide==='new'?'建立人物':(A.mode==='subjects'?'人物主檔':'抖音索引'));
    }
  }
  var ide=$('pnIde');
  on(ide,'click',function(e){
    var act=e.target.closest('[data-pn-ide]');
    if(!act) return;
    setIdeSide(act.getAttribute('data-pn-ide'));
  });
  setIdeSide('files');

  function selectSubject(id){
    A.subjectSel=null;
    A.discover=[];
    A.discoverSkip=[];
    A.mediaIndex=null;
    for(var i=0;i<A.subjects.length;i++){
      if(A.subjects[i].id===id){ A.subjectSel=A.subjects[i]; break; }
    }
    A.view='profile';
    Promise.all([loadOssLive(), loadInbox()]).then(function(){ renderAll(); });
    renderAll();
    if(A.subjectSel) loadMediaIndex();
  }

  function loadMediaIndex(){
    if(!A.subjectSel||A.mediaBusy) return Promise.resolve();
    A.mediaBusy=true; renderSubjectSide();
    return fetch(BASE+'/__control/subjects/'+encodeURIComponent(A.subjectSel.id)+'/media',{
      credentials:'same-origin',cache:'no-store',headers:{accept:'application/json'}
    }).then(function(r){
      return r.json().then(function(j){ return {ok:r.ok,data:j||{}}; });
    }).then(function(res){
      A.mediaBusy=false;
      A.mediaIndex=res.ok?{
        posts:res.data.posts||[],
        media:res.data.media||[],
        similarity_links:res.data.similarity_links||[],
        source:res.data.source||'control.media_index'
      }:null;
      renderSubjectSide();
    }).catch(function(){
      A.mediaBusy=false;
      A.mediaIndex=null;
      renderSubjectSide();
    });
  }

  function createSubject(name){
    var out=$('pnSubjectOut');
    return fetch(BASE+'/__control/subjects',{
      method:'POST',
      credentials:'same-origin',
      headers:{'content-type':'application/json',accept:'application/json'},
      body:JSON.stringify({display_name:name})
    }).then(function(r){
      return r.json().then(function(j){ return {ok:r.ok,status:r.status,data:j||{}}; });
    }).then(function(res){
      if(!res.ok){
        var msg=(res.data&&(res.data.message||res.data.detail||res.data.error))||('HTTP '+res.status);
        if(out) out.textContent=String(msg);
        return;
      }
      if(out) out.textContent='已建立 '+name;
      A.q='';
      if($('pnSearch')) $('pnSearch').value='';
      return loadSubjects().then(function(){ selectSubject(res.data.id); });
    }).catch(function(){
      if(out) out.textContent='控制面沒回應。先跑 python apps/control/app.py';
    });
  }

  function discoverForSubject(){
    if(!A.subjectSel||A.discoverBusy) return;
    A.discoverBusy=true; renderSubjectSide();
    Promise.all([
      fetch(BASE+'/__discovery',{
        method:'POST',
        credentials:'same-origin',
        headers:{'content-type':'application/json',accept:'application/json'},
        body:JSON.stringify({query:A.subjectSel.display_name})
      }).then(function(r){
        return r.json().then(function(j){ return {ok:r.ok,data:j||{}}; });
      }),
      loadOssLive()
    ]).then(function(pair){
      var res=pair[0];
      A.discoverBusy=false;
      A.discover=res.ok&&Array.isArray(res.data.candidates)?res.data.candidates:[];
      A.discoverSkip=res.ok&&Array.isArray(res.data.skipped)?res.data.skipped:[];
      loadInbox();
      renderSubjectSide();
    }).catch(function(){
      A.discoverBusy=false;
      A.discover=[];
      A.discoverSkip=[];
      renderSubjectSide();
    });
  }

  function linkCandidate(btn){
    if(!A.subjectSel) return;
    fetch(BASE+'/__control/subjects/'+encodeURIComponent(A.subjectSel.id)+'/accounts',{
      method:'POST',
      credentials:'same-origin',
      headers:{'content-type':'application/json',accept:'application/json'},
      body:JSON.stringify({
        platform:btn.getAttribute('data-platform'),
        external_account_id:btn.getAttribute('data-ext'),
        display_name:btn.getAttribute('data-name'),
        profile_url:btn.getAttribute('data-url')||'',
        link_status:'candidate',
        linked_by:'operator'
      })
    }).then(function(r){ return r.json().then(function(j){ return {ok:r.ok,data:j||{}}; }); })
      .then(function(res){
        if(!res.ok) return;
        A.subjectSel=res.data;
        for(var i=0;i<A.subjects.length;i++){
          if(A.subjects[i].id===res.data.id){ A.subjects[i]=res.data; break; }
        }
        renderAll();
      });
  }

  var mode=$('pnMode');
  on(mode,'click',function(e){
    var btn=e.target.closest('[data-pn-mode]');
    if(!btn) return;
    var next=btn.getAttribute('data-pn-mode');
    if(next===A.mode) return;
    A.mode=next;
    A.loaded=false; A.ok=false; A.subjects=[]; A.items=[]; A.subjectSel=null; A.sel=''; A.view='index';
    setIdeSide(ideSide==='new'&&next!=='subjects'?'files':ideSide);
    load(true);
  });

  var subjectForm=$('pnSubjectForm');
  on(subjectForm,'submit',function(e){
    e.preventDefault();
    var name=String(($('pnSubjectName')&&$('pnSubjectName').value)||'').trim();
    if(!name) return;
    createSubject(name).then(function(){
      if($('pnSubjectName')) $('pnSubjectName').value='';
    });
  });

  var list=$('pnList');
  on(list,'click',function(e){
    var sub=e.target.closest('[data-subject]');
    if(sub){ selectSubject(sub.getAttribute('data-subject')); return; }
    var row=e.target.closest('[data-author]');
    if(!row) return;
    var who=row.getAttribute('data-author');
    if(who===A.sel) return;
    selectAuthor(who);
  });

  var side=$('pnSide');
  on(side,'click',function(e){
    if(e.target.closest('[data-pn-back]')){ backToList(); return; }
    if(e.target.closest('[data-discover]')){ discoverForSubject(); return; }
    if(e.target.closest('[data-media-index]')){ loadMediaIndex(); return; }
    var openSub=e.target.closest('[data-open-subject]');
    if(openSub){ selectSubject(openSub.getAttribute('data-open-subject')); return; }
    var link=e.target.closest('[data-link-cand]');
    if(link){ linkCandidate(link); return; }
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
    if(!d.ok&&d.reason){
      A.items=[]; A.subjects=[]; A.works=[]; A.months=[]; A.counts=null; A.total=0; A.ok=false; A.loaded=false;
      renderAll();
      setStatus(d.reason==='401'?'需要登入':'來源錯誤','or');
      return;
    }
    if(A.mode==='subjects') return;
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

window.KOLINDEX_PERSON={
  version:'2.1.0',
  state:A,load:load,loadWorks:loadWorks,loadMonths:loadMonths,loadPlatform:loadPlatform,
  platformHtml:platformHtml,monthsHtml:monthsHtml,selectAuthor:selectAuthor,backToList:backToList,
  openInLibrary:openInLibrary,openAuthor:openAuthor,displayAuthor:displayAuthor,rowHtml:rowHtml,
  authorRows:function(){ return A.items; },esc:esc,bytes:bytes,day:day,nfmt:nfmt
};
})();