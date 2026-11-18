/* =============================================================================
 * hf/js/auth.js · 看板访问控制（管理员登录）
 * -----------------------------------------------------------------------------
 * 职责：
 *   ① 口令只以「加盐 + 多轮迭代 SHA-256」保存，源码中不出现明文口令；
 *   ② 会话写 sessionStorage（关标签页即失效），带过期时间与有效性校验；
 *   ③ 失败计数 + 递增锁定期，抑制连续猜解；
 *   ④ next 回跳只允许本目录白名单页面，避免开放重定向；
 *   ⑤ guard() 供各页 head 同步调用，未登录即跳登录页，正文不会闪现。
 *
 * 安全边界（必须如实理解）：
 *   本站点是 file:// 纯前端演示，没有服务端。任何客户端校验都能被绕过
 *   ——清掉会话、改脚本、直接用浏览器开发者工具都能进来。因此本模块的作用是
 *   「看板访问控制的界面与流程演示」，不是真实身份认证。真实部署必须改为
 *   服务端会话（HttpOnly Cookie）+ 服务端权限校验，前端只负责跳转与展示。
 *
 * 依赖：无（自带 SHA-256，file:// 下不依赖 crypto.subtle 的安全上下文限制）。
 * 外联：零。
 * ========================================================================== */
(function () {
  'use strict';

  var SESSION_KEY = 'hf-admin-session';
  var LOCK_KEY = 'hf-admin-lock';
  var TTL = 8 * 60 * 60 * 1000;   /* 8 小时会话上限 */
  var ITER = 2048;                /* 口令派生迭代轮数 */
  var MAX_FAIL = 5;               /* 连续失败上限 */
  var BASE_LOCK = 15 * 1000;      /* 首次锁定时长，随后翻倍 */

  /* 允许的 internal 白名单（也是 next 回跳白名单） */
  var PAGES = ['index', 'probe', 'sample', 'truth', 'evidence',
    'repair', 'version', 'eval', 'report'];

  /* ---------- 1. SHA-256（纯 JS，无外部依赖） ---------- */
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function utf8(str) {
    var s = unescape(encodeURIComponent(String(str)));
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  function sha256(bytes) {
    var l = bytes.length;
    var total = ((l + 9 + 63) >> 6) << 6;  /* 补 0x80 + 8 字节长度，对齐 64 */
    var m = new Uint8Array(total);
    m.set(bytes);
    m[l] = 0x80;
    var dv = new DataView(m.buffer);
    dv.setUint32(total - 4, (l * 8) >>> 0, false);

    var h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a,
      h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    var w = new Uint32Array(64);

    for (var off = 0; off < total; off += 64) {
      for (var t = 0; t < 16; t++) w[t] = dv.getUint32(off + t * 4, false);
      for (t = 16; t < 64; t++) {
        var x = w[t - 15], y = w[t - 2];
        var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
        var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
      }
      var a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (t = 0; t < 64; t++) {
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0;
        d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
    }

    var out = new Uint8Array(32);
    var odv = new DataView(out.buffer);
    [h0, h1, h2, h3, h4, h5, h6, h7].forEach(function (v, i) {
      odv.setUint32(i * 4, v, false);
    });
    return out;
  }

  function hex(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) {
      s += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    }
    return s;
  }

  /* 派生：h = SHA256(salt:pw)，再以 SHA256(h || salt) 迭代 ITER-1 轮 */
  function derive(salt, password) {
    var h = sha256(utf8(salt + ':' + password));
    var saltBytes = utf8(salt);
    for (var i = 1; i < ITER; i++) {
      var buf = new Uint8Array(h.length + saltBytes.length);
      buf.set(h); buf.set(saltBytes, h.length);
      h = sha256(buf);
    }
    return hex(h);
  }

  /* ---------- 2. 账号表（只存派生值，不存明文） ---------- */
  var ACCOUNTS = {
    admin: {
      salt: 'hflab-v1-admin',
      hash: 'f112d6923bfb8f73a94299f6e6676172f735fe9bfbc1f26f8bf166f85dfa80e3',
      role: '管理员',
      scope: '全部看板'
    }
  };

  /* ---------- 3. 会话 ---------- */
  function now() { return Date.now(); }

  function read(name) {
    try { return sessionStorage.getItem(name); } catch (e) { return null; }
  }
  function write(name, val) {
    try { sessionStorage.setItem(name, val); return true; } catch (e) { return false; }
  }
  function drop(name) {
    try { sessionStorage.removeItem(name); } catch (e) {}
  }

  function session() {
    var raw = read(SESSION_KEY);
    if (!raw) return null;
    var s;
    try { s = JSON.parse(raw); } catch (e) { return null; }
    if (!s || !s.user || !s.exp) { drop(SESSION_KEY); return null; }
    if (now() > s.exp) { drop(SESSION_KEY); return null; }
    return s;
  }

  /* ---------- 4. 失败锁定 ---------- */
  function lockState() {
    var raw = read(LOCK_KEY);
    if (!raw) return { fails: 0, until: 0 };
    try {
      var o = JSON.parse(raw);
      return { fails: o.fails || 0, until: o.until || 0 };
    } catch (e) { return { fails: 0, until: 0 }; }
  }
  function bumpFail() {
    var st = lockState();
    st.fails += 1;
    if (st.fails >= MAX_FAIL) {
      var over = st.fails - MAX_FAIL;               /* 第 5 次起开始锁定 */
      st.until = now() + BASE_LOCK * Math.pow(2, over);
    }
    write(LOCK_KEY, JSON.stringify(st));
    return st;
  }
  function clearFail() { drop(LOCK_KEY); }

  /* ---------- 5. 登录 / 退出 ---------- */
  function login(user, password) {
    var st = lockState();
    if (st.until && now() < st.until) {
      return {
        ok: false, code: 'LOCKED',
        wait: Math.ceil((st.until - now()) / 1000),
        msg: '连续失败次数过多，请 ' + Math.ceil((st.until - now()) / 1000) + ' 秒后重试'
      };
    }

    var name = String(user || '').trim().toLowerCase();
    var pw = String(password || '');
    if (!name || !pw) {
      return { ok: false, code: 'EMPTY', msg: '请输入账号与口令' };
    }

    var acc = Object.prototype.hasOwnProperty.call(ACCOUNTS, name)
      ? ACCOUNTS[name] : null;

    /* 账号不存在时也走一次派生，避免用响应时间区分账号是否存在 */
    var salt = acc ? acc.salt : 'hflab-v1-decoy';
    var got = derive(salt, pw);
    var ok = !!acc && got === acc.hash;

    if (!ok) {
      var after = bumpFail();
      var left = MAX_FAIL - after.fails;
      return {
        ok: false, code: 'BAD',
        fails: after.fails,
        msg: left > 0
          ? '账号或口令不正确（再错 ' + left + ' 次将临时锁定）'
          : '账号或口令不正确，已临时锁定'
      };
    }

    clearFail();
    var s = {
      user: name,
      role: acc.role,
      scope: acc.scope,
      at: now(),
      exp: now() + TTL
    };
    if (!write(SESSION_KEY, JSON.stringify(s))) {
      return { ok: false, code: 'STORE', msg: '浏览器禁用了会话存储，无法登录' };
    }
    return { ok: true, session: s };
  }

  function logout() { drop(SESSION_KEY); }

  /* ---------- 6. next 白名单 ---------- */
  function safeNext(raw) {
    if (!raw) return 'index.html';
    var s = String(raw).trim();
    if (/[\\/]/.test(s) || /:/.test(s) || s.indexOf('..') >= 0) return 'index.html';
    var m = /^([a-z]+)\.html$/.exec(s);
    if (!m) return 'index.html';
    return PAGES.indexOf(m[1]) >= 0 ? s : 'index.html';
  }

  function currentPage() {
    var p = (location.pathname || '').split('/').pop() || '';
    var m = /^([a-z]+)\.html$/.exec(p);
    return m && PAGES.indexOf(m[1]) >= 0 ? p : 'index.html';
  }

  /* ---------- 7. 守卫 ---------- */
  /* 供各页 head 同步调用：无有效会话则立刻跳登录页（正文未渲染，不闪现） */
  function guard() {
    if (session()) return true;
    /* 跳转是异步的，先隐藏文档，避免未登录时正文闪出一帧 */
    try { document.documentElement.style.visibility = 'hidden'; } catch (e) {}
    location.replace('login.html?next=' + encodeURIComponent(currentPage()));
    return false;
  }

  /* 供登录页调用：已登录则直接进目标页 */
  function redirectIfLoggedIn() {
    if (!session()) return false;
    var next = safeNext(new URLSearchParams(location.search).get('next'));
    location.replace(next);
    return true;
  }

  window.HFAuth = {
    PAGES: PAGES,
    TTL: TTL,
    MAX_FAIL: MAX_FAIL,
    login: login,
    logout: logout,
    session: session,
    guard: guard,
    redirectIfLoggedIn: redirectIfLoggedIn,
    safeNext: safeNext,
    /* 仅供验收脚本核对派生实现，不返回任何可用凭据 */
    _derive: derive,
    _sha256hex: function (s) { return hex(sha256(utf8(s))); }
  };
})();
