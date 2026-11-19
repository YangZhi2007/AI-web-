/* v0.36 验收：攻击直到攻破才停止
 * 需求：点击攻击后不再跑固定次数；唯一正常停机条件是独立裁决 CONFIRMED。
 * 验证点：
 *   ① 三种靶场画像都持续迭代到攻破，stopReason=BREACH，不出现预算终止；
 *   ② 同一网址多次攻击不再必然同轮数，种子写入报告可复现；
 *   ③ 诱导靶场的误报被证伪后仍继续攻破，反证进入漏洞分析；
 *   ④ 看门狗 GUARD 映射为 error，旧 MAX_ROUNDS 报告仍兼容 nofind；
 *   ⑤ 任务台按钮与 URL 回车两条入口都走自主攻击；
 *   ⑥ 报告/配置页文案与「攻破即停」一致；零外联、无运行时异常。
 * 依赖：本机 Chrome headless + CDP。 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9457;
const WEB = 'D:\\AIBBBG\\Version1\\webapp';
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

const CASES = [
  { key: '标准靶场', url: 'http://127.0.0.1/lab/sqli_01.php', profile: 'EASY', state: 'hit', vuln: 'sqli' },
  { key: '加固靶场', url: 'http://127.0.0.1/lab/hard/x', profile: 'HARD', state: 'hit', vuln: 'xss' },
  { key: '诱导靶场', url: 'http://127.0.0.1/lab/trap/x', profile: 'DECEPTIVE', state: 'degraded', vuln: 'upload' }
];

(async () => {
  let tg;
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + path.join(require('os').tmpdir(), 'qa-v036-' + Date.now()),
    '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' });
  try {
    for (let i = 0; i < 40; i++) {
      try { tg = await getJSON('http://127.0.0.1:' + PORT + '/json/list'); break; }
      catch (e) { await sleep(150); }
    }
    const WS = global.WebSocket || require('ws');
    const c = new WS(tg.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((res, rej) => { c.onopen = res; c.onerror = rej; });
    let id = 0; const pm = new Map(); const ext = []; const logs = [];
    c.onmessage = (m) => {
      const o = JSON.parse(m.data);
      if (o.id && pm.has(o.id)) { pm.get(o.id)(o); pm.delete(o.id); }
      if (o.method === 'Network.requestWillBeSent') {
        const u = o.params.request.url;
        if (!/^(file|data|blob|about):/i.test(u)) ext.push(u);
      }
      if (o.method === 'Runtime.exceptionThrown') logs.push(o.params.exceptionDetails.text);
    };
    const send = (m, p = {}) => new Promise((res) => { const i = ++id; pm.set(i, res); c.send(JSON.stringify({ id: i, method: m, params: p })); });
    const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
    const go = async (u) => { await send('Page.navigate', { url: u }); await sleep(500); };
    const shot = async (n) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, n), Buffer.from(r.result.data, 'base64')); };
    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

    /* ① 引擎层：三画像都打到攻破 */
    await go(fileUrl('monitor.html'));
    await ev(`window.Probe.TICKS.demo=6`);
    const runs = {};
    for (const cs of CASES) {
      const r = await ev(`(async function(){
        var x=await window.Probe.AttackAgent.analyze(${JSON.stringify(cs.url)},
          {authorizationId:'AUTH-LAB-DEMO-001'},function(){});
        return {rounds:x.rounds.length,breached:x.agent.breached,stop:x.agent.stopReason,
          breachRound:x.agent.breachRound,convergeAt:x.agent.convergeAt,seed:x.agent.seed,
          state:window.Probe.resolveTerminalState(x).state,term:x.terminate_reason,
          vuln:x.analysis?x.analysis.type:null,excluded:x.analysis?x.analysis.excluded.length:0,
          refuted:x.rounds.filter(function(q){return q.oracle_verdict==='REFUTED';}).length,
          anomalies:x.rounds.filter(function(q){return q.oracle_verdict!=='CONFIRMED'&&q.response_class==='ANOMALY';}).length};})()`);
      runs[cs.key] = r;
      check(cs.key + ' 持续迭代到攻破即停', r && r.breached === true && r.stop === 'BREACH' && r.term === 'HIT',
        JSON.stringify({ rounds: r && r.rounds, stop: r && r.stop }));
      check(cs.key + ' 终态一致且攻破轮来自种子收敛点', r && r.state === cs.state && r.breachRound === r.convergeAt && r.rounds >= 2 && r.rounds <= 8,
        'R' + (r && r.breachRound) + ' seed=' + (r && r.seed));
      check(cs.key + ' 漏洞类型由命中点位分析得出', r && r.vuln === cs.vuln, r && r.vuln);
    }
    const trap = runs['诱导靶场'];
    check('误报被独立裁决证伪后仍继续攻破', trap && trap.refuted >= 1 && trap.excluded >= 1 && trap.breached === true,
      'refuted=' + (trap && trap.refuted));
    check('未确认的响应异常没有伪装成攻破', runs['标准靶场'].anomalies === 0 && runs['加固靶场'].anomalies === 0);

    /* ② 同一网址多次攻击不再固定次数；报告种子可复现收敛点 */
    const repeat = await ev(`(async function(){
      var out=[];
      for(var i=0;i<8;i++){
        var x=await window.Probe.AttackAgent.analyze('http://127.0.0.1/lab/sqli_01.php',
          {authorizationId:'AUTH-LAB-DEMO-001'},function(){});
        out.push({rounds:x.rounds.length,seed:x.agent.seed,at:x.agent.convergeAt,
          breach:x.agent.breachRound,stop:x.agent.stopReason});
      }
      return out;})()`);
    const distinct = new Set(repeat.map((x) => x.rounds));
    check('同一网址多次攻击不再固定轮数', distinct.size >= 2,
      '轮数分布 ' + Array.from(distinct).sort().join('/'));
    check('每次都打到攻破且无预算终止', repeat.every((x) => x.stop === 'BREACH' && x.breach === x.at));
    const pick = repeat[0];
    const replay = await ev(`(function(){
      var p=window.Probe, live=p.agentPlanOf(p.AGENT_PROFILES.EASY,p.rngOf(${pick.seed}));
      return {at:live.breakRound,from:p.AGENT_PROFILES.EASY.base};})()`);
    check('报告种子可复现该次收敛轮', replay && replay.at === pick.at, 'seed=' + pick.seed + ' R' + replay.at);

    /* ③ 状态机：看门狗与旧报告兼容 */
    const states = await ev(`(function(){
      var p=window.Probe;
      return {guard:p.resolveTerminalState({terminate_reason:'GUARD',degraded_rounds:[]}),
        old:p.resolveTerminalState({terminate_reason:'MAX_ROUNDS',degraded_rounds:[1]})};})()`);
    check('看门狗 GUARD 映射为 error 而非伪造未攻破', states && states.guard.state === 'error', states && states.guard.state);
    check('旧契约桩 MAX_ROUNDS 仍兼容 nofind', states && states.old.state === 'nofind', states && states.old.state);

    /* ④ 真实点击入口：按钮与回车都进入自主攻击 */
    await go(fileUrl('console.html'));
    await ev(`sessionStorage.clear();document.querySelector('#authChk').checked=true;
      document.querySelector('#authChk').dispatchEvent(new Event('change'));
      document.querySelector('#startBtn').click()`);
    await sleep(900);
    check('点击按钮进入监控页', /monitor\.html/.test(await ev('location.href')));
    let st = 'idle', t = 0;
    while (t++ < 120) {
      st = await ev(`document.querySelector('#dash').dataset.state`);
      if (['hit', 'nofind', 'degraded', 'oos', 'cancel', 'error'].includes(st)) break;
      await sleep(200);
    }
    const clicked = await ev(`(function(){var r=JSON.parse(sessionStorage.getItem('probe.report'));
      return {script:r.task.script_tag,stop:r.agent&&r.agent.stopReason,breached:r.agent&&r.agent.breached};})()`);
    check('按钮入口走自主攻击并攻破即停', clicked && /^AGENT_/.test(clicked.script) && clicked.stop === 'BREACH' && clicked.breached === true,
      JSON.stringify(clicked));

    /* ④b 监控页不得再显示"固定 8 次"的预算语言 */
    const gauge = await ev(`(function(){
      var num=document.querySelector('.gauge__num'), foot=document.querySelector('.gauge__foot');
      var r=JSON.parse(sessionStorage.getItem('probe.report'));
      return {label:document.querySelector('.gauge .lbl').textContent,
        num:num.textContent.replace(/\\s+/g,' ').trim(),
        foot:foot.textContent.replace(/\\s+/g,' ').trim(),
        cells:document.querySelectorAll('#rail i').length,
        rounds:r.rounds.length,
        cur:document.querySelectorAll('#rail i.cur').length,
        empty:document.querySelectorAll('#rail i.is-empty').length};})()`);
    check('主读数无 "/8" 分母，标注攻破即停', gauge && gauge.num.indexOf('/ 8') < 0 && /攻破即停/.test(gauge.num),
      gauge && gauge.num);
    check('脚注无护栏数字与轮次进度百分比', gauge && gauge.foot.indexOf('8') < 0 && gauge.foot.indexOf('进度') < 0 && /无攻击次数上限/.test(gauge.foot) && gauge.foot.split('攻破即停').length === 2,
      gauge && gauge.foot);
    check('刻度格数=实际投递轮次，无预置空槽', gauge && gauge.cells === gauge.rounds && gauge.cur === 0 && gauge.empty === 0,
      JSON.stringify({cells:gauge && gauge.cells, rounds:gauge && gauge.rounds}));
    await shot('v0.36-监控页-轮次流水无分母.png');

    await go(fileUrl('console.html'));
    await ev(`sessionStorage.clear();document.querySelector('#authChk').checked=true;
      document.querySelector('#authChk').dispatchEvent(new Event('change'));
      document.querySelector('#urlInput').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
    await sleep(900);
    check('回车入口也进入监控页', /monitor\.html/.test(await ev('location.href')));
    t = 0;
    while (t++ < 120) {
      st = await ev(`document.querySelector('#dash').dataset.state`);
      if (['hit', 'nofind', 'degraded', 'oos', 'cancel', 'error'].includes(st)) break;
      await sleep(200);
    }
    const entered = await ev(`(function(){var r=JSON.parse(sessionStorage.getItem('probe.report'));
      return {script:r.task.script_tag,stop:r.agent&&r.agent.stopReason};})()`);
    check('回车入口同样走攻破即停的自主攻击', entered && /^AGENT_/.test(entered.script) && entered.stop === 'BREACH',
      JSON.stringify(entered));

    /* ⑤ 报告页：种子、攻破即停文案，无「未使用轮次预算」 */
    await go(fileUrl('report.html'));
    const rp = await ev(`(function(){var t=document.body.innerText;
      var seed=[...document.querySelectorAll('.rpt-facts div')].find(function(d){return /收敛种子/.test(d.textContent)});
      return {seed:seed?seed.textContent:'',breach:/攻破即停/.test(t),budget:/未使用 \\d+ 轮预算/.test(t),
        seal:(document.querySelector('.rpt-seal__txt b')||{}).textContent};})()`);
    check('报告写入收敛种子', rp && /SEED/.test(rp.seed) && /收敛于 R/.test(rp.seed), rp && rp.seed);
    check('报告文案为攻破即停，无旧预算口径', rp && rp.breach === true && rp.budget === false,
      'breach=' + (rp && rp.breach) + ' oldBudget=' + (rp && rp.budget));
    check('签发章与终态一致', rp && ['已攻破', '降级攻破'].indexOf(rp.seal) >= 0, rp && rp.seal);
    await shot('v0.36-报告-攻破即停.png');

    /* ⑥ 配置页画像预览与任务台提示 */
    await go(fileUrl('settings.html'));
    const cfg = await ev(`(function(){var cards=[...document.querySelectorAll('#cfgScn .cfg-scn__card')];
      return {n:cards.length,meta:cards.map(function(x){return x.querySelector('.cfg-scn__meta').textContent}),
        rule:cards.map(function(x){return x.querySelector('.cfg-scn__rule').textContent})};})()`);
    check('画像预览显示示例攻破轮而非固定剧本', cfg && cfg.n === 3 && cfg.meta.every((m) => /轮攻破/.test(m) && !/NOT FOUND/.test(m)),
      JSON.stringify(cfg && cfg.meta));
    check('画像卡说明实际轮由种子派生', cfg && cfg.rule.every((r) => /任务种子派生/.test(r)));
    await shot('v0.36-配置页-画像预览.png');

    await go(fileUrl('console.html'));
    const hint = await ev(`(document.querySelector('#agentHint')||{}).textContent||''`);
    check('任务台提示写明不设固定攻击次数', /不设固定攻击次数/.test(hint) && /独立确认/.test(hint));
    await shot('v0.36-任务台-单入口攻破即停.png');

    check('全程零外部请求', ext.length === 0, ext.slice(0, 3).join(' | ') || '无');
    check('无运行时异常', logs.length === 0, logs.slice(0, 2).join(' | ') || '无');

    const bad = R.filter((x) => !x.ok);
    console.log('\n==== ' + (bad.length ? 'FAIL' : 'PASS') + ' ==== ' + (R.length - bad.length) + '/' + R.length);
    if (bad.length) console.log('失败项：' + bad.map((x) => x.name).join(' / '));
    if (bad.length) process.exitCode = 1;
  } catch (e) {
    console.error('ERR', e && e.message);
    process.exitCode = 1;
  } finally {
    try { chrome.kill(); } catch (e) {}
  }
})();
