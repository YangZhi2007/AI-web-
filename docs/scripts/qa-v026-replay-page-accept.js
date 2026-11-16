/* ================= v0.26 重放脚本功能子页 独立专项验收 =================
   真实跑 Agent 任务取 report，验证：showReplay 打开 replay.html 而非 about:blank、
   精简文档字段齐全、子页执行路径 5 步 / 六类文件 / 35 行脚本完整无截断、
   词法着色、复制与下载入口、空态、四档视口与 44px、打印隐藏、零外联、
   v0.24 导出与 v0.25 工作台契约零回归。
   运行：node docs/scripts/qa-v026-replay-page-accept.js
   ==================================================================== */
const {spawn}=require('child_process');
const http=require('http'),path=require('path'),os=require('os'),fs=require('fs');
const CHROME='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT=9401,WEB='D:\\AIBBBG\\Version1\\webapp';
const VIEWPORTS=[[1440,900],[1100,800],[768,1024],[390,844]];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const getJSON=u=>new Promise((res,rej)=>http.get(u,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(e)}})}).on('error',rej));
let pass=0,fail=0;
function ok(name,cond,detail){if(cond){pass++;console.log('  [OK] '+name);}else{fail++;console.log('  [FAIL] '+name+(detail?' · '+detail:''));}}
class CDP{
  constructor(u){this.ws=new WebSocket(u);this.id=0;this.p=new Map();this.errs=[];this.net=[];}
  ready(){return new Promise((res,rej)=>{this.ws.onopen=res;this.ws.onerror=rej;this.ws.onmessage=m=>{const o=JSON.parse(m.data);
    if(o.id&&this.p.has(o.id)){this.p.get(o.id)(o);this.p.delete(o.id);}
    else if(o.method==='Runtime.exceptionThrown')this.errs.push(String((o.params.exceptionDetails.exception||{}).description||o.params.exceptionDetails.text));
    else if(o.method==='Network.requestWillBeSent')this.net.push(o.params.request.url);}})}
  send(m,p={}){const id=++this.id;return new Promise(res=>{this.p.set(id,res);this.ws.send(JSON.stringify({id,method:m,params:p}))})}
  async eval(e){const r=await this.send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});
    if(r.result&&r.result.exceptionDetails)throw new Error(String((r.result.exceptionDetails.exception||{}).description||r.result.exceptionDetails.text));
    return r.result&&r.result.result?r.result.result.value:undefined}
  async goto(u){await this.send('Page.navigate',{url:u});await sleep(640)}
  async vp(w,h){await this.send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:false});await sleep(160)}
}
const url=f=>'file:///'+path.join(WEB,f).replace(/\\/g,'/');
const chrome=spawn(CHROME,['--headless=new','--disable-gpu','--no-first-run','--hide-scrollbars',
  '--remote-debugging-port='+PORT,'--user-data-dir='+path.join(os.tmpdir(),'qa-v026-'+Date.now()),
  '--allow-file-access-from-files','--force-color-profile=srgb','about:blank'],{stdio:'ignore'});
(async()=>{try{
  let tg;for(let i=0;i<40;i++){try{tg=await getJSON('http://127.0.0.1:'+PORT+'/json/list');break}catch(e){await sleep(150)}}
  const c=new CDP(tg.find(t=>t.type==='page').webSocketDebuggerUrl);await c.ready();
  await c.send('Page.enable');await c.send('Runtime.enable');await c.send('Network.enable');
  await c.vp(1440,900);

  /* §1 真实任务取 report */
  console.log('=== §1 真实任务 ===');
  await c.goto(url('monitor.html'));
  await c.eval(`sessionStorage.clear();sessionStorage.setItem('probe.cfg',JSON.stringify({url:'http://127.0.0.1/lab/sqli_01.php',vulnType:'sqli',script:'AGENT_LOOP',agent:true}));sessionStorage.setItem('probe.pendingRun','1')`);
  await c.goto(url('monitor.html'));
  let st='idle',n=0;while(n++<140){st=await c.eval(`document.querySelector('#dash')?document.querySelector('#dash').dataset.state:'?'`);if(['hit','nofind'].includes(st))break;await sleep(220)}
  const rep=JSON.parse(await c.eval(`sessionStorage.getItem('probe.report')`));
  ok('标准靶场攻破且独立确认',st==='hit'&&rep.agent.breached===true&&rep.credibility.confirmed===1,
    'state='+st+' confirmed='+rep.credibility.confirmed);

  /* §2 showReplay 导航契约 */
  console.log('=== §2 导航契约 ===');
  await c.goto(url('report.html'));
  const nav=await c.eval(`(()=>{window.open=function(u){window.__opened=u;return{focus:function(){}}};
    const p=window.Repro.buildPackage(window.Probe.Store.getReport());
    const ok=window.Repro.showReplay(p);
    const d=window.Repro.readReplayDoc();
    return{ok:ok,url:window.__opened,name:d&&d.name,sha:d&&d.sha256,files:d&&d.files.length,
      lines:d?d.script.split('\\n').length:0,task:d&&d.taskId,label:d&&d.labelSet,
      hasZip:d?Object.prototype.hasOwnProperty.call(d,'zip'):null};})()`);
  ok('showReplay 返回成功且指向 replay.html',nav.ok===true&&/replay\.html$/.test(nav.url||''),JSON.stringify(nav.url));
  ok('不再使用 about:blank / document.write',!/about:blank/.test(nav.url||''));
  ok('精简文档字段齐全且不带 ZIP 字节',!!(nav.name&&nav.sha&&nav.files===6&&nav.lines>30&&nav.task&&nav.label&&nav.hasZip===false),JSON.stringify(nav));
  const replayDoc=await c.eval(`window.Repro.readReplayDoc()`);
  ok('浏览器侧可取回完整文档',!!(replayDoc&&replayDoc.script&&replayDoc.sha256));

  /* §3 子页渲染 */
  console.log('=== §3 子页渲染 ===');
  await c.goto(url('replay.html'));
  const page=await c.eval(`(()=>({title:document.title,p:document.body.dataset.page,
    steps:document.querySelectorAll('.rpdoc__flow li').length,
    files:document.querySelectorAll('.rpdoc__files li').length,
    lines:document.querySelectorAll('.rpdoc-code__line').length,
    toks:document.querySelectorAll('.rpdoc-tk').length,
    kinds:['cmt','str','var','kw','id','num','op'].filter(k=>document.querySelector('.rpdoc-tk--'+k)).length,
    seal:!!document.querySelector('.rpdoc__seal'),actions:document.querySelectorAll('.rpdoc__actions button').length,
    empty:!!document.querySelector('.rpdoc__empty')}))()`);
  ok('页面标题与 data-page 正确',/重放脚本/.test(page.title)&&page.p==='replay',JSON.stringify(page));
  ok('执行路径 5 步 + 六类文件清单',page.steps===5&&page.files===6,JSON.stringify(page));
  ok('脚本逐行渲染且词法着色生效',page.lines>=34&&page.toks>300&&page.kinds>=5,JSON.stringify(page));
  ok('指纹封条与三个操作入口齐全',page.seal===true&&page.actions===3&&page.empty===false);

  /* §4 脚本完整性：页面渲染拼回后与文档原文一致 */
  console.log('=== §4 脚本完整性 ===');
  const integ=await c.eval(`(()=>{const d=window.Repro.readReplayDoc();
    const got=[...document.querySelectorAll('.rpdoc-code__txt')].map(e=>e.textContent.replace(/\\u00a0/g,'')).join('\\n');
    const a=d.script.replace(/\\r/g,'').split('\\n');while(a.length&&!a[a.length-1].trim())a.pop();
    const exp=a.join('\\n');
    return{same:got===exp,gotLen:got.length,expLen:exp.length,head:got.slice(0,15),
      hasBash:got.indexOf('#!/usr/bin/env bash')>-1,hasSum:got.indexOf('sha256sum')>-1};})()`);
  ok('渲染文本与原始脚本逐字一致（零截断）',integ.same===true,integ.gotLen+' vs '+integ.expLen);
  ok('脚本首行与关键命令保留',integ.hasBash===true&&integ.hasSum===true,JSON.stringify(integ.head));

  /* §5 操作入口 */
  console.log('=== §5 操作入口 ===');
  const acts=await c.eval(`(()=>[...document.querySelectorAll('.rpdoc__actions button')].map(b=>({
    t:b.textContent.trim(),h:Math.round(b.getBoundingClientRect().height),d:b.disabled})))()`);
  ok('复制 / 下载 / 返回三个入口均为 44px 可用',acts.length===3&&acts.every(a=>a.h>=44&&a.d===false),JSON.stringify(acts));
  const errBefore=c.errs.length;
  await c.eval(`document.querySelector('[data-rp-copy]').click();document.querySelector('[data-rp-down]').click()`);
  await sleep(500);
  ok('复制与下载点击无页面异常',c.errs.length===errBefore,JSON.stringify(c.errs.slice(errBefore)));

  /* §6 空态 */
  console.log('=== §6 空态 ===');
  await c.eval(`sessionStorage.removeItem('probe.replayDoc')`);
  await c.goto(url('replay.html'));
  const empty=await c.eval(`(()=>({e:!!document.querySelector('.rpdoc__empty'),
    t:document.querySelector('#replayRoot').textContent.slice(0,12),
    link:!!document.querySelector('.rpdoc__empty a[href="evidence.html"]')}))()`);
  ok('无文档时展示可读空态与返回入口',empty.e===true&&/没有待查看/.test(empty.t)&&empty.link===true,JSON.stringify(empty));

  /* §7 视口 / 44px / 打印 / 零外联 */
  console.log('=== §7 视口与规格 ===');
  for(const [w,h] of VIEWPORTS){
    await c.vp(w,h);
    await c.goto(url('replay.html'));
    const wo=await c.send('Runtime.evaluate',{expression:'window',returnByValue:false});
    await c.send('Runtime.callFunctionOn',{objectId:wo.result.result.objectId,
      functionDeclaration:'function(s){sessionStorage.setItem("probe.replayDoc",s);}',
      arguments:[{value:JSON.stringify(replayDoc)}],returnByValue:true});
    await c.goto(url('replay.html'));
    const spec=await c.eval(`(()=>{const bad=[...document.querySelectorAll('body *')].filter(e=>{
      const s=getComputedStyle(e);if(s.display==='none'||s.visibility==='hidden')return false;
      const b=e.getBoundingClientRect();return b.right>innerWidth+1||b.left<-1;}).map(e=>e.tagName+'.'+e.className).slice(0,3);
      const hit=[...document.querySelectorAll('a,button,[tabindex="0"]')].filter(e=>{
        const s=getComputedStyle(e);if(s.display==='none'||s.visibility==='hidden')return false;
        return Math.round(e.getBoundingClientRect().height)<44;}).length;
      return{over:bad,under:hit,lines:document.querySelectorAll('.rpdoc-code__line').length};})()`);
    ok(w+'px 零横向溢出',spec.over.length===0,JSON.stringify(spec.over));
    ok(w+'px 无 <44px 可见命中目标',spec.under===0,'under='+spec.under);
    ok(w+'px 脚本仍完整渲染',spec.lines>=34,'lines='+spec.lines);
  }
  await c.vp(1440,900);await c.goto(url('replay.html'));
  await c.send('Emulation.setEmulatedMedia',{media:'print'});
  const pr=await c.eval(`(()=>({act:getComputedStyle(document.querySelector('.rpdoc__actions')).display,
    seal:getComputedStyle(document.querySelector('.rpdoc__seal')).display}))()`);
  await c.send('Emulation.setEmulatedMedia',{media:''});
  ok('打印隐藏操作与封条',pr.act==='none'&&pr.seal==='none',JSON.stringify(pr));
  const ext=c.net.filter(u=>/^https?:\/\//i.test(u));
  ok('零外部请求',ext.length===0,JSON.stringify(ext.slice(0,3)));
  ok('全程无页面异常',c.errs.length===0,JSON.stringify(c.errs.slice(0,3)));

  /* §8 既有契约零回归 */
  console.log('=== §8 既有契约 ===');
  await c.goto(url('evidence.html'));
  const wb=await c.eval(`(()=>({workbench:!!document.querySelector('.rpw'),btn:!!document.querySelector('[data-rp-run]')}))()`);
  ok('v0.25 复现工作台入口保持',wb.workbench===true&&wb.btn===true,JSON.stringify(wb));
  await c.goto(url('report.html'));
  const rp=await c.eval(`(()=>({sec:document.querySelectorAll('.report-sec').length,
    btn:!!document.querySelector('#reproBtn'),exportBtn:!!document.querySelector('#exportBtn')}))()`);
  ok('v0.21 五附录与 v0.24 导出按钮保持',rp.sec===5&&rp.btn===true&&rp.exportBtn===true,JSON.stringify(rp));

  console.log('\n合计: '+pass+' / '+(pass+fail)+' 通过'+(fail?' · 失败 '+fail:''));
  if(fail)process.exitCode=1;
}catch(e){console.error('FATAL '+(e.stack||e));process.exitCode=1}finally{chrome.kill('SIGKILL')}})();
