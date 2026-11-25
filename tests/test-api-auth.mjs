import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import http from 'node:http';

const require = createRequire(import.meta.url);
const authGuard = require('../packages/api-auth/authGuard.js');
const { issueToken, verifyHs256 } = authGuard;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass += 1; console.log('PASS ' + name); }
  else { fail += 1; console.log('FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

const secret = 'test-jwt-secret';
const token = issueToken({ id: 'alice', role: 'operator' }, secret, 60);
const decoded = verifyHs256(token, secret);
ok('JWT 只有 id/role/exp', decoded.id === 'alice' && decoded.role === 'operator' && !!decoded.exp);
ok('壞簽名會丟', (() => {
  try { verifyHs256(token.slice(0, -2) + 'ab', secret); return false; }
  catch { return true; }
})());

function fakeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[k] = v; },
    end(s) { this.body = String(s || ''); },
  };
}

{
  const req = { url: '/api/rail', headers: {} };
  const res = fakeRes();
  let next = false;
  process.env.JWT_SECRET = secret;
  authGuard(req, res, () => { next = true; });
  ok('沒有 Cookie → 401', res.statusCode === 401 && !next);
  ok('401 內容', res.body.includes('unauthorized'));
}

{
  const req = { url: '/api/rail', headers: { cookie: 'auth_token=' + token } };
  const res = fakeRes();
  let next = false;
  authGuard(req, res, () => { next = true; });
  ok('有效 Cookie → next', next && req.user && req.user.role === 'operator');
}

{
  const upstream = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, path: req.url, role: req.headers['x-kol-role'] || '' }));
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  const upPort = upstream.address().port;
  const gate = spawn(process.execPath, [path.join(ROOT, 'apps', 'api-gate', 'server.mjs'), '5398'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      HOST: '127.0.0.1',
      JWT_SECRET: secret,
      KOL_GATE: 'gate-pass',
      KOL_API_UPSTREAM: 'http://127.0.0.1:' + upPort,
      KOL_ROLE: 'operator',
    }),
    stdio: 'ignore',
    windowsHide: true,
  });
  try {
    let ready = false;
    for (let i = 0; i < 40; i += 1) {
      try {
        const r = await fetch('http://127.0.0.1:5398/api/rail');
        if (r.status === 401) { ready = true; break; }
      } catch { /* wait */ }
      await sleep(50);
    }
    ok('api-gate 起來', ready);
    const anon = await fetch('http://127.0.0.1:5398/api/rail');
    ok('直連業務端點 → 401', anon.status === 401, String(anon.status));
    const login = await fetch('http://127.0.0.1:5398/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'ops', password: 'gate-pass' }),
    });
    const setCookie = login.headers.getSetCookie ? login.headers.getSetCookie() : [];
    const cookieLine = setCookie.find((c) => c.startsWith('auth_token=')) || '';
    ok('登入設 HttpOnly Cookie', login.status === 200 && /HttpOnly/i.test(cookieLine));
    const cookie = cookieLine.split(';')[0];
    const okCall = await fetch('http://127.0.0.1:5398/api/rail', { headers: { cookie } });
    const body = await okCall.json();
    ok('帶 Cookie 可過閘', okCall.status === 200 && body.ok === true && body.role === 'operator');
  } finally {
    gate.kill();
    upstream.close();
  }
}

console.log(pass + ' pass, ' + fail + ' fail');
if (fail) process.exit(1);
console.log('API-AUTH PASS');
