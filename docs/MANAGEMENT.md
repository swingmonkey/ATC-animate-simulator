# 空管单位经营模拟（Management Layer）

> 目标：把「当班管制模拟器」扩展为「经营一座空管单位」的模拟经营游戏。
> 现场层仍然负责每一架飞机的管制；经营层回答另一组问题：钱从哪来、人怎么排、扇区怎么划、
> 设备什么时候升级、局方什么时候批实验运行。

## 1. 核心循环

```
流量增长（合同架次自然增长）
  → 收入 / 绩效奖励
  → 招聘见习 / 管制员
  → 培训（培训室 + 每日培训费）
  → 任命管制主管（管理水平）
  → 按流量与技术划分扇区（复用 domain/seats.planSeats）
  → 建设现场 / 设备机房，安排席位
  → 升级程序管制 → 监视管制（或 ILS Ⅱ 类 / 独立平行进近）
  → 向局方申请实验运行（有期限、有审批门槛）
  → 承接更大合同（区域支线 → 干线 → 枢纽）
  → 日结算：营收 / 薪资 / 维护 / 培训 / 声望
  → 回到流量增长
```

一次「班次」仍然是现场玩法；点击「结束今日」才推进经营日。班次绩效分越高，
当日的绩效奖励与评级声望越高（复用 `game/scoring.js` 与 `game/session.js` 的结算结果）。

## 2. 领域模型

| 概念 | 落点 | 说明 |
| --- | --- | --- |
| 资金 / 声望 / 日期 | `state.management` | 单一数据源，随存档持久化 |
| 员工 | `management.staff[]` | 见习 → 管制员 → 管制主管；含薪资、培训剩余天数、席位、疲劳 |
| 房间 / 现场 | `management.rooms[]` | 塔台 / 进近 / 区域 / 培训室 / 休息室 / 设备机房 |
| 席位 | `management.seats{}` | 席位代号 → 员工 ID；席位是否开放由「规划 ∩ 已建设施」决定 |
| 扇区 | `domain/management.sectorPlanOf()` | 直接复用 `domain/seats.planSeats()`，与现场层同口径 |
| 合同 | `management.contracts[]` | 区域支线 2 万架次 / 干线 6 万 / 枢纽 11 万；年架次决定扇区门槛与日收入 |
| 技术 | `management.tech` | `procedural`（程序管制）→ `surveillance`（监视管制） |
| 环境 | `management.ilsCat` / `parallelApproach` | ILS Ⅱ 类、独立平行进近；影响 GND / NTZ 席位 |
| 局方 | `management.trial` | 未申请 / 已递交 / 已批复 / 不予批复；实验运行有有效期 |

## 3. 分层与依赖

| 层 | 文件 | 职责 |
| --- | --- | --- |
| data (1) | `js/data/management.js` | 所有可调数值与模板，禁止业务硬编码 |
| domain (2) | `js/domain/management.js` | 纯函数：可否招聘 / 建造 / 升级 / 签约 / 申请；日结算公式；扇区与席位推导 |
| game (3) | `js/game/management.js` | 有副作用的动作与状态流转：招 / 培 / 任 / 建 / 排 / 升 / 签 / 申请 / 结束今日 |
| ui (5) | `js/ui/managementPanel.js` | 只读 `managementSummary()`，只调用 game 层动作与发通话 |
| render (3) | `js/render/hud.js` | 顶部 HUD 追加 💰 资金 / ⭐ 声望 / 👥 员工 / 🏠 房间槽位 |

事件追加在 `core/eventBus.js`：`MANAGEMENT_CHANGED / STAFF_CHANGED / ROOM_CHANGED /
CONTRACT_CHANGED / TRIAL_CHANGED / DAY_SETTLED`，统一由 `ui/subscriptions.js` 刷新面板。

## 4. 日结算口径

每日结算（`endDay`）：

- 收入：Σ(合同年架次 × 单架次收入 ÷ 365)
- 绩效奖励：本日首个班次的绩效分 × `performanceBonusPerScore`
- 支出：Σ(员工月薪 ÷ 30) + 房间数 × `maintenancePerDay` + 在训人数 × `trainingCostPerDay`
- 声望：按班次评级 S/A/B/C/D 增减；无班次则不变
- 培训：在训员工剩余天数 -1，到 0 转正为管制员
- 疲劳：本班次存在 `restIgnored` 则 +1，否则休息 -1（体现休息室与轮换管理）
- 实验运行：`pending` 在日结算时批复；获批后有 `trialDurationDays` 有效期
- 流量增长：每个合同年架次 ×(1 + `trafficGrowthPerDay`)，驱动后续扇区扩张

## 5. 里程碑

- **M1（本次）**：最小可玩闭环 —— 招聘 / 培训 / 任命 / 建造 / 排席 / 升级监视管制 / 签合同 /
  申请实验运行 / 结束今日结算 + 面板 + HUD + 存档 + 无头冒烟。
- **M2**：员工疲劳与排班细化、休息室收益、主管管理半径、扇区合并/拆分可视化。
- **M3**：随机事件（设备故障、航班高峰、局方检查）、多机场、声望分支结局。
- **M4**：合同违约、预算报告、月度审计、教学关卡。

## 6. 假设与待验证

- 所有数值（起始资金 500 万、维护 2000/日、绩效系数 200 等）均为**示意值，需试玩校验**。
- 实验运行在 M1 为演示版自动批复，尚未实现局方审查随机性与驳回理由，**需试玩校验**。
- 桌面无头冒烟只验证逻辑与 DOM 挂载；平衡性、长期经营手感、多视口视觉**未实测**。