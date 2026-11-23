// test-caps.mjs — 前端是否依 caps 收起沒有權限的寫入控制（純靜態，不開瀏覽器）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '..');
const html = fs.readFileSync(path.resolve(ROOT, 'index2.html'), 'utf8');
const login = fs.readFileSync(path.resolve(ROOT, 'js', 'login.js'), 'utf8');
const caps = fs.readFileSync(path.resolve(ROOT, 'css', 'caps.css'), 'utf8');
const review = fs.readFileSync(path.resolve(ROOT, 'js', 'review.js'), 'utf8');
const idx2 = fs.readFileSync(path.resolve(ROOT, 'js', 'index2.js'), 'utf8');
const lib = fs.readFileSync(path.resolve(ROOT, 'js', 'library.js'), 'utf8');

let fails = 0;
function check(ok, label, extra) {
  console.log((ok ? 'PASS ' : 'FAIL ') + label + (extra === undefined ? '' : '  ' + extra));
  if (!ok) fails++;
}
function tagOf(id) {
  const at = html.indexOf('id="' + id + '"');
  if (at < 0) return '';
  const start = html.lastIndexOf('<', at);
  const end = html.indexOf('>', at);
  return html.slice(start, end + 1);
}
function hasCap(id, cap) {
  const t = tagOf(id);
  return t.indexOf('data-cap="' + cap + '"') >= 0;
}

check(/css\/caps\.css/.test(html), 'index2.html 載入 caps.css');
check(html.indexOf('css/caps.css') > html.indexOf('css/login.css'), 'caps.css 在 login.css 之後（最後一張）');
check(html.indexOf('css/caps.css') > html.indexOf('css/library.css'), 'caps.css 在 library.css 之後');

check(caps.includes('body[data-can-write="0"] [data-cap="write"]'), 'caps.css 有 write 規則');
check(caps.includes('body[data-can-review="0"] [data-cap="review"]'), 'caps.css 有 review 規則');
check(caps.includes('body[data-can-operate="0"] [data-cap="operate"]'), 'caps.css 有 operate 規則');
check((caps.match(/display:\s*none/g) || []).length >= 1, 'caps.css 用 display:none 收起');
check(!/!important/.test(caps), 'caps.css 沒有 !important');

check(login.includes('function capsOf(') && login.includes('function applyCaps('), 'login.js 有 capsOf/applyCaps');
check(login.includes("setAttribute('data-can-write'"), 'login.js 設 data-can-write');
check(login.includes("setAttribute('data-can-review'"), 'login.js 設 data-can-review');
check(login.includes("setAttribute('data-can-operate'"), 'login.js 設 data-can-operate');
check(login.includes('window.KOLINDEX_CAN'), 'login.js 匯出 KOLINDEX_CAN');
check(login.includes('caps: res.data.caps') && login.includes('caps: d.caps'), '登入與 session 都帶 caps');
check(login.includes("session.mode !== 'server'") && login.includes('write: true'), '本地模式全開');

const statics = [
  ['libMyLike', 'write'], ['libOptimize', 'write'], ['libDeriv', 'write'],
  ['libDownloadMissing', 'write'], ['fleetRun', 'write'], ['mlWake', 'write'], ['mlRefresh', 'write'],
  ['studioGo', 'operate']
];
for (const [id, cap] of statics) check(hasCap(id, cap), '#' + id + ' 標了 data-cap=' + cap, tagOf(id).slice(0, 120));
check(/<label class="fleet-auto" data-cap="write">/.test(html), '自動派工 label 標了 write');
check((html.match(/data-ml-sync="[^"]+" data-cap="write"/g) || []).length === 2, '兩顆 MyLike 同步按鈕標了 write');
check(/id="discoverForm"[^>]*data-cap="operate"/.test(html) || /data-cap="operate"[^>]*id="discoverForm"/.test(html), 'Sherlock 表單標了 operate');

check((review.match(/data-act="(confirm|reject|defer|ack)" data-cap="review"/g) || []).length === 4, 'review.js 四個動作都標 review');
check((idx2.match(/data-collect-(claim|return)="[^"]*" data-cap="write"/g) || []).length === 2, '收集認領／退回標了 write');
check((lib.match(/data-lv-dl data-cap="write"/g) || []).length >= 1, '檢視器缺檔下載標了 write');
check(/id="libDownload" data-cap="write"/.test(lib), '檢視器下載鈕標了 write');
check(/data-ml-folder="[^"]*" data-cap="write"/.test(lib), '收藏夾抓索引標了 write');

console.log('');
console.log(fails ? 'FAILED ' + fails : 'CAPS PASS');
process.exitCode = fails ? 1 : 0;
