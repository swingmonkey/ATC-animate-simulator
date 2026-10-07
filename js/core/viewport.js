/**
 * core/viewport.js — 画布与视图变换（内核层）
 * 视图偏移/缩放的唯一事实源（原 core.js 与 interaction/view.js 双份存储已合并）。
 * 所有写入路径统一经过 setViewOffset/setViewScale/moveView/zoomAt，并自动请求重绘。
 */

import { requestRedraw } from './eventBus.js';
import { ZOOM_MIN, ZOOM_MAX } from './constants.js';

export const canvas = document.getElementById('radar-canvas');
export const ctx = canvas.getContext('2d');

/* 画布 CSS 尺寸与中心（resizeCanvas 更新） */
export let canvasWidth = 0, canvasHeight = 0;
export let centerX = 0, centerY = 0;

/* 视图变换（唯一事实源） */
export let viewOffsetX = 0;
export let viewOffsetY = 0;
export let viewScale = 1;

export function setViewScale(v) {
    viewScale = v;
    requestRedraw();
}

export function setViewOffset(x, y) {
    viewOffsetX = x;
    viewOffsetY = y;
    requestRedraw();
}

/** 键盘平移 */
export function moveView(dx, dy) {
    setViewOffset(viewOffsetX + dx, viewOffsetY + dy);
}

/**
 * 以鼠标位置为锚点缩放（滚轮）。
 * @param {number} factor 缩放倍率（>1 放大，<1 缩小）
 * @param {number} mouseX 屏幕坐标
 * @param {number} mouseY 屏幕坐标
 */
export function zoomAt(factor, mouseX, mouseY) {
    const newScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, viewScale * factor));
    if (newScale === viewScale) return;
    const worldX = toWorldX(mouseX);
    const worldY = toWorldY(mouseY);
    viewScale = newScale;
    viewOffsetX = mouseX - canvasWidth / 2 - (worldX - centerX) * newScale;
    viewOffsetY = mouseY - canvasHeight / 2 - (worldY - centerY) * newScale;
    requestRedraw();
}

export function resizeCanvas() {
    const container = document.getElementById('radar-container');
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * devicePixelRatio;
    canvas.height = rect.height * devicePixelRatio;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(devicePixelRatio, devicePixelRatio);
    canvasWidth = rect.width;
    canvasHeight = rect.height;
    centerX = canvasWidth / 2;
    centerY = canvasHeight / 2;
    requestRedraw();
}

/* ---------------- 比例尺与坐标变换 ---------------- */

export function getPixelsPerKm() { return Math.min(canvasWidth, canvasHeight) / 500 * viewScale; }
export function kmToPx(km) { return km * getPixelsPerKm(); }
export function pxToKm(px) { return px / getPixelsPerKm(); }
/** 不含缩放的固定比例换算（标签/航线标注用） */
export function pxToKmFixed(px) { return px / (Math.min(canvasWidth, canvasHeight) / 500); }

export function toWorldX(screenX) {
    return (screenX - canvasWidth / 2 - viewOffsetX) / viewScale + centerX;
}
export function toWorldY(screenY) {
    return (screenY - canvasHeight / 2 - viewOffsetY) / viewScale + centerY;
}
export function toScreenX(worldX) {
    return (worldX - centerX) * viewScale + canvasWidth / 2 + viewOffsetX;
}
export function toScreenY(worldY) {
    return (worldY - centerY) * viewScale + canvasHeight / 2 + viewOffsetY;
}

/** 鼠标事件 → 画布 CSS 坐标 */
export function getCanvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}