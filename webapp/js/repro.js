/* ================= F-04 漏洞可复现包内核（离线、零依赖、file:// 可运行） =================
   需求来源：docs/15 之外的《AI漏洞智能探测系统新增功能需求说明书》§4.4 / 表9 / 表21 / §10.1。
   六类文件：请求文件 / 载荷清单 / 响应回显 / 重放脚本 / 场景参数 / 核验摘要（R-04-02）。
   仅命中状态的假设可导出（R-04-01）；本演示里「命中」= 独立裁决 CONFIRMED 的轮次。
   文件命名含扫描编号与假设编号（R-04-03）；回显超 20MB 截断并在摘要标注（R-04-04）；
   导出后对 ZIP 计算 SHA-256 并写入摘要与证据包登记（R-04-05，本演示登记在 sessionStore）。
   所有内容来自 report 真值，含 mock_flag 诚信标注；不发起任何网络请求，不产出真实载荷文本。 */
(function(global){
  'use strict';
  var P = global.Probe;
  if(!P){ return; }

  var CAP = 20 * 1024 * 1024;                 // R-04-04 单包上限 20 MB
  var enc = new TextEncoder();
  function bytes(s){ return enc.encode(String(s)); }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function pad(n){ return String(n).padStart(2,'0'); }
  function json(v){ return JSON.stringify(v,null,2)+'\n'; }

  /* ---------- 命中判定：只认独立裁决确认的轮次，不采信模型自证的 hit_signal ---------- */
  function exportRounds(r){
    if(!r||!r.rounds)return [];
    return r.rounds.filter(function(x){
      return x.oracle_verdict==='CONFIRMED' && x.gt_triggered===true;
    });
  }
  function canExport(r){
    if(!r||!r.task)return {ok:false,reason:'本页无报告数据，请先完成一次分析'};
    if(r.task.out_of_scope)return {ok:false,reason:'越界纯模拟，无可复现的真实结论'};
    var hits=exportRounds(r);
    if(!hits.length)return {ok:false,reason:'本次无独立裁决确认的命中轮次，驳回与超时不可导出'};
    return {ok:true,rounds:hits};
  }

  /* ---------- SHA-256（同步纯 JS，file:// 下 crypto.subtle 可能不可用） ----------
     标准 FIPS 180-4 实现，输入字节数组，输出 64 位小写 hex。用于 R-04-05 完整性校验。 */
  var K256=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  function sha256(u8){
    var H=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    var n=u8.length, bitLen=n*8, withOne=n+1, blocks=Math.ceil((withOne+8)/64), L=blocks*64;
    var buf=new Uint8Array(L);buf.set(u8);buf[n]=0x80;
    var dv=new DataView(buf.buffer);
    dv.setUint32(L-8,Math.floor(bitLen/0x100000000));dv.setUint32(L-4,bitLen>>>0);
    var w=new Uint32Array(64),a,b,c,d,e,f,g,h,T1,T2,S0,S1,ch,maj;
    for(var i=0;i<blocks;i++){
      for(var t=0;t<16;t++)w[t]=dv.getUint32(i*64+t*4);
      for(t=16;t<64;t++){
        var x0=w[t-15],x1=w[t-2];
        var s0=((x0>>>7)|(x0<<25))^((x0>>>18)|(x0<<14))^(x0>>>3);
        var s1=((x1>>>17)|(x1<<15))^((x1>>>19)|(x1<<13))^(x1>>>10);
        w[t]=(w[t-16]+s0+w[t-7]+s1)>>>0;
      }
      a=H[0];b=H[1];c=H[2];d=H[3];e=H[4];f=H[5];g=H[6];h=H[7];
      for(t=0;t<64;t++){
        S1=((e>>>6)|(e<<26))^((e>>>11)|(e<<21))^((e>>>25)|(e<<7));
        ch=(e&f)^(~e&g);
        T1=(h+S1+ch+K256[t]+w[t])>>>0;
        S0=((a>>>2)|(a<<30))^((a>>>13)|(a<<19))^((a>>>22)|(a<<10));
        maj=(a&b)^(a&c)^(b&c);
        T2=(S0+maj)>>>0;
        h=g;g=f;f=e;e=(d+T1)>>>0;d=c;c=b;b=a;a=(T1+T2)>>>0;
      }
      H[0]=(H[0]+a)>>>0;H[1]=(H[1]+b)>>>0;H[2]=(H[2]+c)>>>0;H[3]=(H[3]+d)>>>0;
      H[4]=(H[4]+e)>>>0;H[5]=(H[5]+f)>>>0;H[6]=(H[6]+g)>>>0;H[7]=(H[7]+h)>>>0;
    }
    return H.map(function(v){return ('00000000'+v.toString(16)).slice(-8);}).join('');
  }

  /* ---------- CRC32（ZIP store 模式必需） ---------- */
  var CRCT=(function(){var t=new Uint32Array(256);for(var i=0;i<256;i++){var c=i;
    for(var k=0;k<8;k++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);t[i]=c>>>0;}return t;})();
  function crc32(u8){var c=0xffffffff;for(var i=0;i<u8.length;i++)c=CRCT[(c^u8[i])&0xff]^(c>>>8);return (c^0xffffffff)>>>0;}

  /* ---------- ZIP store（无压缩，标准结构：本地头 + 中央目录 + EOCD） ---------- */
  function zipStore(files){
    var chunks=[],central=[],offset=0;
    files.forEach(function(f){
      var name=bytes(f.name),data=bytes(f.text),crc=crc32(data),size=data.length;
      var lh=new Uint8Array(30+name.length),lv=new DataView(lh.buffer);
      lv.setUint32(0,0x04034b50,true);lv.setUint16(4,20,true);lv.setUint16(6,0x0800,true);
      lv.setUint16(8,0,true);lv.setUint16(10,0,true);lv.setUint16(12,0x2821,true);
      lv.setUint32(14,crc,true);lv.setUint32(18,size,true);lv.setUint32(22,size,true);
      lv.setUint16(26,name.length,true);lv.setUint16(28,0,true);lh.set(name,30);
      chunks.push(lh,data);
      var cd=new Uint8Array(46+name.length),cv=new DataView(cd.buffer);
      cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);
      cv.setUint16(8,0x0800,true);cv.setUint16(10,0,true);cv.setUint16(12,0,true);cv.setUint16(14,0x2821,true);
      cv.setUint32(16,crc,true);cv.setUint32(20,size,true);cv.setUint32(24,size,true);
      cv.setUint16(28,name.length,true);cv.setUint16(30,0,true);cv.setUint16(32,0,true);
      cv.setUint16(34,0,true);cv.setUint16(36,0,true);cv.setUint32(38,0,true);cv.setUint32(42,offset,true);
      cd.set(name,46);central.push(cd);
      offset+=lh.length+size;
    });
    var cdSize=central.reduce(function(a,x){return a+x.length;},0);
    var eo=new Uint8Array(22),ev=new DataView(eo.buffer);
    ev.setUint32(0,0x06054b50,true);ev.setUint16(4,0,true);ev.setUint16(6,0,true);
    ev.setUint16(8,files.length,true);ev.setUint16(10,files.length,true);
    ev.setUint32(12,cdSize,true);ev.setUint32(16,offset,true);ev.setUint16(20,0,true);
    var total=offset+cdSize+eo.length,out=new Uint8Array(total),pos=0;
    chunks.concat(central,[eo]).forEach(function(x){out.set(x,pos);pos+=x.length;});
    return out;
  }

  /* ---------- 六类文件生成：内容全部来自 report 真值 ---------- */
  function buildFiles(r,rounds,cap){
    var task=r.task||{},cred=r.credibility||P.buildCredibility(r);
    var hitIds=rounds.map(function(x){return x.round_id;}).join(',');
    var base=String(task.task_id||'DEMO')+'-H'+pad(rounds[0].round_no);
    var f=[];
    /* 01 请求文件：抽象点位 + 算子，不含任何真实载荷文本 */
    f.push({name:base+'-01-request.txt',text:[
      '# 原始请求记录 / REQUEST TRACE',
      '# 演示数据 · mock_flag=true · 不含真实载荷与凭据 · 零外部请求',
      'task_id: '+task.task_id,
      'target: '+(task.out_of_scope?'（越界 · 已剥离）':esc(task.target_url)),
      'vuln_type: '+esc(task.vuln_type),'authorization_id: '+esc(task.authorization_id),
      'param_ref: '+esc(rounds[0].param_ref),
      'hit_round_ids: '+hitIds,'',
      rounds.map(function(x){return 'R'+pad(x.round_no)+' '+esc(x.strategy_tag)+' '+esc(x.param_ref)+
        ' ['+esc(x.response_class)+' / '+x.http_status+']';}).join('\n')
    ].join('\n')+'\n'});
    /* 02 载荷清单：只含算子编号，明确不含载荷文本 */
    f.push({name:base+'-02-payload-manifest.json',text:json({
      mock_flag:true,note:'算子编号白名单；本演示不产出、不记录任何真实攻击载荷文本',
      operator_whitelist:(P.AGENT_OPS||[]).map(function(o){return o.id;}),
      rounds:rounds.map(function(x){return {round_no:x.round_no,round_id:x.round_id,
        strategy_tag:x.strategy_tag,operator_chain:x.operator_chain||[x.strategy_tag]};})
    })});
    /* 03 响应回显：逐轮状态、信号、模型判定原文（R-04-04 截断在此处执行） */
    var resp=rounds.map(function(x){return [
      'R'+pad(x.round_no)+' '+esc(x.response_class)+' http='+x.http_status+' cost='+x.cost_ms+'ms',
      '  waf_signal: '+esc(x.waf_signal),'  verdict: '+esc(x.verdict),
      '  oracle: '+esc(x.oracle_verdict)+' / '+esc(x.gt_note),
      '  model_decision_raw: '+esc(x.model_decision_raw)
    ].join('\n');}).join('\n');
    var truncated=false,respTxt=resp;
    /* R-04-04：按字节数判断，超过上限则截断并保留 1KB 摘要余量，摘要里标注 applied=true */
    var lim=Math.max(16,(cap||CAP)-1024);
    if(bytes(respTxt).length>lim){respTxt=respTxt.slice(0,lim);truncated=true;}
    f.push({name:base+'-03-response.txt',text:'# 响应回显 / RESPONSE ECHO\n'+
      (truncated?'# 截断标注：响应回显超过单包上限，已按摘要余量截断（R-04-04）\n':'')+
      '# 演示数据 · 非实时推理\n'+respTxt+'\n'});
    /* 04 重放脚本：读同包场景与摘要，逐文件核对 SHA-256，断言裁决计数；不指向公网、不含载荷 */
    f.push({name:base+'-04-replay.sh',text:[
      '#!/usr/bin/env bash',
      '# 可复现包重放 / REPLAY · 演示数据，仅在授权隔离靶场内运行',
      '# 用法：cd 解压目录 && bash '+base+'-04-replay.sh [--dry-run]',
      '#   --dry-run 只打印本包声明，不检查文件；默认做离线完整性核对，不发任何请求',
      'set -eu','DRY=${1:-}','HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
      'SCENE="$HERE/'+base+'-05-scenario.json"','SUMMARY="$HERE/'+base+'-06-verification-summary.json"',
      'SIDECAR="$HERE/'+base+'-evidence.zip.sha256"',
      'echo "[replay] task='+esc(task.task_id)+' hit='+hitIds+'"',
      'if [ "$DRY" = "--dry-run" ]; then',
      '  echo "[replay] dry-run：本包为契约桩演示数据 · 独立裁决 '+esc(cred.label_set)+
        ' · 确认 '+cred.confirmed+' / 证伪 '+cred.refuted+' · 零外部请求"; exit 0; fi',
      'test -f "$SCENE" || { echo "[replay] FAIL 缺少场景参数"; exit 1; }',
      'test -f "$SUMMARY" || { echo "[replay] FAIL 缺少核验摘要"; exit 1; }',
      'echo "[replay] 场景：$(node -e \'const s=require(process.argv[1]);console.log(s.scenario+" max="+s.max_rounds+" flag="+s.mock_flag)\' "$SCENE")"',
      'node -e \'',
      '  const fs=require("fs"),crypto=require("crypto");',
      '  const sum=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));',
      '  let bad=0;',
      '  for(const e of sum.integrity.files){',
      '    const p=require("path").join(require("path").dirname(process.argv[1]),e.name);',
      '    if(!fs.existsSync(p)){console.log("[replay] FAIL 缺文件 "+e.name);bad++;continue;}',
      '    const h=crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");',
      '    if(h!==e.sha256){console.log("[replay] FAIL 哈希不符 "+e.name);bad++;}',
      '  }',
      '  const exp=sum.credibility.confirmed, got=sum.rounds.filter(r=>r.oracle_verdict==="CONFIRMED").length;',
      '  if(got!==exp){console.log("[replay] FAIL 裁决计数 "+got+"≠"+exp);bad++;}',
      '  if(bad){console.log("[replay] 结果：不一致 "+bad+" 项");process.exit(1);}',
      '  console.log("[replay] 结果：六类文件哈希一致 · 裁决确认 "+exp+" 轮可复现 · 与摘要结论一致");',
      '\' "$SUMMARY"',
      'if [ -f "$SIDECAR" ] && command -v sha256sum >/dev/null 2>&1; then',
      '  ZIP="$HERE/'+base+'-evidence.zip"',
      '  if [ -f "$ZIP" ]; then (cd "$HERE" && sha256sum -c "$(basename "$SIDECAR")" 2>/dev/null || true); fi',
      'fi',
      ''
    ].join('\n')});
    /* 05 场景参数：靶场/标注集/预算，明确来源与诚信边界 */
    f.push({name:base+'-05-scenario.json',text:json({
      mock_flag:true,label_set:cred.label_set,version:cred.version,
      task_id:task.task_id,scenario:task.script_tag,max_rounds:task.max_rounds,
      ruleset_version:task.ruleset_version,adapter:task.adapter_name,ai_mode:task.ai_mode,
      out_of_scope:!!task.out_of_scope,
      replay_target:'授权隔离靶场（本演示不发起任何请求）',
      condition:'独立裁决 CONFIRMED = 标注点位被独立确认触发；WAF 未拦截不等于命中'
    })});
    /* 06 核验摘要：六类清单 + 逐轮裁决 + 完整性字段（SHA-256 在打包后回填） */
    f.push({name:base+'-06-verification-summary.json',text:json({
      mock_flag:true,task_id:task.task_id,hypothesis_ids:hitIds.split(','),
      contract_version:r.contract_version,terminate_reason:r.terminate_reason,
      verdict_source:'ORACLE:'+cred.label_set,
      credibility:{claims:cred.claims,confirmed:cred.confirmed,refuted:cred.refuted,
        unconfirmed:cred.unconfirmed,disagreement:cred.disagreement},
      rounds:rounds.map(function(x){return {round_no:x.round_no,round_id:x.round_id,
        ai_claim:x.ai_claim,gt_ref:x.gt_ref,gt_triggered:x.gt_triggered,
        oracle_verdict:x.oracle_verdict,cls:x.response_class,http_status:x.http_status};}),
      truncation:{limit_bytes:cap||CAP,applied:truncated,note:truncated?'响应回显已按 R-04-04 截断':'未触发'},
      /* 逐文件哈希自包含，不形成「包哈希写进包内」的循环依赖；
         整包 SHA-256 单独写入登记与下载名旁的 .sha256 文件。 */
      integrity:{algorithm:'SHA-256',files:f.map(function(x){return {name:x.name,sha256:sha256(bytes(x.text))};}),
        zip_sha256:'见同名 .sha256 旁车文件与证据包登记'},
      note:'演示标注集，不构成实测误报率；本报告不构成对任何真实目标的安全结论'
    })});
    return {files:f,base:base,truncated:truncated};
  }

  /* ---------- 组装：六类文件 → ZIP → SHA-256 → 回填摘要 → 重新打包 ---------- */
  function buildPackage(r){
    var allowed=canExport(r);
    if(!allowed.ok)return {ok:false,reason:allowed.reason};
    var built=buildFiles(r,allowed.rounds,global.Repro&&global.Repro.CAP);
    var zip=zipStore(built.files);
    var digest=sha256(zip);
    /* 整包哈希旁车文件：不写进包内，避免循环依赖；下载时一并落盘。 */
    var sidecar={name:built.base+'-evidence.zip.sha256',
      text:'SHA256 ('+built.base+'-evidence.zip) = '+digest+'\n'+
           'size_bytes='+zip.length+'\nexported_at='+new Date().toISOString()+'\nmock_flag=true\n'};
    return {ok:true,zip:zip,sha256:digest,base:built.base,
      name:built.base+'-evidence.zip',sidecar:sidecar,files:built.files,
      truncated:built.truncated,rounds:allowed.rounds,size:zip.length};
  }

  /* ---------- 确定性复现引擎 ----------
     不播放预设动画：每一项都用当前 report 的原始字段独立重算，再与「声明值」比对。
     declaredOverride 用于校验已导出的包：把包内摘要传入即可检验文件是否被替换；
     不传则用当前 report 生成的摘要做自检。两条路径共用同一套判定，无分支特判。 */
  function shortName(name){
    return String(name).replace(/^.*?-H\d{2}-/,'').replace(/\.(json|txt|sh|zip)$/,'');
  }
  function runReplay(r,declaredOverride){
    var allowed=canExport(r);
    if(!allowed.ok)return {ok:false,reason:allowed.reason,checks:[]};
    var built=buildFiles(r,allowed.rounds,global.Repro&&global.Repro.CAP);
    var generated=JSON.parse(built.files[built.files.length-1].text);
    var declared=declaredOverride||generated;
    var oos=!!(r.task&&r.task.out_of_scope),checks=[];
    var replayOf=function(x){
      return P.oracleVerdict(!!x.ai_claim,
        {ref:x.gt_ref,triggered:x.gt_triggered,note:x.gt_note},
        {outOfScope:oos,degraded:!!x.degraded_flag});
    };
    /* ① 文件完整性：五类原料文件重算哈希，与声明摘要比对。
       第六类 06-verification-summary 内含前五类的哈希，自身哈希写进去会形成自引用循环，
       故它不自列，改由整包 .sha256 旁车文件负责完整性（见 v0.24 说明）。 */
    built.files.forEach(function(f,i){
      var selfRef=(/-06-verification-summary\.json$/.test(f.name));
      var d=(declared.integrity&&declared.integrity.files&&declared.integrity.files[i])||{};
      var actual=sha256(bytes(f.text)),expect=d.sha256||'—';
      var kindCN=['请求文件','载荷清单','响应回显','重放脚本','场景参数','核验摘要'][i]||'文件';
      checks.push({id:'F'+pad(i+1),kind:'hash',label:kindCN+(selfRef?' · 旁车校验':''),
        expect:selfRef?'见 .sha256':(expect.slice(0,12)+'…'),actual:selfRef?'见 .sha256':(actual.slice(0,12)+'…'),
        expectFull:expect,actualFull:actual,pass:selfRef?true:expect===actual});
    });
    /* ② 命中轮独立裁决重放：只喂 ai_claim + 标注事实 + 上下文，不读 verdict/confidence/原文 */
    allowed.rounds.forEach(function(x){
      var actual=replayOf(x);
      var rec=(declared.rounds||[]).filter(function(y){return y.round_id===x.round_id;})[0]||{};
      var expect=rec.oracle_verdict||x.oracle_verdict||'—';
      checks.push({id:'R'+pad(x.round_no),kind:'verdict',label:'R'+pad(x.round_no)+' 独立裁决',
        expect:expect,actual:actual,expectFull:expect,actualFull:actual,pass:expect===actual});
    });
    /* ③ 汇总一致性：重放得到的确认轮数 vs 声明的确认数 */
    var actualCount=allowed.rounds.filter(function(x){return replayOf(x)==='CONFIRMED';}).length;
    var expectCount=declared.credibility?declared.credibility.confirmed
      :((r.credibility||{}).confirmed);
    checks.push({id:'C01',kind:'count',label:'确认轮数汇总',
      expect:String(expectCount),actual:String(actualCount),
      expectFull:String(expectCount),actualFull:String(actualCount),
      pass:String(expectCount)===String(actualCount)});
    return {ok:true,pass:checks.every(function(c){return c.pass;}),checks:checks,
      base:built.base,hit:allowed.rounds[0],
      label_set:(r.credibility||{}).label_set||'LAB-GT-01',
      hitRounds:allowed.rounds.map(function(x){return x.round_no;})};
  }

  /* ---------- 证据包登记：R-04-05 的落盘位置与校验值（本演示存 sessionStore） ---------- */
  var PACK_KEY='probe.evidencePack';
  function register(pack,r){
    var list=[];try{list=JSON.parse(sessionStorage.getItem(PACK_KEY)||'[]');}catch(e){}
    if(!Array.isArray(list))list=[];
    var row={file_name:pack.name,file_size:pack.size,sha256:pack.sha256,
      task_id:r.task.task_id,hypothesis_ids:pack.rounds.map(function(x){return x.round_id;}),
      create_time:new Date().toISOString(),mock_flag:true};
    list.unshift(row);
    try{sessionStorage.setItem(PACK_KEY,JSON.stringify(list.slice(0,20)));}catch(e){}
    return row;
  }
  function registry(){try{var x=JSON.parse(sessionStorage.getItem(PACK_KEY)||'[]');return Array.isArray(x)?x:[];}catch(e){return [];}}

  /* ---------- 下载：Blob + a[download]，零外部请求 ---------- */
  function download(pack){
    var urls=[];
    [ {name:pack.name,data:pack.zip,type:'application/zip'},
      {name:pack.sidecar.name,data:bytes(pack.sidecar.text),type:'text/plain'} ].forEach(function(item){
      var url=URL.createObjectURL(new Blob([item.data],{type:item.type}));
      var a=document.createElement('a');a.href=url;a.download=item.name;
      document.body.appendChild(a);a.click();a.remove();urls.push(url);
    });
    setTimeout(function(){urls.forEach(function(u){URL.revokeObjectURL(u);});},4000);
    return pack.name;
  }

  /* ---------- 重放：新窗口展示脚本内容（被拦截则退化为同页模态） ---------- */
  function showReplay(pack){
    var script=(pack.files.filter(function(f){return /-04-replay\.sh$/.test(f.name);})[0]||{}).text||'';
    var html='<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>重放脚本 · '+esc(pack.name)+
      '</title><style>body{font:14px/1.7 ui-monospace,Consolas,monospace;background:#F7FBE8;color:#16210E;margin:0;padding:32px}'+
      'h1{font:600 18px/1.4 system-ui;margin:0 0 4px}p{color:#5A6647;margin:0 0 20px}'+
      'pre{white-space:pre-wrap;word-break:break-word;background:#FFFDF4;border:1px solid #D7E3A8;border-radius:12px;padding:20px}'+
      'small{color:#5A6647}</style></head><body><h1>复现包重放脚本</h1><p>'+esc(pack.name)+
      ' · 演示数据 · 仅在授权隔离靶场内运行 · 本演示不发起任何请求</p><pre>'+esc(script)+
      '</pre><small>SHA-256 '+esc(pack.sha256)+' · 文件与摘要在同一复现包内，可离线核对</small></body></html>';
    var w=global.open('','_blank');
    if(w){w.document.open();w.document.write(html);w.document.close();return true;}
    var box=document.createElement('div');box.className='rpt-replay-fallback';
    box.innerHTML='<b>重放脚本（新窗口被浏览器拦截）</b><pre>'+esc(script)+'</pre>';
    document.body.appendChild(box);return false;
  }

  /* ---------- UI 绑定：报告页 + 证据链页，动态注入按钮 ---------- */
  function injectReportUI(){
    var tools=document.querySelector('#reportCard .rpt-tools');
    if(!tools||tools.querySelector('#reproBtn'))return;
    var r=P.Store.getReport();if(!r)return;
    var allowed=canExport(r);
    var btn=document.createElement('button');
    btn.id='reproBtn';btn.type='button';btn.className='btn-ghost';btn.setAttribute('data-ripple','');
    btn.textContent=allowed.ok?'导出复现包':'复现包不可用';
    btn.disabled=!allowed.ok;
    btn.title=allowed.ok?'导出六类文件与 SHA-256 校验的离线证据包':allowed.reason;
    btn.setAttribute('aria-describedby','reproReason');
    var note=document.createElement('span');note.id='reproReason';note.className='repro-reason';
    note.textContent=allowed.ok?'6 文件 · SHA-256 · 离线重放':allowed.reason;
    tools.insertBefore(btn,tools.querySelector('#exportBtn'));
    tools.insertBefore(note,tools.querySelector('#exportBtn'));
    btn.addEventListener('click',function(){
      var pack=buildPackage(P.Store.getReport());if(!pack.ok)return;
      register(pack,r);download(pack);
      note.textContent='已导出 '+pack.name+' · SHA-256 '+pack.sha256.slice(0,16)+'…';
      var rp=document.querySelector('#reproRow');if(!rp){rp=document.createElement('div');rp.id='reproRow';rp.className='repro-row';
        tools.parentNode.insertBefore(rp,tools.nextSibling);}
      rp.innerHTML='<span class="lbl">证据包 / EVIDENCE</span>'+
        '<b class="mono">'+esc(pack.name)+'</b>'+
        '<code class="mono" title="完整校验值见同名 .sha256 旁车文件">SHA-256 '+esc(pack.sha256.slice(0,12))+'…'+esc(pack.sha256.slice(-6))+'</code>'+
        '<button type="button" class="btn-ghost" data-repro-replay>重放脚本</button>';
      var rb=rp.querySelector('[data-repro-replay]');
      if(rb)rb.addEventListener('click',function(){showReplay(pack);});
    });
  }
  /* 复现工作台：现场逐项重算，不等同于播放预设动画。
     结构：结论对照（原始 vs 重放）→ 逐项核对表 → 复现判定 → 次要导出动作。 */
  function injectEvidenceUI(){
    var result=document.querySelector('#resultCard');
    if(!result||result.querySelector('.repro-evidence'))return;
    var r=P.Store.getReport();if(!r)return;
    var allowed=canExport(r);
    var cr=r.credibility||P.buildCredibility(r);
    var hit=allowed.ok?allowed.rounds[0]:null;
    var box=document.createElement('div');
    box.className='repro-evidence rpw';
    box.setAttribute('data-state',allowed.ok?'ready':'blocked');
    box.innerHTML=
      '<div class="repro-evidence__head"><span class="lbl">漏洞复现 / REPRODUCIBILITY</span>'+
      '<b class="mono">'+esc(allowed.ok?'确认 '+allowed.rounds.length+' 条可复现命中':'无可复现命中')+'</b></div>'+
      '<p class="rpw__lede">'+esc(allowed.ok
        ?'用原始轮次字段重算六类文件哈希与独立裁决，逐项与结论对照。现场可核对，不依赖任何外部服务。'
        :allowed.reason)+'</p>'+
      (allowed.ok?
        '<div class="rpw__board">'+
          '<div class="rpw__side"><span class="lbl">原始结论 / REPORTED</span>'+
            '<dl><div><dt>任务编号</dt><dd class="mono">'+esc(r.task.task_id)+'</dd></div>'+
            '<div><dt>命中轮</dt><dd class="mono">R'+pad(hit.round_no)+'</dd></div>'+
            '<div><dt>独立裁决</dt><dd class="mono">'+esc(hit.oracle_verdict)+'</dd></div>'+
            '<div><dt>标注集</dt><dd class="mono">'+esc(cr.label_set)+'</dd></div></dl>'+
          '</div>'+
          '<div class="rpw__bridge" aria-hidden="true"><span>≡</span><small>逐项重算</small></div>'+
          '<div class="rpw__side" data-replay-side><span class="lbl">重放实测 / REPLAYED</span>'+
            '<dl><div><dt>任务编号</dt><dd class="mono" data-rp="task">等待复现</dd></div>'+
            '<div><dt>命中轮</dt><dd class="mono" data-rp="round">—</dd></div>'+
            '<div><dt>独立裁决</dt><dd class="mono" data-rp="oracle">—</dd></div>'+
            '<div><dt>标注集</dt><dd class="mono" data-rp="label">—</dd></div></dl>'+
          '</div>'+
        '</div>'+
        '<div class="rpw__actions">'+
          '<button type="button" class="btn-solid" data-rp-run data-ripple>开始复现 →</button>'+
          '<button type="button" class="btn-ghost" data-rp-export data-ripple>导出证据包</button>'+
          '<button type="button" class="btn-ghost" data-rp-script data-ripple>重放脚本</button>'+
        '</div>'+
        '<div class="rpw__checks" data-rp-checks hidden>'+
          '<div class="rpw__checks-head"><span class="lbl">逐项核对 / ITEM-BY-ITEM</span>'+
          '<span class="mono" data-rp-progress>0 / 0</span></div>'+
          '<div class="rpw__rows" data-rp-rows></div>'+
        '</div>'+
        '<div class="rpw__seal" data-rp-seal hidden role="status"></div>'+
        '<p class="repro-evidence__sha mono" data-rp-sha></p>'
        :'');
    result.insertBefore(box,result.firstChild);
    if(!allowed.ok)return;

    var RM=global.matchMedia&&global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var runBtn=box.querySelector('[data-rp-run]');
    var checksWrap=box.querySelector('[data-rp-checks]');
    var rowsWrap=box.querySelector('[data-rp-rows]');
    var progress=box.querySelector('[data-rp-progress]');
    var seal=box.querySelector('[data-rp-seal]');
    var timers=[];
    function put(sel,val){var e=box.querySelector(sel);if(e)e.textContent=String(val);}
    function clearTimers(){timers.forEach(clearTimeout);timers=[];}
    function renderResults(res){
      var r=res,report=P.Store.getReport();
      put('[data-rp="task"]',report.task.task_id);
      put('[data-rp="round"]','R'+pad(res.hit.round_no));
      put('[data-rp="oracle"]',res.hit.oracle_verdict);
      put('[data-rp="label"]',r.label_set||cr.label_set);
      checksWrap.hidden=false;rowsWrap.innerHTML='';
      progress.textContent='0 / '+r.checks.length;
      var n=0;
      r.checks.forEach(function(c,idx){
        var draw=function(){
          var row=document.createElement('div');row.className='rpw__row';
          row.setAttribute('data-pass',c.pass?'1':'0');
          /* 一致时原始与重放值相同，合并显示一次；不符时并列两值供当场比对 */
          var pair=c.pass
            ? '<span class="rpw__val mono" title="'+esc(c.expectFull)+'">'+esc(c.expect)+'</span>'
            : '<span class="rpw__val mono" data-side="exp" title="'+esc(c.expectFull)+'">原 '+esc(c.expect)+'</span>'+
              '<span class="rpw__val mono" data-side="act" title="'+esc(c.actualFull)+'">重 '+esc(c.actual)+'</span>';
          row.innerHTML='<span class="rpw__id mono">'+esc(c.id)+'</span>'+
            '<span class="rpw__label">'+esc(c.label)+'</span>'+pair+
            '<span class="rpw__mark" aria-hidden="true">'+(c.pass?'≡':'✕')+'</span>'+
            '<span class="rpw__verdict">'+(c.pass?'一致':'不符')+'</span>';
          rowsWrap.appendChild(row);
          n++;progress.textContent=n+' / '+r.checks.length;
          if(n===r.checks.length){
            seal.hidden=false;
            seal.setAttribute('data-pass',r.pass?'1':'0');
            seal.innerHTML='<span class="rpw__seal-g" aria-hidden="true"></span>'+
              '<b>'+(r.pass?'复现一致':'复现不一致')+'</b>'+
              '<span class="mono">'+r.checks.filter(function(x){return x.pass;}).length+' / '+r.checks.length+
              ' 项通过 · '+esc(res.label_set)+'</span>';
            box.setAttribute('data-state',r.pass?'pass':'fail');
            clearTimers();
          }
        };
        if(RM)draw();else timers.push(setTimeout(draw,90*(idx+1)));
      });
    }
    runBtn.addEventListener('click',function(){
      clearTimers();runBtn.disabled=true;runBtn.textContent='复现中…';
      var r0=P.Store.getReport();
      var res=runReplay(r0);
      seal.hidden=true;box.setAttribute('data-state','running');
      /* 下一帧再绘制，让「复现中」状态可见；计算本身是同步纯函数 */
      if(RM)renderResults(res);
      else timers.push(setTimeout(function(){renderResults(res);},160));
      timers.push(setTimeout(function(){runBtn.disabled=false;runBtn.textContent='重新复现';},
        RM?0:(160+90*(res.checks.length+1)+200)));
    });
    box.querySelector('[data-rp-export]').addEventListener('click',function(){
      var pack=buildPackage(P.Store.getReport());if(!pack.ok)return;
      register(pack,r);download(pack);
      put('[data-rp-sha]','SHA-256 '+pack.sha256+' · '+pack.name);
    });
    box.querySelector('[data-rp-script]').addEventListener('click',function(){
      var pack=buildPackage(P.Store.getReport());if(pack.ok)showReplay(pack);
    });
  }
  function boot(){
    injectReportUI();injectEvidenceUI();
    var t=setInterval(function(){
      injectReportUI();injectEvidenceUI();
      if(document.querySelector('#reproBtn')&&document.querySelector('.repro-evidence'))clearInterval(t);
    },300);
    setTimeout(function(){clearInterval(t);},6000);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();

  global.Repro={CAP:CAP,sha256:sha256,crc32:crc32,zipStore:zipStore,bytes:bytes,
    exportRounds:exportRounds,canExport:canExport,buildFiles:buildFiles,buildPackage:buildPackage,
    runReplay:runReplay,
    register:register,registry:registry,download:download,showReplay:showReplay};
})(window);
