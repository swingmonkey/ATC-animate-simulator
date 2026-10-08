# 第二阶段 L1 第一局教学 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 L1 成为流量可控、操作有提示、可以通过手动许可完成的第一局。

**Architecture:** 场景配置决定 L1 的流量和辅助规则；会话层临时应用并恢复偏好；教学模型根据航班及复诵状态派生步骤；UI 只呈现并接收核对动作。

**Tech Stack:** 原生 JavaScript ES 模块、Canvas 2D、Electron 冒烟测试。

## Global Constraints

- 开工前 `git pull --ff-only`，中文提交，GitHub 只走 SSH 推送。
- 保留未跟踪的 `tasks/`，不提交 `.env` 或密钥。
- 不修改 L2/L3/自由流量的默认玩法，不改存档格式。
- 每项行为先加失败的冒烟断言，再做最小实现。

---

### Task 1: L1 可控流量与临时设置

**Files:** `js/data/scenarios.js`, `js/game/scenario.js`, `js/game/director.js`, `js/game/session.js`, `js/ui/seatPanel.js`, `js/ui/subscriptions.js`, `desktop/main.js`

**Interfaces:** 规范化场景包含 `trafficMode/randomEvents/autoClearance/tutorial/initialTimeSpeed`；L1 仅时间轴注入并手动许可，结束恢复用户设置。

- [ ] 写冒烟断言：L1 到 60 秒只有一架进港、无离港、自动许可关闭且控件锁定；结束后偏好恢复。
- [ ] 跑冒烟确认新增断言因当前行为失败。
- [ ] 实现场景配置、导演分支与会话偏好生命周期；其他场景使用旧缺省。
- [ ] 跑冒烟确认通过，更新关卡事件数断言。

### Task 2: 教学步骤与可见反馈

**Files:** `js/game/tutorial.js`, `js/ui/tutorialPanel.js`, `js/ui/commPanel.js`, `js/ui/subscriptions.js`, `js/main.js`, `js/core/eventBus.js`, `index.html`, `styles.css`, `desktop/main.js`

**Interfaces:** `tutorialModel()` 返回当前目标和下一步；`acknowledgeReadback()` 只核对有效复诵；`COMMAND_RESULT` 事件携带指令执行结果。

- [ ] 写冒烟断言：卡片从选机推进到进近、复诵核对、落地许可；失败指令在卡片显示原因且保持当前步骤。
- [ ] 跑冒烟确认新增断言失败。
- [ ] 实现教学模型、卡片和事件订阅；班次结束隐藏卡片。
- [ ] 跑冒烟确认通过，并人工查看截图布局。

### Task 3: 可完成性与交付

**Files:** `desktop/main.js` 及实际修改文件。

- [ ] 冒烟驱动四架航班手动下达进近与落地许可，确认自动完成结果为 `completed`。
- [ ] 运行 `npm run check`、`npm run smoke`、`git diff --check`。
- [ ] 用中文提交并通过 SSH 推送 `codex/phase2-first-session`，保留 `tasks/`。
