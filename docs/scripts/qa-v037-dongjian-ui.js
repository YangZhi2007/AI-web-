/* v0.37 验收：洞鉴展示页视觉与结构
 * 范围：dongjian/web 的 index.html 与 report.html。
 * 验证点：
 *   ① 两页无运行时异常、无外部请求（file:// 打开，仅本地脚本/样式）；
 *   ② 大屏渲染 6 个阶段、进度条、日志区，提交后进入 mock 演示态；
 *   ③ 报告页渲染 4 张摘要卡与 3 条发现，双轨（◆ 假设 / ■ 裁决）齐全；
 *   ④ 界面无 emoji、无渐变文字、无发光（CSS 静态核对）；
 *   ⑤ 产出两张真实渲染截图供 unslop 核对。
 * 依赖：本机 Chrome headless + CDP（与 qa-v036 同款）。 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9458;
const WEB = 'D:\\AIBBBG\\Version1\\dongjian\\web';
const OUT = 'D:\\AIBBBG\\Version1\\docs\\screenshots';
const fileUrl = (p) => 'file:///' + path.join(WEB, p).replace(/\\/g, '/');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJSON = (u) => new Promise((res, rej) =>
  http.get(u, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej));

const R = [];
const check = (name, ok, detail) => {
  R.push({ name, ok: !!ok });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
};

(async () => {
  let tg;
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + path.join(require('os').tmpdir(), 'qa-v037-' + Date.now()),
    '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' });
  try {
    for (let i = 0; i < 40; i++) {
      try { tg = await getJSON('http://127.0.0.1:' + PORT + '/json/list'); break; }
      catch (e) { await sleep(150); }
    }
    const WS = global.WebSocket || require('ws');
    const c = new WS(tg.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((res, rej) => { c.onopen = res; c.onerror = rej; });
    let id = 0; const pm = new Map(); const ext = []; const errs = [];
    c.onmessage = (m) => {
      const o = JSON.parse(m.data);
      if (o.id && pm.has(o.id)) { pm.get(o.id)(o); pm.delete(o.id); }
      if (o.method === 'Network.requestWillBeSent') {
        const u = o.params.request.url;
        if (!/^(file|data|blob|about):/i.test(u)) ext.push(u);
      }
      if (o.method === 'Runtime.exceptionThrown') errs.push(o.params.exceptionDetails.text);
    };
    const send = (m, p = {}) => new Promise((res) => { const i = ++id; pm.set(i, res); c.send(JSON.stringify({ id: i, method: m, params: p })); });
    const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
    const go = async (u) => { await send('Page.navigate', { url: u }); await sleep(600); };
    const shot = async (n) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, n), Buffer.from(r.result.data, 'base64')); };
    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });

    // ① 大屏初始态
    await go(fileUrl('index.html'));
    const home = await ev(`({
      title:document.title,
      stages:document.querySelectorAll('.stage').length,
      submit:!!document.querySelector('#startBtn'),
      logEmpty:!!document.querySelector('.logbook__empty'),
      progress:document.querySelector('#progressNum').textContent
    })`);
    check('大屏渲染六阶段与提交区', home && home.stages === 6 && home.submit && home.progress === '0%', JSON.stringify(home));
    await shot('v0.37-洞鉴-验真大屏-初始.png');

    // ② 点击开始 → mock 演示推进
    await ev(`document.querySelector('#startBtn').click()`);
    await sleep(2200);
    const running = await ev(`({
      active:document.querySelectorAll('.stage.is-active').length,
      done:document.querySelectorAll('.stage.is-done').length,
      logs:document.querySelectorAll('.logbook__line').length,
      btn:document.querySelector('#startBtn').textContent,
      msg:document.querySelector('#msg').textContent
    })`);
    check('点击后进入演示态并逐阶段推进', running && (running.active + running.done) > 0 && running.logs > 0 && /模拟|演示/.test(running.msg), JSON.stringify(running));
    await shot('v0.37-洞鉴-验真大屏-运行中.png');

    // ③ 报告页
    await go(fileUrl('report.html?id=DJ-TEST'));
    const rp = await ev(`({
      cards:document.querySelectorAll('.metacard').length,
      findings:document.querySelectorAll('.finding').length,
      claimTracks:document.querySelectorAll('.track--claim').length,
      verdictTracks:document.querySelectorAll('.track--verdict').length,
      confirmed:document.querySelectorAll('.finding__verdict.is-confirmed').length,
      rejected:document.querySelectorAll('.finding__verdict.is-rejected').length,
      source:(document.querySelectorAll('.metacard__value')[3]||{}).textContent
    })`);
    check('报告页摘要卡与发现齐全', rp && rp.cards === 4 && rp.findings === 3, JSON.stringify(rp));
    check('双轨对照齐全（假设/裁决各 3）', rp && rp.claimTracks === 3 && rp.verdictTracks === 3);
    check('裁决含成立与证伪两种', rp && rp.confirmed === 2 && rp.rejected === 1);
    check('演示数据如实标注', rp && /演示/.test(rp.source || ''), rp && rp.source);
    await shot('v0.37-洞鉴-证据链报告.png');

    // ④ 静态 CSS 核对
    const css = fs.readFileSync(path.join(WEB, 'css/app.css'), 'utf-8');
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(css);
    const gradientText = /background-clip:\s*text|-webkit-background-clip:\s*text/.test(css);
    const glow = /box-shadow:[^;]*(blur|[0-9]{2,}px\s+[0-9]{2,}px\s+[0-9]{2,}px)/.test(css);
    check('CSS 无 emoji / 渐变文字 / 发光', !emoji && !gradientText && !glow,
      JSON.stringify({ emoji, gradientText, glow }));

    // ⑤ 零外联、零异常
    check('零外部请求', ext.length === 0, ext.join(', '));
    check('零运行时异常', errs.length === 0, errs.join(' | '));

  } finally {
    try { chrome.kill('SIGKILL'); } catch (e) {}
  }
  const pass = R.filter((r) => r.ok).length;
  console.log('\n==== 合计 ' + pass + '/' + R.length + ' PASS ====');
  if (pass !== R.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
