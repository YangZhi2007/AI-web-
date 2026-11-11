/* v0.18 SOC 攻防仪表 · 视觉存档截图
 * 5 张：任务台 / 监控空状态 / 命中态 / 防御成功(未检出) / 证据链。
 * 注意：v0.17.2 起「仅点击开始分析才触发」，脚本等价触发方式为
 *       sessionStorage 同时写入 probe.cfg + probe.pendingRun='1'（监控页读即清除）。
 * 输出保留 v0.17 原图不动，作为改动对照证据。 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9334, WEB = 'D:\\AIBBBG\\Version1\\webapp', OUT = 'D:\\AIBBBG\\Version1\\docs\\screenshots';
const fileUrl = p => 'file:///' + path.join(WEB, p).replace(/\\/g, '/');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJSON = url => new Promise((res, rej) => http.get(url, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{try{res(JSON.parse(d));}catch(e){rej(e);}}); }).on('error',rej));
const chrome = spawn(CHROME, ['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port='+PORT,
  '--user-data-dir='+path.join(require('os').tmpdir(),'probe-shot-'+Date.now()),'--allow-file-access-from-files','about:blank'],{stdio:'ignore'});
class CDP{
  constructor(u){this.ws=new WebSocket(u);this.id=0;this.p=new Map();}
  ready(){return new Promise((res,rej)=>{this.ws.onopen=res;this.ws.onerror=rej;this.ws.onmessage=m=>{const o=JSON.parse(m.data);if(o.id&&this.p.has(o.id)){this.p.get(o.id)(o);this.p.delete(o.id);}};});}
  send(method,params={}){const id=++this.id;return new Promise(res=>{this.p.set(id,res);this.ws.send(JSON.stringify({id,method,params}));});}
  async eval(e){const r=await this.send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});return r.result&&r.result.result?r.result.result.value:undefined;}
  async goto(u){await this.send('Page.navigate',{url:u});await sleep(500);}
  async shot(name){const r=await this.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    const buf=Buffer.from(r.result.data,'base64');const f=path.join(OUT,name);fs.writeFileSync(f,buf);console.log(name,buf.length+' bytes');}
  async scroll(y){await this.eval('window.scrollTo(0,'+y+')');await sleep(180);}
  async waitState(want,max=100){let s='idle';for(let i=0;i<max;i++){s=await this.eval(`document.querySelector('#dash').dataset.state`);if(s===want)break;await sleep(250);}return s;}
  async arm(script){
    await this.eval(`sessionStorage.clear();sessionStorage.setItem('probe.cfg',JSON.stringify({url:'http://127.0.0.1/lab/sqli_01.php',vulnType:'sqli',script:'${script}'}));sessionStorage.setItem('probe.pendingRun','1');`);
  }
}
(async()=>{try{
  let tg;for(let i=0;i<40;i++){try{tg=await getJSON('http://127.0.0.1:'+PORT+'/json/list');break;}catch(e){await sleep(150);}}
  const c=new CDP(tg.find(t=>t.type==='page').webSocketDebuggerUrl);await c.ready();
  await c.send('Page.enable');await c.send('Runtime.enable');
  await c.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});

  // ① 任务台（干净首屏）
  await c.goto(fileUrl('console.html'));
  await c.eval(`sessionStorage.clear();`);
  await c.goto(fileUrl('console.html'));await sleep(400);
  await c.shot('功能页-1440-v0.18-任务台.png');

  // ② 监控页空状态（无 cfg / 无 pending / 无 report）
  await c.eval(`sessionStorage.clear();`);
  await c.goto(fileUrl('monitor.html'));await sleep(400);
  await c.scroll(260);   // 让引导空态与完整态势台同框
  await c.shot('功能页-1440-v0.18-空状态.png');

  // ③ 命中态（CONVERGE_3，等价一次真实点击）
  await c.arm('CONVERGE_3');
  await c.goto(fileUrl('monitor.html'));
  console.log('命中态终态:',await c.waitState('hit'));
  await sleep(450);await c.scroll(260);await c.shot('功能页-1440-v0.18-命中态势.png');

  // ④ 防御成功 / 未检出（NO_CONVERGE 八轮全拦截）
  await c.arm('NO_CONVERGE');
  await c.goto(fileUrl('monitor.html'));
  console.log('未检出终态:',await c.waitState('nofind'));
  await sleep(450);await c.scroll(260);await c.shot('功能页-1440-v0.18-防御成功.png');

  // ⑤ 证据链（回到命中报告，重新跑一次 CONVERGE_3 以留证据）
  await c.arm('CONVERGE_3');
  await c.goto(fileUrl('monitor.html'));
  console.log('证据链前置终态:',await c.waitState('hit'));
  await c.goto(fileUrl('evidence.html'));await sleep(400);
  await c.shot('功能页-1440-v0.18-证据链.png');
}catch(e){console.error(e&&e.stack||e);process.exitCode=1;}finally{chrome.kill('SIGKILL');}})();
