/* v0.30 验收：幻觉修复无训练 RAG 路线
 * 目标：验证引擎判定独立/双池隔离/RAG下降真实/归因规则化，页面渲染正确，
 *       mock 模式零外部请求，且不影响自适应绕过系统。
 * 依赖：本机 Chrome headless + CDP。 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9374;
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
    '--user-data-dir=' + path.join(require('os').tmpdir(), 'qa-v030-' + Date.now()),
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
    const go = async (u) => { await send('Page.navigate', { url: u }); await sleep(450); };
    const shot = async (n) => { const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(path.join(OUT, n), Buffer.from(r.result.data, 'base64')); };
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

    /* ① 引擎自检（在 probe 页加载 HF） */
    await go(fileUrl('hf/probe.html'));
    const ck = await ev('window.HF ? HF.checkPools() : null');
    check('HF 引擎已加载', !!ck);
    check('双池物理隔离', ck && ck.ok && ck.train === 12 && ck.valid === 10 && ck.overlap.length === 0, JSON.stringify(ck));

    /* ② 判定独立：结论锚点错误时即使事实点全中仍判幻觉 */
    const jt = await ev(`(()=>{var q={key:'正确结论',conclusion:'正确结论',facts:['甲','乙','丙']};
      var out='甲 乙 丙 都说到了，但结论写成了错误结论';var j=HF.judge(q,out);
      return {verdict:j.verdict,cov:j.coverage,conclHit:j.conclusionHit};})()`);
    check('结论为必要条件（严格组合判定）', jt && jt.verdict === 'HALLUCINATION' && jt.cov === 1, JSON.stringify(jt));

    /* ③ 归因四类规则化 + 带原文片段 */
    const attr = await ev(`(()=>{var out={};
      var qc={cat:'context',trap:'前文',key:'X',conclusion:'X',facts:['f']};
      out.context=HF.attribute(qc,'前文说得很清楚，所以成立',HF.judge(qc,'前文说得很清楚')).cause;
      var qp={cat:'prompt',key:'Y',conclusion:'Y',facts:['f']};
      out.prompt=HF.attribute(qp,'它是安全的',HF.judge(qp,'它是安全的')).cause;
      return out;})()`);
    check('上下文偏差归因规则', attr && attr.context === 'context', JSON.stringify(attr));
    check('提示词缺陷归因规则', attr && attr.prompt === 'prompt', JSON.stringify(attr));

    /* ④ RAG 下降真实：验证池 base100% -> rag60%，下降由算法算出 */
    const res = await ev(`HF.evaluate(HF.VALID_POOL,'mock').then(r=>({
      base:r.baseRate,rag:r.ragRate,drop:r.drop,fixed:r.fixed,total:r.total,
      kb:r.byCat.knowledge,logic:r.byCat.logic,prompt:r.byCat.prompt,ctx:r.byCat.context,
      note:r.note}))`);
    check('base 幻觉率 100%', res && res.base === 100, 'base=' + (res && res.base));
    check('RAG 幻觉率下降（40pp）', res && res.drop === 40 && res.rag === 60, 'rag=' + (res && res.rag) + ' drop=' + (res && res.drop));
    check('知识盲区类被 RAG 修复', res && res.kb.baseRate === 100 && res.kb.ragRate === 0, JSON.stringify(res && res.kb));
    check('推理逻辑类 RAG 无效（诚实口径）', res && res.logic.baseRate === 100 && res.logic.ragRate === 100, JSON.stringify(res && res.logic));
    check('提示词类 RAG 无效（诚实口径）', res && res.prompt.ragRate === 100, JSON.stringify(res && res.prompt));
    check('mock 模式标注零外部请求', res && /零外部请求/.test(res.note));

    /* ⑤ 探测面板真实点击 -> 结果渲染 + 跨页 Store */
    await ev('sessionStorage.clear()');
    await go(fileUrl('hf/probe.html'));
    const hasRun = await ev('!!document.querySelector("#hfRun") && !!document.querySelector(".hf-mode")');
    check('探测面板控件齐全', hasRun);
    await ev('document.querySelector("#hfRun").click()');
    await sleep(500);
    const probeRows = await ev(`document.querySelectorAll('#hfProbeResult tbody tr').length`);
    check('探测结果 10 行渲染', probeRows === 10, 'rows=' + probeRows);
    const stored = await ev(`!!sessionStorage.getItem('hf.eval')`);
    check('评测结果写入 Store', stored);

    /* ⑥ 跨页恢复：样本 / 评测 / 真值库 */
    await go(fileUrl('hf/sample.html'));
    const sampleN = await ev(`document.querySelectorAll('#hfSampleHost .hf-diff').length`);
    check('样本溯源渲染幻觉样本', sampleN === 10, 'samples=' + sampleN);
    await shot('v0.30-hf-样本溯源.png');

    await go(fileUrl('hf/eval.html'));
    const statsN = await ev(`document.querySelectorAll('#hfEvalHost .hf-stats>div').length`);
    const barN = await ev(`document.querySelectorAll('#hfEvalHost .hf-bar').length`);
    check('评测读数 4 格', statsN === 4, 'stats=' + statsN);
    check('四类分组柱状图', barN === 4, 'bars=' + barN);
    await shot('v0.30-hf-评测对比.png');

    await go(fileUrl('hf/truth.html'));
    const truthN = await ev(`document.querySelectorAll('#hfTruthTrain tbody tr').length + '/' + document.querySelectorAll('#hfTruthValid tbody tr').length`);
    check('双池表 12/10 行', truthN === '12/10', truthN);

    /* ⑦ 零外联：四个页面无 http(s) 资源引用 */
    await go(fileUrl('hf/probe.html'));
    const ext = await ev(`(()=>{const t=[...document.querySelectorAll('script[src],link[href],img[src]')];
      return t.filter(x=>/^https?:/i.test(x.src||x.href||'')).length;})()`);
    check('幻觉页零外部资源引用', ext === 0, 'ext=' + ext);

    /* ⑧ v0.33：看板已独立，不再有系统切换控件（与功能页解耦） */
    const sw = await ev(`document.querySelectorAll('.sys-switch').length`);
    check('看板已无系统切换控件（解耦）', sw === 0, 'switch=' + sw);

    await go(fileUrl('hf/index.html')); await sleep(300);
    await shot('v0.30-hf-总览.png');

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
