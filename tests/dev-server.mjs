// KOLindex local dev server — zero dependencies, live reload, no build step.
// usage: node dev-server.mjs <site-dir> [port]
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

async function proxyApi(req, res) {
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
    console.log('  stop : Ctrl+C');
    console.log('');
    if (!PROD) watch();
  });
}

listen(START_PORT);
