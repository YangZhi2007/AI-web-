# 23 · 任务台 UI 精炼说明（unslop 方向 A · v0.28）

## 一、这次做了什么

用 unslop + dev-expert-pro 两个技能重做任务台 UI 样板。用户选定**方向 A（保留高饱和基因做精炼）** + **范围：先做任务台样板**。

任务台是 v0.16→v0.27 多轮打磨出来的 **light slop**（接近 no slop）：它已经是 SOC 卷宗风格、无 emoji、无紫色渐变、无发光 blob、图标统一线性、间距大体在 4px 网格。按 unslop 纪律，light slop 走 **polish 模式**——保留调色板、字体、布局、视觉，只修审计发现的真问题，不推翻用户之前多轮明确决定的高饱和多巴胺基因。

## 二、审计发现的四个真问题与修法

| 真问题（unslop sign） | 修法 | 落在哪 |
| --- | --- | --- |
| 全大写宽字距标签 `STEP 01 / TASK CONSOLE`、`TASK CONFIGURATION / 任务配置` | 改句首大写、字距 .12em→.01em、字号 11→12px；同步改 HTML 文案 | `.eyebrow/.lbl/.card-title` + console.html 文案 |
| 字重 600 偏重（brand、按钮） | 收敛到 500，层级靠尺寸与颜色而非加粗 | `.brand/.btn-solid/.btn-grad` |
| 按钮 hover 大位移 -3px + 发光阴影 `0 12px 34px rgba(200,245,96,.3)` | 收敛为 -1px + 中性小阴影，按下回 0 + scale(.99) | hover/active 态 |
| 主卡缺"唯一亮元素"焦点 | 顶部加一条酸柠卷宗刻度带（signature 基因，呼应 8 格轮次刻度） | `.card--key::before` |

附带：副标题 14→15px、正文提示 12→13px（呼应此前「小字放大」要求）；边界卡红色顶边收敛为中性发丝线，红色只保留语义红方块；指标数字 32→30px、标签放大。

## 三、怎么做到零功能风险

1. **独立作用域样式** `webapp/css/console-refine.css`，全部规则包在 `body[data-page="console"]` 下，只在 console.html 引入、排在 console.css 之后。其他 8 个页面一行未动。
2. **只改视觉层**：DOM id、data-*、aria-*、状态机、pendingRun、脚本、8 态选择器、打印段全部零改动。
3. **硬契约守住**：`--accent=#c8f560`、7 页 `--key` 互异且 chroma>0.45、按钮酸柠底深墨字对比度 15.56:1、44px 命中、390 无溢出、reduced-motion、@media print。

## 四、过程中修掉的一个 bug

首版 refine CSS 的头部注释里写了 `data-*/aria-*`，其中 `*/` **提前闭合了 CSS 注释**，导致紧随其后的第一条规则（text-transform 那组）被浏览器整块丢弃——采证时发现 eyebrow 仍是 uppercase/11px，而后面的 brand 字重却生效了。通过 CDP dump `document.styleSheets[].cssRules` 定位到规则数从 29 变 28、第一条规则消失，进而用字节级检查确认注释 `*/` 提前闭合。改为 `data-* 与 aria-*` 后规则恢复、计算样式全部生效。（与历史 `docs` 中同类 CSS 注释 bug 同源。）

## 五、验收结果

| 检查 | 结果 |
| --- | --- |
| `e2e-pages-test.js`（62 项） | 62/62 通过，零回归 |
| `qa-v019-audit-color.js` | 7 页 --key 互异 true、全部 chroma>0.45 true、四强调 OK、外部请求 0、控制台异常 0 |
| `qa-v019-audit-dom.js` | console 交互目标 26、可见 24、<44px **0**；四档 scrollWidth 违规 0；390 rect 越界 0 |
| 计算样式采证 | eyebrow/lbl/card-title = none / 0.12px / 12px / 500；brand、btn = 500 |
| 截图 | `docs/screenshots/unslop-before-console.png`（前）/ `unslop-after-console.png`（后） |

## 六、下一步

本轮只交付任务台样板。确认风格后，可把同一套 `*-refine.css` 作用域方案推广到监控 / 证据链 / 报告三页（各页保留自己的卷宗/态势 signature），再覆盖配置 / 历史 / 说明 / 重放 / 幻觉占位页。推广时须逐页重跑 E2E 与 audit，尤其报告页打印黑白断言。
