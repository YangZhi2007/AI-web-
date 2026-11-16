/* ================= v0.25 复现工作台 独立专项验收 =================
   真实跑 Agent 任务取 report，验证：runReplay 逐项真实重算（八项全一致）、
   篡改声明摘要能定位不符项、被证伪轮关闭复现门禁、UI 双栏回填与判定章、
   reduced-motion 立即出结果、四档视口与 44px、零外联、打印隐藏。
   运行：node docs/scripts/qa-v025-repro-workbench-accept.js
   ================================================================ */
const {spawn}=require('child_process');
const http=require('http'),path=require('path'),os=require('os'),fs=require('fs');
const CHROME='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT=9394,WEB='D:\\AIBBBG\\Version1\\webapp';
const VIEWPORTS=[[1440,900],[1100,800],[768,1024],[390,844]];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const getJSON=u=>new Promise((res,rej)=>http.get(u,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(e)}})}).on('error',rej));
let pass=0,fail=0;
function ok(name,cond,detail){if(cond){pass++;console.log('  [OK] '+name);}else{fail++;console.log('  [FAIL] '+name+(detail?' · '+detail:''));}}
class CDP{
  constructor(u){this.ws=new WebSocket(u);this.id=0;this.p=new Map();this.errs=[];this.net=[]}
  ready(){return new Promise((res,rej)=>{this.ws.onopen=res;this.ws.onerror=rej;this.ws.onmessage=m=>{const o=JSON.parse(m.data);
    if(o.id&&this.p.has(o.id)){this.p.get(o.id)(o);this.p.delete(o.id);}
    else if(o.method==='Runtime.exceptionThrown')this.errs.push(o.params.exceptionDetails.exception&&o.params.exceptionDetails.exception.description||o.params.exceptionDetails.text);
    else if(o.method==='Network.requestWillBeSent')this.net.push(o.params.request.url);}})}
  send(m,p={}){const id=++this.id;return new Promise(res=>{this.p.set(id,res);this.ws.send(JSON.stringify({id,method:m,params:p}))})}
  async eval(e){const r=await this.send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});
    if(r.result&&r.result.exceptionDetails)throw new Error(r.result.exceptionDetails.exception&&r.result.exceptionDetails.exception.description||r.result.exceptionDetails.text);
    return r.result&&r.result.result?r.result.result.value:undefined}
  async goto(u){await this.send('Page.navigate',{url:u});await sleep(620)}
  async vp(w,h){await this.send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:false});await sleep(150)}
}
const url=f=>'file:///'+path.join(WEB,f).replace(/\\/g,'/');
const put=async(c,rep)=>{await c.goto(url('evidence.html'));
  const w=await c.send('Runtime.evaluate',{expression:'window',returnByValue:false});
  await c.send('Runtime.callFunctionOn',{objectId:w.result.result.objectId,
    functionDeclaration:'function(s){sessionStorage.setItem("probe.report",s);}',
    arguments:[{value:JSON.stringify(rep)}],returnByValue:true});
  await c.goto(url('evidence.html'));
};
const chrome=spawn(CHROME,['--headless=new','--disable-gpu','--no-first-run','--hide-scrollbars',
  '--remote-debugging-port='+PORT,'--user-data-dir='+path.join(os.tmpdir(),'qa-v025-'+Date.now()),
  '--allow-file-access-from-files','--force-color-profile=srgb','about:blank'],{stdio:'ignore'});
(async()=>{try{
  let tg;for(let i=0;i<40;i++){try{tg=await getJSON('http://127.0.0.1:'+PORT+'/json/list');break}catch(e){await sleep(150)}}
  const c=new CDP(tg.find(t=>t.type==='page').webSocketDebuggerUrl);await c.ready();
  await c.send('Page.enable');await c.send('Runtime.enable');await c.send('Network.enable');
  await c.vp(1440,900);

  /* §1 真实任务 */
  console.log('=== §1 真实任务 ===');
  await c.goto(url('monitor.html'));
  await c.eval(`sessionStorage.clear();sessionStorage.setItem('probe.cfg',JSON.stringify({url:'http://127.0.0.1/lab/sqli_01.php',vulnType:'sqli',script:'AGENT_LOOP',agent:true}));sessionStorage.setItem('probe.pendingRun','1')`);
  await c.goto(url('monitor.html'));
  let st='idle',n=0;while(n++<140){st=await c.eval(`document.querySelector('#dash')?document.querySelector('#dash').dataset.state:'?'`);if(['hit','nofind','degraded','oos'].includes(st))break;await sleep(220)}
  const rep=JSON.parse(await c.eval(`sessionStorage.getItem('probe.report')`));
  ok('标准靶场攻破且独立确认',st==='hit'&&rep.agent.breached===true&&rep.credibility.confirmed===1);

  /* §2 runReplay 引擎 */
  console.log('=== §2 复现引擎 ===');
  await put(c,rep);
  const engine=await c.eval(`(()=>{const x=window.Repro.runReplay(window.Probe.Store.getReport());
    return{ok:x.ok,pass:x.pass,n:x.checks.length,
      rows:x.checks.map(c=>({id:c.id,kind:c.kind,pass:c.pass})),hit:x.hit&&x.hit.round_no,label:x.label_set};})()`);
  ok('runReplay 返回八项检查',engine.ok===true&&engine.n===8,JSON.stringify(engine));
  ok('五项文件哈希 + 一项裁决 + 一项汇总 + 一项摘要旁车',
    engine.rows.filter(x=>x.kind==='hash').length===6&&engine.rows.filter(x=>x.kind==='verdict').length===1&&engine.rows.filter(x=>x.kind==='count').length===1,
    JSON.stringify(engine.rows.map(x=>x.kind)));
  ok('全部检查一致',engine.pass===true&&engine.rows.every(x=>x.pass===true));
  ok('命中轮与标注集取真值',engine.hit===3&&engine.label==='LAB-GT-01');
  /* 篡改声明摘要 → 精确定位不符项 */
  const tamper=await c.eval(`(()=>{const r=window.Probe.Store.getReport();
    const built=window.Repro.buildFiles(r,window.Repro.exportRounds(r),window.Repro.CAP);
    const sum=JSON.parse(built.files[5].text);sum.integrity.files[0].sha256='0'.repeat(64);
    const x=window.Repro.runReplay(r,sum);
    return{pass:x.pass,fail:x.checks.filter(k=>!k.pass).map(k=>k.id)};})()`);
  ok('篡改声明哈希后判定不一致',tamper.pass===false&&tamper.fail.length===1&&tamper.fail[0]==='F01',JSON.stringify(tamper));
  /* 篡改点位标注 → 以「原始声明摘要」重放，应抓出裁决冲突。
     不传 declaredOverride 时声明随当前 report 一起重算，等于自证，检不出篡改；
     这正是导出包需要 .sha256 旁车与原始摘要的原因。 */
  const tamperV=await c.eval(`(()=>{const orig=window.Probe.Store.getReport();
    const r=JSON.parse(JSON.stringify(orig));r.rounds[2].gt_triggered=false;
    const x=window.Repro.runReplay(r);
    return{ok:x.ok,reason:x.reason};})()`);
  ok('篡改点位标注后该轮不再是复现样本',tamperV.ok===false&&/无独立裁决确认/.test(tamperV.reason),JSON.stringify(tamperV));
  /* 无报告 */
  const empty=await c.eval(`(()=>{const x=window.Repro.runReplay(null);return{ok:x.ok,reason:x.reason};})()`);
  ok('空报告返回可读原因',empty.ok===false&&/无报告/.test(empty.reason),JSON.stringify(empty));

  /* §3 UI 工作台 */
  console.log('=== §3 工作台 UI ===');
  await put(c,rep);
  const ui0=await c.eval(`(()=>({box:!!document.querySelector('.rpw'),state:document.querySelector('.rpw').dataset.state,
    btn:!!document.querySelector('[data-rp-run]'),rows:document.querySelectorAll('.rpw__row').length,
    sealHidden:document.querySelector('[data-rp-seal]').hidden}))()`);
  ok('工作台初始为 ready，复现前无结论行',ui0.box&&ui0.state==='ready'&&ui0.btn&&ui0.rows===0&&ui0.sealHidden,JSON.stringify(ui0));
  await c.eval(`document.querySelector('[data-rp-run]').click()`);
  await sleep(1900);
  const ui1=await c.eval(`(()=>{const s=document.querySelector('[data-rp-seal]');return{
    state:document.querySelector('.rpw').dataset.state,rows:document.querySelectorAll('.rpw__row').length,
    pass:document.querySelectorAll('.rpw__row[data-pass="1"]').length,
    progress:document.querySelector('[data-rp-progress]').textContent,
    seal:s.hidden?null:s.textContent.trim(),mark:document.querySelector('.rpw__row .rpw__mark').textContent,
    replay:[...document.querySelectorAll('[data-rp]')].map(e=>e.textContent),
    labels:[...document.querySelectorAll('.rpw__label')].map(e=>e.textContent)};})()`);
  ok('开始复现后八行逐项通过',ui1.state==='pass'&&ui1.rows===8&&ui1.pass===8&&ui1.progress==='8 / 8',JSON.stringify(ui1));
  ok('判定章显示复现一致',/复现一致/.test(ui1.seal||'')&&/8 \/ 8/.test(ui1.seal||''),ui1.seal);
  ok('一致行用 ≡ 刻度',ui1.mark==='≡');
  ok('双栏回填真值',ui1.replay[0]===rep.task.task_id&&ui1.replay[2]==='CONFIRMED'&&ui1.replay[3]==='LAB-GT-01',JSON.stringify(ui1.replay));
  ok('核对行有中文类型标签',ui1.labels.some(x=>/请求文件/.test(x))&&ui1.labels.some(x=>/独立裁决/.test(x)));
  /* 二次点击可重跑 */
  await c.eval(`document.querySelector('[data-rp-run]').click()`);await sleep(1900);
  ok('可重复复现且结果不变',(await c.eval(`document.querySelector('.rpw').dataset.state`))==='pass');

  /* §4 门禁：被证伪轮不提供复现 */
  console.log('=== §4 门禁 ===');
  await c.goto(url('evidence.html'));
  await c.eval(`(()=>{const r=JSON.parse(sessionStorage.getItem('probe.report'));r.rounds[2].oracle_verdict='REFUTED';sessionStorage.setItem('probe.report',JSON.stringify(r))})()`);
  await c.goto(url('evidence.html'));
  const gate=await c.eval(`(()=>({state:document.querySelector('.rpw').dataset.state,btn:!!document.querySelector('[data-rp-run]'),
    text:document.querySelector('.rpw__lede').textContent}))()`);
  ok('证伪轮关闭复现入口',gate.state==='blocked'&&gate.btn===false&&/无独立裁决确认/.test(gate.text),JSON.stringify(gate));
  /* 报告页 v0.24 导出入口契约保持 */
  await put(c,rep);await c.goto(url('report.html'));
  const exp=await c.eval(`(()=>({btn:!!document.querySelector('#reproBtn'),reason:document.querySelector('#reproReason').textContent,secs:document.querySelectorAll('.report-sec').length}))()`);
  ok('报告页导出入口与 5 附录契约保持',exp.btn&&/SHA-256/.test(exp.reason)&&exp.secs===5,JSON.stringify(exp));

  /* §5 reduced-motion 立即出结果 */
  console.log('=== §5 reduced-motion ===');
  await c.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await put(c,rep);
  await c.eval(`document.querySelector('[data-rp-run]').click()`);await sleep(120);
  ok('reduced-motion 下无逐行动画直接出结果',
    (await c.eval(`document.querySelector('.rpw').dataset.state`))==='pass'&&
    (await c.eval(`document.querySelectorAll('.rpw__row').length`))===8);
  await c.send('Emulation.setEmulatedMedia',{features:[]});

  /* §6 响应式 / 44px / 打印 / 零外联 */
  console.log('=== §6 响应式与契约 ===');
  let overflow=[],under=[];
  for(const [w,h] of VIEWPORTS){
    await c.vp(w,h);await put(c,rep);
    await c.eval(`document.querySelector('[data-rp-run]').click()`);await sleep(1500);
    const r=await c.eval(`(()=>{const bad=[...document.querySelectorAll('body *')].filter(e=>{
      const s=getComputedStyle(e);if(s.display==='none'||s.visibility==='hidden')return false;
      if(e.closest('.tbl-scroll'))return false;
      const b=e.getBoundingClientRect();return b.right>innerWidth+1||b.left<-1;}).map(e=>e.tagName+'.'+e.className).slice(0,3);
      const small=[...document.querySelectorAll('button,a')].filter(e=>{const s=getComputedStyle(e);
        if(s.display==='none'||s.visibility==='hidden')return false;
        const b=e.getBoundingClientRect();return b.height>0&&b.height<44;}).map(e=>e.id||e.className).slice(0,3);
      return{bad,small,rows:document.querySelectorAll('.rpw__row').length};})()`);
    if(r.bad.length)overflow.push(w+':'+r.bad.join(','));
    if(r.small.length)under.push(w+':'+r.small.join(','));
    if(r.rows!==8)overflow.push(w+':rows='+r.rows);
  }
  ok('四档视口零横向溢出',overflow.length===0,overflow.join(' | '));
  ok('四档视口 44px 命中合规',under.length===0,under.join(' | '));
  await c.vp(1440,900);await put(c,rep);
  await c.send('Emulation.setEmulatedMedia',{media:'print'});
  ok('打印态隐藏复现工作台',(await c.eval(`getComputedStyle(document.querySelector('.rpw')).display`))==='none');
  await c.send('Emulation.setEmulatedMedia',{media:''});
  const outside=c.net.filter(u=>/^https?:/.test(u)&&!/^http:\/\/127\.0\.0\.1:9394/.test(u));
  ok('零外部网络请求',outside.length===0,outside.slice(0,3).join(','));
  ok('控制台异常为 0',c.errs.length===0,c.errs.slice(0,2).join(','));

  console.log('\n合计: '+(pass+fail)+' 项 · 通过 '+pass+' · 失败 '+fail);
  if(fail)process.exitCode=1;
}catch(e){console.error('FATAL',e.stack||e);process.exitCode=1}finally{chrome.kill('SIGKILL')}})();
