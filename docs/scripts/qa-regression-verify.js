/* QA 独立回归验证 · pendingRun 一次性意图修复（严过关 / Yan）
 * 用法：node docs/scripts/qa-regression-verify.js
 * 端口 9344（避开 e2e 的 9333）。零 npm 依赖，Node 22 全局 WebSocket + 本机 Chrome。
 * 原则：不采信工程师结论，用真实交互 + 同步采样 + 轮询（不依赖固定 sleep 判定终态）。 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const os = require('os');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9344;
const WEB = 'D:\\AIBBBG\\Version1\\webapp';
const fileUrl = p => 'file:///' + path.join(WEB, p).replace(/\\/g, '/');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) pass++; else fail++;
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${name}${detail ? ' · ' + detail : ''}`);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + path.join(os.tmpdir(), 'qa-verify-' + Date.now()),
  '--allow-file-access-from-files', 'about:blank'
], { stdio: 'ignore' });

const getJSON = url => new Promise((res, rej) => {
  http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
});

class CDP {
  constructor(wsUrl) { this.ws = new WebSocket(wsUrl); this.id = 0; this.pending = new Map(); this.events = []; }
  ready() { return new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; this.ws.onmessage = m => {
    const o = JSON.parse(m.data);
    if (o.id && this.pending.has(o.id)) { this.pending.get(o.id)(o); this.pending.delete(o.id); }
    else if (o.method) this.events.push(o);
  }; }); }
  send(method, params = {}) { const id = ++this.id; return new Promise(res => { this.pending.set(id, res); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) {
      const ex = r.result.exceptionDetails.exception;
      throw new Error(r.result.exceptionDetails.text + ' | ' + (ex && ex.description || ''));
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  }
  async goto(url) { await this.send('Page.navigate', { url }); }
}

(async () => {
  try {
    let targets;
    for (let i = 0; i < 40; i++) { try { targets = await getJSON('http://127.0.0.1:' + PORT + '/json/list'); break; } catch (e) { await sleep(150); } }
    if (!targets) throw new Error('Chrome 调试端口未就绪');
    const blank = targets.find(t => t.type === 'page');
    const c = new CDP(blank.webSocketDebuggerUrl);
    await c.ready();
    await c.send('Page.enable'); await c.send('Runtime.enable'); await c.send('Network.enable');

    const clearStore = () => c.eval(`['probe.cfg','probe.report','probe.history','probe.pendingRun','pt-nav'].forEach(k=>{try{sessionStorage.removeItem(k)}catch(e){}});document.documentElement.classList.remove('pt-cover');const o=document.getElementById('pt');if(o)o.classList.remove('show','leave');`);
    // 就绪判定必须同时满足：data-page 匹配 + window.Probe 已注入(deferred console.js 执行完) + 文档 complete。
    // 仅看 data-page 会在 body 解析后、deferred 脚本执行前误判，导致 window.Probe 尚未定义（曾踩此竞态）。
    const waitPage = async (pg, max = 60, gap = 120) => { for (let i = 0; i < max; i++) { try { const r = await c.eval(`({page:document.body&&document.body.getAttribute('data-page'),probe:!!window.Probe,rs:document.readyState})`); if (r.page === pg && r.probe === true && r.rs === 'complete') return true; } catch (e) {} await sleep(gap); } return false; };
    const waitTerminal = async (max = 140, gap = 200) => { let s = 'idle'; for (let i = 0; i < max; i++) { try { s = await c.eval(`document.querySelector('#dash').dataset.state`); if (['hit', 'nofind', 'degraded', 'oos', 'cancel', 'error'].includes(s)) break; } catch (e) {} await sleep(gap); } return s; };
    const histN = () => c.eval(`JSON.parse(sessionStorage.getItem('probe.history')||'[]').length`);
    const arm = () => c.eval(`(()=>{const u=document.querySelector('#urlInput');if(u)u.value='http://127.0.0.1/lab/sqli_01.php';const t=document.querySelector('#typeSel');if(t)t.value='sqli';const s=document.querySelector('#scriptSel');if(s)s.value='CONVERGE_3';const chk=document.querySelector('#authChk');if(chk&&!chk.checked)chk.click();return {checked:chk?chk.checked:null,disabled:document.querySelector('#startBtn').disabled};})()`);

    // ===== B1: 纯打开监控页（全清 sessionStorage）=====
    await c.goto(fileUrl('console.html')); await waitPage('console'); await clearStore();
    await c.goto(fileUrl('monitor.html')); await waitPage('monitor'); await sleep(300);
    const b1 = await c.eval(`(()=>({state:document.querySelector('#dash').dataset.state,report:!!sessionStorage.getItem('probe.report'),hint:!document.querySelector('#monitorHint').classList.contains('hidden'),hist:JSON.parse(sessionStorage.getItem('probe.history')||'[]').length}))()`);
    ok('B1 纯打开监控页 → idle', b1.state === 'idle', 'state=' + b1.state);
    ok('B1 无 report 生成', b1.report === false);
    ok('B1 显示引导空态', b1.hint === true);
    ok('B1 history=0', b1.hist === 0, 'hist=' + b1.hist);

    // ===== B2: 残留 cfg 不执行 + 只读快照回填（解耦关键证明）=====
    await c.eval(`sessionStorage.setItem('probe.cfg', JSON.stringify({url:'http://127.0.0.1/lab/sqli_01.php',vulnType:'sqli',script:'CONVERGE_3'}));`);
    await c.goto(fileUrl('monitor.html')); await waitPage('monitor'); await sleep(300);
    const b2 = await c.eval(`(()=>({state:document.querySelector('#dash').dataset.state,target:document.querySelector('#mTarget').textContent,type:document.querySelector('#mType').textContent,scope:document.querySelector('#mScope').textContent,report:!!sessionStorage.getItem('probe.report'),hist:JSON.parse(sessionStorage.getItem('probe.history')||'[]').length}))()`);
    ok('B2 残留 cfg → 不执行 idle', b2.state === 'idle', 'state=' + b2.state);
    ok('B2 未生成新 report', b2.report === false);
    ok('B2 history 不增', b2.hist === 0, 'hist=' + b2.hist);
    ok('B2 cfg 只读快照回填 mTarget', /127\.0\.0\.1/.test(b2.target), 'mTarget=' + b2.target);
    ok('B2 cfg 类型/范围仍回填', /SQL/.test(b2.type) && /靶场/.test(b2.scope), 'type=' + b2.type + ' scope=' + b2.scope);

    // ===== B3: 真实点击 —— 决定性判定 console.js handler 是否被抑制 =====
    await c.goto(fileUrl('console.html')); await waitPage('console'); await clearStore();
    const b3preArm = await arm();
    const b3pre = await c.eval(`({checked:document.querySelector('#authChk').checked,disabled:document.querySelector('#startBtn').disabled,pending:sessionStorage.getItem('probe.pendingRun'),running:window.Probe.getRunning()})`);
    ok('B3 勾选后按钮可用', b3preArm.checked === true && b3preArm.disabled === false, JSON.stringify(b3pre));
    ok('B3 点击前 pendingRun 为空', b3pre.pending === null, 'pending=' + b3pre.pending);
    ok('B3 点击前 running=false', b3pre.running === false, 'running=' + b3pre.running);
    const b3click = await c.eval(`(()=>{
      const out={};const btn=document.querySelector('#startBtn');
      btn.click();                                   /* 同步派发：捕获阶段 app.js 先执行 */
      out.pending=sessionStorage.getItem('probe.pendingRun');
      out.cfg=!!sessionStorage.getItem('probe.cfg');
      out.running=window.Probe.getRunning();         /* 决定性：console.js 的 runTask 是否被触发 */
      const d=document.querySelector('#dash');out.dash=d?d.dataset.state:'NO_DASH';
      const rs=document.querySelector('#runState');out.runState=rs?rs.textContent.replace(/\\s+/g,' ').trim():'NO_RUNSTATE';
      const tm=document.querySelector('#terminal');out.termChildren=tm?tm.children.length:'NO_TERMINAL';
      const rb=document.querySelector('#roundBody');out.roundRows=rb?rb.querySelectorAll('tr').length:'NO_ROUNDBODY';
      const pto=document.getElementById('pt');out.ptShow=pto?pto.classList.contains('show'):null;
      out.ptNav=sessionStorage.getItem('pt-nav');out.page=document.body.getAttribute('data-page');
      return out;
    })()`);
    ok('B3 点击置位 pendingRun=1', b3click.pending === '1', 'pending=' + b3click.pending);
    ok('B3 点击写入 cfg 快照', b3click.cfg === true);
    ok('B3【决定性】点击后本页 running 仍=false（console.js handler 被抑制，无本页重复执行）',
       b3click.running === false,
       'running=' + b3click.running + ' dash=' + b3click.dash + ' runState=' + b3click.runState + ' termChildren=' + b3click.termChildren + ' roundRows=' + b3click.roundRows);
    // core.js go() 同步给 #pt 加 .show；pt-nav 在 480ms 计时器里才写，故同步采样只能验 .show
    ok('B3 点击触发跨页过渡遮罩展开(#pt.show)', b3click.ptShow === true, 'ptShow=' + b3click.ptShow + ' ptNav=' + b3click.ptNav);
    ok('B3 采样时仍在 console 页（证明同步采样有效）', b3click.page === 'console', 'page=' + b3click.page);
    ok('B3 翻页到 monitor', await waitPage('monitor'));
    const b3state = await waitTerminal();
    ok('B3 监控页执行一次到终态 hit', b3state === 'hit', 'state=' + b3state);
    ok('B3 历史 0→1 仅增一条', (await histN()) === 1, 'hist=' + (await histN()));
    ok('B3 pendingRun 被消费清除', (await c.eval(`sessionStorage.getItem('probe.pendingRun')`)) === null);

    // ===== B4: 完成后刷新不重跑 =====
    await c.send('Page.reload'); await waitPage('monitor'); await sleep(300);
    const b4 = await c.eval(`(()=>({state:document.querySelector('#dash').dataset.state,hist:JSON.parse(sessionStorage.getItem('probe.history')||'[]').length,pending:!!sessionStorage.getItem('probe.pendingRun'),target:document.querySelector('#mTarget').textContent,stateTxt:document.querySelector('#dashState').textContent}))()`);
    ok('B4 刷新后 history 保持 1（不重跑）', b4.hist === 1, 'hist=' + b4.hist);
    ok('B4 刷新后无 pendingRun 残留', b4.pending === false);
    ok('B4 刷新后从 report 只读回显 hit', b4.state === 'hit' && b4.stateTxt === 'HIT', 'state=' + b4.state + ' txt=' + b4.stateTxt);
    ok('B4 刷新后 cfg 快照仍在', /127\.0\.0\.1/.test(b4.target), 'mTarget=' + b4.target);

    // ===== B5: 子页面不消费 pendingRun（合成置位后依次访问子页）=====
    await c.goto(fileUrl('console.html')); await waitPage('console'); await clearStore();
    await c.eval(`sessionStorage.setItem('probe.pendingRun','1');sessionStorage.setItem('probe.cfg',JSON.stringify({url:'http://127.0.0.1/lab/x',vulnType:'sqli',script:'CONVERGE_3'}));`);
    const b5base = await histN();
    for (const p of ['settings', 'history', 'about']) { await c.goto(fileUrl(p + '.html')); await waitPage(p); }
    const b5 = await c.eval(`({hist:JSON.parse(sessionStorage.getItem('probe.history')||'[]').length,pending:sessionStorage.getItem('probe.pendingRun')})`);
    ok('B5 子页面不触发任务(history 不增)', b5.hist === b5base, b5base + '→' + b5.hist);
    ok('B5【关键】pendingRun 不被子页面误消费(仍=1)', b5.pending === '1', 'pending=' + b5.pending);

    // ===== B5b: 子页面刷新后 pendingRun 仍在，且随后进监控页仍可消费执行 =====
    await c.send('Page.reload'); await waitPage('about'); await sleep(150);
    ok('B5b about 页刷新后 pendingRun 仍=1', (await c.eval(`sessionStorage.getItem('probe.pendingRun')`)) === '1');
    await c.goto(fileUrl('monitor.html')); await waitPage('monitor');
    const b5bState = await waitTerminal();
    ok('B5b 子页浏览后进入监控页仍执行一次(hit)', b5bState === 'hit', 'state=' + b5bState);
    ok('B5b history 仅增一条', (await histN()) === b5base + 1, 'hist=' + (await histN()));

    // ===== B6: 浏览器后退/前进（bfcache）不重跑 —— 用全新点击流隔离 history 栈 =====
    await c.goto(fileUrl('console.html')); await waitPage('console'); await clearStore();
    await arm();
    await c.eval(`document.querySelector('#startBtn').click();`);
    ok('B6 点击后翻到 monitor', await waitPage('monitor'));
    const b6run = await waitTerminal();
    ok('B6 首次执行到 hit', b6run === 'hit', 'state=' + b6run);
    const b6hist = await histN();
    ok('B6 首次执行 history=1', b6hist === 1, 'hist=' + b6hist);
    await c.eval(`history.back();`);
    ok('B6 后退到任务台', await waitPage('console'));
    await c.eval(`history.forward();`);
    ok('B6 前进回监控页', await waitPage('monitor'));
    await sleep(300);
    const b6fwd = await c.eval(`({page:document.body.getAttribute('data-page'),state:document.querySelector('#dash').dataset.state,hist:JSON.parse(sessionStorage.getItem('probe.history')||'[]').length,pending:!!sessionStorage.getItem('probe.pendingRun')})`);
    ok('B6 前进后 history 不增（不重跑）', b6fwd.hist === b6hist, b6hist + '→' + b6fwd.hist);
    ok('B6 前进后 dash 终态仍 hit', b6fwd.state === 'hit', 'state=' + b6fwd.state);
    ok('B6 前进后无 pendingRun 残留', b6fwd.pending === false);

    // ===== C7: pendingRun 残留但无 cfg（读即清 / 不误触发）=====
    await c.goto(fileUrl('monitor.html')); await waitPage('monitor'); await clearStore();
    await c.eval(`sessionStorage.setItem('probe.pendingRun','1');`);
    await c.goto(fileUrl('monitor.html')); await waitPage('monitor'); await sleep(300);
    const c7 = await c.eval(`(()=>({state:document.querySelector('#dash').dataset.state,hist:JSON.parse(sessionStorage.getItem('probe.history')||'[]').length,pending:sessionStorage.getItem('probe.pendingRun'),hint:!document.querySelector('#monitorHint').classList.contains('hidden'),report:!!sessionStorage.getItem('probe.report')}))()`);
    ok('C7 pending 无 cfg → 不执行 idle', c7.state === 'idle', 'state=' + c7.state);
    ok('C7 pending 无 cfg → history=0', c7.hist === 0, 'hist=' + c7.hist);
    ok('C7 pending 无 cfg → 无 report', c7.report === false);
    ok('C7 读即清：pending 被无条件清除（不遗留误触发）', c7.pending === null, 'pending=' + c7.pending);
    ok('C7 无 cfg 显示引导空态', c7.hint === true);

    // ===== C9: 越界/降级剧本经新触发链语义正确 =====
    await clearStore();
    await c.eval(`sessionStorage.setItem('probe.pendingRun','1');sessionStorage.setItem('probe.cfg',JSON.stringify({url:'http://127.0.0.1/lab/x',vulnType:'sqli',script:'DEGRADED'}));`);
    await c.goto(fileUrl('monitor.html')); await waitPage('monitor');
    const c9d = await waitTerminal();
    ok('C9 DEGRADED 经 pendingRun → degraded', c9d === 'degraded', 'state=' + c9d);
    const c9dinfo = await c.eval(`(()=>({lit:[...document.querySelectorAll('.sit__node.is-lit')].length,deg:[...document.querySelectorAll('.sit__node.is-degraded')].length,txt:document.querySelector('#dashState').textContent}))()`);
    ok('C9 DEGRADED 4轮点亮+3降级节点', c9dinfo.lit === 4 && c9dinfo.deg === 3, 'lit=' + c9dinfo.lit + ' deg=' + c9dinfo.deg + ' txt=' + c9dinfo.txt);
    await clearStore();
    await c.eval(`sessionStorage.setItem('probe.pendingRun','1');sessionStorage.setItem('probe.cfg',JSON.stringify({url:'https://example.com/x',vulnType:'sqli',script:'CONVERGE_3'}));`);
    await c.goto(fileUrl('monitor.html')); await waitPage('monitor');
    const c9o = await waitTerminal();
    ok('C9 越界经 pendingRun → oos', c9o === 'oos', 'state=' + c9o);

    // ===== C10: 零外部请求（本 harness 全程累积事件）=====
    const ext = c.events.filter(e => e.method === 'Network.requestWillBeSent').map(e => e.params.request.url).filter(u => /^https?:/.test(u) && !/127\.0\.0\.1:9344/.test(u));
    ok('C10 全程零外部 http(s) 请求', ext.length === 0, 'extCount=' + ext.length + (ext.length ? ' ' + ext.slice(0, 3).join(',') : ''));

    // ===== C10b: 报告打印仅 #report 且 5 附录 =====
    await clearStore();
    await c.eval(`sessionStorage.setItem('probe.pendingRun','1');sessionStorage.setItem('probe.cfg',JSON.stringify({url:'http://127.0.0.1/lab/x',vulnType:'sqli',script:'CONVERGE_3'}));`);
    await c.goto(fileUrl('monitor.html')); await waitPage('monitor'); await waitTerminal();
    await c.goto(fileUrl('report.html')); await waitPage('report');
    await c.send('Emulation.setEmulatedMedia', { media: 'print' });
    const c10b = await c.eval(`(()=>({topbar:getComputedStyle(document.querySelector('.topbar')).display,report:getComputedStyle(document.querySelector('#reportCard')).display,secs:document.querySelectorAll('#reportCard .report-sec').length}))()`);
    ok('C10b 打印隐藏顶栏', c10b.topbar === 'none', 'topbar=' + c10b.topbar);
    ok('C10b 打印仅报告可见且 5 附录', c10b.report !== 'none' && c10b.secs === 5, 'report=' + c10b.report + ' secs=' + c10b.secs);
    await c.send('Emulation.setEmulatedMedia', { media: '' });

    // ===== C10c: prefers-reduced-motion 语义静态保留 =====
    await c.send('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await clearStore();
    await c.eval(`sessionStorage.setItem('probe.pendingRun','1');sessionStorage.setItem('probe.cfg',JSON.stringify({url:'http://127.0.0.1/lab/x',vulnType:'sqli',script:'CONVERGE_3'}));`);
    await c.goto(fileUrl('monitor.html')); await waitPage('monitor'); await waitTerminal();
    const c10c = await c.eval(`(()=>({spin:getComputedStyle(document.querySelector('.spin')).animationName,lit:[...document.querySelectorAll('.sit__node.is-lit')].length,state:document.querySelector('#dash').dataset.state}))()`);
    ok('C10c RM 动画关闭', c10c.spin === 'none', 'spin=' + c10c.spin);
    ok('C10c RM 语义静态保留(3节点点亮+hit)', c10c.lit === 3 && c10c.state === 'hit', 'lit=' + c10c.lit + ' state=' + c10c.state);
    await c.send('Emulation.setEmulatedMedia', { media: '' });

  } catch (e) {
    fail++; console.log('[ERROR] ' + (e && e.stack || e));
  } finally {
    chrome.kill('SIGKILL');
    console.log('\n========================================');
    console.log('合计: ' + (pass + fail) + '  通过: ' + pass + '  失败: ' + fail);
    console.log('========================================');
    process.exit(fail ? 1 : 0);
  }
})();
