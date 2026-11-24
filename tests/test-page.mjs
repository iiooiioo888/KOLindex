import assert from 'node:assert';
(async () => {
  const base = 'http://127.0.0.1:5200';
  const html = await (await fetch(base + '/')).text();
  const files = ['/js/index2.js', '/js/api.js', '/js/wireframe.js', '/js/studio.js', '/js/person.js', '/js/review.js', '/js/infra.js', '/js/jobs.js', '/js/library.js', '/css/index2.css', '/css/studio.css', '/css/person.css', '/css/review.css', '/css/connectors.css', '/css/jobs.css', '/css/library.css',
    '/css/ds/tokens.css', '/css/ds/base.css', '/css/ds/components.css', '/css/ds/pages.css'];
  for (const f of files) {
    const r = await fetch(base + f);
    console.log(f.padEnd(20), r.status, r.headers.get('content-type'), (await r.text()).length + 'B');
    assert(r.status === 200, f);
    assert(/javascript|text\/css/.test(r.headers.get('content-type')), 'mime ' + f);
  }

  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
  console.log('html ids:', ids.size);

  const need = ['topic-studio', 'tab-studio', 'llmStatus', 'studioCount', 'studioForm', 'studioPrompt',
    'studioDevice', 'studioDensity', 'studioPresets', 'studioGo', 'studioHint', 'studioViews',
    'studioDemo', 'studioCopy', 'studioStage', 'studioJson'];
  const missing = need.filter(id => !ids.has(id));
  console.log('missing ids:', missing.length ? missing : 'none');
  assert(!missing.length);

  const studioJs = await (await fetch(base + '/js/studio.js')).text();
  const refs = [...studioJs.matchAll(/\$\('#([A-Za-z0-9_-]+)'/g)].map(m => m[1]);
  const dangling = [...new Set(refs)].filter(id => !ids.has(id));
  console.log('studio.js id refs:', new Set(refs).size, 'dangling:', dangling.length ? dangling : 'none');
  assert(!dangling.length);

  // 設計系統四層：index2.css 之後、各頁 CSS 之前，順序固定
  const cssLinks = [...html.matchAll(/href="(css\/[^"]+)"/g)].map(m => m[1].split('?')[0]);
  console.log('css order:', cssLinks.join(' -> '));
  const dsOrder = ['css/index2.css', 'css/ds/tokens.css', 'css/ds/base.css', 'css/ds/components.css', 'css/ds/pages.css'];
  const dsPos = dsOrder.map(p => cssLinks.indexOf(p));
  console.log('ds order positions:', dsPos.join(','));
  assert(dsPos.every(i => i >= 0), 'ds files linked');
  assert(dsPos.join(',') === [...dsPos].sort((a, b) => a - b).join(','), 'ds order tokens->base->components->pages');
  assert(!cssLinks.some(p => p.startsWith('css/polish.css')), 'polish.css removed');

  // 分頁註冊
  const idx = await (await fetch(base + '/js/index2.js')).text();
  assert(idx.includes("'oss','studio'"), 'TOPICS');
  assert(idx.includes('studio:{label:'), 'TOPIC_META');
  assert(html.includes('data-topic="studio"'), 'nav/tab');
  assert((html.match(/id="topic-studio"/g) || []).length === 1, 'single section');
  assert(html.includes('css/studio.css'), 'css link');
  assert(html.includes('js/wireframe.js') && html.includes('js/studio.js'), 'script tags');
  console.log('topic wiring: ok');

  // 人物檔案分頁
  const perNeed = ['topic-person', 'tab-person', 'pnStatus', 'pnCount', 'pnKpis', 'pnSearch', 'pnSort',
    'pnReset', 'pnList', 'pnMore', 'pnFoot', 'pnSide', 'navPersonBd'];
  const perMissing = perNeed.filter(id => !ids.has(id));
  console.log('person ids missing:', perMissing.length ? perMissing : 'none');
  assert(!perMissing.length);
  assert(idx.includes("'studio','person'"), 'TOPICS person');
  assert(idx.includes('person:{label:'), 'TOPIC_META person');
  assert(!idx.includes("'authors'") && !idx.includes('authors:{label:'), 'authors 分頁已移除');
  assert(html.includes('css/person.css') && html.includes('js/person.js'), 'person assets');
  assert(!html.includes('css/authors.css') && !html.includes('js/authors.js'), 'authors 資產已移除');
  assert(html.indexOf('css/library.css') < html.indexOf('css/person.css'), 'person.css after library.css');
  assert(html.indexOf('js/library.js') < html.indexOf('js/person.js'), 'person.js after library.js');
  assert((html.match(/data-topic="person"/g) || []).length >= 3, 'nav + tab + mobile tab');
  const personJs = await (await fetch(base + '/js/person.js')).text();
  const pRefs = [...personJs.matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)].map(m => m[1]);
  const pDangling = [...new Set(pRefs)].filter(id => !ids.has(id));
  console.log('person.js id refs:', new Set(pRefs).size, 'dangling:', pDangling.length ? pDangling : 'none');
  assert(!pDangling.length);
  assert(personJs.includes("'/api/library/authors?") && personJs.includes("'/api/library?author='")
    && personJs.includes("'/api/library/months?"), 'person endpoints 3');
  assert(personJs.includes('KOLINDEX_PERSON') && personJs.includes('monthsHtml'), 'person wiring');
  const apiJs = await (await fetch(base + '/js/api.js')).text();
  assert(apiJs.includes("'kolindex:api'"), 'api event');
  console.log('person wiring: ok');

  // 審核台分頁（第一條寫入路徑）
  const revNeed = ['topic-review', 'tab-review', 'reviewStatus', 'reviewCounts', 'reviewModes',
    'reviewOpenN', 'reviewAiN', 'reviewList', 'reviewDetail', 'reviewLog'];
  const revMissing = revNeed.filter(id => !ids.has(id));
  console.log('review ids missing:', revMissing.length ? revMissing : 'none');
  assert(!revMissing.length);
  assert(idx.includes("'person','review'"), 'TOPICS review');
  assert(idx.includes('review:{label:'), 'TOPIC_META review');
  assert(html.includes('css/review.css') && html.includes('js/review.js'), 'review assets');
  assert((html.match(/data-topic="review"/g) || []).length >= 3, 'nav + tab + mobile tab');
  const reviewJs = await (await fetch(base + '/js/review.js')).text();
  const rRefs = [...reviewJs.matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)].map(m => m[1]);
  const rDangling = [...new Set(rRefs)].filter(id => !ids.has(id));
  console.log('review.js id refs:', new Set(rRefs).size, 'dangling:', rDangling.length ? rDangling : 'none');
  assert(!rDangling.length);
  assert(reviewJs.includes("'kolindex:api'") && reviewJs.includes('verdict'), 'review wiring');
  assert(idx.includes('confirm:function') && idx.includes('toast:function'), 'KOLINDEX_UI.confirm/toast 已匯出');
  console.log('review wiring: ok');

  // 任務收集的寫入路徑（第二條寫入路徑：認領／退回）
  const colNeed = ['collectKpis', 'collectList', 'collectFilters', 'collectSource', 'collectForm', 'navCollectBd'];
  const colMissing = colNeed.filter(id => !ids.has(id));
  console.log('collect ids missing:', colMissing.length ? colMissing : 'none');
  assert(!colMissing.length);
  assert(idx.includes('data-collect-claim') && idx.includes('data-collect-return'), 'collect 認領／退回按鈕');
  assert(idx.includes("fetch('/api/collect/'"), 'collect 寫入端點');
  assert(idx.includes('apiCollectWrite'), 'collect 寫入函式');
  assert(idx.includes("STATE_MAP={inbox:'inbox',claimed:'queued',returned:'skip'}"), 'collect 狀態對照');
  const collectApiSrc = await (await fetch(base + '/js/api.js')).text();
  assert(collectApiSrc.includes('accountId: x.accountId'), 'api.js 帶 accountId 到前端');
  console.log('collect wiring: ok');

  // 基礎設施 → 連接器（唯讀真資料）
  const connNeed = ['topic-infra', 'itab-conn', 'pane-conn', 'connSummary', 'connBody', 'connStatus', 'connChip', 'connTabN'];
  const connMissing = connNeed.filter(id => !ids.has(id));
  console.log('connector ids missing:', connMissing.length ? connMissing : 'none');
  assert(!connMissing.length);
  assert(html.includes('css/connectors.css') && html.includes('js/infra.js'), 'connector assets');
  const connJs = await (await fetch(base + '/js/infra.js')).text();
  const cRefs = [...connJs.matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)].map(m => m[1]);
  const cDangling = [...new Set(cRefs)].filter(id => !ids.has(id));
  console.log('infra.js id refs:', new Set(cRefs).size, 'dangling:', cDangling.length ? cDangling : 'none');
  assert(!cDangling.length);
  assert(connJs.includes("'/api/health/connectors'") && connJs.includes("'kolindex:api'"), 'connector wiring');
  console.log('connector wiring: ok');

  // 基礎設施 → 排程工作（唯讀真資料）
  const jobsNeed = ['itab-jobs', 'pane-jobs', 'jobsSummary', 'jobsFilters', 'jobsBody', 'jobsStatus', 'jobsTabN'];
  const jobsMissing = jobsNeed.filter(id => !ids.has(id));
  console.log('jobs ids missing:', jobsMissing.length ? jobsMissing : 'none');
  assert(!jobsMissing.length);
  assert(html.includes('css/jobs.css') && html.includes('js/jobs.js'), 'jobs assets');
  const jobsJs = await (await fetch(base + '/js/jobs.js')).text();
  const jRefs = [...jobsJs.matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)].map(m => m[1]);
  const jDangling = [...new Set(jRefs)].filter(id => !ids.has(id));
  console.log('jobs.js id refs:', new Set(jRefs).size, 'dangling:', jDangling.length ? jDangling : 'none');
  assert(!jDangling.length);
  assert(jobsJs.includes("'/api/jobs?state='") && jobsJs.includes("'kolindex:api'"), 'jobs wiring');
  const jobStates = (html.match(/id="jobsFilters"[\s\S]*?<\/div>/) || [''])[0].match(/data-state="[a-z_]+"/g) || [];
  assert(jobStates.length === 9, 'jobs filters 9');
  console.log('jobs wiring: ok');

  // 素材庫（抖音點讚／收藏，唯讀真資料）
  const libNeed = ['topic-library', 'tab-library', 'libStatus', 'libCount', 'libKpis', 'libSearch', 'libKind',
    'libSource', 'libSort', 'libReset', 'libGrid', 'libMore', 'libFoot', 'libViewer', 'libMedia', 'libViewHead',
    'libViewBody', 'libThumbs', 'libPrev', 'libNext', 'libClose', 'libCounter', 'libMode', 'libASort',
    'libAuthorChip', 'libAuthorName', 'libAuthorClear',
    'libMyLike', 'libMyLikeDot', 'libMyLikePanel', 'libDownloadMissing', 'mlConn', 'mlCards', 'mlPages', 'mlWake', 'mlRefresh',
    'mlProg', 'mlBar', 'mlProgText', 'mlFolderCount', 'mlFolders', 'mlRuns', 'mlClose'];
  const libMissing = libNeed.filter(id => !ids.has(id));
  console.log('library ids missing:', libMissing.length ? libMissing : 'none');
  assert(!libMissing.length);
  assert(html.includes('css/library.css') && html.includes('js/library.js'), 'library assets');
  const libJs = await (await fetch(base + '/js/library.js')).text();
  const lRefs = [...libJs.matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)].map(m => m[1]);
  // libCopyPath / libViewAuthor / libDownload 由 paintViewer() 動態塞進 #libViewBody，不是靜態 id。
  const libDynamicIds = ['libCopyPath', 'libViewAuthor', 'libDownload'];
  const lDangling = [...new Set(lRefs)].filter(id => !ids.has(id) && !libDynamicIds.includes(id));
  console.log('library.js id refs:', new Set(lRefs).size, 'dangling:', lDangling.length ? lDangling : 'none');
  assert(!lDangling.length);
  assert(libJs.includes("'/api/library?'") && libJs.includes("'/api/library/'"), 'library endpoints');
  assert(libJs.includes("'/api/library/authors?") && libJs.includes('displayAuthor'), 'library authors endpoint');
  const modes = (html.match(/id="libMode"[\s\S]*?<\/div>/) || [''])[0].match(/data-mode="[a-z]+"/g) || [];
  const asorts = (html.match(/id="libASort"[\s\S]*?<\/select>/) || [''])[0].match(/value="[a-z]+"/g) || [];
  assert(modes.length === 2 && asorts.length === 3, 'library mode 2 / author sort 3');
  assert(libJs.includes("'kolindex:api'") && libJs.includes('KOLINDEX_LIBRARY'), 'library wiring');
  assert(libJs.includes("'/download'") && libJs.includes('downloadMissing') && libJs.includes("'/api/library/download'"), 'library download wiring');
  assert(libJs.includes("rel.indexOf('media/')===0"), 'library media path strips duplicate media');
  assert(idx.includes("typeof bar!=='number'"), 'queue bars skip null values');
  const kinds = (html.match(/id="libKind"[\s\S]*?<\/div>/) || [''])[0].match(/data-kind="[a-z]+"/g) || [];
  const srcs = (html.match(/id="libSource"[\s\S]*?<\/div>/) || [''])[0].match(/data-source="[a-z]+"/g) || [];
  assert(kinds.length === 3 && srcs.length === 3, 'library filters 3/3');
  assert((html.match(/data-topic="library"/g) || []).length >= 3, 'library nav + tab + mobile tab');
  console.log('library wiring: ok');

  // 結構平衡：分頁少一個 </section> 會讓後面的分頁整頁消失
  const cnt = (re) => (html.match(re) || []).length;
  assert(cnt(/<section\b/g) === cnt(/<\/section>/g), 'section 開閉平衡 ' + cnt(/<section\b/g) + '/' + cnt(/<\/section>/g));
  assert(cnt(/<div\b/g) === cnt(/<\/div>/g), 'div 開閉平衡 ' + cnt(/<div\b/g) + '/' + cnt(/<\/div>/g));
  const personAt = html.indexOf('id="topic-person"');
  const reviewAt = html.indexOf('id="topic-review"');
  const personClose = html.indexOf('</section>', personAt);
  assert(personAt > 0 && reviewAt > personAt && personClose > 0 && personClose < reviewAt, 'person 分頁在 review 之前收尾');
  console.log('structure: ok');

  // 無金鑰時的行為
  const st = await (await fetch(base + '/__llm/status')).json();
  console.log('status:', JSON.stringify(st));
  const post = await fetch(base + '/__llm', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) });
  const body = await post.text();
  console.log('no-key POST →', post.status, body.slice(0, 120));
  assert(post.status === 503 && body.includes('LLM_API_KEY'));
  console.log('STATIC CHECK PASS');
})();