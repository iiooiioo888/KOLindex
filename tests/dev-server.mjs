// KOLindex local dev server — zero dependencies, live reload, no build step.
// usage: node dev-server.mjs <site-dir> [port]
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { apiAllowed, caps, pathOf, ROLE_LABEL, normalizeRole } from './authz.mjs';

const ROOT = path.resolve(process.argv[2] ?? '.');
const START_PORT = Number(process.argv[3] ?? process.env.PORT ?? 5200);
const HOST = process.env.HOST || '127.0.0.1';
const PROD = process.env.KOL_PROD === '1';
const ENTRY = 'index2.html';

// ── .env（可選）：放在這個腳本旁邊，KEY=VALUE，一行一組 ─────────────
function loadEnv(file) {
  let txt;
  try { txt = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] == null) process.env[m[1]] = v;
  }
}
loadEnv(path.join(path.dirname(fileURLToPath(import.meta.url)), '.env'));

const LLM = {
  base: (process.env.LLM_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/+$/, ''),
  key: process.env.LLM_API_KEY || '',
  model: process.env.LLM_MODEL || 'deepseek-chat',
  timeout: Math.max(5000, Number(process.env.LLM_TIMEOUT_MS || 120000)),
  jsonMode: process.env.LLM_JSON_MODE !== '0',
};

// ── 後端 API（kolindex-api）：/api/* 反向代理，同源就沒有 CORS 問題 ────
const API_BASE = (process.env.KOL_API || 'http://127.0.0.1:5210').replace(/\/+$/, '');
const CONTROL_BASE = (process.env.KOL_CONTROL || 'http://127.0.0.1:5220').replace(/\/+$/, '');
const DISCOVERY_BASE = (process.env.KOL_DISCOVERY || 'http://127.0.0.1:5221').replace(/\/+$/, '');
const GATE = process.env.KOL_GATE || '';
const SERVER_ROLE = normalizeRole(process.env.KOL_ROLE);

function localRole() {
  return process.env.KOL_DEV_OPERATOR === '1' ? 'operator' : 'viewer';
}
const SERVER_OPERATOR = String(process.env.KOL_OPERATOR || '').trim();
const SESSION_MS = 12 * 60 * 60 * 1000;
const sessions = new Map();

function sameSecret(a, b) {
  const ha = crypto.createHash('sha256').update(String(a), 'utf8').digest();
  const hb = crypto.createHash('sha256').update(String(b), 'utf8').digest();
  return crypto.timingSafeEqual(ha, hb);
}

function readCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); }
    catch { out[k] = ''; }
  });
  return out;
}

function currentSession(req) {
  if (!GATE) return null;
  const token = readCookies(req).kol_session;
  if (!token) return null;
  const row = sessions.get(token);
  if (!row) return null;
  if (row.exp < Date.now()) { sessions.delete(token); return null; }
  return row;
}

function setSessionCookie(res, token, secure) {
  const parts = [
    'kol_session=' + token,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    'Max-Age=' + Math.floor(SESSION_MS / 1000),
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

const loginFails = new Map();

function clientIp(req) {
  return String(req.socket && req.socket.remoteAddress || '');
}

function loginBlocked(ip) {
  const row = loginFails.get(ip);
  if (!row) return false;
  if (row.until && row.until > Date.now()) return true;
  if (row.until && row.until <= Date.now()) loginFails.delete(ip);
  return false;
}

function noteLoginFail(ip) {
  const row = loginFails.get(ip) || { n: 0, until: 0 };
  row.n += 1;
  if (row.n >= 5) {
    row.until = Date.now() + 60000;
    row.n = 0;
  }
  loginFails.set(ip, row);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'kol_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}

function handleAuth(req, res, url) {
  if (url.startsWith('/__auth/session')) {
    const row = currentSession(req);
    if (row) return json(res, 200, { ok: true, gate: true, name: row.name, role: row.role, caps: caps(row.role) });
    return json(res, 200, { ok: false, gate: Boolean(GATE) });
  }
  if (url.startsWith('/__auth/logout')) {
    const token = readCookies(req).kol_session;
    if (token) sessions.delete(token);
    clearSessionCookie(res);
    return json(res, 200, { ok: true });
  }
  if (!url.startsWith('/__auth/login')) return json(res, 404, { error: 'not_found' });
  if (req.method !== 'POST') return json(res, 405, { error: 'method' });
  return readBody(req, 4096).then((raw) => {
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
    const name = String(body.name || '').trim().slice(0, 40);
    if (!name || /[\u0000-\u001f]/.test(name)) return json(res, 400, { error: 'name' });
    const ip = clientIp(req);
    if (loginBlocked(ip)) return json(res, 429, { error: 'slow', message: '登入失敗次數太多，請稍後再試。' });
    if (!GATE) {
      const role = localRole();
      return json(res, 200, { ok: true, gate: false, mode: 'local', name, role, caps: caps(role) });
    }
    if (SERVER_OPERATOR && name !== SERVER_OPERATOR) {
      noteLoginFail(ip);
      return json(res, 401, { error: 'bad_pass' });
    }
    if (!sameSecret(body.password || '', GATE)) {
      noteLoginFail(ip);
      return json(res, 401, { error: 'bad_pass' });
    }
    loginFails.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { name: SERVER_OPERATOR || name, role: SERVER_ROLE, exp: Date.now() + SESSION_MS });
    const secure = process.env.KOL_COOKIE_SECURE === '1' || req.headers['x-forwarded-proto'] === 'https';
    setSessionCookie(res, token, secure);
    return json(res, 200, { ok: true, gate: true, mode: 'server', name: SERVER_OPERATOR || name, role: SERVER_ROLE, caps: caps(SERVER_ROLE) });
  }).catch((err) => json(res, 400, { error: err.message }));
}

async function proxyApi(req, res) {
  const sess = GATE ? currentSession(req) : null;
  if (GATE && !sess) {
    return json(res, 401, { error: 'login_required' });
  }
  const role = GATE ? sess.role : localRole();
  if (!apiAllowed(role, req.method, req.url)) {
    return json(res, 403, {
      error: 'forbidden',
      message: '角色「' + (ROLE_LABEL[role] || role) + '」不能 ' + req.method + ' ' + pathOf(req.url),
      role,
      method: req.method,
      path: pathOf(req.url),
      caps: caps(role),
    });
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    // POST/PATCH 要把 body 一起轉過去，否則裁決端點只會收到空物件
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req, 256 * 1024);
    const headers = { accept: 'application/json' };
    if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
    const r = await fetch(API_BASE + req.url, {
      method: req.method,
      headers,
      body,
      signal: ctrl.signal,
    });
    const buf = Buffer.from(await r.arrayBuffer());
    res.writeHead(r.status, {
      'Content-Type': r.headers.get('content-type') || 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-KOL-Api': 'up',
    });
    res.end(buf);
  } catch (err) {
    const why = err.name === 'AbortError' ? '逾時 8000ms' : err.message;
    console.log('[api] proxy failed: ' + why);
    json(res, 503, {
      error: 'api_unavailable',
      message: 'kolindex-api 沒回應（' + API_BASE + '）：' + why,
      hint: '另開一個終端跑 node kolindex-api/server.mjs',
    });
  } finally {
    clearTimeout(timer);
  }
}

function controlTokenFor(role) {
  if (role === 'operator') return process.env.KOL_TOKEN_OPERATOR || '';
  if (role === 'reviewer') return process.env.KOL_TOKEN_REVIEWER || '';
  return process.env.KOL_TOKEN_VIEWER || '';
}

async function proxyControl(req, res) {
  const sess = GATE ? currentSession(req) : null;
  if (GATE && !sess) return json(res, 401, { error: 'login_required' });
  const role = GATE ? sess.role : localRole();
  const token = controlTokenFor(role);
  if (!token) {
    return json(res, 503, {
      error: 'control_token_missing',
      message: '這個行程沒有對應角色的 KOL_TOKEN_*，控制面人物主檔打不過去。',
    });
  }
  const targetPath = String(req.url || '').replace(/^\/__control/, '') || '/';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req, 256 * 1024);
    const headers = {
      accept: 'application/json',
      authorization: 'Bearer ' + token,
    };
    if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
    const r = await fetch(CONTROL_BASE + targetPath, {
      method: req.method,
      headers,
      body,
      signal: ctrl.signal,
    });
    const buf = Buffer.from(await r.arrayBuffer());
    res.writeHead(r.status, {
      'Content-Type': r.headers.get('content-type') || 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-KOL-Control': 'up',
    });
    res.end(buf);
  } catch (err) {
    const why = err.name === 'AbortError' ? '逾時 8000ms' : err.message;
    json(res, 503, {
      error: 'control_unavailable',
      message: '控制面沒回應（' + CONTROL_BASE + '）：' + why,
      hint: '另開一個終端跑 python apps/control/app.py',
    });
  } finally {
    clearTimeout(timer);
  }
}

async function proxyDiscovery(req, res) {
  const sess = GATE ? currentSession(req) : null;
  if (GATE && !sess) return json(res, 401, { error: 'login_required' });
  const role = GATE ? sess.role : localRole();
  if (req.method === 'POST' && !caps(role).operate && !caps(role).review) {
    return json(res, 403, { error: 'forbidden', message: '只有審核或操作者可以送出帳號發現。' });
  }
  let targetPath = String(req.url || '');
  if (targetPath.startsWith('/__discovery')) targetPath = targetPath.slice('/__discovery'.length) || '/discovery';
  if (targetPath === '/' || !targetPath) targetPath = '/discovery';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req, 64 * 1024);
    const headers = { accept: 'application/json' };
    if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
    const r = await fetch(DISCOVERY_BASE + targetPath, {
      method: req.method,
      headers,
      body,
      signal: ctrl.signal,
    });
    const buf = Buffer.from(await r.arrayBuffer());
    res.writeHead(r.status, {
      'Content-Type': r.headers.get('content-type') || 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-KOL-Discovery': 'up',
    });
    res.end(buf);
  } catch (err) {
    const why = err.name === 'AbortError' ? '逾時 20000ms' : err.message;
    json(res, 503, {
      error: 'discovery_unavailable',
      message: '發現服務沒回應（' + DISCOVERY_BASE + '）：' + why,
      hint: '另開一個終端跑 python -m kolindex_discovery',
    });
  } finally {
    clearTimeout(timer);
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

const LIVE = '<script>(function(){try{var es=new EventSource("/__reload");es.onmessage=function(e){if(e.data==="reload")location.reload();};}catch(_){}})();</script>';

const clients = new Set();
let reloadTimer = null;

function broadcast() {
  for (const res of clients) {
    try { res.write('data: reload\n\n'); } catch { clients.delete(res); }
  }
}

function watch() {
  try {
    fs.watch(ROOT, { recursive: true }, (_evt, file) => {
      if (!file) return;
      const p = String(file);
      if (p.includes('.git') || p.endsWith('~') || p.endsWith('.swp')) return;
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(broadcast, 120);
    });
  } catch (err) {
    console.warn('[watch] disabled:', err.message);
  }
}

function send(res, code, type, body, extra = {}) {
  res.writeHead(code, {
    'Content-Type': type,
    'Cache-Control': 'no-store, must-revalidate',
    ...extra,
  });
  res.end(body);
}

function json(res, code, obj) {
  send(res, code, 'application/json; charset=utf-8', JSON.stringify(obj));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('body 超過 ' + limit + ' bytes')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const SHERLOCK_NAME = /^[A-Za-z0-9._-]{2,32}$/;
const SHERLOCK_IMAGE = process.env.SHERLOCK_DOCKER
  || 'sherlock/sherlock@sha256:9d6602b98179fb15ceab88433626fb0ae603ae9880e13cab886970317fe1475f';
const MAIGRET_IMAGE = process.env.MAIGRET_DOCKER
  || 'soxoj/maigret@sha256:0dba1e81178a4ce62bc73167ae68687217320ebb62b59ced094ba3cb879615e7';
const SHERLOCK_IMAGE_OK = /^[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$/;
let sherlockBusy = false;
let maigretBusy = false;
let sherlockArmed = process.env.KOL_SHERLOCK === '1';
let maigretArmed = process.env.KOL_MAIGRET === '1';

const OSS_PULL = {
  sherlock: { service: 'sherlock', profile: 'oss' },
  maigret: { service: 'maigret', profile: 'backup' },
};

function authActor(req) {
  if (GATE) {
    const sess = currentSession(req);
    if (!sess) return null;
    return sess;
  }
  return { name: 'local', role: localRole() };
}

function discoveryArmed(tool) {
  if (tool === 'sherlock') {
    return process.env.KOL_SHERLOCK === '1' || sherlockArmed || (!GATE && !PROD);
  }
  if (tool === 'maigret') {
    return process.env.KOL_MAIGRET === '1' || maigretArmed || (!GATE && !PROD);
  }
  return false;
}

/** 開源容器在 UI 上要顯示的固定整合狀態。crawl 一律 off，等系統另下指令。 */
const OSS_CATALOG = [
  {
    id: 'sherlock',
    service: 'sherlock',
    name: 'Sherlock',
    platform: 'username_probe',
    bind: '—',
    wait: 'idle',
    crawl: 'off',
    discovery: 'operator',
    discovery_detail: '收集頁由操作者送出用戶名。站點清單沒有小紅書、抖音、微博',
  },
  {
    id: 'maigret',
    service: 'maigret',
    name: 'Maigret',
    platform: 'username_probe',
    bind: '—',
    wait: 'idle',
    crawl: 'off',
    discovery: 'operator',
    discovery_detail: '開源組件頁可由操作者送出用戶名；一次性容器，查完即退出',
  },
  {
    id: 'xhs',
    service: 'xhs-downloader',
    name: 'XHS-Downloader',
    platform: 'xiaohongshu',
    bind: '127.0.0.1:5556',
    wait: 'control',
    crawl: 'off',
    discovery: 'not_enabled',
    discovery_detail: '使用協議尚未核對；人物發現不會呼叫它',
  },
  {
    id: 'douyin-api',
    service: 'douyin-tiktok-api',
    name: 'Douyin_TikTok_Download_API',
    platform: 'douyin',
    bind: '127.0.0.1:8000',
    wait: 'control',
    crawl: 'off',
    discovery: 'not_enabled',
    discovery_detail: '人物發現不會呼叫它；不含 browser／downloader／transcriber',
  },
];

function parseSherlockHits(text) {
  const hits = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/\[\+\]\s+([^:]+):\s+(https?:\/\/\S+)/);
    if (!m) continue;
    hits.push({ site: m[1].trim().slice(0, 80), url: m[2].slice(0, 300) });
    if (hits.length >= 80) break;
  }
  return hits;
}

function parseMaigretHits(text) {
  const hits = [];
  const seen = new Set();
  for (const line of String(text || '').split(/\r?\n/)) {
    let m = line.match(/\[\+\]\s+([^:]+):\s+(https?:\/\/\S+)/);
    if (!m) m = line.match(/([A-Za-z0-9._-]{2,40})\s+[—\-:]+\s+(https?:\/\/\S+)/);
    if (!m) {
      const url = line.match(/https?:\/\/[^\s"'<>]+/);
      if (url && /maigret|Claimed|found/i.test(line)) {
        m = [null, 'site', url[0]];
      }
    }
    if (!m) continue;
    const site = String(m[1]).trim().slice(0, 80);
    const href = String(m[2]).replace(/[),.;]+$/, '').slice(0, 300);
    const key = site + '|' + href;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({ site, url: href });
    if (hits.length >= 80) break;
  }
  return hits;
}

function runOssTool(image, name, toolArgs) {
  if (!SHERLOCK_IMAGE_OK.test(image)) {
    const err = new Error('image');
    err.code = 'image';
    return Promise.reject(err);
  }
  const args = [
    'run', '--rm',
    '--network', 'bridge',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--read-only',
    '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
    '--memory', '512m',
    '--pids-limit', '128',
    image,
  ].concat(toolArgs);
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let errText = '';
    const cap = 512 * 1024;
    const timer = setTimeout(() => {
      child.kill();
      const err = new Error('timeout');
      err.code = 'timeout';
      reject(err);
    }, 90000);
    child.stdout.on('data', (buf) => {
      if (out.length < cap) out += buf.toString('utf8');
    });
    child.stderr.on('data', (buf) => {
      if (errText.length < 2000) errText += buf.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out, errText });
    });
  });
}

function runSherlock(name) {
  return runOssTool(SHERLOCK_IMAGE, name, [name, '--print-found', '--no-color', '--timeout', '8']).then((res) => {
    const hits = parseSherlockHits(res.out);
    if (res.code && !hits.length) {
      const err = new Error('exit');
      err.code = 'exit';
      err.detail = res.errText.replace(/\s+/g, ' ').trim().slice(0, 180);
      return Promise.reject(err);
    }
    return hits;
  });
}

function runMaigret(name) {
  return runOssTool(MAIGRET_IMAGE, name, [name, '--timeout', '8', '--retries', '0', '--no-progressbar']).then((res) => {
    const hits = parseMaigretHits(res.out + '\n' + res.errText);
    if (res.code && !hits.length) {
      const err = new Error('exit');
      err.code = 'exit';
      err.detail = res.errText.replace(/\s+/g, ' ').trim().slice(0, 180);
      return Promise.reject(err);
    }
    return hits;
  });
}

function safeHost(value) {
  return /^[a-zA-Z0-9._-]{1,253}$/.test(String(value || '')) ? String(value) : '';
}

function probeTcp(host, port) {
  return new Promise((resolve) => {
    if (!host) return resolve({ state: 'unset' });
    const socket = net.connect({ host, port: Number(port) || 0 });
    const timer = setTimeout(() => { socket.destroy(); resolve({ state: 'down' }); }, 1500);
    socket.on('connect', () => { clearTimeout(timer); socket.end(); resolve({ state: 'up' }); });
    socket.on('error', () => { clearTimeout(timer); resolve({ state: 'down' }); });
  });
}

function probeHttp(raw) {
  return new Promise((resolve) => {
    let target;
    try { target = new URL(raw); } catch { return resolve({ state: 'unset' }); }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return resolve({ state: 'unset' });
    if (target.username || target.password) return resolve({ state: 'unset' });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    fetch(target, { signal: ctrl.signal }).then((r) => {
      clearTimeout(timer);
      resolve({ state: r.ok ? 'up' : 'down' });
    }).catch(() => {
      clearTimeout(timer);
      resolve({ state: 'down' });
    });
  });
}

function dockerStateWord(row) {
  const raw = String((row && (row.state || row.Status)) || '').toLowerCase();
  if (!raw || raw === 'unset') return 'unset';
  if (raw === 'absent') return 'absent';
  if (raw.includes('running') || raw === 'up') return 'up';
  if (raw.includes('exit') || raw.includes('dead') || raw.includes('stopp') || raw === 'down') return 'down';
  return 'down';
}

function dockerContentOf(service) {
  const core = CORE_CATALOG[service];
  if (core) return core.content;
  const oss = ossMetaByService(service);
  if (oss) return oss.discovery_detail || (oss.name + ' · crawl ' + oss.crawl);
  return '';
}

async function componentHealth() {
  const pgHost = safeHost(process.env.POSTGRES_HOST);
  const redisHost = safeHost(process.env.REDIS_HOST);
  const minio = process.env.MINIO_ENDPOINT || '';
  const meili = process.env.MEILI_HOST || '';
  const [postgres, redis, minioHit, meiliHit, docker] = await Promise.all([
    probeTcp(pgHost, process.env.POSTGRES_PORT || 5432),
    probeTcp(redisHost, process.env.REDIS_PORT || 6379),
    probeHttp(minio ? minio.replace(/\/+$/, '') + '/minio/health/live' : ''),
    probeHttp(meili ? meili.replace(/\/+$/, '') + '/health' : ''),
    dockerStatus().catch((err) => ({
      ok: false,
      enabled: process.env.KOL_DOCKER === '1',
      items: [],
      message: (err && err.detail) || (err && err.message) || '讀不到 Docker',
    })),
  ]);
  const probeItems = [
    { id: 'postgres', name: 'PostgreSQL', kind: 'probe', via: 'tcp', state: postgres.state, content: CORE_CATALOG.postgres.content },
    { id: 'redis', name: 'Redis', kind: 'probe', via: 'tcp', state: redis.state, content: '快取與隊列協調（第一版 Compose 未啟動）' },
    { id: 'minio', name: 'MinIO', kind: 'probe', via: 'http', state: minioHit.state, content: '物件儲存（第一版 Compose 未啟動）' },
    { id: 'meilisearch', name: 'Meilisearch', kind: 'probe', via: 'http', state: meiliHit.state, content: CORE_CATALOG.meilisearch.content },
    Object.assign(nasDisk(), { kind: 'probe', content: 'KOL_NAS_ROOT/media 唯讀掛載與本機磁碟' }),
  ];
  const dockerItems = (docker.items || []).map((row) => {
    const state = docker.enabled ? dockerStateWord(row) : 'unset';
    return {
      id: 'docker.' + row.service,
      name: row.name || row.service,
      kind: 'docker',
      via: 'compose',
      service: row.service,
      state,
      container: row.state || (docker.enabled ? 'absent' : 'unset'),
      health: row.health || '',
      image: row.image || '',
      bind: row.bind || '',
      content: row.content || dockerContentOf(row.service),
      docker_enabled: !!docker.enabled,
    };
  });
  return {
    items: [...probeItems, ...dockerItems],
    docker: {
      enabled: !!docker.enabled,
      message: docker.message || '',
      total: dockerItems.length,
      up: dockerItems.filter((x) => x.state === 'up').length,
    },
  };
}

function mediaRoot() {
  if (process.env.KOL_MEDIA_ROOT) return path.resolve(process.env.KOL_MEDIA_ROOT);
  if (process.env.KOL_NAS_ROOT) return path.resolve(process.env.KOL_NAS_ROOT, 'media');
  return '';
}

function nasDisk() {
  const root = mediaRoot();
  if (!root) return { id: 'nas', name: '本機媒體', via: 'disk', state: 'unset' };
  try {
    const st = fs.statfsSync(root);
    return {
      id: 'nas',
      name: '本機媒體',
      via: 'disk',
      state: 'up',
      freeBytes: Number(st.bavail) * Number(st.bsize),
      totalBytes: Number(st.blocks) * Number(st.bsize),
    };
  } catch {
    return { id: 'nas', name: '本機媒體', via: 'disk', state: 'down' };
  }
}

async function serveMedia(req, res, url) {
  const root = mediaRoot();
  if (!root) return send(res, 404, 'text/plain; charset=utf-8', '本機媒體目錄未設定');
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'text/plain; charset=utf-8', 'Method Not Allowed');
  let rel = '';
  try { rel = decodeURIComponent((url.split('?')[0] || '').slice('/media/'.length)); }
  catch { return send(res, 400, 'text/plain; charset=utf-8', 'Bad Request'); }
  rel = rel.replace(/\\/g, '/');
  if (!rel || rel.includes('\0') || rel.split('/').includes('..')) {
    return send(res, 400, 'text/plain; charset=utf-8', 'Bad Request');
  }
  const base = path.resolve(root);
  const abs = path.resolve(base, rel);
  if (abs !== base && !abs.startsWith(base + path.sep)) {
    return send(res, 403, 'text/plain; charset=utf-8', 'Forbidden');
  }
  let st;
  try { st = await fsp.stat(abs); } catch { return send(res, 404, 'text/plain; charset=utf-8', 'Not Found'); }
  if (!st.isFile()) return send(res, 404, 'text/plain; charset=utf-8', 'Not Found');
  const ext = path.extname(abs).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': st.size,
    'Cache-Control': 'private, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(abs).on('error', () => res.destroy()).pipe(res);
}

function handleComponentHealth(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method' });
  if (GATE && !currentSession(req)) return json(res, 401, { error: 'login_required' });
  const started = Date.now();
  return componentHealth().then((body) => json(res, 200, {
    ok: true,
    items: body.items,
    docker: body.docker,
    duration_ms: Date.now() - started,
    source: 'GET /__health/components',
  }));
}

const DOCKER_SERVICES = new Set([
  'web', 'postgres', 'meilisearch',
  'sherlock', 'maigret', 'xhs-downloader', 'douyin-tiktok-api',
]);
const DOCKER_ACTIONS = new Set(['start', 'stop', 'restart']);

const CORE_CATALOG = {
  web: {
    name: 'web',
    image: 'kolindex-site:2026.11.24',
    bind: '127.0.0.1:5200',
    content: 'Next／靜態 console · BFF · 不掛 docker.sock · 媒體唯讀掛載',
  },
  postgres: {
    name: 'postgres',
    image: 'pgvector/pgvector@sha256:484e838076e04939d27d3e176e91c86eea96236126023be8d3059761122e579f',
    bind: '127.0.0.1:5432',
    content: 'pgvector · init SQL · NAS postgres 資料卷',
  },
  meilisearch: {
    name: 'meilisearch',
    image: 'getmeili/meilisearch:v1.57.0@sha256:91bf09897482c17205c8faeca8daa8d57999fb9de20d862763cdfa92ba4ec790',
    bind: '127.0.0.1:7700',
    content: '全文搜尋 · 可重建衍生索引 · 不存秘密',
  },
};

function composeArgs(extra) {
  return [
    'compose',
    '-f', path.join(ROOT, 'infra', 'compose', 'docker-compose.yml'),
    '-f', path.join(ROOT, 'infra', 'compose', 'docker-compose.oss.yml'),
    '--project-directory', path.join(ROOT, 'infra', 'compose'),
  ].concat(extra);
}

function runDocker(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, {
      shell: false,
      windowsHide: true,
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let errText = '';
    const timer = setTimeout(() => {
      child.kill();
      const err = new Error('timeout');
      err.code = 'timeout';
      reject(err);
    }, timeoutMs);
    child.stdout.on('data', (buf) => { if (out.length < 200000) out += buf.toString('utf8'); });
    child.stderr.on('data', (buf) => { if (errText.length < 2000) errText += buf.toString('utf8'); });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code) {
        const err = new Error('exit');
        err.code = 'exit';
        err.detail = errText.replace(/\s+/g, ' ').trim().slice(0, 160);
        reject(err);
        return;
      }
      resolve(out);
    });
  });
}

function parseComposePublishers(row) {
  const pubs = row.Publishers || row.PublishersList || [];
  if (!Array.isArray(pubs) || !pubs.length) return '';
  const first = pubs[0] || {};
  const host = first.URL || first.HostIP || '127.0.0.1';
  const port = first.PublishedPort || first.Published || first.PublicPort;
  if (!port) return '';
  return String(host === '0.0.0.0' ? '127.0.0.1' : host) + ':' + String(port);
}

function parseComposePs(text) {
  const items = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw || raw[0] !== '{') continue;
    let row;
    try { row = JSON.parse(raw); } catch { continue; }
    const service = String(row.Service || '');
    if (!DOCKER_SERVICES.has(service)) continue;
    items.push({
      service,
      name: String(row.Name || '').slice(0, 80),
      state: String(row.State || row.Status || '').slice(0, 40),
      health: String(row.Health || '').slice(0, 40),
      image: String(row.Image || '').slice(0, 180),
      bind: parseComposePublishers(row).slice(0, 60),
    });
  }
  return items;
}

function ossMetaByService(service) {
  return OSS_CATALOG.find((row) => row.service === service) || null;
}

function decorateDockerItem(row) {
  const core = CORE_CATALOG[row.service];
  const meta = ossMetaByService(row.service);
  if (!meta && !core) {
    return Object.assign({}, row, {
      kind: 'core',
      wait: '',
      crawl: '',
      discovery: '',
      content: dockerContentOf(row.service),
      image: row.image || '',
      bind: row.bind || '',
    });
  }
  if (!meta) {
    return Object.assign({}, row, {
      kind: 'core',
      id: row.service,
      name: core.name,
      bind: row.bind || core.bind || '',
      image: row.image || core.image || '',
      content: core.content,
      wait: '',
      crawl: '',
      discovery: '',
    });
  }
  return Object.assign({}, row, {
    kind: 'oss',
    id: meta.id,
    name: meta.name,
    platform: meta.platform,
    bind: row.bind || meta.bind,
    image: row.image || '',
    content: meta.discovery_detail || dockerContentOf(row.service),
    wait: meta.wait,
    crawl: meta.crawl,
    discovery: meta.discovery,
    discovery_detail: meta.discovery_detail,
  });
}

async function dockerStatus() {
  if (process.env.KOL_DOCKER !== '1') {
    return {
      ok: true,
      enabled: false,
      items: [...DOCKER_SERVICES].map((service) => decorateDockerItem({ service, state: 'unset', health: '' })),
    };
  }
  const text = await runDocker(composeArgs(['ps', '--all', '--format', 'json']), 15000);
  const found = parseComposePs(text);
  const by = {};
  found.forEach((row) => { by[row.service] = row; });
  const items = [...DOCKER_SERVICES].map((service) => decorateDockerItem(by[service] || { service, state: 'absent', health: '' }));
  return { ok: true, enabled: true, items };
}

async function ossStatus() {
  const docker = await dockerStatus().catch((err) => {
    if (err && err.code === 'ENOENT') {
      return { ok: true, enabled: true, items: [], message: '這台找不到 docker 指令。' };
    }
    return { ok: true, enabled: process.env.KOL_DOCKER === '1', items: [], message: (err && err.detail) || '讀不到容器狀態。' };
  });
  const byService = {};
  (docker.items || []).forEach((row) => { byService[row.service] = row; });
  const items = OSS_CATALOG.map((meta) => {
    const live = byService[meta.service] || {};
    return {
      id: meta.id,
      service: meta.service,
      name: meta.name,
      platform: meta.platform,
      bind: live.bind || meta.bind,
      wait: meta.wait,
      crawl: meta.crawl,
      discovery: meta.discovery,
      discovery_detail: meta.discovery_detail,
      content: live.content || meta.discovery_detail,
      image: live.image || '',
      docker_enabled: !!docker.enabled,
      state: live.state || (docker.enabled ? 'absent' : 'unset'),
      health: live.health || '',
      armed: meta.id === 'sherlock'
        ? discoveryArmed('sherlock')
        : (meta.id === 'maigret' ? discoveryArmed('maigret') : false),
      source: 'GET /__oss/status',
    };
  });
  return {
    ok: true,
    enabled: !!docker.enabled,
    armed: discoveryArmed('sherlock'),
    maigret_armed: discoveryArmed('maigret'),
    runnable: ['sherlock', 'maigret'],
    message: docker.message || '',
    items,
    at: new Date().toISOString(),
  };
}

function handleOssStatus(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method' });
  if (GATE && !currentSession(req)) return json(res, 401, { error: 'login_required' });
  return ossStatus().then((body) => json(res, 200, body)).catch((err) => {
    return json(res, 200, {
      ok: true,
      enabled: false,
      armed: discoveryArmed('sherlock'),
      maigret_armed: discoveryArmed('maigret'),
      runnable: ['sherlock', 'maigret'],
      items: OSS_CATALOG.map((meta) => Object.assign({}, meta, {
        docker_enabled: false,
        state: 'unset',
        health: '',
        armed: meta.id === 'sherlock'
          ? discoveryArmed('sherlock')
          : (meta.id === 'maigret' ? discoveryArmed('maigret') : false),
        source: 'GET /__oss/status',
      })),
      message: (err && err.message) || '讀不到開源容器狀態。',
      at: new Date().toISOString(),
    });
  });
}

function ossComposeArgs(profile, extra) {
  return [
    'compose',
    '-f', path.join(ROOT, 'infra', 'compose', 'docker-compose.oss.yml'),
    '--project-directory', path.join(ROOT, 'infra', 'compose'),
    '--profile', profile,
  ].concat(extra);
}

function handleOssPull(req, res) {
  if (GATE && !currentSession(req)) return json(res, 401, { error: 'login_required' });
  if (process.env.KOL_DOCKER !== '1') {
    return json(res, 403, {
      error: 'disabled',
      enabled: false,
      armed: sherlockArmed,
      message: '網頁容器沒有 Docker。要在宿主機用 KOL_DOCKER=1 啟動 node tests/dev-server.mjs。',
    });
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    return json(res, 200, {
      ok: true,
      enabled: true,
      armed: sherlockArmed,
      services: Object.keys(OSS_PULL),
    });
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'method' });
  const role = GATE ? currentSession(req).role : localRole();
  if (normalizeRole(role) !== 'operator') {
    return json(res, 403, { error: 'forbidden', message: '只有操作者可以拉起這兩個映像。' });
  }
  return readBody(req, 1024).then(async (raw) => {
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
    const id = String(body.id || '');
    const spec = OSS_PULL[id];
    if (!spec) return json(res, 400, { error: 'bad_request' });
    await runDocker(ossComposeArgs(spec.profile, ['pull', spec.service]), 180000);
    if (id === 'sherlock') sherlockArmed = true;
    if (id === 'maigret') maigretArmed = true;
    return json(res, 200, {
      ok: true,
      id,
      armed: discoveryArmed('sherlock'),
      maigret_armed: discoveryArmed('maigret'),
      message: id === 'sherlock'
        ? 'Sherlock 映像已在本機。開源組件頁與收集頁可送出用戶名，查完即退出。'
        : 'Maigret 映像已在本機。開源組件頁可送出用戶名，查完即退出。',
    });
  }).catch((err) => {
    if (err && err.code === 'ENOENT') {
      return json(res, 503, { error: 'missing', message: '這台找不到 docker 指令。' });
    }
    if (err && err.code === 'timeout') {
      return json(res, 504, { error: 'timeout', message: '拉取超過 180 秒，已停止。' });
    }
    return json(res, 502, { error: 'failed', message: (err && err.detail) || '映像沒有拉完。' });
  });
}

function handleDocker(req, res) {
  if (GATE && !currentSession(req)) return json(res, 401, { error: 'login_required' });
  if (req.method === 'GET' || req.method === 'HEAD') {
    return dockerStatus().then((body) => json(res, 200, body)).catch((err) => {
      if (err && err.code === 'ENOENT') return json(res, 200, { ok: true, enabled: true, items: [], message: '這台 NAS 找不到 docker 指令。' });
      return json(res, 200, { ok: true, enabled: true, items: [], message: (err && err.detail) || '讀不到容器狀態。' });
    });
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'method' });
  const role = GATE ? currentSession(req).role : localRole();
  if (normalizeRole(role) !== 'operator') return json(res, 403, { error: 'forbidden', message: '只有操作者可以開關這組容器。' });
  if (process.env.KOL_DOCKER !== '1') return json(res, 403, { error: 'disabled', message: '未開啟 KOL_DOCKER。' });
  return readBody(req, 1024).then(async (raw) => {
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
    const service = String(body.service || '');
    const action = String(body.action || '');
    if (!DOCKER_SERVICES.has(service) || !DOCKER_ACTIONS.has(action)) {
      return json(res, 400, { error: 'bad_request' });
    }
    await runDocker(composeArgs([action, service]), 60000);
    const status = await dockerStatus();
    return json(res, 200, status);
  }).catch((err) => json(res, 502, { error: 'failed', message: (err && err.detail) || '容器指令沒有完成。' }));
}

function auditSherlock(sess, name, status, count) {
  try {
    const dir = path.join(process.env.KOL_NAS_ROOT || path.join(ROOT, 'data', 'nas'), 'audit');
    fs.mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({
      at: new Date().toISOString(),
      actor: sess && sess.name ? String(sess.name).slice(0, 40) : '',
      role: sess && sess.role ? sess.role : '',
      name,
      status,
      count: count == null ? null : count,
    }) + '\n';
    fs.appendFileSync(path.join(dir, 'sherlock.jsonl'), line);
  } catch (err) {
    console.warn('[sherlock] audit ' + err.message);
  }
}

function handleOssToolRun(req, res, forcedTool) {
  const sess = authActor(req);
  if (GATE && !sess) {
    return json(res, 401, { error: 'login_required', message: '帳號發現工具只開放給已登入的操作者。' });
  }
  if (!caps(sess.role).operate) {
    return json(res, 403, { error: 'forbidden', message: '只有操作者可以送出用戶名查詢', role: sess.role });
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'method' });
  return readBody(req, 4096).then(async (raw) => {
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
    const tool = String(forcedTool || body.tool || 'sherlock').trim().toLowerCase();
    if (tool !== 'sherlock' && tool !== 'maigret') {
      return json(res, 400, { error: 'tool', message: '只接受 sherlock 或 maigret。小紅書／抖音抓取仍是 not_enabled。' });
    }
    if (!discoveryArmed(tool)) {
      return json(res, 404, {
        error: 'disabled',
        message: tool === 'sherlock'
          ? '先在開源組件頁拉起 Sherlock 映像，或設 KOL_SHERLOCK=1。'
          : '先在開源組件頁拉起 Maigret 映像，或設 KOL_MAIGRET=1。',
      });
    }
    const name = String(body.name || body.username || '').trim().replace(/^@/, '');
    if (!SHERLOCK_NAME.test(name)) return json(res, 400, { error: 'name' });
    if (tool === 'sherlock' && sherlockBusy) return json(res, 409, { error: 'busy' });
    if (tool === 'maigret' && maigretBusy) return json(res, 409, { error: 'busy' });
    if (tool === 'sherlock') sherlockBusy = true;
    else maigretBusy = true;
    try {
      const hits = tool === 'sherlock' ? await runSherlock(name) : await runMaigret(name);
      auditSherlock(sess, name, tool + ':ok', hits.length);
      console.log('[' + tool + '] docker hits ' + hits.length);
      return json(res, 200, {
        ok: true,
        tool,
        engine: 'docker',
        name,
        count: hits.length,
        hits,
        note: '結果只是公開頁候選，不是已確認帳號。',
      });
    } catch (err) {
      auditSherlock(sess, name, tool + ':' + (err && err.code ? err.code : 'failed'), null);
      if (err && err.code === 'ENOENT') {
        return json(res, 503, { error: 'missing', message: '這台找不到 docker 指令。裝好 Docker 後再送出。' });
      }
      if (err && err.code === 'image') {
        return json(res, 500, { error: 'image', message: '映像必須是名稱@sha256:64位摘要。' });
      }
      if (err && err.code === 'timeout') {
        return json(res, 504, { error: 'timeout', message: tool + ' 容器超過 90 秒，已停止。' });
      }
      return json(res, 502, { error: 'failed', message: err && err.detail ? err.detail : (tool + ' 容器沒有跑完。') });
    } finally {
      if (tool === 'sherlock') sherlockBusy = false;
      else maigretBusy = false;
    }
  }).catch((err) => json(res, 400, { error: err.message }));
}

function handleSherlock(req, res) {
  return handleOssToolRun(req, res, 'sherlock');
}

function handleOssRun(req, res) {
  return handleOssToolRun(req, res, null);
}

// OpenAI 相容上游；失敗回 {status, txt}，由呼叫端決定怎麼回報
async function callLLM(messages, temperature, useJson) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LLM.timeout);
  const body = { model: LLM.model, messages, temperature };
  if (useJson) body.response_format = { type: 'json_object' };
  try {
    const r = await fetch(LLM.base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + LLM.key },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    return { status: r.status, txt: await r.text() };
  } catch (err) {
    const msg = err.name === 'AbortError' ? '上游逾時 ' + LLM.timeout + 'ms' : '上游連線失敗：' + err.message;
    return { status: 0, txt: JSON.stringify({ error: { message: msg } }) };
  } finally {
    clearTimeout(timer);
  }
}

async function resolveTarget(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const abs = path.resolve(ROOT, '.' + path.posix.normalize(clean));
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return null;
  let st;
  try { st = await fsp.stat(abs); } catch { return null; }
  if (st.isDirectory()) {
    const entry = path.join(abs, ENTRY);
    try {
      const est = await fsp.stat(entry);
      if (est.isFile()) return { file: entry, stat: est };
    } catch { /* fall through */ }
    return { dir: abs, stat: st };
  }
  return { file: abs, stat: st };
}

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';

  if (url.startsWith('/__reload')) {
    if (PROD) return send(res, 404, 'text/plain; charset=utf-8', 'Not Found');
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    res.write('retry: 500\n\n');
    clients.add(res);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* ignore */ } }, 25000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
    return;
  }

  if (url.startsWith('/__auth')) return handleAuth(req, res, url);

  if (url.startsWith('/__health/components')) return handleComponentHealth(req, res);

  if (url.startsWith('/__control/') || url === '/__control') return proxyControl(req, res);
  if (url.startsWith('/__discovery') || url === '/discovery' || url.startsWith('/discovery')) {
    return proxyDiscovery(req, res);
  }

  if (url === '/media' || url.startsWith('/media/')) return serveMedia(req, res, url);

  if (url.startsWith('/__oss/status')) return handleOssStatus(req, res);

  if (url.startsWith('/__oss/pull')) return handleOssPull(req, res);
  if (url.startsWith('/__oss/run')) return handleOssRun(req, res);

  if (url.startsWith('/__docker')) return handleDocker(req, res);

  if (url.startsWith('/__sherlock')) return handleSherlock(req, res);

  if (url.startsWith('/api/')) return proxyApi(req, res);

  if (url.startsWith('/__llm') && PROD && process.env.KOL_LLM !== '1') {
    return send(res, 404, 'text/plain; charset=utf-8', 'Not Found');
  }

  if (url.startsWith('/__llm/status')) {
    let baseHost = LLM.base;
    try { baseHost = new URL(LLM.base).host; } catch { /* keep raw */ }
    return json(res, 200, {
      configured: Boolean(LLM.key),
      model: LLM.model,
      baseHost,
      jsonMode: LLM.jsonMode,
    });
  }

  if (url.startsWith('/__llm')) {
    if (GATE) {
      const s = currentSession(req);
      if (!s) return json(res, 401, { error: 'login_required' });
      if (!caps(s.role).operate) {
        return json(res, 403, { error: 'forbidden', message: '只有操作者可以呼叫 LLM 代理', role: s.role });
      }
    }
    if (req.method !== 'POST') return json(res, 405, { error: { message: '只接受 POST' } });
    if (!LLM.key) {
      return json(res, 503, {
        error: { message: 'LLM_API_KEY 未設定：在 KOLindex-dev/.env 寫入 LLM_API_KEY=... 後重啟 dev server' },
      });
    }
    let payload;
    try {
      payload = JSON.parse(await readBody(req, 256 * 1024));
    } catch (err) {
      return json(res, 400, { error: { message: '讀取 body 失敗：' + err.message } });
    }
    const ROLE = ['system', 'user', 'assistant'];
    const messages = (Array.isArray(payload?.messages) ? payload.messages : [])
      .filter((m) => m && ROLE.includes(m.role) && typeof m.content === 'string')
      .slice(0, 6)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 12000) }));
    if (!messages.length) return json(res, 400, { error: { message: '缺少 messages' } });

    const temp = Number.isFinite(payload.temperature) ? Math.min(1.5, Math.max(0, payload.temperature)) : 0.4;
    const t0 = Date.now();
    let out = await callLLM(messages, temp, LLM.jsonMode);
    // 有些相容端點不吃 response_format → 拿掉再試一次
    if (out.status === 400 && LLM.jsonMode && /response_format|json_object/i.test(out.txt)) {
      out = await callLLM(messages, temp, false);
    }
    const ms = Date.now() - t0;
    console.log('[llm] ' + (out.status || 'ERR') + ' ' + (ms / 1000).toFixed(1) + 's ' + out.txt.length + 'B');
    res.writeHead(out.status === 200 ? 200 : 502, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    return res.end(out.txt);
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'text/plain; charset=utf-8', 'Method Not Allowed');
  }

  const target = await resolveTarget(url);
  if (!target) {
    return send(res, 404, 'text/html; charset=utf-8',
      '<meta charset="utf-8"><body style="font:14px ui-monospace,monospace;background:#0b0d0f;color:#e6e8ea;padding:40px">' +
      '<h1 style="color:#f0a500;margin:0 0 8px">404</h1><p>' + url.replace(/[<>&]/g, '') + '</p>' +
      '<p><a style="color:#4aa8ff" href="/">回到 ' + ENTRY + '</a></p>');
  }

  if (target.dir) {
    if (PROD) {
      return send(res, 404, 'text/html; charset=utf-8',
        '<meta charset="utf-8"><body style="font:14px ui-monospace,monospace;background:#0b0d0f;color:#e6e8ea;padding:40px">' +
        '<h1 style="color:#f0a500;margin:0 0 8px">404</h1><p><a style="color:#4aa8ff" href="/">回到首頁</a></p>');
    }
    let entries = [];
    try { entries = await fsp.readdir(target.dir, { withFileTypes: true }); } catch { /* ignore */ }
    const list = entries
      .filter(e => !e.name.startsWith('.'))
      .map(e => {
        const label = e.isDirectory() ? e.name + '/' : e.name;
        const href = encodeURIComponent(e.name) + (e.isDirectory() ? '/' : '');
        return '<li><a href="' + href + '">' + label + '</a></li>';
      })
      .join('');
    return send(res, 200, 'text/html; charset=utf-8',
      '<meta charset="utf-8"><body style="font:14px ui-monospace,monospace;background:#0b0d0f;color:#e6e8ea;padding:40px">' +
      '<h1 style="color:#f0a500;margin:0 0 12px">' + url + '</h1><ul>' + list + '</ul>');
  }

  const ext = path.extname(target.file).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';

  if (ext === '.html') {
    let html = await fsp.readFile(target.file, 'utf8');
    if (!PROD) {
      html = html.includes('</body>')
        ? html.replace(/<\/body>/i, LIVE + '</body>')
        : html + LIVE;
    }
    return send(res, 200, type, html);
  }

  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': target.stat.size,
    'Cache-Control': 'no-store, must-revalidate',
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(target.file).on('error', () => res.destroy()).pipe(res);
});

function listen(port, attempt = 0) {
  const loopback = HOST === '127.0.0.1' || HOST === '::1' || HOST === 'localhost';
  // 正式模式一律要通行碼：反向代理後面 HOST 仍可能是 127.0.0.1，不能只靠 loopback 判斷。
  if ((PROD || !loopback) && !GATE) {
    console.error('拒絕啟動：' + (PROD ? 'KOL_PROD=1' : '監聽 ' + HOST) + ' 時必須設定 KOL_GATE');
    process.exit(1);
  }
  server.once('error', (err) => {
    if (!PROD && err.code === 'EADDRINUSE' && attempt < 20) {
      listen(port + 1, attempt + 1);
    } else {
      console.error('[server] failed:', err.message);
      process.exit(1);
    }
  });
  server.listen(port, HOST, () => {
    console.log('');
    console.log('  KOLindex dev server');
    console.log('  root : ' + ROOT);
    console.log('  url  : http://' + HOST + ':' + port + '/');
    console.log('  mode : ' + (PROD ? 'prod（無自動重整、無關目錄、預設不轉發 LLM）' : 'dev'));
    console.log('  live reload: ' + (PROD ? 'off' : 'on (edit index2.html / js / css, page refreshes itself)'));
    console.log('  llm        : ' + (LLM.key ? LLM.model + ' @ ' + LLM.base + ' → POST /__llm' : 'disabled (no LLM_API_KEY in .env)'));
    console.log('  api        : ' + API_BASE + ' → GET/POST /api/*  (沒跑就回 503，頁面自動退回示範資料)');
    console.log('  oss tools  : POST /__oss/run {tool:sherlock|maigret,name} · /__sherlock 仍可用');
    console.log('  sherlock   : ' + (discoveryArmed('sherlock') ? 'operator + docker run ' + SHERLOCK_IMAGE : 'off（開源組件頁拉起映像，或設 KOL_SHERLOCK=1）'));
    console.log('  maigret    : ' + (discoveryArmed('maigret') ? 'operator + docker run ' + MAIGRET_IMAGE : 'off（開源組件頁拉起映像，或設 KOL_MAIGRET=1）'));
    console.log('  stop : Ctrl+C');
    console.log('');
    if (!PROD) watch();
  });
}

listen(START_PORT);
