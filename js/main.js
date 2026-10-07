/**
 * main.js — 应用入口
 * 职责：注册事件订阅与表单绑定 → 恢复持久化场景 → 固定步长动画循环。
 *
 * 渲染策略：播放中每帧绘制；暂停时仅在事件总线脏标记置位后绘制（空闲零开销）。
 * 键盘平移并入本循环（原 setInterval 双时钟已移除）。
 */

import { state } from './core/store.js';
import { bus, EV, consumeRedraw } from './core/eventBus.js';
import { resizeCanvas } from './core/viewport.js';
import { loadState } from './core/persistence.js';
import {
    updateAircraftPositionsForTime, updateTrails, resolveUnitForDistance
} from './simulation/index.js';
import { drawRadar } from './render/index.js';
import { initSubscriptions, refreshAll } from './ui/subscriptions.js';
import { initFormBindings } from './ui/formBindings.js';
import { updateTimeDisplay, updateProgressList, addComm } from './ui/index.js';
import { tickKeyboard } from './interaction/index.js';

const FIXED_DT = 1 / 60; // 逻辑步长（秒）
let accumulator = 0;
let _lastTime = performance.now();
const stats = { frames: 0 };

function animate(currentTime) {
    stats.frames++;
    const frameDt = Math.min(0.1, (currentTime - _lastTime) / 1000);
    _lastTime = currentTime;

    if (state.isPlaying) {
        accumulator += frameDt * state.timeSpeed;
        let stepped = false;
        while (accumulator >= FIXED_DT && state.isPlaying) {
            state.time += FIXED_DT;
            accumulator -= FIXED_DT;
            if (state.time > state.defaults.timeMax) { state.time = 0; accumulator = 0; }
            updateAircraftPositionsForTime(state.time);
            updateTrails(FIXED_DT);
            stepped = true;
        }
        if (stepped) {
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

initSubscriptions();
initFormBindings();

if (loadState()) bus.emit(EV.SCENE_CHANGED); // 重建面板 + 落盘（幂等）
refreshAll();

addComm('atc', '空管雷达模拟器已启动（事件总线架构版）');
addComm('atc', '滚轮缩放地图 | ASWD或方向键移动 | 点击播放开始模拟');
addComm('atc', '场景数据自动保存在浏览器本地（localStorage）');
addComm('atc', '工具栏可生成场景 / 开启天气图层 / 输入管制指令');

/** 自动化冒烟测试与调试用只读句柄 */
window.__ATC__ = { state, bus, EV, stats, seat: { resolveUnitForDistance } };

requestAnimationFrame(animate);
