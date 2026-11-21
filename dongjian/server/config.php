<?php
/**
 * config.php — 编排层唯一配置来源
 *
 * 职责：集中所有可调参数（路径、白名单、阶段表、超时、轮询间隔）。
 * 其他文件一律 require 本文件取配置，不得内嵌硬编码路径或端口。
 * 组长约定：后端用 PHP；Python 头身（recon/head/verify）保持不动，由 StageRunner 子进程调用。
 *
 * 部署提示：换机器时只改 AI_PY_DIR / PYTHON_BIN / TASKS_DIR 三处。
 */

declare(strict_types=1);

// ── 路径配置 ────────────────────────────────────────────────────────────
// Python 头身包所在目录（含 recon.py / head.py / verify.py / report.py）
// 相对路径以本文件所在 server/ 目录为基准，亦可用绝对路径覆盖。
define('AI_PY_DIR', realpath(__DIR__ . '/../../ai_pentest') ?: __DIR__ . '/../../ai_pentest');

// Python 解释器。Windows 用 'python'，Linux 用 'python3'，按部署机调整。
define('PYTHON_BIN', getenv('DJ_PYTHON') ?: 'python');

// 任务状态文件落盘目录（每个任务一个 JSON 文件）
define('TASKS_DIR', __DIR__ . '/tasks');

// ── 安全配置 ────────────────────────────────────────────────────────────
// 仅允许内网/本机靶场。默认拒绝公网，答辩合规项。
// 设为 true 需同时提供书面授权，文档第 8 章有明确约定。
define('ALLOW_PUBLIC', filter_var(getenv('DJ_ALLOW_PUBLIC') ?: 'false', FILTER_VALIDATE_BOOL));

// 允许的目标主机名白名单（留空则只按「私网/回环」判定）
define('HOST_WHITELIST', array_filter(array_map('trim', explode(',', (string)(getenv('DJ_HOST_WHITELIST') ?: '')))));

// ── 阶段表 ──────────────────────────────────────────────────────────────
// 前端六阶段动画与此表严格一一对应。key 是阶段码，progress 是该阶段完成后的百分比。
// script 为 null 表示该阶段由编排层自己完成（不调 Python 子进程）。
// 顺序即执行顺序，不可随意调整——调整必须同步改前端状态机与文档第 4.3 节。
define('STAGES', [
    ['key' => 'recon',   'label' => '正在爬取靶场页面与 JS 情报',   'script' => 'recon.py',   'progress' => 15],
    ['key' => 'head',    'label' => '大模型正在研判漏洞假设',        'script' => 'head.py',    'progress' => 45],
    ['key' => 'deep',    'label' => '正在补充漏洞细节',              'script' => null,         'progress' => 55],  // 深挖在 head.py 内部完成
    ['key' => 'verify',  'label' => '验证器正在实测漏洞',            'script' => 'verify.py',  'progress' => 80],
    ['key' => 'report',  'label' => '正在生成漏洞报告',              'script' => 'report.py',  'progress' => 92],
    ['key' => 'done',    'label' => '分析完成',                      'script' => null,         'progress' => 100], // 终态，不执行脚本
]);

// ── 运行参数 ────────────────────────────────────────────────────────────
// 单阶段子进程超时（秒）。超时则终止该阶段并置任务为 error。
define('STAGE_TIMEOUT', 900);
// SSE 推流时每个事件的刷新间隔（微秒），用于冲刷 PHP/代理缓冲。
define('SSE_FLUSH_US', 200000);
// 任务状态文件最大保留数量，超出后删除最旧的已完成任务。
define('TASK_KEEP', 50);

// ── 初始化 ──────────────────────────────────────────────────────────────
if (!is_dir(TASKS_DIR)) {
    mkdir(TASKS_DIR, 0775, true);
}
date_default_timezone_set('Asia/Shanghai');
