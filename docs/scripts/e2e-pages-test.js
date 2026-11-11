/* v0.18 SOC 攻防仪表 · 端到端 CDP 验收
 * 用法：node docs/scripts/e2e-pages-test.js
 * 依赖：本机 Chrome + Node 22 全局 WebSocket（零 npm 依赖）。
 * 覆盖：菜单翻页 / 仅点击「开始分析」才触发（浏览·残留 cfg·刷新·跨页导航均不执行）/
 *       6 类终态 / 跨页数据恢复 / 克制冷静配色 / 攻防四段拓扑 / 数据流线型 /
 *       状态形状编码 / 呈现层阶段反馈 / 无溢出 / 44px 命中 / RM / 打印 / file:// 零外部请求。
 * 注：颜色断言按「亮度 / 色度语义」判定，不写死某个版本的 hex，避免换色即误报。*/
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

    // 辅助：等待目标页 data-page（core.js 跨页过渡 480ms + 新文档加载 + app.js 初始化）
    const waitPage = async (pg, max = 50) => {
      for (let i = 0; i < max; i++) {
        try { const cur = await c.eval(`document.body&&document.body.getAttribute('data-page')`); if (cur === pg) return true; } catch (e) {}
        await sleep(150);
      }
      return false;
    };
    // 辅助：清空跨页 Store 全部键（含一次性意图标记），保证用例互不污染
    const clearStore = () => c.eval(`['probe.cfg','probe.report','probe.history','probe.pendingRun'].forEach(k=>{try{sessionStorage.removeItem(k)}catch(e){}});`);
    // 辅助：轮询 dash 到任一终态
    const waitTerminal = async (max = 100, gap = 250) => {
      let s = 'idle';
      for (let i = 0; i < max; i++) {
        s = await c.eval(`document.querySelector('#dash').dataset.state`);
        if (['hit','nofind','degraded','oos','cancel','error'].includes(s)) break;
        await sleep(gap);
      }
      return s;
    };
    /* 颜色语义判定：亮度用于区分亮底 / 深色焦点，色度用于区分高饱和撞色 / 克制冷静。
       均按 WCAG 相对亮度与 RGB 色度实算，不依赖具体 hex 字面量。 */
    const rgb = s => (String(s).match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const lumRGB = s => { const c = rgb(s).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    const chroma = s => { const a = rgb(s); return a.length === 3 ? (Math.max(...a) - Math.min(...a)) / 255 : 1; };

    // ---- 1. 任务台：高饱和配色 + 顶栏菜单 + 44px 命中 ----
    await c.viewport(1440, 900);
    await c.goto(fileUrl('console.html'));
    await clearStore();  // 干净基线：清空跨页 Store（历史报告/配置/一次性意图）
    const consoleInfo = await c.eval(`(()=>{
      const bg=getComputedStyle(document.body).backgroundColor;
      const accent=getComputedStyle(document.documentElement).getPropertyValue('--key').trim();
      const navs=[...document.querySelectorAll('.mainnav a')].map(a=>a.textContent.trim());
      const tools=[...document.querySelectorAll('.tool')].map(a=>a.getAttribute('data-page'));
      const starts=getComputedStyle(document.querySelector('#startBtn')).backgroundColor;
      /* 用临时元素解析 var(--key) 的最终色值，验证单一低饱和 accent（不再每页一色） */
      const probe=document.createElement('span'); probe.style.color='var(--key)'; document.body.appendChild(probe);
      const keyRGB=getComputedStyle(probe).color; probe.remove();
      const rects=[...document.querySelectorAll('button,input,select,a.brand,.tool,.mainnav a')].map(e=>{const r=e.getBoundingClientRect();return {t:e.tagName+'.'+e.className,w:Math.round(r.width),h:Math.round(r.height)};});
      const under44=rects.filter(r=>r.w>0&&r.h>0&&(r.w<44||r.h<44));
      return {bg,accent,keyRGB,navs,tools,starts,under44,page:document.body.getAttribute('data-page')};
    })()`);
    ok('任务台 data-page=console', consoleInfo.page === 'console');
    ok('亮底冷中性（非暗黑）', lumRGB(consoleInfo.bg) > 0.75, 'bg=' + consoleInfo.bg + ' L=' + lumRGB(consoleInfo.bg).toFixed(2));
    ok('统一单一低饱和 accent（移除高饱和撞色）', !!consoleInfo.accent && chroma(consoleInfo.keyRGB) < 0.45,
      'key=' + consoleInfo.keyRGB + ' chroma=' + chroma(consoleInfo.keyRGB).toFixed(2));
    ok('主导航 4 项', consoleInfo.navs.length === 4, consoleInfo.navs.join('/'));
    ok('工具区 3 个子页面', consoleInfo.tools.length === 3, consoleInfo.tools.join('/'));
    ok('1440 宽交互目标无 <44px', consoleInfo.under44.length === 0, JSON.stringify(consoleInfo.under44.slice(0, 4)));

    // ---- 1.5【新增·仅点击才触发】空 Store 直接打开监控页 → 保持 idle、无 report、不执行 ----
    await c.goto(fileUrl('monitor.html'));
    await sleep(450);
    const monEmpty = await c.eval(`(()=>({
      state:document.querySelector('#dash').dataset.state,
      report:!!sessionStorage.getItem('probe.report'),
      hint:!document.querySelector('#monitorHint').classList.contains('hidden')
    }))()`);
    ok('空 Store 直接打开监控页 → dash 保持 idle', monEmpty.state === 'idle', 'state=' + monEmpty.state);
    ok('空 Store 直接打开监控页 → 未产生 report', monEmpty.report === false);
    ok('空 Store 直接打开监控页 → 显示引导空态', monEmpty.hint === true);

    // ---- 1.6【新增·cfg 与执行解耦】仅残留 probe.cfg 打开监控页 → 不执行（idle）----
    await c.eval(`sessionStorage.setItem('probe.cfg', JSON.stringify({url:'http://127.0.0.1/lab/sqli_01.php',vulnType:'sqli',script:'CONVERGE_3'}));`);
    await c.goto(fileUrl('monitor.html'));
    await sleep(450);
    const monCfgOnly = await c.eval(`(()=>({
      state:document.querySelector('#dash').dataset.state,
      target:document.querySelector('#mTarget').textContent,
      report:!!sessionStorage.getItem('probe.report')
    }))()`);
    ok('仅残留 cfg 打开监控页 → 不执行(state=idle)', monCfgOnly.state === 'idle', 'state=' + monCfgOnly.state);
    ok('仅残留 cfg 仍回填只读配置快照', /127\.0\.0\.1/.test(monCfgOnly.target), 'mTarget=' + monCfgOnly.target);
    ok('仅残留 cfg 打开监控页 → 未产生 report', monCfgOnly.report === false);

    // ---- 2. 任务台真实点击「开始分析」（勾选授权）→ 翻到监控页只执行一次 ----
    await c.goto(fileUrl('console.html'));
    const pre = await c.eval(`(()=>{
      const u=document.querySelector('#urlInput'); if(u) u.value='http://127.0.0.1/lab/sqli_01.php';
      const t=document.querySelector('#typeSel'); if(t) t.value='sqli';
      const s=document.querySelector('#scriptSel'); if(s) s.value='CONVERGE_3';
      const chk=document.querySelector('#authChk'); if(chk && !chk.checked) chk.click();
      return {checked: chk?chk.checked:null, disabled: document.querySelector('#startBtn').disabled,
              pending: sessionStorage.getItem('probe.pendingRun')};
    })()`);
    ok('勾选授权后「开始分析」按钮可用', pre.checked === true && pre.disabled === false, JSON.stringify(pre));
    ok('点击前无 pendingRun 意图', pre.pending === null, 'pending=' + pre.pending);
    await c.eval(`document.querySelector('#startBtn').click();`);
    const armed = await c.eval(`({pending:sessionStorage.getItem('probe.pendingRun'),cfg:!!sessionStorage.getItem('probe.cfg')})`);
    ok('点击「开始分析」置位一次性 pendingRun', armed.pending === '1' && armed.cfg === true, JSON.stringify(armed));
    ok('点击「开始分析」翻页到监控页', await waitPage('monitor'));
    const dashState = await waitTerminal(80, 250);
    ok('监控页仅执行一次到终态 hit', dashState === 'hit', 'state=' + dashState);
    const oneRun = await c.eval(`JSON.parse(sessionStorage.getItem('probe.history')||'[]').length`);
    ok('一次点击只落一条历史（无重复执行）', oneRun === 1, 'history=' + oneRun);
    ok('消费后 pendingRun 已清除', (await c.eval(`sessionStorage.getItem('probe.pendingRun')`)) === null);
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
    ok('态势台深色焦点（唯一深色区）', lumRGB(mon.bgDark) < 0.05, mon.bgDark + ' L=' + lumRGB(mon.bgDark).toFixed(3));
    ok('报告已跨页持久化', mon.hasReport === true);
    ok('历史已跨页持久化', mon.hasHistory >= 1, 'n=' + mon.hasHistory);

    // ---- 2.4【v0.18】攻防拓扑 / 数据流线型 / 状态形状编码 / 呈现层阶段反馈 ----
    const topo = await c.eval(`(()=>{
      const q=s=>document.querySelector(s), qa=s=>[...document.querySelectorAll(s)];
      const nodes=qa('.sit__node');
      const flows=qa('.sit__flow').map(e=>getComputedStyle(e).strokeDasharray);
      const card=q('.card'), dash=q('#dash'), lamp=q('.dash__state i');
      return {
        labels:qa('.sit__label').length, zones:qa('.sit__zone').length,
        nodeCount:nodes.length, allRect:nodes.every(n=>n.tagName.toLowerCase()==='rect'),
        dataR:nodes.map(n=>n.getAttribute('data-r')).join(','),
        flowKinds:new Set(flows).size, flows:flows,
        barriers:qa('.sit__barrier').length, legend:qa('.sit__legend-item').length,
        phase:dash.getAttribute('data-phase'),
        flowMeta:q('#sitFlowMeta')?q('#sitFlowMeta').textContent:'',
        flowMetaClipped:(()=>{const m=q('#sitFlowMeta');return m?m.scrollWidth>m.clientWidth+1:false})(),
        radius:card?getComputedStyle(card).borderRadius:'',
        shadow:card?getComputedStyle(card).boxShadow:'',
        stateShape:lamp?getComputedStyle(lamp,'::after').content:''
      };
    })()`);
    ok('攻防四段拓扑（攻击方/通道/防线/目标）', topo.labels===4 && topo.zones===4, 'labels='+topo.labels+' zones='+topo.zones);
    ok('8 个方形轮次节点（移除圆润造型）', topo.nodeCount===8 && topo.allRect && topo.dataR==='1,2,3,4,5,6,7,8',
      'rect='+topo.allRect+' r='+topo.dataR);
    ok('三条流量通道线型各异（方向/路径可辨）', topo.flowKinds>=3, JSON.stringify(topo.flows));
    ok('WAF 防线 8 根 + 线型图例（状态不靠单色）', topo.barriers===8 && topo.legend>=5,
      'barriers='+topo.barriers+' legend='+topo.legend+' shape='+topo.stateShape);
    ok('呈现层阶段随任务推进', topo.phase==='breach', 'phase='+topo.phase+' meta='+topo.flowMeta);
    ok('流状态文案完整（方向/路径/流量可读）', topo.flowMetaClipped===false && topo.flowMeta.length>10,
      'clipped='+topo.flowMetaClipped+' meta='+topo.flowMeta);
    /* 实心偏移阴影 = 模糊半径为 0 且两个偏移 ≥4px；soft neutral 阴影 blur>0，不算 */
    const shadowNums=(String(topo.shadow).match(/(-?[\d.]+)px/g)||[]).map(s=>parseFloat(s));
    const hasOffsetShadow=shadowNums.length>=3 && shadowNums[2]===0 &&
      Math.abs(shadowNums[0])>=4 && Math.abs(shadowNums[1])>=4;
    ok('近直角卡片 + 无实心偏移阴影', parseFloat(topo.radius)<=4 && !hasOffsetShadow,
      'r='+topo.radius+' shadow='+topo.shadow);
    ok('状态灯形状编码（非单一颜色区分）', typeof topo.stateShape==='string' && topo.stateShape!=='none',
      'shape='+topo.stateShape);

    // ---- 2.5【新增·幂等】任务完成后刷新监控页 → 不重跑、不写历史，仅从 report 回显终态 ----
    const histBefore = await c.eval(`JSON.parse(sessionStorage.getItem('probe.history')||'[]').length`);
    await c.goto(fileUrl('monitor.html'));  // 重新加载同页 = 刷新
    await sleep(500);
    const monReload = await c.eval(`(()=>({
      state:document.querySelector('#dash').dataset.state,
      hist:JSON.parse(sessionStorage.getItem('probe.history')||'[]').length,
      pending:!!sessionStorage.getItem('probe.pendingRun'),
      target:document.querySelector('#mTarget').textContent
    }))()`);
    ok('刷新监控页不重跑（history 条数不增加）', monReload.hist === histBefore, histBefore + '→' + monReload.hist);
    ok('刷新后无 pendingRun 残留', monReload.pending === false);
    ok('刷新后从 report 只读回显终态 hit', monReload.state === 'hit', 'state=' + monReload.state);
    ok('刷新后配置快照仍在（cfg 只读保留）', /127\.0\.0\.1/.test(monReload.target), 'mTarget=' + monReload.target);

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

    // ---- 6.5【新增·导航不触发】带 pendingRun 访问子页面 → 不执行任何任务 ----
    await c.goto(fileUrl('console.html'));
    await c.eval(`sessionStorage.setItem('probe.pendingRun','1');
      sessionStorage.setItem('probe.cfg', JSON.stringify({url:'http://127.0.0.1/lab/x',vulnType:'sqli',script:'CONVERGE_3'}));`);
    const navBase = await c.eval(`JSON.parse(sessionStorage.getItem('probe.history')||'[]').length`);
    for (const p of ['settings', 'history', 'about']) {
      await c.goto(fileUrl(p + '.html'));
      await sleep(120);
    }
    const navResult = await c.eval(`({hist:JSON.parse(sessionStorage.getItem('probe.history')||'[]').length,
      pending:sessionStorage.getItem('probe.pendingRun')})`);
    ok('带 pendingRun 访问子页面不触发任务（history 不增）', navResult.hist === navBase, navBase + '→' + navResult.hist);
    ok('pendingRun 不被子页面误消费（仅监控页消费）', navResult.pending === '1');
    await c.eval(`sessionStorage.removeItem('probe.pendingRun');`);  // 清掉模拟意图，避免污染后续用例

    // ---- 7. NO_CONVERGE → nofind（不被覆盖）----
    await c.eval(`sessionStorage.setItem('probe.pendingRun','1');sessionStorage.setItem('probe.cfg', JSON.stringify({url:'http://127.0.0.1/lab/x',vulnType:'sqli',script:'NO_CONVERGE'}));`);
    await c.goto(fileUrl('monitor.html'));
    let st2 = 'idle', t2 = 0;
    while (t2++ < 100) { st2 = await c.eval(`document.querySelector('#dash').dataset.state`); if (['hit','nofind','degraded','oos','cancel','error'].includes(st2)) break; await sleep(250); }
    ok('NO_CONVERGE → nofind（关键回归不被覆盖）', st2 === 'nofind', 'state=' + st2);

    // ---- 8. 越界 → oos ----
    await c.eval(`sessionStorage.setItem('probe.pendingRun','1');sessionStorage.setItem('probe.cfg', JSON.stringify({url:'https://example.com/x',vulnType:'sqli',script:'CONVERGE_3'}));`);
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
    await c.eval(`sessionStorage.setItem('probe.pendingRun','1');sessionStorage.setItem('probe.cfg', JSON.stringify({url:'http://127.0.0.1/lab/x',vulnType:'sqli',script:'CONVERGE_3'}));`);
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
