/* v0.21 报告页重设计 · 独立验收（严过关）
 * 用法：node docs/scripts/qa-v021-report-accept.js
 * 端口 9372（避开 9333/9334/9335/9344/9355/9356/936x/9371）。
 * 依赖：本机 Chrome + Node 22 全局 WebSocket，零 npm 依赖、零外部请求。
 *
 * 数据来自真实跑一次任务（任务台点击「开始分析」→ 监控页执行 → sessionStorage.probe.report），
 * 不内嵌编造报告；4 个终态分支用「派生边界输入」改写该真实报告的判定字段，仅用于验证渲染分支。
 * 覆盖：5 附录 / 签发章 / 3 读数 / 8 格轮次预算 / 逐轮表 / 有数据态对比度·字号·44px·四档溢出 /
 *       打印黑白与 beforeprint 展开 / 空态 / 4 终态 / 零外联 / 控制台异常。
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const os = require('os');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9372;
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

/* 页面内：逐层背景合成 + WCAG 实算 + 最小字号（与 v018-visual-spec-check 同口径） */
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

/* 页面内：可见交互目标 rect < 44px 扫描（与 qa-v019-audit-dom 同口径） */
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
  async goto(u) { await this.send('Page.navigate', { url: u }); await sleep(520); }
  async vp(w, h) { await this.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }); await sleep(160); }
}

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + path.join(os.tmpdir(), 'qa-v021-' + Date.now()),
  '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' });

(async () => {
  let c;
  try {
    let tg; for (let i = 0; i < 40; i++) { try { tg = await getJSON('http://127.0.0.1:' + PORT + '/json/list'); break; } catch (e) { await sleep(150); } }
    c = new CDP(tg.find(t => t.type === 'page').webSocketDebuggerUrl); await c.ready();
    await c.send('Page.enable'); await c.send('Runtime.enable'); await c.send('Network.enable'); await c.send('Log.enable');
    await c.vp(1440, 900);

    /* ===== §1 真实跑一次任务，取回引擎产出的完整 report ===== */
    await c.goto(fileUrl('console.html'));
    await c.eval(`document.querySelector('#authChk').click();document.querySelector('#startBtn').click();`);
    await sleep(900);
    let st = 'idle', t = 0;
    while (t++ < 90) {
      st = await c.eval(`document.querySelector('#dash')?document.querySelector('#dash').dataset.state:'?'`);
      if (['hit', 'nofind', 'degraded', 'oos', 'cancel', 'error'].includes(st)) break;
      await sleep(250);
    }
    const rep = await c.eval(`sessionStorage.getItem('probe.report')`);
    ok('真实任务产出 report（非内嵌假数据）', !!rep && st === 'hit', 'state=' + st + ' bytes=' + (rep || '').length);
    const r = JSON.parse(rep);

    /* ===== §2 报告页结构与真值投影 ===== */
    await c.goto(fileUrl('report.html'));
    const s = await c.eval(`(()=>({
      secs:document.querySelectorAll('#reportCard .report-sec').length,
      export:!!document.querySelector('#exportBtn'),
      emptyHidden:document.querySelector('#reportEmpty').classList.contains('hidden'),
      wrapHidden:document.querySelector('#reportCardWrap').classList.contains('hidden'),
      seal:document.querySelector('.rpt-seal').dataset.s,
      glyph:document.querySelector('.rpt-seal__g').dataset.g,
      verdict:document.querySelector('.rpt-seal__txt b').textContent,
      term:document.querySelector('.rpt-seal__txt small').textContent,
      stats:[...document.querySelectorAll('.rpt-stats b')].map(e=>e.textContent.trim()),
      facts:[document.querySelectorAll('.rpt-sec[data-sec="01"] .rpt-facts>div').length,
             document.querySelectorAll('.rpt-sec[data-sec="05"] .rpt-facts>div').length],
      rail:{all:document.querySelectorAll('.rpt-rail i').length,
            used:document.querySelectorAll('.rpt-rail i:not(.is-empty)').length,
            empty:document.querySelectorAll('.rpt-rail i.is-empty').length,
            anomaly:document.querySelectorAll('.rpt-rail i[data-cls="ANOMALY"]').length,
            deg:document.querySelectorAll('.rpt-rail i.is-deg').length},
      table:{rows:document.querySelectorAll('.tbl tbody tr').length,
             key:document.querySelectorAll('.tbl tbody tr.is-key').length,
             blocked:document.querySelectorAll('.tag.blocked').length,
             anomaly:document.querySelectorAll('.tag.anomaly').length},
      pre:document.querySelectorAll('details.raw pre').length,
      noFakePaging:!/第\\s*1\\s*\\/\\s*1\\s*页/.test(document.querySelector('.watermark').textContent)
    }))()`);
    ok('5 附录 + 导出按钮 + 空态隐藏', s.secs === 5 && s.export && s.emptyHidden && !s.wrapHidden,
      'secs=' + s.secs);
    ok('签发章终态与引擎判定一致（hit / 已攻破）', s.seal === 'hit' && s.glyph === 'hit' && s.verdict === '已攻破',
      s.seal + ' / ' + s.verdict + ' / ' + s.term);
    ok('签发章不重复 HIT · HIT', s.term.indexOf('HIT · HIT') < 0, s.term);
    ok('3 读数取自 report 真值', s.stats[0].indexOf(String(r.rounds.length)) === 0 &&
      s.stats[1].indexOf(String(r.elapsed_ms)) === 0 && s.stats[2].indexOf(String(r.degraded_rounds.length)) === 0,
      JSON.stringify(s.stats));
    /* v0.36：封面新增「收敛种子」用于复现本次攻破轮，故 7 项 */
    ok('封面 7 项（含收敛种子）/ 附录 C 8 项事实格', s.facts[0] === 7 && s.facts[1] === 8, JSON.stringify(s.facts));
    /* v0.36.2：轮次流水只列实际投递轮次，无分母、无预置空槽 */
    ok('轮次流水 = 实际投递轮次（无空槽）；命中 / 降级与 report 一致',
      s.rail.all === r.rounds.length && s.rail.used === r.rounds.length && s.rail.empty === 0 &&
      s.rail.anomaly === r.rounds.filter(x => x.response_class === 'ANOMALY').length &&
      s.rail.deg === r.degraded_rounds.length, JSON.stringify(s.rail));
    ok('逐轮表：行数 / 命中行 / 响应分类标签一致',
      s.table.rows === r.rounds.length && s.table.key === r.rounds.filter(x => x.hit_signal).length &&
      s.table.blocked === r.rounds.filter(x => x.response_class === 'BLOCKED').length &&
      s.table.anomaly === r.rounds.filter(x => x.response_class === 'ANOMALY').length, JSON.stringify(s.table));
    ok('模型决策原文 3 条 + 水印无虚假页码', s.pre === r.rounds.length && s.noFakePaging);

    /* ===== §3 有数据态：对比度 / 字号 / 44px / 四档视口 ===== */
    const scan = await c.eval(SCAN);
    ok('有数据态正文 WCAG ≥4.5:1 且字号 ≥11px', scan.badCount === 0 && scan.minSize >= 11,
      '节点=' + scan.count + ' 最低=' + scan.min + ':1 最小=' + scan.minSize + 'px 未达标=' + scan.badCount +
      (scan.badCount ? ' ' + JSON.stringify(scan.bad) : ''));
    const hit44 = await c.eval(HIT44);
    ok('有数据态交互目标 <44px 为 0', hit44.length === 0, JSON.stringify(hit44));
    let overflow = [];
    for (const [w, h] of [[1440, 900], [1100, 900], [768, 900], [390, 844]]) {
      await c.vp(w, h);
      const o = await c.eval(`(()=>{const d=document.documentElement;return {sw:d.scrollWidth,cw:d.clientWidth};})()`);
      if (o.sw > o.cw + 1) overflow.push(w + ':' + o.sw + '/' + o.cw);
    }
    ok('有数据态四档视口零横向溢出', overflow.length === 0, overflow.join(' ') || '1440/1100/768/390 全通过');
    await c.vp(1440, 900);

    /* ===== §4 打印：黑白输出 + beforeprint 展开 JSON 附录 ===== */
    await c.eval(`window.dispatchEvent(new Event('beforeprint'))`);
    const opened = await c.eval(`[...document.querySelectorAll('details.raw')].every(d=>d.open)`);
    ok('beforeprint 展开全部 JSON 附录（Ctrl+P 不丢内容）', opened === true);
    await c.send('Emulation.setEmulatedMedia', { media: 'print' });
    const pr = await c.eval(`(()=>{
      const bg=s=>{const e=document.querySelector(s);return e?getComputedStyle(e).backgroundColor:'N/A'};
      return {body:getComputedStyle(document.body).backgroundColor,
        card:bg('.card'),seal:bg('.rpt-seal'),tag:bg('.tag.blocked'),
        hitRow:bg('.tbl tbody tr.is-key td'),normalRow:bg('.tbl tbody tr:not(.is-key) td'),
        hitCell:bg('.rpt-rail i[data-cls="ANOMALY"]'),
        hitBorder:getComputedStyle(document.querySelector('.rpt-rail i[data-cls="ANOMALY"]')).borderTopWidth,
        blockBorder:getComputedStyle(document.querySelector('.rpt-rail i[data-cls="BLOCKED"]')).borderTopWidth,
        export:document.querySelector('#exportBtn')?getComputedStyle(document.querySelector('#exportBtn')).display:'gone',
        secs:document.querySelectorAll('#reportCard .report-sec').length};
    })()`);
    const white = v => /rgba?\(255,\s*255,\s*255/.test(v);
    ok('打印背景纯白（card / seal / tag / 表格行 / 命中格）',
      white(pr.body) && white(pr.card) && white(pr.seal) && white(pr.tag) && white(pr.hitRow) &&
      white(pr.normalRow) && white(pr.hitCell),
      JSON.stringify(pr));
    ok('打印命中格用粗框与拦截格区分（不靠颜色）',
      parseFloat(pr.hitBorder) > parseFloat(pr.blockBorder), pr.hitBorder + ' vs ' + pr.blockBorder);
    ok('打印隐藏导出按钮且 5 附录齐全', pr.export === 'none' && pr.secs === 5);
    await c.send('Emulation.setEmulatedMedia', { media: '' });

    /* ===== §5 四个终态分支（派生边界输入，仅验证渲染分支） ===== */
    const cases = [
      { name: 'HIT', mutate: x => x, expect: ['hit', '已攻破'] },
      { name: 'MAX_ROUNDS', mutate: x => { x.terminate_reason = 'MAX_ROUNDS'; x.findings = []; x.rounds.forEach(q => q.hit_signal = false); return x; }, expect: ['nofind', '未攻破'] },
      { name: 'DEGRADED', mutate: x => { x.terminate_reason = 'HIT'; x.degraded_rounds = [2, 3]; x.rounds[1].degraded_flag = true; x.rounds[2].degraded_flag = true; return x; }, expect: ['degraded', '降级攻破'] },
      { name: 'OOS', mutate: x => { x.task.out_of_scope = true; x.terminate_reason = 'HIT'; return x; }, expect: ['oos', '模拟命中'] }
    ];
    for (const cs of cases) {
      const obj = cs.mutate(JSON.parse(rep));
      await c.eval(`sessionStorage.setItem('probe.report',${JSON.stringify(JSON.stringify(obj))})`);
      await c.goto(fileUrl('report.html'));
      const v = await c.eval(`(()=>({s:document.querySelector('.rpt-seal').dataset.s,
        g:document.querySelector('.rpt-seal__g').dataset.g,
        word:document.querySelector('.rpt-seal__txt b').textContent,
        oos:!!document.querySelector('.oos-notice'),secs:document.querySelectorAll('#reportCard .report-sec').length}))()`);
      ok('终态分支 ' + cs.name + ' 形状/文案/越界声明正确',
        v.s === cs.expect[0] && v.g === cs.expect[0] && v.word === cs.expect[1] &&
        v.oos === (cs.name === 'OOS') && v.secs === 5,
        JSON.stringify(v));
    }

    /* ===== §6 空态 ===== */
    await c.eval(`sessionStorage.removeItem('probe.report')`);
    await c.goto(fileUrl('report.html'));
    const em = await c.eval(`(()=>({visible:!document.querySelector('#reportEmpty').classList.contains('hidden'),
      items:document.querySelectorAll('.rpt-empty__list li').length,
      go:!!document.querySelector('#reportEmpty a.btn-solid'),
      wrapHidden:document.querySelector('#reportCardWrap').classList.contains('hidden'),
      under44:${HIT44}}))()`);
    ok('空态：3 条附录预告 + 前往任务台 + 报告壳隐藏',
      em.visible && em.items === 3 && em.go && em.wrapHidden && em.under44.length === 0, JSON.stringify(em));

    /* ===== §7 零外联 / 控制台异常 ===== */
    const ext = c.events.filter(e => e.method === 'Network.requestWillBeSent')
      .map(e => e.params.request.url).filter(u => /^https?:/.test(u) && !/127\.0\.0\.1:9372/.test(u));
    const errs = c.events.filter(e => e.method === 'Runtime.exceptionThrown' ||
      (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'));
    ok('零外部 http(s) 请求 / 控制台异常 0', ext.length === 0 && errs.length === 0,
      'ext=' + ext.length + ' errors=' + errs.length);

    console.log('\n========================================');
    console.log('v0.21 报告页验收：' + (fail === 0 ? '全部通过' : '未通过 ' + fail + ' 项') + '  (' + pass + '/' + (pass + fail) + ')');
    console.log('========================================');
    if (fail) process.exitCode = 1;
  } catch (e) { console.error('[ERROR] ' + (e && e.stack || e)); process.exitCode = 1; }
  finally { if (chrome) chrome.kill('SIGKILL'); }
})();
