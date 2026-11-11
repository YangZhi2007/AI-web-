/* v0.18 视觉规格核验 · 可复跑
 * 用法：node docs/scripts/v018-visual-spec-check.js
 * 覆盖：① 7 个页面全部可见文本节点的 WCAG 对比度（逐层背景合成实算）
 *       ② 1440 / 1100 / 768 / 390 四档视口无横向溢出
 *       ③ 正文级最小字号（≥11px）
 * 依赖：本机 Chrome + Node 22 全局 WebSocket，零 npm 依赖、零外部请求。 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9335, WEB = 'D:\\AIBBBG\\Version1\\webapp';
const PAGES = ['console','monitor','evidence','report','settings','history','about'];
const VIEWPORTS = [[1440,900],[1100,900],[768,900],[390,844]];
const fileUrl = p => 'file:///' + path.join(WEB, p).replace(/\\/g, '/');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJSON = u => new Promise((res, rej) => http.get(u, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{try{res(JSON.parse(d));}catch(e){rej(e);}}); }).on('error',rej));
const chrome = spawn(CHROME, ['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port='+PORT,
  '--user-data-dir='+path.join(require('os').tmpdir(),'probe-spec-'+Date.now()),'--allow-file-access-from-files','about:blank'],{stdio:'ignore'});

class CDP{
  constructor(u){this.ws=new WebSocket(u);this.id=0;this.p=new Map();}
  ready(){return new Promise((res,rej)=>{this.ws.onopen=res;this.ws.onerror=rej;this.ws.onmessage=m=>{const o=JSON.parse(m.data);if(o.id&&this.p.has(o.id)){this.p.get(o.id)(o);this.p.delete(o.id);}};});}
  send(method,params={}){const id=++this.id;return new Promise(res=>{this.p.set(id,res);this.ws.send(JSON.stringify({id,method,params}));});}
  async eval(e){const r=await this.send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});if(r.result&&r.result.exceptionDetails)throw new Error(r.result.exceptionDetails.text);return r.result&&r.result.result?r.result.result.value:undefined;}
  async goto(u){await this.send('Page.navigate',{url:u});await sleep(420);}
  async viewport(w,h){await this.send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:false});await sleep(120);}
}

/* 在页面内执行：逐层背景合成 + WCAG 相对亮度实算，遍历所有可见文本节点 */
const SCAN = `(()=>{
  const parse=c=>{const m=(String(c).match(/[\\d.]+/g)||[]).map(Number);return {r:m[0]||0,g:m[1]||0,b:m[2]||0,a:m.length>3?m[3]:1};};
  const over=(f,b)=>({r:f.r*f.a+b.r*(1-f.a),g:f.g*f.a+b.g*(1-f.a),b:f.b*f.a+b.b*(1-f.a),a:1});
  const bgOf=el=>{const stack=[];let e=el;while(e){const c=parse(getComputedStyle(e).backgroundColor);if(c.a>0)stack.push(c);e=e.parentElement;}
    let b={r:255,g:255,b:255,a:1};for(let i=stack.length-1;i>=0;i--)b=over(stack[i],b);return b;};
  const lum=c=>{const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b);};
  const cr=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);};
  const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  const bad=[],sizes=[];let n,count=0,min=99;
  while((n=w.nextNode())){
    const t=n.textContent.trim();if(!t)continue;
    const p=n.parentElement;if(!p)continue;
    const cs=getComputedStyle(p);
    if(cs.display==='none'||cs.visibility==='hidden'||parseFloat(cs.opacity)===0)continue;
    const r=p.getBoundingClientRect();if(r.width===0&&r.height===0)continue;
    const fg=parse(cs.color),bg=bgOf(p),eff=fg.a<1?over(fg,bg):fg;
    const ratio=cr(eff,bg),size=parseFloat(cs.fontSize),weight=parseInt(cs.fontWeight)||400;
    const large=size>=24||(size>=18.66&&weight>=700),need=large?3:4.5;
    count++;if(ratio<min)min=ratio;sizes.push(size);
    if(ratio<need)bad.push({t:t.slice(0,36),ratio:+ratio.toFixed(2),size:size,color:cs.color});
  }
  return {count:count,min:+min.toFixed(2),minSize:Math.min.apply(null,sizes),badCount:bad.length,bad:bad.slice(0,12)};
})()`;

(async()=>{try{
  let tg;for(let i=0;i<40;i++){try{tg=await getJSON('http://127.0.0.1:'+PORT+'/json/list');break;}catch(e){await sleep(150);}}
  const c=new CDP(tg.find(t=>t.type==='page').webSocketDebuggerUrl);await c.ready();
  await c.send('Page.enable');await c.send('Runtime.enable');
  let fails=0, globalMin=99, globalMinSize=99;

  console.log('=== ① 正文级 WCAG 对比度（1440 档，逐层背景合成实算）===');
  for(const p of PAGES){
    await c.viewport(1440,900);
    await c.goto(fileUrl(p+'.html'));
    const r=await c.eval(SCAN);
    globalMin=Math.min(globalMin,r.min);globalMinSize=Math.min(globalMinSize,r.minSize);
    const flag=r.badCount===0?'PASS':'FAIL';if(r.badCount)fails+=r.badCount;
    console.log('['+flag+'] '+p.padEnd(9)+' 文本节点 '+String(r.count).padStart(3)+
      ' · 最低 '+r.min+':1 · 最小字号 '+r.minSize+'px · 未达标 '+r.badCount);
    if(r.badCount)console.log('        '+JSON.stringify(r.bad));
  }
  console.log('全站最低对比度: '+globalMin+':1  |  全站最小字号: '+globalMinSize+'px');
  console.log((globalMin>=4.5?'[PASS]':'[FAIL]')+' 正文级对比度 ≥4.5:1');
  console.log((globalMinSize>=11?'[PASS]':'[FAIL]')+' 正文级最小字号 ≥11px');
  if(globalMin<4.5)fails++;if(globalMinSize<11)fails++;

  console.log('');
  console.log('=== ② 四档视口无横向溢出 ===');
  for(const [w,h] of VIEWPORTS){
    let bad=[];
    for(const p of PAGES){
      await c.viewport(w,h);
      await c.goto(fileUrl(p+'.html'));
      const r=await c.eval(`(()=>{const d=document.documentElement;return {sw:d.scrollWidth,cw:d.clientWidth};})()`);
      if(r.sw>r.cw+1)bad.push(p+':'+r.sw+'/'+r.cw);
    }
    const flag=bad.length===0?'PASS':'FAIL';if(bad.length)fails+=bad.length;
    console.log('['+flag+'] '+w+'×'+h+' · 7 页 · 违规 '+bad.length+(bad.length?' → '+bad.join(' '):''));
  }

  console.log('');
  console.log('========================================');
  console.log('规格核验：'+(fails===0?'全部通过':'未通过项 '+fails));
  console.log('========================================');
  if(fails)process.exitCode=1;
}catch(e){console.error(e&&e.stack||e);process.exitCode=1;}finally{chrome.kill('SIGKILL');}})();
