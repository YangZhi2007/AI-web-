# 洞鉴 · 展示层与 PHP 编排层

本目录是《洞鉴 AI Web 漏洞智能验真平台》的**展示层（web/）**与 **PHP 编排层（server/）**，
与旧的 SmartWAF-Breaker 演示工程（`webapp/`）物理隔离，互不影响。

组长 2026-11-21 指令：展示网页开工、后端改用 PHP、AI 生成代码需结构清晰并打注释。
本目录据此外加文档《项目基线与实施手册 v2.0》第 4.3 节的六阶段流水线实现。

## 目录结构

```
dongjian/
├── web/                     展示层（零依赖原生 HTML/CSS/JS）
│   ├── index.html           验真大屏：提交任务 + 六阶段动画 + 实时日志
│   ├── report.html          证据链报告：双轨对照三件套
│   ├── css/app.css          视觉系统（单一中性 ramp + 酸柠强调）
│   └── js/
│       ├── api.js           请求层：submitScan / subscribe(SSE) / getReport
│       ├── app.js           大屏交互 + mock 降级
│       └── report.js        报告渲染 + 演示数据
└── server/                  PHP 编排层
    ├── config.php           唯一配置：路径、白名单、阶段表、超时
    ├── lib/
    │   ├── TaskStore.php    任务存储 + 目标白名单 + 串行队列
    │   └── StageRunner.php  子进程调度 Python 头身，逐行日志
    ├── api/
    │   ├── scan.php         POST /api/scan    建任务
    │   ├── progress.php     GET  /api/progress SSE 进度
    │   └── report.php       GET  /api/report  读报告
    ├── worker.php           后台流水线工人（CLI，不经 HTTP）
    └── tasks/               任务状态文件（运行时生成）
```

## 与 Python 头身的边界

**PHP 只做编排，不做推理。** 头身（recon / head / verify / report）保持 Python，
由 `StageRunner` 用子进程调用，通过环境变量 `TARGET_URL` 传参。

约定 Python 包位于仓库根的 `ai_pentest/`，含：

- `recon.py` → 情报包 `recon.json`
- `head.py` → 假设清单 `hypotheses.json`（两遍深挖在内部完成）
- `verify.py` → 验证证据落 `evidence` 表
- `report.py` → 报告 `report.json`

脚本缺失时对应阶段跳过、不报错，便于分阶段开发时也能跑通。

## 部署（在你负责的机器上）

### 1. 改配置

编辑 `server/config.php` 顶部三处路径：

```php
define('AI_PY_DIR',  '/实际路径/ai_pentest');  // Python 头身包目录
define('PYTHON_BIN', 'python');                // Windows 用 python，Linux 用 python3
define('TASKS_DIR',  __DIR__ . '/tasks');      // 一般不用改
```

AI 服务器地址（Ollama）在 `ai_pentest/config.py` 内，不在本层。

### 2. 起 PHP 服务

```bash
cd dongjian/server
php -S 0.0.0.0:8000 -t .
```

`web/` 是纯静态文件，可直接双击 `index.html` 打开（前端会自动降级到演示模式）。
若要连真后端，需用 HTTP 服务托管 web/ 并让 `api.js` 的 `API_BASE` 指向后端地址，
避免 `file://` 下的浏览器跨域限制：

```bash
cd dongjian/web
python -m http.server 8080
```

然后访问 `http://localhost:8080/index.html`，并把 `web/js/api.js` 第 14 行的
`API_BASE` 设为 `'http://<后端IP>:8000'`；后端需放行跨域（PHP 侧在响应头加
`Access-Control-Allow-Origin`）。

### 3. 演示保底

后端未连、脚本缺失、或现场出问题时，前端自动切 mock 演示模式，
所有输出标注「模拟 / 演示数据」，不会伪装成真实推理——这是文档的诚信红线。

## 验收

```bash
node docs/scripts/qa-v037-dongjian-ui.js
```

覆盖：六阶段渲染、mock 推进、报告双轨、演示标注、CSS 无 slop、零外联、零运行时异常。
本次实跑 **9/9 PASS**，并产出三张真实渲染截图于 `docs/screenshots/v0.37-洞鉴-*.png`。

## 已知验证缺口

本机未安装 PHP，后端只做了括号配对与 require 引用的静态审查（7 个文件全平衡），
**未做真实 HTTP 联调**。到部署机后请按上面第 2 步起服务，用 curl 冒烟：

```bash
curl -X POST http://localhost:8000/api/scan \
  -H 'Content-Type: application/json' \
  -d '{"target":"http://192.168.109.129/shop_labs","authorization_id":"AUTH-LAB-2026-001"}'
```
