/* 登入閘。通行碼只在伺服器設了 KOL_GATE 時才核對。沒設時角色跟伺服器回傳的 caps，預設是 viewer。 */
(function () {
  'use strict';

  var KEY = 'kolindex.session';
  var ROLE = { operator: '操作者', reviewer: '審核', viewer: '只讀' };

  function $(id) { return document.getElementById(id); }

  function read() {
    try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); }
    catch (e) { return null; }
  }
  function write(session) { sessionStorage.setItem(KEY, JSON.stringify(session)); }
  function clear() { sessionStorage.removeItem(KEY); }

  function initials(name) {
    var s = String(name || '').trim();
    return (s.slice(0, 2) || 'AD').toUpperCase();
  }

  function showErr(msg) {
    var el = $('loginErr');
    if (!el) return;
    el.hidden = !msg;
    el.textContent = msg || '';
  }

  function capsOf(session) {
    if (!session) return { read: true, write: false, review: false, operate: false };
    var c = session.caps;
    if (!c || typeof c !== 'object') {
      return { read: true, write: session.role === 'operator', review: session.role === 'reviewer' || session.role === 'operator', operate: session.role === 'operator' };
    }
    return { read: c.read !== false, write: !!c.write, review: !!c.review, operate: !!c.operate };
  }

  function applyCaps(session) {
    var can = capsOf(session);
    document.body.setAttribute('data-gate', session.mode === 'server' ? 'server' : 'local');
    document.body.setAttribute('data-can-write', can.write ? '1' : '0');
    document.body.setAttribute('data-can-review', can.review ? '1' : '0');
    document.body.setAttribute('data-can-operate', can.operate ? '1' : '0');
    window.KOLINDEX_CAN = can;
    return can;
  }

  function enter(session) {
    document.documentElement.classList.remove('need-login');
    var gate = $('loginGate');
    if (gate) gate.hidden = true;
    var can = applyCaps(session);
    var av = $('opAvatar');
    if (av) {
      av.textContent = initials(session.name);
      var scope = can.write ? '' : (can.review ? ' · 只能審核' : ' · 只讀');
      av.title = (ROLE[session.role] || '操作者') + ' ' + session.name + scope + ' · 點一下登出';
    }
    var who = $('dlgWho');
    if (who) who.value = session.name;
    document.body.setAttribute('data-role', session.role || 'viewer');
    window.KOLINDEX_SESSION = session;
  }

  function showGate() {
    document.documentElement.classList.add('need-login');
    var gate = $('loginGate');
    if (gate) gate.hidden = false;
    window.KOLINDEX_SESSION = null;
  }

  function logout() {
    clear();
    fetch('/__auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(function () {});
    var pass = $('loginPass');
    if (pass) pass.value = '';
    showErr('');
    showGate();
    var name = $('loginName');
    if (name) name.focus();
  }

  function onSubmit(e) {
    e.preventDefault();
    var nameEl = $('loginName');
    var name = nameEl ? nameEl.value.trim() : '';
    var password = ($('loginPass') && $('loginPass').value) || '';
    if (!name) { showErr('請填操作者'); return; }
    var btn = $('loginSubmit');
    if (btn) btn.disabled = true;
    fetch('/__auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name, password: password })
    }).then(function (r) {
      return r.text().then(function (t) {
        var j = {};
        try { j = t ? JSON.parse(t) : {}; } catch (err) { j = {}; }
        return { status: r.status, data: j };
      });
    }).then(function (res) {
      if (btn) btn.disabled = false;
      if (res.status === 429) { showErr((res.data && res.data.message) || '請稍後再試'); return; }
      if (res.status === 401) { showErr('通行碼不對'); return; }
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        showErr('登入 BFF 沒開。另開終端：set PORT=5201 && set KOL_GATE=你的通行碼 && set KOL_ROLE=operator && node tests/dev-server.mjs . 5201');
        return;
      }
      if (!res.data || !res.data.ok) {
        showErr((res.data && res.data.message) || '登入沒有完成。若走 Next.js，請先開 5201 的 BFF。');
        return;
      }
      enter({ name: res.data.name || name, role: res.data.role || 'viewer', mode: res.data.gate ? 'server' : 'local', caps: res.data.caps || null });
      write(window.KOLINDEX_SESSION);
      showErr('');
    }).catch(function () {
      if (btn) btn.disabled = false;
      showErr('登入服務沒有回應。Next.js 會把 /__auth 轉到 127.0.0.1:5201，請先開 BFF。');
    });
  }

  function boot() {
    var av = $('opAvatar');
    if (av) av.addEventListener('click', logout);
    var form = $('loginForm');
    if (form) form.addEventListener('submit', onSubmit);

    fetch('/__auth/session', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var lead = document.querySelector('.login-lead');
        if (lead && d && d.gate === false) {
          lead.textContent = '開發模式：任填名稱即可。';
        }
        if (d && d.ok && d.name) {
          var session = { name: d.name, role: d.role || 'viewer', mode: 'server', caps: d.caps || null };
          write(session);
          enter(session);
          return;
        }
        if (d && d.gate) { clear(); showGate(); return; }
        var saved = read();
        if (saved && saved.name && !d.gate) { saved.mode = 'local'; enter(saved); return; }
        showGate();
      })
      .catch(function () {
        var saved = read();
        if (saved && saved.name) enter(saved);
        else showGate();
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.KOLINDEX_LOGIN = { logout: logout, read: read };
})();
