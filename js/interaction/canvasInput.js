/**
 * interaction/canvasInput.js — 画布鼠标输入（输入层）
 * 缩放、平移跟随、选择、拖拽航路点/飞机、标签、双击与右键打开对话框。
 */

import {
    state, canvas, centerX, centerY, viewScale, canvasWidth, canvasHeight,
    viewOffsetX, viewOffsetY, toWorldX, toWorldY, toScreenX, toScreenY,
    isEditMode, getCanvasCoords, setViewScale, keysPressed,
    draggingPoint, draggingAc, labelFollowMouse, tempMeasureLine,
    setDraggingPoint, setDraggingAc, setLabelFollowMouse,
    setDragPointOffset, setDragAcOffset, setTempMeasureLine, saveState
} from '../core.js';
import { setViewOffsetXY } from './view.js';
import {
    updateAircraftPositionsForTime, pointOnRoute, getPositionOnRoute, saveBasePositions
} from '../simulation/index.js';
import {
    updatePointDialogPosition, updateModeIndicator, updateProgressList,
    openAircraftDialog, openPointDialog, openRouteDialog, updateTargetInfo
} from '../ui/index.js';
import { addComm } from '../comm.js';

/* ---------------- 缩放 ---------------- */

canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(0.2, Math.min(5, viewScale * delta));
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const worldX = toWorldX(mouseX);
    const worldY = toWorldY(mouseY);
    setViewScale(newScale);
    const newOffsetX = mouseX - canvasWidth / 2 - (worldX - centerX) * newScale;
    const newOffsetY = mouseY - canvasHeight / 2 - (worldY - centerY) * newScale;
    setViewOffsetXY(newOffsetX, newOffsetY);
}, { passive: false });

/* ---------------- 鼠标移动 ---------------- */

canvas.addEventListener('mousemove', e => {
    const coords = getCanvasCoords(e);
    state.mousePos = coords;

    if (state.targetSelectMode) {
        state.tempTargetPoint = { x: toWorldX(coords.x), y: toWorldY(coords.y) };
    }
    if (draggingPoint && isEditMode()) {
        draggingPoint.x = toWorldX(coords.x);
        draggingPoint.y = toWorldY(coords.y);
        updatePointDialogPosition();
    }
    if (draggingAc && isEditMode()) {
        draggingAc.x = toWorldX(coords.x);
        draggingAc.y = toWorldY(coords.y);
        draggingAc.displayX = draggingAc.x;
        draggingAc.displayY = draggingAc.y;
    }
    if (state.draggingLabelAc) {
        const ac = state.draggingLabelAc;
        const acX = toWorldX(coords.x), acY = toWorldY(coords.y);
        ac.labelOffsetX = acX - ac.x;
        ac.labelOffsetY = acY - ac.y;
    }
    if (labelFollowMouse) {
        const ac = labelFollowMouse;
        const acX = ac.displayX !== undefined ? ac.displayX : ac.x;
        const acY = ac.displayY !== undefined ? ac.displayY : ac.y;
        const mouseWorldX = toWorldX(coords.x), mouseWorldY = toWorldY(coords.y);
        const angle = Math.atan2(mouseWorldY - acY, mouseWorldX - acX);
        const angleStep = 30 * Math.PI / 180;
        const snappedAngle = Math.round(angle / angleStep) * angleStep;
        const dx = mouseWorldX - acX, dy = mouseWorldY - acY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const maxOffsetWorld = 80 / viewScale;
        const clampedDist = Math.min(dist, maxOffsetWorld);
        ac.labelOffsetX = Math.cos(snappedAngle) * clampedDist;
        ac.labelOffsetY = Math.sin(snappedAngle) * clampedDist;
    }
    if (tempMeasureLine) {
        tempMeasureLine.x2 = toWorldX(coords.x);
        tempMeasureLine.y2 = toWorldY(coords.y);
    }
});

canvas.addEventListener('mouseleave', () => { state.mousePos = null; });

canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (labelFollowMouse) setLabelFollowMouse(null);
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
            document.getElementById('target-x').value = Math.round(mx);
            document.getElementById('target-y').value = Math.round(my);
            updateTargetInfo(ac);
        }
        state.targetSelectMode = null;
        state.tempTargetPoint = null;
        const btn = document.getElementById('select-target-btn');
        if (btn) { btn.style.background = ''; btn.style.color = ''; }
        updateModeIndicator();
        return;
    }

    const coords = getCanvasCoords(e);
    const mx = toWorldX(coords.x), my = toWorldY(coords.y);

    if (!isEditMode()) {
        let hitAc = null;
        state.aircraft.forEach(ac => {
            if (state.time < (ac.startTime || 0)) return;
            const x = ac.displayX !== undefined ? ac.displayX : ac.x;
            const y = ac.displayY !== undefined ? ac.displayY : ac.y;
            if (Math.sqrt((mx - x) ** 2 + (my - y) ** 2) < 22) hitAc = ac;
        });
        state.selectedItem = hitAc ? { type: 'aircraft', id: hitAc.id } : null;
        updateModeIndicator();
        updateProgressList();
        return;
    }

    if (state.routeConnectMode) {
        state.routePoints.forEach(pt => {
            if (Math.sqrt((mx - pt.x) ** 2 + (my - pt.y) ** 2) < 12) {
                if (!state.routeConnectPoints.includes(pt.id)) {
                    state.routeConnectPoints.push(pt.id);
                    updateModeIndicator();
                }
            }
        });
        return;
    }

    let hitPt = null;
    state.routePoints.forEach(pt => { if (Math.sqrt((mx - pt.x) ** 2 + (my - pt.y) ** 2) < 10) hitPt = pt; });
    if (hitPt) {
        state.selectedItem = { type: 'point', id: hitPt.id };
        setDraggingPoint(hitPt);
        setDragPointOffset(mx - hitPt.x, my - hitPt.y);
        updateModeIndicator();
        return;
    }

    let hitAc = null;
    state.aircraft.forEach(ac => {
        if (state.time < (ac.startTime || 0)) return;
        const x = ac.displayX !== undefined ? ac.displayX : ac.x;
        const y = ac.displayY !== undefined ? ac.displayY : ac.y;
        if (Math.sqrt((mx - x) ** 2 + (my - y) ** 2) < 22) hitAc = ac;
    });
    if (hitAc) {
        state.selectedItem = { type: 'aircraft', id: hitAc.id };
        setDraggingAc(hitAc);
        setDragAcOffset(mx - (hitAc.displayX !== undefined ? hitAc.displayX : hitAc.x), my - (hitAc.displayY !== undefined ? hitAc.displayY : hitAc.y));
        updateModeIndicator();
        updateProgressList();
        return;
    }

    let hitLabel = null;
    state.aircraft.forEach(ac => {
        const labelOffsetX = ac.labelOffsetX !== undefined ? ac.labelOffsetX : 50;
        const labelOffsetY = ac.labelOffsetY !== undefined ? ac.labelOffsetY : -30;
        const labelScreenX = toScreenX(ac.x + labelOffsetX);
        const labelScreenY = toScreenY(ac.y + labelOffsetY);
        if (coords.x >= labelScreenX && coords.x <= labelScreenX + 80 && coords.y >= labelScreenY && coords.y <= labelScreenY + 54) hitLabel = ac;
    });
    if (hitLabel) {
        state.selectedItem = { type: 'aircraft', id: hitLabel.id };
        state.draggingLabelAc = hitLabel;
        setLabelFollowMouse(null);
        updateModeIndicator();
        updateProgressList();
        return;
    }

    let hitRoute = null;
    state.routes.forEach(route => { if (pointOnRoute(mx, my, route) < 12) hitRoute = route; });
    if (hitRoute) {
        state.selectedItem = { type: 'route', id: hitRoute.id };
        setLabelFollowMouse(null);
        updateModeIndicator();
        return;
    }

    state.selectedItem = null;
    setLabelFollowMouse(null);
    updateModeIndicator();
    updateProgressList();
});

/* ---------------- 鼠标抬起（关联航线） ---------------- */

canvas.addEventListener('mouseup', e => {
    if (state.draggingLabelAc) state.draggingLabelAc = null;
    if (draggingAc) {
        if (!isEditMode()) { setDraggingAc(null); return; }
        const coords = getCanvasCoords(e);
        const mx = toWorldX(coords.x), my = toWorldY(coords.y);
        let nearestRoute = null, minD = Infinity;
        state.routes.forEach(route => { const d = pointOnRoute(mx, my, route); if (d < minD) { minD = d; nearestRoute = route; } });
        if (nearestRoute && minD < 30) {
            const posOnRoute = getPositionOnRoute(mx, my, nearestRoute);
            draggingAc.routeId = nearestRoute.id;
            draggingAc.routeDistance = posOnRoute.dist;
            draggingAc.x = posOnRoute.x;
            draggingAc.y = posOnRoute.y;
            draggingAc.displayX = posOnRoute.x;
            draggingAc.displayY = posOnRoute.y;
            const segIdx = posOnRoute.segIdx;
            const p1 = nearestRoute.points[segIdx];
            const p2 = nearestRoute.points[segIdx + 1] || p1;
            draggingAc.heading = Math.atan2(p2.x - p1.x, -(p2.y - p1.y)) * 180 / Math.PI;
            if (draggingAc.heading < 0) draggingAc.heading += 360;
            draggingAc.trail = [];
            addComm('atc', `${draggingAc.flightNo} 已关联航线 ${nearestRoute.name}`);
        } else {
            draggingAc.routeId = null;
        }
        setDraggingAc(null);
        saveState();
    }
    setDraggingPoint(null);
});

/* ---------------- 双击 / 右键 ---------------- */

canvas.addEventListener('dblclick', e => {
    const coords = getCanvasCoords(e);
    const mx = toWorldX(coords.x), my = toWorldY(coords.y);
    let hitAc = null;
    state.aircraft.forEach(ac => { if (Math.sqrt((mx - ac.x) ** 2 + (my - ac.y) ** 2) < 18) hitAc = ac; });
    if (!hitAc) {
        state.aircraft.forEach(ac => {
            if (state.time < (ac.startTime || 0)) return;
            const labelOffsetX = ac.labelOffsetX !== undefined ? ac.labelOffsetX : 50;
            const labelOffsetY = ac.labelOffsetY !== undefined ? ac.labelOffsetY : -30;
            const lsx = toScreenX(ac.x + labelOffsetX), lsy = toScreenY(ac.y + labelOffsetY);
            if (coords.x >= lsx && coords.x <= lsx + 80 && coords.y >= lsy && coords.y <= lsy + 54) hitAc = ac;
        });
    }
    if (hitAc) {
        state.selectedItem = { type: 'aircraft', id: hitAc.id };
        updateModeIndicator();
        updateProgressList();
        openAircraftDialog(hitAc.id);
        return;
    }
    if (isEditMode()) {
        let hitPt = null;
        state.routePoints.forEach(pt => { if (Math.sqrt((mx - pt.x) ** 2 + (my - pt.y) ** 2) < 10) hitPt = pt; });
        if (hitPt) { state.selectedItem = { type: 'point', id: hitPt.id }; openPointDialog(hitPt.id); return; }
        let hitRoute = null;
        state.routes.forEach(route => { if (pointOnRoute(mx, my, route) < 8) hitRoute = route; });
        if (hitRoute) { state.selectedItem = { type: 'route', id: hitRoute.id }; openRouteDialog(hitRoute.id); }
    }
});

canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (!isEditMode()) return;
    const coords = getCanvasCoords(e);
    const mx = toWorldX(coords.x), my = toWorldY(coords.y);
    state.aircraft.forEach(ac => {
        if (Math.sqrt((mx - ac.x) ** 2 + (my - ac.y) ** 2) < 18) {
            state.selectedItem = { type: 'aircraft', id: ac.id };
            updateModeIndicator();
            updateProgressList();
            openAircraftDialog(ac.id);
        }
    });
    if (!state.selectedItem || state.selectedItem.type !== 'aircraft') {
        state.routePoints.forEach(pt => {
            if (Math.sqrt((mx - pt.x) ** 2 + (my - pt.y) ** 2) < 10) {
                state.selectedItem = { type: 'point', id: pt.id };
                openPointDialog(pt.id);
            }
        });
    }
});
