/* =============================================================================
 * webapp/js/api.js
 * -----------------------------------------------------------------------------
 * 本文件为前端→后端(业务调度&存储层)的接口预留层。
 * 当前演示 ENGINE_MODE='mock' 不调用任何真实请求；接入真实后端时由 HttpEngine
 * 调用此处方法。后端归属：4号（前后端/平台开发）。
 *
 * 数据流向（来自团队架构图）：
 *   前端交互层  →[提交任务 / 读取结果 / 取消 / 导出]→  业务调度&存储层（4号）
 *   业务调度&存储层  →[推送进度 / 漏洞事件]→  前端交互层（SSE 事件流）
 *   业务调度&存储层  →[落库]→  MySQL（任务 / 漏洞 / Payload 记录，前端不直接调用）
 *   业务调度&存储层  →[导出]→  PDF 安全报告
 *
 * 接口契约来源：原 console.js 顶部的「字段契约」大注释已迁移至此，作为各方法的
 * 注释文档（端点 / 逐轮字段 / SSE 事件类型 / 诚信约束），避免同一份契约两处维护。
 *
 * 当前状态：所有方法均为「预留桩」——默认 reject 并提示未接入，但附带真实 fetch
 * 骨架（注释）展示对接代码。演示期绝不真正发请求，保证离线运行。
 * ============================================================================ */

/* -----------------------------------------------------------------------------
 * API_BASE_URL 与 console.js 顶部的 CONFIG.API_BASE_URL 对应。
 * console.js 的 CONFIG 是局部 const，外部取不到，此处用 window 桥接注入：
 * 若 console.js 已把 CONFIG 暴露到 window（或未来改造），优先取之；否则回落到
 * 本地占位常量（与 console.js 的 CONFIG.API_BASE_URL 保持一致）。
 * 注意：演示期即使取到真实地址也绝不发起请求（见各方法 reject 桩）。
 * -------------------------------------------------------------------------- */
const API_BASE_URL =
  (typeof window !== 'undefined' && window.CONFIG && window.CONFIG.API_BASE_URL) ||
  'http://127.0.0.1:8000/api/v1';

/* =============================================================================
 * ApiClient：前端交互层 → 业务调度&存储层 的预留接口集合
 * 所有方法当前为「已预留 / 未接入」状态。
 * ========================================================================== */
const ApiClient = {
  /* ---------------------------------------------------------------------------
   * 1) submitTask —— 提交探测任务（URL、探测选项）
   *   HTTP: POST {API_BASE_URL}/tasks
   *   入参:
   *     url    (string)  目标地址
   *     options (object) 探测选项，含 vulnType / authorizationId / group_tag 等
   *   出参: { task_id: string }
   *   归属: 4号（业务调度&存储层）
   *   状态: 已预留 / 未接入
   *   语义: 前端把目标 URL 与探测选项提交给后端，后端创建任务并返回 task_id。
   * ------------------------------------------------------------------------- */
  submitTask(url, options) {
    /* 真实对接骨架（演示期不执行）：
       const res = await fetch(API_BASE_URL + '/tasks', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ url, ...options })
       });
       if (!res.ok) throw new Error('submitTask 失败: ' + res.status);
       return res.json(); // { task_id } */
    return Promise.reject(
      new Error('未接入真实后端：submitTask 对应 POST ' + API_BASE_URL + '/tasks')
    );
  },

  /* ---------------------------------------------------------------------------
   * 2) subscribeTaskEvents —— 推送探测进度、漏洞结果（SSE / EventSource）
   *   HTTP: GET {API_BASE_URL}/tasks/{id}/events
   *   入参:
   *     taskId  (string) 任务 ID
   *     handlers { onEvent, onError, signal }
   *       onEvent(evt)        收到事件时回调
   *       onError(err)        出错时回调
   *       signal (AbortSignal) 用于取消订阅（断线用 Last-Event-ID 续传）
   *   出参: 无（通过 onEvent 回调逐条推送事件）；调用方通常返回 EventSource 句柄
   *   归属: 4号（业务调度&存储层）
   *   状态: 已预留 / 未接入
   *   语义: 订阅某任务的生命周期事件流。详情（逐轮完整记录）一律走 getTaskRounds，
   *         不塞进事件流，事件只携带轻量公共字段 + 少量附加字段。
   *
   *   事件类型（event 字段取值）：
   *     task.started        任务创建
   *     round.started       某轮开始
   *     payload.generated   策略生成
   *     request.sent        探测请求投递
   *     waf.blocked         WAF 拦截
   *     verdict.ready       判定就绪
   *     degraded            模型降级
   *     task.terminated     任务终止
   *
   *   事件公共字段（每个事件对象都包含）：
   *     task_id / round_no / event / timestamp / mock_flag / degraded_flag
   *   事件附加轻字段（按需）：strategy_tag / response_class / terminate_reason
   *   （详情 model_decision_raw / operator_chain 等一律走 GET /rounds，不进事件流）
   * ------------------------------------------------------------------------- */
  subscribeTaskEvents(taskId, handlers) {
    const onEvent = handlers && handlers.onEvent;
    const onError = handlers && handlers.onError;
    const signal = handlers && handlers.signal;
    /* 真实对接骨架（演示期不执行）：
       const es = new EventSource(API_BASE_URL + '/tasks/' + taskId + '/events');
       es.onmessage = (msg) => {
         const evt = JSON.parse(msg.data);
         if (evt.event === 'task.terminated') es.close();
         onEvent && onEvent(evt);
       };
       es.onerror = (err) => { onError && onError(err); };
       if (signal) signal.addEventListener('abort', () => es.close());
       return es; */
    return Promise.reject(
      new Error(
        '未接入真实后端：subscribeTaskEvents 对应 GET ' +
          API_BASE_URL + '/tasks/' + taskId + '/events'
      )
    );
  },

  /* ---------------------------------------------------------------------------
   * 3) getTaskRounds —— 拉取逐轮记录数组（详情一律从这里取，不塞进事件流）
   *   HTTP: GET {API_BASE_URL}/tasks/{id}/rounds
   *   入参: taskId (string) 任务 ID
   *   出参: 逐轮记录数组（Array<RoundRecord>）
   *   归属: 4号（业务调度&存储层）
   *   状态: 已预留 / 未接入
   *   单轮字段（RoundRecord）：
   *     round_no           轮次序号（从 1 开始）
   *     prev_round_id      上轮 round_id（首轮为 null）
   *     strategy_tag       变形策略标签（算子白名单内）
   *     operator_chain     算子链（仅算子编号，不含载荷文本）
   *     response_class     响应分类：BLOCKED | ANOMALY | NORMAL | TIMEOUT
   *     waf_signal         WAF 拦截特征（无则空串）
   *     verdict            判定：VULNERABLE | NOT_FOUND | NEEDS_REVIEW
   *     confidence         置信度（0~1）
   *     evidence_round_ids 证据链回溯的 round_id 列表
   *     degraded_flag      是否降级轮（true/false）
   *     cost_ms            本轮耗时（毫秒）
   *     terminate_reason   终止原因（HIT / MAX_ROUNDS / 等）
   *     model_decision_raw 模型决策原文（JSON 字符串）
   *     adapter_name       适配器名（MOCK / 真实 adapter）
   *     mock_flag          演示/契约桩标记（true 表示非实时数据）
   * ------------------------------------------------------------------------- */
  getTaskRounds(taskId) {
    /* 真实对接骨架（演示期不执行）：
       const res = await fetch(API_BASE_URL + '/tasks/' + taskId + '/rounds');
       if (!res.ok) throw new Error('getTaskRounds 失败: ' + res.status);
       return res.json(); // Array<RoundRecord> */
    return Promise.reject(
      new Error(
        '未接入真实后端：getTaskRounds 对应 GET ' +
          API_BASE_URL + '/tasks/' + taskId + '/rounds'
      )
    );
  },

  /* ---------------------------------------------------------------------------
   * 4) cancelTask —— 取消任务
   *   HTTP: POST {API_BASE_URL}/tasks/{id}/cancel
   *   入参: taskId (string) 任务 ID
   *   出参: 通常返回 { ok: true } 或后端约定的取消确认对象
   *   归属: 4号（业务调度&存储层）
   *   状态: 已预留 / 未接入
   *   语义: 前端通知后端终止指定任务的后续轮次。
   * ------------------------------------------------------------------------- */
  cancelTask(taskId) {
    /* 真实对接骨架（演示期不执行）：
       const res = await fetch(API_BASE_URL + '/tasks/' + taskId + '/cancel', {
         method: 'POST'
       });
       if (!res.ok) throw new Error('cancelTask 失败: ' + res.status);
       return res.json(); */
    return Promise.reject(
      new Error(
        '未接入真实后端：cancelTask 对应 POST ' +
          API_BASE_URL + '/tasks/' + taskId + '/cancel'
      )
    );
  },

  /* ---------------------------------------------------------------------------
   * 5) getTaskReport —— 拉取报告对象
   *   HTTP: GET {API_BASE_URL}/tasks/{id}/report
   *   入参: taskId (string) 任务 ID
   *   出参: 报告对象，结构包含：
   *         封面（任务 ID / 目标 / 授权 / 生成时间 等）
   *         执行摘要（轮数 / 耗时 / 终止原因 / 降级轮）
   *         逐轮记录（同 getTaskRounds 的 RoundRecord 数组）
   *         模型决策原文（逐轮 model_decision_raw）
   *         配置快照（分组 / 适配器 / 轮次上限 / 规则集 / 模式 / 契约版本 等）
   *   归属: 4号（业务调度&存储层）
   *   状态: 已预留 / 未接入
   *   语义: 前端渲染结构化安全报告时使用。
   * ------------------------------------------------------------------------- */
  getTaskReport(taskId) {
    /* 真实对接骨架（演示期不执行）：
       const res = await fetch(API_BASE_URL + '/tasks/' + taskId + '/report');
       if (!res.ok) throw new Error('getTaskReport 失败: ' + res.status);
       return res.json(); */
    return Promise.reject(
      new Error(
        '未接入真实后端：getTaskReport 对应 GET ' +
          API_BASE_URL + '/tasks/' + taskId + '/report'
      )
    );
  },

  /* ---------------------------------------------------------------------------
   * 6) exportReportPdf —— 导出 PDF 安全报告
   *   HTTP: GET {API_BASE_URL}/tasks/{id}/report.pdf
   *   入参: taskId (string) 任务 ID
   *   出参: 二进制 PDF 流（Content-Type: application/pdf）
   *   归属: 4号（业务调度&存储层）对应架构图「导出PDF安全报告」
   *   状态: 已预留 / 未接入
   *   语义: 前端触发浏览器下载后端生成的安全报告 PDF。
   * ------------------------------------------------------------------------- */
  exportReportPdf(taskId) {
    /* 真实对接骨架（演示期不执行）：
       const a = document.createElement('a');
       a.href = API_BASE_URL + '/tasks/' + taskId + '/report.pdf';
       a.download = 'report-' + taskId + '.pdf';
       document.body.appendChild(a); a.click(); a.remove(); */
    return Promise.reject(
      new Error(
        '未接入真实后端：exportReportPdf 对应 GET ' +
          API_BASE_URL + '/tasks/' + taskId + '/report.pdf'
      )
    );
  }
};

/* 暴露到全局，供 console.js 的 HttpEngine.analyze 等在未来接入真实后端时调用。 */
if (typeof window !== 'undefined') window.ApiClient = ApiClient;
