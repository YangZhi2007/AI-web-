<?php
/**
 * api/progress.php — GET /api/progress?id=<task_id> 任务进度（SSE 事件流）
 *
 * 职责：以 Server-Sent Events 持续推送任务状态快照，直到任务进入终态（done/error/canceled）。
 *       前端 EventSource 订阅后逐帧更新六阶段动画与日志。
 *
 * 事件格式：data: {"state":"running","stage":"verify","progress":80,"logs":[...]}
 * 终止条件：终态推一帧后发 event: done 并关闭连接。
 *
 * 缓冲处理（SSE 经典坑）：
 *   1. X-Accel-Buffering: no  —— 告诉 Nginx 不要缓冲
 *   2. ob_implicit_flush     —— PHP 输出即冲刷
 *   3. 每次循环 echo 后 flush —— 确保代理不攒批
 */

declare(strict_types=1);

require_once __DIR__ . '/../lib/TaskStore.php';

// SSE 必需的响应头
header('Content-Type: text/event-stream; charset=utf-8');
header('Cache-Control: no-cache');
header('Connection: keep-alive');
header('X-Accel-Buffering: no');

// 关闭 PHP 输出缓冲
while (ob_get_level() > 0) {
    ob_end_flush();
}
ob_implicit_flush(true);

$taskId = (string)($_GET['id'] ?? '');
if ($taskId === '' || TaskStore::get($taskId) === null) {
    http_response_code(404);
    echo "data: " . json_encode(['error' => '任务不存在'], JSON_UNESCAPED_UNICODE) . "\n\n";
    exit;
}

$lastUpdate = '';
$maxWait = 600; // 最多推 600 轮（约 10 分钟），防连接无限挂起

for ($i = 0; $i < $maxWait; $i++) {
    $task = TaskStore::get($taskId);
    if ($task === null) {
        break;
    }

    // 仅在状态变化时推帧，避免刷屏；首帧必推
    $fingerprint = implode('|', [
        $task['state'], $task['stage'], $task['progress'], count($task['logs'] ?? []),
    ]);
    if ($fingerprint !== $lastUpdate || $i === 0) {
        $lastUpdate = $fingerprint;
        // logs 只推最后 40 条，控制单帧体积
        $payload = $task;
        $payload['logs'] = array_slice($task['logs'] ?? [], -40);
        echo "data: " . json_encode($payload, JSON_UNESCAPED_UNICODE) . "\n\n";
        flush();
    }

    // 心跳注释行：每 15 秒一次，防代理断连
    if ($i % 75 === 0) {
        echo ": heartbeat\n\n";
        flush();
    }

    // 终态：推一帧 done 事件后关闭
    if (in_array($task['state'], ['done', 'error', 'canceled'], true)) {
        echo "event: done\ndata: " . json_encode(['state' => $task['state']], JSON_UNESCAPED_UNICODE) . "\n\n";
        flush();
        break;
    }

    usleep(SSE_FLUSH_US);
}
