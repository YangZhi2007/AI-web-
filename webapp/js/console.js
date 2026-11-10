
/* ================= 配置区：切换真引擎只需改这里 ================= */
const CONFIG = Object.freeze({
  ENGINE_MODE : 'mock',                  // 'mock' | 'http'
  API_BASE_URL: 'http://127.0.0.1:8000/api/v1', // 占位常量 · 本演示不发起任何请求，仅切 http 模式时由 HttpEngine 使用
  TICK_SPEED  : 'demo',                  // 'fast' | 'demo' | 'slow'
  MAX_ROUNDS  : 8
});
/* 暴露只读引用，供 webapp/js/api.js 通过 window.CONFIG.API_BASE_URL 复用同一基准地址（Object.freeze 不影响外部读取） */
window.CONFIG = CONFIG;
/* 运行期剧本选择：由 UI 下拉与 ?script= 参数写入，不纳入冻结常量 */
const RUNTIME = { script: 'CONVERGE_3' };
/* 接口契约（端点 / 逐轮字段 / SSE 事件类型 / 诚信约束）见 webapp/js/api.js —— 前端交互层 → 业务调度&存储层 */
const RM = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const TICKS = {fast:160, demo:820, slow:2400};
const SCOPE = ['localhost','127.0.0.1','::1','[::1]','lab','lab.local','lab-target-01'];
const OOS_NOTICE = '目标超出授权范围 · 本次为纯模拟演示 · 未向该地址发起任何请求 · 不对应任何真实站点';
const sleep = (ms,cancel) => new Promise((resolve,reject)=>{
  let left=ms;
  const step=()=>{
    if(cancel&&cancel()){reject(new Error('用户取消'));return;}
    if(left<=0){resolve();return;}
    const d=Math.min(120,left);left-=d;setTimeout(step,d);
  };
  step();
});
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad = n => String(n).padStart(2,'0');
const nowISO = () => new Date().toISOString();
const fmt = iso => String(iso).replace('T',' ').slice(0,19);
const genId = () => { const r = (globalThis.crypto && globalThis.crypto.randomUUID) ? globalThis.crypto.randomUUID().replace(/-/g,'').slice(0,8) : Math.random().toString(36).slice(2,8); return 'DEMO-' + r.toUpperCase(); };
const scopeOK = url => { try{const u=new URL(url),h=u.hostname.toLowerCase().replace(/^\[|\]$/g,'');
  return (u.protocol==='http:'||u.protocol==='https:') &&
    (SCOPE.includes(h)||h.endsWith('.lab')||/^lab-[a-z0-9-]+$/.test(h));}catch{return false;} };
const aliasOf = url => scopeOK(url) ? 'lab-target-01' : 'lab-target-demo（纯模拟，不对应任何真实目标）';
const displayUrl = url => { try{const u=new URL(url);u.username='';u.password='';
  return u.toString();}catch{return '(invalid)';} };
const paramRefOf = (url,type) => {
  const inScope=scopeOK(url);let p='/lab/target.php';
  if(inScope){try{p=new URL(url).pathname||p;}catch{}}
  const key=({sqli:'id',xss:'q',upload:'file'})[type]||'id';
  return `POST ${p}#${key}（${inScope?'靶场抽象点位':'纯模拟抽象点位'}）`;
};
/* ---------- 三套剧本：只含算子编号，不含任何载荷文本 ---------- */
const SCRIPTS = {
  CONVERGE_3:{terminate_reason:'HIT', rounds:[
    {cls:'BLOCKED',sig:'RULE_KEYWORD_A',tag:'OP_BASE',      op:['OP_BASE'],                 cost:1180},
    {cls:'BLOCKED',sig:'RULE_KEYWORD_B',tag:'OP_ENC_SEQ_1', op:['OP_ENC_SEQ_1'],           cost:1420},
    {cls:'ANOMALY',sig:'',             tag:'OP_ENC_SEQ_2', op:['OP_ENC_SEQ_2','OP_SPLIT'],cost:1650,hit:true}
  ]},
  NO_CONVERGE:{terminate_reason:'MAX_ROUNDS', rounds:Array.from({length:CONFIG.MAX_ROUNDS},(_,i)=>({
    cls:'BLOCKED',sig:'RULE_KEYWORD_'+String.fromCharCode(65+i%4),
    tag:'OP_SEQ_'+pad(i+1),op:['OP_SEQ_'+pad(i+1)],cost:900+i*110
  }))},
  DEGRADED:{terminate_reason:'HIT',degradeFrom:2, rounds:[
    {cls:'BLOCKED',sig:'RULE_KEYWORD_A',tag:'OP_BASE',       op:['OP_BASE'],       cost:1100},
    {cls:'BLOCKED',sig:'RULE_KEYWORD_B',tag:'OP_FALLBACK_1', op:['OP_FALLBACK_1'], cost:980},
    {cls:'BLOCKED',sig:'RULE_KEYWORD_C',tag:'OP_FALLBACK_2', op:['OP_FALLBACK_2'], cost:1020},
    {cls:'ANOMALY',sig:'',             tag:'OP_FALLBACK_3', op:['OP_FALLBACK_3'], cost:1240,hit:true}
  ]}
};
const ReportStore = {draft:null};
const takeDetail = no => ReportStore.draft
  ? ReportStore.draft.rounds.find(r => r.round_no === no) || null : null;
const maxRounds = () => ReportStore.draft?.task.max_rounds || CONFIG.MAX_ROUNDS;
function modelRaw(no,prevId,prevSig,s,degraded){
  return JSON.stringify({adapter:'MOCK',round_no:no,prev_round_id:prevId,
    observed:no===1?'无上轮响应（首轮）':`上轮响应分类 BLOCKED，拦截特征 ${prevSig}`,
    decision:`在算子白名单内选择 ${s.tag}`,
    reason:no===1?'建立响应基线':'依据本轮反馈调整算子序列，避开已失败策略',
    validation:'PASSED',degraded_flag:degraded,mock_flag:true},null,2);
}
function aiSummary(no,prevSig,s){
  return no===1 ? `首轮建立响应基线，采用 ${s.tag}`
                : `依据第 ${no-1} 轮：拦截特征 ${prevSig||'无'}，调整策略为 ${s.tag}`;
}
/* ---------- 引擎实现（语义与统一版一致） ---------- */
const MockEngine = {
  async analyze(url,options,onEvent){
    const scriptName = SCRIPTS[RUNTIME.script] ? RUNTIME.script : 'CONVERGE_3';
    const sc = SCRIPTS[scriptName];
    const scriptRounds = sc.rounds.slice(0,CONFIG.MAX_ROUNDS);
    const tick = TICKS[CONFIG.TICK_SPEED] || TICKS.demo;
    const taskId = genId();
    const outOfScope = !scopeOK(url);
    const report = {
      contract_version:'1.0',mock_flag:true,demo:true,
      task:{task_id:taskId,target_url:displayUrl(url),
        target_alias:outOfScope?'lab-target-demo（纯模拟，不对应任何真实目标）':aliasOf(url),
        authorization_id:outOfScope?'—（越界演示，无授权）':options.authorizationId,
        out_of_scope:outOfScope,script_tag:scriptName,vuln_type:options.vulnType,
        group_tag:'A',adapter_name:'MOCK',max_rounds:CONFIG.MAX_ROUNDS,
        ruleset_version:'LAB-RULESET-01',
        ai_mode:'ADAPTIVE',started_at:nowISO()},
      rounds:[],findings:[],degraded_rounds:[],terminate_reason:null,elapsed_ms:0
    };
    ReportStore.draft = report;
    const emit = (event,no,extra={}) => onEvent({
      task_id:taskId,round_no:no,event,timestamp:nowISO(),mock_flag:true,...extra});
    emit('task.started',0);
    let prevSig = '';
    for(const [i,s] of scriptRounds.entries()){
      if(options.isCancelled?.()) throw new Error('用户取消');
      const no=i+1, prev=i===0?null:report.rounds[i-1].round_id;
      const degraded=!!(sc.degradeFrom && no>=sc.degradeFrom);
      const rec={
        round_id:`${taskId}-R${pad(no)}`,round_no:no,prev_round_id:prev,
        param_ref:paramRefOf(url,options.vulnType),strategy_tag:s.tag,operator_chain:s.op,
        response_class:s.cls,http_status:s.cls==='BLOCKED'?403:200,
        waf_signal:s.sig||'无',hit_signal:!!s.hit,
        verdict:s.hit?'VULNERABLE':(s.cls==='BLOCKED'?'NOT_FOUND':'NEEDS_REVIEW'),
        confidence:s.hit?0.91:0.12,verdict_source:s.hit?'FUSION':'RULE',
        degraded_flag:degraded,fallback_used:degraded,adapter_name:'MOCK',
        validation_result:'PASSED',cost_ms:s.cost,mock_flag:true,
        ai_summary:aiSummary(no,prevSig,s),
        model_decision_raw:modelRaw(no,prev,prevSig,s,degraded)
      };
      report.rounds.push(rec);
      if(degraded) report.degraded_rounds.push(no);
      emit('round.started',no);
      await sleep(tick*0.55,options.isCancelled);
      emit('payload.generated',no,{strategy_tag:s.tag});
      await sleep(tick*0.30,options.isCancelled);
      emit('request.sent',no);
      await sleep(tick*0.70,options.isCancelled);
      if(degraded) emit('degraded',no,{degraded_flag:true});
      emit(s.cls==='BLOCKED'?'waf.blocked':'verdict.ready',no,
           {response_class:s.cls,degraded_flag:degraded});
      await sleep(tick*0.30,options.isCancelled);
      prevSig=s.sig||'无';
    }
    const hasHit=report.rounds.some(r=>r.hit_signal);
    report.terminate_reason=hasHit?'HIT':(scriptRounds.length>=CONFIG.MAX_ROUNDS?'MAX_ROUNDS':sc.terminate_reason);
    report.elapsed_ms=report.rounds.reduce((a,r)=>a+r.cost_ms,0);
    const hit=report.rounds.find(r=>r.hit_signal);
    if(hit) report.findings.push({finding_id:taskId+'-F01',vuln_type:options.vulnType,
      param_ref:hit.param_ref,risk_level:'HIGH',verdict:'VULNERABLE',
      verdict_source:hit.verdict_source,confidence:hit.confidence,
      evidence_round_ids:report.rounds.map(r=>r.round_id),mock_flag:true});
    emit('task.terminated',report.rounds.length,{terminate_reason:report.terminate_reason});
    return report;
  }
};
const HttpEngine = {
  analyze(){
    // 接真实后端时改为：const report = await ApiClient.submitTask(url, options); 并改用 ApiClient.subscribeTaskEvents 推进 onEvent
    return Promise.reject(new Error(
      '真引擎未接入：请在 HttpEngine.analyze 中按 webapp/js/api.js 的接口契约对接本地后端；本演示不发起任何外部请求。'));}
};
const AnalysisEngine = {
  analyze:(url,options,onEvent) => CONFIG.ENGINE_MODE==='http'
    ? HttpEngine.analyze(url,options,onEvent) : MockEngine.analyze(url,options,onEvent)
};
/* ---------- app 界面层：ScrambleText / pulse / ActionBtn / enter-exit ---------- */
const CHARS='ABCDEFGHJKLMNPQRSTUVWXYZ0123456789-_/=+*#';
function scramble(el,text,ms=420){
  if(!el)return;
  const token=(el._scrambleToken||0)+1;el._scrambleToken=token;  // 新调用接管，旧循环退出
  if(RM||CONFIG.TICK_SPEED==='fast'){el.textContent=text;return;}  // 关闭动效或 fast 档直接定稿，避免逐帧抖动
  const start=Date.now(), len=String(text).length, target=String(text);
  const frame=()=>{
    if(el._scrambleToken!==token)return;
    const p=Math.min(1,(Date.now()-start)/ms), locked=Math.floor(p*len);
    let out='';
    for(let i=0;i<len;i++){
      out += (i<locked || target[i]===' ' || target[i]==='_')
        ? target[i] : CHARS[Math.floor(Math.random()*CHARS.length)];
    }
    el.textContent=out;
    if(p<1)requestAnimationFrame(frame);else el.textContent=target;
  };
  requestAnimationFrame(frame);
}
function pulse(el,text){
  if(!el)return;
  if(text!==undefined)scramble(el,text);
  if(RM)return;
  el.classList.remove('pulse');void el.offsetWidth;el.classList.add('pulse');
}
function switchTab(name){
  const target=$(name==='history'?'#tabHistory':'#tabNew');
  const other=$(name==='history'?'#tabNew':'#tabHistory');
  $$('.action-btn').forEach(b=>{
    const on=b.dataset.tab===name;
    b.classList.toggle('isActive',on);b.setAttribute('aria-selected',String(on));
    b.setAttribute('tabindex',on?'0':'-1');
  });
  if(RM){other.classList.add('hidden');target.classList.remove('hidden');return;}
  other.classList.remove('enter');other.classList.add('exit');
  setTimeout(()=>{
    other.classList.add('hidden');
    target.classList.remove('hidden','exit');target.classList.add('enter');
  },180);
}
/* ---------- 界面状态 ---------- */
let running=false, waitTimer=null, waitSec=0, runToken=0, taskCount=0, statBlocked=0;
const taskHistory=[];
const TYPE_NAME={sqli:'SQL 注入',xss:'XSS',upload:'文件上传'};
function setMsg(text,kind=''){const m=$('#msg');m.textContent=text;m.className=kind;}
function setThinking(on){
  $('#thinking').classList.toggle('hidden',!on);
  clearInterval(waitTimer);waitTimer=null;
  if(on){waitSec=0;$('#waitText').textContent='已等待 0s · 系统运行中';
    waitTimer=setInterval(()=>{waitSec++;$('#waitText').textContent=`已等待 ${waitSec}s · 系统运行中`;},1000);}
}
function setProgress(p){
  const v=Math.min(100,Math.max(0,p));
  $('#progressBar').style.width=v+'%';
  $('#gradientBar').setAttribute('aria-valuenow',String(Math.round(v)));
}
function log(text,kind=''){
  const d=document.createElement('div');
  d.className='line '+kind;
  d.textContent=`[${new Date().toLocaleTimeString('zh-CN',{hour12:false})}] ${text}`;
  $('#terminal').appendChild(d);$('#terminal').scrollTop=$('#terminal').scrollHeight;
}
function syncStart(){
  $('#startBtn').disabled=running||!$('#authChk').checked;
  $('#authHint').textContent=$('#authChk').checked
    ? '授权已确认 · 本页不会向该地址发起任何真实请求。'
    : '请先勾选授权确认，否则无法开始分析。';
}
function setStat(id,text){pulse($(id),String(text));}
/* ---------- 仪表台：状态灯 / 刻度轨 / 比例条 ----------
   刻度轨是"轮次=证据链主轴"的可视化：一格一轮，降级轮以黄标出，当前轮做扫描高亮。
   比例条给的是相对量（已拦截/已投递 等），避免一排裸数字看不出严重程度。 */
const dashDeg=new Set();
function setDashState(state,label){
  const d=$('#dash');if(!d)return;
  d.dataset.state=state;
  const t=$('#dashState');if(t)t.textContent=label;
}
/* 终态判定：唯一语义入口，onEvent 与 start() 收尾共用，避免两处漂移。
   判定优先级：out_of_scope → MAX_ROUNDS → HIT+降级轮 → HIT → 兜底 error。
   入参 report 可为 ReportStore.draft（事件期字段已填充）或 analyze 返回值。 */
function resolveTerminalState(report){
  const reason=report&&report.terminate_reason;
  const oos=!!(report&&report.task&&report.task.out_of_scope);
  const deg=(report&&report.degraded_rounds?report.degraded_rounds.length:0)>0;
  if(oos)                   return {state:'oos',      label:'SIMULATED'};   // 诚信优先
  if(reason==='MAX_ROUNDS') return {state:'nofind',  label:'NOT FOUND'};
  if(reason==='HIT'&&deg)   return {state:'degraded',label:'DEGRADED'};
  if(reason==='HIT')        return {state:'hit',     label:'HIT'};
  return {state:'error',label:'ERROR'};                                     // 未知原因兜底
}
/* 终态落地：状态灯 + 运行面板文案一次对齐；返回 state 供调用方复算/断言。 */
function applyTerminalState(report){
  const {state,label}=resolveTerminalState(report);
  setDashState(state,label);
  setRunState(label,'DONE');
  return state;
}
function buildRail(n){
  const rail=$('#rail');if(!rail)return;
  rail.innerHTML=Array.from({length:n},(_,i)=>
    `<i data-r="${i+1}">${String(i+1).padStart(2,'0')}</i>`).join('');
}
function paintRail(done,degraded=[]){
  const max=CONFIG.MAX_ROUNDS;
  $$('#rail i').forEach(el=>{
    const r=Number(el.dataset.r);
    const lit=r<=done, deg=lit&&degraded.indexOf(r)>-1;
    el.classList.toggle('on',lit);
    el.classList.toggle('deg',deg);
    el.classList.toggle('cur',r===done+1&&done<max);
    /* 态势 SVG 与刻度轨同源同步：同一 round_no 双写点亮/降级刻痕（不触碰引擎数据） */
    const node=$('.sit__node[data-r="'+r+'"]');
    if(node){
      node.classList.toggle('is-lit',lit);
      node.classList.toggle('is-degraded',deg);
    }
  });
  const txt=$('#railText');
  if(txt)txt.textContent=`轮次进度 ${Math.round(done/max*100)}%`;
}
function setMeter(sel,pct){
  const el=$(sel);if(el)el.style.width=Math.min(100,Math.max(0,pct))+'%';
}
function markHot(sel,on){
  const el=$(sel);if(!el)return;
  const cell=el.closest('.cell');if(cell)cell.classList.toggle('is-hot',!!on);
}
function paintBars(v={}){
  const sent=v.sent||0, max=CONFIG.MAX_ROUNDS||1;
  const blocked=v.blocked||0, hit=v.hit||0, rate=v.rate||0, deg=v.deg||0;
  setMeter('#barSent',sent/max*100);
  setMeter('#barBlocked',sent?blocked/sent*100:0);
  setMeter('#barHit',sent?hit/sent*100:0);
  setMeter('#barRate',rate);
  setMeter('#barDeg',deg);
  markHot('#dBlocked',blocked>0);
  markHot('#dHit',hit>0);
  markHot('#dDeg',deg>0);
}
function setRunState(label,phase='RUN'){
  const head=phase==='RUN'?'DASHBOARD RETRIEVING INFO...':'RUN COMPLETE ·';
  $('#runState').innerHTML=`${head} <b>${esc(label)}</b>`;
}
function addRoundRow(no){
  const d=takeDetail(no)||{};
  const tr=document.createElement('tr');
  tr.dataset.round=String(no);
  tr.innerHTML=`<td>${no}</td><td class="mono">${esc(d.round_id||'')}</td>
    <td><span class="tag normal" data-f="strategy">生成中…</span></td>
    <td><span class="tag normal" data-f="cls">分析中</span></td>
    <td data-f="verdict">—</td><td data-f="cost">—</td>
    <td data-f="deg">—</td>`;
  $('#roundBody').appendChild(tr);
  $('#roundEmpty').classList.add('hidden');
  return tr;
}
function setRowField(no,name,value,cls){
  const tr=$(`#roundBody tr[data-round="${no}"]`);
  if(!tr)return;
  const el=tr.querySelector(`[data-f="${name}"]`);
  if(!el)return;
  if(value!==undefined)el.textContent=value;
  if(cls!==undefined)el.className=el.classList.contains('tag')?'tag '+cls:'';
}
function finishRoundRow(no,evt){
  const d=takeDetail(no);if(!d)return;
  const map={BLOCKED:['blocked','BLOCKED'],ANOMALY:['anomaly','ANOMALY'],
             NORMAL:['normal','NORMAL'],TIMEOUT:['deg','TIMEOUT']};
  const [cls,label]=map[d.response_class]||['normal','UNKNOWN'];
  setRowField(no,'cls',label,cls);
  setRowField(no,'verdict',`${d.verdict} · ${d.validation_result}`);
  setRowField(no,'cost',d.cost_ms+' ms');
  setRowField(no,'deg',d.degraded_flag?'DEGRADED':'—');
  if(evt.degraded_flag) setMsg('本轮模型降级，已使用兜底策略集（DEGRADED）','warn');
}
/* ---------- 事件驱动：轻事件 → 详情从报告对象取 ---------- */
function onEvent(e){
  const no=e.round_no, maxR=maxRounds();
  switch(e.event){
    case 'task.started':
      log('任务已创建 · 引擎 MockEngine（演示数据，非实时推理）','accent');
      setRunState('RUNNING');setDashState('run','RUNNING');break;
    case 'round.started':
      addRoundRow(no);setProgress(no/maxR*100);
      setStat('#dRound',no);setStat('#dSent',no);
      paintRail(no,[...dashDeg]);
      paintBars({sent:no,blocked:statBlocked});
      log(`第 ${no} 轮开始 · 轮次上限 ${maxR}`);break;
    case 'payload.generated':
      setRowField(no,'strategy',e.strategy_tag,'normal');
      log(`第 ${no} 轮 策略生成 ${e.strategy_tag}（仅算子编号，不展示载荷文本）`);break;
    case 'request.sent': log(`第 ${no} 轮 已投递探测请求（本地靶场模拟）`);break;
    case 'degraded':
      dashDeg.add(no);paintRail(no,[...dashDeg]);   // 降级轮在刻度轨上以黄标出
      log(`第 ${no} 轮 模型降级 · degraded_flag=true`,'warn');break;
    case 'waf.blocked': case 'verdict.ready':
      finishRoundRow(no,e);
      if(e.response_class==='BLOCKED'){statBlocked++;setStat('#dBlocked',statBlocked);}
      if(e.degraded_flag){dashDeg.add(no);paintRail(no,[...dashDeg]);}
      paintBars({sent:no,blocked:statBlocked});
      log(`第 ${no} 轮 响应分类 ${e.response_class}${e.degraded_flag?' · DEGRADED':''}`,
          e.response_class==='BLOCKED'?'warn':'ok');break;
    case 'task.terminated':{
      setProgress(100);setThinking(false);
      const r=ReportStore.draft;                        // 事件期字段已填充（见 MockEngine.analyze）
      applyTerminalState(r);                             // 唯一语义入口，取代硬编码 'done'
      paintRail(Math.min(no||maxR,maxR),(r&&r.degraded_rounds)||[...dashDeg]);
      log(`任务终止 · 原因 ${e.terminate_reason}`);break;
    }
  }
}
/* ---------- 结果与报告（保留越界诚信标注与空轮次守卫） ---------- */
function renderResult(r){
  const f=r.findings[0], hit=r.rounds.find(x=>x.hit_signal), oos=r.task.out_of_scope;
  $('#rType').textContent=TYPE_NAME[r.task.vuln_type]||r.task.vuln_type;
  $('#rParam').textContent=f?f.param_ref:(r.rounds[0]?r.rounds[0].param_ref:'—');
  $('#rRisk').textContent=oos?'—（纯模拟）':(f?f.risk_level:'—');
  $('#rConf').textContent=oos?'—（纯模拟）':(f?f.confidence.toFixed(2):'—');
  $('#rSource').textContent=oos?'—（纯模拟）':(f?f.verdict_source:'规则基线（未命中）');
  $('#verdictWord').textContent=oos?'模拟命中':(r.terminate_reason==='HIT'?'已检出':'未检出');
  const notice=$('#oosResult');
  notice.textContent=oos?OOS_NOTICE:'';notice.classList.toggle('hidden',!oos);
  const blocked=r.rounds.filter(x=>x.response_class==='BLOCKED').map(x=>x.round_no);
  const ev=hit
    ? `关键证据摘要：第 ${blocked.join('、')} 轮被 WAF 拦截，第 ${hit.round_no} 轮变形后${oos?'在模拟序列中命中特征':'成功检出'}；每条结论可回溯到 round_id。`
    : `关键证据摘要：全部 ${r.rounds.length} 轮均被 WAF 拦截，达到轮次上限仍未收敛，未检出漏洞（如实记录，不计为成功）。`;
  const deg=r.degraded_rounds.length
    ? ` 其中第 ${r.degraded_rounds.join('、')} 轮为降级轮次，已单列，不计入主指标统计。`
    : ' 本次无降级轮次。';
  $('#evidenceText').textContent=(oos?'【纯模拟演示，不对应任何真实目标】':'')+ev+deg;
}
function renderReport(r){
  const oos=r.task.out_of_scope, degN=r.degraded_rounds.length;
  const termText={
    HIT:degN?`命中目标特征（含 ${degN} 轮降级，降级轮次不计入主指标）`:'命中目标特征，正常终止（HIT）',
    MAX_ROUNDS:'达到轮次上限，未收敛（MAX_ROUNDS）；结论如实记为未检出，不计为成功'
  }[r.terminate_reason]||r.terminate_reason;
  const rows=r.rounds.map(x=>`<tr>
    <td>${x.round_no}</td><td class="mono">${esc(x.round_id)}</td>
    <td>${x.prev_round_id?esc(x.prev_round_id.split('-').pop()):'—'}</td>
    <td>${esc(x.strategy_tag)}</td><td>${esc(x.response_class)}</td>
    <td>${esc(x.verdict)}</td><td>${x.cost_ms} ms</td>
    <td>${x.degraded_flag?'DEGRADED':'—'}</td></tr>`).join('');
  const raw=r.rounds.map(x=>`<b class="mono" style="font-size:11px">第 ${x.round_no} 轮 · ${esc(x.round_id)}</b>
    <pre>${esc(x.model_decision_raw)}</pre>`).join('');
  $('#reportCard').innerHTML=`
    <div class="card-title">SECURITY ASSESSMENT REPORT / 探测报告</div>
    <div class="report-sec"><h3>01 封面信息</h3>
      ${oos?`<div class="oos-notice">${esc(OOS_NOTICE)}</div>`:''}
      <div class="cover">
        <div><span>任务 ID</span><b class="mono" style="font-size:11px">${esc(r.task.task_id)}</b></div>
        <div><span>目标别名</span>${esc(r.task.target_alias)}</div>
        <div><span>目标 URL</span><span class="mono" style="font-size:10px">${esc(r.task.target_url)}${oos?'（纯模拟输入 · 仅展示 · 已剥离凭据）':'（仅展示，已剥离凭据）'}</span></div>
        <div><span>生成时间</span><span class="mono" style="font-size:11px">${fmt(r.task.started_at)}</span></div>
        <div><span>授权 ID</span>${esc(r.task.authorization_id)}</div>
        <div><span>数据来源</span>MockEngine 契约桩（演示数据，非实时推理）</div>
      </div>
      <p class="hint">${oos?'纯模拟演示 · 未对应任何真实站点 · 未发起任何请求 · 未使用任何授权凭据':'仅限授权范围内使用 · 演示环境为本地隔离靶场 · 不含任何真实请求与原始凭据'}</p>
    </div>
    <div class="report-sec"><h3>02 执行摘要</h3>
      <p style="margin:0;line-height:1.8">共执行 <b>${r.rounds.length}</b> 轮，累计耗时 <b class="mono">${r.elapsed_ms} ms</b>；终止原因：<b>${termText}</b>。
      ${degN?`降级轮次：第 ${r.degraded_rounds.join('、')} 轮（degraded_flag=true，已单列，不计入主指标统计）。`:'本次无降级轮次。'}
      ${oos?'本报告为纯模拟演示，不构成对任何真实目标的安全结论。':`本报告结论仅适用于授权范围内的 ${esc(r.task.target_alias)}。`}</p>
    </div>
    <div class="report-sec"><h3>03 附录 A · 逐轮执行记录</h3>
      <div class="tbl-scroll"><table class="tbl"><thead><tr><th>轮次</th><th>round_id</th><th>依据上轮</th>
      <th>变形策略</th><th>响应分类</th><th>判定</th><th>耗时</th><th>降级</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    </div>
    <div class="report-sec"><h3>04 附录 B · 模型决策原文</h3>
      <details class="raw"><summary>展开查看逐轮模型决策原文（JSON，演示数据）</summary>${raw}</details></div>
    <div class="report-sec"><h3>05 附录 C · 配置快照</h3>
      <div class="tbl-scroll"><table class="tbl"><tbody>
        <tr><th>实验分组</th><td>${esc(r.task.group_tag)}</td><th>适配器</th><td>${esc(r.task.adapter_name)}</td></tr>
        <tr><th>轮次上限</th><td>${r.task.max_rounds}</td><th>规则集版本</th><td>${esc(r.task.ruleset_version)}</td></tr>
        <tr><th>运行模式</th><td>${esc(r.task.ai_mode)}</td><th>契约版本</th><td>${esc(r.contract_version)}</td></tr>
        <tr><th>剧本</th><td>${esc(r.task.script_tag)}</td><th>数据标记</th><td>mock_flag=true</td></tr>
      </tbody></table></div></div>
    <div class="watermark">${esc(r.task.task_id)} · ${oos?'纯模拟演示 · 不对应真实目标':'仅限授权范围内使用'} · 第 1 / 1 页</div>
    <button id="exportBtn" class="btn-grad no-print" type="button" style="margin-top:14px" data-ripple>导出 PDF（打印）</button>`;
  $('#exportBtn').onclick=()=>{
    $$('details.raw').forEach(d=>{d.open=true;});   // 打印前展开，避免 Chromium 折叠内容丢失
    window.print();
  };
}
function renderHistory(){
  $('#historyBody').innerHTML=taskHistory.map(h=>`<tr>
    <td class="mono">${esc(h.id)}</td><td class="mono">${esc(h.time)}</td><td>${esc(h.alias)}</td>
    <td class="mono">${esc(h.script)}</td><td>${h.rounds}</td><td class="mono">${esc(h.reason)}</td>
    <td>mock_flag=true</td></tr>`).join('');
  $('#historyEmpty').classList.add('hidden');$('#historyFrame').classList.remove('hidden');
}
/* ---------- 主流程 ---------- */
function resetUI(){
  $('#roundBody').innerHTML='';$('#terminal').innerHTML='';
  $('#roundEmpty').classList.remove('hidden');
  $('#resultCard').classList.add('hidden');
  $('#cancelBtn').classList.remove('hidden');
  setProgress(0);setThinking(true);setRunState('RUNNING');
  $('#dRound').textContent='0';$('#dSent').textContent='0';
  $('#dBlocked').textContent='0';$('#dHit').textContent='0';statBlocked=0;
  /* 仪表台复位：刻度轨清空、比例条归零、降级轮集合清空 */
  dashDeg.clear();
  paintRail(0);paintBars({});
  setDashState('run','RUNNING');
}
async function start(){
  if(running)return;
  if(!$('#authChk').checked){setMsg('请先勾选授权确认','err');return;}
  const url=$('#urlInput').value.trim();
  if(!/^https?:\/\/[^\s]+$/i.test(url)){setMsg('请输入以 http:// 或 https:// 开头的合法地址','err');return;}
  if(!scopeOK(url))setMsg(OOS_NOTICE,'warn');
  RUNTIME.script=SCRIPTS[$('#scriptSel').value]?$('#scriptSel').value:'CONVERGE_3';
  const token=++runToken, isCancelled=()=>token!==runToken;
  running=true;syncStart();resetUI();
  const options={vulnType:$('#typeSel').value,
    authorizationId:'AUTH-LAB-DEMO-001',isCancelled};
  try{
    const report=await AnalysisEngine.analyze(url,options,onEvent);
    renderResult(report);renderReport(report);
    $('#resultCard').classList.remove('hidden');
    if(report.task.out_of_scope)setMsg('演示完成 · 目标超出授权范围，纯模拟数据，未发起任何请求','warn');
    else setMsg('分析完成 · 报告已生成（演示数据，非实时推理）','ok');
    taskCount++;
    taskHistory.unshift({id:report.task.task_id,time:fmt(report.task.started_at),alias:report.task.target_alias,
      script:report.task.script_tag,rounds:report.rounds.length,reason:report.terminate_reason});
    renderHistory();
    pulse($('#mTasks'),String(taskCount));
    pulse($('#dTasks'),String(taskCount));
    pulse($('#mFindings'),String(report.findings.length));
    pulse($('#mRounds'),String(report.rounds.length));
    /* 仪表台收尾：刻度轨铺满、比例条按最终报告一次性对齐 */
    const hitN=report.rounds.filter(x=>x.hit_signal).length;
    const blockedN=report.rounds.filter(x=>x.response_class==='BLOCKED').length;
    const degPct=Math.round(report.degraded_rounds.length/Math.max(1,report.rounds.length)*100);
    pulse($('#dHit'),String(hitN));
    pulse($('#dDeg'),degPct+'%');
    pulse($('#dRate'),'100%');
    paintRail(report.rounds.length,report.degraded_rounds);
    paintBars({sent:report.rounds.length,blocked:blockedN,hit:hitN,rate:100,deg:degPct});
    applyTerminalState(report);                           // 与事件分支同源，杜绝"事件设新态→收尾覆盖回 done"
  }catch(err){
    /* 取消提示与日志由 cancelRun() 统一输出；旧 token 不写日志也不改态 */
    if(!isCancelled()){
      setMsg('分析未完成：'+err.message,'err');
      log(err.message,'warn');
      setRunState('ERROR','DONE');
      setDashState('error','ERROR');                      // 引擎异常不再停在 run
    }
  }finally{
    if(token===runToken){running=false;syncStart();setThinking(false);$('#cancelBtn').classList.add('hidden');}
  }
}
function cancelRun(){
  if(!running)return;
  runToken++;
  $('#cancelBtn').classList.add('hidden');
  setThinking(false);
  running=false;syncStart();setRunState('CANCELLED');
  setDashState('cancel','CANCELLED');   /* 刻度轨停在中断处，如实反映未跑完 */
  setMsg('已取消 · 任务已中断（演示数据）','warn');
  log('用户取消任务，已停止后续轮次','warn');
}
/* ---------- 绑定 ---------- */
$('#authChk').addEventListener('change',syncStart);
$('#startBtn').addEventListener('click',start);
$('#cancelBtn').addEventListener('click',cancelRun);
$('#urlInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!$('#startBtn').disabled)start();});
$$('.action-btn').forEach(b=>{
  b.addEventListener('click',()=>switchTab(b.dataset.tab));
  b.addEventListener('mouseenter',()=>b.classList.add('isHovered'));
  b.addEventListener('mouseleave',()=>b.classList.remove('isHovered'));
});
$('#soundOffBtn').addEventListener('click',()=>{
  const on=$('#soundOffBtn').getAttribute('aria-checked')!=='true';
  $('#soundOffBtn').setAttribute('aria-checked',String(on));
  $('#soundOffBtn').textContent=on?'SOUND ON':'SOUND OFF';
});
/* 导航当前项 */
if('IntersectionObserver' in window){
  const io=new IntersectionObserver(es=>es.forEach(e=>{
    if(!e.isIntersecting)return;
    $$('.num-nav a').forEach(a=>a.classList.toggle('is-current',a.getAttribute('href')==='#'+e.target.id));
  }),{rootMargin:'-25% 0px -65% 0px'});
  ['probe','tasks','evidence','report','settings'].forEach(id=>{const el=$('#'+id);if(el)io.observe(el);});
}
/* 答辩现场可用 ?script=NO_CONVERGE|DEGRADED|CONVERGE_3 直接切剧本 */
const qs=new URLSearchParams(location.search).get('script');
if(qs&&SCRIPTS[qs])RUNTIME.script=qs;
$('#scriptSel').value=RUNTIME.script;
$('#dMax').textContent=String(CONFIG.MAX_ROUNDS);
$('#dMaxNum').textContent=String(CONFIG.MAX_ROUNDS);
$('#cfgMax').textContent=String(CONFIG.MAX_ROUNDS);
/* 仪表台初始化：刻度轨按配置常量生成，初始为空态 */
buildRail(CONFIG.MAX_ROUNDS);
paintRail(0);paintBars({});
setDashState('idle','IDLE');
/* 关键数字 ScrambleText 入场 */
['#mTasks','#mFindings','#mRounds'].forEach(s=>scramble($(s),'0',360));
syncStart();
