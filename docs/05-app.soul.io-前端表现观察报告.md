# app.soul.io 公开页面前端表现 — 观察性分析报告

> 文档类型：第三方站点**公开可访问页面的被动观察**，独立分析任务
> 分析对象：`https://app.soul.io/`（应用站根路径）
> 取证日期：2026-11-09（GMT+8）｜取证通道：见 §3
> 用途：学习前端表现与设计思想；**不推测未公开的服务端实现、私有接口或私有数据**
> 分级约定：**【O】已确认观察**（可按 §3 命令复现）｜**【I】合理推断**（由观察出发，可能不成立）｜**【U】无法验证**（现有证据不足，注明缺什么）

---

## 1. 结论速览

**一句话**：目标应用站对本次两个直连通道（`curl`、本机无头 Chrome）均返回 Cloudflare `403` 拦截页；唯一可用的第三方文本通道仅提供渲染后的静态文字快照，不含 DOM、CSS 或 JS。因此**可确认的只有「页面标题、一组指标字段文案、全零初值、文本成对重复」以及若干响应头**；视觉层级、组件交互状态、动画时长/缓动/触发顺序、状态流转中的绝大部分属于 **【U】无法验证**，本报告逐项标注，不以推断或二手资料冒充观察。

### 覆盖度矩阵（对照用户要求的 4 组问题）

| 要求项 | 状态 | 说明 |
|---|---|---|
| UI 结构与视觉层级 | ⚠️ 部分 | 仅能确认标题与文案字段；布局/配色/字号/层级全部【U】 |
| 核心组件及交互状态 | ⚠️ 部分 | 仅能识别「指标读数」这一类文本组件；交互状态全部【U】 |
| 动画与过渡（触发/顺序/时长/节奏/缓动/状态切换） | ❌ 未答 | 无 CSS/JS、无运行时，**无一条可测** |
| 主要业务逻辑（操作→反馈、加载/错误/空态、边界） | ⚠️ 部分 | 仅能确认「全零初值」一种静态文本态；流转与边界全部【U】 |

---

## 2. 合规与证据边界（先读）

| # | 约束 | 本次执行 |
|---|---|---|
| C1 | 目标为第三方站点，未声明权利人或书面授权 | **不执行侵入式逆向工程**；仅做公开页面的被动观察 |
| C2 | 不规避技术保护措施 | `curl` 与本机 Chrome 均收到 `403` 拦截页后**立即停止**，未尝试伪造 UA/Cookie、未绕过挑战、未更换出口重试 |
| C3 | 不绕过访问控制、不越权 | 未请求任何非根路径资源、未探测接口、未构造参数遍历 |
| C4 | 不推测服务端实现 / 私有数据 | 全文不推断框架服务端、接口契约、钱包/账户数据 |
| C5 | 不去除版权信息、不用于仿冒 | 报告不含资源本体、不含可复刻的品牌资产 |
| C6 | 仅「公开可访问页面中可观察的前端表现」 | 官方 `docs.soul.io` 文档、第三方教程、项目内既有注释**一律标记为旁证/二手**，不计入观察 |
| C7 | 机器人协议 | `robots.txt` 实际返回 Cloudflare 托管的 content-signals **说明性注释**，未包含有效 `User-agent` / `Disallow` / `Allow`，也未见具体 `content-signal: …=yes/no` 取值行。按该文件自身条款 (c)，站点方对 `search` / `ai-input` / `ai-train` 既未授权也未限制；本次仅做少量单次公开文本观察，未做批量采集 |

> **关于分析框架**：`frontend-design` 技能提供的是视觉层级 / 动效编排的**评估维度**（排版、色彩、动效、构成四支柱），本报告用它组织问题，但**框架本身不产生观察数据**。凡维度缺证据，一律记【U】，不做主观打分。

> **关于技能完备性**：`find-skills` 流程扫描本地已安装技能（`reverse-engineer-anything`、`frontend-design`、`dev-god__skillhub`、`dev-expert-pro__skillhub`、`code-fulltest`、`delivery-no-pseudoblock` 等），本次场景已被覆盖，**无需安装新技能**。另：本会话未注册 REA 的 MCP 分析工具，故用通用 HTTP/浏览器工具做被动观察 —— 这直接构成证据等级上限，见 §3.4。

---

## 3. 取证方法与证据台账

### 3.1 可复现命令

```bash
# E01 响应头
curl -sS -I -L --max-time 20 "https://app.soul.io/"
# E02 响应体
curl -sS -L --max-time 20 "https://app.soul.io/" | head -40
# E03 无头浏览器渲染（Chrome 156，1440x900）
chrome --headless=new --no-sandbox --disable-gpu --virtual-time-budget=10000 \
  --window-size=1440,900 --screenshot=try.png "https://app.soul.io/"
# E04~E07 / E08：WebFetch 与 WebSearch 通道（非本地直连）
```

> 临时截图与目录已清理，未在项目工作区留下未跟踪文件；`git status -s` 为空。

### 3.2 证据台账

| ID | 通道 | 得到什么 | 局限 |
|---|---|---|---|
| E01 | `curl -I -L` | `HTTP/1.1 403 Forbidden`；`Server: cloudflare`；`CF-RAY: a57dab20bee703e9-HKG`；`X-Frame-Options: SAMEORIGIN`；`Referrer-Policy: same-origin`；`Cache-Control: private, max-age=0, no-store, no-cache, must-revalidate`；`Expires: Thu, 01 Jan 1970 00:00:01 GMT`；`alt-svc: h3=":443"; ma=86400`；`Report-To` / `Nel` 指向 `a.nel.cloudflare.com` | 是**拦截响应**的头，不代表应用站正常响应头 |
| E02 | `curl` 响应体 | Cloudflare 拦截页 HTML：`<title>Attention Required! \| Cloudflare</title>`、`Sorry, you have been blocked`、`You are unable to access soul.io`、`Why have I been blocked?`、`What can I do to resolve this?` | 非应用内容 |
| E03 | 本机无头 Chrome 截图 | 白底 Cloudflare 拦截页（红叉图标 + 两段说明文字） | 目标应用**未渲染**，无视觉证据 |
| E04 | `WebFetch https://app.soul.io/` | 标题 `Soul - Cross-Chain Lending Protocol`；正文 `Protocol_`；指标块 `Current APY / Max APY / 0 / 0% / Boost / Supply Balance $0 / Borrow Balance $0 / Borrow Limit $0 / 0%`，**整块重复两次** | 纯文本，无 DOM/class/style/script |
| E05 | `WebFetch https://app.soul.io/?__rea=1` | 与 E04 完全一致 | 说明该通道返回稳定静态快照；**仍不含原始标记**（要求返回 `<script>`/`<link>`/class 时亦无） |
| E06 | `WebFetch https://app.soul.io/robots.txt` | Cloudflare content-signals 说明性注释，定义 `search` / `ai-input` / `ai-train` 三类用途及「未声明即不授予也不限制」条款，附 EU 2019/790 Art.4 权利保留声明 | 由 Cloudflare 托管返回，**归属与是否为站点自有声明【U】**；无有效指令行 |
| E07 | `WebFetch http://app.soul.io/` | 标题与正文同 E04 | 仅说明 http/https 文本快照一致；不代表发生了重定向（通道不暴露状态链） |
| E08 | WebSearch 索引快照（`http://` 与 `https://` 两条） | 更完整的索引文本：`TVL $0` / `Daily Volume $0` / `Users 0` 与 `TVL 200.00B` / `Daily Volume 450.00M` / `Users 175.20K` 两组数值；`Protocol_`；同 E04 的指标块重复两次。另有 `docs.soul.io` 公开文档与第三方 testnet 图文指南 | **搜索引擎历史索引**，时点未知、非当前页面；第三方指南属二手文字描述 |
| E09 | 项目内文件（旁证） | `docs/02-soul落地页技术拆解.md`（www 落地页静态交付物拆解，§1.5 明确「不外推到应用站」）；`webapp/console.html` head 注释、`docs/03`、`docs/04` 中「参考 app.soul.io」的设计借鉴记录 | **是本项目作者的借鉴笔记，不是对目标站的取证**；不得当作观察结果 |

### 3.3 一条必须澄清的证据污染风险

项目内 `webapp/console.html` 的 head 注释与 `docs/03` 记录了一批特征（编号主导航、`Probe _` 标题描画、`ScrambleText`、渐变描边按钮、切角边框、`enter-exit` 面板切换、`Retrieving info` 运行态、`dotFlash`/`spin`/`pulse`、`autoloop 5s` 等）。这些是**本项目实现时自定的参数与借鉴清单**，其中 `docs/02` 的 `autoloop 5s` 等数值属于 **www.soul.io 落地页**的静态交付物观察。

> **【I】**：它们可能间接反映作者当时看到的界面，但**不能用于回答本次关于 `app.soul.io` 动画时长、缓动或状态机的任何问题**。本报告全部排除，避免把「设计借鉴」误报为「逆向观察」。

### 3.4 证据等级上限（为什么动画与交互几乎全为【U】）

1. 两条本地直连通道被 `403` 拦截 → **没有真实渲染**，无法截图、无法读 computed style、无法调用 `getAnimations()`、无法录制 Performance 轨迹；
2. `WebFetch` 通道只给渲染后的**文字**，多次要求返回 `<script src>` / `<link>` / class / 内联样式 / `data-*` 均无 → **拿不到 CSS `@keyframes`、`transition`、`animation-duration`、缓动函数**；
3. 搜索索引是**历史文本快照**，无时序、无样式、无事件；
4. REA MCP 分析工具在本会话未注册 → 无浏览器被动观察能力（该能力本可读取可访问性文本、脚本来源与存储键名，仍不产生交互）。

---

## 4. UI 结构与视觉层级

### 4.1 【O】已确认（仅文本层面）

| 项 | 观察 | 证据 |
|---|---|---|
| 页面标题 | `Soul - Cross-Chain Lending Protocol` | E04/E05/E07/E08 |
| 主标题 | `Protocol_`（含尾部下划线） | E04；E08 索引中为 `ProtocolProtocol__` |
| 全局指标字段（索引快照） | `TVL`、`Daily Volume`、`Users` | E08 |
| 卡片字段 | `Current APY`、`Max APY`、`Boost`、`Supply Balance`、`Borrow Balance`、`Borrow Limit` | E04 |
| 初值文案 | `0`、`0%`、`$0`（余额三项）、`Users 0`、`TVL $0`、`Daily Volume $0` | E04/E08 |
| 指标块重复 | 同一组 `Current APY … Borrow Limit 0%` 在文本中**连续出现两次** | E04/E05/E07/E08 |
| 标签重复 | 索引快照出现 `TVLTVL$0$0`、`Daily VolumeDaily Volume$0$0`、`UsersUsers00`、`ProtocolProtocol__` 等连写 | E08 |

### 4.2 【I】由「成对文本」出发的合理推断（多解，不可判定）

索引快照中 `TVL` 同时对应 `$0` 与 `200.00B`，且标签/数值成对连写。可能的解释包括（**并列，不断言任一为真**）：

- (a) 数值入场动画的**起始值与目标值**文本节点被抓取器同时收录（`$0` → `200.00B`）；
- (b) 服务端预渲染占位与客户端实际值两份 DOM 文本并存；
- (c) 骨架/空态与已加载态两套节点共存，抓取时合并；
- (d) 抓取器对重复渲染或双份响应式容器做了文本拼接。

> 若 (a) 成立，也只能说明「可能存在数值过渡」，**不能推出时长、缓动、触发条件或先后顺序**。【U】

### 4.3 【U】无法验证的视觉维度

按 `frontend-design` 四支柱逐项声明：

| 维度 | 状态 | 缺失证据 |
|---|---|---|
| 排版（字体族、字阶、字距、行高） | 【U】 | 无 CSS、无 computed style、无渲染截图 |
| 色彩与主题（主色/强调色/对比度） | 【U】 | 无颜色值、无像素；E03 是拦截页配色，**不可套用** |
| 构成（栅格、栏数、间距、非对称/重叠） | 【U】 | 无布局盒模型、无截图 |
| 氛围层（渐变/噪点/发丝线/阴影） | 【U】 | 同上 |
| 视觉层级（主次、密度、留白） | 【U】 | 同上 |
| 响应式行为（断点、窄屏表现） | 【U】 | 未在多视口渲染目标页面 |
| 可访问性（对比度 ≥4.5:1、焦点圈、44px 目标） | 【U】 | 无 DOM、无可访问性树 |

> 因此本报告**不给出**「科技感/层次/高级感」之类的主观评级，也不套用反 AI 味清单打分 —— 那需要视觉证据。

---

## 5. 核心组件及交互状态

### 5.1 【O】可识别的文本组件（仅为「字段集合」，不等于组件实例）

| 组件候选 | 依据字段 | 证据 |
|---|---|---|
| 全局指标条 | `TVL` / `Daily Volume` / `Users` | E08 |
| APY 卡 | `Current APY` / `Max APY` / `0` / `0%` / `Boost` | E04 |
| 余额卡组 | `Supply Balance $0` / `Borrow Balance $0` / `Borrow Limit $0` / `0%` | E04 |
| 页面标题 | `Protocol_` | E04 |

### 5.2 【U】交互状态全部无法验证

以下均为**页面正常渲染后才能观察**，本次无一项有证据：hover / focus-visible / active / disabled / loading / error / empty、按钮禁用条件、tab 切换、模态框、钱包连接控件、表单输入与校验、下拉/选择器、过渡中的中间态。

- E04 与 E08 的返回文本中**未见**任何导航标签、按钮文案、表单、钱包连接文字、加载或错误提示（多次定向询问均返回同一文本快照）。这只能说明「该通道返回的文本中没有这些字符串」，**不能证明页面上不存在**这些控件 —— 典型地，纯图标按钮、canvas/SVG 内文字、JS 后注入内容不会出现在文本快照中。
- `data-*` 属性、class 名、`inline style`、`<script src>`、`<link>`：E05 明确要求后仍未返回 → 【U】。

### 5.3 二手资料（不计入观察，仅列作待核对线索）

- **第三方 testnet 图文指南（E08）**：以文字描述过「Connect Wallet」按钮、`1.0 Protocol` 标签页、`Supply`/`Borrow`/`Withdraw`/`Add/Rmove Collateral`/`Repay` 按钮、`Repay` 在有借款后才激活、`Claim`→`Claimed` 状态、`Verify` 按钮、任务 tab、`Approve & Supply` 与交易确认提示。→ **【I】** 这些描述针对特定时期的 testnet 版本，与 2026-11-09 的页面是否一致【U】；且是指南作者转述，非本次观察。
- **官方 `docs.soul.io` 文档（E08）**：描述 `Borrow Limit`、`Health Factor`、`Liquidation Limit`、`sToken` 等业务概念。→ 属于**公开协议文档**，不是页面前端表现；按用户限定，不用于推断界面实现。
- **项目内 `docs/02`（E09）**：为 `www.soul.io/?ref=landing.love` 落地页的静态交付物拆解（Nuxt SPA 外壳、21 个 JS 分包、5 个 CSS、GSAP/Lenis/Howler/RainbowKit 等），其 §1.5 明确「**不外推到应用站**」。→ 本报告严格遵守，不用它描述 `app.soul.io`。

---

## 6. 动画与过渡（本次核心未答项）

### 6.1 逐项对照用户要求

| 要求 | 结论 | 理由 |
|---|---|---|
| 触发条件（滚动 / 入场 / hover / 状态变更） | 【U】 | 无事件监听证据、无运行时 |
| 先后顺序 / 编排 | 【U】 | 无多帧采样、无 `animation-delay` 声明 |
| 可观察的持续时长 | 【U】 | 无 `animation-duration` / `transition-duration`、无 Performance 录制 |
| 节奏与缓动特征 | 【U】 | 无 `timing-function` / `cubic-bezier`、无帧序列 |
| 状态切换关系（enter/exit、状态机） | 【U】 | 无 DOM 状态快照、无 class 变更记录 |
| 降级方案（`prefers-reduced-motion`） | 【U】 | 无媒体查询文本 |

> **重要**：任何具体的秒数、毫秒数、`ease` 曲线名、错峰间隔，本报告**一概不提供**。若在其他文档看到 `autoloop 5s`、`dotFlash 2s` 之类数值，请注意那是本项目 `www.soul.io` 落地页拆解或本项目自实现参数（§3.3），**不是本次对 `app.soul.io` 的测量结果**。

### 6.2 唯一与「动效」有关的弱线索

【O】E08 索引快照存在「标签/数值成对连写」与「`$0` ↔ `200.00B` 双值」（§4.2）；【I】可能暗示数值型入场过渡，但四种解释并列且**无时序数据**，故不足以支撑任何动效结论。

### 6.3 补齐所需的条件（建议，不构成越权操作）

若后续在**获得站点许可且网络出口被允许**的前提下补齐，需要：

1. 真实浏览器成功渲染目标页面（解除 `403` 拦截），采集 DOM 与可访问性树；
2. `getComputedStyle` 读取 `animation-*` / `transition-*` / `transform` / `opacity`；
3. `document.getAnimations()` + DevTools Animations/Performance 轨迹测时长与缓动；
4. 多帧截图或视频比对入场序列与状态切换；
5. 读取公开交付的 CSS/JS 中 `@keyframes` 与 `animation:` 简写文本（**静态观察**，不反编译、不去混淆）；
6. 在 `prefers-reduced-motion: reduce` 下复测降级。

---

## 7. 主要业务逻辑与状态流转

### 7.1 【O】可直接确认的静态文本态

- 页面文本中存在一组**全零读数**：`$0`（TVL / Daily Volume / Supply / Borrow / Borrow Limit）、`0%`、`Users 0`、`0`。
- → 可确认「存在一种以零值呈现的文本状态」。**不能**据此断言它是加载态、未连接钱包态、空账户态还是占位值：这几者文本完全相同。【I】

- 指标块重复两次（E04/E05/E07/E08 一致）→ 可确认文本层面存在成对结构；成因【U】。

### 7.2 【U】无法验证的业务逻辑项

| 项 | 状态 |
|---|---|
| 用户操作 → 界面反馈的状态流转 | 【U】无交互、无事件 |
| 数据加载（请求时机、骨架屏、占位→实值） | 【U】无网络瀑布、无 DOM 时序 |
| 错误状态（失败提示、重试、超时） | 【U】文本快照中无相关字符串，但不能反证不存在 |
| 空状态（文案、插画、CTA） | 【U】同上 |
| 关键边界（零值、极值、精度、越界、未连接钱包、断网） | 【U】 |
| 交易/确认流程 | 【U】仅第三方指南二手描述（§5.3） |
| 服务端实现 / 私有接口 / 私有数据 | **按要求排除，不予推测** |

### 7.3 一个保守的【I】状态假设（非状态机）

基于「全零读数 + 索引快照存在非零目标值」，可假设页面存在「初始值 → 数值型读数」的呈现变化；但**这是假设，不是观察到的状态机**，无法给出触发条件、中间态数量、失败分支或终态。任何更细的流转图都会超出证据。

---

## 8. 三分清单汇总

**【O】已确认观察**（6 条）：页面标题 `Soul - Cross-Chain Lending Protocol`；主标题 `Protocol_`；指标字段集合；全零初值文案；指标块文本重复两次；`curl`/Chrome 直连返回 Cloudflare `403` 拦截页及 E01 响应头；`robots.txt` 返回 content-signals 说明性注释。

**【I】合理推断**（4 条）：成对连写文本可能来自数值动画双文本节点 / SSR+CSR 双份 / 骨架与实值并存 / 抓取拼接（四解并列）；全零态可能是未连接钱包或占位；第三方指南描述的是历史 testnet 版本；项目内借鉴注释可能间接反映作者所见但不可作证据。

**【U】无法验证**（主要）：全部视觉与排版参数、全部组件交互状态、全部动画参数（触发/顺序/时长/缓动/状态切换）、`prefers-reduced-motion` 降级、DOM/class/script/CSS 原始标记、数据加载与错误/空态流转、边界情况、导航与按钮文案、响应式行为、可访问性、`robots.txt` 声明的归属与站点自有意图。

---

## 9. 需求清单回访

| # | 用户要求 | 状态 | 备注 |
|---|---|---|---|
| 1 | UI 结构与视觉层级 | 部分回答 | §4：仅字段文案；视觉层级全【U】 |
| 2 | 核心组件及交互状态 | 部分回答 | §5：仅文本组件候选；交互状态全【U】 |
| 3 | 动画触发条件 | 未回答 | §6.1 |
| 4 | 动画先后顺序 | 未回答 | §6.1 |
| 5 | 可观察持续时长 | 未回答 | §6.1（不提供任何数值） |
| 6 | 节奏与缓动特征 | 未回答 | §6.1 |
| 7 | 状态切换关系 | 未回答 | §6.1 |
| 8 | 用户操作→界面反馈 | 未回答 | §7.2 |
| 9 | 数据加载 / 错误 / 空态 | 部分回答 | §7.1 仅确认「全零文本态」存在 |
| 10 | 关键边界情况 | 未回答 | §7.2 |
| 11 | 区分观察/推断、标注无法验证 | 已回答 | §2、§8 三分清单 |
| 12 | 不推测服务端实现/私有数据 | 已遵守 | 全文 |

> 按 REA「结束前回访清单」要求：上述 12 项中 **2 项已答、3 项部分回答、7 项未答**。未答项不是遗漏，而是**证据不可得**；本报告不以推断补齐，也不把有限观察描述为完整分析。

---

## 10. 与本项目既有材料的关系（防止误用）

- 本报告是**独立分析**，与 `D:\AIBBBG\Version1` 的实现无关；未修改任何现有文件、代码或文档（仅新增本报告），`git status` 干净。
- `docs/02-soul落地页技术拆解.md` 针对 `www.soul.io` 落地页，**不得与本报告的 `app.soul.io` 结论互相引用为证据**；两者域名、工程、取证方式均不同。
- `webapp/console.html` head 注释中的「参考来源」是**设计借鉴声明**，不构成对目标站点的观察记录（§3.3）。

---

## 11. 复现与核对

报告中每条【O】均可通过 §3.1 命令复现。需要注意的可变性：Cloudflare 拦截与 `CF-RAY` 值随出口与时点变化；WebFetch 文本快照与搜索引擎索引为各自抓取时点的结果，**不保证与任意时刻的真实渲染一致**。因此本报告结论的适用范围限定为「2026-11-09 本次取证通道所返回的内容」。
