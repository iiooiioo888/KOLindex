/**
 * 靜態檢查 api.js 的 A2／A3：500 不清畫面、隱藏分頁不排下一次輪詢。
 * 不開瀏覽器；行為層（實際請求）標為未量測。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const api = fs.readFileSync(path.join(root, 'js', 'api.js'), 'utf8');
const library = fs.readFileSync(path.join(root, 'js', 'library.js'), 'utf8');
const person = fs.readFileSync(path.join(root, 'js', 'person.js'), 'utf8');
const review = fs.readFileSync(path.join(root, 'js', 'review.js'), 'utf8');
const jobs = fs.readFileSync(path.join(root, 'js', 'jobs.js'), 'utf8');
const index2 = fs.readFileSync(path.join(root, 'js', 'index2.js'), 'utf8');

assert.match(api, /if \(r\.status === 401\)/);
assert.match(api, /if \(r\.status === 500\)/);
assert.ok(!/if \(r\.status === 401 \|\| r\.status === 500\)/.test(api), '500 不得與 401 同路清畫面');
assert.match(api, /emit\(false, \{ reason: 'source' \}\)/);
assert.ok(!/clearScreen\(['"]500['"]\)/.test(api) && !/clearScreen\(String\(r\.status\)\)/.test(api), '500 不得呼叫 clearScreen');

assert.match(api, /function armPoll\(/);
assert.match(api, /function stopPoll\(/);
assert.ok(!/setInterval\(sync,\s*POLL_MS\)/.test(api), '不得用 setInterval 無條件輪詢');
assert.match(api, /if \(typeof document !== 'undefined' && document\.hidden\) return;/);
assert.match(api, /if \(document\.hidden\) \{ stopPoll\(\); return; \}/);

for (const [name, src] of [
  ['library.js', library],
  ['person.js', person],
  ['review.js', review],
  ['jobs.js', jobs],
]) {
  assert.match(src, /reason==='source'/, name + ' 應保留 source 上次資料');
}
assert.match(index2, /reason==='offline' \|\| reason==='source'/);

console.log('api resilience static checks: ok');
