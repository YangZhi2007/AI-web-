/* QA v0.19 独立验收 B（严过关 / Yan）
 * 用法：node docs/scripts/qa-v019-audit-dom.js
 * 端口 9356（避开 9333/9334/9335/9344/9355）
 * 目的：独立实测 44×44 命中 / 四档视口零溢出 + **元素 rect 越界扫描**（证伪
 *       overflow-x:clip 下 scrollWidth 可能假通过）/ 触发契约抽样 /
 *       打印与 reduced-motion / exportBtn 动态注入 / 零外部请求 / 控制台异常 0。
 * 结果：控制台摘要 + 完整 JSON 写 os.tmpdir()/qa-v019-b.json
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9356;
const WEB = 'D:\\AIBBBG\\Version1\\webapp';
const OUT = os.tmpdir();
const PAGES = ['console','monitor','evidence','report','settings','history','about'];
const VIEWPORTS = [[1440,900],[1100,900],[768,900],[390,844]];
const fileUrl = p => 'file:///' + path.join(WEB, p).replace(/\\/g, '/');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJSON = u => new Promise((res,rej)=>http.get(u,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(e)}})}).on('error',rej));

class CDP {
  constructor(u){ this.ws=new WebSocket(u); this.id=0; this.p=new Map(); this.events=[]; }
  ready(){ return new Promise((res,rej)=>{ this.ws.onopen=res; this.ws.onerror=rej; this.ws.onmessage=m=>{
    const o=JSON.parse(m.data);
    if(o.id&&this.p.has(o.id)){ this.p.get(o.id)(o); this.p.delete(o.id); }
    else if(o.method) this.events.push(o);
  }; }); }
  send(method,params={}){ const id=++this.id; return new Promise(res=>{ this.p.set(id,res); this.ws.send(JSON.stringify({id,method,params})); }); }
  async eval(e){ const r=await this.send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});
    if(r.result&&r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.text+' | EXPR: '+e.slice(0,160));
    return r.result&&r.result.result?r.result.result.value:undefined; }
  async goto(u){ await this.send('Page.navigate',{url:u}); await sleep(450); }
  async viewport(w,h){ await this.send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:false}); await sleep(140); }
}

const chrome = spawn(CHROME, ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
  '--remote-debugging-port='+PORT,'--user-data-dir='+path.join(OUT,'qa-v019-b-'+Date.now()),
  '--allow-file-access-from-files','about:blank'],{stdio:'ignore'});

(async()=>{
  const R={meta:{port:PORT,pages:PAGES,viewports:VIEWPORTS},hit44:[],viewport:[],contract:[],print:null,rm:null,exportBtn:null,net:null,errors:[]};
  let c;
  try{
    let tg; for(let i=0;i<40;i++){ try{ tg=await getJSON('http://127.0.0.1:'+PORT+'/json/list'); break; }catch(e){ await sleep(150); } }
    c=new CDP(tg.find(t=>t.type==='page').webSocketDebuggerUrl); await c.ready();
    await c.send('Page.enable'); await c.send('Runtime.enable'); await c.send('Network.enable'); await c.send('Log.enable');

    /* ===== §10 44×44 命中（7 页所有交互目标，实测 rect）===== */
    console.log('=== §10 44×44 命中实测（1440 档，遍历交互目标 rect）===');
    const HIT44=`(()=>{
      const sel='a[href],button,input,select,[role="switch"],[data-nav],.tool,.foot-links a,.mainnav a,a.brand,.sound-off';
      const seen=new Set(),out=[];
      document.querySelectorAll(sel).forEach(el=>{
        if(seen.has(el))return;seen.add(el);
        const cs=getComputedStyle(el),r=el.getBoundingClientRect();
        const name=(el.id?'#'+el.id:el.tagName.toLowerCase()+(el.className&&typeof el.className==='string'?'.'+el.className.trim().split(/\\s+/).slice(0,2).join('.'):''));
        out.push({name,tag:el.tagName,text:(el.textContent||'').trim().slice(0,14),
          w:Math.round(r.width),h:Math.round(r.height),
          display:cs.display,visibility:cs.visibility,opacity:cs.opacity,
          hidden:cs.display==='none'||cs.visibility==='hidden'||parseFloat(cs.opacity)===0||(r.width===0&&r.height===0),
          ariaHidden:el.getAttribute('aria-hidden'),tabindex:el.getAttribute('tabindex')});
      });
      return out;
    })()`;
    for(const p of PAGES){
      await c.viewport(1440,900);
      await c.goto(fileUrl(p+'.html'));
      const list=await c.eval(HIT44);
      const visible=list.filter(x=>!x.hidden);
      const under=visible.filter(x=>x.w<44||x.h<44);
      R.hit44.push({page:p,total:list.length,visible:visible.length,under44:under,all:list});
      console.log('  '+p.padEnd(9)+' 交互目标 '+list.length+' / 可见 '+visible.length+
        ' / <44px '+under.length+(under.length?' → '+JSON.stringify(under.slice(0,6)):''));
    }
    /* 特例专项：monitor 内联 min-height:36px 的 btn-ghost、#cancelBtn.hidden、复选框、页脚锚点、#soundOffBtn */
    console.log('  --- 特例专项 ---');
    await c.goto(fileUrl('monitor.html'));
    const ghost=await c.eval(`(()=>{const a=[...document.querySelectorAll('.btn-ghost')].find(e=>e.getAttribute('style')&&e.getAttribute('style').indexOf('min-height')>=0);
      if(!a)return null;const r=a.getBoundingClientRect(),cs=getComputedStyle(a);
      return {inline:a.getAttribute('style'),computedMinHeight:cs.minHeight,h:Math.round(r.height),w:Math.round(r.width)};})()`);
    console.log('  monitor.html:161 内联 min-height:36px → '+JSON.stringify(ghost));
    R.ghost=ghost;
    await c.goto(fileUrl('console.html'));
    const specials=await c.eval(`(()=>{
      const g=s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect(),cs=getComputedStyle(e);
        return {sel:s,w:Math.round(r.width),h:Math.round(r.height),display:cs.display,visibility:cs.visibility,
          opacity:cs.opacity,position:cs.position,hiddenClass:e.classList.contains('hidden')};};
      return [g('#cancelBtn'),g('#authChk'),g('#soundOffBtn'),g('.foot-links a'),g('#startBtn'),g('#runLink')];
    })()`);
    R.specials=specials;
    specials.forEach(s=>console.log('  '+(s?JSON.stringify(s):'null')));

    /* ===== §11 四档视口：scrollWidth + **rect 越界扫描**（证伪 clip 假通过）===== */
    console.log('=== §11 四档视口：scrollWidth 与元素 rect 越界扫描 ===');
    const OVERFLOW=`(()=>{
      const cw=document.documentElement.clientWidth;
      const sw=document.documentElement.scrollWidth;
      const bodySw=document.body.scrollWidth;
      const over=[],scrollable=[];
      const inScrollable=el=>{let e=el.parentElement;while(e){const o=getComputedStyle(e).overflowX;
        if(o==='auto'||o==='scroll')return e.tagName.toLowerCase()+'.'+(typeof e.className==='string'?e.className.trim().split(/\\s+/)[0]:'');
        e=e.parentElement;}return null;};
      document.querySelectorAll('body *').forEach(el=>{
        if(el.closest('svg')||el.tagName==='SCRIPT'||el.tagName==='STYLE')return;
        const cs=getComputedStyle(el),r=el.getBoundingClientRect();
        if(cs.display==='none'||cs.visibility==='hidden'||parseFloat(cs.opacity)===0||cs.position==='fixed')return;
        if(r.width===0&&r.height===0)return;
        if(r.right>cw+1||r.left<-1){
          const item={tag:el.tagName.toLowerCase(),
            cls:(typeof el.className==='string'?el.className.trim().slice(0,30):''),
            id:el.id||'',left:Math.round(r.left),right:Math.round(r.right),w:Math.round(r.width),
            text:(el.textContent||'').trim().slice(0,18)};
          const s=inScrollable(el);
          if(s){item.scrollableAncestor=s;scrollable.push(item);}else over.push(item);
        }
      });
      const nav=document.querySelector('.mainnav');
      const navInfo=nav?{sw:nav.scrollWidth,cw:nav.clientWidth,overflowX:getComputedStyle(nav).overflowX}:null;
      const keyRects=['.page-no','.sit__label','#sitFlowMeta','.btn-solid','.btn-ghost','.stage-tag','.foot-links a','.wrap']
        .map(s=>{const e=document.querySelector(s);if(!e)return {sel:s,exists:false};
          const r=e.getBoundingClientRect(),cs=getComputedStyle(e);
          return {sel:s,exists:true,right:Math.round(r.right),w:Math.round(r.width),display:cs.display};});
      return {cw,sw,bodySw,over:over.slice(0,14),overCount:over.length,
        scrollable:scrollable.slice(0,8),scrollableCount:scrollable.length,navInfo,keyRects};
    })()`;
    for(const [w,h] of VIEWPORTS){
      for(const p of PAGES){
        await c.viewport(w,h);
        await c.goto(fileUrl(p+'.html'));
        const v=await c.eval(OVERFLOW);
        R.viewport.push({w,h,page:p,...v});
        const bad=v.sw>v.cw+1;
        if(bad||v.overCount>0||w===768||w===390){
          console.log('  '+w+'×'+h+' '+p.padEnd(9)+' scrollW='+v.sw+'/'+v.cw+
            ' bodySw='+v.bodySw+' scroll溢出='+bad+
            ' rect越界(非滚动容器)='+v.overCount+' 滚动容器内='+v.scrollableCount+
            (v.overCount?' → '+JSON.stringify(v.over.slice(0,3)):''));
        }
      }
      const row=R.viewport.filter(x=>x.w===w);
      console.log('  ['+w+'] 汇总: scrollWidth 违规 '+row.filter(x=>x.sw>x.cw+1).length+
        ' / rect 越界页 '+row.filter(x=>x.overCount>0).length+
        ' / 滚动容器内元素 '+row.reduce((a,x)=>a+x.scrollableCount,0));
    }

    /* ===== §12 触发契约抽样（独立复核，不依赖既有 harness）===== */
    console.log('=== §12 触发契约抽样 ===');
    const reset=()=>c.eval(`['probe.cfg','probe.report','probe.history','probe.pendingRun'].forEach(k=>{try{sessionStorage.removeItem(k)}catch(e){}})`);
    const runTo=async(url,max=80)=>{
      await c.eval(`sessionStorage.setItem('probe.pendingRun','1');sessionStorage.setItem('probe.cfg',`+
        `JSON.stringify({url:${JSON.stringify(url)},agent:true,script:'AGENT_LOOP'}))`);
      await c.goto(fileUrl('monitor.html'));
      let s='idle';
      for(let i=0;i<max;i++){ s=await c.eval(`document.querySelector('#dash').dataset.state`);
        if(['hit','nofind','degraded','oos','cancel','error'].includes(s))break; await sleep(250); }
      return s;
    };
    await c.viewport(1440,900);
    await c.goto(fileUrl('monitor.html')); await reset();
    await c.goto(fileUrl('monitor.html'));
    const empty=await c.eval(`(()=>({state:document.querySelector('#dash').dataset.state,
      report:!!sessionStorage.getItem('probe.report'),hist:JSON.parse(sessionStorage.getItem('probe.history')||'[]').length}))()`);
    R.contract.push({case:'空 Store 直接进 monitor',...empty});
    console.log('  空 Store 进 monitor: '+JSON.stringify(empty));
    await c.goto(fileUrl('console.html')); await reset();
    await c.goto(fileUrl('monitor.html'));
    const cfgOnly=await c.eval(`(()=>{sessionStorage.setItem('probe.cfg',JSON.stringify({url:'http://127.0.0.1/lab/x',agent:true,script:'AGENT_LOOP'}));return 1})()`);
    await c.goto(fileUrl('monitor.html'));
    const cfg=await c.eval(`(()=>({state:document.querySelector('#dash').dataset.state,
      report:!!sessionStorage.getItem('probe.report'),target:document.querySelector('#mTarget').textContent}))()`);
    R.contract.push({case:'仅残留 probe.cfg',...cfg});
    console.log('  仅残留 cfg: '+JSON.stringify(cfg));
    const deg=await runTo('http://127.0.0.1/lab/trap/x');
    R.contract.push({case:'诱导靶场（降级+误报）',state:deg});
    console.log('  诱导靶场 → '+deg);
    const oos=await runTo('https://example.com/x');
    R.contract.push({case:'越界目标',state:oos});
    console.log('  越界 → '+oos);
    const nf=await runTo('http://127.0.0.1/lab/hard/x');
    R.contract.push({case:'加固靶场（打不穿）',state:nf});
    console.log('  加固靶场 → '+nf);
    /* 真实点击一次到 hit + 刷新不重跑 */
    await c.goto(fileUrl('console.html')); await reset();
    await c.goto(fileUrl('console.html'));
    await c.eval(`document.querySelector('#urlInput').value='http://127.0.0.1/lab/sqli_01.php';
      if(!document.querySelector('#authChk').checked)document.querySelector('#authChk').click();`);
    const before=await c.eval(`({disabled:document.querySelector('#startBtn').disabled,pending:sessionStorage.getItem('probe.pendingRun')})`);
    await c.eval(`document.querySelector('#startBtn').click()`);
    for(let i=0;i<40;i++){ const pg=await c.eval(`document.body.getAttribute('data-page')`); if(pg==='monitor')break; await sleep(150); }
    let hit='idle';
    for(let i=0;i<80;i++){ hit=await c.eval(`document.querySelector('#dash').dataset.state`);
      if(['hit','nofind','degraded','oos','cancel','error'].includes(hit))break; await sleep(250); }
    const hist1=await c.eval(`JSON.parse(sessionStorage.getItem('probe.history')||'[]').length`);
    await c.goto(fileUrl('monitor.html'));
    const hist2=await c.eval(`JSON.parse(sessionStorage.getItem('probe.history')||'[]').length`);
    R.contract.push({case:'真实点击 #startBtn → 一次 hit → 刷新不重跑',before,hit,hist1,hist2});
    console.log('  真实点击: '+JSON.stringify({before,hit,hist1,hist2}));

    /* ===== §13 打印 / reduced-motion / exportBtn 动态注入 ===== */
    console.log('=== §13 打印 / RM / exportBtn ===');
    await c.viewport(1440,900);
    await c.goto(fileUrl('report.html'));
    await c.send('Emulation.setEmulatedMedia',{media:'print'});
    R.print=await c.eval(`(()=>{
      const g=s=>{const e=document.querySelector(s);return e?getComputedStyle(e).display:'MISSING'};
      return {topbar:g('.topbar'),footer:g('footer'),reportCard:g('#reportCard'),reportSection:g('#reportSection'),
        secs:document.querySelectorAll('#reportCard .report-sec').length,
        bodyBg:getComputedStyle(document.body).backgroundColor,
        bodyColor:getComputedStyle(document.body).color,
        detailsPre:[...document.querySelectorAll('details.raw pre')].map(e=>getComputedStyle(e).display),
        exportBtnInPrint:g('#exportBtn')};
    })()`);
    console.log('  打印: '+JSON.stringify(R.print));
    await c.send('Emulation.setEmulatedMedia',{media:''});
    R.exportBtn=await c.eval(`(()=>({inDom:!!document.querySelector('#exportBtn'),
      staticInHtml:document.documentElement.outerHTML.indexOf('id="exportBtn"')>=0,
      secs:document.querySelectorAll('#reportCard .report-sec').length}))()`);
    /* 静态检查：直接读磁盘 HTML 源码里有无 id="exportBtn" */
    const htmlSrc=fs.readFileSync(path.join(WEB,'report.html'),'utf8');
    R.exportBtn.staticSourceHasId=/id=["']exportBtn["']/.test(htmlSrc);
    console.log('  exportBtn: '+JSON.stringify(R.exportBtn));
    await c.send('Emulation.setEmulatedMedia',{media:'screen',features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await c.eval(`sessionStorage.setItem('probe.pendingRun','1');sessionStorage.setItem('probe.cfg',JSON.stringify({url:'http://127.0.0.1/lab/x',vulnType:'sqli',script:'CONVERGE_3'}))`);
    await c.goto(fileUrl('monitor.html'));
    for(let i=0;i<80;i++){ const s=await c.eval(`document.querySelector('#dash').dataset.state`);
      if(['hit','nofind','degraded','oos','cancel','error'].includes(s))break; await sleep(200); }
    R.rm=await c.eval(`(()=>({spin:getComputedStyle(document.querySelector('.spin')).animationName,
      lit:[...document.querySelectorAll('.sit__node.is-lit')].length,
      keyPath:getComputedStyle(document.querySelector('.sit__path--key')).opacity,
      state:document.querySelector('#dash').dataset.state,
      barrierDash:getComputedStyle(document.querySelector('.sit__barrier')).strokeDasharray}))()`);
    console.log('  RM: '+JSON.stringify(R.rm));
    await c.send('Emulation.setEmulatedMedia',{media:'',features:[]});

    /* ===== §14 零外部请求 / 控制台异常 ===== */
    const ext=c.events.filter(e=>e.method==='Network.requestWillBeSent')
      .map(e=>e.params.request.url).filter(u=>/^https?:/.test(u)&&!/127\.0\.0\.1:9356/.test(u));
    const exc=c.events.filter(e=>e.method==='Runtime.exceptionThrown').map(e=>e.params.exceptionDetails.text);
    const logErr=c.events.filter(e=>e.method==='Log.entryAdded'&&e.params.entry.level==='error').map(e=>e.params.entry.text);
    R.net={external:ext,exceptions:exc,logErrors:logErr};
    console.log('=== §14 外部请求 '+ext.length+' · 控制台异常 '+exc.length+' · Log error '+logErr.length+' ===');
    if(ext.length)console.log('  '+ext.slice(0,5).join('\n  '));
    if(exc.length)console.log('  '+exc.slice(0,5).join('\n  '));
    if(logErr.length)console.log('  '+logErr.slice(0,5).join('\n  '));

  }catch(e){ R.errors.push(String(e&&e.stack||e)); console.error('[ERROR] '+(e&&e.stack||e)); }
  finally{
    try{ chrome.kill('SIGKILL'); }catch(e){}
    fs.writeFileSync(path.join(OUT,'qa-v019-b.json'),JSON.stringify(R,null,2));
    console.log('\n完整结果 → '+path.join(OUT,'qa-v019-b.json'));
  }
})();
