/**
 * core.js — 内核（Kernel）
 * 所有层共享的 state 单例、画布与坐标工具、localStorage 持久化。
 * 不依赖任何业务层，是依赖图的叶子。
 */

export const canvas = document.getElementById('radar-canvas');
export const ctx = canvas.getContext('2d');

export let canvasWidth, canvasHeight;
export let centerX, centerY;

export let viewOffsetX = 0;
export let viewOffsetY = 0;
export let viewScale = 1;

export function setViewScale(v) { viewScale = v; }
export function setViewOffset(x, y) { viewOffsetX = x; viewOffsetY = y; }

export let lastTime = performance.now();
export let tempMeasureLine = null;
export let draggingPoint = null;
export let dragPointOffsetX = 0;
export let dragPointOffsetY = 0;
export let draggingAc = null;
export let dragAcOffsetX = 0;
export let dragAcOffsetY = 0;
export let labelFollowMouse = null;
export const keysPressed = {};

export function setTempMeasureLine(v) { tempMeasureLine = v; }
export function setDraggingPoint(v) { draggingPoint = v; }
export function setDraggingAc(v) { draggingAc = v; }
export function setLabelFollowMouse(v) { labelFollowMouse = v; }
export function setLastTime(v) { lastTime = v; }
export function setDragPointOffset(x, y) { dragPointOffsetX = x; dragPointOffsetY = y; }
export function setDragAcOffset(x, y) { dragAcOffsetX = x; dragAcOffsetY = y; }

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
}

/** 全局场景状态（单一数据源） */
export const state = {
    routePoints: [],
    routes: [],
    aircraft: [],
    connections: [],
    distanceLines: [],
    time: 0,
    timeSpeed: 1,
    isPlaying: false,
    currentTool: 'select',
    selectedItem: null,
    editingPointId: null,
    editingRouteId: null,
    editingAircraftId: null,
    commMessages: [],
    routeConnectPoints: [],
    routeConnectMode: false,
    isDraggingFromPalette: false,
    paletteDragType: null,
    paletteDragSubType: null,
    baseTime: 0,
    basePositions: {},
    pointNameCounter: 1,
    draggingLabelAc: null,
    labelOffsets: {},
    targetSelectMode: null,
    tempTargetPoint: null,
    pendingNextWaypointSelection: null,
    isPausedForWaypointSelection: false,
    // 天气层开关（新增）
    weatherEnabled: false,
    storm: null
};

state.defaults = {
    altitude: 10600, speed: 480, acType: 'B738', squawk: '2000',
    gridSpacing: 50, minSeparationNm: 15, timeMax: 2400
};

export function getPixelsPerKm() { return Math.min(canvasWidth, canvasHeight) / 500 * viewScale; }
export function kmToPx(km) { return km * getPixelsPerKm(); }
export function pxToKm(px) { return px / getPixelsPerKm(); }
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

export function isEditMode() { return !state.isPlaying; }

export function getCanvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
    };
}

/* ---------------- localStorage 持久化 ---------------- */

const STORAGE_KEY = 'atc_simulator_state_v2';

export function saveState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            routePoints: state.routePoints,
            routes: state.routes,
            aircraft: state.aircraft,
            connections: state.connections,
            distanceLines: state.distanceLines,
            defaults: state.defaults,
            pointNameCounter: state.pointNameCounter
        }));
    } catch (e) {
        console.warn('保存场景状态失败:', e);
    }
}

export function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            // 兼容旧版本存储键
            const legacy = localStorage.getItem('atc_simulator_state_v1');
            if (legacy) localStorage.setItem(STORAGE_KEY, legacy);
            else return false;
        }
        const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if (data.routePoints) state.routePoints = data.routePoints;
        if (data.routes) state.routes = data.routes;
        if (data.aircraft) state.aircraft = data.aircraft;
        if (data.connections) state.connections = data.connections;
        if (data.distanceLines) state.distanceLines = data.distanceLines;
        if (data.defaults) state.defaults = { ...state.defaults, ...data.defaults };
        if (data.pointNameCounter) state.pointNameCounter = data.pointNameCounter;
        return true;
    } catch (e) {
        console.warn('恢复场景状态失败:', e);
        return false;
    }
}
