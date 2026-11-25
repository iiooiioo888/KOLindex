// 給 kolindex-api 用的全域認證中間件（CommonJS）。
// 掛在所有 /api/* 業務路由之前。健康檢查可放行。
'use strict';

const crypto = require('node:crypto');

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function parseCookie(header) {
  const out = {};
  String(header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i < 0) return;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function verifyHs256(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('shape');
  const [h, p, s] = parts;
  const expect = crypto.createHmac('sha256', secret).update(h + '.' + p).digest('base64url');
  const a = Buffer.from(expect);
  const b = Buffer.from(s);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('sig');
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  if (payload.exp && Date.now() / 1000 > Number(payload.exp)) throw new Error('exp');
  return payload;
}

function issueToken(payload, secret, ttlSec) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = {
    id: String(payload.id || ''),
    role: String(payload.role || 'viewer'),
    exp: Math.floor(Date.now() / 1000) + (ttlSec || 12 * 3600),
  };
  const mid = b64url(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + mid).digest('base64url');
  return header + '.' + mid + '.' + sig;
}

function authGuard(req, res, next) {
  const secret = process.env.JWT_SECRET || process.env.KOL_GATE || '';
  if (!secret) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'misconfigured', message: 'JWT_SECRET 或 KOL_GATE 未設定' }));
    return;
  }

  const path = String(req.url || '').split('?')[0];
  if (path === '/health' || path === '/api/health' || path === '/ready') {
    if (typeof next === 'function') return next();
    return;
  }

  const cookies = parseCookie(req.headers.cookie);
  const bearer = String(req.headers.authorization || '');
  const token = cookies.auth_token
    || cookies.kol_session
    || (bearer.startsWith('Bearer ') ? bearer.slice(7) : '');

  if (!token) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }

  try {
    const decoded = verifyHs256(token, secret);
    req.user = { id: decoded.id, role: decoded.role };
    if (typeof next === 'function') next();
  } catch {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'invalid_token' }));
  }
}

module.exports = authGuard;
module.exports.issueToken = issueToken;
module.exports.verifyHs256 = verifyHs256;
