/**
 * main.js — 应用入口（唯一装配点）
 * 职责：装配各层（领域层逐帧推进注入仿真循环、订阅注册、表单绑定）→ 恢复存档 → 时钟驱动的动画循环。
 *
 * 依赖方向见 docs/PLAN-v2.md §3.1：本文件是唯一允许跨层 import 的“装配点”。
 * 时间推进统一走 core/clock.js（固定步长）；键盘平移并入本循环。
 */

import { state } from './core/store.js';
import { bus, EV, consumeRedraw } from './core/eventBus.js';
import { resizeCanvas } from './core/viewport.js';
import { tickClock, resetClockAccumulator, clockStats } from './core/clock.js';
import { loadState } from './core/persistence.js';
import { updateAircraftPositionsForTime, updateTrails } from './simulation/index.js';
import { normalizeScene } from './domain/aircraft.js';
import { resolveUnitForDistance } from './domain/airspace.js';
import { PHASE, derivePhase, syncPhase, canIssue, issueHint } from './domain/phases.js';
import { predictMinSeparation, predictedConflicts } from './domain/separation.js';
import { initSessionWiring, currentSession, recordInput } from './game/session.js';
import { drawRadar } from './render/index.js';
import { initSubscriptions, refreshAll } from './ui/subscriptions.js';
import { initFormBindings } from './ui/formBindings.js';
import { updateTimeDisplay, updateProgressList, addComm } from './ui/index.js';
import { tickKeyboard } from './interaction/index.js';

let _lastTime = performance.now();
const stats = { frames: 0 };

function animate(currentTime) {
    stats.frames++;
    const frameDt = Math.min(0.1, (currentTime - _lastTime) / 1000);
    _lastTime = currentTime;

    if (state.isPlaying) {
        const { stepped, dt } = tickClock(frameDt);
        if (stepped) {
            updateAircraftPositionsForTime(state.time);
            updateTrails(dt);
            // 两者内部均按 100ms / 250ms 节流，60× 倍速下不再每秒重建数千次 DOM
            updateTimeDisplay();
            updateProgressList();
        }
    }

    tickKeyboard(frameDt);

    if (state.isPlaying || consumeRedraw()) drawRadar();
    requestAnimationFrame(animate);
}

/* ---------------- 启动引导 ---------------- */

resizeCanvas();
window.addEventListener('resize', resizeCanvas);

initSessionWiring();                  // 领域层推进注入仿真循环 + 时钟采样 + 班次（P0：启动即值班）
bus.on(EV.PLAYBACK_CHANGED, resetClockAccumulator);   // 暂停/恢复不补帧
initSubscriptions();
initFormBindings();

if (loadState()) {
    normalizeScene();                 // 领域字段补齐（旧存档 ac.phase → ac.flow）
    bus.emit(EV.SCENE_CHANGED);       // 重建面板 + 落盘（幂等）
}
refreshAll();

addComm('atc', '空管雷达模拟器已启动（领域层分层版 v2 · P0）');
addComm('atc', '滚轮缩放地图 | ASWD或方向键移动 | 点击播放开始模拟');
addComm('atc', '场景数据自动保存在浏览器本地（localStorage）');
addComm('atc', '工具栏可生成场景 / 开启天气图层 / 输入管制指令');

/** 自动化冒烟测试与调试用只读句柄（装配点导出，业务层不得依赖） */
window.__ATC__ = {
    state, bus, EV, stats,
    seat: { resolveUnitForDistance },
    phase: { PHASE, derivePhase, syncPhase, canIssue, issueHint },
    sep: { predictMinSeparation, predictedConflicts },
    session: currentSession,
    recordInput,
    clock: clockStats
};

requestAnimationFrame(animate);
