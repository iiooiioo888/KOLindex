// 角色能力：單元測試＋真的起三種角色的 dev-server 驗 401/403。
// 不需要 kolindex-api：授權判斷在代理之前，沒後端時應拿到 403 而不是 503。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { apiAllowed, caps, normalizeRole, pathOf, describe } from './authz.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass += 1; console.log('PASS ' + name); }
  else { fail += 1; console.log('FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

// ── 單元 ────────────────────────────────────────────────
ok('viewer 可讀', apiAllowed('viewer', 'GET', '/api/rail'));
ok('viewer 不可寫', !apiAllowed('viewer', 'POST', '/api/collect/1/claim'));
ok('reviewer 可裁決', apiAllowed('reviewer', 'POST', '/api/review/12/verdict'));
ok('reviewer 可 ack', apiAllowed('reviewer', 'POST', '/api/ai/events/3/ack'));
ok('reviewer 不可認領', !apiAllowed('reviewer', 'POST', '/api/collect/1/claim'));
ok('reviewer 不可壓縮', !apiAllowed('reviewer', 'POST', '/api/library/lossy'));
ok('operator 可寫', apiAllowed('operator', 'POST', '/api/collect/1/claim'));
ok('operator 不可寫非 api', !apiAllowed('operator', 'POST', '/__llm'));
ok('查詢字串不影響判斷', apiAllowed('reviewer', 'POST', '/api/review/12/verdict?x=1'));
ok('未知角色退回 viewer', !apiAllowed('nobody', 'POST', '/api/review/1/verdict'));
ok('normalizeRole 大小寫', normalizeRole(' OPERATOR ') === 'operator');
ok('pathOf 去 query', pathOf('/api/x?a=1') === '/api/x');
ok('caps viewer', caps('viewer').write === false && caps('viewer').operate === false);
ok('caps reviewer', caps('reviewer').write === false && caps('reviewer').review === true && caps('reviewer').operate === false);
ok('caps operator', caps('operator').operate === true);
ok('describe 有中文', describe('viewer').includes('只讀'));

// ── 整合：起真的 dev-server ──────────────────────────────
async function startServer(port, role, local) {
  const child = spawn(process.execPath, [path.join(HERE, 'dev-server.mjs'), ROOT, String(port)], {
    cwd: HERE,
    env: Object.assign({}, process.env, {
      KOL_GATE: local ? '' : 'test-secret',
      KOL_ROLE: role,
      KOL_API: 'http://127.0.0.1:59999',
    }),
    stdio: 'ignore',
    windowsHide: true,
  });
  for (let i = 0; i < 80; i += 1) {
    try {
      const r = await fetch('http://127.0.0.1:' + port + '/__auth/session');
      if (r.ok) return child;
    } catch { /* not up yet */ }
    await sleep(50);
  }
  child.kill();
  throw new Error('server 起不來：' + port);
}

async function login(port, name, password) {
  const r = await fetch('http://127.0.0.1:' + port + '/__auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, password: password === undefined ? 'test-secret' : password }),
  });
  const body = await r.json();
  const setCookie = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie') || ''];
  const cookie = String(setCookie[0] || '').split(';')[0];
  return { status: r.status, body, cookie };
}

async function hit(port, cookie, method, url, body) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body) headers['content-type'] = 'application/json';
  const r = await fetch('http://127.0.0.1:' + port + url, {
    method,
    headers,
    body: body || undefined,
  });
  return { status: r.status, body: await r.text() };
}

async function runRole(role, port) {
  const child = await startServer(port, role);
  try {
    const anon = await hit(port, '', 'POST', '/api/collect/1/claim');
    ok(role + ' 未登入寫入 → 401', anon.status === 401, anon.body.slice(0, 80));
    const anonRead = await hit(port, '', 'GET', '/api/rail');
    ok(role + ' 未登入讀取 → 401', anonRead.status === 401, String(anonRead.status));

    const bad = await login(port, '測試者', 'wrong-password');
    ok(role + ' 錯密碼 → 401', bad.status === 401, String(bad.status));
    const good = await login(port, '測試者');
    ok(role + ' 登入 → 200', good.status === 200, String(good.status));
    ok(role + ' 登入回角色', good.body.role === role, JSON.stringify(good.body));
    ok(role + ' 登入回 caps', good.body.caps && typeof good.body.caps.operate === 'boolean');

    const sess = await fetch('http://127.0.0.1:' + port + '/__auth/session', { headers: { cookie: good.cookie } }).then((r) => r.json());
    ok(role + ' session 帶 caps', sess.ok === true && sess.caps && sess.caps.read === true);

    const read = await hit(port, good.cookie, 'GET', '/api/rail');
    ok(role + ' 登入後讀取不是 401/403', read.status !== 401 && read.status !== 403, String(read.status));

    const write = await hit(port, good.cookie, 'POST', '/api/collect/1/claim');
    if (role === 'viewer' || role === 'reviewer') {
      ok(role + ' 非審核寫入 → 403', write.status === 403, String(write.status) + ' ' + write.body.slice(0, 100));
      const body = JSON.parse(write.body || '{}');
      ok(role + ' 403 帶 forbidden', body.error === 'forbidden' && body.role === role, write.body.slice(0, 120));
    } else {
      ok(role + ' 可寫入（403 不該出現）', write.status !== 403, String(write.status));
    }

    const verdict = await hit(port, good.cookie, 'POST', '/api/review/1/verdict');
    if (role === 'reviewer' || role === 'operator') {
      ok(role + ' 可裁決（403 不該出現）', verdict.status !== 403, String(verdict.status));
    } else {
      ok(role + ' 不可裁決 → 403', verdict.status === 403, String(verdict.status));
    }

    const sherlock = await hit(port, good.cookie, 'POST', '/__sherlock');
    if (role === 'operator') ok('operator 可進 sherlock（不是 403）', sherlock.status !== 403, String(sherlock.status));
    else ok(role + ' 不可用 sherlock → 403', sherlock.status === 403, String(sherlock.status));

    const pull = await hit(port, good.cookie, 'POST', '/__oss/pull', '{"id":"xhs"}');
    if (role === 'operator') ok('operator 不能用這個入口拉採集映像', pull.status === 400 || pull.status === 403, String(pull.status));
    else ok(role + ' 不能拉映像 → 403', pull.status === 403, String(pull.status));

    await fetch('http://127.0.0.1:' + port + '/__auth/logout', { method: 'POST', headers: { cookie: good.cookie } });
    const after = await hit(port, good.cookie, 'GET', '/api/rail');
    ok(role + ' 登出後讀取 → 401', after.status === 401, String(after.status));
  } finally {
    child.kill();
  }
}

async function runLocal(port) {
  // 沒設 KOL_GATE 是單人開發：不管 KOL_ROLE 是什麼，本機登入都給操作者與全部能力。
  const child = await startServer(port, 'viewer', true);
  try {
    const anon = await hit(port, '', 'GET', '/api/rail');
    ok('local 未登入可讀（不擋）', anon.status !== 401, String(anon.status));
    const good = await login(port, '本機開發者', '');
    ok('local 登入 → 200', good.status === 200, String(good.status));
    ok('local 角色是 operator（不受 KOL_ROLE 影響）', good.body.role === 'operator', JSON.stringify(good.body));
    ok('local caps 全開', good.body.caps && good.body.caps.write === true && good.body.caps.review === true && good.body.caps.operate === true, JSON.stringify(good.body.caps));
    const sess = await fetch('http://127.0.0.1:' + port + '/__auth/session').then((r) => r.json());
    ok('local session gate=false', sess.gate === false, JSON.stringify(sess));
    const write = await hit(port, '', 'POST', '/api/collect/1/claim');
    ok('local 可寫入（不是 403）', write.status !== 403, String(write.status));
  } finally {
    child.kill();
  }
}

const ports = { viewer: 5390, reviewer: 5391, operator: 5392 };
try {
  for (const role of ['viewer', 'reviewer', 'operator']) {
    await runRole(role, ports[role]);
  }
  await runLocal(5393);
} catch (err) {
  fail += 1;
  console.log('FAIL 整合測試例外 — ' + err.message);
}

console.log('');
console.log(pass + ' pass, ' + fail + ' fail');
if (fail) process.exitCode = 1;
else console.log('AUTHZ PASS');
