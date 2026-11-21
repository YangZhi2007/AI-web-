<?php
/**
 * worker.php — 后台流水线工人（由 scan.php 拉起）
 *
 * 职责：接收 task_id，调用 TaskStore::claimNext 抢占执行权，跑 StageRunner 流水线。
 *       单工作线程语义由 TaskStore 的文件锁保证：同时只有一人能 claim 到 running 任务。
 *
 * 用法：php worker.php <task_id>
 * 说明：本文件不经 HTTP 访问，只由 CLI 后台调用。
 */

declare(strict_types=1);

require_once __DIR__ . '/lib/TaskStore.php';
require_once __DIR__ . '/lib/StageRunner.php';

$taskId = $argv[1] ?? '';
if ($taskId === '') {
    fwrite(STDERR, "用法：php worker.php <task_id>\n");
    exit(1);
}

$task = TaskStore::get($taskId);
if ($task === null) {
    fwrite(STDERR, "任务不存在：$taskId\n");
    exit(1);
}

// 若已有其他任务在跑，本任务保持 queued，等下一次 worker 轮询
if ($task['state'] !== 'queued') {
    exit(0);
}

// 抢占执行权（原子），拿到 running 才开跑
$claimed = TaskStore::claimNext();
if ($claimed === null || $claimed['id'] !== $taskId) {
    exit(0);
}

StageRunner::run($taskId);
