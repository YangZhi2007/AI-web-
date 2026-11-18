/* v0.34 验收：管理员登录与看板访问控制
 * 目标：验证未登录拦截、口令校验、会话有效期、篡改/过期会话失效、
 *       退出失效、next 开放重定向防护、失败锁定，以及登录后原有功能仍可用。
 * 口径：本看板为 file:// 纯前端演示，客户端校验不构成真实安全边界；
 *       本脚本验证的是「访问控制流程」是否正确，不是安全性证明。
 * 依赖：本机 Chrome headless + CDP。 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9427;
const WEB = 'D:\\AIBBBG\\Version1\\webapp';
const OUT = 'D:\\AIBBBG\\Version1\\docs\\screenshots';
const fileUrl = (p) => 'file:///' + path.join(WEB, p).replace(/\\/g, '/');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJSON = (u) => new Promise((res, rej) =>
  http.get(u, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej));

const PW = 'HfLab@2026';
const PAGES = ['index', 'probe', 'sample', 'truth', 'evidence', 'repair', 'version', 'eval', 'report'];

const R = [];
const check = (name, ok, detail) => {
  R.push({ name, ok: !!ok });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
};

/* 在页面内提交登录表单（模拟真实用户填写并提交） */
const submit = (user, pw) =>
  `(function(){document.getElementById('lgUser').value=${JSON.stringify(user)};` +
  `document.getElementById('lgPass').value=${JSON.stringify(pw)};` +
  `document.getElementById('lgForm').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));})()`;

(async () => {
  let tg;
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + path.join(require('os').tmpdir(), 'qa-v034-' + Date.now()),
    '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' });
  try {
    for (let i = 0; i < 40; i++) {
      try { tg = await getJSON('http://127.0.0.1:' + PORT + '/json/list'); break; }
      catch (e) { await sleep(150); }
    }
    const WS = global.WebSocket || require('ws');
    const c = new WS(tg.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((res, rej) => { c.onopen = res; c.onerror = rej; });
    let id = 0; const pm = new Map(); const ext = [];
    c.onmessage = (m) => {
      const o = JSON.parse(m.data);
      if (o.id && pm.has(o.id)) { pm.get(o.id)(o); pm.delete(o.id); }
      if (o.method === 'Network.requestWillBeSent') {
        const u = o.params.request.url;
        if (!/^(file|data|blob|about):/i.test(u)) ext.push(u);
      }
    };
    const send = (method, params = {}) => new Promise((res) => { const i = ++id; pm.set(i, res); c.send(JSON.stringify({ id: i, method, params })); });
    const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
    const go = async (u) => { await send('Page.navigate', { url: u }); await sleep(600); };
    const href = () => ev('location.href');
    const shot = async (n) => { const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(path.join(OUT, n), Buffer.from(r.result.data, 'base64')); };

    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

    /* ① 源码层：口令不以明文出现，账号表只存派生值 */
    const authSrc = fs.readFileSync(path.join(WEB, 'hf/js/auth.js'), 'utf8');
    check('auth.js 不含明文口令', authSrc.indexOf(PW) < 0,
      authSrc.indexOf(PW) < 0 ? '未出现' : '出现明文');
    check('账号表保存 64 位派生值', /hash:\s*'[0-9a-f]{64}'/.test(authSrc));
    check('口令派生带盐与迭代', /salt:\s*'[^']+'/.test(authSrc) && /ITER\s*=\s*\d+/.test(authSrc));
    check('文件头如实写明安全边界', authSrc.indexOf('不构成真实身份认证') >= 0
      || authSrc.indexOf('不是真实身份认证') >= 0);

    /* ② 未登录访问看板 → 拦截到登录页并带 next */
    await go(fileUrl('hf/index.html'));
    let h = await href();
    check('未登录访问 index 被拦截', /login\.html/.test(h), h.split('/').pop());
    check('拦截时携带 next 原目标', /next=index\.html/.test(h));
    /* 跳转前的隐藏无法在跳转后动态观测，改核对守卫源码确实设置了隐藏 */
    check('守卫在跳转前隐藏文档（源码核对）',
      /visibility\s*=\s*'hidden'/.test(authSrc), 'guard 内已设隐藏');
    check('跳到登录页后正文恢复可见',
      (await ev(`getComputedStyle(document.body).visibility`)) === 'visible');

    /* ③ 登录页要素 */
    const f = await ev(`(()=>{var g=function(i){return document.getElementById(i)};
      return {form:!!g('lgForm'),user:!!g('lgUser'),pw:g('lgPass')?g('lgPass').type:null,
        btn:!!g('lgBtn'),err:!!g('lgErr'),note:!!document.querySelector('.lg-note')};})()`);
    check('登录页表单要素齐全', f && f.form && f.user && f.btn && f.err, JSON.stringify(f));
    check('口令框默认 password 类型', f && f.pw === 'password', f && f.pw);
    check('登录页含安全边界说明区', f && f.note === true);

    /* ④ 空输入与错误口令均被拒绝，且不产生会话 */
    await ev(submit('', ''));
    await sleep(400);
    check('空输入被拒绝', (await href()).indexOf('login.html') >= 0);
    await ev(submit('admin', 'wrong-pass'));
    await sleep(600);
    const errTxt = await ev(`document.getElementById('lgErr').textContent`);
    check('错误口令被拒绝并给出提示', (await href()).indexOf('login.html') >= 0 && !!errTxt && errTxt.length > 4, errTxt);
    check('错误后不写入会话', (await ev(`sessionStorage.getItem('hf-admin-session')`)) === null);
    await shot('v0.34-hf-登录页-错误态.png');

    /* ⑤ 正确口令放行，会话含用户/角色/过期 */
    await ev(submit('admin', PW));
    await sleep(1500);
    h = await href();
    check('正确口令进入看板', /\/hf\/index\.html$/.test(h), h.split('/').pop());
    const sess = await ev(`(function(){var s=sessionStorage.getItem('hf-admin-session');
      if(!s)return null;var o=JSON.parse(s);return {user:o.user,role:o.role,exp:o.exp>Date.now()};})()`);
    check('会话含 admin 与角色', sess && sess.user === 'admin' && sess.role === '管理员', JSON.stringify(sess));
    check('会话未过期', sess && sess.exp === true);
    const acct = await ev(`(document.querySelector('[data-acct]')||{}).textContent`);
    check('侧栏显示当前管理员', !!acct && acct.indexOf('admin') >= 0, acct);

    /* ⑥ 会话跨页保持 + 9 页可达 */
    let blocked = [];
    for (const p of PAGES) {
      await go(fileUrl('hf/' + p + '.html'));
      if (!new RegExp('/hf/' + p + '\\.html$').test(await href())) blocked.push(p);
    }
    check('登录后 9 页全部可达', blocked.length === 0, blocked.join(',') || '无拦截');

    /* ⑦ 篡改会话（无过期字段）→ 失效 */
    await ev(`sessionStorage.setItem('hf-admin-session', JSON.stringify({user:'admin',role:'管理员'}))`);
    await go(fileUrl('hf/truth.html'));
    check('缺过期字段的会话被判失效', /login\.html/.test(await href()));

    /* ⑧ 过期会话 → 失效 */
    await ev(`(function(){document.getElementById('lgUser').value='admin';
      document.getElementById('lgPass').value=${JSON.stringify(PW)};
      document.getElementById('lgForm').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));})()`);
    await sleep(1500);
    await ev(`sessionStorage.setItem('hf-admin-session', JSON.stringify({user:'admin',role:'管理员',exp:Date.now()-1000}))`);
    await go(fileUrl('hf/truth.html'));
    check('已过期会话被判失效', /login\.html/.test(await href()));

    /* ⑨ 退出后会话清除且不可再进 */
    await ev(submit('admin', PW)); await sleep(1500);
    await ev(`document.querySelector('[data-logout]').click()`);
    await sleep(900);
    check('退出后回到登录页', /login\.html/.test(await href()));
    check('退出后会话已清除', (await ev(`sessionStorage.getItem('hf-admin-session')`)) === null);
    await go(fileUrl('hf/report.html'));
    check('退出后访问看板被拦截', /login\.html/.test(await href()));

    /* ⑩ next 开放重定向防护：外站地址不得作为回跳目标 */
    await go(fileUrl('hf/login.html') + '?next=' + encodeURIComponent('https://evil.example/steal'));
    await ev(submit('admin', PW));
    await sleep(1500);
    h = await href();
    check('外站 next 被丢弃并回落首页', /\/hf\/index\.html$/.test(h), h.split('/').pop());
    await ev(`document.querySelector('[data-logout]').click()`); await sleep(900);
    await go(fileUrl('hf/login.html') + '?next=' + encodeURIComponent('../../index.html'));
    await ev(submit('admin', PW));
    await sleep(1500);
    check('路径穿越 next 被丢弃', /\/hf\/index\.html$/.test(await href()));

    /* ⑪ 连续失败触发临时锁定，锁定期间正确口令也被拒 */
    await ev(`document.querySelector('[data-logout]').click()`); await sleep(900);
    await ev(`sessionStorage.removeItem('hf-admin-lock')`);
    for (let i = 0; i < 6; i++) { await ev(submit('admin', 'bad-' + i)); await sleep(280); }
    const lockTxt = await ev(`document.getElementById('lgErr').textContent`);
    check('连续失败给出锁定提示', !!lockTxt && /锁定|秒后/.test(lockTxt), lockTxt);
    await ev(submit('admin', PW));
    await sleep(600);
    check('锁定期间正确口令仍被拒', (await href()).indexOf('login.html') >= 0);
    const lockRaw = await ev(`sessionStorage.getItem('hf-admin-lock')`);
    check('锁定状态已写入会话存储', !!lockRaw && JSON.parse(lockRaw).until > Date.now(), lockRaw);
    await shot('v0.34-hf-登录页-锁定态.png');

    /* ⑫ 解除锁定后可正常登录，且原有功能仍可用 */
    await ev(`sessionStorage.removeItem('hf-admin-lock')`);
    await ev(submit('admin', PW));
    await sleep(1500);
    check('解除锁定后可正常登录', /\/hf\/index\.html$/.test(await href()));
    await go(fileUrl('hf/probe.html'));
    await ev(`document.querySelector('#hfRun').click()`);
    await sleep(700);
    const rows = await ev(`document.querySelectorAll('#hfProbeResult tbody tr').length`);
    check('登录后探测功能正常（10 行判定）', rows === 10, 'rows=' + rows);
    await shot('v0.34-hf-登录后侧栏.png');

    /* ⑬ 零外联 */
    check('登录与看板全程零外部请求', ext.length === 0, ext.slice(0, 4).join(' | ') || '无');

    const bad = R.filter((x) => !x.ok);
    console.log('\n==== ' + (bad.length ? 'FAIL' : 'PASS') + ' ==== ' + (R.length - bad.length) + '/' + R.length);
    if (bad.length) console.log('失败项：' + bad.map((x) => x.name).join(' / '));
  } catch (e) {
    console.error('ERR', e && e.message);
    process.exitCode = 1;
  } finally {
    try { chrome.kill(); } catch (e) {}
  }
})();
