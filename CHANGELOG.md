# 版本更新台账 / CHANGELOG

> 仓库：`https://github.com/YangZhi2007/AI-web-`（public，分支 `main`）
> 版本号规则：`vMAJOR.MINOR.PATCH`。本次为历史 14 次提交补建附注 tag，使 GitHub 的 **Releases / Tags** 页面可逐版本查询、比对与下载。
> 版本与提交一一对应，**不改写历史**；查某版本内容用 `git show <tag>`。

## 查询方式

```bash
git fetch --tags                 # 拉取全部版本标记
git tag -l --sort=v:refname      # 列出所有版本
git show v0.14.0                 # 查看某版本说明
git diff v0.13.0 v0.14.0        # 比对相邻两个版本
git checkout v0.14.0             # 回退/检出某版本（分离 HEAD）
```

GitHub 网页端：仓库首页 → Releases / Tags → 选择版本 → 可直接查看代码与下载 zip。

## 版本列表（旧 → 新）

| 版本 | 日期 | Commit | 更新内容 |
|---|---|---|---|
| `v0.1.0` | 2026-11-09 | `fe4ebfe` | chore: 初始化 AIBBBG Version1 仓库备份 |
| `v0.2.0` | 2026-11-09 | `66796ae` | docs: 追加第13节 GitHub 备份记录 |
| `v0.3.0` | 2026-11-09 | `a687206` | refactor: HTML/CSS/JS 分层外置 + L1-L3 优化 |
| `v0.4.0` | 2026-11-09 | `46a20b2` | refactor: 提取跨页共享过渡/涟漪样式为 css/core.css 消除重复 |
| `v0.5.0` | 2026-11-09 | `c95ba19` | feat: 预留前端→后端接口层 api.js + 清理 console.js 冗余注释 |
| `v0.6.0` | 2026-11-09 | `d3ce65f` | style(console): 功能页赛博监测台科技感重设计 + 同步交付/审查文档 |
| `v0.7.0` | 2026-11-09 | `e978e0f` | docs: 整合 7 份文档为 00-04 无断号系列（合并三份分析稿+重编号+归档原稿） |
| `v0.8.0` | 2026-11-09 | `19fe296` | feat(index): 主页标题改为 SmartWAF-Breaker 智能自适应绕过系统（拉丁字标+中文副题双层锁合） |
| `v0.9.0` | 2026-11-09 | `672b4c7` | fix(core): 修复浏览器后退回主页时 bfcache 还原旧遮罩导致卡在加载页 |
| `v0.10.0` | 2026-11-09 | `b1d7844` | refactor(index): 移除主页 halo+浮动五阶段装饰，改为自适应绕过闭环展示面板（含逐轮计数/探针流/闭环弧），清理死代码 |
| `v0.11.0` | 2026-11-09 | `d83c793` | Revert "refactor(index): 移除主页 halo+浮动五阶段装饰，改为自适应绕过闭环展示面板（含逐轮计数/探针流/闭环弧），清理死代码" |
| `v0.12.0` | 2026-11-09 | `1c7c3cf` | feat(index): 顶栏编号导航改为系统状态母线（ENGINE/SCOPE/EGRESS 遥测展示），清理死链与失效JS |
| `v0.13.0` | 2026-11-09 | `0019afc` | refactor(index): 移除顶栏「进入控制台」按钮，跨页入口统一收敛到 Hero 主按钮 |
| `v0.14.0` | 2026-11-10 | `e2e92d1` | refactor(console): 依据 00/03/04 报告改版功能页信息结构与优先级，提亮配色，状态反馈完整化（JS 契约零改动） |

---

## 版本基线说明

- `v0.14.0`（`e2e92d1`）= **2026-11-10 视觉重构前的稳定基线**，如需回退本次「炫酷信息科技风」重构，用 `git revert <重构提交>` 或直接检出该 tag。
- 后续每次交付追加一行并提交，同时打新 tag，`git push origin main --tags` 同步到 GitHub。
