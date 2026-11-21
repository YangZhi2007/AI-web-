/**
 * app.js — 验真大屏交互逻辑
 *
 * 职责：
 *   1. 渲染六阶段骨架，订阅 SSE 后逐帧更新状态与进度
 *   2. 提交任务（真实 API 或 mock 降级）
 *   3. 终态跳报告页，task_id 经 URL 参数传递
 *
 * 阶段表与后端 config.php 的 STAGES 严格一一对应（key 与 label 必须一致）。
 * mock 模式：后端不可用时用定时器推进状态，所有日志标注"模拟"，不伪装真实推理。
 */

(function () {
  'use strict';

  // 与 config.php STAGES 同步；deep 阶段在 head.py 内部完成，前端仍展示该阶段
  var STAGES = [
    { key: 'recon',  label: '正在爬取靶场页面与 JS 情报' },
    { key: 'head',   label: '大模型正在研判漏洞假设' },
    { key: 'deep',   label: '正在补充漏洞细节' },
    { key: 'verify', label: '验证器正在实测漏洞' },
    { key: 'report', label: '正在生成漏洞报告' },
    { key: 'done',   label: '分析完成' }
  ];

  var el = {
    target:    document.getElementById('target'),
    authId:    document.getElementById('authId'),
    authChk:   document.getElementById('authChk'),
    startBtn:  document.getElementById('startBtn'),
    msg:       document.getElementById('msg'),
    stages:    document.getElementById('stages'),
    stateText: document.getElementById('stateText'),
    progressFill: document.getElementById('progressFill'),
    progressNum:  document.getElementById('progressNum'),
    logBody:   document.getElementById('logBody'),
    logCount:  document.getElementById('logCount')
  };

  var subscription = null;
  var mockTimer = null;

  /** 渲染六阶段骨架 */
  function renderStages() {
    el.stages.innerHTML = STAGES.map(function (s) {
      return '<div class="stage" data-stage="' + s.key + '">' +
        '<div class="stage__rail"></div>' +
        '<div class="stage__key">' + s.key + '</div>' +
        '<div class="stage__label">' + s.label + '</div>' +
        '</div>';
    }).join('');
  }

  /** 按任务状态更新视图：阶段点亮、进度条、日志 */
  function renderTask(task) {
    var currentKey = task.stage;
    var found = false;

    STAGES.forEach(function (s) {
      var node = el.stages.querySelector('[data-stage="' + s.key + '"]');
      if (!node) return;
      node.classList.remove('is-active', 'is-done');
      if (found) return;
      if (s.key === currentKey) {
        node.classList.add('is-active');
        found = true;
      } else if (STAGES.findIndex(function (x) { return x.key === currentKey; }) >
                 STAGES.findIndex(function (x) { return x.key === s.key; })) {
        node.classList.add('is-done');
      }
    });

    var pct = Number(task.progress || 0);
    el.progressFill.style.width = pct + '%';
    el.progressNum.textContent = pct + '%';
    el.stateText.textContent = task.stage_label || task.state || '待启动';

    var logs = task.logs || [];
    el.logCount.textContent = logs.length + ' 行';
    if (logs.length === 0) {
      el.logBody.innerHTML = '<div class="logbook__empty">任务启动后，这里逐行显示各阶段输出</div>';
    } else {
      el.logBody.innerHTML = logs.slice(-80).map(function (line) {
        var isKey = /条假设|AI提出|完成|失败|超时/.test(line);
        return '<div class="logbook__line' + (isKey ? ' is-key' : '') + '">' + escapeHtml(line) + '</div>';
      }).join('');
      el.logBody.scrollTop = el.logBody.scrollHeight;
    }
  }

  /** 设置界面为运行态 */
  function setRunning(running) {
    el.startBtn.disabled = running;
    el.startBtn.textContent = running ? '验真中' : '开始验真';
    el.target.disabled = running;
    el.authId.disabled = running;
  }

  function setMsg(text, isError) {
    el.msg.textContent = text;
    el.msg.className = 'msg' + (isError ? ' is-error' : '');
  }

  /** 进入报告页 */
  function gotoReport(taskId) {
    location.href = 'report.html?id=' + encodeURIComponent(taskId);
  }

  /** 真实提交：调 API，订阅 SSE */
  function startReal(target, authId) {
    setMsg('正在创建任务…');
    Api.submitScan(target, authId).then(function (res) {
      setMsg('任务 ' + res.task_id + ' 已创建，等待调度');
      setRunning(true);
      subscription = Api.subscribe(res.task_id, {
        onUpdate: function (task) { renderTask(task); },
        onDone: function (state) {
          setRunning(false);
          if (state === 'done') {
            setMsg('验真完成，正在打开报告');
            gotoReport(res.task_id);
          } else {
            setMsg('任务终止：' + state, true);
          }
        },
        onError: function (err) {
          setRunning(false);
          setMsg('进度错误：' + err.message, true);
        }
      });
    }).catch(function (err) {
      setMsg('后端不可用（' + err.message + '），已切换演示模式');
      startMock(target);
    });
  }

  /** 演示模式：本地推进六阶段，所有输出标注"模拟" */
  function startMock(target) {
    setRunning(true);
    var idx = 0;
    var mockLogs = [
      '[模拟] 后端未连接，以下为演示数据',
      '[模拟] 目标：' + target,
      '[模拟] 情报收集完成：5 页面 / 6 JS / 4 接口'
    ];
    var step = function () {
      if (idx >= STAGES.length) {
        clearInterval(mockTimer);
        setRunning(false);
        setMsg('演示完成（非真实推理）');
        return;
      }
      var s = STAGES[idx];
      renderTask({
        stage: s.key,
        stage_label: s.label + '（模拟）',
        progress: Math.round((idx + 1) / STAGES.length * 100),
        logs: mockLogs
      });
      mockLogs.push('[模拟] ' + s.label + ' 完成');
      idx++;
    };
    step();
    mockTimer = setInterval(step, 900);
  }

  /** 按钮点击 */
  el.startBtn.addEventListener('click', function () {
    var target = el.target.value.trim();
    var authId = el.authId.value.trim();

    if (!target) { setMsg('请输入靶场地址', true); return; }
    if (!el.authChk.checked) { setMsg('请先确认已获书面授权', true); return; }
    if (!authId) { setMsg('请输入授权编号', true); return; }

    if (subscription) { subscription.close(); subscription = null; }
    if (mockTimer) { clearInterval(mockTimer); mockTimer = null; }

    // 后端是否可用由 Api.submitScan 的失败降级决定
    startReal(target, authId);
  });

  /** HTML 转义，防日志内容注入 */
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  // 初始化
  renderStages();
})();
