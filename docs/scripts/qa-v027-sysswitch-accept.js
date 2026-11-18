/* v0.33 验收（原 v0.27 切换壳改造）：双系统解耦
 * 背景：幻觉模块已从功能页拆出为独立后端看板 webapp/hf/。
 * 目标：验证 ①绕过系统页不再有系统切换控件、无幻觉互链；
 *       ②看板自成体系（侧栏 9 项、独立壳、无绕过系统互链）；
 *       ③看板 9 页均可打开、零外部资源、数据引擎可用。
 * 依赖：本机 Chrome headless + CDP。 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9341;
const WEB = 'D:\\AIBBBG\\Version1\\webapp';
const OUT = 'D:\\AIBBBG\\Version1\\docs\\screenshots';
const fileUrl = (p) => 'file:///' + path.join(WEB, p).replace(/\\/g, '/');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJSON = (url) =>
  new Promise((res, rej) =>
    http.get(url, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on('error', rej)
  );

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
};

const WAF_PAGES = ['index.html', 'console.html', 'monitor.html', 'evidence.html',
  'report.html', 'settings.html', 'history.html', 'about.html', 'replay.html'];
const HF_PAGES = [
  { f: 'index', pg: 'overview' }, { f: 'probe', pg: 'probe' }, { f: 'sample', pg: 'sample' },
  { f: 'truth', pg: 'truth' }, { f: 'evidence', pg: 'evidence' }, { f: 'repair', pg: 'repair' },
  { f: 'version', pg: 'version' }, { f: 'eval', pg: 'eval' }, { f: 'report', pg: 'report' },
];

(async () => {
  let tg;
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + path.join(require('os').tmpdir(), 'qa-v027-' + Date.now()),
    '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' });
  try {
    for (let i = 0; i < 40; i++) {
      try { tg = await getJSON('http://127.0.0.1:' + PORT + '/json/list'); break; }
      catch (e) { await sleep(150); }
    }
    const WebSocket = global.WebSocket || require('ws');
    const c = new WebSocket(tg.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((res, rej) => { c.onopen = res; c.onerror = rej; });
    let id = 0;
    const pend = new Map();
    c.onmessage = (m) => { const o = JSON.parse(m.data); if (o.id && pend.has(o.id)) { pend.get(o.id)(o); pend.delete(o.id); } };
    const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); c.send(JSON.stringify({ id: i, method, params })); });
    const evalx = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
    const goto = async (u) => { await send('Page.navigate', { url: u }); await sleep(450); };
    const shot = async (name) => {
      const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(OUT, name), Buffer.from(r.result.data, 'base64'));
    };
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

    /* ① 绕过系统全部页面：无系统切换控件、无幻觉互链 */
    let swCount = 0, hfLinkCount = 0, navBroken = [];
    for (const p of WAF_PAGES) {
      await goto(fileUrl(p));
      swCount += await evalx(`document.querySelectorAll('.sys-switch').length`) || 0;
      hfLinkCount += await evalx(`[...document.querySelectorAll('a[href]')]
        .filter(a=>/(^|\/)hf(\/|_|\.html)/.test(a.getAttribute('href'))).length`) || 0;
      if (p === 'console.html') {
        const nc = await evalx(`document.querySelectorAll('.mainnav a').length + '|' + document.querySelectorAll('.tools .tool').length`);
        if (nc !== '4|3') navBroken.push(nc);
      }
    }
    check('绕过系统 9 页已无系统切换控件', swCount === 0, 'sys-switch=' + swCount);
    check('绕过系统 9 页无幻觉互链', hfLinkCount === 0, 'hf-links=' + hfLinkCount);
    check('绕过系统导航未破坏', navBroken.length === 0, 'console mainnav|tools=' + (navBroken[0] || '4|3'));

    /* ② 看板壳：侧栏 248 宽、9 项导航、当前项高亮、无绕过系统互链 */

    /* ⓿ 管理员登录：看板页面均受访问守卫保护，先真实走一遍登录流程 */
    async function hfLogin(nav, run) {
      await nav(fileUrl('hf/login.html'));
      await run("(function(){document.getElementById('lgUser').value='admin';"
        + "document.getElementById('lgPass').value='HfLab@2026';"
        + "document.getElementById('lgForm').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));})()");
      await sleep(1500);
    }
    await hfLogin(goto, evalx);
    await goto(fileUrl('hf/index.html'));
    /* 避免在模板字符串里写含 "/" 的正则字面量（会提前终止正则）；改用字符串判断 */
    const shell = await evalx(`(()=>{
      const s=document.querySelector('.hf-side');
      const nav=[...document.querySelectorAll('.hf-nav a')];
      const WAF=['index','console','monitor','evidence','report','settings','history','about','replay'];
      const back=[...document.querySelectorAll('a[href]')].filter(a=>{
        const h=(a.getAttribute('href')||'').trim();
        if(h.indexOf('../')!==0) return false;      /* 看板内部短名链接不算跨系统 */
        const name=h.slice(3);
        return WAF.some(w=>name===w+'.html');
      }).length;
      return {sideW:s?Math.round(s.getBoundingClientRect().width):0,
        nav:nav.length,
        cur:nav.filter(a=>a.getAttribute('aria-current')==='page').map(a=>a.getAttribute('data-hf-page')),
        back:back,brand:!!document.querySelector('.hf-brand')};
    })()`);
    check('看板独立侧栏存在', shell && shell.sideW === 248 && shell.brand, JSON.stringify(shell && { sideW: shell.sideW, brand: shell.brand }));
    check('侧栏导航 9 项', shell && shell.nav === 9, 'nav=' + (shell && shell.nav));
    check('概览当前项高亮', shell && shell.cur.length === 1 && shell.cur[0] === 'overview', JSON.stringify(shell && shell.cur));
    check('看板无绕过系统互链', shell && shell.back === 0, 'back=' + (shell && shell.back));

    /* ③ 看板 9 页均可打开、各自高亮正确、零外部资源 */
    let missing = [], badCur = [], ext = 0;
    for (const it of HF_PAGES) {
      await goto(fileUrl('hf/' + it.f + '.html'));
      const info = await evalx(`(()=>{const side=document.querySelector('.hf-side');
        const cur=document.querySelector('.hf-nav a[aria-current="page"]');
        const ext=[...document.querySelectorAll('script[src],link[href],img[src]')]
          .filter(t=>/^https?:/i.test(t.src||t.href||'')).length;
        return {side:!!side,cur:cur?cur.getAttribute('data-hf-page'):null,ext:ext};})()`);
      if (!info || !info.side) missing.push(it.f);
      if (!info || info.cur !== it.pg) badCur.push(it.f + ':' + (info && info.cur));
      ext += (info && info.ext) || 0;
    }
    check('看板 9 页均有侧栏壳', missing.length === 0, 'missing=' + missing.join(','));
    check('9 页当前项高亮正确', badCur.length === 0, badCur.join(','));
    check('看板 9 页零外部资源', ext === 0, 'ext=' + ext);

    /* ④ 看板数据引擎可用：probe 跑一次出 10 行，跨页 Store 生效 */
    await goto(fileUrl('hf/probe.html'));
    await evalx('sessionStorage.removeItem("hf.eval")');
    await goto(fileUrl('hf/probe.html'));
    await evalx('document.querySelector("#hfRun").click()');
    await sleep(600);
    const rows = await evalx(`document.querySelectorAll('#hfProbeResult tbody tr').length`);
    check('看板探测引擎可用（10 行）', rows === 10, 'rows=' + rows);
    await goto(fileUrl('hf/report.html'));
    const rpt = await evalx(`(()=>{const p=document.querySelector('#hfReportHost .hf-report-md');return p?p.textContent.length:0;})()`);
    check('跨页 Store 报告可生成', rpt > 400, 'len=' + rpt);

    /* ⑤ 看板无横向溢出 */
    const of = await evalx(`document.documentElement.scrollWidth + '/' + window.innerWidth`);
    check('看板无横向溢出', (() => { const [a, b] = of.split('/').map(Number); return a <= b + 1; })(), of);

    /* ⑥ 截图存档 */
    await goto(fileUrl('hf/index.html')); await sleep(250);
    await shot('v0.33-hf-看板概览.png');
    await goto(fileUrl('console.html')); await sleep(250);
    await shot('v0.33-绕过页无切换控件.png');

    const failed = results.filter((r) => !r.ok);
    console.log('\n==== ' + (results.length - failed.length) + '/' + results.length + ' PASS ====');
    if (failed.length) { console.log('FAILED:', failed.map((f) => f.name).join(', ')); process.exitCode = 1; }
  } catch (e) {
    console.error('ERR', e && e.stack || e);
    process.exitCode = 1;
  } finally {
    try { chrome.kill(); } catch (e) {}
  }
})();
