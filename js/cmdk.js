/* KOLindex · 本機快速切換（⌘K / Ctrl+K）
 * 只做導覽與唯讀查詢：分頁、作者、作品、幾個本機動作。
 * 不寫資料庫，不改任何分頁的狀態；作品與作者都用既有端點。
 */
(function(){
  'use strict';
  var BASE=(typeof window!=='undefined'&&window.KOLINDEX_BASE)||'';
  var RECENT_KEY='kolindex.cmd.recent.v1';
  var C={open:false,q:'',items:[],sel:0,timer:0,tok:0,loading:false,prev:null};

  var FALLBACK=[
    {key:'collect',label:'任務收集',group:'工作',hint:'待歸戶帳號的認領與退回'},
    {key:'queue',label:'任務隊列',group:'工作',hint:'爬蟲、審核、席位工單'},
    {key:'seat',label:'席位 Agent',group:'工作',hint:'8 席 worker pool 與最近工單'},
    {key:'review',label:'審核',group:'工作',hint:'F2 歸戶候選的人工裁決'},
    {key:'person',label:'人物',group:'內容',hint:'抖音作者索引與作品'},
    {key:'library',label:'素材',group:'內容',hint:'本機抖音媒體索引'},
    {key:'out',label:'產出',group:'內容',hint:'任務產物'},
    {key:'health',label:'健康',group:'監控',hint:'服務與元件健康'},
    {key:'infra',label:'基礎設施',group:'監控',hint:'容器、排程、連接器'},
    {key:'oss',label:'開源',group:'監控',hint:'開源組件清單'},
    {key:'pipe',label:'管線',group:'工具',hint:'統一管線'},
    {key:'sense',label:'感測',group:'工具',hint:'抖音近 30 日聚合'},
    {key:'studio',label:'線框',group:'工具',hint:'LLM 生成線框圖'}
  ];

  function $(id){ return document.getElementById(id); }
  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function norm(s){ return String(s==null?'':s).toLowerCase(); }
  function ui(){ return window.KOLINDEX_UI||null; }

  function topicList(){
    var b=ui();
    if (b&&typeof b.topics==='function'){
      try { var t=b.topics(); if (Array.isArray(t)&&t.length) return t; } catch(e){}
    }
    return FALLBACK;
  }

  function readRecent(){
    try { var a=JSON.parse(localStorage.getItem(RECENT_KEY)||'[]'); return Array.isArray(a)?a.filter(function(x){return typeof x==='string'&&x;}).slice(0,5):[]; }
    catch(e){ return []; }
  }
  function pushRecent(key){
    try {
      var a=readRecent().filter(function(x){ return x!==key; });
      a.unshift(key);
      localStorage.setItem(RECENT_KEY,JSON.stringify(a.slice(0,5)));
    } catch(e){}
  }

  function setTopic(key){
    var b=ui();
    if (!b||typeof b.setTopic!=='function') return;
    b.setTopic(key);
    pushRecent(key);
  }

  function action(label,hint,icon,fn){
    return {group:'動作',label:label,hint:hint,icon:icon,run:fn};
  }
  function actions(){
    return [
      action('重新連線後端','立即重跑 /api/collect 與 /api/alerts','↻',function(){
        if (window.KOLINDEX_API&&KOLINDEX_API.retry) KOLINDEX_API.retry();
        else location.reload();
      }),
      action('重新載入整頁','套用最新版前端資產','⟳',function(){ location.reload(); }),
      action('切換像素模式','套用 pixel.css 的復古配色','▦',function(){ var b=$('pixelBtn'); if(b) b.click(); }),
      action('切換減少動畫','降低畫面動態，適合長時間掛著','◐',function(){ var b=$('motionBtn'); if(b) b.click(); }),
      action('暫停畫面更新','停止輪詢與自動刷新','❚❚',function(){ var b=$('pauseBtn'); if(b) b.click(); }),
      action('複製本頁連結','把目前 hash 路由複製到剪貼簿','⧉',function(){
        var url=location.href;
        try {
          if (navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(function(){ if(ui()&&ui().toast) ui().toast('已複製連結'); });
          else if(ui()&&ui().toast) ui().toast(url);
        } catch(e){ if(ui()&&ui().toast) ui().toast(url); }
      }),
      action('登出','回到登入畫面','⎋',function(){
        if (window.KOLINDEX_LOGIN&&KOLINDEX_LOGIN.logout) KOLINDEX_LOGIN.logout();
        else location.reload();
      })
    ];
  }

  function staticItems(q){
    var out=[], seen={}, n=norm(q);
    var recent=readRecent();
    var topics=topicList();
    if (!n){
      recent.forEach(function(key){
        var t=topics.filter(function(x){ return x.key===key; })[0];
        if (!t||seen[key]) return;
        seen[key]=1;
        out.push({group:'最近',label:t.label,hint:t.hint||'',icon:'近',key:key,run:function(){ setTopic(key); }});
      });
    }
    topics.forEach(function(t){
      if(seen[t.key]) return;
      var hay=norm(t.key+' '+t.label+' '+(t.hint||''));
      if (n&&hay.indexOf(n)<0) return;
      out.push({group:'分頁',label:t.label||t.key,hint:t.hint||'',icon:'頁',meta:t.group||'',key:t.key,run:function(){ setTopic(t.key); }});
    });
    actions().forEach(function(a){
      var hay=norm(a.label+' '+a.hint);
      if (n&&hay.indexOf(n)<0) return;
      out.push(a);
    });
    return out;
  }

  function afterTopic(topic, fn){
    var u=ui();
    if(u&&u.setTopic) u.setTopic(topic);
    var wait=u&&u.whenTopic;
    if(wait) wait(topic).then(function(){ setTimeout(fn, 0); });
    else setTimeout(fn, 260);
  }

  function req(path){
    if (window.KOL&&KOL.requestStatus){
      return KOL.requestStatus(path).then(function(r){ return r&&r.ok?r.data:null; },function(){ return null; });
    }
    return fetch(BASE+path,{credentials:'same-origin',cache:'no-store'}).then(function(r){
      return r.ok?r.json():null;
    }).catch(function(){ return null; });
  }

  function dataItems(q,tok){
    C.loading=true;
    if (C.open) render();
    var pathA='/api/library/authors?q='+encodeURIComponent(q)+'&limit=5&sort=count';
    var pathW='/api/library?q='+encodeURIComponent(q)+'&limit=6&sort=recent';
    return Promise.all([req(pathA),req(pathW)]).then(function(res){
      if (tok!==C.tok||!C.open) return;
      var out=[];
      var a=res[0]&&res[0].items;
      if (Array.isArray(a)){
        a.slice(0,5).forEach(function(x){
          var name=x.author==='unnamed'?'未命名':x.author;
          out.push({group:'作者',label:name,hint:(x.works||0)+' 件 · '+(x.files||0)+' 檔',icon:'人',meta:(x.gallery||0)+'/'+(x.video||0),run:function(){
            afterTopic('person', function(){ if(window.KOLINDEX_PERSON&&KOLINDEX_PERSON.openAuthor) KOLINDEX_PERSON.openAuthor(x.author); });
          }});
        });
      }
      var w=res[1]&&res[1].items;
      if (Array.isArray(w)){
        w.slice(0,6).forEach(function(x){
          var cap=String(x.caption||'').replace(/\s+/g,' ').trim();
          if(!cap) cap='未命名';
          out.push({group:'作品',label:cap,hint:(x.author==='unnamed'?'未命名':x.author)+' · '+(x.published_at||'').slice(0,10),icon:'作',meta:x.kind==='video'?'影片':'圖集',run:function(){
            afterTopic('library', function(){ if(window.KOLINDEX_LIBRARY&&KOLINDEX_LIBRARY.openViewer) KOLINDEX_LIBRARY.openViewer(x.id); });
          }});
        });
      }
      C.loading=false;
      C.items=staticItems(q).concat(out);
      C.sel=0;
      render();
    });
  }

  function render(){
    var list=$('cmdkList'), empty=$('cmdkEmpty'), foot=$('cmdkFoot');
    if(!list) return;
    var html='', group='';
    C.items.forEach(function(it,idx){
      if(it.group!==group){ group=it.group; html+='<div class="cmdk-h">'+esc(group)+'</div>'; }
      html+='<div class="cmdk-item" role="option" data-idx="'+idx+'" aria-selected="'+(idx===C.sel?'true':'false')+'">';
      html+='<span class="cmdk-ic">'+esc(it.icon||'·')+'</span>';
      html+='<span class="cmdk-main"><span class="cmdk-label">'+esc(it.label)+'</span><span class="cmdk-hint">'+esc(it.hint||'')+'</span></span>';
      html+='<span class="cmdk-meta">'+esc(it.meta||'')+'</span>';
      html+='</div>';
    });
    list.innerHTML=html;
    if(empty) empty.hidden=C.items.length>0;
    if(foot) foot.textContent=(C.loading?'搜尋中 · ':'')+C.items.length+' 個結果';
    var cur=list.querySelector('[data-idx="'+C.sel+'"]');
    if(cur&&cur.scrollIntoView) cur.scrollIntoView({block:'nearest'});
  }

  function select(idx){
    if(!C.items.length) return;
    C.sel=Math.max(0,Math.min(C.items.length-1,idx));
    var list=$('cmdkList');
    if(!list) return;
    Array.prototype.forEach.call(list.querySelectorAll('.cmdk-item'),function(el){
      el.setAttribute('aria-selected',Number(el.getAttribute('data-idx'))===C.sel?'true':'false');
    });
    var cur=list.querySelector('[data-idx="'+C.sel+'"]');
    if(cur&&cur.scrollIntoView) cur.scrollIntoView({block:'nearest'});
  }

  function run(it){
    if(!it||typeof it.run!=='function') return;
    close();
    setTimeout(function(){ try{ it.run(); }catch(e){ if(ui()&&ui().toast) ui().toast('動作失敗：'+String(e&&e.message||e)); } },0);
  }

  function setQuery(q){
    C.q=String(q||'');
    C.sel=0;
    C.tok+=1;
    C.loading=false;
    C.items=staticItems(C.q);
    render();
    if(C.timer) clearTimeout(C.timer);
    var term=C.q.trim();
    if(term.length>=2){
      var tok=C.tok;
      C.timer=setTimeout(function(){ dataItems(term,tok); },180);
    }
  }

  function open(){
    if(C.open) return;
    var box=$('cmdk');
    if(!box) return;
    C.open=true;
    C.prev=document.activeElement;
    box.hidden=false;
    document.body.setAttribute('data-cmdk-open','1');
    var input=$('cmdkInput');
    if(input){ input.value=''; }
    setQuery('');
    setTimeout(function(){ if(input){ input.focus(); input.select(); } },0);
  }

  function close(){
    if(!C.open) return;
    C.open=false;
    var box=$('cmdk');
    if(box) box.hidden=true;
    document.body.removeAttribute('data-cmdk-open');
    if(C.timer) clearTimeout(C.timer);
    C.timer=0;
    C.tok+=1;
    var prev=C.prev;
    C.prev=null;
    if(prev&&prev.focus&&document.documentElement.contains(prev)){ try{ prev.focus(); }catch(e){} }
  }

  function toggle(){ C.open?close():open(); }

  function bind(){
    var trigger=$('cmdkOpen');
    if(trigger) trigger.addEventListener('click',function(e){ e.preventDefault(); e.stopPropagation(); open(); });
    var box=$('cmdk');
    if(box){
      box.addEventListener('mousedown',function(e){ if(e.target===box) close(); });
    }
    var list=$('cmdkList');
    if(list){
      list.addEventListener('click',function(e){
        var el=e.target.closest?e.target.closest('.cmdk-item'):null;
        if(!el) return;
        var idx=Number(el.getAttribute('data-idx'));
        if(isFinite(idx)) run(C.items[idx]);
      });
      list.addEventListener('mouseover',function(e){
        var el=e.target.closest?e.target.closest('.cmdk-item'):null;
        if(!el) return;
        var idx=Number(el.getAttribute('data-idx'));
        if(isFinite(idx)&&idx!==C.sel) select(idx);
      });
    }
    var input=$('cmdkInput');
    if(input){
      input.addEventListener('input',function(){ setQuery(input.value); });
      input.addEventListener('keydown',function(e){
        if(e.isComposing||e.keyCode===229) return;
        if(e.key==='ArrowDown'){ e.preventDefault(); select(C.sel+1); }
        else if(e.key==='ArrowUp'){ e.preventDefault(); select(C.sel-1); }
        else if(e.key==='Home'){ e.preventDefault(); select(0); }
        else if(e.key==='End'){ e.preventDefault(); select(C.items.length-1); }
        else if(e.key==='Enter'){ e.preventDefault(); run(C.items[C.sel]); }
        else if(e.key==='Escape'){ e.preventDefault(); close(); }
      });
    }
    document.addEventListener('keydown',function(e){
      var mod=e.metaKey||e.ctrlKey;
      if(mod&&(e.key==='k'||e.key==='K')){ e.preventDefault(); toggle(); return; }
      if(!C.open) return;
      if(e.key==='Escape'){ e.preventDefault(); close(); }
    });
    var kbd=$('cmdkOpen');
    if(kbd){
      var mac=/Mac|iPhone|iPad/i.test(navigator.platform||'');
      kbd.textContent=mac?'⌘K':'Ctrl K';
      kbd.title='快速切換（'+(mac?'⌘K':'Ctrl+K')+'）：分頁、作者、作品';
      kbd.setAttribute('aria-label','快速切換（'+(mac?'Command+K':'Ctrl+K')+'）');
    }
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',bind);
  else bind();

  window.KOLINDEX_CMDK={version:'1.0.0',state:C,open:open,close:close,toggle:toggle,select:select,run:run,setQuery:setQuery,filter:staticItems,render:render};
})();
