/**
 * interaction/canvasInput.js — 画布鼠标输入（输入层）
 * 缩放、平移、选择、拖拽航路点/飞机/标签、双击与右键打开对话框。
 *
 * 变更点（相对原实现）：
 * - 视图缩放经 viewport.zoomAt（唯一事实源，自动请求重绘）
 * - 选择经 store.select()（事件驱动刷新模式指示与进程单）
 * - 拖拽状态为模块内局部变量（原 core.js 中的 setter 桥接已移除）
 * - 删除从未置非空的 labelFollowMouse / tempMeasureLine 死分支
 */

import { state, isEditMode, select, addComm, commitScene, addRouteConnectPoint, clearTargetSelectMode } from '../core/store.js';
import {
    canvas, toWorldX, toWorldY, toScreenX, toScreenY,
    getCanvasCoords, zoomAt
} from '../core/viewport.js';
import { requestRedraw } from '../core/eventBus.js';
import { HIT } from '../core/constants.js';
import { posX, posY } from '../core/accessors.js';
import { pointOnRoute, getPositionOnRoute } from '../simulation/geometry.js';
import {
    updatePointDialogPosition, openAircraftDialog, openPointDialog, openRouteDialog, updateTargetInfo
} from '../ui/index.js';

/* 模块内拖拽会话状态（仅本模块读写） */
let draggingPoint = null;
let draggingAc = null;

/* ---------------- 缩放 ---------------- */

canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    zoomAt(e.deltaY > 0 ? 0.9 : 1.1, e.clientX - rect.left, e.clientY - rect.top);
}, { passive: false });

/* ---------------- 鼠标移动 ---------------- */

canvas.addEventListener('mousemove', e => {
    const coords = getCanvasCoords(e);

    if (state.targetSelectMode) {
        state.tempTargetPoint = { x: toWorldX(coords.x), y: toWorldY(coords.y) };
        requestRedraw();
    }
    if (draggingPoint && isEditMode()) {
        draggingPoint.x = toWorldX(coords.x);
        draggingPoint.y = toWorldY(coords.y);
        updatePointDialogPosition();
        requestRedraw();
    }
    if (draggingAc && isEditMode()) {
        draggingAc.x = toWorldX(coords.x);
        draggingAc.y = toWorldY(coords.y);
        draggingAc.displayX = draggingAc.x;
        draggingAc.displayY = draggingAc.y;
        requestRedraw();
    }
    if (state.draggingLabelAc) {
        const ac = state.draggingLabelAc;
        const acX = posX(ac), acY = posY(ac);
        const mouseWorldX = toWorldX(coords.x), mouseWorldY = toWorldY(coords.y);
        const angle = Math.atan2(mouseWorldY - acY, mouseWorldX - acX);
        const angleStep = 30 * Math.PI / 180;
        const snappedAngle = Math.round(angle / angleStep) * angleStep;
        const dx = mouseWorldX - acX, dy = mouseWorldY - acY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const maxOffsetWorld = 80;
        const clampedDist = Math.min(dist, maxOffsetWorld);
        ac.labelOffsetX = Math.cos(snappedAngle) * clampedDist;
        ac.labelOffsetY = Math.sin(snappedAngle) * clampedDist;
        requestRedraw();
    }
});


/* ---------------- 右键菜单 ---------------- */

canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (!isEditMode()) return;
    const coords = getCanvasCoords(e);
    const mx = toWorldX(coords.x), my = toWorldY(coords.y);
    let handled = false;
    state.aircraft.forEach(ac => {
        if (Math.sqrt((mx - ac.x) ** 2 + (my - ac.y) ** 2) < HIT.AIRCRAFT_DBL) {
            select({ type: 'aircraft', id: ac.id });
            openAircraftDialog(ac.id);
            handled = true;
        }
    });
    if (handled) return;
    state.routePoints.forEach(pt => {
        if (Math.sqrt((mx - pt.x) ** 2 + (my - pt.y) ** 2) < HIT.POINT_DBL) {
            select({ type: 'point', id: pt.id });
            openPointDialog(pt.id);
        }
    });
});

/* ---------------- 鼠标按下 ---------------- */

canvas.addEventListener('mousedown', e => {
    if (e.button !== 0) return;

    if (state.targetSelectMode) {
        const coords = getCanvasCoords(e);
        const mx = toWorldX(coords.x), my = toWorldY(coords.y);
        const ac = state.aircraft.find(a => a.id === state.targetSelectMode);
        if (ac) {
            ac.targetX = mx; ac.targetY = my; ac.navMode = 'free';
            const txInput = document.getElementById('target-x');
            const tyInput = document.getElementById('target-y');
            if (txInput) txInput.value = Math.round(mx);
            if (tyInput) tyInput.value = Math.round(my);
            updateTargetInfo(ac);
        }
        const btn = document.getElementById('select-target-btn');
        if (btn) { btn.style.background = ''; btn.style.color = ''; }
        clearTargetSelectMode();
        return;
    }

    const coords = getCanvasCoords(e);
    const mx = toWorldX(coords.x), my = toWorldY(coords.y);

    /* 播放中：仅允许选择飞机 */
    if (!isEditMode()) {
        let hitAc = null;
        state.aircraft.forEach(ac => {
            if (state.time < (ac.startTime || 0)) return;
            if (Math.sqrt((mx - posX(ac)) ** 2 + (my - posY(ac)) ** 2) < HIT.AIRCRAFT) hitAc = ac;
        });
        select(hitAc ? { type: 'aircraft', id: hitAc.id } : null);
        return;
    }

    /* 航线连接模式：累加航路点 */
    if (state.routeConnectMode) {
        state.routePoints.forEach(pt => {
            if (Math.sqrt((mx - pt.x) ** 2 + (my - pt.y) ** 2) < HIT.POINT_CONNECT) {
                addRouteConnectPoint(pt.id);
            }
        });
        return;
    }

    /* 航路点（可选择并拖拽） */
    let hitPt = null;
    state.routePoints.forEach(pt => {
        if (Math.sqrt((mx - pt.x) ** 2 + (my - pt.y) ** 2) < HIT.POINT) hitPt = pt;
    });
    if (hitPt) {
        select({ type: 'point', id: hitPt.id });
        draggingPoint = hitPt;
        return;
    }

    /* 飞机（可选择并拖拽） */
    let hitAc = null;
    state.aircraft.forEach(ac => {
        if (state.time < (ac.startTime || 0)) return;
        if (Math.sqrt((mx - posX(ac)) ** 2 + (my - posY(ac)) ** 2) < HIT.AIRCRAFT) hitAc = ac;
    });
    if (hitAc) {
        select({ type: 'aircraft', id: hitAc.id });
        draggingAc = hitAc;
        return;
    }

    /* 标签框（拖拽标签位置） */
    let hitLabel = null;
    state.aircraft.forEach(ac => {
        const labelOffsetX = ac.labelOffsetX !== undefined ? ac.labelOffsetX : 50;
        const labelOffsetY = ac.labelOffsetY !== undefined ? ac.labelOffsetY : -30;

        const labelScreenX = toScreenX(ac.x + labelOffsetX);
        const labelScreenY = toScreenY(ac.y + labelOffsetY);
        if (coords.x >= labelScreenX && coords.x <= labelScreenX + HIT.LABEL_W &&
            coords.y >= labelScreenY && coords.y <= labelScreenY + HIT.LABEL_H) hitLabel = ac;
    });
    if (hitLabel) {
        select({ type: 'aircraft', id: hitLabel.id });
        state.draggingLabelAc = hitLabel;
        return;
    }

    /* 航线 */
    let hitRoute = null;
    state.routes.forEach(route => { if (pointOnRoute(mx, my, route) < HIT.ROUTE) hitRoute = route; });
    if (hitRoute) {
        select({ type: 'route', id: hitRoute.id });
        return;
    }

    select(null);
});

/* ---------------- 鼠标抬起（飞机贴航线 / 航路点落位） ---------------- */

window.addEventListener('mouseup', e => {
    if (state.draggingLabelAc) {
        state.draggingLabelAc = null;
        requestRedraw();
    }
    if (draggingAc) {
        if (!isEditMode()) { draggingAc = null; return; }
        const coords = getCanvasCoords(e);
        const mx = toWorldX(coords.x), my = toWorldY(coords.y);
        let nearestRoute = null, minD = Infinity;
        state.routes.forEach(route => {
            const d = pointOnRoute(mx, my, route);
            if (d < minD) { minD = d; nearestRoute = route; }
        });
        if (nearestRoute && minD < 30) {
            const posOnRoute = getPositionOnRoute(mx, my, nearestRoute);
            draggingAc.routeId = nearestRoute.id;
            draggingAc.routeDistance = posOnRoute.dist;
            draggingAc.x = posOnRoute.x;
            draggingAc.y = posOnRoute.y;
            draggingAc.displayX = posOnRoute.x;
            draggingAc.displayY = posOnRoute.y;
            const p1 = nearestRoute.points[posOnRoute.segIdx];
            const p2 = nearestRoute.points[posOnRoute.segIdx + 1] || p1;
            let heading = Math.atan2(p2.x - p1.x, -(p2.y - p1.y)) * 180 / Math.PI;
            if (heading < 0) heading += 360;
            draggingAc.heading = heading;
            draggingAc.trail = [];
            addComm('atc', `${draggingAc.flightNo} 已关联航线 ${nearestRoute.name}`);
        } else {
            draggingAc.routeId = null;
        }
        draggingAc = null;
        commitScene();
        return;
    }
    if (draggingPoint) {
        // 航路点拖动落位：原实现未持久化，此处修正
        draggingPoint = null;
        commitScene();
    }
});

/* ---------------- 双击打开对话框 ---------------- */

canvas.addEventListener('dblclick', e => {
    const coords = getCanvasCoords(e);
    const mx = toWorldX(coords.x), my = toWorldY(coords.y);
    let hitAc = null;
    state.aircraft.forEach(ac => {
        if (Math.sqrt((mx - posX(ac)) ** 2 + (my - posY(ac)) ** 2) < HIT.AIRCRAFT_DBL) hitAc = ac;
    });
    if (!hitAc) {
        state.aircraft.forEach(ac => {
            if (state.time < (ac.startTime || 0)) return;
            const labelOffsetX = ac.labelOffsetX !== undefined ? ac.labelOffsetX : 50;
            const labelOffsetY = ac.labelOffsetY !== undefined ? ac.labelOffsetY : -30;
            const lsx = toScreenX(ac.x + labelOffsetX), lsy = toScreenY(ac.y + labelOffsetY);
            if (coords.x >= lsx && coords.x <= lsx + HIT.LABEL_W &&
                coords.y >= lsy && coords.y <= lsy + HIT.LABEL_H) hitAc = ac;
        });
    }
    if (hitAc) {
        select({ type: 'aircraft', id: hitAc.id });
        openAircraftDialog(hitAc.id);
        return;
    }
    if (!isEditMode()) return;
    let hitPt = null;
    state.routePoints.forEach(pt => {
        if (Math.sqrt((mx - pt.x) ** 2 + (my - pt.y) ** 2) < HIT.POINT_DBL) hitPt = pt;
    });
    if (hitPt) {
        select({ type: 'point', id: hitPt.id });
        openPointDialog(hitPt.id);
        return;
    }
    let hitRoute = null;
    state.routes.forEach(route => { if (pointOnRoute(mx, my, route) < HIT.ROUTE_DBL) hitRoute = route; });
    if (hitRoute) {
        select({ type: 'route', id: hitRoute.id });
        openRouteDialog(hitRoute.id);
    }
});
