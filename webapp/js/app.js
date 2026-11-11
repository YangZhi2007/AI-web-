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
      put('#mTarget',cfg.url); put('#mType',({sqli:'SQL 注入',xss:'XSS',upload:'文件上传'})[cfg.vulnType]||cfg.vulnType);
      put('#mScript',cfg.script); put('#mScope',/lab|localhost|127\.0\.0\.1|::1/.test(cfg.url)?'授权靶场':'越界 · 纯模拟');
    }

    /* 一次性消费用户意图：读即清除，保证刷新/后退/跨页不重复执行（跨文档 runTask 的
       if(running) 守卫只在同页有效，幂等必须靠这里清除 pendingRun 保证）。 */
    var pending = !!(P.Store.getPendingRun && P.Store.getPendingRun());
    if(pending) P.Store.clearPendingRun();

    if(pending && cfg){
      if(hint) hint.classList.add('hidden');
      if(goBtn) goBtn.classList.add('hidden');
      /* 授权视为已在任务台勾选确认；仅此处、仅此刻执行一次 */
      P.runTask({url:cfg.url, vulnType:cfg.vulnType, script:cfg.script, authed:true});
      return;
    }

    /* 纯浏览：有历史报告则只读回显最近一次终态（不执行、不写历史/上报），否则保持 idle */
    var report = P.Store.getReport && P.Store.getReport();
    if(report){
      if(hint) hint.classList.add('hidden');
      if(goBtn) goBtn.classList.add('hidden');
      if(P.applyTerminalState) P.applyTerminalState(report);  // 仅渲染终态，绝无副作用写
      return;
    }

    /* 无报告：保持 idle；无配置快照时给引导空态 */
    if(dash){ dash.dataset.state='idle'; var t=$('#dashState'); if(t)t.textContent='IDLE'; }
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
  function bootEvidence(){
    var r=P.Store.getReport();
    if(!r){
      var e=$('#evidenceEmpty'); if(e)e.classList.remove('hidden');
      var wrap=$('#evidenceWrap'); if(wrap)wrap.classList.add('hidden');
      return;
    }
    var e=$('#evidenceEmpty'); if(e)e.classList.add('hidden');
    var wrap=$('#evidenceWrap'); if(wrap)wrap.classList.remove('hidden');
    P.renderResult(r); restoreRounds(r);
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
        '</td><td class="mono">'+esc(h.script)+'</td><td>'+h.rounds+'</td><td class="mono">'+esc(h.reason)+
        '</td><td>mock_flag=true</td></tr>';
    }).join('');
  }

  /* ③d 配置快照页 */
  function bootSettings(){
    var c=P.CONFIG;
    var put=function(sel,v){var e=$(sel);if(e)e.textContent=String(v);};
    put('#cfgMax',c.MAX_ROUNDS); put('#cfgMode',c.ENGINE_MODE);
    put('#cfgTick',c.TICK_SPEED); put('#cfgAdapter','MOCK');
    put('#cfgRuleset','LAB-RULESET-01'); put('#cfgContract','1.0');
  }

  /* ④ 任务台：校验通过后写配置快照 + 一次性 pendingRun 意图，拦截引擎本地执行，
     交 data-nav 过渡翻到监控页；仅监控页消费 pendingRun 后执行任务（只跑一次）。
     捕获阶段 + stopImmediatePropagation，确保 console.js 的 startBtn→runTask 不在本页重复执行。
     测试不经 app.js，故 101 项不受影响。 */
  function bootConsole(){
    var btn=$('#startBtn');
    if(btn){
      btn.addEventListener('click',function(e){
        var urlEl=$('#urlInput'); if(!urlEl)return;
        var url=urlEl.value.trim();
        var chk=$('#authChk');
        var msg=$('#msg');
        if(chk&&!chk.checked){ P.syncStart(); return; } // 授权闸门：未勾选则不翻页，引擎提示
        if(!/^https?:\/\/[^\s]+$/i.test(url)){
          if(msg){msg.textContent='请输入以 http:// 或 https:// 开头的合法地址';msg.className='err';}
          return;
        }
        e.stopImmediatePropagation();
        P.Store.setCfg({url:url, vulnType:$('#typeSel')?$('#typeSel').value:'sqli',
          script:$('#scriptSel')?$('#scriptSel').value:'CONVERGE_3'});
        /* 一次性执行意图：只有真实点击「开始分析」才置位；监控页读后立即清除并消费。
           cfg 仅回填只读快照条，不再作为执行开关，故浏览/导航/刷新都不会触发任务。 */
        if(P.Store.setPendingRun) P.Store.setPendingRun();
        var link=$('#runLink');
        if(link) link.click();            // 触发 core.js 的圆形揭幕跨页过渡
        else location.href='monitor.html';
      },true);
    }
    /* 授权勾选变化时同步 startBtn 可用态（引擎已绑 change，这里仅兜底可见性） */
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
