# 航班全流程与管制岗位服务规范（Flight Lifecycle & Position Services）

> 状态：**规范（起草于 v1.7 开发期）** · 适用版本：v1.8+
> 定位：本文与 [`docs/PLAN-v2.md`](PLAN-v2.md) 配套 —— PLAN 定**架构分层与玩法系统**，本文定**业务过程与岗位服务**；
> 另有 [`docs/WORKPLACE.md`](WORKPLACE.md) 定**工作现场（大厅/进近室/塔台俯视）、角色与值班制度**（人在哪、谁接班、现场突发）。
> 规章依据层见 [`docs/CCAR-93TM-ALIGNMENT.md`](CCAR-93TM-ALIGNMENT.md) —— 本文"许可—复诵—执行"环节的必背复诵清单（§118）见该文 §6。
> 凡涉及"某阶段由哪个岗位提供什么服务、下什么指令、复诵什么、何时移交"的争议，以本文为准；
> 凡涉及"模块怎么分层、事件怎么走"的争议，以 PLAN 为准。
>
> **免责声明**：文中频率、滑行道、机位、高度层、间隔数值均为**示意数据**，仅用于模拟演示，
> **不得作为真实运行依据**。各机场/管制单位的职责划分存在差异（例如机坪是否由管制负责、
> 放行是否与地面合并、是否设离场席），本项目取**典型简化**，差异项集中在数据层以便调整。

---

## 1. 目标与适用范围

**目标**：让模拟器能完整呈现一架航班从「申请放行」到「到达机位」的全过程，并明确每一段由哪个岗位
提供什么服务、下发什么指令、机组复诵什么、满足什么条件才移交 —— 使"值守一个席位"这件事在时间轴上有据可依。

**范围**：
- 覆盖 6 个岗位（放行 / 机坪 / 地面 / 塔台 / 进近 / 区调）与 2 条链（离港、进港）
- 覆盖阶段 FSM 的**目标态**（含地面段）、指令与复诵清单、地图视图需求、评分事件、现状差距与实施步骤
- 不覆盖：真实滑行道几何精度、真实高度层配备规则、真实尾流间隔表、特情处置细则（见 §11 Step C）

**两条链的端点**：
```
离港：停机位（申请放行） → 推出开车 → 滑行 → 等待点 → 进跑道 → 起飞 → 初始上升 → 爬升 → 巡航 → 跨区移交
进港：进入区域 → 下降 → 终端排序 → 进近许可 → 五边 → 落地 → 脱离 → 滑入 → 到达机位
```

---

## 2. 岗位定义（6 个）

| 岗位 | 代码 | 频率（示意） | 工作模式 | 核心职责 | 关心的信息 | 本项目现状 |
|---|---|---|---|---|---|---|
| **放行许可** Clearance Delivery | `CD` | 121.60 | 话音/文本，**无地图** | 发放 IFR 放行许可（CRAFT） | 飞行计划、离场程序、起始高度、应答机 | 待建 |
| **机坪管制** Apron | `APC` | 121.90 | 话音，机坪图 | 批准推出开车、机坪内滑行 | 机位、推出方向、机坪路线 | 待建 |
| **地面管制** Ground | `GND` | 121.85 | 话音，地面图 | 滑行许可、等待点、穿越跑道 | 滑行道网络、跑道占用、地面冲突 | 待建 |
| **塔台管制** Tower | `TWR` | 118.85 | 话音 + 目视，机场图 | 进跑道、起飞、落地、复飞、脱离 | 跑道、五边、风、尾流、跑道占用 | 已有（scope 15 km） |
| **进近管制** Approach | `APP` | 120.35 | 雷达，终端图 | 排序、雷达引导、进近许可、调速下高 | 程序、最低高度区(MVA)、间隔、跑道 | 已有（scope 60 km） |
| **区域管制** Center | `ACC` | 128.70 | 雷达，区域图 | 高度层配备、航路、跨区移交 | 高度层表、航路点、移交点 | 已有（scope 全域） |

- 频率取值与本项目 `data/airports.js` 的 ZUUU 示意频率一致（twr 118.85 / app 120.35），其余为示意值。
- 岗位顺序（由内到外）：`CD → APC → GND → TWR → APP → ACC`；
  其中 `APC` 与 `CD` 在中小机场常与 `GND` 合并（本项目允许按机场数据合并，见 §12）。
- **工作模式差异决定了地图差异**（这是"三个席位不是一张图"的根本原因）：
  `CD` 是**文本/进程单**工作（无地图）；`APC/GND` 是**平面图**工作（看滑行路线）；
  `TWR` 是**目视+话音**工作（看跑道与五边）；`APP` 是**雷达+程序**工作（看终端区与排序）；
  `ACC` 是**雷达+高度层**工作（看航路与移交）。

---

## 3. 离港全流程（9 段）

> 阶段列使用本项目 `domain/phases.js` 的 `PHASE` 枚举（§6 给出目标态映射）。

| # | 阶段 | 发起方 | 负责岗位 | 提供的服务 | 典型用语（中 / 英） | 复诵关键项 | 移交/推进条件 |
|---|---|---|---|---|---|---|---|
| 1 | `PARKED` | 机组 | **CD** | 受理 IFR 放行申请、核对飞行计划 | 「成都放行，CCA1234，停机位 118，请求放行」/ *Chengdu Delivery, request clearance* | — | 计划核对无误 |
| 2 | `PARKED` | CD | **CD** | 发放 **CRAFT** 放行许可：许可界限 · 离场程序(SID) · 起始高度 · 频率 · 应答机 | 「CCA1234，许可界限成都，离场 SASAN1A，起始高度 3000 米，应答机 3124，起飞后联系进近 120.35」 | **离场程序 / 起始高度 / 应答机** | 复诵正确 |
| 3 | `PARKED→TAXI`（推出） | 机组 | **APC**（大机场）/ **GND** | 批准推出开车、给出推出方向 | 「可以推出开车，机头朝北」/ *pushback and start approved* | 推出方向 | 推出完成（示意 60 s） |
| 4 | `TAXI` | 机组 | **GND** | 滑行许可：路线、**等待点**、**穿越跑道许可** | 「沿 A、B 滑行至 02L 等待点」/ *taxi to holding point RWY 02L via A, B* | 路线 / 等待点 | 到达等待点 |
| 5 | `HOLD_SHORT` | 机组 | **TWR** | **进跑道等待**（或直接起飞许可） | 「进跑道等待」/ *line up and wait RWY 02L* | 跑道号 | 已进跑道 |
| 6 | `TAKEOFF_ROLL` | TWR | **TWR** | 起飞许可（跑道 + 风 + 离场后指令）、监视起飞 | 「跑道 02L，可以起飞，风 020/8」/ *cleared for takeoff* | **跑道号** | 离地 |
| 7 | `INIT_CLIMB` | TWR | **TWR → APP** | 移交进近/离场席；进近/离场席：雷达引导或保持 SID、上升到巡航高度 | 「联系进近 120.35」 | 频率 | 约 3–5 NM 或 1500 ft AGL（示意） |
| 8 | `CLIMB / CRUISE` | APP | **ACC** | 高度层配备（RVSM）、航路、等待、绕飞 | 「上升到 10100 米保持」/ *climb FL331* | 高度 / 高度层 | 到达移交点/高度 |
| 9 | `CRUISE` | ACC | **ACC** | 跨区移交：移交点 + 移交高度 + 移交条件 | 「移交成都区调 128.7」 | — | 下一管制区接收 |

**要点**：
- 第 2 段的复诵（程序/起始高度/应答机）是**错诵高发段**，应计入「未纠正复诵」评分（本项目 v1.6 已有机制）。
- 第 3–5 段是**地面段**：不需要"飞行机动"，需要的是**地面运动与占用**（滑行路线、等待点、跑道占用）。
- 第 6 段的"风"与尾流间隔是塔台的专属信息（`windAt()` 已有数据源）。

---

## 4. 进港全流程（6 段）

| # | 阶段 | 负责岗位 | 提供的服务 | 典型用语 | 复诵关键项 | 移交/推进条件 |
|---|---|---|---|---|---|---|
| 1 | `DESCENT / CRUISE` | **ACC** | 下降许可、高度层、**进场程序 STAR** | 「下降至 6000 米，进场 SASAN1A」 | 高度 | 进入终端区（60 km 前 5–10 min / 移交点） |
| 2 | `STAR / HOLD / VECTOR` | **APP** | **排序**：等待航线、速度控制、雷达引导 | 「减速 220，左转航向 300」 | 速度 / 航向 | 建立五边 |
| 3 | `STAR / VECTOR / FINAL_APPROACH` | **APP** | **进近许可**（ILS/RNAV/VOR/目视）+ 跑道指派 + 下高度调速 | 「可以 ILS 进近，跑道 02L」 | **进近方式 / 跑道** | 五边 5–10 NM 或 ILS 外指点标 |
| 4 | `FINAL_APPROACH` | **TWR** | 落地许可（跑道 + 风）、复飞监控 | 「跑道 02L，可以落地，风 020/8」 | **跑道号** | 接地 |
| 5 | `LANDING_ROLL → VACATE` | **TWR** | 脱离跑道指令（指定脱离道口）、跑道清空确认 | 「从 A3 脱离」/ *vacate via A3* | 脱离道口 | 脱离跑道 |
| 6 | `TAXI_IN → ARRIVED` | **GND / APC** | 滑行到机位（路线 + 机位号）、引导入位 | 「沿 B、C 滑行至 118 机位」 | 机位号 | 到达机位（航班结束） |

**要点**：
- 进港的"排序"是进近席的核心工作（本项目 P3 才引入等待航线/排序自动化，当前需管制员自行引导）。
- 第 4–5 段的**跑道占用**是塔台的专属职责：落地滑跑期间跑道不可被他人使用（本项目需引入占用锁）。
- 第 6 段的滑入不需要飞行机动，但需要地面路径与机位数据。

---

## 5. 岗位 × 服务矩阵与移交条件

### 5.1 服务矩阵（谁在什么模式下做什么）

| 岗位 | 工作模式 | 输入（机组/上游） | 输出（服务） | 本地图应显示 |
|---|---|---|---|---|
| `CD` | 文本/话音（无地图） | 放行申请、飞行计划 | 放行许可（CRAFT） | 进程单（待放行航班）+ 放行许可核对表 |
| `APC` | 话音 + 机坪图 | 推车请求 | 推出开车许可 | 机位、推出方向、机坪路线 |
| `GND` | 话音 + 地面图 | 滑行请求 | 滑行许可（路线/等待点/穿越） | 跑道口、滑行道、等待点、机位、跑道占用状态 |
| `TWR` | 话音 + 目视 | 到达等待点 / 五边 | 进跑道、起飞、落地、复飞、脱离 | 跑道、ILS 延长线、五边、风、塔台区 |
| `APP` | 雷达 + 程序 | 进入终端区 | 排序、引导、进近许可、调速下高 | 终端区、程序、MVA、管制区边界、间隔 |
| `ACC` | 雷达 + 高度层 | 进入区域 | 高度层配备、航路、跨区移交 | 航路点/航线、空域边界、移交点、**高度层** |

### 5.2 移交条件（本项目用「距离 + 迟滞」实现，见 `domain/airspace.js`）

| 移交 | 真实典型条件（示意） | 本项目实现 |
|---|---|---|
| `TWR → APP` | 离地后约 3–5 NM 或 1500 ft AGL | 距参考机场 > 15 km（塔台 scope） |
| `APP → ACC` | 离开终端区或爬升到过渡高度以上 | 距参考机场 > 60 km（进近 scope） |
| `ACC → APP` | 进入终端区前 5–10 min / 指定移交点 | 距参考机场 ≤ 60 km |
| `APP → TWR` | 五边 5–10 NM 或 ILS 外指点标 | 距参考机场 ≤ 15 km |
| `TWR → GND` | 脱离跑道后 | 新增：`onGround && vacated` |
| `GND → APC` | 进入机坪 | 新增：进入机坪区域节点 |

> 本项目已有**迟滞系数**（`UNIT_SCOPE_HYSTERESIS = 1.25`）避免边界反复移交；
> 席位归属判定使用 `pxToKmFixed`，**与地图缩放无关**（缩放不改变归属）。


---

## 6. 阶段 FSM 目标态（与 `domain/phases.js` 对齐）

```
离港地面：PARKED ──放行许可──▶ TAXI ──到达等待点──▶ HOLD_SHORT ──进跑道──▶ TAKEOFF_ROLL
离港空中：TAKEOFF_ROLL ──离地──▶ INIT_CLIMB ──▶ CLIMB ──▶ CRUISE
进港空中：CRUISE ──▶ DESCENT ──▶ STAR ──等待──▶ HOLD ──引导──▶ VECTOR ──进近许可──▶ FINAL_APPROACH
进港地面：FINAL_APPROACH ──接地──▶ LANDING_ROLL ──脱离──▶ VACATE ──滑行──▶ TAXI_IN ──▶ ARRIVED
异常：任何空中阶段 ──▶ GO_AROUND ──▶ VECTOR / STAR
```

**设计约束（继承 PLAN §4.2）**：阶段一律**由状态推导**（`derivePhase`），不引入隐藏状态，
因此时间轴重放/复盘必然一致。为支持地面段，航空器需补充以下**可推导的状态字段**（建议）：

| 字段 | 含义 | 谁写入 |
|---|---|---|
| `ac.onGround` | 是否在地面 | 生成器/接地判定/起飞判定 |
| `ac.release` | 放行许可对象 `{ limit, sid, initAlt, squawk, freq, issuedAt, readback }` | `domain/clearances.js` |
| `ac.pushbackDir` | 推出方向（机头朝向） | 放行/机坪指令 |
| `ac.taxiRoute` | 滑行路线（节点 id 序列） | 地面指令 + `domain/ground.js` |
| `ac.taxiTarget` | 滑行目标：`holding:<rwy>` / `gate:<id>` / `apron` | 地面/机坪指令 |
| `ac.atHoldingPoint` | 是否已停在等待点 | 地面运动推进 |
| `ac.vacated` | 是否已脱离跑道 | 塔台脱离指令 + 运动推进 |
| `ac.gate` | 机位号 | 进港生成/地面指令 |
| `ac.runwayLocked` | 该机是否持有跑道占用 | `domain/ground.js` 跑道锁 |

**当前实现缺口**（详见 §10）：`PARKED / TAXI / VACATE / TAXI_IN / TAKEOFF_ROLL / HOLD`
在 `derivePhase` 中**从未被产生**，属"声明了但不可达"的死枚举。

---

## 7. 指令与复诵清单（对应 `commands/parser.js`、`domain/readback.js`）

| 指令 | 关键词（中 / 英） | 参数 | 允许阶段（`canIssue`） | 复诵关键项 | 现状 |
|---|---|---|---|---|---|
| **放行许可** | 放行 / 许可 / clearance | 界限·程序·起始高度·应答机·频率 | `PARKED` | 程序 / 起始高度 / **应答机** | 待建 |
| **推车开车** | 推出 / 推车 / 开车 / pushback / start | 推出方向 | `PARKED` | 方向 | 待建 |
| **滑行** | 滑行 / taxi | 路线、等待点、机位 | `TAXI`、`VACATE` | 路线 / 等待点 / 机位 | 待建 |
| **进跑道等待** | 进跑道 / lineup / line up | 跑道 | `HOLD_SHORT` | 跑道号 | 关键词存在但**语义错误**（当前被当作"保持航向"） |
| **起飞许可** | 可以起飞 / cleared for takeoff | 跑道、风 | `HOLD_SHORT`、`TAKEOFF_ROLL` | 跑道号 | 已有 |
| **落地许可** | 可以落地 / cleared to land | 跑道、风 | `FINAL_APPROACH`、`STAR/HOLD/VECTOR` | 跑道号 | 已有 |
| **脱离跑道** | 脱离 / vacate | 脱离道口 | `LANDING_ROLL`、`VACATE` | 道口 | 待建 |
| **滑入机位** | 滑到 / 机位 / taxi to gate | 机位号、路线 | `VACATE`、`TAXI_IN` | 机位号 | 待建 |
| **穿越跑道** | 穿越 / cross | 跑道 | `TAXI`、`TAXI_IN` | 跑道号 | 待建（含跑道侵入评分） |
| 进近许可 | ILS/RNAV/VOR/目视 + 跑道 | 方式、跑道 | `DESCENT/STAR/HOLD/VECTOR/FINAL` | 方式 / 跑道 | 已有 |
| 高度 / 速度 / 航向 | 上升下降 / 加速减速 / 航向转向 | 数值 | 空中阶段 | 数值 | 已有 |
| 直飞 / 盘旋 / 复飞 | 直飞 / 盘旋 / 复飞 | 航路点 | 空中阶段 | 航路点 | 已有 |
| 席位移交 | 移交塔台 / 联系进近 / contact tower | 席位 | 空中阶段 | 频率 | 已有（需扩展为 5 段链） |

**复诵规则（沿用 v1.6 机制）**：上表"复诵关键项"进 `domain/readback.js` 的 `CRITICAL` 列表；
按难度概率抽取漏项错诵（街机 0 / 标准 8% / 拟真 20%），宽限期 30 s 未纠正 → 每次 −3 分。

---

## 8. 地图/视图需求（对应 `data/viewProfiles.js`）

| 视图 | 可见半径 | 必画图层 | **不画** | 高度显示 | 在管范围 | 现状 |
|---|---|---|---|---|---|---|
| `ACC` 区域 | 220 km | 航路点/航线、空域边界、移交点、网格 50 km、距离环 50/100/200 | 跑道细节、ILS、MVA | **高度层 FL** | 全域 | 档案已就位，渲染待接 |
| `APP` 进近 | 65 km | 进近程序、ILS 航道、管制区圈、**MVA**、背景线、网格 10 km、距离环 10/30/60 | 远端航路点（仅视野内） | 米 | ≤ 60 km | 档案已就位，渲染待接 |
| `TWR` 塔台 | 15 km | 跑道/ILS、塔台圈、网格 2 km、距离环 5/10/15、地面航班 | MVA、空域边界、航路点、航线 | 米 | ≤ 15 km | 档案已就位，渲染待接 |
| `GND` 地面（新） | 3–5 km | 跑道口、滑行道、等待点、机位、**跑道占用状态** | 空域、MVA、航路 | 米 | 地面航班 | 待建 |
| `APC` 机坪（新） | 1–2 km | 机位、推出方向、机坪路线 | 其余 | — | 机坪航班 | 待建（可与 GND 合并） |
| `CD` 放行（无地图） | — | **进程单 + 放行许可核对表** | 地图 | — | 待放行航班 | 待建 |

**为什么必须是不同的地图**：三者的**信息密度与关注对象完全不同** ——
`ACC` 在 220 km 尺度上看"航路与高度层"，跑道的 3 km 细节毫无意义；
`TWR` 在 15 km 尺度上看"跑道与五边"，220 km 的航路网只会变成一团线。
因此每张地图需要**独立的视口（比例尺区间 + 平移记忆）与独立的图层集**，
这已由 `data/viewProfiles.js`（档案）+ `core/viewport.js`（按视图键名索引的几何量）实现。


---

## 9. 评分与目标（对应 `game/scoring.js`、`game/objectives.js`）

**新增评分事件**（权重为示意，最终以 PLAN §7.2 的量级为准）：

| 事件 | 触发条件（示意） | 权重 | 说明 |
|---|---|---|---|
| `RELEASE_DELAY` | 放行申请 → 发放许可 > 90 s | −2 | 放行席效率 |
| `TAXI_TIMEOUT` | 滑行段耗时 > 300 s（无冲突情况下） | −2 | 地面席效率 |
| `RUNWAY_OCCUPY_TIMEOUT` | 跑道占用 > 60 s 未清空 | −5 | 塔台跑道管理 |
| `HOLD_SHORT_VIOLATION` | 未按等待点停车即进跑道 | −3 | 地面/塔台协同 |
| `RUNWAY_INCURSION` | 未获穿越许可穿越跑道 | −10 | 严重不安全事件 |
| `VACATE_WRONG_EXIT` | 未按指定道口脱离 | −2 | 塔台指令执行 |
| `READBACK_MISSED` | 已有（v1.6） | −3 | 放行许可的应答机/高度是错诵高发项 |

**新增目标**（`OBJECTIVE_KINDS`）：

| 目标 | 判定 | 适用关卡 |
|---|---|---|
| `NO_RUNWAY_INCURSION` | 跑道侵入次数 = 0 | 全部含地面段的关卡 |
| `RELEASE_DELAY_MAX` | 平均放行延误 ≤ 阈值 | L1（放行入门） |
| `TAXI_TIME_MAX` | 平均滑行时长 ≤ 阈值 | L2（离场洪峰） |
| `NO_READBACK_MISSED` | 已有（v1.6） | L2/L3 |

---

## 10. 现状差距清单（精确到文件/函数）

**已具备**

| 能力 | 位置 |
|---|---|
| 三级席位 + 距离归属（含迟滞）+ 自动/手动移交 | `domain/airspace.js`（`resolveUnitForDistance` / `handoffAircraft`） |
| 许可与复诵：起飞 / 进近 / 落地 / 跑道指派 / 复飞 | `domain/clearances.js`、`domain/readback.js` |
| 阶段 FSM 枚举（**含地面段**）与指令合法性 | `domain/phases.js`（`PHASE` / `canIssue` / `issueHint`） |
| 席位地图档案 + 按视图索引的视口几何（v1.7 底层） | `data/viewProfiles.js`、`core/viewport.js` |
| 无限流量导演、评分、复诵、关卡包 | `game/*`、`ui/console.js` |

**缺口（按"服务链"顺序）**

| # | 缺口 | 证据（文件:行） | 影响 |
|---|---|---|---|
| 1 | 地面段阶段**不可达**：`PARKED/TAXI/VACATE/TAXI_IN/TAKEOFF_ROLL/HOLD` 从未被推导 | `domain/phases.js:96-118`（`derivePhase` 只产生 HOLD_SHORT/INIT_CLIMB/CLIMB/CRUISE/DESCENT/STAR/VECTOR/FINAL_APPROACH/LANDING_ROLL/ARRIVED/GO_AROUND） | 地面段在界面与评分上不存在 |
| 2 | 离港缺 **放行申请 → 推车开车 → 滑行 → 进跑道** 四段 | `game/director.js`（`spawnDeparture` 直接生成在机场）、`core/constants.js`（`AUTO_TAKEOFF_DELAY` 45 s 自动放行） | 放行/机坪/地面三个岗位无工作内容 |
| 3 | 进港缺 **脱离 → 滑入 → 到机位** 三段：接地即消失 | `domain/aircraft.js:86-89`（`ac.landed = true; ac._visible = false`） | 塔台脱离与地面滑入无工作内容 |
| 4 | 指令层缺 放行许可 / 推车开车 / 滑行 / 脱离 / 滑入 / 穿越 | `commands/parser.js`（无对应关键词） | 上述服务无法下达 |
| 5 | 「进跑道」**语义错误**：被解析为 `hold`（保持航向） | `commands/parser.js:105-106` | 塔台"进跑道等待"实际是让飞机保持航向 |
| 6 | 无地面运动模型：无 `onGround`、滑行速度、滑行道网络、**跑道占用互斥** | 全库无相关字段 | 无法表达"滑行中/等待点/跑道占用" |
| 7 | 缺 3 个岗位：`CD` / `APC` / `GND` | `data/atcUnits.js`（仅 TWR/APP/ACC） | 服务链只有中间三段 |
| 8 | 地图仅一档比例尺，未按席位分层 | `render/*`（图层未按档案开关） | ACC 视图会画跑道细节，TWR 视图会画 220 km 航路网 |

---

## 11. 实施步骤与验收（每步独立可交付）

### Step A（v1.8）岗位链 + 地面段阶段 + 放行/滑行/进跑道/脱离指令
> 不动机动模型：地面段用**时间化简化**（滑行按固定时长推进），先让服务链"跑通并可评分"。

1. `data/atcUnits.js` 增 `CD/APC/GND` 三席位（频率/职责/颜色/顺序），移交链按流向走 5 段
2. `domain/phases.js` 扩展 `derivePhase`（含 `onGround` 分支）+ `ISSUE_RULES` 增 6 类指令
3. `commands/parser.js` + `domain/clearances.js` + `domain/readback.js`：新增放行（CRAFT）/推车/滑行/进跑道/脱离/滑入/穿越的解析、执行、复诵措辞与关键项
4. `domain/ground.js`（新，领域层）：`stepGroundMovement(ac)`（时间化）、`acquireRunway/releaseRunway`（跑道锁）、`isRunwayOccupied(code)`
5. `game/director.js`：离港从"停机位 + 待放行"开始；进港落地后保留在地面直到到机位
6. `game/scoring.js` + `game/objectives.js`：新增 §9 的事件与目标
7. `data/viewProfiles.js` + `render/*`：新增 `GND` 档案与地面图层（跑道口/滑行道/机位/占用状态）
8. `core/constants.js`：`PUSHBACK_SEC / TAXI_OUT_SEC / LINEUP_SEC / VACATE_SEC / TAXI_IN_SEC / RUNWAY_OCCUPY_MAX_SEC / TAXI_SPEED_KT`

**验收**：`npm run check` 零越界；`npm run smoke` 新增 ≈14 项断言（岗位链 5 段移交、放行许可复诵关键项、
滑行到等待点、进跑道等待、起飞、落地脱离、滑入机位、跑道占用互斥、穿越跑道评分、GND 视图图层差异）；
关卡 L1 可完整玩完"放行→起飞"与"落地→到机位"。

### Step B（v1.9）地面运动与跑道占用（真实化）
1. `data/taxiways.js`（新）：滑行道节点图（跑道口/等待点/交叉点/机位/机坪），无数据时降级为"跑道口 ↔ 机位"两点
2. 飞机沿节点图以 10–20 kt 滑行（`simulation/motion.js` 增地面分支）；等待点停车；跑道占用锁
3. 复飞后重进近；脱离道口错误判定

**验收**：地面运动确定性（同 seed 复现）；跑道占用冲突可复现；新增 ≈8 项断言。

### Step C（v2.0）高度层与特情
1. `data/flightLevels.js`：高度层配备表（以仓库 `高度层配备表.png` 为参考做**示意数据**，标注"非运行依据"）
2. `ACC` 视图显示高度层（FL）与移交点；等待航线几何；低油量/医疗特情与优先落地

**验收**：高度层显示与换算单测；特情脚本可复现；新增 ≈8 项断言。

---

## 12. 数据与接口草案（遵守 PLAN §3.1 分层）

| 文件 | 层 | 内容 |
|---|---|---|
| `data/atcUnits.js` | 1 | 增 `CD/APC/GND`：`{ code, name, short, en, freq, scopeKm, color, duty, order }`；`UNIT_ORDER` 扩为 5 段；`nextUnit(code, flow)` 按流向返回下一岗位 |
| `data/taxiways.js` | 1 | `{ [icao]: { nodes:[{ id, x, y, type:'gate'|'apron'|'holding'|'exit'|'cross'|'taxi' }], edges:[[a,b]] } }`；缺失时 `domain/ground.js` 用两点降级 |
| `domain/ground.js` | 2 | `assignTaxiRoute(ac, target)`、`stepGroundMovement(ac, dt)`、`groundProgress(ac)`、`acquireRunway(ac, rwy)`、`releaseRunway(ac)`、`isRunwayOccupied(rwy)` |
| `domain/clearances.js` | 2 | `issueReleaseClearance(ac, craft)`、`issuePushback(ac, dir)`、`issueTaxi(ac, route, target)`、`issueLineup(ac, rwy)`、`issueVacate(ac, exit)` |
| `domain/phases.js` | 2 | `derivePhase` 增地面分支；`ISSUE_RULES` 增 `RELEASE/PUSHBACK/TAXI/LINEUP/VACATE/TAXI_IN/CROSS` |
| `commands/parser.js` | 4 | 增动作类型 `release/pushback/taxi/lineup/vacate/taxiIn/cross`（修正「进跑道」语义） |
| `data/viewProfiles.js` | 1 | 增 `GND`（3–5 km）与 `APC`（1–2 km）档案 |
| `render/ground.js` | 3 | 地面图层：跑道口、滑行道、等待点、机位、跑道占用状态 |
| `core/constants.js` | 0 | 地面段时长与速度常量（集中管理，便于后续替换为真实运动） |

**分层红线**：`domain/ground.js` 只依赖 `core` + `data` + `domain`；
`game` 消费其结果；`render` 只读不写；`commands` 调用领域层服务。任何跨层反向依赖都会被
`npm run check` 的层级越界检测拦下。

---

## 13. 参考与免责

**参考**
- ICAO Doc 4444（PANS-ATM）中的 `clearance` / `handoff` / `line up and wait` / `vacate` 概念
- 中国民航用语习惯（`可以起飞` / `可以落地` / `移交塔台` / `联系进近` / `脱离跑道`）
- 本项目仓库内的设计参考素材：`高度层配备表.png`、`事件经过.doc`、`界面草图.jpg`、`草图2.png`、`欧洲猫.png`

**免责**
- 频率、滑行道、机位、高度层、间隔、时长阈值均为**示意数据**，仅用于模拟演示，不作为运行依据
- 各机场/管制单位职责划分存在差异，本项目取典型简化并在数据层保留可调项
- 真实运行请以现行有效的规章、机场资料与管制单位规定为准

