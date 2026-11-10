/* AIBBBG Version1 · 真实代码测试运行器
 * 方式：用 vm 沙箱加载 webapp/js/console.js（外部化后的核心逻辑，真实源码，非复制），
 *       以 DOM mock 驱动，提取真实函数执行断言。 */
const fs = require('fs');
const vm = require('vm');
const { URL, URLSearchParams } = require('url');

const HTML = fs.readFileSync('D:/AIBBBG/Version1/webapp/js/console.js', 'utf8');

/* 直接加载外部化后的核心逻辑脚本（原内联 <script> 已拆分为 js/console.js） */
const code = HTML;

/* 状态机契约函数以 typeof 安全导出：实现前为 null（新断言 FAIL、上方 76 项仍 PASS），
   实现后为标准引用——以此证明断言确实捕获了"尚未实现"的能力（测试先行）。 */
const exported = code + `
;globalThis.__T={
  esc,displayUrl,scopeOK,SCRIPTS,CONFIG,RUNTIME,paintBars,paintRail,setMeter,markHot,MockEngine,AnalysisEngine,
  resolveTerminalState:(typeof resolveTerminalState!=='undefined'?resolveTerminalState:null),
  applyTerminalState:(typeof applyTerminalState!=='undefined'?applyTerminalState:null),
  setDashState:(typeof setDashState!=='undefined'?setDashState:null),
  onEvent:(typeof onEvent!=='undefined'?onEvent:null),
  start:(typeof start!=='undefined'?start:null),
  cancelRun:(typeof cancelRun!=='undefined'?cancelRun:null),
  ReportStore:(typeof ReportStore!=='undefined'?ReportStore:null),
  setRunState:(typeof setRunState!=='undefined'?setRunState:null)
};`;

/* ---------- DOM / window mock ---------- */
function makeEl() {
  return {
    _html: '', _s: new Set(),
    classList: {
      _set: new Set(),
      add(c){ this._set.add(c); }, remove(c){ this._set.delete(c); },
      toggle(c,f){ if(f===undefined){ this._set.has(c)?this._set.delete(c):this._set.add(c); } else { f?this._set.add(c):this._set.delete(c); } },
      contains(c){ return this._set.has(c); }
    },
    dataset: {}, style: { _m:{}, setProperty(k,v){ this._m[k]=v; }, width:'' },
    textContent: '', value: '', checked: true, children: [], scrollTop: 0, scrollHeight: 0, disabled: false,
    _attr: {}, setAttribute(k,v){ this._attr[k]=String(v); }, getAttribute(k){ return (k in this._attr)?this._attr[k]:null; },
    appendChild(c){ this.children.push(c); }, addEventListener(){},
    closest(){ return this; }, querySelector(){ return makeEl(); }, querySelectorAll(){ return []; },
    onclick: null, open: false,
    get innerHTML(){ return this._html; }, set innerHTML(v){ this._html = v; }
  };
}
let railEls = null;
const cache = {};
const docMock = {
  getElementById(id){ return cache['#'+id] || (cache['#'+id] = makeEl()); },
  querySelector(sel){ return cache[sel] || (cache[sel] = makeEl()); },
  querySelectorAll(sel){
    if (sel === '#rail i') { return railEls || (railEls = Array.from({length:8},(_,i)=>{ const e=makeEl(); e.dataset.r=String(i+1); return e; })); }
    return [];
  },
  createElement(){ return makeEl(); },
  documentElement:{ style:{ setProperty(){} } },
  addEventListener(){}
};
const winMock = {
  matchMedia: ()=>({ matches:false }),
  addEventListener(){}, print(){},
  IntersectionObserver: function(){ this.observe=()=>{}; this.unobserve=()=>{}; this.disconnect=()=>{}; },
  setTimeout:(fn)=>{ try{fn();}catch(e){} return 0; }, clearTimeout:()=>{},
  setInterval:()=>0, clearInterval:()=>{}, requestAnimationFrame:()=>0
};
const sandbox = {
  console, URL, URLSearchParams, IntersectionObserver: winMock.IntersectionObserver,
  location: { search:'', href:'' },
  setTimeout:(fn)=>{ try{fn();}catch(e){} return 0; }, clearTimeout:()=>{},
  setInterval:()=>0, clearInterval:()=>{}, requestAnimationFrame:()=>0,
  window: winMock, document: docMock, Math, JSON, Date, Promise, RegExp, Object, Array, String, Number, Boolean, Error
};
vm.createContext(sandbox);
try { vm.runInContext(exported, sandbox); }
catch (e) { console.error('LOAD ERROR:', e && e.stack || e); process.exit(3); }
const T = sandbox.__T;

/* ---------- 断言框架 ---------- */
let pass = 0, fail = 0; const cases = [];
function ok(name, cond, detail){ if (cond){ pass++; cases.push(['PASS', name, detail||'']); } else { fail++; cases.push(['FAIL', name, detail||'期望成立但为假']); } }
function eq(name, a, b){ const c = JSON.stringify(a)===JSON.stringify(b); ok(name, c, `实际=${JSON.stringify(a)} 期望=${JSON.stringify(b)}`); }

/* ---------- 1. esc：XSS 转义（含边界/异常） ---------- */
eq('esc 转义 < > & " \'', T.esc('<b>&"\'</b>'), '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
eq('esc null → 空串', T.esc(null), '');
eq('esc undefined → 空串', T.esc(undefined), '');
eq('esc 数字 5', T.esc(5), '5');
ok('esc 不泄漏原始尖括号', !T.esc('<img src=x onerror=alert(1)>').includes('<'), '已转义');

/* ---------- 2. displayUrl：凭据剥离 + 边界 ---------- */
eq('displayUrl 剥离 user:pass', T.displayUrl('http://user:pass@example.com/p?x=1'), 'http://example.com/p?x=1');
eq('displayUrl 无凭据原样', T.displayUrl('https://lab-target-01.lab/x'), 'https://lab-target-01.lab/x');
eq('displayUrl 非法 URL 兜底返回占位符', T.displayUrl('not a url'), '(invalid)');
eq('displayUrl 仅 host 凭据', T.displayUrl('https://a:b@host/'), 'https://host/');

/* ---------- 3. scopeOK：授权范围校验（含越界/边界） ---------- */
ok('scopeOK 127.0.0.1 在授权范围', T.scopeOK('http://127.0.0.1/lab/sqli_01.php') === true);
ok('scopeOK .lab 后缀', T.scopeOK('https://foo.lab/y') === true);
ok('scopeOK lab-xxx 主机', T.scopeOK('https://lab-abc/x') === true);
ok('scopeOK SCOPE 列表成员', T.scopeOK('https://lab-target-01/x') === true);
ok('scopeOK 外部域名越界', T.scopeOK('https://example.com') === false);
ok('scopeOK 非 http 协议拒绝', T.scopeOK('ftp://x') === false);
ok('scopeOK 非法 URL 兜底 false', T.scopeOK('garbage') === false);

/* ---------- 4. URL 格式校验正则（取自源码 console.html:1005） ---------- */
const URL_RE = /^https?:\/\/[^\s]+$/i;
ok('URL_RE http 合法', URL_RE.test('http://127.0.0.1/lab/x') === true);
ok('URL_RE https 合法', URL_RE.test('https://example.com') === true);
ok('URL_RE ftp 拒绝', URL_RE.test('ftp://x') === false);
ok('URL_RE 纯文本拒绝', URL_RE.test('not url') === false);
ok('URL_RE 伪协议拒绝', URL_RE.test('javascript:alert(1)') === false);

/* ---------- 5. SCRIPTS 三剧本结构 ---------- */
eq('CONVERGE_3 轮数', T.SCRIPTS.CONVERGE_3.rounds.length, 3);
eq('CONVERGE_3 终止原因', T.SCRIPTS.CONVERGE_3.terminate_reason, 'HIT');
ok('CONVERGE_3 第3轮命中', T.SCRIPTS.CONVERGE_3.rounds[2].hit === true);
eq('NO_CONVERGE 轮数=MAX_ROUNDS', T.SCRIPTS.NO_CONVERGE.rounds.length, T.CONFIG.MAX_ROUNDS);
eq('NO_CONVERGE 终止原因', T.SCRIPTS.NO_CONVERGE.terminate_reason, 'MAX_ROUNDS');
eq('DEGRADED 轮数', T.SCRIPTS.DEGRADED.rounds.length, 4);
eq('DEGRADED degradeFrom', T.SCRIPTS.DEGRADED.degradeFrom, 2);
ok('DEGRADED 第4轮命中', T.SCRIPTS.DEGRADED.rounds[3].hit === true);
ok('DEGRADED 无越界 hit', T.SCRIPTS.DEGRADED.rounds[0].hit !== true && T.SCRIPTS.DEGRADED.rounds[1].hit !== true);

/* ---------- 6. paintBars：指标比例计算 + 钳制（含除零边界） ---------- */
T.paintBars({ sent:10, blocked:20, hit:5, rate:100, deg:25 });
eq('barSent 10/8*100 钳至100', docMock.querySelector('#barSent').style.width, '100%');
eq('barBlocked 20/10*100 钳至100', docMock.querySelector('#barBlocked').style.width, '100%');
eq('barHit 5/10*100=50', docMock.querySelector('#barHit').style.width, '50%');
eq('barRate=100', docMock.querySelector('#barRate').style.width, '100%');
eq('barDeg=25', docMock.querySelector('#barDeg').style.width, '25%');
T.paintBars({ sent:0, blocked:5 }); // 除零边界
eq('barBlocked sent=0 不除零 → 0%', docMock.querySelector('#barBlocked').style.width, '0%');
let markHotCalls = []; const omark = T.markHot;
T.markHot = (s,on)=>{ markHotCalls.push(s+':'+on); return omark(s,on); };
T.paintBars({ sent:3, blocked:1, hit:1, deg:1 });
ok('markHot blocked/hit/deg>0 → is-hot',
  docMock.querySelector('#dBlocked').classList.contains('is-hot') &&
  docMock.querySelector('#dHit').classList.contains('is-hot') &&
  docMock.querySelector('#dDeg').classList.contains('is-hot'));

/* ---------- 7. paintRail：进度计算 + 刻度状态（含边界） ---------- */
railEls = docMock.querySelectorAll('#rail i');
T.paintRail(3, [3]);
eq('railText 进度 3/8=38%', docMock.querySelector('#railText').textContent, '轮次进度 38%');
ok('rail r1-3 on', railEls[0].classList.contains('on') && railEls[1].classList.contains('on') && railEls[2].classList.contains('on'));
ok('rail r4 为当前(cur) 且非 on', railEls[3].classList.contains('cur') && !railEls[3].classList.contains('on'));
ok('rail r3 标记降级(deg)', railEls[2].classList.contains('deg'));
ok('rail r5-8 未点亮', !railEls[4].classList.contains('on') && !railEls[7].classList.contains('on'));
T.paintRail(8, []);
eq('railText 满轮 100%', docMock.querySelector('#railText').textContent, '轮次进度 100%');
ok('rail 满轮无 cur', !railEls[7].classList.contains('cur'));
T.paintRail(0, []);
eq('railText 0轮 0%', docMock.querySelector('#railText').textContent, '轮次进度 0%');

/* ---------- 8. MockEngine.analyze：端到端（三剧本 + 越界 + 取消） ---------- */
const mkOpts = (cancel) => ({ vulnType:'sqli', authorizationId:'AUTH-LAB-DEMO-001', isCancelled: cancel || (()=>false) });
const IN_SCOPE = 'https://lab-target-01.lab/x';
const OUT_SCOPE = 'https://example.com';

(async () => {
  // CONVERGE_3
  T.RUNTIME.script = 'CONVERGE_3';
  let ev = [];
  let rep = await T.MockEngine.analyze(IN_SCOPE, mkOpts(), e=>ev.push(e));
  eq('CONVERGE_3 轮数', rep.rounds.length, 3);
  eq('CONVERGE_3 终止原因', rep.terminate_reason, 'HIT');
  ok('CONVERGE_3 末轮命中', rep.rounds[2].hit_signal === true);
  eq('CONVERGE_3 findings=1', rep.findings.length, 1);
  eq('CONVERGE_3 finding 风险级', rep.findings[0].risk_level, 'HIGH');
  eq('CONVERGE_3 finding verdict', rep.findings[0].verdict, 'VULNERABLE');
  eq('CONVERGE_3 target_url 透传', rep.task.target_url, IN_SCOPE);
  ok('CONVERGE_3 mock_flag=true', rep.mock_flag === true);
  ok('CONVERGE_3 事件含 started/terminated', ev.some(e=>e.event==='task.started') && ev.some(e=>e.event==='task.terminated'));

  // NO_CONVERGE
  T.RUNTIME.script = 'NO_CONVERGE';
  rep = await T.MockEngine.analyze(IN_SCOPE, mkOpts(), ()=>{});
  eq('NO_CONVERGE 轮数=8', rep.rounds.length, 8);
  eq('NO_CONVERGE 终止原因 MAX_ROUNDS', rep.terminate_reason, 'MAX_ROUNDS');
  eq('NO_CONVERGE 无 findings', rep.findings.length, 0);

  // DEGRADED
  T.RUNTIME.script = 'DEGRADED';
  rep = await T.MockEngine.analyze(IN_SCOPE, mkOpts(), ()=>{});
  eq('DEGRADED 轮数=4', rep.rounds.length, 4);
  eq('DEGRADED 降级轮 [2,3,4]', rep.degraded_rounds, [2,3,4]);
  ok('DEGRADED 末轮命中', rep.rounds[3].hit_signal === true);

  // 越界（out_of_scope）
  T.RUNTIME.script = 'CONVERGE_3';
  rep = await T.MockEngine.analyze(OUT_SCOPE, mkOpts(), ()=>{});
  ok('越界 out_of_scope=true', rep.task.out_of_scope === true);
  eq('越界 授权 ID 占位', rep.task.authorization_id, '—（越界演示，无授权）');
  eq('越界 target_url 透传(URL 规范化补尾斜杠)', rep.task.target_url, OUT_SCOPE + '/');

  // 取消（异常路径）
  let threw = false, caught = '';
  try { await T.MockEngine.analyze(IN_SCOPE, mkOpts(()=>true), ()=>{}); }
  catch (e) { threw = true; caught = e.message; }
  ok('取消时抛 用户取消', threw && caught === '用户取消', 'caught=' + caught);

  /* ---------- 9. 状态机契约：resolveTerminalState / setDashState / applyTerminalState / onEvent ----------
     测试先行：__T 以 typeof 安全导出，实现前为 null（本组 FAIL、上方基线仍 PASS），实现后为标准引用。 */
  const dash = () => docMock.querySelector('#dash');
  const dashState = () => docMock.querySelector('#dashState');
  const rpt = (reason, deg, oos) => ({
    terminate_reason: reason,
    degraded_rounds: deg || [],
    task: { out_of_scope: !!oos }
  });

  ok('状态机 resolveTerminalState 已导出', typeof T.resolveTerminalState === 'function');
  ok('状态机 applyTerminalState 已导出', typeof T.applyTerminalState === 'function');
  if (typeof T.resolveTerminalState === 'function') {
    eq('状态机 HIT 无降级 → hit', T.resolveTerminalState(rpt('HIT', [])), {state:'hit', label:'HIT'});
    eq('状态机 MAX_ROUNDS → nofind', T.resolveTerminalState(rpt('MAX_ROUNDS', [])), {state:'nofind', label:'NOT FOUND'});
    eq('状态机 HIT+降级 → degraded', T.resolveTerminalState(rpt('HIT', [2,3,4])), {state:'degraded', label:'DEGRADED'});
    eq('状态机 越界优先(oos+HIT+降级) → oos', T.resolveTerminalState(rpt('HIT', [2,3], true)), {state:'oos', label:'SIMULATED'});
    eq('状态机 越界优先(oos+MAX_ROUNDS) → oos', T.resolveTerminalState(rpt('MAX_ROUNDS', [], true)), {state:'oos', label:'SIMULATED'});
    eq('状态机 MAX_ROUNDS 优先于降级 → nofind', T.resolveTerminalState(rpt('MAX_ROUNDS', [1,2])), {state:'nofind', label:'NOT FOUND'});
    eq('状态机 未知原因兜底 → error', T.resolveTerminalState(rpt(undefined, [])), {state:'error', label:'ERROR'});
  }
  if (typeof T.setDashState === 'function') {
    T.setDashState('hit','HIT');
    eq('状态机 setDashState 写 #dash.dataset.state', dash().dataset.state, 'hit');
    eq('状态机 setDashState 写 #dashState 文案', dashState().textContent, 'HIT');
    T.setDashState('idle','IDLE');
  }
  if (typeof T.applyTerminalState === 'function') {
    const st = T.applyTerminalState(rpt('HIT', [2,3]));
    eq('状态机 applyTerminalState 返回 degraded', st, 'degraded');
    eq('状态机 applyTerminalState 落 dataset.state', dash().dataset.state, 'degraded');
    ok('状态机 applyTerminalState 切 runState 为 RUN COMPLETE',
      docMock.querySelector('#runState').innerHTML.includes('RUN COMPLETE'));
  }
  if (typeof T.onEvent === 'function' && T.ReportStore) {
    T.ReportStore.draft = rpt('HIT', []);
    T.onEvent({event:'task.terminated', round_no:3, terminate_reason:'HIT'});
    eq('状态机 onEvent task.terminated(HIT) → hit', dash().dataset.state, 'hit');
    T.ReportStore.draft = rpt('MAX_ROUNDS', []);
    T.onEvent({event:'task.terminated', round_no:8, terminate_reason:'MAX_ROUNDS'});
    eq('状态机 onEvent task.terminated(MAX_ROUNDS) → nofind', dash().dataset.state, 'nofind');
    T.ReportStore.draft = rpt('HIT', [2,3,4]);
    T.onEvent({event:'task.terminated', round_no:4, terminate_reason:'HIT'});
    eq('状态机 onEvent task.terminated(降级) → degraded', dash().dataset.state, 'degraded');
    T.ReportStore.draft = rpt('HIT', [], true);
    T.onEvent({event:'task.terminated', round_no:3, terminate_reason:'HIT'});
    eq('状态机 onEvent task.terminated(越界) → oos（最高优先级）', dash().dataset.state, 'oos');
  }
  if (typeof T.resolveTerminalState === 'function') {
    T.RUNTIME.script='CONVERGE_3';
    const r3=await T.MockEngine.analyze(IN_SCOPE, mkOpts(), ()=>{});
    eq('状态机 端到端 CONVERGE_3 → hit', T.resolveTerminalState(r3).state, 'hit');
    T.RUNTIME.script='NO_CONVERGE';
    const rn=await T.MockEngine.analyze(IN_SCOPE, mkOpts(), ()=>{});
    eq('状态机 端到端 NO_CONVERGE → nofind', T.resolveTerminalState(rn).state, 'nofind');
    T.RUNTIME.script='DEGRADED';
    const rd=await T.MockEngine.analyze(IN_SCOPE, mkOpts(), ()=>{});
    eq('状态机 端到端 DEGRADED → degraded', T.resolveTerminalState(rd).state, 'degraded');
    const ro=await T.MockEngine.analyze(OUT_SCOPE, mkOpts(), ()=>{});
    eq('状态机 端到端 越界 CONVERGE_3 → oos', T.resolveTerminalState(ro).state, 'oos');
  }
  if (typeof T.start === 'function' && typeof T.cancelRun === 'function') {
    docMock.querySelector('#urlInput').value='http://127.0.0.1/lab/x';
    docMock.querySelector('#authChk').checked=true;
    T.AnalysisEngine.analyze=()=>{ T.cancelRun(); return Promise.reject(new Error('桩异常-取消')); };
    await T.start();
    eq('状态机 取消路径 catch 不写 error（保持 cancel）', dash().dataset.state, 'cancel');
    T.AnalysisEngine.analyze=()=>Promise.reject(new Error('引擎异常'));
    await T.start();
    eq('状态机 引擎异常 → error', dash().dataset.state, 'error');
    ok('状态机 引擎异常 runState 切 RUN COMPLETE · ERROR',
      docMock.querySelector('#runState').innerHTML.includes('RUN COMPLETE') &&
      docMock.querySelector('#runState').innerHTML.includes('ERROR'));
  }

  /* ---------- core.js：跨页过渡遮罩（.pt）与 bfcache 复位 ----------
     回归用例：从功能页「后退」回主页时，浏览器会从 bfcache 原样还原离开前的
     .pt.show（整屏不透明 + pointer-events:all），而脚本不会重跑 —— 页面会永久卡住。
     core.js 必须在 pageshow(persisted) 时强制复位。 */
  const CORE = fs.readFileSync('D:/AIBBBG/Version1/webapp/js/core.js', 'utf8');

  function mkList(init) {
    const s = new Set(init || []);
    return {
      _set: s,
      add: (...cs) => cs.forEach((c) => s.add(c)),
      remove: (...cs) => cs.forEach((c) => s.delete(c)),
      contains: (c) => s.has(c),
      has: (c) => s.has(c),
      toggle: (c, f) => { if (f === undefined) { s.has(c) ? s.delete(c) : s.add(c); } else { f ? s.add(c) : s.delete(c); } }
    };
  }

  function loadCore(opts) {
    const o = opts || {};
    const store = Object.assign({}, o.store || {});
    const html = { classList: mkList(o.htmlClasses) };
    const pt = { classList: mkList(o.ptClasses) };
    const navLinks = o.anchors || [];
    const handlers = {};
    const loc = { href: 'index.html' };
    const sandboxCore = {
      console,
      document: {
        documentElement: html,
        getElementById: (id) => (id === 'pt' ? pt : null),
        querySelectorAll: (sel) => (sel === 'a[data-nav]' ? navLinks : [])
      },
      window: { matchMedia: () => ({ matches: !!o.reduced }) },
      matchMedia: () => ({ matches: !!o.reduced }),
      addEventListener: (t, fn) => { (handlers[t] = handlers[t] || []).push(fn); },
      sessionStorage: {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; }
      },
      location: loc,
      setTimeout: (fn) => { try { fn(); } catch (e) {} return 0; },
      requestAnimationFrame: (fn) => { try { fn(); } catch (e) {} return 0; },
      Math, JSON, Object, Array, String, Number, Boolean, Error, Set
    };
    vm.createContext(sandboxCore);
    vm.runInContext(CORE, sandboxCore);
    return { html, pt, store, navLinks, handlers, location: loc };
  }

  /* 1) 目标页首帧覆盖态 → 应完成揭开并清掉导航标记 */
  {
    const c = loadCore({ htmlClasses: ['pt-cover'], store: { 'pt-nav': '1' } });
    ok('core 首帧覆盖态已揭开(html.pt-cover 移除)', c.html.classList.contains('pt-cover') === false);
    ok('core 揭开后遮罩不留 leave 类', c.pt.classList.contains('leave') === false);
    ok('core 揭开后清空 pt-nav 标记', c.store['pt-nav'] === undefined);
  }

  /* 2) bfcache 恢复（本次修复核心）：残留 .show 必须被清掉 */
  {
    const c = loadCore({ ptClasses: ['pt', 'show'] });
    ok('core bfcache 恢复前仍带 .show（复现前提）', c.pt.classList.contains('show') === true);
    (c.handlers['pageshow'] || []).forEach((fn) => fn({ persisted: true }));
    ok('core bfcache 恢复后清除 .show（修复后不再卡遮罩）', c.pt.classList.contains('show') === false);
    ok('core bfcache 恢复后 html 无 pt-cover', c.html.classList.contains('pt-cover') === false);
  }

  /* 3) 普通加载的 pageshow(persisted=false) 不得误清遮罩 */
  {
    const c = loadCore({ htmlClasses: ['pt-cover'] });
    c.html.classList.add('pt-cover');
    (c.handlers['pageshow'] || []).forEach((fn) => fn({ persisted: false }));
    ok('core 普通 pageshow 不误触发复位', c.html.classList.contains('pt-cover') === true);
  }

  /* 4) 点击 data-nav 链接 → 阻止默认跳转、加 .show、写入 pt-nav */
  {
    let click = null, prevented = false;
    const anchor = {
      getAttribute: () => 'console.html',
      addEventListener: (t, fn) => { if (t === 'click') click = fn; }
    };
    const c = loadCore({ anchors: [anchor] });
    ok('core 已绑定 data-nav 点击拦截', typeof click === 'function');
    if (typeof click === 'function') click({ preventDefault: () => { prevented = true; } });
    ok('core data-nav 点击阻止默认跳转', prevented === true);
    ok('core 跳转前遮罩进入展开态', c.pt.classList.contains('show') === true);
    ok('core 跳转前写入 pt-nav 标记', c.store['pt-nav'] === '1');
    ok('core 跳转目标写入 location', c.location.href === 'console.html');
  }

  /* ---------- 打印结构报告 ---------- */
  console.log('\n================ 结构化测试报告 ================');
  console.log('项目: AIBBBG Version1 · webapp/js/console.js 核心逻辑（外部化后）');
  console.log('测试方式: vm 沙箱加载真实源码 + DOM mock 驱动');
  console.log('--------------------------------------------------');
  for (const [st, name, detail] of cases) {
    console.log(`[${st}] ${name}${detail? '  | ' + detail : ''}`);
  }
  console.log('--------------------------------------------------');
  console.log(`合计: ${cases.length}  通过: ${pass}  失败: ${fail}`);
  console.log('==================================================');
  process.exit(fail ? 1 : 0);
})();
