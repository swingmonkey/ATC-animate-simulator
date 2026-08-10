/**
 * main.js — 应用入口（固定步长动画循环 + 启动引导）
 */

import {
    state, resizeCanvas, loadState
} from './core.js';
import {
    updateAircraftPositionsForTime, updateTrails
} from './simulation/index.js';
import { drawRadar } from './render/index.js';
import {
    updateEditModeUI, updateTimeDisplay, updateProgressList,
    updateCommTargetSelect, addComm, updateModeIndicator,
    updatePointPanelList, updateRoutePanelList, updateAircraftPanelList
} from './ui/index.js';
import './interaction/index.js';

const FIXED_DT = 1 / 60; // 逻辑步长（秒）
let accumulator = 0;
let _lastTime = performance.now();

function animate(currentTime) {
    const frameDt = Math.min(0.1, (currentTime - _lastTime) / 1000);
    _lastTime = currentTime;

    if (state.isPlaying) {
        accumulator += frameDt * state.timeSpeed;
        let stepped = false;
        while (accumulator >= FIXED_DT) {
            state.time += FIXED_DT;
            accumulator -= FIXED_DT;
            if (state.time > state.defaults.timeMax) { state.time = 0; accumulator = 0; }
            updateAircraftPositionsForTime(state.time);
            updateTrails(FIXED_DT);
            stepped = true;
        }
        if (stepped) {
            updateTimeDisplay();
            updateProgressList();
        }
    }
    drawRadar();
    requestAnimationFrame(animate);
}

/* ---------------- 启动引导 ---------------- */

resizeCanvas();
window.addEventListener('resize', resizeCanvas);

if (loadState()) {
    updatePointPanelList();
    updateRoutePanelList();
    updateAircraftPanelList();
    updateCommTargetSelect();
}

updateModeIndicator();
updateTimeDisplay();
updateEditModeUI();
addComm('atc', '空管雷达模拟器已启动（五层架构版）');
addComm('atc', '滚轮缩放地图 | ASWD或方向键移动 | 点击播放开始模拟');
addComm('atc', '场景数据自动保存在浏览器本地（localStorage）');
addComm('atc', '工具栏可生成场景 / 开启天气图层 / 输入管制指令');

requestAnimationFrame(animate);
