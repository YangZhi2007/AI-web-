/* v0.32 验收：幻觉修复剩余 4 页（证据库 / 修复记录 / 版本对比 / 报告导出）
 * 目标：4 页真实渲染且数据来自同一评测引擎；版本对比是真实提示词 diff；
 *       报告可生成 Markdown 文本、复制/下载控件存在；零外联；不破坏既有验收。
 * 依赖：本机 Chrome headless + CDP。 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9397;
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

(async () => {
  let tg;
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + path.join(require('os').tmpdir(), 'qa-v032-' + Date.now()),
    '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' });
  try {
    for (let i = 0; i < 40; i++) {
      try { tg = await getJSON('http://127.0.0.1:' + PORT + '/json/list'); break; }
      catch (e) { await sleep(150); }
    }
    const WS = global.WebSocket || require('ws');
    const c = new WS(tg.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((res, rej) => { c.onopen = res; c.onerror = rej; });
    let id = 0; const pm = new Map();
    c.onmessage = (m) => { const o = JSON.parse(m.data); if (o.id && pm.has(o.id)) { pm.get(o.id)(o); pm.delete(o.id); } };
    const send = (method, params = {}) => new Promise((res) => { const i = ++id; pm.set(i, res); c.send(JSON.stringify({ id: i, method, params })); });
    const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
    const go = async (u) => { await send('Page.navigate', { url: u }); await sleep(480); };
    const shot = async (n) => { const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(path.join(OUT, n), Buffer.from(r.result.data, 'base64')); };
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

    /* ⓿ 管理员登录：看板页面均受访问守卫保护，先真实走一遍登录流程 */
    async function hfLogin(nav, run) {
      await nav(fileUrl('hf/login.html'));
      await run("(function(){document.getElementById('lgUser').value='admin';"
        + "document.getElementById('lgPass').value='HfLab@2026';"
        + "document.getElementById('lgForm').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));})()");
      await sleep(1500);
    }
    await hfLogin(go, ev);


    /* ① 先跑一次评测写入 Store（所有新页的数据源） */
    await go(fileUrl('hf/probe.html'));
    await ev('sessionStorage.removeItem("hf.eval")');
    await go(fileUrl('hf/probe.html'));
    await ev('document.querySelector("#hfRun").click()');
    await sleep(550);
    const stored = await ev(`!!sessionStorage.getItem('hf.eval')`);
    check('评测结果写入 Store（前置）', stored);

    /* ② 04 证据库管理 */
    await go(fileUrl('hf/evidence.html'));
    const evStat = await ev(`document.querySelectorAll('#hfEvStats>div').length`);
    const evItems = await ev(`document.querySelectorAll('#hfEvList .hf-ev-item').length`);
    const evPrev = await ev(`(()=>{var p=document.querySelector('#hfEvPreview');return p&&p.querySelectorAll('pre').length;})()`);
    check('证据库读数 4 格', evStat === 4, 'stats=' + evStat);
    check('证据条目 22 条（12+10）', evItems === 22, 'items=' + evItems);
    check('证据预览含生成证据+提示词', evPrev === 2, 'pre=' + evPrev);
    // 点击切换证据条目，预览随之更新
    const evSwitch = await ev(`(()=>{var b=document.querySelectorAll('#hfEvList .hf-ev-item');b[15].click();
      var id=document.querySelector('#hfEvPreview .mono');return id?id.textContent:null;})()`);
    check('点选证据切换预览', evSwitch === 'V-04', 'id=' + evSwitch);
    await shot('v0.32-hf-证据库.png');

    /* ③ 05 修复记录 */
    await go(fileUrl('hf/repair.html'));
    const rpStat = await ev(`document.querySelectorAll('#hfRepairHost .hf-stats>div').length`);
    const rpRows = await ev(`document.querySelectorAll('#hfRepairHost .hf-repair tbody tr').length`);
    const rpFixed = await ev(`document.querySelectorAll('#hfRepairHost .hf-repair__result[data-r="fixed"]').length`);
    const rpNoTime = await ev(`(()=>{var t=document.querySelector('#hfRepairHost .hf-stats');return t&&/未采集/.test(t.textContent);})()`);
    check('修复记录读数 4 格', rpStat === 4, 'stats=' + rpStat);
    check('修复轨迹 10 行', rpRows === 10, 'rows=' + rpRows);
    check('已修复 4 条（诚实口径）', rpFixed === 4, 'fixed=' + rpFixed);
    check('耗时如实标注未采集', rpNoTime);
    await shot('v0.32-hf-修复记录.png');

    /* ④ 06 版本对比：真实提示词 diff */
    await go(fileUrl('hf/version.html'));
    const vOpts = await ev(`document.querySelectorAll('#hfVQ option').length`);
    const vCards = await ev(`document.querySelectorAll('#hfVersionHost .hf-ver-card').length`);
    const vDiff = await ev(`(()=>{var ps=document.querySelectorAll('#hfVersionHost .hf-ver-prompt');
      if(ps.length<2)return null;return {base:ps[0].textContent.length,rag:ps[1].textContent.length,
      hl:document.querySelectorAll('#hfVersionHost .hf-ver-evidence').length};})()`);
    check('版本对比题目选择 22 项', vOpts === 22, 'opts=' + vOpts);
    check('两种提示词条件卡片', vCards === 2, 'cards=' + vCards);
    check('RAG 提示词含高亮证据段', vDiff && vDiff.rag > vDiff.base && vDiff.hl >= 1, JSON.stringify(vDiff));
    // 切换题目，提示词随之更新
    const vSwitch = await ev(`(()=>{var s=document.querySelector('#hfVQ');s.value='V-08';
      s.dispatchEvent(new Event('change'));var ps=document.querySelectorAll('#hfVersionHost .hf-ver-prompt');
      return ps.length&&/CORS/.test(ps[0].textContent);})()`);
    check('切换题目更新提示词', vSwitch);
    await shot('v0.32-hf-版本对比.png');

    /* ⑤ 08 报告导出 */
    await go(fileUrl('hf/report.html'));
    const rpt = await ev(`(()=>{var p=document.querySelector('#hfReportHost .hf-report-md');
      if(!p)return null;var t=p.textContent;return {len:t.length,hasTitle:/分析报告/.test(t),
      hasDrop:/40 pp/.test(t),hasBoundary:/诚实边界/.test(t),hasTable:/逐题判定/.test(t)};})()`);
    check('报告预览已生成', rpt && rpt.len > 400, 'len=' + (rpt && rpt.len));
    check('报告含总体指标与 40pp 下降', rpt && rpt.hasTitle && rpt.hasDrop);
    check('报告含逐题判定与诚实边界', rpt && rpt.hasTable && rpt.hasBoundary);
    const rptBtns = await ev(`!!document.querySelector('#hfRepCopy') && !!document.querySelector('#hfRepDl')`);
    check('复制/下载控件存在', rptBtns);
    await shot('v0.32-hf-报告导出.png');

    /* ⑥ 看板概览（v0.33 起为独立侧栏看板）：侧栏 9 项 + 模块状态 8 行 */
    await go(fileUrl('hf/index.html'));
    const home = await ev(`(()=>{var nav=[...document.querySelectorAll('.hf-nav a')];
      var rows=document.querySelectorAll('.hf-body .hf-pool tbody tr').length;
      return {nav:nav.length,rows:rows};})()`);
    check('看板侧栏导航 9 项', home && home.nav === 9, 'nav=' + (home && home.nav));
    check('概览模块状态 8 行', home && home.rows === 8, 'rows=' + (home && home.rows));

    /* ⑦ 零外联：9 个 hf 页无 http(s) 资源引用 */
    const pages = ['hf/index.html','hf/probe.html','hf/sample.html','hf/truth.html','hf/evidence.html',
      'hf/repair.html','hf/version.html','hf/eval.html','hf/report.html'];
    let extTotal = 0;
    for (const p of pages) {
      await go(fileUrl(p));
      extTotal += await ev(`[...document.querySelectorAll('script[src],link[href],img[src]')]
        .filter(x=>/^https?:/i.test(x.src||x.href||'')).length`) || 0;
    }
    check('9 个 hf 页零外部资源', extTotal === 0, 'ext=' + extTotal);

    const failed = R.filter((r) => !r.ok);
    console.log('\n==== ' + (R.length - failed.length) + '/' + R.length + ' PASS ====');
    if (failed.length) { console.log('FAILED:', failed.map((f) => f.name).join(', ')); process.exitCode = 1; }
  } catch (e) {
    console.error('ERR', e && e.stack || e);
    process.exitCode = 1;
  } finally {
    try { chrome.kill(); } catch (e) {}
  }
})();
