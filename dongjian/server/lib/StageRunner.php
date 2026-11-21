<?php
/**
 * StageRunner.php — 阶段执行器（子进程调度 Python 头身）
 *
 * 职责：按 config.php 的 STAGES 顺序执行各阶段，每阶段用子进程跑对应 Python 脚本，
 *       逐行捕获输出写入任务日志，并把关键行提升为当前状态标签。
 *
 * 为什么用子进程而非函数调用：
 *   recon/head/verify 本来就是可独立运行的脚本，改成函数要动三份文件入口；
 *   子进程只需它们支持读 TARGET_URL 环境变量，改动最小且崩溃隔离——
 *   某阶段把内存打爆，PHP 编排层仍活着，大屏不会白屏（文档第 10.3 节同款设计）。
 *
 * 缺阶段不算失败：script 为 null 或文件不存在的阶段跳过，便于分阶段开发时也能跑通。
 */

declare(strict_types=1);

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/TaskStore.php';

final class StageRunner
{
    /** 运行完整流水线；任一阶段失败即停并置任务为 error */
    public static function run(string $taskId): void
    {
        $task = TaskStore::get($taskId);
        if ($task === null) {
            return;
        }
        $target = (string)$task['target'];

        foreach (STAGES as $stage) {
            // 任务被取消：立即停机（组长"攻破即停"的同款尊重用户意图原则）
            $current = TaskStore::get($taskId);
            if ($current === null || $current['state'] === 'canceled') {
                return;
            }

            // 终态阶段：只更新进度，不执行脚本
            if ($stage['script'] === null) {
                TaskStore::update($taskId, [
                    'stage'       => $stage['key'],
                    'stage_label' => $stage['key'] === 'done' ? '分析完成' : $stage['label'],
                    'progress'    => $stage['progress'],
                ]);
                continue;
            }

            // 更新当前阶段状态（前端动画据此推进）
            TaskStore::update($taskId, [
                'stage'       => $stage['key'],
                'stage_label' => $stage['label'],
            ]);

            $ok = self::runScript($taskId, $stage, $target);
            if (!$ok) {
                TaskStore::update($taskId, [
                    'state'   => 'error',
                    'error'   => $stage['script'] . ' 执行失败',
                    'logs'    => ['[失败] 流水线在 ' . $stage['key'] . ' 阶段中止'],
                ]);
                return;
            }

            // 阶段完成后刷新进度
            TaskStore::update($taskId, ['progress' => $stage['progress']]);
        }

        // 全流程走完：置为 done，报告是否生成如实标注
        $task = TaskStore::get($taskId);
        TaskStore::update($taskId, [
            'state'        => 'done',
            'stage'        => 'done',
            'stage_label'  => '分析完成',
            'progress'     => 100,
            'report_ready' => is_file(AI_PY_DIR . '/report.json'),
            'logs'         => ['[完成] 全流程结束'],
        ]);
    }

    /**
     * 执行单个阶段的 Python 脚本，逐行捕获输出。
     * 返回 true=成功（含"脚本不存在而跳过"），false=失败。
     */
    private static function runScript(string $taskId, array $stage, string $target): bool
    {
        $script = AI_PY_DIR . '/' . $stage['script'];
        if (!is_file($script)) {
            // 缺阶段不算失败：分阶段开发时其他阶段仍可跑通
            TaskStore::update($taskId, ['logs' => ['[跳过] 未找到 ' . $stage['script'] . '（该阶段尚未开发）']]);
            return true;
        }

        // 环境变量传参，脚本读 TARGET_URL 即可，无需改脚本入口
        $env = [
            'TARGET_URL'        => $target,
            'PYTHONIOENCODING'  => 'utf-8',
            'PYTHONUNBUFFERED'  => '1',
        ];
        $cmd = escapeshellarg(PYTHON_BIN) . ' -u ' . escapeshellarg($script) . ' 2>&1';

        $pipes = [];
        $proc = proc_open($cmd, [
            0 => ['pipe', 'r'],
            1 => ['pipe', 'w'],
            2 => ['pipe', 'w'],
        ], $pipes, AI_PY_DIR, $env);

        if (!is_resource($proc)) {
            TaskStore::update($taskId, ['logs' => ['[失败] 无法启动子进程：' . $stage['script']]]);
            return false;
        }
        fclose($pipes[0]);

        $deadline = time() + STAGE_TIMEOUT;
        // 非阻塞读取，兼顾超时控制与逐行日志
        stream_set_blocking($pipes[1], false);
        stream_set_blocking($pipes[2], false);
        $buf = '';
        $timedOut = false;

        while (true) {
            foreach ([$pipes[1], $pipes[2]] as $pipe) {
                $chunk = fread($pipe, 8192);
                if ($chunk !== false && $chunk !== '') {
                    $buf .= $chunk;
                    // 按行切出完整行写入日志
                    while (($pos = strpos($buf, "\n")) !== false) {
                        $line = trim(substr($buf, 0, $pos));
                        $buf = substr($buf, $pos + 1);
                        if ($line !== '') {
                            self::pushLine($taskId, $line);
                        }
                    }
                }
            }
            $status = proc_get_status($proc);
            if (!$status['running']) {
                break;
            }
            if (time() > $deadline) {
                $timedOut = true;
                proc_terminate($proc);
                break;
            }
            usleep(100000); // 100ms 轮询，避免忙等
        }

        // 收尾剩余缓冲
        if (trim($buf) !== '') {
            self::pushLine($taskId, trim($buf));
        }
        fclose($pipes[1]);
        fclose($pipes[2]);
        $exitCode = proc_close($proc);

        if ($timedOut) {
            TaskStore::update($taskId, ['logs' => ['[超时] ' . $stage['script'] . ' 超过 ' . STAGE_TIMEOUT . ' 秒']]);
            return false;
        }
        return $exitCode === 0;
    }

    /** 把一行脚本输出写入日志；关键行提升为当前状态标签 */
    private static function pushLine(string $taskId, string $line): void
    {
        $patch = ['logs' => [$line]];
        if (str_contains($line, '条假设') || str_contains($line, 'AI提出') || str_contains($line, '完成')) {
            $patch['stage_label'] = self::clip($line, 60);
        }
        TaskStore::update($taskId, $patch);
    }

    /**
     * UTF-8 安全截断，不依赖 mbstring 扩展。
     * winget/官方 PHP 默认未加载 mbstring，用 preg_split 按字符切分，
     * 避免 mb_substr 未定义导致整条流水线在写日志时崩溃。
     */
    private static function clip(string $s, int $max): string
    {
        $chars = preg_split('//u', $s, -1, PREG_SPLIT_NO_EMPTY);
        if ($chars === false) {
            return substr($s, 0, $max); // 非法 UTF-8 时退化为字节截断
        }
        return implode('', array_slice($chars, 0, $max));
    }
}
