/* v0.38 验收：洞鉴 PHP 编排层真实 HTTP 联调
 * 背景：v0.37 只做静态审查，用户本机装 PHP 8.3 后实跑暴露四个真实缺陷：
 *   ① 前端 /api/scan 无 .php 后缀 → PHP 内置服务器 404（全链路连不通）
 *   ② 非法 task_id 触发 uncaught InvalidArgumentException → 吐 fatal HTML 破坏 JSON/SSE 解析
 *   ③ mb_substr 依赖 mbstring，winget PHP 默认未加载 → 写日志时函数未定义
 *   ④ Windows 下 scan.php 的 start /B 后台进程起不来 → 任务永远停 queued
 * 本脚本在真实 PHP 内置服务器上验证这四点已修复，并跑通端到端。
 * 依赖：本机 PHP 8.3（winget 安装路径）、Node 22。 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const PHP = 'C:\\Users\\YangZhi\\AppData\\Local\\Microsoft\\WinGet\\Packages\\PHP.PHP.8.3_Microsoft.Winget.Source_8wekyb3d8bbwe\\php.exe';
const SERVER = 'D:\\AIBBBG\\Version1\\dongjian\\server';
const PORT = 8878;
const BASE = 'http://127.0.0.1:' + PORT;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const R = [];
const check = (name, ok, detail) => {
  R.push({ name, ok: !!ok });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
};

function req(method, urlPath, body) {
  return new Promise((res, rej) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(BASE + urlPath, {
      method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}
    }, (resp) => {
      let d = '';
      resp.on('data', (c) => (d += c));
      resp.on('end', () => res({ status: resp.statusCode, body: d }));
    });
    r.on('error', rej);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  // 动态找 PHP：优先 winget 路径，找不到则跳过并如实报告
  if (!fs.existsSync(PHP)) {
    console.log('SKIP 本机未找到 PHP 8.3，跳过 HTTP 联调');
    console.log('\n==== SKIP（环境缺 PHP）====');
    return;
  }

  // 注入可用的 Python 绝对路径：verify.py 已开发，StageRunner 会真实执行它，
  // 而 PHP 子进程环境里裸 'python' 可能不在 PATH（Windows winget 版 PHP 常见）。
  let pythonForWorker = process.env.DJ_PYTHON || '';
  try {
    const { execFileSync } = require('child_process');
    const probe = process.platform === 'win32' ? 'python3' : 'python3';
    pythonForWorker = execFileSync(probe, ['-c', 'import sys;print(sys.executable)'],
      { encoding: 'utf-8' }).trim();
  } catch (_) { /* 探测失败则沿用默认值 */ }
  const childEnv = Object.assign({}, process.env);
  if (pythonForWorker) childEnv.DJ_PYTHON = pythonForWorker;
  const srv = spawn(PHP, ['-S', '127.0.0.1:' + PORT, '-t', SERVER],
    { stdio: 'ignore', env: childEnv });
  try {
    for (let i = 0; i < 40; i++) {
      try { await req('GET', '/api/report.php?id=NOPE'); break; }
      catch (e) { await sleep(150); }
    }

    // ① 真实语法检查（7 个 PHP 文件）
    const { execFileSync } = require('child_process');
    const files = [];
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.php')) files.push(p);
    });
    walk(SERVER);
    let syntaxOk = true;
    files.forEach((f) => {
      const out = execFileSync(PHP, ['-l', f], { encoding: 'utf-8' });
      if (!/No syntax errors/.test(out)) syntaxOk = false;
    });
    check('7 个 PHP 文件真实语法全通过', syntaxOk && files.length === 7, files.length + ' files');

    // ② 无 .php 后缀 404（证明前端修复必要）
    const noSuffix = await req('GET', '/api/report?id=NOPE');
    check('无 .php 后缀路径返回 404（前端已改带后缀）', noSuffix.status === 404, 'HTTP ' + noSuffix.status);

    // ③ 非法 ID 干净 404，不吐 fatal HTML
    const bad = await req('GET', '/api/report.php?id=NOPE');
    let badJson = null;
    try { badJson = JSON.parse(bad.body); } catch (e) {}
    check('非法 task_id 返回干净 JSON 404', bad.status === 404 && badJson && !!badJson.error,
      bad.body.slice(0, 80));

    // ④ 合规：公网拒绝、缺授权拒绝、内网通过
    const pub = await req('POST', '/api/scan.php', { target: 'http://example.com', authorization_id: 'A' });
    const noAuth = await req('POST', '/api/scan.php', { target: 'http://127.0.0.1/shop_labs' });
    const good = await req('POST', '/api/scan.php', {
      target: 'http://127.0.0.1/shop_labs', authorization_id: 'AUTH-SMOKE'
    });
    let goodJson = null;
    try { goodJson = JSON.parse(good.body); } catch (e) {}
    check('公网目标 HTTP 400 拒绝', pub.status === 400, 'HTTP ' + pub.status);
    check('缺授权编号 HTTP 400 拒绝', noAuth.status === 400, 'HTTP ' + noAuth.status);
    check('内网靶场建任务成功', good.status === 200 && goodJson && /^DJ-/.test(goodJson.task_id), good.body);

    // ⑤ 端到端：SSE 连上后懒驱动流水线走到 done（修复 Windows 后台进程失效）
    const tid = goodJson && goodJson.task_id;
    const sse = await new Promise((res, rej) => {
      let d = ''; // 提升到外层作用域，超时回调才能读取已收到的数据
      const r = http.get(BASE + '/api/progress.php?id=' + encodeURIComponent(tid), (resp) => {
        resp.on('data', (c) => {
          d += c;
          if (/"state":"done"/.test(d)) { r.destroy(); res(d); }
        });
      });
      r.on('error', rej);
      setTimeout(() => { r.destroy(); res(d); }, 20000);
    });
    check('SSE 首帧推送 queued', /"state":"queued"/.test(sse), sse.slice(0, 100));
    check('SSE 懒驱动到 done（无需后台进程）', /"state":"done"/.test(sse), 'done 事件出现');

    // ⑥ 终态与日志：verify.py 已开发 → recon/head/report 跳过、verify 真实执行，
    //    流水线仍须走到 done 且无崩溃（分阶段开发时"缺阶段不算失败"的设计）。
    const final = await req('GET', '/api/report.php?id=' + encodeURIComponent(tid));
    let fj = null;
    try { fj = JSON.parse(final.body); } catch (e) {}
    const t = fj && fj.task;
    check('终态 done / progress 100', t && t.state === 'done' && t.progress === 100,
      t && (t.state + ' ' + t.progress));
    // 只检查日志内容无 Fatal / 函数未定义；不用 error 关键字扫整段 JSON，
    // 因为任务对象本身含合法的 "error":null 字段，会造成假阳性。
    check('阶段调度正确：跳过未开发阶段 + verify 真实执行 + 无崩溃',
      t && t.logs.some((l) => /跳过/.test(l)) &&
      t.logs.some((l) => /完成第 \d+\/\d+ 条/.test(l)) &&
      t.logs.every((l) => !/Fatal|undefined function|Uncaught|not recognized/.test(l)),
      t && t.logs.join(' | ').slice(0, 300));

    // ⑦ 清理测试任务文件
    const taskFile = path.join(SERVER, 'tasks', tid + '.json');
    if (fs.existsSync(taskFile)) fs.unlinkSync(taskFile);

  } finally {
    try { srv.kill('SIGKILL'); } catch (e) {}
  }
  const pass = R.filter((r) => r.ok).length;
  console.log('\n==== 合计 ' + pass + '/' + R.length + ' PASS ====');
  if (pass !== R.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
