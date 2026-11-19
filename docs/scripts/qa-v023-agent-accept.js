/* v0.23 自主攻击智能体闭环 · 独立验收（严过关）
 * 用法：node docs/scripts/qa-v023-agent-accept.js
 * 端口 9380。依赖：本机 Chrome + Node 22 全局 WebSocket，零 npm 依赖、零外部请求。
 *
 * 数据来自真实跑 4 次自主攻击任务（标准/加固/诱导/越界）+ 1 次默认剧本演示，不内嵌假报告。
 * 覆盖：迭代决策因果 / 攻破即停 / 预算耗尽 / 误判不提前收工 / 越界纯模拟 /
 *       报告 5 附录与闭环摘要 / 触发契约 / 默认路径不回归 / 打印黑白 /
 *       对比度·字号·44px·四档溢出 / 零外联 / 控制台异常。
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const os = require('os');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9380;
const WEB = 'D:\\AIBBBG\\Version1\\webapp';
const fileUrl = f => 'file:///' + path.join(WEB, f).replace(/\\/g, '/');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJSON = u => new Promise((res, rej) => http.get(u, r => {
  let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
}).on('error', rej));

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('[PASS] ' + name + (detail ? ' · ' + detail : '')); }
  else { fail++; console.log('[FAIL] ' + name + (detail ? ' · ' + detail : '')); }
};

const SCAN = `(()=>{
  const parse=c=>{const m=(String(c).match(/[\\d.]+/g)||[]).map(Number);return {r:m[0]||0,g:m[1]||0,b:m[2]||0,a:m.length>3?m[3]:1}};
  const over=(f,b)=>({r:f.r*f.a+b.r*(1-f.a),g:f.g*f.a+b.g*(1-f.a),b:f.b*f.a+b.b*(1-f.a),a:1});
  const bgOf=el=>{const st=[];let e=el;while(e){const c=parse(getComputedStyle(e).backgroundColor);if(c.a>0)st.push(c);e=e.parentElement}
    let b={r:255,g:255,b:255,a:1};for(let i=st.length-1;i>=0;i--)b=over(st[i],b);return b};
  const lum=c=>{const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)};
    return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b)};
  const cr=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05)};
  const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  const bad=[];let n,count=0,min=99,minSize=99;
  while((n=w.nextNode())){
    const t=n.textContent.trim();if(!t)continue;
    const p=n.parentElement;if(!p)continue;
    const cs=getComputedStyle(p);
    if(cs.display==='none'||cs.visibility==='hidden'||parseFloat(cs.opacity)===0)continue;
    const r=p.getBoundingClientRect();if(r.width===0&&r.height===0)continue;
    const fg=parse(cs.color),bg=bgOf(p),eff=fg.a<1?over(fg,bg):fg;
    const ratio=cr(eff,bg),size=parseFloat(cs.fontSize),weight=parseInt(cs.fontWeight)||400;
    const large=size>=24||(size>=18.66&&weight>=700),need=large?3:4.5;
    count++;min=Math.min(min,ratio);minSize=Math.min(minSize,size);
    if(ratio<need)bad.push({t:t.slice(0,28),ratio:+ratio.toFixed(2),size});
  }
  return {count,min:+min.toFixed(2),minSize,badCount:bad.length,bad:bad.slice(0,8)};
})()`;
const HIT44 = `(()=>{
  const sel='a[href],button,input,select,[role="switch"],[data-nav],.tool,.foot-links a,.mainnav a,a.brand,.sound-off';
  const seen=new Set(),out=[];
  document.querySelectorAll(sel).forEach(el=>{
    if(seen.has(el))return;seen.add(el);
    const cs=getComputedStyle(el),r=el.getBoundingClientRect();
    const hidden=cs.display==='none'||cs.visibility==='hidden'||parseFloat(cs.opacity)===0||(r.width===0&&r.height===0);
    if(!hidden&&(r.width<44||r.height<44))out.push({name:el.id?'#'+el.id:el.className,w:Math.round(r.width),h:Math.round(r.height)});
  });
  return out;
})()`;

class CDP {
  constructor(u) { this.ws = new WebSocket(u); this.id = 0; this.p = new Map(); this.events = []; }
  ready() { return new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; this.ws.onmessage = m => {
    const o = JSON.parse(m.data);
    if (o.id && this.p.has(o.id)) { this.p.get(o.id)(o); this.p.delete(o.id); }
    else if (o.method) this.events.push(o);
  }; }); }
  send(method, params = {}) { const id = ++this.id; return new Promise(res => { this.p.set(id, res); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async eval(e) { const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.text);
    return r.result && r.result.result ? r.result.result.value : undefined; }
  async goto(u) { await this.send('Page.navigate', { url: u }); await sleep(580); }
  async vp(w, h) { await this.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }); await sleep(170); }
}
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + path.join(os.tmpdir(), 'qa-v023-' + Date.now()),
  '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' });

(async () => {
  let c;
  try {
    let tg; for (let i = 0; i < 40; i++) { try { tg = await getJSON('http://127.0.0.1:' + PORT + '/json/list'); break; } catch (e) { await sleep(150); } }
    c = new CDP(tg.find(t => t.type === 'page').webSocketDebuggerUrl); await c.ready();
    await c.send('Page.enable'); await c.send('Runtime.enable'); await c.send('Network.enable'); await c.send('Log.enable');
    await c.vp(1440, 900);

    /* ===== §1 触发契约：唯一入口「开始攻击」才置位 agent 意图 ===== */
    await c.goto(fileUrl('console.html'));
    await c.eval(`sessionStorage.clear()`);
    /* 用 dispatchEvent 绕过 disabled 元素的默认不派发，真正测到授权闸门而非「按钮被禁用」 */
    const noAuth = await c.eval(`(()=>{document.querySelector('#startBtn').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
      return {cfg:sessionStorage.getItem('probe.cfg'),pending:sessionStorage.getItem('probe.pendingRun'),
              disabled:document.querySelector('#startBtn').disabled,
              agentBtnGone:!document.querySelector('#agentBtn')}})()`);
    ok('未勾选授权时不产生任何执行意图（授权闸门 + 按钮禁用双保险）',
      noAuth.cfg === null && noAuth.pending === null && noAuth.disabled === true, JSON.stringify(noAuth));
    ok('双按钮已合并（#agentBtn 不再存在）', noAuth.agentBtnGone === true);
    const trig = await c.eval(`(()=>{document.querySelector('#authChk').click();document.querySelector('#startBtn').click();
      return {cfg:sessionStorage.getItem('probe.cfg'),pending:sessionStorage.getItem('probe.pendingRun')}})()`);
    const tc = JSON.parse(trig.cfg || '{}');
    ok('点击「开始攻击」写入 cfg.agent + 一次性 pendingRun',
      tc.agent === true && tc.script === 'AGENT_LOOP' && trig.pending === '1', JSON.stringify(tc));

    /* ===== §2 真实跑四档自主攻击闭环 ===== */
    /* v0.36：攻破轮由网址 + 任务种子派生，不再断言固定轮数；OOS 仍是合规边界 */
    const cases = [
      { k: 'EASY', u: 'http://127.0.0.1/lab/sqli_01.php', breached: true, stop: 'BREACH', term: 'HIT' },
      { k: 'HARD', u: 'http://127.0.0.1/lab/hard.php', breached: true, stop: 'BREACH', term: 'HIT' },
      { k: 'TRAP', u: 'http://127.0.0.1/lab/trap.php', breached: true, stop: 'BREACH', term: 'HIT' },
      { k: 'OOS', u: 'https://example.com/x', breached: false, stop: 'OUT_OF_SCOPE', term: 'OOS' }
    ];
    const reports = {};
    for (const cs of cases) {
      await c.goto(fileUrl('monitor.html'));
      await c.eval(`sessionStorage.clear();sessionStorage.setItem('probe.cfg',JSON.stringify({url:${JSON.stringify(cs.u)},vulnType:'sqli',script:'AGENT_LOOP',agent:true}));sessionStorage.setItem('probe.pendingRun','1')`);
      await c.goto(fileUrl('monitor.html'));
      let st = 'idle', t = 0;
      while (t++ < 140) {
        st = await c.eval(`document.querySelector('#dash')?document.querySelector('#dash').dataset.state:'?'`);
        if (['hit', 'nofind', 'degraded', 'oos', 'cancel', 'error'].includes(st)) break;
        await sleep(250);
      }
      const raw = await c.eval(`sessionStorage.getItem('probe.report')`);
      const r = JSON.parse(raw); reports[cs.k] = r;
      const a = r.agent;
      ok(cs.k + ' 真实任务产出 report + agent 闭环', !!raw && !!a && st !== 'idle',
        'state=' + st + ' rounds=' + r.rounds.length);
      ok(cs.k + ' 终止条件与攻破轮正确',
        a.breached === cs.breached && a.stopReason === cs.stop &&
        a.used === r.rounds.length && r.terminate_reason === cs.term &&
        (cs.k === 'OOS' ? a.used === 3 : (a.breachRound === a.convergeAt && a.used >= 2 && a.used <= 8)),
        JSON.stringify({ breached: a.breached, round: a.breachRound, stop: a.stopReason, used: a.used, term: r.terminate_reason }));
      ok(cs.k + ' 逐轮决策依据齐全且算子来自白名单',
        r.rounds.every(x => x.agent_decision && x.agent_observed && x.gt_ref.indexOf('AGENT/') === 0) &&
        r.agent.decisions.length === r.rounds.length);
      if(cs.k==='EASY'){
        const live=await c.eval(`(()=>({rows:document.querySelectorAll('#agentLiveRows .agent-live__row').length,
          breach:document.querySelectorAll('.agent-live__row[data-breach]').length,
          state:document.querySelector('#agentLiveState').textContent,
          tone:document.querySelector('#agentLiveState').getAttribute('data-tone'),
          first:document.querySelector('.agent-live__row')?document.querySelector('.agent-live__row').textContent:''}))()`);
        ok('监控页决策流按实际轮数展开并标出攻破停机',
          live.rows===a.used && live.breach===1 && /已攻破/.test(live.state) && live.tone==='hit' &&
          /OP_BASE/.test(live.first), JSON.stringify(live));
        const snap=JSON.parse(await c.eval(`sessionStorage.getItem('probe.cfg')`)||'{}');
        await c.goto(fileUrl('monitor.html'));   // 刷新后按收尾快照回填，不得回退成固定剧本
        const mode=await c.eval(`document.querySelector('#mScript').textContent`);
        ok('收尾快照保留自主攻击模式，刷新后不回退成固定剧本',
          snap.agent===true && snap.script==='AGENT_EASY' && /自主攻击/.test(mode),
          JSON.stringify(snap)+' mode='+mode);
      }
    }
    const easy = reports.EASY, hard = reports.HARD, trap = reports.TRAP, oos = reports.OOS;
    const easyHit = easy.rounds.find(x => x.oracle_verdict === 'CONFIRMED');
    ok('反馈驱动决策：首轮基线 → 逐轮按反馈调整 → 收敛轮最终算子攻破',
      easy.rounds[0].strategy_tag === 'OP_BASE' &&
      easy.rounds.every(x => x.agent_decision && x.agent_observed) &&
      easy.rounds[easy.rounds.length - 1].strategy_tag === 'OP_ENC_SEQ_2',
      easy.rounds.map(x => x.strategy_tag).join(' → '));
    ok('攻破判据是点位确认，不是 WAF 未拦截',
      !!easyHit && easyHit.gt_triggered === true && easyHit.response_class === 'ANOMALY' &&
      easyHit.round_no === easy.agent.breachRound);
    ok('HARD 加固后仍在看门狗内收敛，如实记攻破',
      hard.agent.breached === true && hard.agent.stopReason === 'BREACH' &&
      hard.rounds.length <= 8 && hard.rounds.slice(0, -1).every(x => x.response_class === 'BLOCKED') &&
      hard.findings.length === 1);
    ok('TRAP 模型误判被证伪后继续迭代，不提前收工',
      trap.rounds.some(x => x.hit_signal === true && x.oracle_verdict === 'REFUTED' && x.gt_triggered === false) &&
      trap.agent.breached === true && trap.agent.breachRound > 1 && trap.rounds.length <= 8,
      'refuted=' + trap.rounds.filter(x => x.oracle_verdict === 'REFUTED').map(x => 'R' + x.round_no).join(',') +
      ' breachR=' + trap.agent.breachRound + ' rounds=' + trap.rounds.length);
    ok('越界：纯模拟、无授权、全不适用、不构成攻破',
      oos.task.out_of_scope === true && /无授权/.test(oos.task.authorization_id) &&
      oos.rounds.every(x => x.oracle_verdict === 'NOT_APPLICABLE') &&
      oos.agent.breached === false && oos.mock_flag === true);
    ok('结论优先级：攻破由独立裁决给出，模型自证 PASSED 不作判据',
      !!easyHit && easyHit.validation_result === 'PASSED' &&
      /"validation":\s*"PASSED"/.test(easyHit.model_decision_raw) &&
      easyHit.oracle_verdict === 'CONFIRMED');
    ok('credibility 与双通道字段在 Agent 路径同样生成',
      !!easy.credibility && easy.credibility.confirmed === 1 &&
      !!trap.credibility && trap.credibility.refuted === 1 && trap.credibility.disagreement > 0);

    /* ===== §3 默认三剧本路径未回归 ===== */
    await c.goto(fileUrl('monitor.html'));
    await c.eval(`sessionStorage.clear();sessionStorage.setItem('probe.cfg',JSON.stringify({url:'http://127.0.0.1/lab/x',vulnType:'sqli',script:'CONVERGE_3'}));sessionStorage.setItem('probe.pendingRun','1')`);
    await c.goto(fileUrl('monitor.html'));
    let st2 = 'idle', t2 = 0;
    while (t2++ < 90) {
      st2 = await c.eval(`document.querySelector('#dash')?document.querySelector('#dash').dataset.state:'?'`);
      if (['hit', 'nofind', 'degraded', 'oos', 'cancel', 'error'].includes(st2)) break;
      await sleep(250);
    }
    const legacy = JSON.parse(await c.eval(`sessionStorage.getItem('probe.report')`));
    ok('旧 cfg（无 agent 标记）仍走自主攻击，剧本路径已下线',
      !!legacy.agent && /^AGENT_/.test(legacy.task.script_tag) && st2 === 'hit',
      'state=' + st2 + ' script=' + legacy.task.script_tag);
    const liveLegacy=await c.eval(`(()=>({rows:document.querySelectorAll('#agentLiveRows .agent-live__row').length,
      state:document.querySelector('#agentLiveState').textContent,
      empty:document.querySelector('#agentLiveEmpty')?document.querySelector('#agentLiveEmpty').textContent:''}))()`);
    ok('自主攻击下决策流按真实轮次渲染',
      liveLegacy.rows===legacy.rounds.length && /已攻破/.test(liveLegacy.state),
      JSON.stringify(liveLegacy));

    /* ===== §4 报告页：5 附录 + 闭环摘要 + 打印黑白 ===== */
    const putReport = async r => {
      await c.goto(fileUrl('report.html'));
      await c.eval(`sessionStorage.setItem('probe.report',${JSON.stringify(JSON.stringify(r))})`);
      await c.goto(fileUrl('report.html'));
    };
    await putReport(easy);
    const rp = await c.eval(`(()=>({
      secs:document.querySelectorAll('#reportCard .report-sec').length,
      seal:document.querySelector('.rpt-seal__txt b').textContent,
      lede:document.querySelector('.rpt-lede').textContent,
      agent:document.querySelectorAll('.rpt-agent').length,
      figures:[...document.querySelectorAll('.rpt-agent__cells b')].map(e=>e.textContent),
      chain:document.querySelectorAll('.rpt-chain__row').length,
      breachRow:document.querySelectorAll('.rpt-chain__row[data-breach]').length,
      audit:document.querySelectorAll('.rpt-audit').length,
      export:!!document.querySelector('#exportBtn')}))()`);
    ok('报告 5 附录 / 导出按钮契约保持', rp.secs === 5 && rp.export);
    ok('卷首结论改用「已攻破」叙事', rp.seal === '已攻破' && /攻破即停/.test(rp.lede), rp.seal);
    const pad2 = n => String(n).padStart(2, '0');
    ok('02 闭环摘要 4 读数取自 agent 真值',
      JSON.stringify(rp.figures) === JSON.stringify([
        '攻破即停', 'R' + pad2(easy.agent.breachRound),
        easy.agent.used + ' / 8', '8 个编号']), JSON.stringify(rp.figures));
    ok('逐轮决策链行数 = 实际迭代轮次，攻破行标记唯一',
      rp.chain === easy.rounds.length && rp.breachRow === 1 && rp.audit === 1);
    /* v0.23.1：纯浏览监控页只读回填决策流，不产生执行意图 */
    await c.goto(fileUrl('monitor.html'));
    const replay=await c.eval(`(()=>({rows:document.querySelectorAll('#agentLiveRows .agent-live__row').length,
      state:document.querySelector('#agentLiveState').textContent,
      pending:sessionStorage.getItem('probe.pendingRun')}))()`);
    ok('纯浏览监控页只读回填决策流且不置执行意图',
      replay.rows===easy.rounds.length && /已攻破/.test(replay.state) && replay.pending===null, JSON.stringify(replay));
    await putReport(hard);
    const rp2 = await c.eval(`(()=>({seal:document.querySelector('.rpt-seal__txt b').textContent,
      figures:[...document.querySelectorAll('.rpt-agent__cells b')].map(e=>e.textContent),
      chain:document.querySelectorAll('.rpt-chain__row').length,
      lead:document.querySelector('.rpt-lede').textContent}))()`);
    ok('加固靶场同样打到攻破，摘要无预算终止口径',
      rp2.seal === '已攻破' && rp2.figures[0] === '攻破即停' &&
      rp2.chain === hard.rounds.length && /攻破即停/.test(rp2.lead), JSON.stringify(rp2.figures));
    await c.send('Emulation.setEmulatedMedia', { media: 'print' });
    const pr = await c.eval(`(()=>({bg:getComputedStyle(document.querySelector('.rpt-agent__cells>div')).backgroundColor,
      row:getComputedStyle(document.querySelector('.rpt-chain__row')).backgroundColor,
      head:getComputedStyle(document.querySelector('.rpt-agent__head b')).color,
      secs:document.querySelectorAll('#reportCard .report-sec').length}))()`);
    ok('打印态闭环盒白底黑字、5 附录齐全',
      pr.bg === 'rgb(255, 255, 255)' && pr.row === 'rgb(255, 255, 255)' &&
      pr.head === 'rgb(17, 17, 17)' && pr.secs === 5, JSON.stringify(pr));
    await c.send('Emulation.setEmulatedMedia', { media: '' });
    await c.goto(fileUrl('monitor.html'));
    await c.send('Emulation.setEmulatedMedia', { media: 'print' });
    const livePrint=await c.eval(`(()=>{const e=document.querySelector('#agentLive');return e?getComputedStyle(e).display:'missing'})()`);
    ok('打印态隐藏监控页决策流（不进入 PDF）', livePrint==='none', livePrint);
    await c.send('Emulation.setEmulatedMedia', { media: '' });

    /* ===== §5 证据链页双轨仍工作 ===== */
    await putReport(trap);
    await c.goto(fileUrl('evidence.html'));
    const ev = await c.eval(`(()=>({cells:document.querySelectorAll('.orc-cell').length,
      clash:document.querySelectorAll('.orc-track--oracle .orc-cell.is-clash').length,
      rows:document.querySelectorAll('#roundBody tr').length,
      verdict:document.querySelector('#verdictWord').textContent}))()`);
    ok('证据链页双轨 / 逐轮表 / 降级攻破结论联动',
      ev.cells === 16 && ev.clash > 0 && ev.rows === trap.rounds.length && ev.verdict === '降级攻破', JSON.stringify(ev));

    /* ===== §6 视觉规格 ===== */
    await putReport(easy);
    await c.vp(1440, 900);
    const scan = await c.eval(SCAN);
    ok('报告页有数据态对比度 ≥4.5:1 且最小字号 ≥11px',
      scan.badCount === 0 && scan.minSize >= 11, 'min=' + scan.min + ':1 minSize=' + scan.minSize + 'px nodes=' + scan.count);
    for (const pg of ['console', 'report', 'evidence']) {
      const hit = await (async () => { await c.goto(fileUrl(pg + '.html')); return c.eval(HIT44); })();
      ok(pg + ' 页可见交互目标 <44px 为 0', hit.length === 0, JSON.stringify(hit.slice(0, 3)));
    }
    for (const [w, h] of [[1440, 900], [1100, 800], [768, 1024], [390, 844]]) {
      await c.vp(w, h);
      let bad = 0;
      for (const pg of ['console', 'report', 'evidence']) {
        await c.goto(fileUrl(pg + '.html'));
        if (await c.eval(`document.documentElement.scrollWidth>window.innerWidth+1`)) bad++;
      }
      ok(w + 'px 三页零横向溢出', bad === 0, 'bad=' + bad);
    }
    await c.vp(1440, 900);

    /* ===== §7 零外联 / 控制台异常 ===== */
    const external = c.events.filter(e => e.method === 'Network.requestWillBeSent' &&
      !/^(file|data|about|chrome):/.test(e.params.request.url || ''));
    ok('零外部请求', external.length === 0, JSON.stringify(external.slice(0, 3).map(e => e.params.request.url)));
    const exceptions = c.events.filter(e => e.method === 'Runtime.exceptionThrown' ||
      (e.method === 'Log.entryAdded' && e.params.entry && e.params.entry.level === 'error'));
    ok('控制台异常 0', exceptions.length === 0, JSON.stringify(exceptions.slice(0, 2).map(e => e.method)));

    console.log('--------------------------------------------------');
    console.log('合计: ' + (pass + fail) + '  通过: ' + pass + '  失败: ' + fail);
    console.log('==================================================');
    if (fail) process.exitCode = 1;
  } catch (e) {
    console.error('FAIL', e.stack || e);
    process.exitCode = 1;
  } finally { chrome.kill('SIGKILL'); }
})();
