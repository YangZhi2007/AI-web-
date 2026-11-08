/* AIBBBG Version1 · 真实代码测试运行器
 * 方式：用 vm 沙箱加载 webapp/js/console.js（外部化后的核心逻辑，真实源码，非复制），
 *       以 DOM mock 驱动，提取真实函数执行断言。 */
const fs = require('fs');
const vm = require('vm');
const { URL, URLSearchParams } = require('url');

const HTML = fs.readFileSync('D:/AIBBBG/Version1/webapp/js/console.js', 'utf8');

/* 直接加载外部化后的核心逻辑脚本（原内联 <script> 已拆分为 js/console.js） */
const code = HTML;

const exported = code + "\n;globalThis.__T={esc,displayUrl,scopeOK,SCRIPTS,CONFIG,RUNTIME,paintBars,paintRail,setMeter,markHot,MockEngine,AnalysisEngine};";

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
    textContent: '', value: '', checked: true, children: [],
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
