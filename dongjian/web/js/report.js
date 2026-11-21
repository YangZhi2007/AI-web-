/**
 * report.js — 证据链报告页渲染
 *
 * 职责：按 URL 的 task_id 读取报告，渲染摘要卡 + 发现列表（双轨对照）。
 *       双轨是签名元素：左轨 ◆ AI 假设，右轨 ■ 机器裁决，中间发丝线。
 *
 * 数据来源：真实报告走 GET /api/report?id=；后端不可用或报告未生成时，
 *           用一组标注"演示数据"的样本渲染，明确不伪装成真实推理结果。
 * 诚信红线：AI 假设与机器裁决分列展示，裁决只取靶机响应，不读模型自证。
 */

(function () {
  'use strict';

  var qs = new URLSearchParams(location.search);
  var taskId = qs.get('id') || '';

  var metaEl = document.getElementById('reportMeta');
  var findingsEl = document.getElementById('findings');

  /** 演示数据：结构对齐文档第 4.4 节的 hypotheses.json 与验证器输出 */
  var DEMO = {
    task: { id: taskId || 'DJ-DEMO', target: 'http://192.168.109.129/shop_labs', authorization_id: 'AUTH-LAB-2026-001' },
    report: {
      findings: [
        {
          id: 'H-001',
          vuln_type: 'SQL 注入',
          location: 'api/login.php 用户名参数',
          verdict: 'confirmed',
          claim: {
            evidence: '登录接口 username 参数直接拼入 SQL，弱黑名单仅拦 select/union',
            reason: '源码出现字符串拼接与简易黑名单',
            confidence: '高',
            severity: '严重'
          },
          evidence: {
            request: "POST /api/login.php  username=admin' AND '1'='1",
            response: 'HTTP 200 · 登录成功（恒真条件成立）',
            diff: "恒真与恒假条件响应体差异稳定复现；绕过用 # 注释（-- 被过滤）",
            elapsed: '2.4s'
          },
          fix: '改用参数化查询（PDO 预处理），移除字符串拼接；黑名单不可作为有效防御'
        },
        {
          id: 'H-002',
          vuln_type: '存储型 XSS',
          location: 'product.html 评论区渲染',
          verdict: 'confirmed',
          claim: {
            evidence: 'product.js 用 innerHTML 渲染评论，未做转义',
            reason: '评论内容直接进入 DOM',
            confidence: '高',
            severity: '严重'
          },
          evidence: {
            request: "<img src=x onerror=alert('MARK-a7f3')> 经评论接口提交",
            response: '另一会话浏览同页，源码出现未转义的 MARK-a7f3',
            diff: '唯一随机标记持久化并在新会话回显，非反射型',
            elapsed: '5.1s'
          },
          fix: '改用 textContent 或引入白名单过滤；输出编码与 CSP 双层防护'
        },
        {
          id: 'H-003',
          vuln_type: '反射型 XSS',
          location: 'search.php 关键词参数',
          verdict: 'rejected',
          claim: {
            evidence: 'search 参数疑似回显',
            reason: '模型初次研判把评论 XSS 定性为反射型',
            confidence: '中',
            severity: '中'
          },
          evidence: {
            request: 'GET /search.php?q=<marker>',
            response: 'HTTP 200 · 标记被转义为实体，未执行',
            diff: '无法复现未转义回显，裁决为证伪（这是 AI 定性错误的真实案例）',
            elapsed: '1.8s'
          },
          fix: '该点不成立，无需修复；结论保留用于展示裁决独立性'
        }
      ]
    }
  };

  /** 把数据渲染成页面。isDemo=true 时加演示标注 */
  function render(data, isDemo) {
    var task = data.task || {};
    var report = data.report || {};
    var findings = report.findings || [];

    // 摘要卡
    var confirmed = findings.filter(function (f) { return f.verdict === 'confirmed'; }).length;
    var rejected = findings.filter(function (f) { return f.verdict === 'rejected'; }).length;
    metaEl.innerHTML = [
      metaCard('任务 ID', task.id || '—', false),
      metaCard('确认漏洞', String(confirmed), true),
      metaCard('已证伪', String(rejected), false),
      metaCard('数据来源', isDemo ? '演示数据' : '靶机实测', false)
    ].join('');

    if (!findings.length) {
      findingsEl.innerHTML = '<div class="empty-state">' +
        '<div class="empty-state__title">暂无报告</div>' +
        '<div class="empty-state__hint">任务完成后，证据链会显示在这里</div></div>';
      return;
    }

    findingsEl.innerHTML = findings.map(function (f) {
      return findingHtml(f);
    }).join('');
  }

  function metaCard(label, value, accent) {
    return '<div class="metacard">' +
      '<div class="metacard__label">' + escapeHtml(label) + '</div>' +
      '<div class="metacard__value' + (accent ? ' is-accent' : '') + '">' + escapeHtml(value) + '</div>' +
      '</div>';
  }

  /** 单个发现：双轨对照 + 处置建议 */
  function findingHtml(f) {
    var verdictClass = f.verdict === 'confirmed' ? 'is-confirmed'
      : (f.verdict === 'rejected' ? 'is-rejected' : 'is-pending');
    var verdictText = f.verdict === 'confirmed' ? '机器裁决 · 成立'
      : (f.verdict === 'rejected' ? '机器裁决 · 证伪' : '待验证');
    var c = f.claim || {};
    var e = f.evidence || {};

    return '<section class="finding">' +
      '<div class="finding__head">' +
        '<span class="finding__id">' + escapeHtml(f.id) + ' · ' + escapeHtml(f.vuln_type) + '</span>' +
        '<span class="finding__verdict ' + verdictClass + '">' + verdictText + '</span>' +
      '</div>' +
      '<div class="dualtrack">' +
        '<div class="track track--claim">' +
          '<div class="track__head"><span class="track__mark">◆</span> AI 假设</div>' +
          '<div class="track__item">' +
            '<span class="track__label">位置 / ' + escapeHtml(f.location || '') + '</span>' +
            escapeHtml(c.evidence || '') +
          '</div>' +
          '<div class="track__item">' +
            '<span class="track__label">依据 / 置信 ' + escapeHtml(c.confidence || '') + ' · 危害 ' + escapeHtml(c.severity || '') + '</span>' +
            escapeHtml(c.reason || '') +
          '</div>' +
        '</div>' +
        '<div class="dualtrack__divider"></div>' +
        '<div class="track track--verdict">' +
          '<div class="track__head"><span class="track__mark">■</span> 机器裁决</div>' +
          '<div class="track__item">' +
            '<span class="track__label">请求 / 耗时 ' + escapeHtml(e.elapsed || '') + '</span>' +
            '<div class="track__evidence">' + escapeHtml(e.request || '') + '</div>' +
          '</div>' +
          '<div class="track__item">' +
            '<span class="track__label">响应与差异</span>' +
            escapeHtml(e.response || '') +
            '<div class="track__evidence">' + escapeHtml(e.diff || '') + '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="track__item" style="margin-top:24px">' +
        '<span class="track__label">处置建议</span>' + escapeHtml(f.fix || '—') +
      '</div>' +
      '</section>';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  // 加载：有 task_id 先试真实报告，失败则降级演示数据
  if (taskId && globalApiAvailable()) {
    Api.getReport(taskId).then(function (data) {
      if (data.report && data.report.findings) {
        render(data, false);
      } else {
        render(DEMO, true);
      }
    }).catch(function () {
      render(DEMO, true);
    });
  } else {
    render(DEMO, true);
  }

  function globalApiAvailable() {
    return typeof window.Api !== 'undefined' && typeof window.Api.getReport === 'function';
  }
})();
