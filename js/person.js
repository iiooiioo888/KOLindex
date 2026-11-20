/* ============================================================
   person.js · 「人物檔案」分頁
   讀 /api/persons 與 /api/persons/:id/timeline，畫成
   F2 歸戶結果 + 貼文／AI 事件／告警的統一時間軸。
   後端不在時整頁留空並顯示原因，不影響其他分頁。
   ============================================================ */
(function(){
  'use strict';

  var BASE = (typeof window !== 'undefined' && window.KOLINDEX_BASE) || '';
  var PLAT_LABEL={xhs:'小紅書',douyin:'抖音',weibo:'微博',bilibili:'B站',x:'X',youtube:'YouTube',instagram:'Instagram',tiktok:'TikTok'};
  var STATE_LABEL={confirmed:'已確認',review:'待審核',candidate:'候選'};
  var POST_KIND={video:'影片',image:'圖文',text:'文字'};
  var AI_KIND={sentiment_shift:'情緒轉折',burst:'爆量',brand_collab:'品牌合作',anomaly:'異常'};
  var AL_KIND={credential:'憑證',argus:'風控',sla:'SLA',gate:'閘門',outbox:'事件投遞'};
  var TYPE_LABEL={post:'貼文',ai_event:'AI 事件',alert:'告警'};
  var FILTERS=['all','post','ai_event','alert'];

  var P={ok:false,loaded:false,loading:false,active:false,filter:'all',selected:null,
    persons:[],items:[],search:'',at:0,error:'',tok:0};

  function $(id){ return document.getElementById(id); }
  function esc(s){
    return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function num(n){
    if (n==null||n===''||isNaN(Number(n))) return '—';
    n=Number(n);
    if (n>=100000) return (n/10000).toFixed(0)+'w';
    if (n>=10000) return (n/10000).toFixed(1)+'w';
    return String(n);
  }
  function rel(iso, nowMs){
    if (!iso) return '';
    var t=Date.parse(iso);
    if (isNaN(t)) return String(iso);
    var d=Math.round(((nowMs||Date.now())-t)/1000);
    if (d<0) d=0;
    if (d<60) return '剛剛';
    if (d<3600) return Math.floor(d/60)+'m';
    if (d<86400) return Math.floor(d/3600)+'h';
    if (d<86400*7) return Math.floor(d/86400)+'d';
    var dt=new Date(t);
    return (dt.getMonth()+1)+'/'+dt.getDate();
  }
  function setStatus(kind,text){
    var el=$('personStatus');
    if (!el) return;
    el.className='chip '+kind;
    el.textContent=text;
  }

  /* ---------- 資料推導 ---------- */
  function personOf(id){
    for (var i=0;i<P.persons.length;i++) if (String(P.persons[i].person_id)===String(id)) return P.persons[i];
    return null;
  }
  function filtered(){
    var q=P.search.trim().toLowerCase();
    if (!q) return P.persons.slice();
    return P.persons.filter(function(p){
      if (String(p.display_name||'').toLowerCase().indexOf(q)>=0) return true;
      return (p.accounts||[]).some(function(a){ return String(a.handle||'').toLowerCase().indexOf(q)>=0; });
    });
  }
  function itemsIn(){
    if (P.filter==='all') return P.items.slice();
    return P.items.filter(function(it){ return it.type===P.filter; });
  }

  /* ---------- 左：人物清單 ---------- */
  function renderList(){
    var host=$('personList');
    var count=$('personCount');
    var list=filtered();
    if (count) count.textContent=(P.loaded?(list.length===P.persons.length?list.length+' 人':list.length+' / '+P.persons.length+' 人'):'—');
    if (!host) return;
    if (!list.length){
      host.innerHTML='<div class="tl-empty">'+(P.loaded?'沒有符合的人物':'<b>人物清單</b>後端沒開時這一頁留空，其他分頁照常。')+'</div>';
      return;
    }
    host.innerHTML=list.map(function(p){
      var accts=p.accounts||[];
      var chips=accts.slice(0,4).map(function(a){
        return '<span class="pstat '+esc(a.platform)+'">'+esc(a.platform_label||PLAT_LABEL[a.platform]||a.platform)+'</span>';
      }).join('');
      if (accts.length>4) chips+='<span class="pstat">+'+(accts.length-4)+'</span>';
      return '<button type="button" class="pl-item" data-pid="'+esc(p.person_id)+'" aria-pressed="'+(String(p.person_id)===String(P.selected))+'" data-search>'+
        '<span class="pl-top"><span class="pl-name">'+esc(p.display_name)+'</span><span class="pl-n">'+accts.length+' 帳號 · '+esc(p.posts||0)+' 帖</span></span>'+
        '<span class="pl-chips">'+chips+'</span></button>';
    }).join('');
  }

  /* ---------- 右：人物檔頭 ---------- */
  function renderHead(){
    var host=$('personHead');
    if (!host) return;
    var p=personOf(P.selected);
    if (!p){
      host.innerHTML='<div class="tl-empty">'+(P.ok?'<b>選一個人物</b>左邊是 /api/persons 回來的歸戶結果。':'<b>還沒連上後端</b>跑 node kolindex-api/server.mjs 之後，點一下這個分頁會自動重試。')+'</div>';
      return;
    }
    var accts=p.accounts||[];
    var scope=p.scope==='adult_vertical'?'成人垂直':'一般';
    var chips=[
      '<span class="chip '+(p.scope==='adult_vertical'?'red':'cyan')+'">範圍 · '+esc(scope)+'</span>',
      '<span class="chip">'+accts.length+' 帳號</span>',
      '<span class="chip">'+esc(p.posts||0)+' 帖</span>'
    ].join('');
    if (p.last_checked_at) chips+='<span class="chip">最後檢查 '+esc(rel(p.last_checked_at))+'</span>';
    var acctHtml=accts.map(function(a){
      var conf=Math.round((Number(a.confidence)||0)*100);
      return '<div class="acct" data-acct="'+esc(a.id)+'">'+
        '<div class="acct-top"><span class="acct-p">'+esc(a.platform)+'</span><span class="acct-h">@'+esc(a.handle)+'</span></div>'+
        '<div class="acct-row"><span class="st-chip '+esc(a.state)+'">'+esc(STATE_LABEL[a.state]||a.state||'—')+'</span><b>'+esc(num(a.followers))+'</b><span>追蹤</span></div>'+
        '<div class="acct-row"><span>F2 '+conf+'%</span><span class="confbar'+(conf<70?' low':'')+'" style="--pct:'+conf+'%"><i></i></span></div>'+
        '</div>';
    }).join('');
    host.innerHTML='<div class="ph-top"><span class="ph-name">'+esc(p.display_name)+'</span>'+
      '<span class="ph-sub">person_id '+esc(p.person_id)+' · 貼文 '+(p.posts||0)+' · 在列 '+(P.items.length||0)+' 條時間軸</span></div>'+
      '<div class="ph-chips">'+chips+'</div>'+
      '<div class="acct-list">'+acctHtml+'</div>';
  }

  /* ---------- 統一時間軸 ---------- */
  function metricChips(m){
    if (!m) return '';
    var out=[];
    if (m.likes!=null) out.push('讚 '+esc(num(m.likes)));
    if (m.comments!=null) out.push('留言 '+esc(num(m.comments)));
    if (m.shares!=null) out.push('轉發 '+esc(num(m.shares)));
    if (m.views!=null) out.push('瀏覽 '+esc(num(m.views)));
    return out.map(function(s){ return '<span>'+s+'</span>'; }).join('');
  }
  function itemHtml(it){
    if (it.type==='post'){
      var p=it.post||{};
      var kind=POST_KIND[p.kind]||p.kind||'';
      return '<article class="tl-item post">'+
        '<div class="tl-top"><span class="tl-type post">貼文</span>'+
        '<span class="ph-sub">'+esc(p.platform_label||PLAT_LABEL[p.platform]||p.platform||'')+(kind?' · '+esc(kind):'')+'</span>'+
        '<span class="tl-when">'+esc(rel(it.at))+'</span></div>'+
        '<div class="tl-title">'+esc(p.caption||'（無文字內容）')+'</div>'+
        '<div class="tl-meta"><span>@'+esc(p.handle||'')+'</span>'+metricChips(p.metrics)+'</div></article>';
    }
    if (it.type==='ai_event'){
      var e=it.event||{};
      return '<article class="tl-item ai_event">'+
        '<div class="tl-top"><span class="tl-type ai_event">AI 事件</span>'+
        '<span class="ph-sub">'+esc(AI_KIND[e.kind]||e.kind||'')+' · 嚴重度 '+esc(e.severity==null?'—':e.severity)+'</span>'+
        '<span class="tl-when">'+esc(rel(it.at))+'</span></div>'+
        '<div class="tl-title">'+esc(e.summary||'（無摘要）')+'</div>'+
        '<div class="tl-note">AI 生成 · 只產候選，需人工複核後才進告警</div></article>';
    }
    if (it.type==='alert'){
      var a=it.alert||{};
      var sev=Number(a.severity)||1;
      var note=a.desc?'<div class="tl-note">'+esc(a.desc)+'</div>':'';
      return '<article class="tl-item alert'+(sev>=2?' sev2':'')+'">'+
        '<div class="tl-top"><span class="tl-type alert">告警</span>'+
        '<span class="ph-sub">'+esc(AL_KIND[a.kind]||a.kind||'')+' · 嚴重度 '+sev+'</span>'+
        '<span class="tl-when">'+esc(rel(it.at))+'</span></div>'+
        '<div class="tl-title">'+esc(a.title||(AL_KIND[a.kind]||'告警')+' · '+(a.state||'open'))+'</div>'+note+'</article>';
    }
    return '';
  }
  function renderTimeline(note){
    var host=$('personTimeline');
    if (!host) return;
    if (!P.selected){
      host.innerHTML='<div class="tl-empty"><b>統一時間軸</b>選一個人物後，貼文、AI 事件、告警會合併成一條時間軸。</div>';
      return;
    }
    if (note){ host.innerHTML='<div class="tl-empty">'+esc(note)+'</div>'; return; }
    if (!P.items.length && P.loading){ host.innerHTML='<div class="tl-empty">讀取時間軸…</div>'; return; }
    var list=itemsIn();
    if (!list.length){
      host.innerHTML='<div class="tl-empty"><b>沒有符合的紀錄</b>換一個篩選，或這個人物目前只有貼文。</div>';
      return;
    }
    host.innerHTML=list.map(itemHtml).join('');
    var f=$('personFilters');
    if (f){
      Array.prototype.forEach.call(f.querySelectorAll('[data-kind]'),function(b){
        b.setAttribute('aria-pressed', String(b.getAttribute('data-kind')===P.filter));
      });
    }
  }

  /* ---------- 取資料 ---------- */
  function getJSON(url){
    return fetch(BASE+url,{headers:{Accept:'application/json'}}).then(function(r){
      if (!r.ok) throw new Error('HTTP '+r.status);
      return r.json();
    });
  }
  function hashPerson(){
    var m=String((typeof location!=='undefined'&&location.hash)||'').match(/^#\/person\/([0-9A-Za-z._-]+)/);
    return m?m[1]:'';
  }
  function loadTimeline(id){
    var token=++P.tok;
    P.loading=true;
    renderTimeline();
    return getJSON('/api/persons/'+encodeURIComponent(id)+'/timeline').then(function(d){
      if (token!==P.tok) return;
      P.items=(d.items||[]).slice();
      P.at=Date.now();
      P.loading=false;
      renderTimeline(); renderHead();
    }).catch(function(err){
      if (token!==P.tok) return;
      P.loading=false;
      P.items=[];
      renderTimeline('讀不到時間軸：'+(err&&err.message||err));
    });
  }
  function load(force){
    if (P.loading) return Promise.resolve();
    if (P.loaded && !force) return Promise.resolve();
    P.loading=true;
    setStatus('cyan','讀取中…');
    renderList();
    return getJSON('/api/persons').then(function(d){
      P.persons=(d.items||[]).slice();
      P.loaded=true; P.ok=true; P.error='';
      var want=hashPerson();
      if (!want || !personOf(want)) want=P.selected || (P.persons[0]&&P.persons[0].person_id);
      P.selected=want||null;
      P.loading=false;
      setStatus('green','API · '+P.persons.length+' 人');
      renderList(); renderHead();
      return P.selected?loadTimeline(P.selected):renderTimeline();
    }).catch(function(err){
      P.ok=false; P.error=String(err&&err.message||err);
      P.loading=false;
      setStatus('or','後端未連線');
      renderList(); renderHead(); renderTimeline();
      var c=$('personCount'); if (c) c.textContent='—';
    });
  }

  /* ---------- 事件 ---------- */
  function onTopic(name){
    P.active = name==='person';
    if (!P.active) return;
    if (!P.loaded){ load(); return; }
    renderList(); renderHead(); renderTimeline();
    if (P.selected && Date.now()-P.at>60000) loadTimeline(P.selected);
  }
  document.addEventListener('click',function(e){
    var t=e.target;
    if (!t||!t.closest) return;
    var f=t.closest('#personFilters [data-kind]');
    if (f){
      P.filter=f.getAttribute('data-kind');
      renderTimeline();
      return;
    }
    var row=t.closest('#personList [data-pid]');
    if (row){
      var id=row.getAttribute('data-pid');
      if (String(id)!==String(P.selected)){ selectAndLoad(id); }
    }
  });
  function selectAndLoad(id){
    P.selected=id; P.items=[];
    renderList(); renderHead(); renderTimeline();
    loadTimeline(id);
  }
  document.addEventListener('input',function(e){
    if (!e.target||e.target.id!=='personSearch') return;
    P.search=e.target.value||'';
    renderList();
  });
  window.addEventListener('kolindex:api',function(e){
    var d=(e&&e.detail)||{};
    if (d.ok && !P.loaded){ load(); return; }
    if (d.ok && P.active && Date.now()-P.at>90000){ load(true); return; }
    if (!d.ok && P.ok && P.active){ setStatus('or','後端斷線 · 顯示上次結果'); }
  });
  if (typeof MutationObserver!=='undefined' && document.body){
    new MutationObserver(function(){ onTopic(document.body.getAttribute('data-topic')); })
      .observe(document.body,{attributes:true,attributeFilter:['data-topic']});
  }
  onTopic(document.body && document.body.getAttribute('data-topic'));

  window.KOLINDEX_PERSON={
    version:'2026-11-21', state:P, rel:rel, num:num, esc:esc,
    filtered:filtered, itemsIn:itemsIn, personOf:personOf, itemHtml:itemHtml,
    load:load, loadTimeline:loadTimeline, onTopic:onTopic, select:selectAndLoad,
    render:function(){ renderList(); renderHead(); renderTimeline(); }
  };
})();
