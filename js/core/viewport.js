/**
 * core/viewport.js — 画布与视图变换（内核层）
 * 视图偏移/缩放的唯一事实源（原 core.js 与 interaction/view.js 双份存储已合并）。
 * 所有写入路径统一经过 setViewOffset/setViewScale/moveView/zoomAt，并自动请求重绘。
 *
 * 席位视图（v1.7）：ACC / APP / TWR 是**三张独立地图**，各自记住自己的比例尺与平移。
 * 本模块只维护「按视图键名索引的几何量」这一件事，档案（范围/图层/高度单位）见 data/viewProfiles.js，
 * 切换流程见 render/views.js —— 内核层不依赖数据层。
 * 导出名 viewOffsetX / viewOffsetY / viewScale 始终是**当前视图**的实时值，
 * 因此所有渲染与交互代码无需感知多视图。
 */

import { requestRedraw } from './eventBus.js';
import { ZOOM_MIN, ZOOM_MAX } from './constants.js';

export const canvas = document.getElementById('radar-canvas');
export const ctx = canvas.getContext('2d');

/* 画布 CSS 尺寸与中心（resizeCanvas 更新） */
export let canvasWidth = 0, canvasHeight = 0;
export let centerX = 0, centerY = 0;

/* ---------------- 多视图几何状态 ---------------- */

/** 每个视图的几何量（键名与 data/viewProfiles.js 的视图代码一致） */
const viewGeometry = new Map();
/** 当前视图键名 */
let activeViewKey = 'APP';
/** 当前视图的缩放限值（由 render/views.js 按档案设置） */
let zoomLimits = { min: ZOOM_MIN, max: ZOOM_MAX };

function geometryOf(key) {
    const k = key || activeViewKey;
    if (!viewGeometry.has(k)) viewGeometry.set(k, { offsetX: 0, offsetY: 0, scale: 1, initialized: false });
    return viewGeometry.get(k);
}

/* 视图变换（唯一事实源；始终对应当前视图） */
export let viewOffsetX = 0;
export let viewOffsetY = 0;
export let viewScale = 1;

/** 把当前视图几何写回其存储（切换视图前调用） */
function storeActiveGeometry() {
    const g = geometryOf(activeViewKey);
    g.offsetX = viewOffsetX;
    g.offsetY = viewOffsetY;
    g.scale = viewScale;
}

/** 从存储载入某视图几何（切换视图后调用） */
function loadGeometry(key) {
    const g = geometryOf(key);
    activeViewKey = key;
    viewOffsetX = g.offsetX;
    viewOffsetY = g.offsetY;
    viewScale = g.scale;
}

/** 当前视图键名 */
export function activeView() { return activeViewKey; }

/** 某视图的几何量副本（面板/冒烟断言读值用） */
export function viewState(key) {
    const g = geometryOf(key || activeViewKey);
    return { key: key || activeViewKey, offsetX: g.offsetX, offsetY: g.offsetY, scale: g.scale, initialized: g.initialized };
}

/** 标记某视图已初始化（首次进入后不再自动居中） */
export function markViewInitialized(key) {
    geometryOf(key).initialized = true;
}

/**
 * 切换当前视图：保存旧视图几何 → 载入新视图几何 → 应用该视图的缩放限值。
 * @param {string} key 视图键名（TWR / APP / ACC）
 * @param {{zoom?:{min:number,max:number}}} [opts]
 * @returns {boolean} 是否发生了切换
 */
export function setActiveView(key, opts = {}) {
    if (!key) return false;
    if (opts.zoom) zoomLimits = { min: opts.zoom.min, max: opts.zoom.max };
    if (key === activeViewKey) return false;
    storeActiveGeometry();
    loadGeometry(key);
    requestRedraw();
    return true;
}

/** 直接写入当前视图几何（由 render/views.js 计算初始比例尺/居中时使用） */
export function applyViewGeometry({ scale, offsetX, offsetY } = {}) {
    if (Number.isFinite(scale)) viewScale = Math.max(zoomLimits.min, Math.min(zoomLimits.max, scale));
    if (Number.isFinite(offsetX)) viewOffsetX = offsetX;
    if (Number.isFinite(offsetY)) viewOffsetY = offsetY;
    storeActiveGeometry();
    requestRedraw();
}

export function setViewScale(v) {
    viewScale = Math.max(zoomLimits.min, Math.min(zoomLimits.max, v));
    storeActiveGeometry();
    requestRedraw();
}

export function setViewOffset(x, y) {
    viewOffsetX = x;
    viewOffsetY = y;
    storeActiveGeometry();
    requestRedraw();
}

/** 键盘平移 */
export function moveView(dx, dy) {
    setViewOffset(viewOffsetX + dx, viewOffsetY + dy);
}

/**
 * 把视图中心平移到世界坐标 (x, y)。
 * 屏幕坐标 S = (world - center) × viewScale + canvas/2 + offset，
 * 令 S 落在画布中心即可解出 offset。
 */
export function centerOnWorldPoint(x, y) {
    setViewOffset(-(x - centerX) * viewScale, -(y - centerY) * viewScale);
}

/**
 * 以鼠标位置为锚点缩放（滚轮）。
 * @param {number} factor 缩放倍率（>1 放大，<1 缩小）
 * @param {number} mouseX 屏幕坐标
 * @param {number} mouseY 屏幕坐标
 */
export function zoomAt(factor, mouseX, mouseY) {
    const newScale = Math.max(zoomLimits.min, Math.min(zoomLimits.max, viewScale * factor));
    if (newScale === viewScale) return;
    const worldX = toWorldX(mouseX);
    const worldY = toWorldY(mouseY);
    viewScale = newScale;
    viewOffsetX = mouseX - canvasWidth / 2 - (worldX - centerX) * newScale;
    viewOffsetY = mouseY - canvasHeight / 2 - (worldY - centerY) * newScale;
    storeActiveGeometry();
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
/**
 * pxToKmFixed 的反函数（管制区半径等「固定世界尺度」绘制用）。
 * 与 getPixelsPerKm 不同：不含 viewScale，因而缩放地图不会改变管制区半径，
 * 飞机的席位归属也不会随用户缩放而改变。
 */
export function kmToPxFixed(km) { return km * (Math.min(canvasWidth, canvasHeight) / 500); }

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