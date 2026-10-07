# ATC-animate-simulator 重构方案 v2 —— 从“雷达动画模拟器”到“空管指挥游戏”

> 状态：**已定稿（路线 A：保留零构建 ES 模块 + Canvas 2D）**
> 目标版本：v2.0.0
> 本文件是重构的唯一上位依据：分层规则、领域模型、玩法系统、界面规范、里程碑与验收标准。
> 配套文档：[`docs/FLIGHT-LIFECYCLE.md`](FLIGHT-LIFECYCLE.md) —— **航班全流程与管制岗位服务规范**：
> 凡涉及"某阶段由哪个岗位提供什么服务、下什么指令、复诵什么、何时移交"以该文为准（本文定架构，该文定业务过程）。
> 配套文档之二：[`docs/WORKPLACE.md`](WORKPLACE.md) —— **工作现场与值班制度规范**（P5 · v2.1+）：
> 凡涉及"人在哪、能不能上岗、上多久、谁来接班、现场出了什么事"以该文为准（本文定架构，该文定现场与值班）。
> 配套文档之三：[`docs/CCAR-93TM-ALIGNMENT.md`](CCAR-93TM-ALIGNMENT.md) —— **CCAR-93TM-R6 规章对齐与合规边界**（P6 · v2.1+）：
> 凡涉及"这条规则为什么这样定、现实依据是什么、我们简化到什么程度"以该文为准；其中的数值均为游戏化示意值，不得作为真实运行依据。

---

## 1. 目标与定位

**一句话**：玩家不再“看雷达动画”，而是**值守一个管制席位的管制员**——按班次上班，用真实用语把进离港流量按程序送出去，安全、有序、准点，班次结束拿评分与复盘。

**核心循环（一个班次 15–25 分钟）**

```
接班（风/跑道构型/ATIS） → 流量按时刻表注入 → 读进程单规划顺序
        ↓                                        ↓
   实时可视化反馈 ← 发许可/引导/调速/移交（指令台 / 点击飞机）
        ↓
   安全间隔与队列压力（告警、复飞、特情） → 落地/离场记账 → HUD 实时分数
        ↓
   班次结束：S/A/B/C 评级 + 事件时间轴复盘（可点回放到那一刻）
```

**三条设计支柱**

| 支柱 | 含义 | 工程落点 |
|---|---|---|
| 程序化 | STAR/SID/ILS/等待航线/放行许可全部数据驱动 | `data/airports/*.json` + `domain/procedures.js` |
| 可复盘 | 确定性时间推演：录输入序列即可逐帧复现并复核评分 | `simulation/motion.js`（已具备）+ `game/session.js` |
| 可教 | 指令台只提示“合法且推荐”的用语；讲评指出更优做法 | `data/phraseology.js` + `domain/phases.js` 的 `canIssue` |

**对标参考**：MSFS/Flight Simulator 的 ATC 流程（放行 CRAFT → 滑行 → 塔台 → 进近 → 移交）与中国民航用语（`可以起飞 / 可以落地 / 移交塔台 / 联系进近`）**两套用语并存**。

---

## 2. 现状资产盘点

### 2.1 直接继承（不重写，仅迁移/包裹）

| 资产 | 位置 | 新架构中的角色 |
|---|---|---|
| 确定性时间推演 + 约束收敛 | `simulation/motion.js`、`constraints.js` | **仿真内核**：位置/高度/速度/航向按时间解析求解 |
| 事件总线 + store 动作 | `core/eventBus.js`、`store.js` | **架构骨架**（扩展事件表见 §5） |
| 席位/移交/许可/跑道 | `simulation/units.js`、`data/atcUnits.js` | 上迁为 `domain/airspace.js` + `domain/clearances.js` |
| 指令解析/执行 | `commands/parser.js`、`executor.js` | 升级为 用语模板 + 补全 + 复诵（P1/P3） |
| Canvas/视口/坐标换算 | `core/viewport.js`、`render/*` | 复用，并扩展出 `render/profile`、`render/hud` |
| 天气（风暴/风场/逆风跑道） | `weather/*` | 成为“跑道构型与特情来源” |
| 机场/跑道/频率数据 | `data/airports.js` | 迁移到 `data/airports/*.json` 并扩展程序数据 |
| Electron 壳 / 冒烟测试 / 打包发布链 | `desktop/main.js`、`package.json`、`tools/*` | 原样复用（断言数随阶段递增） |

### 2.2 必须重做或新建

| 现状问题 | 新方案 |
|---|---|
| 飞机只有“位置 + 3 个约束”，无阶段概念 | **飞行阶段 FSM**：`domain/phases.js`（P0） |
| “进港/离港”与“飞行阶段”混用一个 `ac.phase` 字段 | 拆为 `ac.flow`（进/离港）与 `ac.phase`（FSM 阶段），旧存档自动升级（P0） |
| 没有飞行计划/时刻表 → 无班次、无准点率 | `data/scenarios/*.json` + `game/director.js`（P1） |
| 没有目标/评分 | `game/objectives.js` + `game/scoring.js`（P1） |
| “拖时间轴 = 改历史”与游戏冲突 | 游戏内**实时不可回溯** + 复盘**只读重放**（P0 立时钟，P1 接关卡） |
| 冲突只判“当前”，无预测 | `domain/separation.js`：外推 120s 的最小预计间隔（P0） |
| 无垂直剖面视图 | `render/profile/*`：进近剖面 + 高度-时间曲线（P2） |
| 指令输入全靠记忆 | 指令台 2.0：补全/模板/复诵/快捷条（P1） |
| 地图编辑器占据主界面 | 降级为 `sandbox/` 沙盒与关卡编辑模式（P4） |
| 存档 v2 单键 JSON | 场景包 v3 + 进度/成绩/会话分离存储（P1/P4），v2 自动迁移（P0 起） |

---

## 3. 目标架构

### 3.1 分层与依赖方向（强制）

```
        ┌──────────── 输入 input：console（指令台）· canvasInput · hotkeys
        ↓
   ┌─ 界面 ui：strips（进程单）· panels · dialogs · review（复盘）· subscriptions
   │    ↓
   │  游戏 game：session（班次/时钟/输入录制）· director · objectives · scoring · events
   │    ↓
   │  领域 domain：aircraft · phases · procedures · airspace · clearances · separation · wind
   │    ↓
   │  仿真 simulation：motion（时间推演）· constraints（约束原语）· geometry（纯几何）
   │    ↓
   └─ 内核 core：eventBus · store · clock · viewport · persistence · constants · ids · dom

  数据 data（机场/程序/用语/席位）与 天气 weather 为横向资源，可被 domain 及以上层引用。
```

**依赖规则（由 `tools/check-imports.mjs` 强制校验，越界即失败）**

| 层 | 目录 | 允许 import |
|---|---|---|
| 0 内核 | `core/` | 仅 `core/` |
| 1 仿真/天气 | `simulation/`、`weather/` | 层 0–1 |
| 2 数据/领域 | `data/`、`domain/` | 层 0–2（`domain` 可 import `simulation`、`data`） |
| 3 游戏/渲染 | `game/`、`render/` | 层 0–3 |
| 4 命令/生成 | `commands/`、`generators/` | 层 0–4 |
| 5 界面 | `ui/` | 层 0–5 |
| 6 输入 | `interaction/` | 层 0–6 |
| 入口 | `js/main.js` | 全部（唯一允许的“装配点”） |

**反向依赖的破法（P0 已落地）**：`simulation/motion.js` 原先直接 import 领域层的席位推进函数；
现改为**依赖倒置**——motion 暴露 `onAircraftStep(fn)` 注册逐帧钩子，由 `js/main.js` 注入 `domain/airspace.js` 的推进函数。

### 3.2 目录结构（目标态；★ = 已存在，☆ = 待建）

```
js/
├── core/        ★ eventBus store viewport persistence constants accessors ids dom
│                ☆ clock.js            # 固定步长时钟（P0）
├── simulation/  ★ motion constraints geometry
├── domain/      ☆ aircraft phases airspace clearances separation      # P0
│                ☆ procedures vectoring wind                            # P3
│                ☆ roster.js seats.js handoff.js priority.js             # P5 值班/疲劳/交接 · P6 席位门槛/责任移交/优先顺序（纯函数）
├── game/        ☆ session（P0） · scenario director objectives scoring events（P1）
│                ☆ avatar.js workplace.js                              # P5 小人移动 / 现场装配与代管
├── commands/    ★ parser executor
├── render/      ★ background routes aircraft airports index
│                ☆ radar/* hud/* profile/*          # P1/P2
│                ☆ scene.js                         # P5 工作现场俯视（房间/席位/角色/事件图标）
├── ui/          ★ panels dialogs indicators commPanel seatPanel formBindings subscriptions index
│                ☆ strips console review panels/* dialogs/*   # P1
│                ☆ rosterPanel.js prepPanel.js debriefPanel.js  # P5/P6 值班/交接检查单/岗前准备/讲评
├── data/        ★ airports atcUnits aircraft airlines waypointTypes
│                ☆ airports/*.json scenarios/*.json phraseology.js  # P1/P3
│                ☆ agreements.js atis.js logFields.js                # P6 管制协议 / ATIS 通播 / 九项工作日志
│                ☆ emergencyPlans.js handoverChecklist.js            # P6/P5 应急预案六要素 / 交接检查单
│                ★ viewProfiles.js  ☆ workspaces.js roster.js        # 席位地图档案(v1.7) / 现场布局(P5) / 值班参数(P5-P6)
├── weather/     ★ perlin stormRadar weather
├── generators/  ★ flightGenerator
├── interaction/ ★ canvasInput keyboard palette toolbar factory
│                ☆ avatarInput.js                            # P5 现场层输入（WASD/E/Q/F/Tab）
└── sandbox/     ☆ 原编辑器（P4 迁入）
```

---

## 4. 领域模型

### 4.1 航空器（`domain/aircraft.js`）

```js
{
  id, callsign, type, wake,          // 呼号 / 机型 / 尾流类别（间隔用）
  flow: 'arrival' | 'departure',     // 进港 / 离港（由原 phase 字段升级而来）
  phase: 'CRUISE',                   // FSM 阶段（§4.2）
  plan: { dep, arr, cruiseAlt, sid, star, approach, rwy, schedLanding },
  state: { x, y, altitude, speed, heading, onGround, squawk },
  target: { altCon, spdCon, hdgCon, fixName, holdFix },   // 已下达指令的目标
  unit: 'TWR' | 'APP' | 'ACC',       // 当前席位
  runway, approachType, clearance,   // 管制属性（塔台/进近内容）
  clearances: [{ type, args, issuedAt, readback: 'ok' | 'pending' | 'wrong' }],
  history: [{ t, alt, spd, hdg }],   // 采样（剖面图 / 复盘）
  flags: { landed, goAround, emergency }
}
```

### 4.2 飞行阶段 FSM（`domain/phases.js`，P0 已实现）

```
地面：PARKED → TAXI → HOLD_SHORT → TAKEOFF_ROLL → VACATE → TAXI_IN → ARRIVED
离港：INIT_CLIMB → CLIMB → CRUISE
进港：DESCENT → STAR → HOLD → VECTOR → FINAL_APPROACH → LANDING_ROLL → ARRIVED
异常：任何空中阶段 → GO_AROUND → VECTOR / STAR
```

- `derivePhase(ac)`：**由状态推导**（高度/速度/是否已许可/席位/进近方式），不引入隐藏状态，保证时间轴可重放。
- 地面段（`PARKED` / `TAXI` / `HOLD_SHORT` / `TAKEOFF_ROLL` / `VACATE` / `TAXI_IN`）的**服务链与岗位职责**
  见 [`docs/FLIGHT-LIFECYCLE.md`](FLIGHT-LIFECYCLE.md) §3–§7；该文 §10 给出了当前 `derivePhase` 尚未产生地面段的差距清单。
- `canIssue(ac, type)`：该阶段**是否允许**下发某类指令——P1 用于指令台灰显与提示，P3 拟真难度下强制拦截。
- 阶段变化 `emit('phase:changed')`：进程单、标签、评分、目标判定统一订阅，避免各自推断。

### 4.3 许可（`domain/clearances.js`）

- 许可对象：`{ type: 'TAKEOFF'|'LAND'|'APPROACH'|'HANDOFF'|'ALT'|'SPD'|'HDG'|'DIRECT'|'HOLD'|'EXPECT_RWY', args, issuedAt, readback }`
- 每次下发产生**机组复诵**（写入通话面板）；严格模式下比对关键参数，不一致 → 要求更正并计入评分。
- 许可有效期（如进近许可超时未建立航道 → 提示/失效）在 P3 引入。

### 4.4 席位与扇区（`domain/airspace.js`）

在 TWR / APP / ACC 基础上支持多扇区（如 `APP_W` / `APP_E`）、扇区边界（距离环或多边形）、
移交链与“移交超时”告警、“邻区来话”事件（进入前 2 分钟提醒移交）。
**距离换算一律使用 `pxToKmFixed` / `kmToPxFixed`**：缩放地图不得改变席位归属与判定结果。

### 4.5 间隔与预测（`domain/separation.js`）

- 保留现行判定：`isAircraftInConflictAt` / `getConflictPairs`（阈值取自 `state.defaults.minSeparationNm` 与 `CONFLICT_ALT_M`）。
- 新增**预测**：`predictMinSeparation(a, b, horizonSec)`、`predictedConflicts(horizonSec)`，
  分级 `AMBER`（预计 < 1.2×标准）/ `RED`（预计 < 标准）。这是管制游戏的紧张感来源，也是评分“安全项”的输入。

---

## 5. 事件表（在现有 6 个事件上扩展）

| 事件 | 载荷 | 订阅方 |
|---|---|---|
| `session:started` / `session:ended` | sessionId, scenario | HUD、复盘、存档 |
| `clock:tick` | simTime, dt | 采样器、HUD |
| `aircraft:spawned` / `:landed` / `:arrived` | ac | 进程单、计分、director |
| `clearance:issued` / `:readback` | ac, clearance | 指令台回显、进程单、计分 |
| `phase:changed` | ac, from, to | 进程单、渲染、目标判定 |
| `alert:raised` / `:cleared` | { level:'amber'｜'red', kind:'SEP'｜'RWY'｜'PROFILE'｜'HANDOFF', acs } | HUD、进程单闪烁、计分 |
| `pilot:request` | ac, kind | 指令台提示（超时未响应扣分） |
| `goaround` | ac, reason | 计分、渲染、通话 |
| `score:changed` | delta, reason, eventId | HUD、复盘时间轴 |
| `selection:changed`（已有） | item | 渲染高亮 + **剖面图联动** |
| `unit:changed`（已有，收敛为席位专用） | ac, from, to | 席位面板、进程单 |
| `comm:added`（已有） | msg | 通话面板 |
| `workspace:entered` / `avatar:moved`（P5） | code / { x, y, facing, state } | 现场层渲染（`render/scene.js`） |
| `seat:taken` / `seat:released`（P5） | { seatId, unit, view } | **席位地图档案切换**（`setActiveViewKey`）+ 渲染图层 + 席位面板 |
| `shift:rest_due` / `handover:done`（P5） | { fatigue, forced } / { missed, score } | 值班面板、评分、复盘 |
| `supervisor:finding` / `bulletin`（P5） | { seatId, kind, text } / { kind, text, effect } | 通话面板、通报板、导演（流控速率 / 跑道构型） |
| `emergency:raised` / `emergency:resolved`（P5） | { kind, ac, seat, handled } | HUD、评分、复盘时间轴 |
| `seats:planned` / `seat:merged` / `seat:opened` / `seat:closed`（P6） | { plan } / { from, to, reason } / { seatId, unit } | 现场层、席位面板、日志（§63①） |
| `duty:prep_started` / `:prep_done` / `:prep_failed` / `:overflow`（P6） | { reason, items } / { dutySec } / { item } / { extraSec } | 岗前准备面板、值班面板、复盘 |
| `handover:familiarize` / `handoff:requested` / `:accepted` / `:rejected`（P6） | { sec } / { ac, to } / { ac, to } / { ac, to, reason } | 交接台、席位面板、进程单、评分 |
| `clearance:voided` / `readback:corrected`（P6） | { ac, clearance, reason } / { ac, item, attempts } | 指令台、进程单、评分、复盘 |
| `separation:standard_changed` / `runway:braking_changed`（P6） | { unit, from, to, reason } / { runway, level, factors } | HUD、ATIS 面板、许可播报、复盘 |

---

## 6. 驱动模型：实时 + 回放双驱动

| 模式 | 时钟 | 可否回溯 | 用途 |
|---|---|---|---|
| 游戏（值班） | `core/clock.js` 固定步长 1/60s + 倍率 1×/2×/4× | 否（“快进”只能是等待） | 正式班次，动作写入 `session.inputs[]` |
| 复盘 | 只读推演 | 是（任意拖动） | 用 `scenario + inputs[]` 重放，分数与当时一致 |
| 沙盒 | 原时间轴 | 是 | 关卡编辑、教学演示 |

**为什么可复盘**：位置/高度/速度全部由 `(时间, 起始状态, 约束)` 解析求得（`updateAircraftPositionsForTime`），
不依赖逐帧累积；只要记录**输入序列 + 时间戳**与**随机种子**，重放结果即可逐帧一致。

---

## 7. 玩法系统

### 7.1 关卡与班次

| 关卡 | 内容 | 目标示例 |
|---|---|---|
| L1 塔台启航 | 单跑道出场，6 架离港 | 放行及时、无跑道占用冲突 |
| L2 进近入门 | 8 架进港，顺序落地 | 平均延误 < 3 min，零复飞 |
| L3 混合流量 | 进离港 16 架 + 跑道切换 | 吞吐 ≥ 10 架/小时，零间隔事件 |
| L4 高峰带宽 | 24 架 + 风切变 + 跑道临时关闭 | 重新排序，零安全违规 |
| L5 特情联考 | 医疗紧急、通讯失效、复飞处置 | 特情处置正确率 |
| 沙盒 | 自由编辑航路点/航线/飞机 | 无评分，教学与实验 |

难度预设：**街机 / 标准 / 拟真**——分别影响间隔严格度、用语强制、飞行员请求频率、天气随机、告警宽容时间。

### 7.2 评分模型（纯函数，可单测）

```
Score = 100
  − 安全：间隔 RED −15 / AMBER −5；跑道侵入 −20；未授权进入 −10
  − 效率：每架延误 > 3min −2；每次复飞 −6；平均指令数超基准每 +1 −1
  − 质量：未复诵 −3；用语不合规（拟真）−2；移交超时 −2
  + 加分：提前完成 +5；特情正确处置 +10；连续 5 架无延误 连击 +3
评级：S ≥ 95 / A ≥ 85 / B ≥ 75 / C ≥ 60 / D < 60，附事件时间轴（逐条可点回放）
```

### 7.3 特情与随机事件（`game/events.js`）

风变导致跑道反向（需重新排序）｜雷暴单元漂移（绕飞）｜跑道临时关闭（FOD/清理）｜
医疗紧急（优先落地）｜通讯失效（按程序等待/引导）｜进近不稳定复飞｜低油量请求直飞。

### 7.4 用语系统（`commands` + `data/phraseology.js`）

- **语法**：`呼号 + 指令(+数值)(+条件)`，支持链式：`CCA1234 下降到 900 保持 180，建立 ILS 进近 跑道 02L`。
- **模板**：指令台按“选中飞机 + 当前阶段”只列出**合法且推荐**的用语（非法项灰显并给出原因，如“尚未进入进近阶段”）。
- **复诵**：严格模式比对关键参数，不一致 → 要求再次确认，累计计入评分。
- **快捷条**：`↑↓ 高度`、`+− 速度`、`←→ 航向`、`进近 / 落地 / 移交 / 等待 / 复飞` 一键可点，键盘 `1..9`。

### 7.5 工作现场与值班（P5 · 见 [`docs/WORKPLACE.md`](WORKPLACE.md)）

三个席位**不只是三张地图，而是三个工作现场**（区域管制大厅 / 进近管制室 / 塔台）：玩家操控一个**小人**，
走到席位就座即进入该席位的席位地图；现场有 **AI 同事**（邻扇区、协调席）、**领班**（巡视 / 通报 / 授权 / 讲评）、
**休息区与交接台**。

- **值班制度**：疲劳累积（`domain/roster.js`）→ 提示休息 → 强制休息 → **交接班检查单** → 接班管制员（AI）接管；
  离席期间由 AI **代管**（走 `core/random.js`，同 seed 可复现）
- **突发情况**：席位突发（特情航班，走既有指令链路）/ 现场突发（设备、人员）/ 协同突发（跑道侵入、FOD）；
  领班**通报**会改变玩法条件（流控速率、跑道构型、设备降级）
- **分层落点**：`data/workspaces.js`(1) · `domain/roster.js`(2) · `game/{avatar,workplace}.js`(3) ·
  `render/scene.js`(3) · `ui/rosterPanel.js`(5) · `interaction/avatarInput.js`(6)
- **红线**：移动低成本（默认坐席开局 + 快速前往 + 可关闭现场层）；离席不毁体验；一切可复现

### 7.6 规章对齐（P6 · 见 [`docs/CCAR-93TM-ALIGNMENT.md`](CCAR-93TM-ALIGNMENT.md)）

本文与 WORKPLACE 解决"**人在哪、制度怎么跑**"，规章对齐文档解决"**这些规则的现实依据是什么、我们简化到什么程度**"。

- **席位设置门槛规则化**：按架次/跑道/雷达条件自动推导应开席位（`domain/seats.js`），让"小机场合并值守 / 大机场分席"可被体验
- **岗位工作制度三件套**：值班 FSM（`PREP → ON_POSITION → DEBRIEF`）+ 岗前准备 5 项 + 交接班 7 项检查单
- **责任移交三要素**：`requestHandoff / accept / reject`，`HANDOFF_PENDING` 期间责任**不转移**（旧实现一步改 `ac.unit` 属缺陷）
- **许可与复诵必背清单**：按 §118 补齐 `holdShort / crossRunway / backtrack / lineUp / qnh / squawk / transitionLevel / route`，含 `voidAt` 失效时间
- **间隔分级**：进近 ≥5.6 km / 区域 ≥9.3 km，未协调边界 2.8/4.7 km；`tieredSeparation` **默认 false**，不破坏 v1.6 手感
- **执勤疲劳硬指标**：连续执勤 / 周执勤 / 管制席 6 h / 雷达 2 h 轮换，全部压缩为游戏时长（见对齐文档 §8.2）
- **记录与合规边界**：九项工作日志（§63）+ 保存分级（§64–§66）；**§69 不得用于商业目的 → 不采集、不上传、不对外提供**
- **红线**：所有新机制默认关闭或走旧路径；`npm run check` 与 `npm run smoke` 现有断言必须保持全 PASS

---

## 8. 界面设计

### 8.1 布局

```
┌──────────────────────── HUD（屏幕空间）────────────────────────┐
│ 席位 · 班次时钟 · 分数(评级) · 告警计数 · 风/跑道 · 速度倍率      │
├──────────┬──────────────────────────────┬─────────────────────┤
│ 电子进程单 │        2D 雷达屏              │   高度剖面图         │
│ 按席位分栏 │ 范围环/方位刻度/扇区边界       │  [进近剖面]          │
│ 可点击     │ SID·STAR 程序线 + 限制标注     │  [高度-时间]         │
│           │ ILS 航道/等待航线              │  [等待航线]          │
│           │ 航空器数据块 + 速度矢量线      │                     │
│           │ 冲突连线 + 预测冲突点 ⚠        │  与选中机联动        │
├──────────┴──────────────────────────────┴─────────────────────┤
│ 指令台：选中飞机摘要 · 输入框(补全) · 模板按钮 · 快捷条 · 复诵回显 │
└───────────────────────────────────────────────────────────────┘
```

雷达主题：**真实雷达屏风**（黑底、范围环、方位刻度、等距引导线、单色/琥珀可选），与现有白底图并存可切换。

### 8.2 高度剖面图（P2 核心交付）

**视图 A 进近剖面**（`render/profile/approachProfile.js`）
- 坐标：X = 距跑道入口距离（0→40nm，可切换线性/非线性），Y = 高度（0→12000ft，可跟随选中机自动缩放）。
- 叠加：STAR 高度限制带、3° 下滑道、FAF/FAP/DME 定位点、跑道入口、MVA 阶梯、复飞爬升梯度。
- 选中机：实心符号（当前高度）+ 虚线（已指派目标高度）+ 距入口距离与垂直偏差读数；偏离/低高度以黄/红描边。

**视图 B 高度-时间曲线**（`altitudeHistory.js`）：滚动 5 分钟窗口，被跟踪飞机各一条色线 + 目标高度虚线 +
指令/复诵/移交的竖向事件标记（用于讲评）。

**视图 C 等待航线/程序图**（P3）：等待椭圆 + 入航出航判定。

**联动**：雷达屏 ↔ 进程单 ↔ 剖面图 ↔ 通话记录四处选中态统一由 `selection:changed` 驱动。

### 8.3 渲染与性能

- 雷达屏分**静态层缓存**（网格/范围环/扇区/程序线：仅视口变化时重绘）与**动态层**（飞机/标签/矢量/告警）。
- 标签离屏缓存 + 视口裁剪，目标 60 架以上不卡；剖面图 30fps 节流 + 每机 5 分钟 @1Hz 环形采样。

---

## 9. 数据与存档

**场景包 v3（`data/scenarios/*.json`）**

```json
{
  "v": 3, "id": "l2-approach-basic", "name": "进近入门 · ZUUU 02L",
  "airport": "ZUUU",
  "config": { "wind": { "dir": 20, "spd": 8 }, "activeRunways": ["02L"],
              "weather": { "enabled": true, "intensity": 0.4 }, "seed": 20261007 },
  "difficulty": "standard",
  "traffic": [
    { "callsign": "CCA1234", "type": "A320", "dep": "ZBAA", "arr": "ZUUU",
      "star": "SASAN1A", "approach": "ILS", "rwy": "02L",
      "spawnAt": 120, "schedLanding": 900, "cruiseAlt": 10600 }
  ],
  "objectives": [
    { "kind": "NO_SEPARATION_BREACH", "weight": 30 },
    { "kind": "AVG_DELAY_MAX", "value": 180, "weight": 25 },
    { "kind": "MIN_LANDINGS", "value": 8, "weight": 20 }
  ],
  "randomEvents": [{ "at": 600, "kind": "RWY_CLOSED", "rwy": "02L", "duration": 240 }]
}
```

**存储键规划**

| 键 | 内容 | 阶段 |
|---|---|---|
| `atc_simulator_state_v2` | 现有场景存档（沙盒）——**保留键名**，读入时把 `ac.phase` 迁移为 `ac.flow` | P0 |
| `atc_scenario_v3` | 关卡场景包 | P1 |
| `atc_session_v3` | 当前班次（含 `inputs[]`，支持中途退出续玩） | P1 |
| `atc_progress_v3` | 关卡解锁与最佳成绩 | P4 |

---

## 10. 里程碑与验收标准

> 每阶段保持：`npm run check`（含循环依赖与层级越界校验）+ `npm run smoke`（断言数递增）+ 打包 EXE 冒烟 + 人工截图核验。

### P0 · 骨架重构（本阶段）
**交付**：`core/clock.js`、`domain/{phases,airspace,clearances,separation}.js`、`game/session.js`；
`simulation/units.js` 与 `simulation/conflict.js` 迁出（不保留兼容 shim）；motion 依赖倒置；
check-imports 增加**循环依赖**与**层级越界**校验；`ac.flow`/`ac.phase` 拆分并在读档时自动迁移。

**验收**
1. 既有 45 项冒烟断言全绿（含打包 EXE）。
2. 新增断言：阶段 FSM 初始化、阶段随流程推进、`canIssue` 阶段判定、间隔预测纯函数、会话输入录制、时钟步进。
3. `npm run check` 无循环依赖与层越界（越界即失败）。
4. 空间尺度不变：席位归属仍用 `pxToKmFixed`，缩放不改变判定（已有断言覆盖）。

### P1 · 可玩最小闭环
`data/scenarios/*.json` + `game/{scenario,director,objectives,scoring}.js` + `render/hud/*` + `ui/{strips,console}.js`；
结果页与事件时间轴复盘；游戏模式禁用时间轴回溯。
**验收**：能完整玩完 L1/L2 并给出评级；新增 ≈12 项断言（注入节奏、复诵、计分事件、评级、HUD 数值、复盘重放一致）。

> **状态：第一批（P1-A）与第二批（P1-B）已交付** —— `game/{scenario,director,objectives,scoring}.js` +
> `render/hud.js` + `ui/sessionPanel.js`（结算结果页）+ 班次内禁用时间轴回溯（附录 C）；
> `data/{scenarios,phraseology}.js` + `domain/readback.js` + `ui/console.js`（指令台 2.0：用语模板/灰显/复诵）+
> `core/random.js`（种子随机收口）（附录 D，`npm run smoke` 92 项断言全绿）。
> **剩余**：`ui/strips.js`（电子进程单 2.0）、复盘逐帧重放、成绩持久化。

### P2 · 高度剖面图
`render/profile/{approachProfile,altitudeHistory}.js` + 采样缓冲 + 联动 + 剖面告警。
**验收**：三视图截图核验；坐标映射纯函数单测；新增 ≈6 项断言。

### P3 · 真实化与程序
`domain/{procedures,vectoring,wind}.js`：SID/STAR/ILS/等待/向量引导/尾流间隔/MVA/风变跑道；
`data/airports/*.json` 程序数据；拟真难度启用用语强制与拦截。
**验收**：程序几何单测 + 断言 + 与真实机场程序的简化对照说明。

### P4 · 打磨与发布
教程关、讲评模式、特情脚本库、成绩持久化、性能压测（50+ 架）、`sandbox/` 编辑器迁入、v2.0.0 打包与 Release。
**验收**：打包 EXE 冒烟全绿；README/Release 更新并上传资产。

### P5 · 工作现场与值班（v2.1+，见 [`docs/WORKPLACE.md`](WORKPLACE.md) §10）
把"三张地图"扩展为**三个工作现场**（区域管制大厅 / 进近管制室 / 塔台）：
`data/workspaces.js`(1) + `domain/roster.js`(2) + `game/{avatar,workplace}.js`(3) + `render/scene.js`(3) +
`ui/rosterPanel.js`(5) + `interaction/avatarInput.js`(6)。

| 步骤 | 版本 | 内容 | 验收 |
|---|---|---|---|
| **W1** | v2.1 | 三个现场俯视图 + 走到席位就座（`seat:taken → setActiveViewKey`）+ 快速前往 + "跳过现场层"开关 | ≈10 项断言；三现场截图 + 就座后席位地图截图 |
| **W2** | v2.2 | 值班制度：疲劳 / 强制休息 / 交接班检查单 / 接班管制员 AI 代管（种子随机） | ≈14 项断言；"工作→疲劳→交接→休息→回岗"可玩 |
| **W3** | v2.3 | 领班巡视与检查项、通报（流控/天气/跑道/设备）、授权、突发情况（席位/现场/协同） | ≈16 项断言；特情关可玩完并给出讲评 |

> **前置**：W1 依赖 v1.7 席位地图**渲染接线**完成（档案与多视图几何已就位，切换入口待接）。
> **兼容**：现场层可整体关闭，关闭时行为与 v1.6 一致；短班模式永久保留。

### P6 · 规章对齐（v2.1+，见 [`docs/CCAR-93TM-ALIGNMENT.md`](CCAR-93TM-ALIGNMENT.md) §11）
把"看起来像空管"升级为"**规则有出处**"：席位门槛、岗位制度、责任移交、复诵必背、间隔分级、执勤疲劳、运行记录。
全部数值为**游戏化示意值**，集中在 `data/` 与 `core/constants.js`；所有机制**默认关闭或走旧路径**。

| 步骤 | 版本 | 内容 | 验收 |
|---|---|---|---|
| **R1** | v2.1 | 席位门槛（`domain/seats.js`）+ 岗位 FSM 与岗前准备 + 执勤疲劳参数（`data/roster.js`）+ 九项日志字段（`data/logFields.js`） | ≈26 项断言；门槛规则可推导席位、三段计时可分列 |
| **R2** | v2.2 | 移交三要素（`domain/handoff.js`）+ 复诵必背补齐与纠正链路 + 间隔分级与跑道状况（`data/atis.js`） | ≈34 项断言；`HANDOFF_PENDING` 期间责任不转移、`tieredSeparation=false` 回退旧值 |
| **R3** | v2.3 | 应急六要素与演练（`data/emergencyPlans.js`）+ 讲评"规章视角" + 访客/门禁 + 档案保存分级 | ≈18 项断言；缺段不可标记恢复、演练不计运行评分 |

> **与 P5 的关系**：P5（W1–W3）建"现场与人在哪"，P6（R1–R3）建"制度与规则怎么算"，
> 共享 `data/roster.js` 与 `data/workspaces.js`。建议实现顺序 **W1 → R1 → W2 → R2 → W3 → R3**。
> **合规红线**：§69 管制运行记录不得用于商业目的 → 本项目**不采集、不上传、不对外提供**。

---

## 11. 风险与对策

| 风险 | 对策 |
|---|---|
| “实时”与“确定性回放”冲突 | 双驱动：游戏内实时不可回溯；复盘靠**输入序列重放**（只记输入，不记状态） |
| 零构建、无类型，规模变大易失控 | 层级/循环校验 + JSDoc 类型 + `tools/test.mjs` 纯函数单测 + 每阶段冒烟断言 |
| 真实性与可玩性拉锯 | 三档难度预设；拟真档才强制用语与严格间隔 |
| 剖面图与雷达图数据口径不一致 | 两图共用领域层同一份采样与目标值；坐标映射写成纯函数并单测 |
| 多机 + 双画布 + 标签的性能 | 静态层缓存、离屏标签、视口裁剪、剖面节流 |
| 现有编辑器功能倒退 | 迁入 `sandbox/` 并保留入口，不删功能 |

---

## 12. 已确认的关键决策（路线 A）

| 项 | 取值 |
|---|---|
| 技术路线 | 保留**零构建 ES 模块 + Canvas 2D**，不引入 Vite/TS |
| 首个机场 | **ZUUU 成都双流**（02L/20R 为主训跑道） |
| 雷达样式 | **真实雷达屏风**（黑底/范围环/方位刻度），可切换现有白底 |
| 用语 | 中文为主，英文（MSFS 风）同义可识别 |
| 剖面图 | **进近剖面（默认）+ 高度-时间曲线**；等待航线图放 P3 |
| 编辑器 | 降级为 `sandbox/` 沙盒与关卡编辑模式（保留功能） |
| 工作现场层 | **默认坐席开局**；现场层（大厅/进近室/塔台俯视 + 小人 + 值班/交接/突发）为 **P5（v2.1+）** 可开关玩法层，关闭时与 v1.6 行为一致（见 `docs/WORKPLACE.md`） |
| 值班与疲劳 | 示意值 90 min 工作 / 15 min 休息；**短班模式永久保留**；疲劳只影响"玩家操作精度"，不改变世界 |
| 规章对齐 | 单独成文 [`docs/CCAR-93TM-ALIGNMENT.md`](CCAR-93TM-ALIGNMENT.md)（P6 · v2.1+）：逐条列出"规章要求 → 本项目机制 → 偏离程度 → 代码落点"；数值全部为游戏化示意值，**不得作为真实运行依据** |
| 分层间隔开关 | `tieredSeparation` **默认 false**：不改变 v1.6 的既有间隔手感；开启后进近 5.6 km / 区域 9.3 km（§406），未协调边界 2.8/4.7 km |
| 运行记录合规 | 依据 §69：日志只写本机存档，**不采集、不上传、不对外提供**；存档头声明"模拟练习数据，非真实管制运行记录" |

---

## 13. Endless ATC 兼容层（参考 startgrid《Endless ATC》）

**参考对象**：`github.com/EndlessATC`（官方组织的机场/关卡库）
- `Airports`（131★）：社区机场位置文件仓库，权威格式说明为根目录 `example.txt`；机场文件位于 `final/<洲>/<ICAO>/<ICAO>.txt`
- `Raw_Airports`：自动生成的「原始」文件（起步模板）；`Tools`：其配套 Python 工具
- 游戏本体：startgrid 的 Endless ATC（itch.io / Steam / Android），核心玩法 = **无限流量 + 分数门槛解锁跑道 + 最低高度区 + 场景事件脚本**

### 13.1 我们采用的格式能力（已实现）

| 段 | 字段 | 本项目去向 |
|---|---|---|
| `[airspace]` | radius / floor / ceiling / above / elevation / descentaltitude / separation | 空域半径（渲染+后续边界判定）、**可指令高度上下限**、隔离标准（`defaults.minSeparationNm`） |
| `[airspace]` | center / magneticvar / decimaldegrees / metric / usa / automatic / strictspawn | 坐标模式判定、单位显示 |
| `[airspace]` | beacons / boundary / line1..N / handoff / wake / speedrestriction / localizerspeed | 信标→**航路点**、空域边界、背景线、移交话音（P3）、唤醒间隔表（P3） |
| `[airportN]` | name / code / runways（含真航向、长度、标高、下滑角、航道、塔台频率） | **机场注册**（跑道对 `02L/20R` 形式写入 `data/airports.js` 运行期表）、焦点机场 |
| `[airportN]` | climbaltitude / sids / entrypoints / airlines（含机型池与方向偏好） | 离港上限、SID 点、**进场点（无限生成）**、航司概率表（P1 生成器） |
| `[areaN]` | shape(circle/polygon) / altitude / radius / position / points / labelpos / drawdegrees | **最低高度区 MVA**（渲染 + P1 违规判定） |
| `[configurations]` | score / 跑道 / start·land·rev·int·track / offsetheading / nosid | 跑道构型（按分数启用 → P1 计分解锁跑道） |
| `[departureN]` / `[approachN]` / `[transitionN]` | route 航路点（含最大高度/速度）、ILS 拦截点、end/hold | 程序航路数据（P3 程序飞行） |
| `[planetypes]` | 类别/速度/转弯率/下降率/进近速度/加速度/滚转角/爬升率 | 机型性能表（P3） |
| `[scenario]` | finish + events（arr/dep/score/elapse/wind/cloud/config/text） | **班次事件时间轴**（P1 director 直接消费） |
| `[background]` | line1..N（coast/airspace/runway 或 RGB） | 背景线渲染 |

### 13.2 实现分层（严格遵守 §3.1 依赖方向）

```
domain/locationFile.js   语法解析（纯函数，零依赖）：[节] / key = value / 缩进多行列表 / # 与 ; 注释 / 经纬度·海里坐标
        ↓
domain/locations.js      语义转换：坐标统一换算到世界坐标系（km，x 向东 y 向南）、ft→m、NM→km，
                         并 applyLocation() 写入运行期场景（注册机场、改写默认值、切换焦点机场）
        ↓
data/locationSamples.js  内置示例（**本项目自撰**的 ZUUU 位置文件，含格式注释）
        ↓
render/location.js       图层：最低高度区（MVA）、空域边界（多边形或半径圆）、背景线
        ↓
interaction/toolbar.js   入口：「📍 示例机场」「📂 导入机场(.txt)」；信标→航路点、视图对准、导入播报
```

**坐标约定**：文件坐标为「本场中心」的相对量；转换时按经纬度（有半球字母或 `decimaldegrees=true`）
或海里（+y 为北，本项目 -y 为北）两种模式统一投影，并在导入时一次性平移到本场在世界坐标中的位置，
因此渲染/生成/评分等其它层完全不需要感知文件格式。

### 13.3 真实文件兼容性验证（本地离线，不随仓库分发）

对官方与社区真实文件直接跑解析+转换（`tools/validate-location.mjs` 同源代码，见附录 B）：

| 文件 | 行数 / 节数 | 解析告警 | 跑道 | 信标 | 最低高度区 | 跑道构型 | 程序航段 | 航司行 |
|---|---|---|---|---|---|---|---|---|
| `final/AS/ZUUU/ZUUU.txt` | 5941 / 233 | **0** | 2（02L、02R） | 27 | 0 | 2（8 项） | 352 | 561 |
| `final/AS/ZBAA/ZBAA.txt` | 4240 / 189 | **0** | 3（36L、36R、01） | 23 | 3 | 2（18 项） | 244 | 1328 |
| `example.txt`（官方规范） | 427 / 11 | **0** | 1 | 3 | 2 | 2 | 5 | 7 |

> 版权：**不复制**上述社区文件到本仓库；本项目仅实现格式兼容，内置示例为自撰数据（示意值），
> 用户可自行导入社区文件（导入即用，不落盘到仓库）。

### 13.4 尚未消费（下一步接入计划）

| 数据 | 接入点 |
|---|---|
| `entrypoints` + `airlines`（概率/方向/机型池） | P1 `game/director.js`：按进场点与航司表**无限生成**进离港 |
| `[scenario].events` | P1 `game/director.js`：`elapse/arr/dep/score/wind/cloud/config/text` 逐条驱动 |
| `[configurations]` 分数门槛 | P1 `game/scoring.js`：分数升高解锁跑道、降低关闭跑道 |
| `[areaN]` 最低高度 | P1 违规判定（低于 MVA → 告警/扣分） |
| `[departureN]` / `[approachN]` | P3 `domain/procedures.js`：SID/STAR 程序飞行与 ILS 拦截 |
| `wake` 表 / `speedrestriction` / `localizerspeed` | P3 `domain/separation.js`、`domain/aircraft.js` 性能与限速 |



---

## 附录 A：P0 交付记录（骨架重构 · 已完成）

### A.1 新增模块

| 文件 | 内容 |
|---|---|
| `core/clock.js` | 固定步长时钟（1/60s + 倍率 + 时间上限回卷 + 累积器重置），时间推进的唯一入口 |
| `domain/phases.js` | 阶段枚举/中文标签、`flowOf`、`derivePhase`（状态推导）、`syncPhase`（含 `phase:changed`）、`canIssue` / `issueHint` |
| `domain/airspace.js` | 参考机场、距离、席位归属（含迟滞）、`unitSummary`、移交（`handoffAircraft` / `handoffToNextUnit`）、跑道指派与规范化 |
| `domain/clearances.js` | 许可对象与记录（`recordClearance` / `lastClearanceOf`）、起飞/进近/落地许可、跑道指派许可、复飞标记、`clearanceText` |
| `domain/separation.js` | 间隔标准、现行冲突判定（原 conflict.js 语义）、**冲突预测** `predictMinSeparation` / `predictedConflicts`（AMBER/RED 分级） |
| `domain/aircraft.js` | 尾流类别、`normalizeAircraft` / `normalizeScene`、**逐帧推进** `syncAircraftState`（席位→许可链→接地→阶段）、1Hz 状态采样 |
| `game/session.js` | 班次生命周期、**输入录制**（`recordInput` / `endSession` 汇总）、领域层装配（`initSessionWiring`） |

### A.2 迁移与删除

| 变更 | 说明 |
|---|---|
| `simulation/units.js` **已删除** | 席位/跑道 → `domain/airspace.js`；许可 → `domain/clearances.js`；逐帧推进 → `domain/aircraft.js` |
| `simulation/conflict.js` **已删除** | → `domain/separation.js`（原 API 语义保留：`isAircraftInConflictAt` / `getConflictPairs`） |
| **依赖倒置** | `simulation/motion.js` 不再 import 领域层：新增 `onAircraftStep(fn)` 钩子，由 `js/main.js` 注入 `syncAircraftState` |
| `ac.phase` 字段拆分 | 进/离港改为 `ac.flow`，`ac.phase` 专用于 FSM；旧存档读入时由 `normalizeScene()` 自动迁移 |
| 入口改造 | `js/main.js` 改用 `tickClock()`；`PLAYBACK_CHANGED` 与时间轴拖动后重置累积器（不补帧）；`window.__ATC__` 暴露领域/时钟/班次句柄供冒烟测试 |
| 采样入档策略 | `core/persistence.js` 落盘时剔除运行期字段 `history`（避免存档膨胀） |

### A.3 校验工具增强

`tools/check-imports.mjs` 在原有「路径可解析 + 具名导出存在」之上新增两项**强制**校验：

1. **循环依赖检测**（DFS 三色标记，打印回路）；
2. **层级越界检测**（`core 0 < simulation/weather/data 1 < domain 2 < game/render 3 < commands/generators 4 < ui 5 < interaction 6`，禁止 import 更高层；`js/main.js` 作为装配点豁免）。

### A.4 验证结果（P0 验收）

| 验收项 | 结果 |
|---|---|
| `npm run check` | **50 个模块 / 405 条具名导入 / 176 条跨层引用 / 循环依赖 0 处 / 层级越界 0 处** ✓ |
| `npm run smoke`（开发态） | **55 项断言全部通过**（原 45 项 + 新增 10 项：阶段 FSM 初始化、许可记录、阶段推进、指令合法性、提示文案、间隔预测、班次输入录制、状态采样、时钟步进、跑道指令生效） |
| `npm run smoke`（打包 EXE） | 见 §A.5 |
| 行为回归 | 席位/移交/许可/跑道/过滤/自动流程等既有 45 项断言全部保持通过 |

### A.5 打包验证

```bash
npm run build:win        # dist/ATC-Simulator-1.3.0.exe
dist\ATC-Simulator-1.3.0.exe --smoke   # 报告：%APPDATA%/atc-animate-simulator/smoke-report.json
```

### A.6 下一阶段（P1）待办

`data/scenarios/*.json` 关卡包 · `game/{scenario,director,objectives,scoring,events}.js` · `render/hud/*` ·
`ui/{strips,console}.js` · 结果页与事件时间轴复盘 · 游戏模式禁用时间轴回溯（沙盒保留）。

---

## 附录 B：Endless ATC 兼容层交付记录（已完成）

### B.1 新增模块

| 文件 | 内容 |
|---|---|
| `domain/locationFile.js` | 位置文件**语法解析器**（纯函数、零依赖）：节/条目/缩进多行列表/`#` 与 `;` 注释、经纬度（含度分秒与 decimaldegrees）与海里坐标、宽松数值与布尔 |
| `domain/locations.js` | **语义转换**：`[airspace]/[airportN]/[areaN]/[configurations]/[departureN]/[approachN]/[transitionN]/[planetypes]/[scenario]/[background]` → 场景模型；`locationToScene()`、`applyLocation()`、`importLocationText()`；ft→m、NM→km、坐标投影与平移 |
| `data/locationSamples.js` | 内置示例：**本项目自撰**的 ZUUU 位置文件（含中文格式注释），用于「示例机场」按钮与冒烟测试 |
| `render/location.js` | 图层：**最低高度区（MVA）**、空域边界（多边形/半径圆）、背景线（coast/airspace/runway 或 RGB） |
| `tools/check-location.mjs` | 离线校验器：`node tools/check-location.mjs <文件.txt>` → 解析摘要与告警（导入前自检） |

### B.2 改造点

| 项 | 说明 |
|---|---|
| 机场运行期注册 | `data/airports.js` 新增 `registerAirport()`：导入后跑道对（`02L/20R` 形式）、名称、频率立即对生成器/席位/渲染生效 |
| 可指令高度上下限 | `state.defaults.altMinM/altMaxM` 由文件 `floor/above` 改写，`commands/executor.js` 改用动态上下限 |
| 隔离标准 | 文件 `separation`（NM）→ `state.defaults.minSeparationNm`，直接驱动冲突判定与预测 |
| 场景状态 | `state.location` 保存换算后的场景（世界坐标），供渲染与后续 director/scoring 使用 |
| 交互入口 | 工具栏新增「📍 示例机场」「📂 导入机场(.txt)」；信标→航路点（`addPoint` 支持自定义名）、视图对准本场、导入摘要播报与解析告警上报 |
| 渲染顺序 | `render/index.js` 在网格后插入 `drawLocationBackground()`（背景线/边界）与 `drawRestrictedAreas()`（MVA） |

### B.3 验证结果

| 验证项 | 结果 |
|---|---|
| `npm run check` | **54 个模块 / 435 条具名导入 / 186 条跨层引用 / 循环依赖 0 / 层级越界 0** ✓ |
| `npm run smoke`（开发态） | **61 项断言全部通过**（新增 6 项：位置文件解析、导入计数、NM→km 与 ft→m 换算、隔离与高度上下限生效、跑道对登记、示例机场按钮端到端） |
| 真实社区文件离线校验 | `ZUUU.txt` 5941 行/233 节 **0 告警**；`ZBAA.txt` 4240 行/189 节 **0 告警**；官方 `example.txt` 427 行/11 节 **0 告警**（详见 §13.3） |
| 渲染核验 | 截图确认：MVA 圆（2000ft/3500ft 标注）、空域边界多边形、信标点（CTU/PDU/ZUUU/SAS）与工具栏两个新入口均正常 |
| 冒烟发现的缺陷 | `domain/locations.js` 调用 `parseLocationFile` 未 import（`check-imports` 无法发现未声明标识符）→ 由冒烟端到端捕获并修复，随后 61/61 通过 |

### B.4 下一步（P1 起）

`game/director.js` 消费 `[scenario].events` 与 `entrypoints`/`airlines` 实现**无限流量**；
`game/scoring.js` 按 `[configurations]` 分数门槛**解锁/关闭跑道**；`[areaN]` 接入 MVA 违规判定。

---

## 附录 C：P1-A 交付记录（无限流量 · 评分 · HUD · 结算，已完成）

> 对应 PLAN §P1 的第一批交付：把 v1.4.0 已解析但未消费的位置文件数据接进玩法闭环。

### C.1 新增模块

| 文件 | 层 | 内容 |
|---|---|---|
| `game/scenario.js` | 3 | 场景包 v3 模型（`atc_scenario_v3`）、`buildTimeline()`（**首列为距上一事件的经过秒数**，`elapse` 只推进时间轴）、`scenarioFromLocation()`（由位置文件派生关卡）、mulberry32 种子随机 `makeRng()` + `pickWeighted()` |
| `game/director.js` | 3 | 流量导演：消费 `[scenario]` 事件（`config`/`score`/`wind`/`text`/`arr`/`dep`）、按 `entrypoints`+`airlines` **无限注入**进离港（机型别名表、呼号概率表、进港高度阶梯）、`directorGoal()`（`finish` 落地架数/时限）、`directorSummary()` |
| `game/scoring.js` | 3 | 两条分数轴：`performance`（绩效分 0–100 → S/A/B/C/D）与 `progress`（解锁分，落地 +1、`score` 事件可设定）；`[configurations]` 分数门槛 → `runwayPlan()` 解锁/关闭跑道；间隔不足（现行判定）/MVA 违规/复飞/延误/连击记分（配对 45s、单机 60s 冷却） |
| `game/objectives.js` | 3 | 目标定义与评估（纯函数）：零间隔不足 / 零 MVA 违规 / 落地架数 / 平均延误上限 / 复飞上限 / 解锁更多跑道 |
| `render/hud.js` | 3 | 屏幕空间 HUD（班次名·时钟·绩效分与评级·落地/解锁分·告警·风与跑道·`[scenario]` 字幕·最近告警）+ `hudModel()` 读值模型 |
| `ui/sessionPanel.js` | 5 | 「开始班次/结束并结算」按钮、难度选择、实时读数、结算结果（评级·目标达成·评分事件时间轴） |

### C.2 改造点

| 项 | 说明 |
|---|---|
| `domain/airspace.js` | 新增最低高度区判定 `areaCovers` / `mvaLimitAt`（**多区重叠取更高者**）/ `mvaViolationFor`，与 `render/location.js` 的 MVA 图层共用同一口径 |
| `game/session.js` | `startGameSession()`（清空沙盒流量与导演航路 → 装载关卡 → 启动导演与记分 → 开始播放）、`endGameSession()`（结算：评级/目标/时间轴）、`tickSession()`（每时钟步进：导演 → 记分 → 完成条件） |
| `core/eventBus.js` | 新增 `session:started` / `session:ended` / `score:changed` / `director:event` 四个事件 |
| 游戏模式不可回溯 | 班次进行中拖动时间轴被拦截（`interaction/toolbar.js`），复盘改用评分事件时间轴与场景事件序列 |
| MVA 记分口径 | 仅对**进港且尚未发进近许可**的航空器计违规（已按程序进近的飞机由进近程序提供超障保护），避免落地过程误判 |
| 指令执行器缺陷修复 | `下降 <绝对高度>` 此前绕过可指令高度下限（`floor`），现与高度指令一致受 `altFloorM()/altCeilingM()` 约束（进近/落地许可目标不受限） |
| `data/locationSamples.js` | `[configurations]` 改为分数门槛示例：`rwy2` 需解锁分 ≥ 6（落地积累），演示「分数升高解锁跑道」 |
| 自动流量高度阶梯 | 导演注入的进港航班按 600m 步进取目标高度（垂直间隔标准两倍），避免全部压在同一高度 |

### C.3 验收结果

| 验证项 | 结果 |
|---|---|
| `npm run check` | **60 个模块 / 540 条具名导入 / 226 条跨层引用 / 循环依赖 0 / 层级越界 0** ✓ |
| `npm run smoke`（开发态） | **77 项断言全部通过**（v1.4.0 的 61 项 + 新增 16 项：关卡装载、导演消费 entrypoints/airlines、时间轴锁定、分数门槛解锁跑道、MVA 判定与记分、无限流量注入、`[scenario]` 事件执行、跑道取自构型、HUD 读值、结算评级/目标/时间轴、结果面板） |

### C.4 仍未消费（下一步）

| 数据 | 接入点 |
|---|---|
| `[departureN]` / `[approachN]` / `[transitionN]` | P3 `domain/procedures.js`：SID/STAR 程序飞行与 ILS 拦截（当前导演航路为「进场点→本场」直线） |
| `wake` / `speedrestriction` / `localizerspeed` | P3 `domain/separation.js`：尾流间隔加码与限速 |
| `[planetypes]` | P3：机型性能表（当前用 `data/aircraft.js` 类别性能 + 机型别名映射） |
| `cloud` 事件 | P3 天气接入（当前仅记录到导演事件时间轴） |
| 排序/间隔自动化 | P3：等待航线与进近排序（当前同场多机同时进近需管制员自行引导，60× 快进下间隔扣分明显） |

---

## 附录 D：P1-B 交付记录（关卡包 · 指令台 2.0 · 复诵，已完成）

### D.1 新增模块

| 文件 | 层 | 内容 |
|---|---|---|
| `core/random.js` | 0 | 种子伪随机统一收口（mulberry32 `makeRng` / `pickWeighted` / `pickOne` / `DEFAULT_SEED`）——原 `game/scenario.js` 内部实现上迁，供流量注入与复诵抽取共用 |
| `data/scenarios.js` | 1 | 内置关卡包 **L1 进近入门（单跑道 02L）· L2 离港洪峰（双跑道 + 分数门槛解锁 02R）· L3 逆风换向（rev 反向跑道 20R/20L + 拟真）**；关卡自足（进场点只给方位+信标名，坐标由导演推算），`timeline` 直接给绝对时刻；`scenarioList()` / `getBuiltinScenario()` |
| `data/phraseology.js` | 1 | 用语模板表（19 条，按 许可/高度/引导/速度/移交 分组）+ `phrasesForUnit()`（按席位过滤）+ `fillPhrase()`（{cs}/{rwy}/{fix} 占位符） |
| `domain/readback.js` | 2 | 机组复诵：动作→中文措辞（`下降到 3000`）、按难度概率抽取**漏项错诵**、`ac.readback` 状态（`pending`/`resolved`/`penalized`）、`noteCorrectReadback`/`makeReadback`/`resolveReadback`；随机源用关卡 seed → 可复现 |
| `ui/console.js` | 5 | 指令台 2.0：选中机摘要、按席位/阶段渲染的模板按钮、**非法项灰显 + `issueHint()` 原因**、一键下发、复诵回显与「重新下发（要求复诵）」 |

### D.2 改造点

| 项 | 说明 |
|---|---|
| `game/scenario.js` | 移除内部 PRNG（改用 `core/random.js`）；难度预设增加 `readbackErrorRate`（街机 0 / 标准 0.08 / 拟真 0.2） |
| `game/session.js` | `startGameSession({ scenarioId })` 支持装载内置关卡；按关卡难度写入复诵错诵率并用关卡 seed `seedReadback()`；关卡简述播报 |
| `game/scoring.js` | 新增 `READBACK_MISSED: -3` 与宽限期（`READBACK_GRACE_SEC` 30s）复核；跑道构型优先取**关卡数据**（`setScoringScenario`），位置文件缺失时也能按关卡跑双跑道/反向跑道；`resetScoring` 不再把上一班构型误记为「本班跑道变更」 |
| `game/objectives.js` | 新增 `NO_READBACK_MISSED` 目标（L2/L3 使用，L2 共 6 项目标） |
| `commands/executor.js` | 定向指令在施加后生成机组复诵（最多 3 架，避免广播刷屏）；记录 `ac.lastCommandText` 供「要求复诵」原样重发 |
| `domain/clearances.js` | 起飞/进近/落地许可播报复诵的同时写入 `ac.readback`（正确），使复诵状态在自动/手动两条路径上一致 |
| `ui/commPanel.js` | 抽出 `submitAtcText()`：输入框与指令台按钮**同一条提交路径**（录制 → 播报 → 执行 → 刷新） |
| `ui/sessionPanel.js` | 关卡下拉（内置 3 关 + 自动）、选中关卡时难度随关卡（灰显）并显示任务简述；结算面板增加未复诵计数 |
| `render/hud.js` | 告警计数纳入未复诵；时钟格式化复用 `core/dom.js` 的 `formatHMS`（去掉重复实现） |

### D.3 验收结果

| 验证项 | 结果 |
|---|---|
| `npm run check` | **65 个模块 / 586 条具名导入 / 252 条跨层引用 / 循环依赖 0 / 层级越界 0** ✓ |
| `npm run smoke`（开发态） | **92 项断言全部通过**（v1.5.0 的 80 项 + 新增 12 项：关卡清单/难度随关卡/L2 装载/分数门槛/指令台模板与灰显/一键下发/复诵不符与纠正/未纠正扣分/事件驱动解锁跑道/结算复诵目标） |
| 实测（打包版报告） | 指令台 18 个模板按钮 / 5 组；对「等待放行」离港航班 `可以落地` 灰显且提示「尚未进入进近阶段（当前：等待放行）」；强制漏项复诵 → `missing = 高度 1200`、面板高亮、要求复诵可见；重新下发后未扣分；未纠正 30s 后记 1 次未复诵并使 `NO_READBACK_MISSED` 目标失败；L2 在 t=600 的 `score 5` 事件后跑道由 02L 扩为 02L/02R |

### D.4 P1 剩余

`ui/strips.js`（电子进程单 2.0：分栏/排序/延误列）、复盘**逐帧重放**（当前为事件时间轴）、
`data/scenarios` 的关卡解锁与最佳成绩持久化（`atc_progress_v3`，P4）。








