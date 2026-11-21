<?php
/**
 * api/scan.php — POST /api/scan 启动探测任务
 *
 * 职责：接收 target 与 authorization_id，校验后建任务，fork 后台进程跑流水线，
 *       立即返回 task_id 给前端（不等待跑完）。
 *
 * 请求：POST JSON  { "target": "http://192.168.109.129/shop_labs", "authorization_id": "AUTH-2026-001" }
 * 响应：JSON       { "task_id": "DJ-...", "state": "queued" }
 *
 * 为什么后台执行：流水线 3~5 分钟，同步等待会超时。用 PHP 自带 CLI 起一个
 * worker 进程跑流水线，前端拿 task_id 后走 /api/progress 的 SSE 订阅进度。
 */

declare(strict_types=1);

require_once __DIR__ . '/../lib/TaskStore.php';

header('Content-Type: application/json; charset=utf-8');

// 只接受 POST
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => '仅接受 POST'], JSON_UNESCAPED_UNICODE);
    exit;
}

try {
    // 解析请求体（兼容 application/json 与 form-urlencoded）
    $raw = file_get_contents('php://input');
    $body = json_decode($raw, true);
    if (!is_array($body)) {
        $body = $_POST;
    }
    $target = (string)($body['target'] ?? '');
    $authorizationId = (string)($body['authorization_id'] ?? '');

    $task = TaskStore::create($target, $authorizationId);

    // 后台启动 worker：php worker.php <task_id>，输出丢弃，脱离本请求
    $worker = __DIR__ . '/../worker.php';
    // worker 需用 PHP 解释器执行；DJ_PHP_BIN 可覆盖，默认 'php'
    $phpBin = getenv('DJ_PHP_BIN') ?: 'php';
    $bg = escapeshellarg($phpBin) . ' ' . escapeshellarg($worker) . ' ' . escapeshellarg($task['id']);
    if (str_starts_with(strtoupper(PHP_OS), 'WIN')) {
        // Windows：用 start /B 后台启动，避免阻塞
        pclose(popen('start /B ' . $bg . ' > NUL 2>&1', 'r'));
    } else {
        exec($bg . ' > /dev/null 2>&1 &');
    }

    echo json_encode([
        'task_id' => $task['id'],
        'state'   => $task['state'],
    ], JSON_UNESCAPED_UNICODE);
} catch (InvalidArgumentException $e) {
    // 合规/参数拒绝：400，错误信息可直接展示（不含 scope 内部细节）
    http_response_code(400);
    echo json_encode(['error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => '任务创建失败：' . $e->getMessage()], JSON_UNESCAPED_UNICODE);
}
