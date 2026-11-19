/* v0.35 验收（v0.36 契约同步）：单入口攻击 + 靶场画像 + 漏洞分析
 * 需求：删掉「演示剧本」下拉，改为「输入靶址 → 点击攻击 → 打到攻破 → 分析漏洞 → 产出报告」。
 * v0.36 同步：攻击不再固定轮数，三种画像都打到攻破；「未攻破」仅由异常看门狗产生，
 *   不再把 HARD 当作固定 8 轮不攻破的演示。具体轮数断言见 qa-v036。
 * 验证点：
 *   ① 剧本/漏洞类型下拉已移除，双按钮合并为单一「开始攻击」；
 *   ② 靶场画像由 URL 派生，攻破 / 降级攻破由路径演示；
 *   ③ 漏洞类型由命中点位与裁决确认推导，不再回显用户输入；
 *   ④ 看门狗未攻破时不给漏洞结论；被证伪轮次作为反证列出；
 *   ⑤ 结论词与终态判定同源；
 *   ⑥ 配置页画像库不可选；零外联。
 * 依赖：本机 Chrome headless + CDP。 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9455;
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
  { key: '标准靶场', url: 'http://127.0.0.1/lab/sqli_01.php', state: 'hit', vuln: 'sqli', breached: true },
  { key: '加固靶场', url: 'http://127.0.0.1/lab/hard/x', state: 'hit', vuln: 'xss', breached: true },
  { key: '诱导靶场', url: 'http://127.0.0.1/lab/trap/x', state: 'degraded', vuln: 'upload', breached: true }
];

(async () => {
  let tg;
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + path.join(require('os').tmpdir(), 'qa-v035-' + Date.now()),
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

    /* ① 任务台：控件与入口 */
    await go(fileUrl('console.html'));
    const ui = await ev(`(function(){
      return {selects:document.querySelectorAll('.form-grid select').length,
        scriptSel:!!document.querySelector('#scriptSel'),
        typeSel:!!document.querySelector('#typeSel'),
        agentBtn:!!document.querySelector('#agentBtn'),
        startBtn:!!document.querySelector('#startBtn'),
        startText:(document.querySelector('#startBtn')||{}).textContent||'',
        urlInput:!!document.querySelector('#urlInput'),
        hint:(document.querySelector('#agentHint')||{}).textContent||''};})()`);
    check('演示剧本下拉已删除', ui && ui.scriptSel === false && ui.selects === 0, 'selects=' + (ui && ui.selects));
    check('漏洞类型下拉已删除（类型是产出不是输入）', ui && ui.typeSel === false);
    check('双按钮合并为单一入口', ui && ui.agentBtn === false && ui.startBtn === true, ui && ui.startText.trim());
    check('主按钮语义为「开始攻击」', ui && ui.startText.indexOf('开始攻击') >= 0, ui && ui.startText.trim());
    check('保留目标地址输入', ui && ui.urlInput === true);
    check('提示写明「只填网址即可」', ui && ui.hint.indexOf('只填网址即可') >= 0);

    /* ② 单入口触发 → 监控页执行（真实点击，不注入） */
    await go(fileUrl('console.html'));
    await ev(`sessionStorage.clear()`);
    await ev(`document.querySelector('#authChk').checked=true;
      document.querySelector('#authChk').dispatchEvent(new Event('change'))`);
    await ev(`document.querySelector('#startBtn').click()`);
    await sleep(900);
    check('点击后进入监控页', /monitor\.html/.test(await ev('location.href')));
    let st = 'idle', t = 0;
    while (t++ < 80) {
      st = await ev(`document.querySelector('#dash').dataset.state`);
      if (['hit', 'nofind', 'degraded', 'oos', 'cancel', 'error'].includes(st)) break;
      await sleep(250);
    }
    const first = await ev(`(function(){var s=sessionStorage.getItem('probe.report');if(!s)return null;
      var r=JSON.parse(s);return {state:r.terminate_reason,breached:r.agent&&r.agent.breached,
        script:r.task.script_tag,vuln:r.analysis&&r.analysis.type,word:(document.querySelector('#verdictWord')||{}).textContent};})()`);
    check('单入口走自主攻击（非剧本）', first && /^AGENT_/.test(first.script), first && first.script);
    check('标准靶场攻破即停', first && first.breached === true && st === 'hit', 'state=' + st);

    /* ③ 三画像终态 + 漏洞分析 */
    for (const cs of CASES) {
      await go(fileUrl('monitor.html'));
      const r = await ev(`(async function(){
        await window.Probe.runTask({url:${JSON.stringify(cs.url)},authed:true,agent:true});
        var x=JSON.parse(sessionStorage.getItem('probe.report'));
        return {rounds:x.rounds.length,breached:x.agent.breached,state:window.Probe.resolveTerminalState(x).state,
          vuln:x.analysis?x.analysis.type:null,label:x.analysis?x.analysis.label:null,
          evid:x.analysis?x.analysis.evidence.length:0,
          excl:x.analysis?x.analysis.excluded.length:0,
          findingVuln:x.findings[0]?x.findings[0].vuln_type:null,
          refuted:x.rounds.filter(function(q){return q.oracle_verdict==='REFUTED';}).length};})()`);
      check(cs.key + ' 轮数有界且终态正确',
        r && r.rounds >= 1 && r.rounds <= 8 && r.state === cs.state && r.breached === cs.breached,
        JSON.stringify({ rounds: r && r.rounds, state: r && r.state }));
      check(cs.key + ' 分析出 ' + cs.vuln, r && r.vuln === cs.vuln, r && r.label);
      check(cs.key + ' finding 类型取自分析', r && r.findingVuln === cs.vuln, r && r.findingVuln);
      check(cs.key + ' 分析含依据链', r && r.evid >= 4, 'evid=' + (r && r.evid));
      if (cs.key === '诱导靶场') {
        check('诱导靶场有被证伪的误报', r && r.refuted >= 1, 'refuted=' + (r && r.refuted));
        check('分析把误报列为反证', r && r.excl >= 1, 'excl=' + (r && r.excl));
      }
    }

    /* ④ 报告页：漏洞分析块 + 数据来源 + 结论词一致性 */
    await go(fileUrl('monitor.html'));
    await ev(`window.Probe.runTask({url:'http://127.0.0.1/lab/trap/x',authed:true,agent:true})`);
    await sleep(800);
    await go(fileUrl('report.html'));
    const rp = await ev(`(function(){
      var v=document.querySelector('.rpt-vuln');
      var src=[...document.querySelectorAll('.rpt-facts div')].find(function(d){return d.textContent.indexOf('数据来源')>=0});
      return {has:!!v,none:v?v.classList.contains('rpt-vuln--none'):null,
        label:v?(v.querySelector('.rpt-vuln__head b')||{}).textContent:null,
        items:v?v.querySelectorAll('.rpt-vuln__ev li').length:0,
        excluded:v?v.querySelectorAll('.rpt-vuln__ex li').length:0,
        src:src?src.textContent:null,
        seal:(document.querySelector('.rpt-seal__txt b')||{}).textContent};})()`);
    check('报告含漏洞分析块且有结论', rp && rp.has === true && rp.none === false, rp && rp.label);
    check('报告列出分析依据与被排除误报', rp && rp.items >= 4 && rp.excluded >= 1,
      'ev=' + (rp && rp.items) + ' ex=' + (rp && rp.excluded));
    check('报告数据来源为 AttackAgent（不是 MockEngine）',
      rp && /AttackAgent/.test(rp.src) && !/MockEngine/.test(rp.src), rp && rp.src);
    check('签发章结论与终态一致（degraded → 降级攻破）', rp && rp.seal === '降级攻破', rp && rp.seal);
    await shot('v0.35-报告-漏洞分析.png');

    /* ⑤ 异常看门狗报告：未攻破不给结论，签发章如实记异常 */
    await go(fileUrl('monitor.html'));
    await ev(`window.Probe.runTask({url:'http://127.0.0.1/lab/sqli_01.php',authed:true,agent:true})`);
    await sleep(800);
    await ev(`(function(){var s=sessionStorage.getItem('probe.report');var r=JSON.parse(s);
      r.terminate_reason='GUARD';r.agent.breached=false;r.agent.breachRound=null;
      r.agent.stopReason='SAFETY_GUARD';r.analysis=null;r.findings=[];
      r.rounds.forEach(function(q){q.hit_signal=false;q.gt_triggered=false;
        q.oracle_verdict='TRUE_NEGATIVE';q.oracle_cn='拦截未触发';});
      sessionStorage.setItem('probe.report',JSON.stringify(r));return 1;})()`);
    await go(fileUrl('report.html'));
    const rp2 = await ev(`(function(){var v=document.querySelector('.rpt-vuln');
      return {none:v?v.classList.contains('rpt-vuln--none'):null,
        text:v?v.textContent:'',seal:(document.querySelector('.rpt-seal__txt b')||{}).textContent};})()`);
    check('看门狗未攻破报告显示无结论态', rp2 && rp2.none === true && rp2.text.indexOf('不输出漏洞类型') >= 0);
    check('看门狗签发章为「异常」', rp2 && rp2.seal === '异常', rp2 && rp2.seal);
    await shot('v0.35-报告-看门狗无结论.png');

    /* ⑥ 结论词与终态同源（变异报告回归：状态 nofind 不得出现「已攻破」） */
    const mut = await ev(`(function(){
      var s=sessionStorage.getItem('probe.report');var r=JSON.parse(s);
      r.terminate_reason='MAX_ROUNDS';r.findings=[];
      r.rounds.forEach(function(q){q.hit_signal=false;});
      sessionStorage.setItem('probe.report',JSON.stringify(r));
      return 1;})()`);
    await go(fileUrl('evidence.html'));
    const mutWord = await ev(`(document.querySelector('#verdictWord')||{}).textContent`);
    check('结论词随终态判定（nofind → 未攻破，不自相矛盾）', mutWord === '未攻破', mutWord);

    /* ⑦ 配置页：画像库不可选 */
    await go(fileUrl('settings.html'));
    const cfg = await ev(`(function(){
      var cards=[...document.querySelectorAll('#cfgScn .cfg-scn__card')];
      return {n:cards.length,keys:cards.map(function(x){return x.getAttribute('data-profile')}),
        rules:cards.map(function(x){return (x.querySelector('.cfg-scn__rule')||{}).textContent||''}),
        load:document.querySelectorAll('.cfg-load').length,
        typeSel:!!document.querySelector('#cfgType'),scriptSel:!!document.querySelector('#cfgScript')};})()`);
    check('配置页画像库 3 张卡', cfg && cfg.n === 3, 'n=' + (cfg && cfg.n));
    check('画像键 EASY/HARD/DECEPTIVE', cfg && ['EASY', 'HARD', 'DECEPTIVE'].every((k) => cfg.keys.indexOf(k) >= 0),
      JSON.stringify(cfg && cfg.keys));
    check('画像卡标注 URL 派生条件', cfg && cfg.rules.length === 3 && cfg.rules.every((r) => /派生条件/.test(r)));
    check('配置页已无类型/剧本下拉与载入按钮',
      cfg && cfg.typeSel === false && cfg.scriptSel === false && cfg.load === 0);
    await shot('v0.35-配置页-靶场画像.png');
    await go(fileUrl('console.html'));
    await shot('v0.35-任务台-单入口.png');

    /* ⑧ 零外联与异常 */
    check('全程零外部请求', ext.length === 0, ext.slice(0, 3).join(' | ') || '无');
    check('无运行时异常', logs.length === 0, logs.slice(0, 2).join(' | ') || '无');

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
