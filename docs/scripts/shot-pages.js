/* v0.17 视觉存档截图：任务台亮底 / 监控命中态 / 证据链 */
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
}
(async()=>{try{
  let tg;for(let i=0;i<40;i++){try{tg=await getJSON('http://127.0.0.1:'+PORT+'/json/list');break;}catch(e){await sleep(150);}}
  const c=new CDP(tg.find(t=>t.type==='page').webSocketDebuggerUrl);await c.ready();
  await c.send('Page.enable');await c.send('Runtime.enable');
  await c.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  // 任务台（先清 Store 保证干净首屏）
  await c.goto(fileUrl('console.html'));
  await c.eval(`sessionStorage.clear();`);
  await c.goto(fileUrl('console.html'));await sleep(300);
  await c.shot('功能页-1440-v0.17-任务台.png');
  // 监控命中态
  await c.eval(`sessionStorage.setItem('probe.cfg',JSON.stringify({url:'http://127.0.0.1/lab/sqli_01.php',vulnType:'sqli',script:'CONVERGE_3'}));`);
  await c.goto(fileUrl('monitor.html'));
  let st='idle';for(let i=0;i<80;i++){st=await c.eval(`document.querySelector('#dash').dataset.state`);if(st==='hit')break;await sleep(250);}
  await sleep(450);await c.shot('功能页-1440-v0.17-命中态势.png');
  // 证据链
  await c.goto(fileUrl('evidence.html'));await sleep(300);
  await c.shot('功能页-1440-v0.17-证据链.png');
}catch(e){console.error(e&&e.stack||e);process.exitCode=1;}finally{chrome.kill('SIGKILL');}})();
