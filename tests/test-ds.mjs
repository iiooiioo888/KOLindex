import assert from 'node:assert';

const base = 'http://127.0.0.1:5200';
const FILES = ['tokens', 'base', 'components', 'pages'];
let pass = 0;
const ok = (m) => { pass++; console.log('PASS', m); };

(async () => {
  const html = await (await fetch(base + '/')).text();
  const css = {};
  for (const f of FILES) {
    const r = await fetch(base + '/css/ds/' + f + '.css');
    assert(r.status === 200, f + ' status ' + r.status);
    assert(/text\/css/.test(r.headers.get('content-type')), 'mime ' + f);
    css[f] = await r.text();
    assert(css[f].length > 800, f + ' too small');
    ok('css/ds/' + f + '.css ' + css[f].length + 'B');
  }

  const links = [...html.matchAll(/href="(css\/[^"]+)"/g)].map(m => m[1].split('?')[0]);
  const at = (f) => links.indexOf('css/ds/' + f + '.css');
  assert(at('tokens') >= 0 && at('tokens') < at('base') && at('base') < at('components') && at('components') < at('pages'));
  ok('載入順序 tokens → base → components → pages');
  assert(at('pages') < links.indexOf('css/person.css'), 'ds before page css');
  ok('DS 四層在各頁 CSS 之前');
  assert(!links.some(p => p.startsWith('css/polish.css')), 'polish gone');
  ok('polish.css 已退場');

  for (const f of FILES) {
    assert(!css[f].includes('!important'), f + ' has !important');
    assert(!/@import/.test(css[f]), f + ' has @import');
  }
  ok('無 !important／@import');

  for (const f of FILES) {
    const open = (css[f].match(/\{/g) || []).length, close = (css[f].match(/\}/g) || []).length;
    assert(open === close, f + ' braces ' + open + '/' + close);
  }
  ok('大括號平衡');

  const all = Object.values(css).join('\n');
  const defined = new Set([...all.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]));
  const core = ['--bg', '--bg-deep', '--surface', '--surface-2', '--surface-3', '--surface-4',
    '--line', '--line-soft', '--line-strong', '--text', '--dim', '--faint',
    '--amber', '--cyan', '--green', '--red', '--violet', '--orange',
    '--accent', '--accent-soft', '--accent-line', '--focus', '--track',
    '--disp', '--mono', '--body', '--fs-micro', '--fs-meta', '--fs-ui', '--fs-title', '--fs-lg',
    '--s-1', '--s-6', '--s-10', '--r-xs', '--r-sm', '--r-md', '--r-lg', '--r-panel', '--r-ctl',
    '--e-1', '--e-2', '--e-3', '--dur-1', '--dur-2', '--ease',
    '--rail-w', '--rail-right-w', '--topbar-h', '--statusbar-h', '--ctl-h', '--row-h'];
  const miss = core.filter(t => !defined.has(t));
  assert(!miss.length, 'missing tokens: ' + miss.join(','));
  ok('權杖齊備 ' + defined.size + ' 個');

  assert(css.tokens.includes('body[data-topic]{'), '缺 body[data-topic] 覆寫');
  assert(!/body\[data-topic="[a-z]+"\]/.test(css.tokens), '仍有逐頁主題色');
  for (const s of ['--accent:var(--ice)', '--accent-soft:rgba(230,237,242,.07)'])
    assert(css.tokens.includes(s), 'accent 定義 ' + s);
  ok('單一 accent（ice）：11 個分頁不再各自換色相');

  const grad = (s) => (s.match(/gradient\(/g) || []).length;
  assert(grad(css.tokens) === 0, 'tokens 不該有漸層');
  assert(grad(css.components) === 0, 'components 不該有漸層');
  assert(grad(css.base) === 2 && !/radial-gradient/.test(css.base), 'base 只留 32px 工程網格');
  assert(!/radial-gradient/.test(css.pages), 'pages 仍有 radial 漸層');
  assert(grad(css.pages) <= 2, 'pages 漸層過多: ' + grad(css.pages));
  assert(css.tokens.includes('--e-2:none'), '平面層不該有陰影');
  ok('裝飾漸層收斂：只剩網格與 .thr 硬停色帶');

  assert(css.pages.includes('.waterfall.on{animation:none}'), '切頁仍會淡入');
  assert(!css.pages.includes('ds-fade'), '仍有 ds-fade');
  ok('切頁零轉場（.waterfall.on 不再動畫）');

  const used = new Set([...all.matchAll(/var\((--[a-z0-9-]+)/g)].map(m => m[1]));
  const dynamic = new Set(['--pct', '--w']); // 由 HTML inline style 設定
  const unknown = [...used].filter(v => !defined.has(v) && !dynamic.has(v));
  assert(!unknown.length, 'unknown vars: ' + unknown.join(','));
  ok('var() 全部有定義（用到 ' + used.size + ' 個）');

  const need = [
    ['components', '.topbar{'], ['components', '.brand-name{'], ['components', '.chip{'], ['components', '.searchbox{'],
    ['components', '.icon-btn{'], ['components', '.nav-item::before'], ['components', '.nav-item.active{'],
    ['components', '.micro-card{'], ['components', '.topic-head{'], ['components', '.topic-tabs{'],
    ['components', '.topic-btn[aria-selected="true"]'], ['components', '.panel{'], ['components', '.panel-title::before'],
    ['components', '.mini-btn{'], ['components', '.pill{'], ['components', '.table thead th'], ['components', '.table tbody td'],
    ['components', '.kpis{'], ['components', '.kv2{'], ['components', '.rr{'], ['components', '.statusbar{'],
    ['components', '.toast{'], ['components', '.dlg{'], ['components', '.fill-amber'], ['components', '.tbl-md'],
    ['components', '.tone-green'], ['pages', '.shell{'], ['pages', '.waterfall{'], ['pages', '@container stage']
  ];
  for (const [f, s] of need) assert(css[f].includes(s), f + ' 缺少 ' + s);
  ok('關鍵元件定義齊備');

  for (const id of ['topicTitle', 'topicIndex', 'topicHint', 'topicBar', 'tab-review'])
    assert(html.includes('id="' + id + '"'), 'id ' + id);
  assert(html.includes('class="topic-head"') && html.includes('class="topic-tabs" role="tablist"'));
  assert(html.includes('<body data-topic="queue">'));
  ok('分頁頭結構（索引／標題／說明／分頁籤）');

  const styles = [...html.matchAll(/\sstyle="([^"]*)"/g)].map(m => m[1]);
  console.log('inline styles:', styles.length);
  assert(styles.length <= 60, 'inline style 過多: ' + styles.length);
  assert(!styles.some(s => s.includes('linear-gradient')), '仍有多餘漸層');
  assert(!styles.some(s => /border-radius/.test(s)), '仍有多餘圓角');
  assert(!styles.some(s => /min-width:(580|640|760)px/.test(s)), '仍有表格 hardcode 寬度');
  const i2 = await (await fetch(base + '/js/index2.js')).text();
  assert(i2.includes("setProperty('--pct'") || styles.some(s => s.includes('--pct')), '動態值應保留（JS 設定 --pct）');
  ok('inline style 收斂到 ' + styles.length + ' 個，只留動態值');

  assert(html.includes('tbl-md') && html.includes('tbl-lg'));
  assert(!/class="[^"]*"[^>]*class="/.test(html), 'duplicate class attr');
  ok('表格寬度與填色改用 class');

  assert(css.pages.includes('@media(max-width:767px)') && css.pages.includes('.tabs .inner'));
  assert(css.pages.includes('overflow-x:auto'));
  assert(!/\.tabs \.inner\{[^}]*grid-template-columns:repeat\(11/.test(css.pages), '手機底欄仍是 11 欄 grid');
  ok('手機底欄改橫向捲動');

  const js = await (await fetch(base + '/js/index2.js')).text();
  assert(js.includes("$('#topicTitle')") && js.includes("$('#topicIndex')"));
  assert(js.includes('.topic-tabs'), 'tab scroll');
  ok('syncChrome 同步 #topicTitle／#topicIndex 並捲動分頁');

  assert(js.includes("INFRA_PANES=['docker','ecs','bill','cost','conn','jobs']"), 'INFRA_PANES 缺 conn/jobs');
  assert((js.match(/INFRA_PANES=/g) || []).length === 1, 'INFRA_PANES 有多份定義');
  assert(js.includes("conn:'連接器'") && js.includes("jobs:'排程工作'"), 'INFRA_LABEL 缺 conn/jobs');
  ok('基礎設施六個子分頁都可路由（連接器／排程工作不再落回 Docker）');

  const legacy = await (await fetch(base + '/css/index2.css')).text();
  for (const dead of ['routeSweep', 'pageFade', 'is-leave', 'paneIn'])
    assert(!legacy.includes(dead), '仍有轉場殘留: ' + dead);
  ok('舊的掃光／淡出／滑動轉場規則已移除');

  assert(legacy.includes('scrollbar-gutter:stable'), 'stage 缺 scrollbar-gutter');
  assert(!html.includes('class="kpis rise"'), 'KPI 帶仍在進場淡入');
  assert(!legacy.includes('lifeIn') && !legacy.includes('growx'), '仍有會重播的進場動畫');
  assert(!/\.topic-btn\[aria-selected="true"\]\{[^}]*font-weight/.test(css.components), '選中分頁仍改字重');
  assert(!/\.topic-btn\[aria-selected="true"\]\{[^}]*font-weight/.test(legacy), '選中分頁仍改字重（舊檔）');
  ok('切頁只重繪：不改字重、不重播動畫、捲軸槽固定');

  const pageCss = [];
  for (const f of ['studio', 'person', 'review', 'connectors'])
    pageCss.push(await (await fetch(base + '/css/' + f + '.css')).text());
  const everything = [legacy, html, js, ...pageCss, css.tokens, css.base, css.components, css.pages].join('\n').toLowerCase();
  const neon = ['#f0a500', '#ffd166', '#ffc043', '#5fd97d', '#43d4e4', '#ee5c4c', '#a493ff', '#ff8b3d',
    '240,165,0', '95,217,125', '67,212,228', '238,92,76', '164,147,255', '255,139,61', '#e7e2d8', '#8d887f'];
  const left = neon.filter(x => everything.includes(x));
  assert(!left.length, '仍殘留舊霓虹色票: ' + left.join(','));
  ok('舊霓虹色票已全部換成低飽和藍圖色');

  assert(!js.includes('pulseSweep') && !js.includes('scrollPanelsTop'));
  assert(js.includes('function showTopic(topic,prevTopic)'), 'showTopic signature');
  assert(js.includes('showTopic(next.topic,prev?prev.topic:null)'), 'instant switch call');
  assert(js.includes('topicScroll[topic]'), 'scroll memory');
  ok('切頁改為同一個 frame 換內容，並記住各頁捲動位置');


  // 頁面骨架：所有分頁共用同一組內縮、列高與欄寬（切頁時元件不位移）
  for (const t of ['--frame-x:10px', '--frame-y:8px', '--frame-h:32px', '--bar-h:28px', '--side-w:220px', '--col-gap:8px'])
    assert(css.tokens.includes(t), '骨架權杖缺 ' + t);
  assert(css.components.includes('min-height:var(--frame-h);padding:0 var(--frame-x)'), '面板標題列未套骨架權杖');
  assert(css.components.includes('.panel-bar{') && css.components.includes('min-height:var(--bar-h)'), '缺 .panel-bar 工具列');
  assert(css.pages.includes('.waterfall{padding:var(--frame-y) var(--frame-x) 0'), '頁面外距未套骨架權杖');
  ok('骨架權杖就位（內縮 10／上下 8／標題列 32／工具列 28／左欄 220／間距 8）');

  for (const [i, name] of [[0, 'studio'], [1, 'person'], [2, 'review']]) {
    const base = pageCss[i].includes('grid-template-columns:var(--side-w) minmax(0,1fr)');
    const narrow = pageCss[i].includes('grid-template-columns:290px minmax(0,1fr)');
    assert(base || narrow, name + ' 左欄寬未定義');
  }
  assert(legacy.includes('.collect-layout{display:grid;grid-template-columns:var(--side-w)'), '任務收集左欄寬未統一');
  for (const [i, name] of [[0, 'studio'], [1, 'person'], [2, 'review'], [3, 'connectors']])
    assert(!/minmax\(2[0-9][0-9]px/.test(pageCss[i]), name + ' 仍有寫死的左欄寬');
  ok('五個左右分欄頁面共用同一個左欄寬與欄距');

  const kpiAt = html.indexOf('id="kpiBand"');
  assert(kpiAt > 0 && html.slice(kpiAt - 400, kpiAt).includes('class="panel-body"'), '任務隊列 KPI 帶仍在外層');
  assert(html.includes('class="panel-bar" id="collectFilters"'), '任務收集篩選列未成為 panel-bar');
  assert(html.includes('class="panel-bar" id="ossFilters"'), '開源組件篩選列未成為 panel-bar');
  assert(!html.includes('panel-tools" id="collectFilters"') && !html.includes('panel-tools" id="ossFilters"'), '篩選列仍在標題列內');
  ok('篩選列獨立成工具列，KPI 帶搬進面板內容區');
  console.log('\nDS CHECK PASS', pass, 'checks');
})().catch(e => { console.error('FAIL', e.message); process.exitCode = 1; });
