/* v0.27 验收：系统切换壳
 * 目标：在不动现有绕过系统各页 HTML 的前提下，core.js 注入双功能区切换控件，
 *       hf.html 作为幻觉系统占位首页，双向可达、入口禁用、零外联、现有页无回归。
 * 依赖：本机 Chrome headless + CDP（沿用 shot-pages.js 方案）。 */
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
    http
      .get(url, (r) => {
        let d = '';
        r.on('data', (c) => (d += c));
        r.on('end', () => {
          try { res(JSON.parse(d)); } catch (e) { rej(e); }
        });
      })
      .on('error', rej)
  );

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
};

(async () => {
  let tg;
  const chrome = spawn(
    CHROME,
    [
      '--headless=new', '--disable-gpu', '--no-first-run',
      '--remote-debugging-port=' + PORT,
      '--user-data-dir=' + path.join(require('os').tmpdir(), 'qa-v027-' + Date.now()),
      '--allow-file-access-from-files', 'about:blank',
    ],
    { stdio: 'ignore' }
  );
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
    c.onmessage = (m) => {
      const o = JSON.parse(m.data);
      if (o.id && pend.has(o.id)) { pend.get(o.id)(o); pend.delete(o.id); }
    };
    const send = (method, params = {}) =>
      new Promise((res) => { const i = ++id; pend.set(i, res); c.send(JSON.stringify({ id: i, method, params })); });
    const evalx = async (e) => {
      const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
      return r.result && r.result.result ? r.result.result.value : undefined;
    };
    const goto = async (u) => { await send('Page.navigate', { url: u }); await sleep(450); };
    const shot = async (name) => {
      const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(OUT, name), Buffer.from(r.result.data, 'base64'));
    };
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

    // ① 现有绕过页：切换控件被注入，当前项指向绕过
    await goto(fileUrl('console.html'));
    await evalx('sessionStorage.clear()');
    await goto(fileUrl('console.html'));
    const swOnConsole = await evalx(`(()=>{const n=document.querySelector('.sys-switch');if(!n)return null;
      const a=[...n.querySelectorAll('a')].map(x=>({sys:x.dataset.sys,href:x.getAttribute('href'),cur:x.getAttribute('aria-current')==='page'}));
      return {count:a.length,a};})()`);
    check('绕过页注入切换控件', swOnConsole && swOnConsole.count === 2, JSON.stringify(swOnConsole));
    check('绕过页当前项=绕过', swOnConsole && swOnConsole.a.some((x) => x.cur && x.sys === 'waf'));
    check('切换含幻觉入口', swOnConsole && swOnConsole.a.some((x) => x.sys === 'hf' && x.href === 'hf.html'));

    // ② 现有页无回归：主导航 4 项 + 工具 3 项仍在
    const navCount = await evalx(`document.querySelectorAll('.mainnav a').length + '|' + document.querySelectorAll('.tools .tool').length`);
    check('现有页导航未破坏', navCount === '4|3', 'mainnav|tools=' + navCount);

    // ③ 幻觉页：当前项指向幻觉，8 入口全禁用，切回入口存在
    await goto(fileUrl('hf.html'));
    await evalx('sessionStorage.clear()');
    await goto(fileUrl('hf.html'));
    const swOnHf = await evalx(`(()=>{const n=document.querySelector('.sys-switch');if(!n)return null;
      return {count:n.querySelectorAll('a').length,
        cur:[...n.querySelectorAll('a')].filter(x=>x.getAttribute('aria-current')==='page').map(x=>x.dataset.sys),
        back:[...n.querySelectorAll('a')].some(x=>x.dataset.sys==='waf'&&x.getAttribute('href')==='index.html')};})()`);
    check('幻觉页当前项=幻觉', swOnHf && swOnHf.cur.length === 1 && swOnHf.cur[0] === 'hf', JSON.stringify(swOnHf));
    check('幻觉页可切回绕过', swOnHf && swOnHf.back);
    /* v0.30 结构升级：8 入口卡片中 4 个已上线(链接)、4 个规划(禁用按钮)。
       二级导航也用 data-hf-page，故选择器限定到 #hfGrid .hf-page。 */
    const pages = await evalx(`(()=>{const b=[...document.querySelectorAll('#hfGrid .hf-page')];
      const links=b.filter(x=>x.tagName==='A'&&x.getAttribute('href'));
      const disabled=b.filter(x=>x.tagName==='BUTTON'&&x.disabled);
      return {n:b.length,links:links.length,disabled:disabled.length,
        titles:b.map(x=>x.querySelector('.hf-page__title').textContent),
        linkHrefs:links.map(x=>x.getAttribute('href'))};})()`);
    check('幻觉页 8 入口', pages && pages.n === 8, 'n=' + (pages && pages.n));
    check('4 入口已上线为链接', pages && pages.links === 4, 'links=' + (pages && pages.links));
    check('4 入口仍禁用占位', pages && pages.disabled === 4, 'disabled=' + (pages && pages.disabled));
    check('已上线链接指向真实页', pages && ['hf_probe.html','hf_sample.html','hf_truth.html','hf_eval.html']
      .every(h => pages.linkHrefs.includes(h)), JSON.stringify(pages && pages.linkHrefs));
    check('入口标题齐全', pages && ['探测面板','样本溯源','真值库','评测对比','报告导出']
      .every((t) => pages.titles.includes(t)), JSON.stringify(pages && pages.titles));

    // ④ 零外联：页面无 http(s) 资源引用（仅文本里的示意 URL 不算）
    const ext = await evalx(`(()=>{const tags=[...document.querySelectorAll('script[src],link[href],img[src]')];
      return tags.filter(t=>/^https?:/i.test(t.src||t.href||'')).length;})()`);
    check('幻觉页零外部资源', ext === 0, 'external=' + ext);

    // ⑤ 落地页也注入切换控件（site-head），当前项=绕过
    await goto(fileUrl('index.html'));
    const swOnIndex = await evalx(`(()=>{const n=document.querySelector('.site-head .sys-switch');if(!n)return null;
      return [...n.querySelectorAll('a')].map(x=>({sys:x.dataset.sys,cur:x.getAttribute('aria-current')==='page'}));})()`);
    check('落地页注入切换', swOnIndex && swOnIndex.length === 2, JSON.stringify(swOnIndex));
    check('落地页当前项=绕过', swOnIndex && swOnIndex.some((x) => x.cur && x.sys === 'waf'));

    // 截图存档
    await goto(fileUrl('hf.html'));
    await sleep(300);
    await shot('功能页-1440-v0.27-幻觉系统切换壳.png');
    await evalx('window.scrollTo(0,460)');
    await sleep(200);
    await shot('功能页-1440-v0.27-幻觉系统切换壳-页面规划.png');
    await goto(fileUrl('console.html'));
    await sleep(300);
    await shot('功能页-1440-v0.27-绕过页切换控件.png');

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
