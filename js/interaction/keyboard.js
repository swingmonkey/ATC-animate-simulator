/**
 * interaction/keyboard.js — 键盘输入（输入层）
 * Esc 清除选择/退出连接模式（经 store 动作）；空格与 Delete 经 DOM 点击复用工具栏处理；
 * WASD/方向键平移改为由 main.js 动画循环按帧调用 tickKeyboard(dt)——
 * 原先独立的 setInterval(16ms) 与 rAF 双时钟已合并。
 */

import { state, select, cancelRouteConnect, isEditMode } from '../core/store.js';
import { moveView } from '../core/viewport.js';
import { PAN_SPEED } from '../core/constants.js';

const keysPressed = {};

/** 由 main.js 动画循环按帧调用：按 dt 平移视图 */
export function tickKeyboard(dt) {
    const step = PAN_SPEED * dt;
    let dx = 0, dy = 0;
    if (keysPressed['w'] || keysPressed['arrowup']) dy += step;
    if (keysPressed['s'] || keysPressed['arrowdown']) dy -= step;
    if (keysPressed['a'] || keysPressed['arrowleft']) dx += step;
    if (keysPressed['d'] || keysPressed['arrowright']) dx -= step;
    if (dx !== 0 || dy !== 0) moveView(dx, dy);
}

document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    keysPressed[e.key.toLowerCase()] = true;

    if (e.key === 'Escape') {
        document.querySelectorAll('.dialog:not(.hidden)').forEach(d => d.classList.add('hidden'));
        cancelRouteConnect();
        state.targetSelectMode = null;
        state.tempTargetPoint = null;
        state.draggingLabelAc = null;
        select(null);
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && isEditMode()) {
        if (document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'SELECT') {
            document.getElementById('tool-delete')?.click();
        }
    }
    if (e.key === ' ') {
        if (document.activeElement.tagName !== 'INPUT') {
            e.preventDefault();
            document.getElementById('play-pause-btn')?.click();
        }
    }
});

document.addEventListener('keyup', e => {
    keysPressed[e.key.toLowerCase()] = false;
});