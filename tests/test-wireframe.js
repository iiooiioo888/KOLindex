const path = require('path');
const WF = require(path.join(__dirname, '..', 'js', 'wireframe.js'));
const assert = require('assert');

// 1) demo
const demo = WF.render(WF.demo());
assert(demo.includes('class="wf-page"'), 'page wrapper');
assert(demo.includes('t-header'), 'header rendered');
const leafCount = (demo.match(/class="wf-node /g) || []).length;
console.log('demo: html', demo.length, 'nodes', leafCount);

// 2) 亂七八糟的 LLM 回傳
const messy = {
  title: '測試 <script>alert(1)</script>',
  root: { type: 'page', children: [
    { type: 'HEADER', label: '頂部', cols: [ { type: 'nav', label: '選單', span: 9 }, { type: 'avatar', span: 2 } ] },
    { type: 'weird-kind', label: '互動趨勢圖' },
    { label: '沒有 type 但有子節點', items: [ { type: 'kpi' }, { type: 'kpi', span: 99 } ] },
    null,
    '純字串節點',
    { type: 'table', span: '7', h: '9999' }
  ] }
};
const d = WF.normalize(messy);
console.log('normalized:', JSON.stringify(d.nodes.map(n => [n.type, n.span, n.h, n.cols.length])));
const html = WF.render(messy);
console.log('xss escaped:', !html.includes('<script>'), 'amp:', html.includes('&lt;script&gt;'));

// 3) 空 / 壞輸入
[demo, html, WF.render(null), WF.render({ nodes: [] }), WF.render('x')].forEach((h, i) => {
  assert(h.length > 200, 'render ' + i + ' non-empty');
  assert(!/undefined|NaN|\[object/.test(h), 'render ' + i + ' has no undefined/NaN: ' + h.slice(0, 80));
  assert((h.match(/<div/g) || []).length === (h.match(/<\/div>/g) || []).length, 'render ' + i + ' balanced divs');
});

// 4) span 夾限
assert(WF.normalize({ nodes: [{ type: 'kpi', span: 99 }] }).nodes[0].span === 12);
assert(WF.normalize({ nodes: [{ type: 'kpi', span: 0 }] }).nodes[0].span === 1);
// 5) 深層剪枝
let deep = { type: 'card', cols: [] }, cur = deep;
for (let i = 0; i < 8; i++) { const n = { type: 'card', cols: [] }; cur.cols.push(n); cur = n; }
const dd = WF.render({ nodes: [deep] });
console.log('deep depth-limited ok:', dd.length > 100);
// 6) 子節點上限
const wide = { nodes: [{ type: 'card', cols: new Array(30).fill({ type: 'text' }) }] };
assert(WF.normalize(wide).nodes[0].cols.length === 6);
console.log('ALL PASS');
