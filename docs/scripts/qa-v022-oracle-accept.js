/* v0.22 独立裁决闭环 · 独立验收（严过关）
 * 用法：node docs/scripts/qa-v022-oracle-accept.js
 * 端口 9376（避开 9333/9334/9335/9344/9355/9356/936x/9371/9372/9374/9375）。
 * 依赖：本机 Chrome + Node 22 全局 WebSocket，零 npm 依赖、零外部请求。
 *
 * 数据来自真实跑 4 次任务（CONVERGE_3 / DEGRADED / NO_CONVERGE / 越界），
 * 不内嵌编造报告；覆盖：裁决分支与独立性 / 双轨 UI / 结论优先级 /
 * 报告 5 附录契约 / 配置页剧本库联动 / 打印黑白 / 对比度·字号·44px·四档溢出 /
 * 旧缓存兼容 / 零外联 / 控制台异常。
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const os = require('os');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9376;
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
  async goto(u) { await this.send('Page.navigate', { url: u }); await sleep(560); }
  async vp(w, h) { await this.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }); await new Promise(r => setTimeout(r, 160)); }
}

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + path.join(os.tmpdir(), 'qa-v022-' + Date.now()),
  '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' });

(async () => {
  let c;
  try {
    let tg; for (let i = 0; i < 40; i++) { try { tg = await getJSON('http://127.0.0.1:' + PORT + '/json/list'); break; } catch (e) { await sleep(150); } }
    c = new CDP(tg.find(t => t.type === 'page').webSocketDebuggerUrl); await c.ready();
    await c.send('Page.enable'); await c.send('Runtime.enable'); await c.send('Network.enable'); await c.send('Log.enable');
    await c.vp(1440, 900);

    /* ===== §1 真实跑 4 次任务，校验裁决分支与独立性 ===== */
    const cases = [
      { key: 'CONVERGE_3', url: 'http://127.0.0.1/lab/sqli_01.php', expect: { claims: 1, confirmed: 1, refuted: 0, disagreement: 0, used: 3 } },
      { key: 'DEGRADED', url: 'http://127.0.0.1/lab/sqli_01.php', expect: { claims: 1, confirmed: 0, refuted: 1, disagreement: 3, used: 4 } },
      { key: 'NO_CONVERGE', url: 'http://127.0.0.1/lab/sqli_01.php', expect: { claims: 0, confirmed: 0, refuted: 0, disagreement: 0, used: 8 } },
      { key: 'OOS', url: 'https://example.com/x', expect: { claims: 1, confirmed: 0, refuted: 0, disagreement: 0, used: 3 } }
    ];
    const reports = {};
    for (const cs of cases) {
      const script = cs.key === 'OOS' ? 'CONVERGE_3' : cs.key;
      await c.goto(fileUrl('monitor.html'));
      await c.eval(`sessionStorage.clear();sessionStorage.setItem('probe.cfg',JSON.stringify({url:${JSON.stringify(cs.url)},vulnType:'sqli',script:${JSON.stringify(script)}}));sessionStorage.setItem('probe.pendingRun','1');`);
      await c.goto(fileUrl('monitor.html'));
      let st = 'idle', t = 0;
      while (t++ < 120) {
        st = await c.eval(`document.querySelector('#dash')?document.querySelector('#dash').dataset.state:'?'`);
        if (['hit', 'nofind', 'degraded', 'oos', 'cancel', 'error'].includes(st)) break;
        await sleep(250);
      }
      const raw = await c.eval(`sessionStorage.getItem('probe.report')`);
      const r = JSON.parse(raw);
      reports[cs.key] = r;
      const cr = r.credibility;
      ok(cs.key + ' 真实任务产出 report + credibility', !!raw && !!cr && st !== 'idle',
        'state=' + st + ' rounds=' + r.rounds.length + ' bytes=' + (raw || '').length);
      ok(cs.key + ' 裁决计数符合标注集', cr.claims === cs.expect.claims && cr.confirmed === cs.expect.confirmed &&
        cr.refuted === cs.expect.refuted && cr.disagreement === cs.expect.disagreement && cr.used === cs.expect.used,
        JSON.stringify({ claims: cr.claims, confirmed: cr.confirmed, refuted: cr.refuted, dis: cr.disagreement, used: cr.used }));
      const fieldsOK = r.rounds.every(x => typeof x.ai_claim === 'boolean' && x.gt_ref && typeof x.gt_triggered === 'boolean' &&
        x.oracle_verdict && x.oracle_source === 'LAB-GT-01');
      ok(cs.key + ' 每轮双通道字段齐全', fieldsOK, 'rounds=' + r.rounds.length);
    }
    const dg = reports.DEGRADED, cv = reports.CONVERGE_3, nc = reports.NO_CONVERGE, oos = reports.OOS;
    ok('独立性：DEGRADED R4 模型判 VULNERABLE 但裁决 REFUTED',
      dg.rounds[3].verdict === 'VULNERABLE' && dg.rounds[3].oracle_verdict === 'REFUTED' && dg.rounds[3].gt_triggered === false,
      'verdict=' + dg.rounds[3].verdict + ' oracle=' + dg.rounds[3].oracle_verdict);
    ok('模型自证 PASSED 原文保留但不作为裁决依据',
      dg.rounds[3].validation_result === 'PASSED' && dg.rounds[3].oracle_verdict === 'REFUTED' &&
      /"validation":\s*"PASSED"/.test(dg.rounds[3].model_decision_raw));
    ok('裁决不读置信度：同为 0.91 的两轮得到不同裁决',
      cv.rounds[2].confidence === dg.rounds[3].confidence &&
      cv.rounds[2].oracle_verdict === 'CONFIRMED' && dg.rounds[3].oracle_verdict === 'REFUTED');
    ok('降级轮不是「阴性结论」而是 UNCONFIRMED',
      dg.rounds[1].oracle_verdict === 'UNCONFIRMED' && dg.rounds[2].oracle_verdict === 'UNCONFIRMED');
    ok('NO_CONVERGE 跑满 8 轮预算且无虚假阳性', nc.rounds.length === 8 && nc.credibility.cap === 8 &&
      nc.credibility.claims === 0 && nc.credibility.signalRounds.length === 0);
    ok('越界全部 NOT_APPLICABLE 且诚信标注保留', oos.task.out_of_scope === true &&
      oos.credibility.na === 3 && oos.credibility.confirmed === 0 && oos.mock_flag === true);
    ok('precision 只作本次计数口径不外推', cv.credibility.precision === 1 && dg.credibility.precision === 0 &&
      nc.credibility.precision === null);

    /* ===== §2 证据链页：双轨 / 明细 / 结论优先级 ===== */
    const setReport = async r => {
      await c.goto(fileUrl('evidence.html'));
      await c.eval(`sessionStorage.setItem('probe.report',${JSON.stringify(JSON.stringify(r))})`);
      await c.goto(fileUrl('evidence.html'));
    };
    await setReport(dg);
    const ev = await c.eval(`(()=>({
      cells:document.querySelectorAll('.orc-cell').length,
      claimCells:document.querySelectorAll('.orc-track--claim .orc-cell').length,
      oracleCells:document.querySelectorAll('.orc-track--oracle .orc-cell').length,
      clash:document.querySelectorAll('.orc-track--oracle .orc-cell.is-clash').length,
      clashText:[...document.querySelectorAll('.orc-track--oracle .orc-cell.is-clash .orc-cell__t')].map(e=>e.textContent),
      r4Claim:document.querySelector('.orc-track--claim .orc-cell[data-round="4"]')?.getAttribute('data-claim'),
      r4Oracle:document.querySelector('.orc-track--oracle .orc-cell[data-round="4"]')?.getAttribute('data-v'),
      detailRows:document.querySelectorAll('#orcDetail tbody tr').length,
      gtCells:[...document.querySelectorAll('#orcDetail tbody tr td:nth-child(3)')].map(e=>e.textContent),
      stats:[...document.querySelectorAll('.orc-stat b')].map(e=>e.textContent),
      set:document.querySelector('#orcSet').textContent,
      verdictNote:document.querySelector('#orcVerdict').textContent,
      tone:document.querySelector('#orcVerdict').getAttribute('data-tone'),
      note:document.querySelector('#orcNote').textContent
    }))()`);
    ok('双轨各 8 格、与轮次预算同源', ev.cells === 16 && ev.claimCells === 8 && ev.oracleCells === 8);
    ok('DEGRADED 下轨 3 个错位格且都有中文短标签',
      ev.clash === 3 && ev.clashText.filter(t => t && t.trim()).length === 3, JSON.stringify(ev.clashText));
    ok('R4 上轨声称阳性 / 下轨证伪（错位可核对）',
      ev.r4Claim === 'pos' && ev.r4Oracle === 'REFUTED', 'claim=' + ev.r4Claim + ' oracle=' + ev.r4Oracle);
    ok('明细表 3 行且点位标注全部为「点位未触发」',
      ev.detailRows === 3 && ev.gtCells.length === 3 && ev.gtCells.every(t => t === '点位未触发'), JSON.stringify(ev.gtCells));
    ok('4 个读数取自 credibility 真值', JSON.stringify(ev.stats) ===
      JSON.stringify(['1', '0', '3', 'R04']), JSON.stringify(ev.stats));
    ok('结论优先级消除「已检出 vs 证伪」矛盾',
      ev.tone === 'warn' && /独立裁决优先/.test(ev.verdictNote) && /不作为最终判定/.test(ev.verdictNote));
    ok('诚信标注齐全（标注集 / 不读置信度 / 不采信自证 / 非实测误报率）',
      /LAB-GT-01/.test(ev.set) && /不读取模型置信度/.test(ev.note) &&
      /validation:PASSED/.test(ev.note) && /不构成实测误报率/.test(ev.note));
    ok('buildCredibility 对同一 report 幂等', await c.eval(`(()=>{
      const r=JSON.parse(sessionStorage.getItem('probe.report'));
      return JSON.stringify(Probe.buildCredibility(r))===JSON.stringify(Probe.buildCredibility(r));})()`));

    /* 旧缓存兼容：删掉 credibility 后按同一规则现算 */
    const legacy = JSON.parse(JSON.stringify(dg)); delete legacy.credibility;
    await setReport(legacy);
    ok('旧会话缓存（无 credibility）自动现算，双轨不塌', await c.eval(`(()=>({
      cells:document.querySelectorAll('.orc-cell').length,
      clash:document.querySelectorAll('.orc-track--oracle .orc-cell.is-clash').length}))()`)
      .then(o => o.cells === 16 && o.clash === 3));

    /* 干净成功态：无错位格、两轨一致 */
    await setReport(cv);
    const clean = await c.eval(`(()=>({
      clash:document.querySelectorAll('.orc-cell.is-clash').length,
      none:document.querySelector('.orc-detail__none')?.textContent||'',
      tone:document.querySelector('#orcVerdict').getAttribute('data-tone')}))()`);
    ok('CONVERGE_3 无错位格且给出「不代表不会误报」的克制说明',
      clean.clash === 0 && clean.tone === 'ok' && /不代表系统不会误报/.test(clean.none));

    /* 空态 */
    await c.goto(fileUrl('evidence.html'));
    await c.eval(`sessionStorage.removeItem('probe.report')`);
    await c.goto(fileUrl('evidence.html'));
    ok('无报告时整页空态且裁决卡一并隐藏', await c.eval(`(()=>({
      wrap:document.querySelector('#evidenceWrap').classList.contains('hidden'),
      empty:!document.querySelector('#evidenceEmpty').classList.contains('hidden'),
      card:document.querySelector('#oracleCard').offsetParent===null}))()`)
      .then(o => o.wrap && o.empty && o.card));

    /* ===== §3 报告页：5 附录契约 + 裁决读数 + 打印黑白 ===== */
    await setReport(dg);
    await c.goto(fileUrl('report.html'));
    const rp = await c.eval(`(()=>({
      secs:document.querySelectorAll('#reportCard .report-sec').length,
      audit:document.querySelectorAll('.rpt-audit').length,
      figures:[...document.querySelectorAll('.rpt-audit__cells b')].map(e=>e.textContent),
      note:document.querySelector('.rpt-audit .rpt-note').textContent,
      lead:document.querySelector('.rpt-sec[data-sec="03"] .rpt-sec__lead').textContent,
      export:!!document.querySelector('#exportBtn')}))()`);
    ok('报告仍是 5 附录 + 导出按钮（QA51 契约不变）', rp.secs === 5 && rp.export);
    ok('02 裁决读数取自 report 真值', JSON.stringify(rp.figures) === JSON.stringify(['1', '0', '3', 'R04']),
      JSON.stringify(rp.figures));
    ok('02 说明「终态 ≠ 裁决」与冲突优先级', /任务终态/.test(rp.note) && /以裁决为准/.test(rp.note));
    ok('附录 A 标明记录的是模型侧判定', /模型侧判定/.test(rp.lead));
    await c.send('Emulation.setEmulatedMedia', { media: 'print' });
    const pr = await c.eval(`(()=>({
      auditBg:getComputedStyle(document.querySelector('.rpt-audit__cells>div')).backgroundColor,
      warnColor:getComputedStyle(document.querySelector('.rpt-audit__cells b.is-warn')).color,
      secs:document.querySelectorAll('#reportCard .report-sec').length}))()`);
    ok('打印态裁决读数白底黑字（无彩色格 / 彩色告警字）',
      pr.auditBg === 'rgb(255, 255, 255)' && pr.warnColor === 'rgb(17, 17, 17)' && pr.secs === 5,
      JSON.stringify(pr));
    await c.send('Emulation.setEmulatedMedia', { media: '' });

    /* ===== §4 配置页剧本库联动 ===== */
    await c.goto(fileUrl('settings.html'));
    const st = await c.eval(`(()=>{
      const cards=[...document.querySelectorAll('.cfg-scn__card')];
      return {n:cards.length,audit:cards.map(x=>({script:x.getAttribute('data-script'),
        text:x.querySelector('.cfg-scn__audit')?.textContent||'',
        warn:!!x.querySelector('.cfg-scn__audit.is-warn')}))};})()`);
    ok('3 张剧本卡都有裁决预告', st.n === 3 && st.audit.every(a => /LAB-GT-01/.test(a.text) && /待复核/.test(a.text)),
      JSON.stringify(st.audit));
    const dgCard = st.audit.find(a => a.script === 'DEGRADED');
    ok('DEGRADED 剧本卡预告「证伪 1 · 待复核 3」且标为告警语义',
      !!dgCard && /证伪 1/.test(dgCard.text) && /待复核 3/.test(dgCard.text) && dgCard.warn,
      dgCard ? dgCard.text : 'missing');

    /* ===== §5 视觉规格：对比度 / 字号 / 44px / 四档溢出 ===== */
    await setReport(dg);
    await c.vp(1440, 900);
    const scan = await c.eval(SCAN);
    ok('证据链页有数据态对比度 ≥4.5:1 且最小字号 ≥11px',
      scan.badCount === 0 && scan.minSize >= 11, 'min=' + scan.min + ':1 minSize=' + scan.minSize + 'px nodes=' + scan.count);
    const hit = await c.eval(HIT44);
    ok('证据链页可见交互目标 <44px 为 0', hit.length === 0, JSON.stringify(hit.slice(0, 4)));
    for (const [w, h] of [[1440, 900], [1100, 800], [768, 1024], [390, 844]]) {
      await c.vp(w, h);
      const of = await c.eval(`document.documentElement.scrollWidth>window.innerWidth+1`);
      ok('证据链页 ' + w + 'px 零横向溢出', !of);
    }
    await c.vp(1440, 900);
    await c.goto(fileUrl('report.html'));
    for (const [w, h] of [[1440, 900], [1100, 800], [768, 1024], [390, 844]]) {
      await c.vp(w, h);
      const of = await c.eval(`document.documentElement.scrollWidth>window.innerWidth+1`);
      ok('报告页 ' + w + 'px 零横向溢出', !of);
    }
    await c.vp(1440, 900);

    /* ===== §6 零外联 / 控制台异常 ===== */
    const external = c.events.filter(e => e.method === 'Network.requestWillBeSent' &&
      !/^(file|data|about|chrome):/.test(e.params.request.url || ''));
    ok('零外部请求', external.length === 0, JSON.stringify(external.slice(0, 3).map(e => e.params.request.url)));
    const exceptions = c.events.filter(e => e.method === 'Runtime.exceptionThrown' || e.method === 'Log.entryAdded' &&
      e.params.entry && e.params.entry.level === 'error');
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
