/* QA v0.19 独立验收 A（严过关 / Yan）
 * 用法：node docs/scripts/qa-v019-audit-color.js
 * 端口 9355（避开 e2e 9333 / shot 9334 / spec 9335 / qa 9344）
 * 目的：不复用既有断言，独立实取色板 / 真实合成对比度（含 opacity 链）/
 *       逐页 --key 真实渲染引用点 / 设计语言规格 / 亮底态势台连锁 /
 *       8 态形状色可见性 + 灰度截图 / 四段拓扑结构 / flowMeta 不截断。
 * 结果：控制台精简摘要 + 完整 JSON 写 os.tmpdir()/qa-v019-a.json
 * 依赖：Node 22 全局 WebSocket + 本机 Chrome，零 npm 依赖、零外部请求。
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9355;
const WEB = 'D:\\AIBBBG\\Version1\\webapp';
const OUT = os.tmpdir();
const PAGES = ['console','monitor','evidence','report','settings','history','about'];
const HOME = { accent:'#c8f560', accent2:'#4fe3d0', danger:'#ff6b6b', warn:'#f5c451',
  r:'12px', rSm:'8px', rPill:'9999px',
  ease:'cubic-bezier(0.16, 1, 0.3, 1)', ease2:'cubic-bezier(0.45, 0, 0.1, 1)',
  dFast:'0.16s', d:'0.5s', dSlow:'1s', dLoop:'22s' };
const BAN = ['#edf1f3','#f8fafb','#e6ecef','#e1e8eb','#101c24','#40525e','#536773',
  '#2a6c7e','#1b4c5a','#0a1218','#14222b','#0a0c0f'];
const fileUrl = p => 'file:///' + path.join(WEB, p).replace(/\\/g, '/');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJSON = u => new Promise((res, rej) => http.get(u, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(e)}}); }).on('error',rej));

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
  async viewport(w,h){ await this.send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:false}); await sleep(120); }
}

/* 页面内公共库：rgba 解析 / 逐层背景合成 / 祖先 opacity 链 / 真实合成 WCAG 对比度 */
const LIB = String.raw`
const parse=c=>{const m=(String(c).match(/[\d.]+/g)||[]).map(Number);return {r:m[0]||0,g:m[1]||0,b:m[2]||0,a:m.length>3?m[3]:1}};
const over=(f,b)=>({r:f.r*f.a+b.r*(1-f.a),g:f.g*f.a+b.g*(1-f.a),b:f.b*f.a+b.b*(1-f.a),a:1});
const lum=c=>{const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)};return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b)};
const cr=(a,b)=>{const x=lum(a),y=lum(b);return +((Math.max(x,y)+0.05)/(Math.min(x,y)+0.05)).toFixed(2)};
const parentBg=el=>{const st=[];let e=el;while(e){const c=parse(getComputedStyle(e).backgroundColor);if(c.a>0)st.push(c);e=e.parentElement}let b={r:255,g:255,b:255,a:1};for(let i=st.length-1;i>=0;i--)b=over(st[i],b);return b};
const chainOpacity=el=>{let a=1,e=el;while(e&&e.nodeType===1){a*=parseFloat(getComputedStyle(e).opacity||'1');e=e.parentElement}return a};
const effContrast=el=>{
  if(!el)return null;
  const P=parentBg(el.parentElement);
  const own=parse(getComputedStyle(el).backgroundColor);
  const bg=over(own,P);
  const fg0=parse(getComputedStyle(el).color);
  const fg=fg0.a<1?over(fg0,bg):fg0;
  const a=chainOpacity(el);
  const mix=x=>({r:a*x.r+(1-a)*P.r,g:a*x.g+(1-a)*P.g,b:a*x.b+(1-a)*P.b,a:1});
  return {ratio:cr(mix(fg),mix(bg)),raw:cr(fg,bg),opacity:+a.toFixed(3),fg:getComputedStyle(el).color,bg:getComputedStyle(el).backgroundColor,parentBg:'rgb('+[P.r,P.g,P.b].map(Math.round).join(',')+')'};
};
const rgb2hex=s=>{const m=(String(s).match(/[\d.]+/g)||[]).map(Number);if(m.length<3)return String(s);return '#'+m.slice(0,3).map(v=>Math.round(v).toString(16).padStart(2,'0')).join('')};
const chroma=s=>{const a=(String(s).match(/[\d.]+/g)||[]).slice(0,3).map(Number);return a.length<3?0:+((Math.max.apply(null,a)-Math.min.apply(null,a))/255).toFixed(3)};
`;

const chrome = spawn(CHROME, ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
  '--remote-debugging-port='+PORT,'--user-data-dir='+path.join(OUT,'qa-v019-a-'+Date.now()),
  '--allow-file-access-from-files','about:blank'],{stdio:'ignore'});

(async()=>{
  const R={meta:{port:PORT,home:HOME,ban:BAN,pages:PAGES},tokens:[],keyRefs:[],design:null,buttons:[],dash:[],reportRaw:[],states:[],topo:null,flowMeta:null,errors:[]};
  let c;
  try{
    let tg; for(let i=0;i<40;i++){ try{ tg=await getJSON('http://127.0.0.1:'+PORT+'/json/list'); break; }catch(e){ await sleep(150); } }
    c=new CDP(tg.find(t=>t.type==='page').webSocketDebuggerUrl); await c.ready();
    await c.send('Page.enable'); await c.send('Runtime.enable'); await c.send('Network.enable'); await c.send('Log.enable');

    /* ===== §1 逐页 :root 四强调 + --key + 表面/文字实取 ===== */
    console.log('=== §1 逐页 token 实取（对照主页 index.css:13-20）===');
    for(const p of PAGES){
      await c.viewport(1440,900);
      await c.goto(fileUrl(p+'.html'));
      const t=await c.eval(`(()=>{ ${LIB}
        const root=getComputedStyle(document.documentElement),tok=n=>root.getPropertyValue(n).trim();
        const probe=n=>{const x=document.createElement('span');x.style.color='var('+n+')';document.body.appendChild(x);const v=getComputedStyle(x).color;x.remove();return v};
        const b=getComputedStyle(document.body),card=document.querySelector('.card');
        return {page:document.body.getAttribute('data-page'),
          accent:tok('--accent'),accent2:tok('--accent-2'),danger:tok('--danger'),warn:tok('--warn'),
          accentInk:tok('--accent-ink'),sitBg:tok('--sit-bg'),sitCut:tok('--sit-cut'),
          keyRaw:tok('--key'),keyRGB:probe('--key'),keyHex:rgb2hex(probe('--key')),keyChroma:chroma(probe('--key')),
          bodyBg:b.backgroundColor,bodyBgHex:rgb2hex(b.backgroundColor),bodyChroma:chroma(b.backgroundColor),
          bodyColor:b.color,bodyColorHex:rgb2hex(b.color),
          cardBg:card?getComputedStyle(card).backgroundColor:'N/A',cardBgHex:card?rgb2hex(getComputedStyle(card).backgroundColor):'N/A',
          cardColor:card?getComputedStyle(card).color:'N/A',cardColorHex:card?rgb2hex(getComputedStyle(card).color):'N/A',
          sitBgRGB:probe('--sit-bg'),sitCutRGB:probe('--sit-cut')};
      })()`);
      R.tokens.push(t);
      const colorOK = t.accent.toLowerCase()===HOME.accent && t.accent2.toLowerCase()===HOME.accent2 &&
        t.danger.toLowerCase()===HOME.danger && t.warn.toLowerCase()===HOME.warn;
      const banHit=['bodyBgHex','cardBgHex','bodyColorHex','cardColorHex'].filter(k=>BAN.includes(String(t[k]).toLowerCase()));
      console.log('  '+p.padEnd(9)+' 四强调'+(colorOK?'OK':'**MISMATCH**')+
        ' ['+[t.accent,t.accent2,t.danger,t.warn].join(' ')+']'+
        ' key='+t.keyHex+' chroma='+t.keyChroma+' bodyBg='+t.bodyBgHex+' cardBg='+t.cardBgHex+
        ' 禁用色命中='+(banHit.length?banHit.join(','):'无'));
      t.colorOK=colorOK; t.banHit=banHit;
    }
    const keys=R.tokens.map(t=>t.keyRGB);
    console.log('  → 7 页 --key 互异: '+(new Set(keys).size===7)+' | 全部 chroma>0.45: '+R.tokens.every(t=>t.keyChroma>0.45));

    /* ===== §2 var(--key) 真实可见引用点 ===== */
    console.log('=== §2 var(--key) 真实渲染引用点（非仅 :root 定义）===');
    const KEYREF=`(()=>{ ${LIB}
      const pr=document.createElement('span');pr.style.color='var(--key)';document.body.appendChild(pr);
      const key=getComputedStyle(pr).color;pr.remove();
      const vis=el=>{if(!el)return false;const cs=getComputedStyle(el),r=el.getBoundingClientRect();
        return cs.display!=='none'&&cs.visibility!=='hidden'&&parseFloat(cs.opacity)>0&&(r.width>0||r.height>0)};
      const picks=[['.page-title .dash','','backgroundColor'],['.page-no','','backgroundColor'],
        ['.card--key','','borderLeftColor'],['.card-title','::before','backgroundColor'],
        ['.stage-tag--key','','backgroundColor'],['.run-panel','','borderLeftColor'],
        ['.bar i','','backgroundColor'],['.thinking i','','backgroundColor'],
        ['.metrics>div','::after','backgroundColor'],['.kpi','','borderTopColor'],
        ['.report-sec h3','','borderLeftColor'],['.evidence','','borderLeftColor'],
        ['.card[style*="border-left"]','','borderLeftColor']];
      const hits=[];
      for(const [sel,pseudo,prop] of picks){
        const el=document.querySelector(sel);if(!el)continue;
        const cs=getComputedStyle(el,pseudo||undefined);
        if(cs[prop]===key){const r=el.getBoundingClientRect();
          hits.push({sel:sel+(pseudo||''),prop,val:cs[prop],visible:vis(el),rect:[Math.round(r.width),Math.round(r.height)]});}
      }
      return {page:document.body.getAttribute('data-page'),key,keyHex:rgb2hex(key),hits};
    })()`;
    for(const p of PAGES){
      await c.goto(fileUrl(p+'.html'));
      const k=await c.eval(KEYREF); R.keyRefs.push(k);
      console.log('  '+p.padEnd(9)+' key='+k.keyHex+' 命中引用点 '+k.hits.length+
        (k.hits.length?' → '+k.hits.slice(0,4).map(h=>h.sel+':'+h.prop+(h.visible?'[可见]':'[不可见]')).join(' , '):''));
    }

    /* ===== §3 设计语言对齐（实取 CSS 值 vs 主页 .btn）===== */
    console.log('=== §3 设计语言对齐实取 ===');
    await c.goto(fileUrl('console.html'));
    R.design=await c.eval(`(()=>{ ${LIB}
      const b=document.querySelector('#startBtn'),cs=getComputedStyle(b);
      const lbl=document.querySelector('.lbl'),eb=document.querySelector('.eyebrow');
      const L=lbl?getComputedStyle(lbl):null,E=eb?getComputedStyle(eb):null;
      const brand=document.querySelector('.brand i'),B=brand?getComputedStyle(brand):null;
      let fv=[];
      for(const sh of document.styleSheets){try{for(const r of sh.cssRules){
        if(r.selectorText&&r.selectorText.indexOf(':focus-visible')>=0)
          fv.push({sel:r.selectorText,outline:r.style.outline,offset:r.style.outlineOffset});
      }}catch(e){}}
      const tok=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
      return {btn:{minHeight:cs.minHeight,padding:cs.padding,borderRadius:cs.borderRadius,
          fontFamily:cs.fontFamily,fontSize:cs.fontSize,fontWeight:cs.fontWeight,letterSpacing:cs.letterSpacing,
          background:cs.backgroundColor,color:cs.color},
        lbl:L?{fontSize:L.fontSize,letterSpacing:L.letterSpacing,textTransform:L.textTransform,fontFamily:L.fontFamily,color:L.color}:null,
        eyebrow:E?{fontSize:E.fontSize,letterSpacing:E.letterSpacing,textTransform:E.textTransform,fontFamily:E.fontFamily}:null,
        brand:B?{width:B.width,height:B.height,borderRadius:B.borderRadius,background:B.backgroundColor}:null,
        focusVisible:fv,
        tokens:{r:tok('--r'),rSm:tok('--r-sm'),rPill:tok('--r-pill'),ease:tok('--ease'),ease2:tok('--ease-2'),
          dFast:tok('--d-fast'),d:tok('--d'),dSlow:tok('--d-slow'),dLoop:tok('--d-loop'),
          display:tok('--display'),mono:tok('--mono'),accent:tok('--accent')}};
    })()`);
    console.log('  .btn-solid: '+JSON.stringify(R.design.btn));
    console.log('  .lbl: '+JSON.stringify(R.design.lbl));
    console.log('  .eyebrow: '+JSON.stringify(R.design.eyebrow));
    console.log('  .brand i: '+JSON.stringify(R.design.brand));
    console.log('  :focus-visible 规则: '+JSON.stringify(R.design.focusVisible));
    console.log('  token: '+JSON.stringify(R.design.tokens));

    /* ===== §4 启用态按钮真实合成对比度（含 opacity 链） ===== */
    console.log('=== §4 启用态按钮真实合成对比度（含 opacity，证伪 15.56:1）===');
    await c.goto(fileUrl('console.html'));
    await c.eval(`['probe.cfg','probe.report','probe.history','probe.pendingRun'].forEach(k=>{try{sessionStorage.removeItem(k)}catch(e){}})`);
    const BTN=label=>`(()=>{ ${LIB}
      const b=document.querySelector('#startBtn'),cs=getComputedStyle(b),r=b.getBoundingClientRect();
      return {label:${JSON.stringify(label)},disabled:b.disabled,opacityAttr:b.getAttribute('style')||'',
        visible:cs.display!=='none'&&cs.visibility!=='hidden'&&r.width>0&&r.height>0,
        rect:[Math.round(r.width),Math.round(r.height)],...effContrast(b)};
    })()`;
    R.buttons.push(await c.eval(BTN('console 未勾选授权（disabled）')));
    await c.eval(`document.querySelector('#authChk').click()`);
    R.buttons.push(await c.eval(BTN('console 勾选授权后（enabled）')));
    for(const p of ['monitor','evidence','report']){
      await c.goto(fileUrl(p+'.html'));
      const rs=await c.eval(`(()=>{ ${LIB}
        return [...document.querySelectorAll('.btn-solid,.btn-grad')].map((b,i)=>{
          const cs=getComputedStyle(b),r=b.getBoundingClientRect();
          return {label:'${p}#'+i,disabled:b.disabled===true,
            visible:cs.display!=='none'&&cs.visibility!=='hidden'&&r.width>0&&r.height>0,
            text:b.textContent.trim().slice(0,16),rect:[Math.round(r.width),Math.round(r.height)],...effContrast(b)};
        });
      })()`);
      R.buttons.push(...rs);
    }
    R.buttons.forEach(b=>console.log('  '+String(b.label).padEnd(30)+' disabled='+b.disabled+
      ' 可见='+b.visible+' opacity='+b.opacity+' 理论='+b.raw+':1 真实合成='+b.ratio+':1'+
      ' fg='+b.fg+' bg='+b.bg+' 父底='+b.parentBg));

    /* ===== §5 触发 hit 终态 + 亮底态势台 35 处连锁对比度 ===== */
    console.log('=== §5 亮底态势台连锁：逐层背景 + opacity 实算 WCAG ===');
    await c.eval(`sessionStorage.clear();sessionStorage.setItem('probe.pendingRun','1');
      sessionStorage.setItem('probe.cfg',JSON.stringify({url:'http://127.0.0.1/lab/sqli_01.php',vulnType:'sqli',script:'CONVERGE_3'}))`);
    await c.goto(fileUrl('monitor.html'));
    let st='idle';
    for(let i=0;i<80;i++){ st=await c.eval(`document.querySelector('#dash').dataset.state`);
      if(['hit','nofind','degraded','oos','cancel','error'].includes(st))break; await sleep(250); }
    await sleep(420);
    console.log('  终态: '+st);
    const DASH=`(()=>{ ${LIB}
      const out=[];
      const add=(label,el)=>{if(!el)return;const e=effContrast(el);
        out.push({label,text:(el.textContent||'').trim().slice(0,26),ratio:e.ratio,raw:e.raw,opacity:e.opacity,
          fg:e.fg,bg:e.bg,parentBg:e.parentBg});};
      document.querySelectorAll('.sit__label').forEach((el,i)=>add('拓扑标签'+(i+1),el));
      document.querySelectorAll('.sit__legend-item').forEach((el,i)=>add('图例'+(i+1),el));
      add('流状态读数',document.querySelector('#sitFlowMeta'));
      add('dash__head .lbl',document.querySelector('.dash__head .lbl'));
      add('状态读数 #dashState',document.querySelector('#dashState'));
      add('gauge 大数字',document.querySelector('.gauge__num b'));
      add('gauge 标签',document.querySelector('.gauge .lbl'));
      add('gauge__foot',document.querySelector('.gauge__foot'));
      document.querySelectorAll('.rail i').forEach((el,i)=>add('轮次刻度'+(i+1),el));
      document.querySelectorAll('.cell').forEach((el,i)=>{
        add('指标'+(i+1)+'标签',el.querySelector('.lbl'));
        add('指标'+(i+1)+'大数字',el.querySelector('.cell__val b'));
        add('指标'+(i+1)+'注释',el.querySelector('.cell__note'));
      });
      [...document.querySelectorAll('.terminal .line')].slice(0,10).forEach((el,i)=>add('终端日志'+(i+1),el));
      add('终端容器',document.querySelector('.terminal'));
      add('stage-tag',document.querySelector('.stage-tag'));
      add('run-state',document.querySelector('.run-state'));
      return out;
    })()`;
    R.dash=await c.eval(DASH);
    const badDash=R.dash.filter(x=>x.ratio<4.5);
    console.log('  采样 '+R.dash.length+' 处，最低 '+Math.min.apply(null,R.dash.map(x=>x.ratio))+':1，<4.5 的 '+badDash.length+' 处');
    badDash.forEach(x=>console.log('    **LOW** '+x.label+' '+x.ratio+':1 fg='+x.fg+' bg='+x.bg));
    console.log('  明细（前 12）:');
    R.dash.slice(0,12).forEach(x=>console.log('    '+x.label.padEnd(16)+' '+String(x.ratio).padStart(6)+':1  op='+x.opacity+'  '+x.fg+' / '+x.bg));

    /* 报告页 details.raw pre / summary */
    await c.goto(fileUrl('report.html'));
    R.reportRaw=await c.eval(`(()=>{ ${LIB}
      const out=[];
      const add=(label,el)=>{if(!el)return;const e=effContrast(el);out.push({label,ratio:e.ratio,raw:e.raw,fg:e.fg,bg:e.bg,parentBg:e.parentBg});};
      document.querySelectorAll('details.raw').forEach((d,i)=>{
        add('details.raw['+i+'] summary',d.querySelector('summary'));
        add('details.raw['+i+'] pre',d.querySelector('pre'));
      });
      add('报告正文 .report-sec',document.querySelector('.report-sec'));
      add('水印 .watermark',document.querySelector('.watermark'));
      return out;
    })()`);
    console.log('  报告 details.raw: '+JSON.stringify(R.reportRaw));

    /* ===== §6 8 态形状色可见性 + 灰度截图 ===== */
    console.log('=== §6 8 态形状编码 + 形状色对比 + 灰度截图 ===');
    const STATES=['idle','run','hit','nofind','degraded','oos','cancel','error'];
    const STATE_EXPR=s=>`(()=>{ ${LIB}
      const st=${JSON.stringify(s)};
      const lamp=document.querySelector('.dash__state i');
      const cs=getComputedStyle(lamp),af=getComputedStyle(lamp,'::after');
      const probe=n=>{const x=document.createElement('span');x.style.color='var('+n+')';document.body.appendChild(x);const v=getComputedStyle(x).color;x.remove();return v};
      const cutRGB=probe('--sit-cut'),sitBg=probe('--sit-bg');
      const fill=parse(cs.backgroundColor);
      const fillEff=fill.a<1?over(fill,parse(sitBg)):fill;
      const b=getComputedStyle(document.querySelector('.sit__barrier'));
      const kp=getComputedStyle(document.querySelector('.sit__path--key'));
      const fh=getComputedStyle(document.querySelector('.sit__flow--hit'));
      return {state:st,lampBg:cs.backgroundColor,lampBorder:cs.borderTopColor,lampTransform:cs.transform,
        lampBoxShadow:cs.boxShadow,lampAnim:cs.animationName,
        afterContent:af.content,afterBg:af.backgroundColor,afterW:af.width,afterH:af.height,
        afterTransform:af.transform,afterOpacity:af.opacity,
        barrierDash:b.strokeDasharray,barrierOpacity:b.opacity,barrierStroke:b.stroke,
        keyPathOpacity:kp.opacity,keyPathDash:kp.strokeDasharray,flowHitOpacity:fh.opacity,
        intrusionOpacity:getComputedStyle(document.querySelector('.fx-intrusion')).opacity,
        cutRGB,sitBg,cutHex:rgb2hex(cutRGB),sitBgHex:rgb2hex(sitBg),
        crCutOnFill:cr(parse(cutRGB),fillEff),crCutOnSitBg:cr(parse(cutRGB),parse(sitBg)),
        crFillOnSitBg:cr(fillEff,parse(sitBg)),
        stateTxt:document.querySelector('#dashState').textContent};
    })()`;
    for(const s of STATES){
      await c.goto(fileUrl('monitor.html'));
      await sleep(320);
      /* 先切状态，再等 --d-state(360ms) + --d-inst(160ms) 过渡结束才采样。
         否则 computedStyle 读到过渡起始值：8 态灯色会全部停在 hit 的青色、
         degraded 的 rotate(45deg) 读成 identity、关键路径 opacity 恒为 .95（假阴性）。 */
      await c.eval(`document.querySelector('#dash').dataset.state=${JSON.stringify(s)}`);
      await sleep(520);
      const info=await c.eval(STATE_EXPR(s));
      R.states.push(info);
      console.log('  '+s.padEnd(9)+' 灯填充='+info.lampBg.padEnd(22)+
        ' ::after=['+info.afterContent+' '+info.afterW+'x'+info.afterH+' '+info.afterTransform+']'+
        ' transform='+info.lampTransform+' boxShadow='+(info.lampBoxShadow==='none'?'-':'有')+
        ' | cut/填充='+info.crCutOnFill+':1 cut/亮底='+info.crCutOnSitBg+':1 填充/亮底='+info.crFillOnSitBg+':1'+
        ' | 防线='+info.barrierDash+' 关键路径op='+info.keyPathOpacity);
      /* 灰度截图：注入 grayscale filter 后按 #dash 区域裁剪 */
      await c.eval(`(()=>{document.querySelector('#dash').dataset.state=${JSON.stringify(s)};
        document.documentElement.style.filter='grayscale(1) contrast(1.06)';})()`);
      await sleep(90);
      const rect=await c.eval(`(()=>{const r=document.querySelector('#dash').getBoundingClientRect();
        return {x:Math.max(0,r.x),y:Math.max(0,r.y),width:Math.min(r.width,1440),height:Math.min(r.height,880)};})()`);
      const shot=await c.send('Page.captureScreenshot',{format:'png',clip:{x:rect.x,y:rect.y,width:rect.width,height:rect.height,scale:1}});
      if(shot.result&&shot.result.data) fs.writeFileSync(path.join(OUT,'qa-v019-gray-'+s+'.png'),Buffer.from(shot.result.data,'base64'));
    }
    console.log('  灰度截图 8 张 → '+OUT+'\\qa-v019-gray-{state}.png');
    await c.eval(`document.documentElement.style.filter=''`);

    /* ===== §7 四段拓扑结构完整 ===== */
    console.log('=== §7 四段拓扑结构计数 ===');
    await c.goto(fileUrl('monitor.html'));
    R.topo=await c.eval(`(()=>{
      const q=s=>document.querySelector(s),qa=s=>[...document.querySelectorAll(s)];
      const svg=q('.fx-situation');
      return {labels:qa('.sit__label').length,zones:qa('.sit__zone').length,
        nodes:qa('.sit__node').length,allRect:qa('.sit__node').every(n=>n.tagName.toLowerCase()==='rect'),
        dataR:qa('.sit__node').map(n=>n.getAttribute('data-r')).join(','),
        flowKinds:new Set(qa('.sit__flow').map(e=>getComputedStyle(e).strokeDasharray)).size,
        flows:qa('.sit__flow').map(e=>getComputedStyle(e).strokeDasharray),
        barriers:qa('.sit__barrier').length,legend:qa('.sit__legend-item').length,
        target:qa('.sit__target').length,cells:qa('.cell').length,
        flowMeta:!!q('#sitFlowMeta'),rail:qa('.rail i').length,
        viewBox:svg?svg.getAttribute('viewBox'):'',preserve:svg?svg.getAttribute('preserveAspectRatio'):''};
    })()`);
    console.log('  '+JSON.stringify(R.topo));

    /* ===== §8 flowMeta 不截断 + 字距 ===== */
    console.log('=== §8 .sit__flowmeta 命中态不截断 ===');
    await c.eval(`sessionStorage.setItem('probe.pendingRun','1');sessionStorage.setItem('probe.cfg',JSON.stringify({url:'http://127.0.0.1/lab/x',vulnType:'sqli',script:'CONVERGE_3'}))`);
    await c.goto(fileUrl('monitor.html'));
    for(let i=0;i<80;i++){ const s=await c.eval(`document.querySelector('#dash').dataset.state`);
      if(['hit','nofind','degraded','oos','cancel','error'].includes(s))break; await sleep(250); }
    await sleep(400);
    R.flowMeta=await c.eval(`(()=>{const m=document.querySelector('#sitFlowMeta'),cs=getComputedStyle(m);
      return {text:m.textContent,scrollWidth:m.scrollWidth,clientWidth:m.clientWidth,
        clipped:m.scrollWidth>m.clientWidth+1,letterSpacing:cs.letterSpacing,fontSize:cs.fontSize,
        textTransform:cs.textTransform,display:cs.display};})()`);
    console.log('  '+JSON.stringify(R.flowMeta));

    /* ===== §9 外部请求 / 控制台异常 ===== */
    const ext=c.events.filter(e=>e.method==='Network.requestWillBeSent')
      .map(e=>e.params.request.url).filter(u=>/^https?:/.test(u)&&!/127\.0\.0\.1:9355/.test(u));
    const exceptions=c.events.filter(e=>e.method==='Runtime.exceptionThrown');
    const logErr=c.events.filter(e=>e.method==='Log.entryAdded'&&e.params.entry.level==='error');
    R.net={external:ext,exceptions:exceptions.map(e=>e.params.exceptionDetails.text),
      logErrors:logErr.map(e=>e.params.entry.text)};
    console.log('=== §9 外部请求 '+ext.length+' · 控制台异常 '+exceptions.length+' · Log error '+logErr.length+' ===');
    if(ext.length)console.log('  '+ext.slice(0,5).join('\n  '));
    if(exceptions.length)console.log('  '+exceptions.map(e=>e.params.exceptionDetails.text).slice(0,5).join('\n  '));
    if(logErr.length)console.log('  '+logErr.map(e=>e.params.entry.text).slice(0,5).join('\n  '));

  }catch(e){ R.errors.push(String(e&&e.stack||e)); console.error('[ERROR] '+(e&&e.stack||e)); }
  finally{
    try{ chrome.kill('SIGKILL'); }catch(e){}
    fs.writeFileSync(path.join(OUT,'qa-v019-a.json'),JSON.stringify(R,null,2));
    console.log('\n完整结果 → '+path.join(OUT,'qa-v019-a.json'));
  }
})();
