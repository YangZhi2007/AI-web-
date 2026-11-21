<?php
/**
 * TaskStore.php — 任务状态存储 + 目标白名单校验
 *
 * 职责：
 *   1. 任务的创建 / 读取 / 更新 / 列表（以 JSON 文件落盘，一任务一文件）
 *   2. 目标地址合规校验（仅私网/回环靶场，公网默认拒绝）
 *   3. 串行队列：同一时刻只允许一个任务处于 running，其余排队
 *
 * 设计取舍：不用数据库，因为本层只是编排演示，证据链在主服务（SQLite）落库。
 * 文件存储零依赖、可直接查看，便于答辩现场展示任务状态。
 * 并发安全：写操作用 flock 独占锁，避免 SSE 轮询与调度器同时写造成撕裂。
 */

declare(strict_types=1);

require_once __DIR__ . '/../config.php';

final class TaskStore
{
    /** 生成任务 ID：DJ- 前缀 + 时间戳 + 4 位随机，便于报告溯源 */
    public static function newId(): string
    {
        return 'DJ-' . date('ymdHis') . '-' . strtoupper(bin2hex(random_bytes(2)));
    }

    /** 任务状态文件路径 */
    private static function path(string $id): string
    {
        // 防目录穿越：ID 只允许字母数字与连字符
        if (!preg_match('/^DJ-[A-Za-z0-9-]+$/', $id)) {
            throw new InvalidArgumentException('非法任务 ID');
        }
        return TASKS_DIR . '/' . $id . '.json';
    }

    /**
     * 创建任务。target 先经白名单校验，不合规直接抛异常（合规红线）。
     * 返回初始状态数组。
     */
    public static function create(string $target, string $authorizationId): array
    {
        $target = self::checkTarget($target);
        if (trim($authorizationId) === '') {
            throw new InvalidArgumentException('缺少授权编号 authorization_id');
        }

        $id = self::newId();
        $task = [
            'id'              => $id,
            'target'          => $target,
            'authorization_id'=> $authorizationId,
            'state'           => 'queued',   // queued | running | done | error | canceled
            'stage'           => null,
            'stage_label'     => '等待调度',
            'progress'        => 0,
            'logs'            => [],
            'report_ready'    => false,
            'error'           => null,
            'created_at'      => self::now(),
            'updated_at'      => self::now(),
        ];
        self::write($id, $task);
        return $task;
    }

    /**
     * 读取任务；不存在或 ID 非法都返回 null。
     * ID 来自 HTTP 查询参数（不可信），非法时抛异常会吐出 fatal error HTML，
     * 破坏前端 JSON/SSE 解析，故此处静默返回 null 由端点转 404。
     */
    public static function get(string $id): ?array
    {
        if (!preg_match('/^DJ-[A-Za-z0-9-]+$/', $id)) {
            return null;
        }
        $p = self::path($id);
        if (!is_file($p)) {
            return null;
        }
        $fp = fopen($p, 'rb');
        flock($fp, LOCK_SH);
        $raw = stream_get_contents($fp);
        flock($fp, LOCK_UN);
        fclose($fp);
        $data = json_decode($raw, true);
        return is_array($data) ? $data : null;
    }

    /**
     * 合并更新任务字段。logs 采用追加语义（避免 SSE 轮询覆盖新日志）。
     * 更新后刷新 updated_at。
     */
    public static function update(string $id, array $patch): ?array
    {
        $task = self::get($id);
        if ($task === null) {
            return null;
        }
        if (!empty($patch['logs'])) {
            $extra = is_array($patch['logs']) ? $patch['logs'] : [$patch['logs']];
            $patch['logs'] = array_merge($task['logs'], $extra);
        }
        unset($patch['id']); // ID 不可变
        $task = array_merge($task, $patch);
        $task['updated_at'] = self::now();
        self::write($id, $task);
        return $task;
    }

    /** 列表：按创建时间倒序，最多 TASK_KEEP 条 */
    public static function list(): array
    {
        $files = glob(TASKS_DIR . '/DJ-*.json') ?: [];
        usort($files, static fn($a, $b) => filemtime($b) <=> filemtime($a));
        $out = [];
        foreach (array_slice($files, 0, TASK_KEEP) as $f) {
            $data = json_decode((string)file_get_contents($f), true);
            if (is_array($data)) {
                $out[] = $data;
            }
        }
        return $out;
    }

    /**
     * 取下一个排队任务并把状态置为 running（原子操作）。
     * 用独占锁包住「找+改」，保证单工作线程语义：并发建 3 个任务只有一个先跑。
     */
    public static function claimNext(): ?array
    {
        $lock = TASKS_DIR . '/.queue.lock';
        $fp = fopen($lock, 'c+');
        flock($fp, LOCK_EX);
        try {
            foreach (self::list() as $task) {
                // 若已有 running 任务，则本轮不启动新任务
                if ($task['state'] === 'running') {
                    return null;
                }
            }
            foreach (self::list() as $task) {
                if ($task['state'] === 'queued') {
                    return self::update($task['id'], ['state' => 'running']);
                }
            }
            return null;
        } finally {
            flock($fp, LOCK_UN);
            fclose($fp);
        }
    }

    /** 是否有未完成（queued/running）任务 */
    public static function hasActive(): bool
    {
        foreach (self::list() as $t) {
            if (in_array($t['state'], ['queued', 'running'], true)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 目标白名单校验。拒绝公网地址（除非 ALLOW_PUBLIC=true）。
     * 返回规范化后的 URL；不合规抛 InvalidArgumentException。
     */
    public static function checkTarget(string $target): string
    {
        $target = trim($target);
        if ($target === '') {
            throw new InvalidArgumentException('target 不能为空');
        }
        if (!preg_match('#^https?://#i', $target)) {
            $target = 'http://' . $target;
        }
        $parts = parse_url($target);
        $host = strtolower((string)($parts['host'] ?? ''));
        if ($host === '') {
            throw new InvalidArgumentException('无法解析目标主机名');
        }

        // 显式白名单优先
        if (in_array($host, HOST_WHITELIST, true)) {
            return rtrim($target, '/');
        }
        if (ALLOW_PUBLIC) {
            return rtrim($target, '/');
        }

        // 私网 / 回环判定：IP 直连按 is_private，域名按 localhost / .lab / .local
        $isPrivate = false;
        if (filter_var($host, FILTER_VALIDATE_IP)) {
            $isPrivate = self::isPrivateIp($host);
        } else {
            $isPrivate = $host === 'localhost'
                || str_ends_with($host, '.lab')
                || str_ends_with($host, '.local');
        }
        if (!$isPrivate) {
            throw new InvalidArgumentException('仅允许扫描内网/本机靶场，公网目标需书面授权并开启 ALLOW_PUBLIC');
        }
        return rtrim($target, '/');
    }

    /** RFC1918 + 回环 + 链路本地判定 */
    private static function isPrivateIp(string $ip): bool
    {
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
            return (bool)filter_var($ip, FILTER_VALIDATE_IP,
                FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false;
        }
        // IPv6：::1 与 fc00::/7
        if ($ip === '::1') {
            return true;
        }
        return (bool)preg_match('/^f[cd][0-9a-f]{2}:/i', $ip);
    }

    /** 原子写入（临时文件 + rename，避免读到半截 JSON） */
    private static function write(string $id, array $task): void
    {
        $path = self::path($id);
        $tmp = $path . '.tmp';
        file_put_contents($tmp, json_encode($task, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX);
        rename($tmp, $path);
    }

    /** 统一时间戳格式，与文档、日志、报告三处对齐 */
    private static function now(): string
    {
        return date('Y-m-d H:i:s');
    }
}
