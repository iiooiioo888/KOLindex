#!/usr/bin/env node
// 掛在 kolindex-api 前面的認證閘。上游仍可不驗身份；這個閘負責 Cookie JWT。
// 用法：
//   set JWT_SECRET=...
//   set KOL_API_UPSTREAM=http://127.0.0.1:5212
//   node apps/api-gate/server.mjs 5210
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const authGuard = require('../../packages/api-auth/authGuard.js');
const { issueToken } = authGuard;

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.argv[2] || process.env.PORT || 5210);
const UPSTREAM = (process.env.KOL_API_UPSTREAM || 'http://127.0.0.1:5212').replace(/\/+$/, '');
const SECRET = process.env.JWT_SECRET || process.env.KOL_GATE || '';
const GATE_PASS = process.env.KOL_GATE || '';
const ROLE = process.env.KOL_ROLE || 'operator';

if (!SECRET) {
  console.error('拒絕啟動：必須設定 JWT_SECRET 或 KOL_GATE');
  process.exit(1);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

async function proxy(req, res, bodyBuf) {
  const url = UPSTREAM + (req.url || '/');
  const headers = { accept: req.headers.accept || 'application/json' };
  if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
  if (req.user) headers['x-kol-role'] = req.user.role;
  if (req.user) headers['x-kol-user'] = req.user.id;
  const init = { method: req.method, headers };
  if (bodyBuf && bodyBuf.length && req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = bodyBuf;
  }
  const r = await fetch(url, init);
  const buf = Buffer.from(await r.arrayBuffer());
  const out = { 'Content-Type': r.headers.get('content-type') || 'application/json; charset=utf-8' };
  res.writeHead(r.status, out);
  res.end(buf);
}

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';
  if (url.startsWith('/auth/login') && req.method === 'POST') {
    try {
      const raw = await readBody(req, 4096);
      const body = raw.length ? JSON.parse(raw.toString('utf8')) : {};
      const name = String(body.name || '').trim().slice(0, 40);
      const password = String(body.password || '');
      if (!name) return json(res, 400, { error: 'name' });
      if (GATE_PASS && password !== GATE_PASS) return json(res, 401, { error: 'bad_pass' });
      const token = issueToken({ id: name, role: ROLE }, SECRET, 12 * 3600);
      const secure = process.env.KOL_COOKIE_SECURE === '1' ? '; Secure' : '';
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': `auth_token=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${secure}`,
      });
      res.end(JSON.stringify({ ok: true, role: ROLE, name }));
    } catch {
      json(res, 400, { error: 'bad_body' });
    }
    return;
  }

  if (url.startsWith('/auth/logout') && req.method === 'POST') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': 'auth_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
    });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  authGuard(req, res, async () => {
    try {
      const bodyBuf = (req.method === 'GET' || req.method === 'HEAD')
        ? null
        : await readBody(req, 256 * 1024);
      await proxy(req, res, bodyBuf);
    } catch (err) {
      json(res, 502, { error: 'upstream', message: String(err && err.message || err) });
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log('api-gate listening on http://' + HOST + ':' + PORT + ' → ' + UPSTREAM);
});
