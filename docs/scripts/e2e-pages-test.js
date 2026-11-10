/* v0.17 翻页式架构 · 端到端 CDP 验收
 * 用法：node docs/scripts/e2e-pages-test.js
 * 依赖：本机 Chrome + Node 22 全局 WebSocket（零 npm 依赖）。
 * 覆盖：菜单翻页 / 任务台提交→监控页自动执行 / 6 类终态 / 跨页数据恢复 /
 *       高饱和配色 / 无溢出 / 44px 命中 / RM / 打印 / file:// 零外部请求。 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;
const WEB = 'D:\\AIBBBG\\Version1\\webapp';
const fileUrl = p => 'file:///' + path.join(WEB, p).replace(/\\/g, '/');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('[PASS] ' + name + (detail ? ' · ' + detail : '')); }
  else { fail++; console.log('[FAIL] ' + name + (detail ? ' · ' + detail : '')); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* --- 启动 headless Chrome --- */
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + path.join(require('os').tmpdir(), 'probe-e2e-' + Date.now()),
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
    if (r.result && r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.text);
    return r.result && r.result.result ? r.result.result.value : undefined;
  }
  async goto(url) { await this.send('Page.navigate', { url }); await sleep(500); }
  async viewport(w, h) { await this.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }); }
}

(async () => {
  try {
    // 等 Chrome 调试端口
    let targets;
    for (let i = 0; i < 40; i++) { try { targets = await getJSON('http://127.0.0.1:' + PORT + '/json/list'); break; } catch (e) { await sleep(150); } }
    if (!targets) throw new Error('Chrome 调试端口未就绪');
    const blank = targets.find(t => t.type === 'page');
    const c = new CDP(blank.webSocketDebuggerUrl);
    await c.ready();
    await c.send('Page.enable'); await c.send('Runtime.enable');
    await c.send('Network.enable');

    // ---- 1. 任务台：高饱和配色 + 顶栏菜单 + 44px 命中 ----
    await c.viewport(1440, 900);
    await c.goto(fileUrl('console.html'));
    const consoleInfo = await c.eval(`(()=>{
      const bg=getComputedStyle(document.body).backgroundColor;
      const accent=getComputedStyle(document.documentElement).getPropertyValue('--key').trim();
      const navs=[...document.querySelectorAll('.mainnav a')].map(a=>a.textContent.trim());
      const tools=[...document.querySelectorAll('.tool')].map(a=>a.getAttribute('data-page'));
      const starts=getComputedStyle(document.querySelector('#startBtn')).backgroundColor;
      const rects=[...document.querySelectorAll('button,input,select,a.brand,.tool,.mainnav a')].map(e=>{const r=e.getBoundingClientRect();return {t:e.tagName+'.'+e.className,w:Math.round(r.width),h:Math.round(r.height)};});
      const under44=rects.filter(r=>r.w>0&&r.h>0&&(r.w<44||r.h<44));
      return {bg,accent,navs,tools,starts,under44,page:document.body.getAttribute('data-page')};
    })()`);
    ok('任务台 data-page=console', consoleInfo.page === 'console');
    ok('亮底（非暗黑）', /^rgb\(24[0-9], 24[0-9], 23[0-9]\)/.test(consoleInfo.bg) || consoleInfo.bg.indexOf('242') > -1, 'bg=' + consoleInfo.bg);
    ok('高饱和主色 token 存在', !!consoleInfo.accent, '--key=' + consoleInfo.accent);
    ok('主导航 4 项', consoleInfo.navs.length === 4, consoleInfo.navs.join('/'));
    ok('工具区 3 个子页面', consoleInfo.tools.length === 3, consoleInfo.tools.join('/'));
    ok('1440 宽交互目标无 <44px', consoleInfo.under44.length === 0, JSON.stringify(consoleInfo.under44.slice(0, 4)));

    // ---- 2. 提交任务 → 触发翻页到监控页（直接设 Store 后导航，模拟捕获阶段写入）----
    await c.eval(`sessionStorage.setItem('probe.cfg', JSON.stringify({url:'http://127.0.0.1/lab/sqli_01.php',vulnType:'sqli',script:'CONVERGE_3'}));`);
    await c.goto(fileUrl('monitor.html'));
    // 轮询 dataset.state 到终态（轮询，不固定 sleep）
    let dashState = 'idle', tries = 0;
    while (tries++ < 80) {
      dashState = await c.eval(`document.querySelector('#dash').dataset.state`);
      if (['hit','nofind','degraded','oos','cancel','error'].includes(dashState)) break;
      await sleep(250);
    }
    ok('监控页自动执行到终态 hit', dashState === 'hit', 'state=' + dashState);
    // 终态转场 320ms：等过渡完成再采样 opacity，避免读到动画中间值（假阴性）
    await sleep(420);
    const mon = await c.eval(`(()=>{
      const nodes=[...document.querySelectorAll('.sit__node.is-lit')].length;
      const keyPath=getComputedStyle(document.querySelector('.sit__path--key')).opacity;
      const stateTxt=document.querySelector('#dashState').textContent;
      const runTxt=document.querySelector('#runState').textContent;
      const sent=document.querySelector('#dSent').textContent;
      const bgDark=getComputedStyle(document.querySelector('#dash')).backgroundColor;
      const hasReport=!!sessionStorage.getItem('probe.report');
      const hasHistory=JSON.parse(sessionStorage.getItem('probe.history')||'[]').length;
      return {nodes,keyPath,stateTxt,runTxt,sent,bgDark,hasReport,hasHistory};
    })()`);
    ok('态势节点按轮点亮(3)', mon.nodes === 3, 'lit=' + mon.nodes);
    ok('命中关键路径高亮', parseFloat(mon.keyPath) >= 0.9, 'opacity=' + mon.keyPath);
    ok('状态灯文案 HIT', mon.stateTxt === 'HIT', mon.stateTxt);
    ok('运行面板 RUN COMPLETE', /RUN COMPLETE/.test(mon.runTxt), mon.runTxt.trim());
    ok('态势台深色焦点', /rgb\(12, 20, 24\)/.test(mon.bgDark), mon.bgDark);
    ok('报告已跨页持久化', mon.hasReport === true);
    ok('历史已跨页持久化', mon.hasHistory >= 1, 'n=' + mon.hasHistory);

    // ---- 3. 证据链页恢复逐轮表 ----
    await c.goto(fileUrl('evidence.html'));
    const ev = await c.eval(`(()=>({
      rows:document.querySelectorAll('#roundBody tr').length,
      keyRows:document.querySelectorAll('#roundBody tr.is-key').length,
      verdict:document.querySelector('#verdictWord').textContent,
      state:document.querySelector('#evidenceState').textContent,
      wrapHidden:document.querySelector('#evidenceWrap').classList.contains('hidden')
    }))()`);
    ok('证据页恢复逐轮表(3 行)', ev.rows === 3, 'rows=' + ev.rows);
    ok('关键路径高亮命中轮', ev.keyRows === 1, 'key=' + ev.keyRows);
    ok('结论已检出', ev.verdict === '已检出', ev.verdict);
    ok('证据页状态 HIT', ev.state === 'HIT', ev.state);
    ok('证据内容可见', ev.wrapHidden === false);

    // ---- 4. 报告页恢复 5 附录 ----
    await c.goto(fileUrl('report.html'));
    const rp = await c.eval(`(()=>({
      secs:document.querySelectorAll('#reportCard .report-sec').length,
      hasExport:!!document.querySelector('#exportBtn'),
      emptyHidden:document.querySelector('#reportEmpty').classList.contains('hidden'),
      wrapHidden:document.querySelector('#reportCardWrap').classList.contains('hidden')
    }))()`);
    ok('报告 5 附录齐全', rp.secs === 5, 'secs=' + rp.secs);
    ok('导出 PDF 按钮在', rp.hasExport === true);
    ok('报告内容可见', rp.emptyHidden === true && rp.wrapHidden === false);

    // ---- 5. 历史页恢复 ----
    await c.goto(fileUrl('history.html'));
    const hi = await c.eval(`(()=>({rows:document.querySelectorAll('#historyBody tr').length,frameHidden:document.querySelector('#historyFrame').classList.contains('hidden')}))()`);
    ok('历史页恢复记录(≥1)', hi.rows >= 1 && hi.frameHidden === false, 'rows=' + hi.rows);

    // ---- 6. 小功能子页面可达 ----
    for (const p of ['settings', 'history', 'about']) {
      await c.goto(fileUrl(p + '.html'));
      const pg = await c.eval(`document.body.getAttribute('data-page')`);
      ok('子页面 ' + p + ' 可达', pg === p);
    }

    // ---- 7. NO_CONVERGE → nofind（不被覆盖）----
    await c.eval(`sessionStorage.setItem('probe.cfg', JSON.stringify({url:'http://127.0.0.1/lab/x',vulnType:'sqli',script:'NO_CONVERGE'}));`);
    await c.goto(fileUrl('monitor.html'));
    let st2 = 'idle', t2 = 0;
    while (t2++ < 100) { st2 = await c.eval(`document.querySelector('#dash').dataset.state`); if (['hit','nofind','degraded','oos','cancel','error'].includes(st2)) break; await sleep(250); }
    ok('NO_CONVERGE → nofind（关键回归不被覆盖）', st2 === 'nofind', 'state=' + st2);

    // ---- 8. 越界 → oos ----
    await c.eval(`sessionStorage.setItem('probe.cfg', JSON.stringify({url:'https://example.com/x',vulnType:'sqli',script:'CONVERGE_3'}));`);
    await c.goto(fileUrl('monitor.html'));
    let st3 = 'idle', t3 = 0;
    while (t3++ < 80) { st3 = await c.eval(`document.querySelector('#dash').dataset.state`); if (['hit','nofind','degraded','oos','cancel','error'].includes(st3)) break; await sleep(250); }
    ok('越界 → oos', st3 === 'oos', 'state=' + st3);

    // ---- 9. 390 响应式无溢出 ----
    await c.viewport(390, 844);
    await c.goto(fileUrl('console.html'));
    const mob = await c.eval(`(()=>({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth}))()`);
    ok('390 宽无横向溢出', mob.sw <= mob.cw + 1, 'scrollW=' + mob.sw + ' clientW=' + mob.cw);

    // ---- 9b. 各页主按钮文字对比度（运行时实测，WCAG）----
    const wcag = `function lum(hex){const h=hex.replace('#','');const c=[0,2,4].map(i=>parseInt(h.substr(i,2),16)/255).map(v=>v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4));return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2];}
      function cr(a,b){const x=lum(a),y=lum(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);}
      function hexOf(rgb){const m=rgb.match(/\\d+/g);return m?'#'+m.slice(0,3).map(n=>(+n).toString(16).padStart(2,'0')).join(''):rgb;}`;
    const btnRatios = [];
    for (const p of ['console','monitor','evidence','report','settings','history','about']) {
      await c.viewport(1440, 900);
      await c.goto(fileUrl(p + '.html'));
      const r = await c.eval(`(()=>{ ${wcag}
        const b=document.querySelector('.btn-solid')||document.querySelector('.btn-grad');
        if(!b) return null;
        const cs=getComputedStyle(b);
        const ratio=cr(hexOf(cs.color),hexOf(cs.backgroundColor));
        return {page:'${p}',ratio:+ratio.toFixed(2),fg:cs.color,bg:cs.backgroundColor};
      })()`);
      if (r) btnRatios.push(r);
    }
    const badBtn = btnRatios.filter(r => r.ratio < 4.5);
    ok('各页主按钮文字对比度 ≥4.5:1', badBtn.length === 0,
      btnRatios.map(r => r.page + ':' + r.ratio).join(' ') + (badBtn.length ? ' BAD=' + JSON.stringify(badBtn) : ''));
    await c.viewport(1440, 900);

    // ---- 10. 零外部请求（全程事件）----
    const ext = c.events.filter(e => e.method === 'Network.requestWillBeSent')
      .map(e => e.params.request.url).filter(u => /^https?:/.test(u) && !/127\.0\.0\.1:9333/.test(u));
    ok('零外部 http(s) 请求', ext.length === 0, ext.slice(0, 3).join(', '));

    // ---- 11. 打印模式仅报告 ----
    await c.viewport(1440, 900);
    await c.goto(fileUrl('report.html'));
    await c.send('Emulation.setEmulatedMedia', { media: 'print' });
    const pr = await c.eval(`(()=>({
      topbar:getComputedStyle(document.querySelector('.topbar')).display,
      report:getComputedStyle(document.querySelector('#reportCard')).display,
      secs:document.querySelectorAll('#reportCard .report-sec').length
    }))()`);
    ok('打印隐藏顶栏', pr.topbar === 'none', pr.topbar);
    ok('打印报告可见且 5 附录', pr.report !== 'none' && pr.secs === 5, 'display=' + pr.report + ' secs=' + pr.secs);
    await c.send('Emulation.setEmulatedMedia', { media: '' });

    // ---- 12. reduced-motion 降级 ----
    await c.send('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await c.eval(`sessionStorage.setItem('probe.cfg', JSON.stringify({url:'http://127.0.0.1/lab/x',vulnType:'sqli',script:'CONVERGE_3'}));`);
    await c.goto(fileUrl('monitor.html'));
    let st4 = 'idle', t4 = 0;
    while (t4++ < 80) { st4 = await c.eval(`document.querySelector('#dash').dataset.state`); if (['hit','nofind','degraded','oos','cancel','error'].includes(st4)) break; await sleep(200); }
    const rm = await c.eval(`(()=>({
      spin:getComputedStyle(document.querySelector('.spin')).animationName,
      nodeLit:[...document.querySelectorAll('.sit__node.is-lit')].length,
      state:document.querySelector('#dash').dataset.state
    }))()`);
    ok('RM 动画关闭', rm.spin === 'none', 'animation=' + rm.spin);
    ok('RM 语义静态保留（节点点亮）', rm.nodeLit === 3 && rm.state === 'hit', 'lit=' + rm.nodeLit);

  } catch (e) {
    fail++; console.log('[ERROR] ' + (e && e.stack || e));
  } finally {
    chrome.kill('SIGKILL');
    console.log('\n--------------------------------------------------');
    console.log('合计: ' + (pass + fail) + '  通过: ' + pass + '  失败: ' + fail);
    console.log('==================================================');
    process.exit(fail ? 1 : 0);
  }
})();
