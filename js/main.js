/**
 * main.js — 应用入口
 * 初始化画布、恢复持久化场景、启动动画循环。
 */

import {
    state,
    lastTime,
    resizeCanvas,
    setLastTime,
    loadState,
} from './core.js';
import {
    updateAircraftPositionsForTime,
    updateTrails,
} from './simulation.js';
import { drawRadar } from './render.js';
import {
    updateEditModeUI,
    updateTimeDisplay,
    updateProgressList,
    updateCommTargetSelect,
    addComm,
    updateModeIndicator,
    updatePointPanelList,
    updateRoutePanelList,
    updateAircraftPanelList,
} from './ui.js';
import './interactions.js';

function animate(currentTime) {
    const dt = (currentTime - lastTime) / 1000;
    setLastTime(currentTime);
    if (state.isPlaying) {
        state.time += dt * state.timeSpeed;
        if (state.time > state.defaults.timeMax) state.time = 0;
        updateTimeDisplay();
        updateAircraftPositionsForTime(state.time);
        updateTrails(dt);
        updateProgressList();
    }
    drawRadar();
    requestAnimationFrame(animate);
}

resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// 恢复上次保存的场景（航路点/航线/飞机/设置）
if (loadState()) {
    updatePointPanelList();
    updateRoutePanelList();
    updateAircraftPanelList();
    updateCommTargetSelect();
}

updateModeIndicator();
updateTimeDisplay();
updateEditModeUI();
addComm('atc', '空管雷达模拟器已启动');
addComm('atc', '滚轮缩放地图 | ASWD或方向键移动 | 点击播放开始模拟');
addComm('atc', '场景数据自动保存在浏览器本地（localStorage）');

requestAnimationFrame(animate);
