/* =============================================================================
 * app.js · v0.17 翻页式架构的跨页编排层
 * -----------------------------------------------------------------------------
 * 依赖 console.js 暴露的 window.Probe（引擎/状态机/Store 均在其中）。
 * 职责：① 顶栏当前项高亮（按 data-page）；② 监控页从 Store 恢复配置并自动
 * 执行 runTask（动画与任务逻辑跨页同步）；③ 证据/报告/历史页从 Store 恢复
 * 渲染；④ 任务台提交后写入配置快照；⑤ 会话指标从历史重算。
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

  /* ② 监控页：恢复配置 → 自动跑 → 状态机驱动态势动画；未提交则显示引导空态 */
  function bootMonitor(){
    var cfg = P.Store.getCfg();
    var hint = $('#monitorHint');
    var goBtn = $('#goConsole');
    if(!cfg){
      if(hint) hint.classList.remove('hidden');
      if(goBtn) goBtn.classList.remove('hidden');
      var dash=$('#dash'); if(dash){ dash.dataset.state='idle'; var t=$('#dashState'); if(t)t.textContent='IDLE'; }
      return;
    }
    if(hint) hint.classList.add('hidden');
    if(goBtn) goBtn.classList.add('hidden');
    /* 回填配置快照条（只读展示） */
    var put=function(sel,v){var e=$(sel);if(e)e.textContent=v;};
    put('#mTarget',cfg.url); put('#mType',({sqli:'SQL 注入',xss:'XSS',upload:'文件上传'})[cfg.vulnType]||cfg.vulnType);
    put('#mScript',cfg.script); put('#mScope',/lab|localhost|127\.0\.0\.1|::1/.test(cfg.url)?'授权靶场':'越界 · 纯模拟');
    /* 让引擎从已存配置执行；授权视为已在任务台确认 */
    P.runTask({url:cfg.url, vulnType:cfg.vulnType, script:cfg.script, authed:true});
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

  /* ④ 任务台：校验通过后写配置快照，拦截引擎本地执行，交 data-nav 过渡翻到监控页自动跑。
     捕获阶段 + stopImmediatePropagation，确保 console.js 的 startBtn→runTask 不在本页重复执行，
     任务只在监控页跑一次（动画与任务逻辑同页同步）。测试不经 app.js，故 101 项不受影响。 */
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
    if(page==='monitor')  bootMonitor();
    if(page==='evidence') bootEvidence();
    if(page==='report')   bootReport();
    if(page==='history')  bootHistory();
    if(page==='settings') bootSettings();
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
  else init();
})();
