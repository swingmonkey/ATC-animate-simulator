/**
 * interaction/view.js — 视图偏移状态（输入层）
 * 集中管理画布平移偏移，供键盘/滚轮/拖拽共用，保持 core 中偏移只读导出。
 */

import { setViewOffset, viewOffsetX, viewOffsetY } from '../core.js';

let _vx = viewOffsetX;
let _vy = viewOffsetY;

export function moveView(dx, dy) {
    _vx += dx;
    _vy += dy;
    setViewOffset(_vx, _vy);
}

export function getViewOffset() {
    return { x: _vx, y: _vy };
}

export function setViewOffsetXY(x, y) {
    _vx = x;
    _vy = y;
    setViewOffset(x, y);
}
