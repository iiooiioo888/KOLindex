/* 登入閘。通行碼只在伺服器設了 KOL_GATE 時才核對；沒設就只記下操作者。 */
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

  function enter(session) {
    document.documentElement.classList.remove('need-login');
    var gate = $('loginGate');
    if (gate) gate.hidden = true;
    var av = $('opAvatar');
    if (av) {
      av.textContent = initials(session.name);
      av.title = (ROLE[session.role] || '操作者') + ' ' + session.name + ' · 點一下登出';
    }
    var who = $('dlgWho');
    if (who) who.value = session.name;
    document.body.setAttribute('data-role', session.role || 'operator');
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
    var role = ($('loginRole') && $('loginRole').value) || 'operator';
    if (!ROLE[role]) role = 'operator';
    if (!name) { showErr('請填操作者'); return; }
    var btn = $('loginSubmit');
    if (btn) btn.disabled = true;
    fetch('/__auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name, password: password, role: role })
    }).then(function (r) {
      return r.text().then(function (t) {
        var j = {};
        try { j = t ? JSON.parse(t) : {}; } catch (err) { j = {}; }
        return { status: r.status, data: j };
      });
    }).then(function (res) {
      if (btn) btn.disabled = false;
      if (res.status === 401) { showErr('通行碼不對'); return; }
      if (!res.data || !res.data.ok) { showErr('登入沒有完成'); return; }
      enter({ name: name, role: role, mode: res.data.gate ? 'server' : 'local' });
      write(window.KOLINDEX_SESSION);
      showErr('');
    }).catch(function () {
      if (btn) btn.disabled = false;
      var session = { name: name, role: role, mode: 'local' };
      write(session);
      enter(session);
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
          lead.textContent = '這台沒有設定通行碼，填操作者就能進入。要擋住未登入的人，啟動時加上 KOL_GATE。';
        }
        if (d && d.ok && d.name) {
          var session = { name: d.name, role: d.role || 'operator', mode: 'server' };
          write(session);
          enter(session);
          return;
        }
        if (d && d.gate) { clear(); showGate(); return; }
        var saved = read();
        if (saved && saved.name && !d.gate) { enter(saved); return; }
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
