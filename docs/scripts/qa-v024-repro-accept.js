/* ================= v0.24 F-04 漏洞复现包 独立专项验收 =================
   真实跑 Agent 任务取 report（不内嵌假数据），派生未命中 / 越界输入；
   覆盖：仅命中可导出、六类文件、ZIP 结构、SHA-256 一致性、重放核对、
   20MB 截断、UI 双页接入、打印隐藏、四档视口、44px、对比度、零外联。
   运行：node docs/scripts/qa-v024-repro-accept.js
   ==================================================================== */
const {spawn}=require('child_process');
const http=require('http'),path=require('path'),os=require('os'),fs=require('fs'),crypto=require('crypto');
const CHROME='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT=9386,WEB='D:\\AIBBBG\\Version1\\webapp';
const OUT=path.join(os.tmpdir(),'qa-v024-repro');
const VIEWPORTS=[[1440,900],[1100,800],[768,1024],[390,844]];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const getJSON=u=>new Promise((res,rej)=>http.get(u,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(e)}})}).on('error',rej));
let pass=0,fail=0;
function ok(name,cond,detail){ if(cond){pass++;console.log('  [OK] '+name);}else{fail++;console.log('  [FAIL] '+name+(detail?' · '+detail:''));} }
class CDP{
  constructor(u){this.ws=new WebSocket(u);this.id=0;this.p=new Map();this.errs=[];this.net=[]}
  ready(){return new Promise((res,rej)=>{this.ws.onopen=res;this.ws.onerror=rej;this.ws.onmessage=m=>{const o=JSON.parse(m.data);
    if(o.id&&this.p.has(o.id)){this.p.get(o.id)(o);this.p.delete(o.id);}
    else if(o.method==='Runtime.exceptionThrown')this.errs.push(o.params.exceptionDetails.text);
    else if(o.method==='Network.requestWillBeSent')this.net.push(o.params.request.url);}})}
  send(m,p={}){const id=++this.id;return new Promise(res=>{this.p.set(id,res);this.ws.send(JSON.stringify({id,method:m,params:p}))})}
  async eval(e){const r=await this.send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});
    if(r.result&&r.result.exceptionDetails)throw new Error(r.result.exceptionDetails.text);
    return r.result&&r.result.result?r.result.result.value:undefined}
  async goto(u){await this.send('Page.navigate',{url:u});await sleep(600)}
  async vp(w,h){await this.send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:false});await sleep(150)}
}
const url=f=>'file:///'+path.join(WEB,f).replace(/\\/g,'/');
const putReport=async(c,rep)=>{
  // 导航到报告页后原地写 Store，不 reload：reload 会触发 core.js 的 pt-nav 转场清理，
  // 抹掉刚注入的报告。用 CDP 参数传值，避免 20MB 级报告内联进 JS 表达式造成命令过长。
  await c.goto(url('report.html'));
  const w=await c.send('Runtime.evaluate',{expression:'window',returnByValue:false});
  const objId=w.result&&w.result.result&&w.result.result.objectId;
  await c.send('Runtime.callFunctionOn',{objectId:objId,
    functionDeclaration:'function(s){sessionStorage.setItem("probe.report",s);}',
    arguments:[{value:JSON.stringify(rep)}],returnByValue:true});
};
const chrome=spawn(CHROME,['--headless=new','--disable-gpu','--no-first-run','--hide-scrollbars','--remote-debugging-port='+PORT,
  '--user-data-dir='+path.join(os.tmpdir(),'qa-v024-'+Date.now()),'--allow-file-access-from-files','--force-color-profile=srgb','about:blank'],{stdio:'ignore'});
(async()=>{try{
  fs.mkdirSync(OUT,{recursive:true});
  let tg;for(let i=0;i<40;i++){try{tg=await getJSON('http://127.0.0.1:'+PORT+'/json/list');break}catch(e){await sleep(150)}}
  const c=new CDP(tg.find(t=>t.type==='page').webSocketDebuggerUrl);await c.ready();
  await c.send('Page.enable');await c.send('Runtime.enable');await c.send('Network.enable');
  await c.vp(1440,900);

  /* ===== §1 真实任务：标准靶场（命中） ===== */
  console.log('=== §1 真实任务取 report ===');
  await c.goto(url('monitor.html'));
  await c.eval(`sessionStorage.clear();sessionStorage.setItem('probe.cfg',JSON.stringify({url:'http://127.0.0.1/lab/sqli_01.php',vulnType:'sqli',script:'AGENT_LOOP',agent:true}));sessionStorage.setItem('probe.pendingRun','1')`);
  await c.goto(url('monitor.html'));
  let st='idle',t=0;while(t++<140){st=await c.eval(`document.querySelector('#dash')?document.querySelector('#dash').dataset.state:'?'`);if(['hit','nofind','degraded','oos'].includes(st))break;await sleep(220)}
  const hitRep=JSON.parse(await c.eval(`sessionStorage.getItem('probe.report')`));
  ok('真实任务完成且状态为命中',st==='hit'&&!!hitRep&&hitRep.agent.breached===true,'state='+st);

  /* ===== §2 SHA-256 标准向量 ===== */
  console.log('=== §2 SHA-256 / ZIP 内核 ===');
  await putReport(c,hitRep);  // repro.js 仅装配在报告页/证据链页
  const hashOK=await c.eval(`(()=>{const R=window.Repro;
    return [['abc','ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
      ['','e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
      ['hello','2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824']]
      .every(([s,e])=>R.sha256(R.bytes(s))===e);})()`);
  ok('SHA-256 三组标准向量一致',hashOK===true);

  /* ===== §3 构造复现包并落盘核对 ===== */
  console.log('=== §3 六类文件 / ZIP / 哈希 ===');
  await putReport(c,hitRep);
  const pack=await c.eval(`(()=>{const R=window.Repro,p=R.buildPackage(window.Probe.Store.getReport());
    if(!p.ok)return{ok:false,reason:p.reason};let bin='';const u=new Uint8Array(p.zip);
    for(let i=0;i<u.length;i++)bin+=String.fromCharCode(u[i]);
    return{ok:true,sha:p.sha256,size:p.size,name:p.name,truncated:p.truncated,
      files:p.files.map(f=>({name:f.name,sha:R.sha256(R.bytes(f.text))})),b64:btoa(bin),sidecar:p.sidecar.text,
      reg:R.registry()};})()`);
  ok('命中报告可导出复现包',pack.ok===true,pack.reason);
  const buf=Buffer.from(pack.b64,'base64');
  fs.writeFileSync(path.join(OUT,pack.name),buf);
  fs.writeFileSync(path.join(OUT,pack.name+'.sha256'),pack.sidecar);
  const local=crypto.createHash('sha256').update(buf).digest('hex');
  ok('整包 SHA-256 与浏览器一致',local===pack.sha,'local='+local.slice(0,12)+' js='+pack.sha.slice(0,12));
  ok('ZIP 头正确（PK\\x03\\x04）',buf.slice(0,2).toString()==='PK');
  ok('ZIP 尾记录正确（PK\\x05\\x06）',buf.slice(-22,-20).toString()==='PK');
  ok('六类文件齐全',pack.files.length===6,'count='+pack.files.length);
  const kinds=['01-request','02-payload-manifest','03-response','04-replay','05-scenario','06-verification-summary'];
  ok('六类文件名逐一匹配',kinds.every(k=>pack.files.some(f=>f.name.indexOf(k)>-1)));
  ok('文件名含任务编号与假设编号',pack.name.indexOf(hitRep.task.task_id)>-1&&/-H\d{2}-evidence\.zip$/.test(pack.name),pack.name);
  /* 标准解压工具能解开 */
  const unz=path.join(OUT,'unz');fs.mkdirSync(unz,{recursive:true});
  const AdmZipLike=()=>{ // 用 python zipfile 作为独立实现
    const r=require('child_process').spawnSync('python3',['-c',
      `import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);z.extractall(sys.argv[2]);print(len(z.namelist()))`,
      path.join(OUT,pack.name),unz],{encoding:'utf8'});
    return {code:r.status,out:(r.stdout||'').trim(),err:r.stderr};
  };
  const uz=AdmZipLike();
  ok('ZIP 可被标准解压工具解开',uz.code===0&&uz.out==='6',JSON.stringify(uz));
  fs.copyFileSync(path.join(OUT,pack.name),path.join(unz,pack.name));
  fs.copyFileSync(path.join(OUT,pack.name+'.sha256'),path.join(unz,pack.name+'.sha256'));
  /* 逐文件哈希与摘要一致 */
  let hashAll=true;
  for(const f of pack.files){const p=path.join(unz,f.name);
    if(!fs.existsSync(p)){hashAll=false;continue;}
    if(crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')!==f.sha)hashAll=false;}
  ok('六类文件逐文件 SHA-256 一致',hashAll);
  ok('buildPackage 不隐式登记（登记只在用户点击时发生）',pack.reg.length===0,'reg='+pack.reg.length);
  /* 内容真值/诚信 */
  const req=fs.readFileSync(path.join(unz,pack.files[0].name),'utf8');
  const manifest=JSON.parse(fs.readFileSync(path.join(unz,pack.files[1].name),'utf8'));
  const summary=JSON.parse(fs.readFileSync(path.join(unz,pack.files[5].name),'utf8'));
  ok('请求文件含真实任务 ID 与抽象点位',req.indexOf(hitRep.task.task_id)>-1&&req.indexOf('param_ref:')>-1);
  ok('请求文件不含凭据字段',!/password=|token=|secret=/i.test(req));
  ok('载荷清单只含算子编号、无载荷文本',manifest.mock_flag===true&&manifest.operator_whitelist.every(x=>/^OP_[A-Z0-9_]+$/.test(x)));
  ok('摘要裁决数取自 credibility',summary.credibility.confirmed===hitRep.credibility.confirmed&&
     summary.credibility.refuted===hitRep.credibility.refuted);
  ok('摘要含诚信边界标注',/不构成实测误报率/.test(summary.note)&&summary.mock_flag===true);

  /* ===== §4 重放脚本 ===== */
  console.log('=== §4 重放脚本 ===');
  const dry=require('child_process').spawnSync('bash',[pack.files[3].name,'--dry-run'],{cwd:unz,encoding:'utf8'});
  ok('重放 --dry-run 可执行且零请求',dry.status===0&&/dry-run/.test(dry.stdout)&&/零外部请求/.test(dry.stdout),(dry.stdout||dry.stderr).slice(0,120));
  const replay=require('child_process').spawnSync('bash',[pack.files[3].name],{cwd:unz,encoding:'utf8'});
  ok('重放完整核对：六类哈希一致 + 裁决可复现',replay.status===0&&/结果：六类文件哈希一致/.test(replay.stdout)&&/OK/.test(replay.stdout),(replay.stdout||replay.stderr).slice(0,160));

  /* ===== §5 仅命中可导出 ===== */
  console.log('=== §5 门禁：仅命中可导出 ===');
  await c.goto(url('monitor.html'));
  await c.eval(`sessionStorage.clear();sessionStorage.setItem('probe.cfg',JSON.stringify({url:'http://127.0.0.1/lab/hard.php',vulnType:'sqli',script:'AGENT_LOOP',agent:true}));sessionStorage.setItem('probe.pendingRun','1')`);
  await c.goto(url('monitor.html'));
  st='idle';t=0;while(t++<160){st=await c.eval(`document.querySelector('#dash')?document.querySelector('#dash').dataset.state:'?'`);if(['hit','nofind','degraded','oos'].includes(st))break;await sleep(220)}
  const hard=JSON.parse(await c.eval(`sessionStorage.getItem('probe.report')`));
  ok('加固靶场在看门狗内攻破（v0.36 不再有固定未攻破结局）',
    hard.agent.breached===true&&hard.rounds.length<=8);
  /* 未攻破门禁仍须验证：由已攻破报告构造「裁决全部否定」的异常护栏报告 */
  const hardNoHit=JSON.parse(JSON.stringify(hard));
  hardNoHit.agent.breached=false;hardNoHit.agent.breachRound=null;
  hardNoHit.agent.stopReason='SAFETY_GUARD';hardNoHit.terminate_reason='GUARD';
  hardNoHit.analysis=null;hardNoHit.findings=[];
  hardNoHit.rounds.forEach(function(q){q.hit_signal=false;q.gt_triggered=false;
    q.oracle_verdict='TRUE_NEGATIVE';q.oracle_cn='拦截未触发';});
  /* putReport 不 reload：按钮在页面初始化时定型，故须在导航前先写入未攻破报告 */
  await c.eval(`sessionStorage.setItem('probe.report',${JSON.stringify(JSON.stringify(hardNoHit))})`);
  await putReport(c,hardNoHit);
  const hardGate=await c.eval(`(()=>{const p=window.Repro.buildPackage(window.Probe.Store.getReport());const b=document.querySelector('#reproBtn');
    return{ok:p.ok,reason:p.reason,disabled:b?b.disabled:null,text:b?b.textContent:null};})()`);
  ok('未攻破不可导出且按钮禁用',hardGate.ok===false&&hardGate.disabled===true&&hardGate.reason.indexOf('无独立裁决确认')>-1,JSON.stringify(hardGate));
  /* 越界派生 */
  const oos=JSON.parse(JSON.stringify(hitRep));oos.task.out_of_scope=true;
  oos.rounds.forEach(x=>{x.oracle_verdict='NOT_APPLICABLE';x.gt_triggered=false;});
  await putReport(c,oos);
  const oosPack=await c.eval(`(()=>{const p=window.Repro.buildPackage(window.Probe.Store.getReport());return{ok:p.ok,reason:p.reason};})()`);
  ok('越界报告不可导出',oosPack.ok===false&&/越界/.test(oosPack.reason),JSON.stringify(oosPack));
  /* 旧缓存兼容 */
  const legacy=JSON.parse(JSON.stringify(hitRep));delete legacy.credibility;
  await putReport(c,legacy);
  const legacyOK=await c.eval(`window.Repro.buildPackage(window.Probe.Store.getReport()).ok===true`);
  ok('无 credibility 的旧缓存仍可导出（现算）',legacyOK===true);

  /* ===== §6 20MB 截断 =====
     浏览器 sessionStorage 单 origin 配额约 5–10MB，无法注入 21MB 报告；
     同一段截断逻辑用「临时把 CAP 调到远小于本包回显」触发，验证的是同一实现分支。 */
  console.log('=== §6 R-04-04 上限截断 ===');
  await putReport(c,hitRep);
  const cap0=await c.eval(`window.Repro.CAP`);
  const bigPack=await c.eval(`(()=>{const R=window.Repro;
    R.CAP=512;const p=R.buildPackage(window.Probe.Store.getReport());
    const out={ok:p.ok,truncated:p.truncated,size:p.size,limit:R.CAP,
      note:(p.files.find(f=>f.name.indexOf('06-verification')>-1).text.match(/"applied": (true|false)/)||[])[1],
      echoBytes:p.files.find(f=>f.name.indexOf('03-response')>-1).text.length};
    R.CAP=${cap0};return out;})()`);
  ok('回显超限时触发截断标注',bigPack.ok===true&&bigPack.truncated===true&&bigPack.note==='true',JSON.stringify(bigPack));
  ok('截断后回显体积受控',bigPack.echoBytes<1200,'echo='+bigPack.echoBytes);
  ok('CAP 恢复为 20MB',(await c.eval(`window.Repro.CAP`))===20*1024*1024);

  /* ===== §7 双页 UI / 打印 / 44px / 视口 ===== */
  console.log('=== §7 UI 与响应式 ===');
  await putReport(c,hitRep);
  await c.goto(url('report.html'));
  const ui=await c.eval(`(()=>({btn:!!document.querySelector('#reproBtn'),disabled:document.querySelector('#reproBtn').disabled,
    secs:document.querySelectorAll('#reportCard .report-sec').length,
    export:!!document.querySelector('#exportBtn'),reason:document.querySelector('#reproReason').textContent}))()`);
  ok('报告页复现按钮与 PDF 按钮并存',ui.btn===true&&ui.export===true&&ui.disabled===false,JSON.stringify(ui));
  ok('报告 5 附录契约未变',ui.secs===5);
  ok('复现规格文案为安静标签',/6 文件/.test(ui.reason)&&/SHA-256/.test(ui.reason));
  /* 用户点击导出后才登记（R-04-05） */
  await c.eval(`sessionStorage.removeItem('probe.evidencePack')`);
  await c.eval(`document.querySelector('#reproBtn').click()`);
  const reg=await c.eval(`window.Repro.registry()`);
  ok('点击导出后登记含文件名/体积/SHA-256',reg.length>0&&!!reg[0].sha256&&reg[0].file_size>0&&!!reg[0].file_name);
  await c.goto(url('evidence.html'));
  const ev=await c.eval(`(()=>({box:!!document.querySelector('.repro-evidence'),
    txt:document.querySelector('.repro-evidence__head')?document.querySelector('.repro-evidence__head').textContent:null}))()`);
  ok('证据链页复现卡存在且显示确认数',ev.box===true&&/确认 1 条/.test(ev.txt||''),JSON.stringify(ev));
  /* 打印隐藏 */
  await c.send('Emulation.setEmulatedMedia',{media:'print'});
  const pr=await c.eval(`(()=>({ev:getComputedStyle(document.querySelector('.repro-evidence')).display,
    secs:document.querySelectorAll('#reportCard .report-sec').length}))()`);
  ok('打印态隐藏复现卡',pr.ev==='none');
  await c.send('Emulation.setEmulatedMedia',{media:''});
  /* 四档视口零溢出 + 44px */
  let overflow=[],under44=[];
  for(const [w,h] of VIEWPORTS){
    await c.vp(w,h);await c.goto(url('report.html'));
    const r=await c.eval(`(()=>{const bad=[...document.querySelectorAll('body *')].filter(e=>{
      const s=getComputedStyle(e);if(s.display==='none'||s.visibility==='hidden')return false;
      /* 表格在 .tbl-scroll 内横向滚动是设计行为，不算页面溢出 */
      if(e.closest('.tbl-scroll'))return false;
      const b=e.getBoundingClientRect();return b.right>innerWidth+1||b.left<-1;}).map(e=>e.tagName+'.'+e.className).slice(0,4);
      const small=[...document.querySelectorAll('button,a')].filter(e=>{const s=getComputedStyle(e);
        if(s.display==='none'||s.visibility==='hidden'||e.getAttribute('aria-hidden')==='true')return false;
        const b=e.getBoundingClientRect();return b.height>0&&b.height<44;}).map(e=>e.id||e.className).slice(0,4);
      return{bad,small};})()`);
    if(r.bad.length)overflow.push(w+':'+r.bad.join(','));
    if(r.small.length)under44.push(w+':'+r.small.join(','));
  }
  ok('四档视口零横向溢出',overflow.length===0,overflow.join(' | '));
  ok('四档视口 44px 命中合规',under44.length===0,under44.join(' | '));
  /* 零外联 / 控制台异常 */
  const outside=c.net.filter(u=>/^https?:/.test(u)&&!/^http:\/\/127\.0\.0\.1:9386/.test(u));
  ok('零外部网络请求',outside.length===0,outside.slice(0,3).join(','));
  ok('控制台异常为 0',c.errs.length===0,c.errs.slice(0,2).join(','));

  console.log('\n合计: '+(pass+fail)+' 项 · 通过 '+pass+' · 失败 '+fail);
  if(fail)process.exitCode=1;
}catch(e){console.error('FATAL',e.stack||e);process.exitCode=1}finally{chrome.kill('SIGKILL')}})();
