/**
 * api.js — 展示层 → PHP 编排层的请求封装
 *
 * 职责：
 *   1. submitScan   POST /api/scan   建任务，返回 task_id
 *   2. subscribe    EventSource(/api/progress) 订阅进度，返回可取消的句柄
 *   3. getReport    GET /api/report  读取报告对象
 *
 * 降级设计：API_BASE 为空或请求失败时，调用方（app.js）自动切到 mock 模式，
 *           用本地状态机演示六阶段——这样后端未部署时展示页仍可独立演示。
 *           演示数据全部标注"模拟"，不伪装成真实推理（诚信红线，与文档一致）。
 */

(function (global) {
  'use strict';

  // API 基准地址：同源部署时留空；跨机指向后端时填 'http://<后端IP>:8000'。
  // 路径带 .php 后缀——PHP 内置服务器与默认 nginx 不做 pathinfo 重写，
  // 省略后缀会得到 404（已在本机 PHP 8.3 实测确认）。
  var API_BASE = '';

  function url(path) {
    return API_BASE + path;
  }

  /** 建任务。返回 Promise<{task_id, state}> */
  function submitScan(target, authorizationId) {
    return fetch(url('/api/scan.php'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: target, authorization_id: authorizationId })
    }).then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (e) {
          throw new Error(e.error || ('HTTP ' + res.status));
        });
      }
      return res.json();
    });
  }

  /**
   * 订阅进度 SSE。
   * @param {string} taskId 任务 ID
   * @param {object} handlers { onUpdate(task), onDone(state), onError(err) }
   * @returns {{ close: Function }} 可取消的订阅句柄
   */
  function subscribe(taskId, handlers) {
    var es = new EventSource(url('/api/progress.php') + '?id=' + encodeURIComponent(taskId));

    es.onmessage = function (ev) {
      try {
        var task = JSON.parse(ev.data);
        if (task.error) {
          handlers.onError && handlers.onError(new Error(task.error));
          return;
        }
        handlers.onUpdate && handlers.onUpdate(task);
      } catch (e) {
        handlers.onError && handlers.onError(e);
      }
    };

    // 终态事件：推一帧后关闭连接
    es.addEventListener('done', function (ev) {
      var data = {};
      try { data = JSON.parse(ev.data); } catch (e) {}
      handlers.onDone && handlers.onDone(data.state);
      es.close();
    });

    es.onerror = function () {
      handlers.onError && handlers.onError(new Error('进度连接中断'));
      es.close();
    };

    return { close: function () { es.close(); } };
  }

  /** 读报告。返回 Promise<{task, report}> */
  function getReport(taskId) {
    return fetch(url('/api/report.php') + '?id=' + encodeURIComponent(taskId))
      .then(function (res) {
        if (!res.ok) throw new Error('报告读取失败 HTTP ' + res.status);
        return res.json();
      });
  }

  global.Api = {
    API_BASE: API_BASE,
    submitScan: submitScan,
    subscribe: subscribe,
    getReport: getReport
  };
})(window);
