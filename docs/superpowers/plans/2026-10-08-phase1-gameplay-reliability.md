# 第一阶段游戏体验修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复沙盒/班次状态、输入目标、场景编辑、结算及时钟，使第一阶段体验可操作且可信。

**Architecture:** `game/session.js` 管班次生命周期，`core/store.js` 暴露运行期编辑许可；`commands` 返回明确执行结果，`ui` 只负责反馈；`core/clock.js` 管单调时间，`game/scoring.js` 管计分。尽量沿用现有模块边界，不增加依赖或构建流程。

**Tech Stack:** 原生 JavaScript ES 模块、Canvas 2D、Electron、`desktop/main.js` 冒烟断言、`npm run check`。

## Global Constraints

- 开工前 `git pull --ff-only`；完成后中文提交并通过 GitHub SSH remote 推送。
- 保留用户未跟踪的 `tasks/` 内容，不提交密钥或 `.env`。
- 游戏班次不可回溯，沙盒可回放；现有存档键不变。
- 每个修复先添加失败的行为断言，再做最小实现，逐项验证。

---

### Task 1: 沙盒与游戏班次状态

**Files:** `js/game/session.js`, `js/core/store.js`, `js/ui/indicators.js`, `js/interaction/toolbar.js`, `desktop/main.js`

**Interfaces:** `isSessionActive()` 仅指未结束的 `kind:'game'`；`isEditMode()` 要求暂停且游戏班次未运行。

- [x] 写冒烟断言：初次加载 `A.session.active()===false`，关卡下拉可选，沙盒时间轴可拖；游戏暂停后 `isEditMode()===false`；播放中结束按钮可点。
- [x] 运行 `npm run smoke`，确认新增断言按预期失败。
- [x] 让班次生命周期维护运行期锁；缩小 UI 禁用选择器，按动作验证场景编辑权限。
- [x] 重跑冒烟确认新增断言通过，检查既有断言。

### Task 2: 画布首次拖拽与双击

**Files:** `js/interaction/canvasInput.js`, `desktop/main.js`

**Interfaces:** 鼠标抬起与双击监听器只在模块初始化时各注册一次；画布外松开也收尾拖拽。

- [x] 写冒烟断言：空白场景首个航路点双击有效；首次拖机在画布外松开能结束拖拽；重复点击不会叠加处理次数。
- [x] 运行冒烟看到断言失败。
- [x] 将嵌套在 `mousedown` 飞机遍历中的监听器移到顶层，保持命中和拖拽行为。
- [x] 重跑冒烟确认通过。

### Task 3: 指令目标与失败反馈

**Files:** `js/commands/parser.js`, `js/commands/executor.js`, `js/ui/commPanel.js`, `index.html`, `styles.css`, `desktop/main.js`

**Interfaces:** `executeCommand(text)` 对未知呼号返回 `{ok:false,affected:0,message}`；`submitAtcText` 仅在成功执行后录入与播报，并在 `#comm-feedback` 展示结果。

- [ ] 写冒烟断言：`CCA9999 下降 3000` 不影响飞机；失败输入保持原文并显示错误；正确呼号仍只影响目标机。
- [ ] 运行冒烟看到断言失败。
- [ ] 修解析边界、目标拒绝与输入反馈；群发意图沿用现有无呼号用法。
- [ ] 重跑冒烟确认通过。

### Task 4: 结算结果与冲突对象

**Files:** `js/game/director.js`, `js/game/session.js`, `js/domain/separation.js`, `js/ui/sessionPanel.js`, `desktop/main.js`

**Interfaces:** `directorGoal()` 返回 `outcome:'completed'|'failed'`；`endGameSession()` 结果带 `outcome/performanceScore`；未完成最终 `score<=59`；冲突过滤已落地飞机。

- [ ] 写冒烟断言：零落地结束为 `abandoned` 且不是 S；时限到未达标为 `failed`；落地机不在冲突配对中。
- [ ] 运行冒烟看到断言失败。
- [ ] 实现结果区分与评分上限，在结算面板显示结束状态；过滤落地机。
- [ ] 重跑冒烟确认通过。

### Task 5: 游戏时钟与高倍速一致性

**Files:** `js/core/clock.js`, `js/main.js`, `js/game/session.js`, `desktop/main.js`

**Interfaces:** 游戏时间超过 `timeMax` 不回卷；模拟状态按固定步长前进，UI 绘制仍走 rAF；1×/10×/60× 的关键事件结果一致。

- [ ] 写冒烟断言：自由班次跨过 2400 秒持续递增且继续出流；同种子跨倍率的落地数与违规计数一致。
- [ ] 运行冒烟看到断言失败。
- [ ] 改时钟推进与业务检查顺序，限制高倍速计算量并保持确定性。
- [ ] 重跑冒烟确认通过。

### Task 6: 完整验证与交付

**Files:** 本计划中实际修改的文件。

- [ ] 运行 `npm run check`、`npm run smoke`，读取失败数与控制台错误。
- [ ] 对照设计文档逐项做运行时验收，检查 `git diff --check` 与工作区。
- [ ] 使用中文提交信息提交本阶段文件，`git push origin codex/phase1-gameplay-reliability`，保留现有 `tasks/` 未跟踪文件。
