<?php
/**
 * api/report.php — GET /api/report?id=<task_id> 读取报告对象
 *
 * 职责：返回任务状态与 report.json 内容，供展示页报告三件套渲染。
 *       报告正文由 Python report.py 生成落盘（AI_PY_DIR/report.json），本层只读取转发。
 *
 * 响应：JSON { task:{...}, report:{...}|null }
 * 说明：报告未生成时 report 为 null，前端显示"分析中"而非报错。
 */

declare(strict_types=1);

require_once __DIR__ . '/../lib/TaskStore.php';

header('Content-Type: application/json; charset=utf-8');

$taskId = (string)($_GET['id'] ?? '');
$task = $taskId !== '' ? TaskStore::get($taskId) : null;

if ($task === null) {
    http_response_code(404);
    echo json_encode(['error' => '任务不存在'], JSON_UNESCAPED_UNICODE);
    exit;
}

$reportPath = AI_PY_DIR . '/report.json';
$report = null;
if (is_file($reportPath)) {
    $decoded = json_decode((string)file_get_contents($reportPath), true);
    $report = is_array($decoded) ? $decoded : null;
}

echo json_encode([
    'task'   => $task,
    'report' => $report,
], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
