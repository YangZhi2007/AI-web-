/* =============================================================================
 * app.js · v0.17 翻页式架构的跨页编排层
 * -----------------------------------------------------------------------------
 * 依赖 console.js 暴露的 window.Probe（引擎/状态机/Store 均在其中）。
 * 职责：① 顶栏当前项高亮（按 data-page）；② 监控页仅消费任务台点击「开始分析」置位的
 * 一次性 pendingRun 意图后才执行 runTask（浏览/刷新/跨页导航一律不触发）；③ 证据/报告/
 * 历史页从 Store 恢复渲染；④ 任务台提交后写配置快照 + pendingRun 意图；⑤ 会话指标从历史重算。
 * 零外部请求、file:// 可运行；所有 DOM 访问判空，缺失即跳过。
 * ========================================================================== */
(function(){
  'use strict';
  var P = window.Probe;
  if(!P){ return; }
  var page = document.body.getAttribute('data-page') || 'console';
  var $ = function(s){ return document.querySelector(s); };
  var $$ = function(s){ return Array.prototype.slice.call(document.querySelectorAll(s)); };

  /* 画像标签：任务/历史里存的是 AGENT_EASY 这类标记，渲染时换成可读名 */
  function profileLabelOf(tag){
    var m=/^AGENT_([A-Z]+)$/.exec(String(tag||''));
    if(m&&P.AGENT_PROFILES&&P.AGENT_PROFILES[m[1]])return P.AGENT_PROFILES[m[1]].label;
    return tag||'—';
  }

  /* ① 顶栏当前项高亮：主导航 4 项 + 工具区子页面 */
  function markNav(){
    $$('.mainnav a, .tool').forEach(function(a){
      if(a.getAttribute('data-page')===page){ a.classList.add('is-current'); a.setAttribute('aria-current','page'); }
    });
  }

  /* ⑤ 会话指标：从 Store 历史重算（跨页一致） */
  function renderMetrics(){
    var hist = P.Store.getHistory();
    var tasks = hist.length;
    var findings = hist.filter(function(h){ return h.reason==='HIT'; }).length;
    var rounds = tasks ? Math.round(hist.reduce(function(a,h){return a+(h.rounds||0);},0)/tasks) : 0;
    var m = {'#mTasks':tasks,'#mFindings':findings,'#mRounds':rounds};
    Object.keys(m).forEach(function(sel){ var el=$(sel); if(el) el.textContent=String(m[sel]); });
  }

  /* ② 监控页：仪表盘，本身不干活。仅当任务台点击「开始分析」置位的一次性 pendingRun
     存在时才消费并执行 runTask；纯浏览/刷新/跨页导航只读回显，绝不触发任务。
     cfg 仅作只读配置快照条，与"是否执行"彻底解耦。 */
  function bootMonitor(){
    var cfg = P.Store.getCfg();
    var hint = $('#monitorHint');
    var goBtn = $('#goConsole');
    var dash = $('#dash');

    /* 只读回填配置快照条（有无 cfg 都与执行无关） */
    if(cfg){
      var put=function(sel,v){var e=$(sel);if(e)e.textContent=v;};
      put('#mTarget',cfg.url);
      put('#mType','攻击后由命中点位判定');
      put('#mScript','自主攻击 / AGENT LOOP');
      put('#mScope',/lab|localhost|127\.0\.0\.1|::1/.test(cfg.url)?'授权靶场':'越界 · 纯模拟');
    }

    /* 一次性消费用户意图：读即清除，保证刷新/后退/跨页不重复执行（跨文档 runTask 的
       if(running) 守卫只在同页有效，幂等必须靠这里清除 pendingRun 保证）。 */
    var pending = !!(P.Store.getPendingRun && P.Store.getPendingRun());
    if(pending) P.Store.clearPendingRun();

    if(pending && cfg){
      if(hint) hint.classList.add('hidden');
      if(goBtn) goBtn.classList.add('hidden');
      /* 授权视为已在任务台勾选确认；仅此处、仅此刻执行一次 */
      /* v0.36：默认走状态驱动、攻破即停的自主闭环；三剧本仅作为显式 agent:false 的契约桩。
         执行开关始终是这一次性 pendingRun，cfg 残留不会触发任何任务。 */
      P.runTask({url:cfg.url, script:'AGENT_LOOP', authed:true, agent:true});
      return;
    }

    /* 纯浏览：有历史报告则只读回显最近一次终态（不执行、不写历史/上报），否则保持 idle */
    var report = P.Store.getReport && P.Store.getReport();
    if(report){
      if(hint) hint.classList.add('hidden');
      if(goBtn) goBtn.classList.add('hidden');
      if(P.applyTerminalState) P.applyTerminalState(report);  // 仅渲染终态，绝无副作用写
      if(P.paintAgentLiveAll) P.paintAgentLiveAll(report);      // v0.23.1 只读回填决策流，不触发任务
      return;
    }

    /* 无报告：保持 idle；无配置快照时给引导空态 */
    if(dash){ dash.dataset.state='idle'; var t=$('#dashState'); if(t)t.textContent='IDLE'; }
    if(P.paintAgentLiveAll) P.paintAgentLiveAll(null);
    if(!cfg){
      if(hint) hint.classList.remove('hidden');
      if(goBtn) goBtn.classList.remove('hidden');
    }else{
      if(hint) hint.classList.add('hidden');
      if(goBtn) goBtn.classList.add('hidden');
    }
  }

  /* ⑥ 呈现层遥测桥（v0.18）：只读观察引擎已经写入的 DOM，把任务进程映射为态势台反馈。
     职责边界：不修改任何业务数据、不触发任务、不写 Store，只增删 CSS class 与一行只读
     流状态说明。覆盖状态：攻击发起 / 加载中 / 拦截 / 命中 / 防御成功 / 数据刷新 /
     空状态 / 越界中断；状态区分同时靠形状、线型与文字，不依赖单一颜色。 */
  function bootTelemetry(){
    var dash=$('#dash'); if(!dash) return;
    var meta=$('#sitFlowMeta');
    var thinking=$('#thinking');
    var body=$('.dash__body');
    var prev={sent:'',blocked:'',hit:'',round:''};
    var blockedTimer=null;

    function num(sel){ var e=$(sel); return e?e.textContent.trim():'0'; }
    function phase(){
      var st=dash.dataset.state||'idle';
      /* run 期 thinking 全程可见，故用「是否已有轮次」区分建立链路与攻击发起：
         第 1 轮 round.started 写入 #dRound 后才算攻击流真正开始推进。 */
      var started=Number(num('#dRound'))>0;
      if(st==='idle') return 'empty';
      if(st==='run')  return started?'attack':'loading';
      if(st==='hit')  return 'breach';
      if(st==='degraded') return 'breach-degraded';
      if(st==='nofind') return 'defended';
      if(st==='oos') return 'flagged';
      if(st==='cancel'||st==='error') return 'aborted';
      return 'standby';
    }
    function flowText(p){
      var s=num('#dSent'),b=num('#dBlocked'),h=num('#dHit'),r=num('#dRound');
      var flow='ATTACK → WAF | 轮次 '+r+' · 投递 '+s+' · 拦截 '+b+' · 命中 '+h;
      switch(p){
        case 'empty':            return '待命 · 无数据流';
        case 'loading':          return '建立链路 · 等待首轮响应';
        case 'attack':           return flow;
        case 'breach':           return 'ATTACK → TARGET | 命中路径已建立 · '+h+' 次命中';
        case 'breach-degraded':  return 'ATTACK → TARGET | 命中路径（含降级轮）';
        case 'defended':         return 'WAF 全量拦截 · 未建立命中路径 · '+b+' 次阻断';
        case 'flagged':          return '越界 / 中断 · 纯模拟告警';
        case 'aborted':          return '任务中断 · 链路已断开';
        default:                 return flow;
      }
    }
    function syncPhase(){
      var p=phase();
      if(dash.getAttribute('data-phase')!==p) dash.setAttribute('data-phase',p);
      if(meta) meta.textContent=flowText(p);
    }
    /* 数据刷新：数字变化时一次性下划线扫过；拦截数增加时防线由虚转实短促反馈 */
    function observeNumbers(){
      [['#dSent','sent'],['#dBlocked','blocked'],['#dHit','hit'],['#dRound','round']].forEach(function(d){
        var v=num(d[0]);
        if(v===prev[d[1]]) return;
        var grewBlocked=(d[1]==='blocked'&&Number(v)>Number(prev[d[1]]||0));
        prev[d[1]]=v;
        var el=$(d[0]); var cell=el&&el.closest?el.closest('.cell'):null;
        if(cell){
          cell.classList.remove('is-updated');
          void cell.offsetWidth;                       // 强制重排以重启动画
          cell.classList.add('is-updated');
          (function(c){ setTimeout(function(){ c.classList.remove('is-updated'); },460); })(cell);
        }
        if(grewBlocked){
          dash.classList.add('is-blocked');
          clearTimeout(blockedTimer);
          blockedTimer=setTimeout(function(){ dash.classList.remove('is-blocked'); },900);
        }
      });
      syncPhase();
    }
    if('MutationObserver' in window){
      /* 三个观察者都过滤了自身会写入的属性，避免回调递归 */
      new MutationObserver(observeNumbers).observe(body||dash,
        {childList:true,characterData:true,subtree:true});
      new MutationObserver(syncPhase).observe(dash,{attributes:true,attributeFilter:['data-state']});
      if(thinking) new MutationObserver(syncPhase).observe(thinking,{attributes:true,attributeFilter:['class']});
    }
    observeNumbers();   // 同步初始态（纯浏览回显终态时同样正确）
  }

  /* ③a 证据页：从 Store 报告恢复逐轮表 + 结论 */
  function restoreRounds(report){
    var body=$('#roundBody'); if(!body) return;
    body.innerHTML='';
    var empty=$('#roundEmpty'); if(empty)empty.classList.add('hidden');
    var map={BLOCKED:['blocked','BLOCKED'],ANOMALY:['anomaly','ANOMALY'],NORMAL:['normal','NORMAL'],TIMEOUT:['deg','TIMEOUT']};
    report.rounds.forEach(function(x){
      var cls=map[x.response_class]||['normal','UNKNOWN'];
      var tr=document.createElement('tr'); tr.setAttribute('data-round',String(x.round_no));
      /* 用 DOM 构造，避免注入；字段统一走 esc */
      tr.innerHTML =
        '<td>'+x.round_no+'</td>'+
        '<td class="mono">'+esc(x.round_id)+'</td>'+
        '<td><span class="tag normal">'+esc(x.strategy_tag)+'</span></td>'+
        '<td><span class="tag '+cls[0]+'">'+cls[1]+'</span></td>'+
        '<td>'+esc(x.verdict)+' · '+esc(x.validation_result)+'</td>'+
        '<td>'+x.cost_ms+' ms</td>'+
        '<td>'+(x.degraded_flag?'DEGRADED':'—')+'</td>';
      body.appendChild(tr);
    });
    var key=document.createElement('tr'); key.className='is-key';
    /* 关键路径标记：命中轮加视觉强调 */
    var hit=report.rounds.find(function(x){return x.hit_signal;});
    if(hit){ var row=body.querySelector('tr[data-round="'+hit.round_no+'"]'); if(row)row.classList.add('is-key'); }
  }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){
    return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }
  /* ③a-2 v0.22 独立裁决双轨：数据只来自 report.credibility（旧缓存按同一规则现算）。
     形状 + 中文短标签 + 明细表三重编码，不依赖颜色；两轨错位的格子即待复核样本。 */
  var ORC_SHORT={CONFIRMED:'确认',REFUTED:'证伪',MISSED:'漏报',
    UNCONFIRMED:'不确认',TRUE_NEGATIVE:'未触发',NOT_APPLICABLE:'不适用',EMPTY:'未使用'};
  var ORC_CLASH={REFUTED:1,MISSED:1,UNCONFIRMED:1};
  function orcCell(row,kind){
    var v=row?row.oracle:'EMPTY';
    var el=document.createElement('i');
    el.className='orc-cell'+(ORC_CLASH[v]?' is-clash':'')+(v==='EMPTY'?' is-empty':'');
    el.setAttribute('data-track',kind);
    el.setAttribute('data-v',v);
    if(row){
      el.setAttribute('data-round',String(row.round_no));
      el.setAttribute('aria-label','第 '+row.round_no+' 轮，模型声称'+(row.ai_claim?'存在漏洞':'未发现')+
        '，独立裁决'+(P.ORACLE_CN[v]||v));
      el.setAttribute('title','第 '+row.round_no+' 轮 · '+row.gt_note);
    }else{
      el.setAttribute('aria-label','攻破后未投递的轮次');
    }
    var no=document.createElement('span'); no.className='orc-cell__no mono';
    no.textContent=row?('0'+row.round_no).slice(-2):'—'; el.appendChild(no);
    var g=document.createElement('span'); g.className='orc-cell__g';
    g.setAttribute('aria-hidden','true'); el.appendChild(g);
    var t=document.createElement('span'); t.className='orc-cell__t'; el.appendChild(t);
    return el;
  }
  function renderOracle(r){
    var card=$('#oracleCard'); if(!card)return;
    var cr=r.credibility||P.buildCredibility(r);
    var cap=cr.cap||8, rows=cr.rows||[];
    var set=$('#orcSet'); if(set)set.textContent=cr.label_set+' / '+cr.version;

    var tracks=$('#orcTracks'); if(tracks)tracks.innerHTML='';
    [['claim','AI 声称','MODEL CLAIM'],['oracle','独立裁决','ORACLE VERDICT']].forEach(function(t){
      var line=document.createElement('div'); line.className='orc-track orc-track--'+t[0];
      var lab=document.createElement('div'); lab.className='orc-track__label';
      var b=document.createElement('b'); b.textContent=t[1]; lab.appendChild(b);
      var s=document.createElement('span'); s.className='mono'; s.textContent=t[2]; lab.appendChild(s);
      line.appendChild(lab);
      var cells=document.createElement('div'); cells.className='orc-track__cells';
      for(var n=1;n<=cap;n++){
        var row=null;
        for(var k=0;k<rows.length;k++){ if(rows[k].round_no===n){ row=rows[k]; break; } }
        var c=orcCell(row,t[0]);
        if(t[0]==='claim'){
          c.setAttribute('data-claim',row?(row.ai_claim?'pos':'neg'):'empty');
          c.querySelector('.orc-cell__t').textContent=row?(row.ai_claim?'声称阳性':'未发现'):'';
        }else{
          c.querySelector('.orc-cell__t').textContent=ORC_SHORT[row?row.oracle:'EMPTY']||'';
        }
        cells.appendChild(c);
      }
      line.appendChild(cells);
      if(tracks)tracks.appendChild(line);
    });

    var stats=$('#orcStats'); if(stats)stats.innerHTML='';
    var sig=cr.signalRounds.map(function(n){ return 'R'+('0'+n).slice(-2); }).join(' / ')||'无';
    [['AI 声称阳性',String(cr.claims)],['验证器确认',String(cr.confirmed)],
     ['待复核轮次',String(cr.disagreement)],['信息增益轮',sig]].forEach(function(p){
      var d=document.createElement('div'); d.className='orc-stat';
      var l=document.createElement('span'); l.className='lbl'; l.textContent=p[0]; d.appendChild(l);
      var v=document.createElement('b'); v.textContent=p[1]; d.appendChild(v);
      if(stats)stats.appendChild(d);
    });

    var detail=$('#orcDetail'); if(detail)detail.innerHTML='';
    var clashes=rows.filter(function(x){ return !!ORC_CLASH[x.oracle]; });
    var h=document.createElement('h3'); h.className='orc-detail__h';
    h.textContent=clashes.length?'待复核轮次 · 逐轮核对':'本次两轨一致';
    if(detail)detail.appendChild(h);
    if(!clashes.length){
      var p0=document.createElement('p'); p0.className='orc-detail__none';
      p0.textContent='没有出现证伪、漏报或降级不确认的轮次；这不代表系统不会误报，只代表本次剧本未触发分歧。';
      if(detail)detail.appendChild(p0);
    }else{
      var tbl=document.createElement('div'); tbl.className='tbl-scroll';
      var table=document.createElement('table'); table.className='tbl';
      var thead=document.createElement('thead'); thead.innerHTML=
        '<tr><th>轮次</th><th>模型声称</th><th>点位标注</th><th>独立裁决</th><th>标注说明</th></tr>';
      table.appendChild(thead);
      var tbody=document.createElement('tbody');
      clashes.forEach(function(x){
        var tr=document.createElement('tr'); tr.className='is-key';
        [[('0'+x.round_no).slice(-2),'mono'],[x.ai_claim?'存在漏洞':'未发现',''],
         [x.gt_ref?(x.gt_triggered?'点位已触发':'点位未触发'):'—',''],
         [P.ORACLE_CN[x.oracle]||x.oracle,''],[x.gt_note||'—','']].forEach(function(c){
          var td=document.createElement('td'); if(c[1])td.className=c[1];
          td.textContent=c[0]; tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody); tbl.appendChild(table);
      if(detail)detail.appendChild(tbl);
    }
    /* 结论优先级：下方结果卡的 verdict 是「模型侧判定」，此处给出独立裁决的复核结果。
       两者并列而不互相覆盖，出现分歧时明确以裁决为准，避免页面上出现两个打架的结论。 */
    var vn=$('#orcVerdict');
    if(vn){
      var word=($('#verdictWord')?$('#verdictWord').textContent:'—').trim();
      var tone='ok',txt;
      if(cr.na===cr.used){
        tone='na';
        txt='独立裁决优先 · 本次 '+cr.used+' 轮全部为「不适用（纯模拟）」；模型侧「'+word+'」不构成对任何真实目标的结论。';
      }else if(cr.disagreement){
        tone='warn';
        txt='独立裁决优先 · 模型侧判定「'+word+'」，独立裁决确认 '+cr.confirmed+
          ' / 证伪 '+cr.refuted+' / 降级不确认 '+cr.unconfirmed+'；共 '+cr.disagreement+
          ' 轮待复核，模型侧结论不作为最终判定。';
      }else{
        txt='独立裁决优先 · 模型侧判定「'+word+'」获 '+cr.confirmed+' 条确认，无待复核轮次；两轨一致。';
      }
      vn.setAttribute('data-tone',tone);
      vn.textContent=txt;
    }
    var note=$('#orcNote');
    if(note)note.textContent='判据：'+cr.label_set+' 实验前点位标注（'+cr.version+
      '） · 不读取模型置信度，也不采信模型原文自证的 validation:PASSED · '+
      '演示计数，不构成实测误报率 · 零外部请求 · 真实系统需接入靶场服务端状态断言';
  }

  function bootEvidence(){
    var r=P.Store.getReport();
    if(!r){
      var e=$('#evidenceEmpty'); if(e)e.classList.remove('hidden');
      var wrap=$('#evidenceWrap'); if(wrap)wrap.classList.add('hidden');
      return;
    }
    var e=$('#evidenceEmpty'); if(e)e.classList.add('hidden');
    var wrap=$('#evidenceWrap'); if(wrap)wrap.classList.remove('hidden');
    P.renderResult(r); restoreRounds(r); renderOracle(r);
    var st=P.resolveTerminalState(r);
    var badge=$('#evidenceState'); if(badge){badge.textContent=st.label;badge.setAttribute('data-state',st.state);}
  }

  /* ③b 报告页：从 Store 报告恢复 5 附录 */
  function bootReport(){
    var r=P.Store.getReport();
    var empty=$('#reportEmpty'), wrap=$('#reportCardWrap');
    if(!r){
      if(empty)empty.classList.remove('hidden');
      if(wrap)wrap.classList.add('hidden');
      return;
    }
    if(empty)empty.classList.add('hidden');
    if(wrap)wrap.classList.remove('hidden');
    P.renderReport(r);
    /* Ctrl+P 与浏览器菜单打印同样展开 JSON 附录，避免折叠内容在 PDF 里丢失 */
    window.addEventListener('beforeprint',function(){
      $$('details.raw').forEach(function(d){ d.open=true; });
    });
  }

  /* ③c 历史页 */
  function bootHistory(){
    var hist=P.Store.getHistory();
    var body=$('#historyBody'); if(!body)return;
    if(!hist.length){ var e=$('#historyEmpty'); if(e)e.classList.remove('hidden'); return; }
    var empty=$('#historyEmpty'); if(empty)empty.classList.add('hidden');
    var frame=$('#historyFrame'); if(frame)frame.classList.remove('hidden');
    body.innerHTML=hist.map(function(h){
      return '<tr><td class="mono">'+esc(h.id)+'</td><td class="mono">'+esc(h.time)+'</td><td>'+esc(h.alias)+
        '</td><td class="mono">'+esc(profileLabelOf(h.script))+'</td><td>'+h.rounds+'</td><td class="mono">'+esc(h.reason)+
        '</td><td>mock_flag=true</td></tr>';
    }).join('');
  }

  /* ③d 配置中心（v0.20）：把配置拆成两层 ——
     「下一次任务默认值」可改，写 Store.defaults，仅预填任务台表单，绝不置位 pendingRun；
     「边界与契约 / 剧本库 / 终态判定 / 最近任务」全部实时取自引擎导出（CONFIG / SCRIPTS /
     SCOPE / Store），页面不写死参数值。用户输入一律以 textContent 写入，避免注入。 */
  var FACTORY={url:'http://127.0.0.1/lab/sqli_01.php'};
  var LETTER=['A','B','C','D','E'];

  function mk(tag,cls,text){
    var n=document.createElement(tag);
    if(cls)n.className=cls;
    if(text!==undefined&&text!==null)n.textContent=String(text);
    return n;
  }

  /* 画像逐轮预览：复用运行时决策与响应模拟。画像键作固定示例种子，
     使配置页展示一个可核对的样例；实际任务的攻破轮由网址 + 任务 ID 派生，不固定。 */
  function previewProfile(prof,cap){
    var hist=[], out=[];
    var live=P.agentPlanOf(prof,P.rngOf(P.seedOf(prof.key)));
    for(var no=1;no<=cap;no++){
      var plan=P.planNextRound(hist,live,no);
      var resp=P.agentResponse(plan.op,live,no,plan.degraded);
      out.push({no:no,cls:resp.cls,degraded:!!resp.degraded,triggered:!!resp.triggered,op:plan.op.id});
      hist.push({opId:plan.op.id,cls:resp.cls,sig:resp.sig});
      if(resp.triggered)break;   // 与运行时同源：确认攻破即停，不跑满格
    }
    return out;
  }

  function bootSettings(){
    var c=P.CONFIG||{};
    var put=function(sel,v){var e=$(sel);if(e)e.textContent=String(v);};
    put('#cfgMode',c.ENGINE_MODE); put('#cfgMax','攻破即停'); put('#cfgTick',c.TICK_SPEED);
    put('#cfgAdapter','MOCK'); put('#cfgRuleset','LAB-RULESET-01'); put('#cfgContract','1.0');
    put('#cfgApi',c.API_BASE_URL||'—');
    put('#cfgScnCount',Object.keys(P.AGENT_PROFILES||{}).length);

    /* 授权白名单：真值来自引擎 SCOPE；两条通配规则与 scopeOK() 的判定一致 */
    var chips=$('#cfgChips');
    if(chips&&P.SCOPE){
      P.SCOPE.forEach(function(h){ chips.appendChild(mk('span','cfg-chip',h)); });
      ['*.lab','lab-*'].forEach(function(h){ chips.appendChild(mk('span','cfg-chip cfg-chip--wild',h)); });
    }

    /* 靶场画像：由 URL 派生，用户不选。逐轮预览直接复用运行时的
       planNextRound / agentResponse 推演，显示的是真会跑出来的结果，不是文案描述。 */
    var scnWrap=$('#cfgScn');
    if(scnWrap&&P.AGENT_PROFILES){
      var PROFILE_ORDER=['EASY','HARD','DECEPTIVE'];
      var PROFILE_RULE={
        EASY:'路径不含 hard / fort / 加固，也不含 trap / deceptive / 诱导',
        HARD:'路径含 hard / fort / 加固',
        DECEPTIVE:'路径含 trap / deceptive / 诱导'
      };
      var STATE_NAME={hit:'HIT · 攻破即停',nofind:'GUARD · 异常护栏',degraded:'DEGRADED · 降级后攻破'};
      PROFILE_ORDER.forEach(function(key){
        var prof=P.AGENT_PROFILES[key]; if(!prof)return;
        var cap=c.MAX_ROUNDS||8;
        var steps=previewProfile(prof,cap);
        var breached=steps.some(function(s){return s.triggered;});
        var degN=steps.filter(function(s){return s.degraded;}).length;
        var termState=!breached?'nofind':(degN?'degraded':'hit');
        var card=mk('article','cfg-scn__card'); card.setAttribute('data-profile',key);
        var top=mk('div','cfg-scn__top');
        top.appendChild(mk('span','cfg-scn__tag',String(PROFILE_ORDER.indexOf(key)+1)));
        top.appendChild(mk('h3','cfg-scn__name',prof.label));
        top.appendChild(mk('span','cfg-scn__en',key));
        card.appendChild(top);
        card.appendChild(mk('p','cfg-scn__meta',
          '示例 '+steps.length+' 轮攻破即停 · 终态 '+STATE_NAME[termState]+' · 降级轮 '+degN));
        card.appendChild(mk('p','cfg-scn__rule','派生条件：'+PROFILE_RULE[key]+' · 实际攻破轮由网址与任务种子派生'));
        var rail=mk('div','cfg-rail'); rail.setAttribute('aria-hidden','true');
        steps.forEach(function(s){
          var cell=mk('i',null,s.no);
          cell.setAttribute('data-cls',s.cls);
          if(s.degraded)cell.classList.add('is-deg');
          rail.appendChild(cell);
        });
        /* 只列示例实际投递轮次，不补齐到护栏容量 */
        card.appendChild(rail);
        scnWrap.appendChild(card);
      });
    }

    /* 默认值表单 */
    var urlEl=$('#cfgUrl'), msg=$('#cfgMsg');
    function say(t,k){ if(!msg)return; msg.textContent=t||''; msg.className='cfg-msg'+(k?' '+k:''); }
    function read(){
      return {url:urlEl?urlEl.value.trim():FACTORY.url};
    }
    function fill(d){
      if(!d)return;
      if(urlEl&&d.url)urlEl.value=d.url;

    }
    /* 待改标记：当前值与已保存默认值（无则出厂值）不一致的行点亮方块 */
    function mark(){
      var base=(P.Store.getDefaults&&P.Store.getDefaults())||FACTORY;
      var cur=read();
      ['url'].forEach(function(k){
        var row=$('.cfg-row[data-row="'+k+'"]');
        if(row)row.classList.toggle('is-dirty',String(cur[k])!==String(base[k]));
      });
    }
    fill(P.Store.getDefaults?P.Store.getDefaults():null);
    mark();

    function save(){
      var d=read();
      if(!/^https?:\/\/[^\s]+$/i.test(d.url)){
        say('目标地址需以 http:// 或 https:// 开头','err');
        if(urlEl)urlEl.focus();
        return false;
      }
      if(P.Store.setDefaults)P.Store.setDefaults(d);
      mark(); say('已保存 · 任务台将按此预填，不会自动执行','ok');
      return true;
    }
    var saveBtn=$('#cfgSave'); if(saveBtn)saveBtn.addEventListener('click',save);
    var resetBtn=$('#cfgReset');
    if(resetBtn)resetBtn.addEventListener('click',function(){
      if(P.Store.clearDefaults)P.Store.clearDefaults();
      fill(FACTORY); mark(); say('已恢复出厂默认值','warn');
    });
    function go(href){
      var a=$('#cfgNav');
      if(a){ a.setAttribute('href',href); a.click(); }   // data-nav 圆形揭幕
      else location.href=href;
    }
    var toBtn=$('#cfgToConsole');
    if(toBtn)toBtn.addEventListener('click',function(){ if(save())go('console.html'); });
    if(urlEl)urlEl.addEventListener('input',mark);

    /* 最近一次任务：只读回显 cfg 快照与报告终态，不写任何 Store */
    var rows=$('#cfgLastRows'), empty=$('#cfgLastEmpty'), repBtn=$('#cfgGoReport');
    var cfgP=P.Store.getCfg?P.Store.getCfg():null;
    var repP=P.Store.getReport?P.Store.getReport():null;
    function kv(label,value){
      var d=mk('div','cfg-last__row');
      d.appendChild(mk('span',null,label));
      d.appendChild(mk('b',null,value));
      return d;
    }
    if(rows&&(cfgP||repP)){
      rows.innerHTML='';
      if(cfgP){
        rows.appendChild(kv('目标 / Target',cfgP.url||'—'));
        rows.appendChild(kv('靶场画像 / Profile',profileLabelOf(cfgP.script)));
      }
      if(repP){
        var st=P.resolveTerminalState(repP);
        var stRow=mk('div','cfg-last__row');
        stRow.appendChild(mk('span',null,'终态 / State'));
        var stCell=mk('b');
        stCell.appendChild(mk('span','cfg-last__badge',st.label));
        stRow.appendChild(stCell);
        rows.appendChild(stRow);
        rows.appendChild(kv('轮次 / Rounds',repP.rounds?repP.rounds.length:0));
        if(repP.task)rows.appendChild(kv('任务 ID / Task',repP.task.task_id));
        if(repBtn)repBtn.classList.remove('hidden');
      }
      rows.classList.remove('hidden');
      if(empty)empty.classList.add('hidden');
    }
    var goCon=$('#cfgGoConsole'); if(goCon)goCon.addEventListener('click',function(){ go('console.html'); });
    var goRepBtn=$('#cfgGoReport'); if(goRepBtn)goRepBtn.addEventListener('click',function(){ go('report.html'); });
  }

  /* ④ 任务台：校验通过后写配置快照 + 一次性 pendingRun 意图，拦截引擎本地执行，
     交 data-nav 过渡翻到监控页；仅监控页消费 pendingRun 后执行任务（只跑一次）。
     捕获阶段 + stopImmediatePropagation，确保 console.js 的 startBtn→runTask 不在本页重复执行。
     测试不经 app.js，故 101 项不受影响。 */
  function bootConsole(){
    /* 配置中心保存的默认值：只预填表单初始值，不置位执行意图、不触发任何任务 */
    var d=P.Store.getDefaults?P.Store.getDefaults():null;
    if(d){
      var uEl=$('#urlInput');
      if(uEl&&d.url)uEl.value=d.url;
    }
    /* 唯一入口：填网址 → 开始攻击。靶场强度与漏洞类型均由目标自身决定，
       用户不再选择剧本或漏洞类型（那是攻击的产出，不是输入）。 */
    /* 按钮点击与输入框回车共用同一提交路径，不允许回车在本地偷偷跑一份任务 */
    function submit(){
      var urlEl=$('#urlInput'); if(!urlEl)return false;
      var url=urlEl.value.trim();
      var chk=$('#authChk');
      var msg=$('#msg');
      if(chk&&!chk.checked){ P.syncStart(); return false; } // 授权闸门：未勾选则不翻页，引擎提示
      if(!/^https?:\/\/[^\s]+$/i.test(url)){
        if(msg){msg.textContent='请输入以 http:// 或 https:// 开头的合法地址';msg.className='err';}
        return false;
      }
      P.Store.setCfg({url:url, script:'AGENT_LOOP', agent:true});
      /* 一次性执行意图：只有真实提交才置位；监控页读后立即清除并消费。
         cfg 仅回填只读快照条，不再作为执行开关，故浏览/导航/刷新都不会触发任务。 */
      if(P.Store.setPendingRun) P.Store.setPendingRun();
      var link=$('#runLink');
      if(link) link.click();              // 触发 core.js 的圆形揭幕跨页过渡
      else location.href='monitor.html';
      return true;
    }
    var btn=$('#startBtn');
    if(btn) btn.addEventListener('click',function(e){
      if(submit()) e.stopImmediatePropagation();
    },true);
    var urlEl=$('#urlInput');
    if(urlEl) urlEl.addEventListener('keydown',function(e){
      if(e.key!=='Enter')return;
      if(submit()) e.stopImmediatePropagation();
    },true);
    /* 授权勾选变化时同步入口可用态（引擎已绑 change，这里仅兜底可见性） */
    var chk=$('#authChk');
    if(chk) chk.addEventListener('change',function(){ P.syncStart(); });
  }

  function init(){
    markNav();
    renderMetrics();
    if(page==='console')  bootConsole();
    /* 先挂呈现层观察者，再让监控页消费意图 / 回显终态，确保全流程反馈都被捕捉 */
    if(page==='monitor'){ bootTelemetry(); bootMonitor(); }
    if(page==='evidence') bootEvidence();
    if(page==='report')   bootReport();
    if(page==='history')  bootHistory();
    if(page==='settings') bootSettings();
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
  else init();
})();
