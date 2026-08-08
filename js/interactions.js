/**
 * interactions.js — 事件监听绑定
 * 画布鼠标/键盘交互、拖放、工具栏与对话框按钮。
 */

import {
    state,
    canvas,
    centerX,
    centerY,
    viewScale,
    canvasWidth,
    canvasHeight,
    toWorldX,
    toWorldY,
    toScreenX,
    toScreenY,
    isEditMode,
    getCanvasCoords,
    setViewScale,
    setViewOffset,
    keysPressed,
    draggingPoint,
    draggingAc,
    labelFollowMouse,
    tempMeasureLine,
    setDraggingPoint,
    setDraggingAc,
    setLabelFollowMouse,
    setDragPointOffset,
    setDragAcOffset,
    saveState,
} from './core.js';
import {
    saveBasePositions,
    updateAircraftPositionsForTime,
    pointOnRoute,
    getPositionOnRoute,
} from './simulation.js';
import {
    updateEditModeUI,
    updateTimeDisplay,
    updateProgressList,
    updateCommTargetSelect,
    addComm,
    updateModeIndicator,
    openPointDialog,
    updatePointDialogPosition,
    openRouteDialog,
    buildNextWaypointSelect,
    updateRoutePathPreview,
    updateWaypointSelectOptions,
    openAircraftDialog,
    updateNavModeUI,
    updateTargetInfo,
    updateWaypointInfo,
    showNextWaypointDialog,
    updateNextWaypointPreview,
    sendComm,
    addPointPanelItem,
    updatePointPanelList,
    addRoutePanelItem,
    updateRoutePanelList,
    addAircraftPanelItem,
    updateAircraftPanelList,
    updateRouteSelectOptions,
    togglePlayPause,
} from './ui.js';

/* ---------------- 键盘 ---------------- */

document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    keysPressed[e.key.toLowerCase()] = true;

    if (e.key === 'Escape') {
        document.querySelectorAll('.dialog:not(.hidden)').forEach(d => d.classList.add('hidden'));
        if (state.routeConnectMode) {
            state.routeConnectMode = false;
            state.routeConnectPoints = [];
            document.getElementById('add-route-btn').classList.remove('active');
        }
        state.selectedItem = null;
        setLabelFollowMouse(null);
        updateModeIndicator();
        updateProgressList();
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && isEditMode()) {
        if (document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'SELECT') {
            document.getElementById('tool-delete').click();
        }
    }
    if (e.key === ' ') {
        if (document.activeElement.tagName !== 'INPUT') {
            e.preventDefault();
            document.getElementById('play-pause-btn').click();
        }
    }
});

document.addEventListener('keyup', e => {
    keysPressed[e.key.toLowerCase()] = false;
});

function handleKeyboardMovement() {
    const step = 20;
    let dx = 0, dy = 0;
    if (keysPressed['w'] || keysPressed['arrowup']) dy += step;
    if (keysPressed['s'] || keysPressed['arrowdown']) dy -= step;
    if (keysPressed['a'] || keysPressed['arrowleft']) dx += step;
    if (keysPressed['d'] || keysPressed['arrowright']) dx -= step;
    if (dx !== 0 || dy !== 0) {
        moveView(dx, dy);
    }
}

// 视图偏移缓存在此模块（保持 core 中只读导出，偏移更新统一走 setViewOffset）
let viewOffsetX = 0;
let viewOffsetY = 0;

export function moveView(dx, dy) {
    viewOffsetX += dx;
    viewOffsetY += dy;
    setViewOffset(viewOffsetX, viewOffsetY);
}

export function getViewOffset() {
    return { x: viewOffsetX, y: viewOffsetY };
}

export function setViewOffsetXY(x, y) {
    viewOffsetX = x;
    viewOffsetY = y;
    setViewOffset(x, y);
}

setInterval(handleKeyboardMovement, 16);

/* ---------------- 画布事件 ---------------- */

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
        const acX = toWorldX(coords.x);
        const acY = toWorldY(coords.y);
        ac.labelOffsetX = acX - ac.x;
        ac.labelOffsetY = acY - ac.y;
    }
    if (labelFollowMouse) {
        const ac = labelFollowMouse;
        const acX = ac.displayX !== undefined ? ac.displayX : ac.x;
        const acY = ac.displayY !== undefined ? ac.displayY : ac.y;
        const mouseWorldX = toWorldX(coords.x);
        const mouseWorldY = toWorldY(coords.y);

        const maxOffsetPx = 80;
        const maxOffsetWorld = maxOffsetPx / viewScale;

        const angle = Math.atan2(mouseWorldY - acY, mouseWorldX - acX);
        const angleStep = 30 * Math.PI / 180;
        const snappedAngle = Math.round(angle / angleStep) * angleStep;

        const dx = mouseWorldX - acX;
        const dy = mouseWorldY - acY;
        const dist = Math.sqrt(dx * dx + dy * dy);
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
    if (labelFollowMouse) {
        setLabelFollowMouse(null);
    }
});

canvas.addEventListener('mousedown', e => {
    if (e.button !== 0) return;

    if (state.targetSelectMode) {
        const coords = getCanvasCoords(e);
        const mx = toWorldX(coords.x);
        const my = toWorldY(coords.y);
        const ac = state.aircraft.find(a => a.id === state.targetSelectMode);
        if (ac) {
            ac.targetX = mx;
            ac.targetY = my;
            ac.navMode = 'free';
            document.getElementById('target-x').value = Math.round(mx);
            document.getElementById('target-y').value = Math.round(my);
            updateTargetInfo(ac);
        }
        state.targetSelectMode = null;
        state.tempTargetPoint = null;
        document.getElementById('select-target-btn').style.background = '';
        document.getElementById('select-target-btn').style.color = '';
        updateModeIndicator();
        return;
    }

    const coords = getCanvasCoords(e);
    const mx = toWorldX(coords.x);
    const my = toWorldY(coords.y);

    if (!isEditMode()) {
        let hitAc = null;
        state.aircraft.forEach(ac => {
            if (state.time < (ac.startTime || 0)) return;
            const x = ac.displayX !== undefined ? ac.displayX : ac.x;
            const y = ac.displayY !== undefined ? ac.displayY : ac.y;
            if (Math.sqrt((mx - x) ** 2 + (my - y) ** 2) < 22) hitAc = ac;
        });
        if (hitAc) {
            state.selectedItem = { type: 'aircraft', id: hitAc.id };
            updateModeIndicator();
            updateProgressList();
        } else {
            state.selectedItem = null;
            updateModeIndicator();
            updateProgressList();
        }
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
    state.routePoints.forEach(pt => {
        if (Math.sqrt((mx - pt.x) ** 2 + (my - pt.y) ** 2) < 10) hitPt = pt;
    });
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
        const labelWorldX = ac.x + labelOffsetX;
        const labelWorldY = ac.y + labelOffsetY;
        const labelScreenX = toScreenX(labelWorldX);
        const labelScreenY = toScreenY(labelWorldY);
        const boxW = 80, boxH = 54;
        if (coords.x >= labelScreenX && coords.x <= labelScreenX + boxW &&
            coords.y >= labelScreenY && coords.y <= labelScreenY + boxH) {
            hitLabel = ac;
        }
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
    state.routes.forEach(route => {
        if (pointOnRoute(mx, my, route) < 12) hitRoute = route;
    });
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

canvas.addEventListener('mouseup', e => {
    if (state.draggingLabelAc) {
        state.draggingLabelAc = null;
    }
    if (draggingAc) {
        if (!isEditMode()) {
            setDraggingAc(null);
            return;
        }
        const coords = getCanvasCoords(e);
        const mx = toWorldX(coords.x);
        const my = toWorldY(coords.y);
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

canvas.addEventListener('dblclick', e => {
    const coords = getCanvasCoords(e);
    const mx = toWorldX(coords.x);
    const my = toWorldY(coords.y);

    let hitAc = null;
    state.aircraft.forEach(ac => {
        if (Math.sqrt((mx - ac.x) ** 2 + (my - ac.y) ** 2) < 18) hitAc = ac;
    });

    if (!hitAc) {
        state.aircraft.forEach(ac => {
            if (state.time < (ac.startTime || 0)) return;
            const labelOffsetX = ac.labelOffsetX !== undefined ? ac.labelOffsetX : 50;
            const labelOffsetY = ac.labelOffsetY !== undefined ? ac.labelOffsetY : -30;
            const labelScreenX = toScreenX(ac.x + labelOffsetX);
            const labelScreenY = toScreenY(ac.y + labelOffsetY);
            const boxW = 80, boxH = 54;
            if (coords.x >= labelScreenX && coords.x <= labelScreenX + boxW &&
                coords.y >= labelScreenY && coords.y <= labelScreenY + boxH) {
                hitAc = ac;
            }
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
        state.routePoints.forEach(pt => {
            if (Math.sqrt((mx - pt.x) ** 2 + (my - pt.y) ** 2) < 10) hitPt = pt;
        });
        if (hitPt) {
            state.selectedItem = { type: 'point', id: hitPt.id };
            openPointDialog(hitPt.id);
            return;
        }

        let hitRoute = null;
        state.routes.forEach(route => {
            if (pointOnRoute(mx, my, route) < 8) hitRoute = route;
        });
        if (hitRoute) {
            state.selectedItem = { type: 'route', id: hitRoute.id };
            openRouteDialog(hitRoute.id);
        }
    }
});

canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (!isEditMode()) return;
    const coords = getCanvasCoords(e);
    const mx = toWorldX(coords.x);
    const my = toWorldY(coords.y);
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

/* ---------------- 拖放 ---------------- */

const radarContainer = document.getElementById('radar-container');

radarContainer.addEventListener('dragover', e => {
    e.preventDefault();
    if (!isEditMode()) return;
    e.dataTransfer.dropEffect = 'copy';
    radarContainer.classList.add('drag-over');
});

radarContainer.addEventListener('dragleave', e => {
    radarContainer.classList.remove('drag-over');
});

radarContainer.addEventListener('drop', e => {
    e.preventDefault();
    radarContainer.classList.remove('drag-over');
    if (!isEditMode()) return;

    const type = e.dataTransfer.getData('text/type');
    const subType = e.dataTransfer.getData('text/subtype');
    const rect = canvas.getBoundingClientRect();
    const x = toWorldX(e.clientX - rect.left);
    const y = toWorldY(e.clientY - rect.top);

    if (type === 'point') {
        const newPt = {
            id: Date.now(),
            name: `P${state.pointNameCounter++}`,
            x: x,
            y: y,
            type: subType || 'normal'
        };
        state.routePoints.push(newPt);
        addPointPanelItem(newPt);
        addComm('atc', `航路点 ${newPt.name} 已创建`);
    } else if (type === 'aircraft') {
        const newAc = {
            id: Date.now(),
            x: x,
            y: y,
            displayX: x,
            displayY: y,
            flightNo: `CA${Math.floor(Math.random() * 9000) + 1000}`,
            squawk: state.defaults.squawk,
            departure: 'ZBAA',
            destination: 'ZSSS',
            acType: state.defaults.acType,
            altitude: state.defaults.altitude,
            speed: state.defaults.speed,
            heading: 90,
            routeId: null,
            routeDistance: 0,
            startTime: state.time,
            trail: [],
            labelOffsetX: 18,
            labelOffsetY: -14
        };
        state.aircraft.push(newAc);
        addAircraftPanelItem(newAc);
        updateCommTargetSelect();
        addComm('pilot', `${newAc.flightNo} 呼叫，高度${newAc.altitude}m，速度${newAc.speed}kt`);
        addComm('atc', `${newAc.flightNo} 雷达识别，自由飞行`);
        state.selectedItem = { type: 'aircraft', id: newAc.id };
        updateModeIndicator();
        updateProgressList();
    }
    saveState();
});

document.querySelectorAll('.draggable-item').forEach(item => {
    item.addEventListener('dragstart', e => {
        if (!isEditMode()) {
            e.preventDefault();
            return;
        }
        const type = item.dataset.type;
        const subType = item.dataset.pointType || '';

        e.dataTransfer.setData('text/type', type);
        e.dataTransfer.setData('text/subtype', subType);
        e.dataTransfer.effectAllowed = 'copy';

        state.isDraggingFromPalette = true;
        state.paletteDragType = type;
        state.paletteDragSubType = subType;
    });

    item.addEventListener('dragend', e => {
        state.isDraggingFromPalette = false;
        state.paletteDragType = null;
        state.paletteDragSubType = null;
    });
});

/* ---------------- 工具栏按钮 ---------------- */

document.getElementById('add-point-btn').addEventListener('click', () => {
    if (!isEditMode()) return;
    const newPt = {
        id: Date.now(),
        name: `P${state.pointNameCounter++}`,
        x: centerX + (Math.random() - 0.5) * 200,
        y: centerY + (Math.random() - 0.5) * 200,
        type: 'normal'
    };
    state.routePoints.push(newPt);
    addPointPanelItem(newPt);
    addComm('atc', `航路点 ${newPt.name} 已创建`);
    saveState();
});

document.getElementById('edit-point-btn').addEventListener('click', () => {
    if (!isEditMode()) return;
    if (state.selectedItem && state.selectedItem.type === 'point') {
        openPointDialog(state.selectedItem.id);
    } else if (state.routePoints.length > 0) {
        state.selectedItem = { type: 'point', id: state.routePoints[0].id };
        updateModeIndicator();
        openPointDialog(state.selectedItem.id);
    }
});

document.getElementById('add-route-btn').addEventListener('click', () => {
    if (!isEditMode()) return;
    if (state.routeConnectMode) {
        if (state.routeConnectPoints.length >= 2) {
            const route = {
                id: Date.now(),
                name: `航线${state.routes.length + 1}`,
                points: state.routeConnectPoints.map(id => state.routePoints.find(p => p.id === id)),
                color: '#2563eb'
            };
            state.routes.push(route);
            addRoutePanelItem(route);
            addComm('atc', `航线 ${route.name} 已建立，共 ${route.points.length} 个航路点`);
            saveState();
        }
        state.routeConnectMode = false;
        state.routeConnectPoints = [];
        document.getElementById('add-route-btn').classList.remove('active');
        updateModeIndicator();
    } else {
        state.routeConnectMode = true;
        state.routeConnectPoints = [];
        document.getElementById('add-route-btn').classList.add('active');
        updateModeIndicator();
    }
});

document.getElementById('add-aircraft-btn').addEventListener('click', () => {
    if (!isEditMode()) return;
    const newAc = {
        id: Date.now(),
        x: centerX + (Math.random() - 0.5) * 150,
        y: centerY + (Math.random() - 0.5) * 150,
        displayX: centerX + (Math.random() - 0.5) * 150,
        displayY: centerY + (Math.random() - 0.5) * 150,
        flightNo: `CA${Math.floor(Math.random() * 9000) + 1000}`,
        squawk: state.defaults.squawk,
        departure: 'ZBAA',
        destination: 'ZSSS',
        acType: state.defaults.acType,
        altitude: state.defaults.altitude,
        speed: state.defaults.speed,
        heading: 90,
        routeId: null,
        routeDistance: 0,
        startTime: state.time,
        trail: [],
        labelOffsetX: 18,
        labelOffsetY: -14
    };
    state.aircraft.push(newAc);
    addAircraftPanelItem(newAc);
    updateCommTargetSelect();
    addComm('pilot', `${newAc.flightNo} 呼叫，高度${newAc.altitude}m，速度${newAc.speed}kt`);
    addComm('atc', `${newAc.flightNo} 雷达识别，自由飞行`);
    state.selectedItem = { type: 'aircraft', id: newAc.id };
    updateModeIndicator();
    updateProgressList();
    saveState();
});

/* ---------------- 对话框按钮 ---------------- */

document.getElementById('save-point').addEventListener('click', () => {
    if (!state.editingPointId) return;
    const pt = state.routePoints.find(p => p.id === state.editingPointId);
    if (!pt) return;
    pt.name = document.getElementById('point-name').value.trim() || pt.name;
    pt.type = document.getElementById('point-type').value;
    document.getElementById('point-edit-dialog').classList.add('hidden');
    updatePointPanelList();
    updateRoutePanelList();
    saveState();
});

document.getElementById('delete-point-btn').addEventListener('click', () => {
    if (!state.editingPointId) return;
    const pt = state.routePoints.find(p => p.id === state.editingPointId);
    state.routePoints = state.routePoints.filter(p => p.id !== state.editingPointId);
    state.routes = state.routes.filter(r => !r.points.some(p => p.id === state.editingPointId));
    state.selectedItem = null;
    document.getElementById('point-edit-dialog').classList.add('hidden');
    updatePointPanelList();
    updateRoutePanelList();
    updateModeIndicator();
    if (pt) addComm('atc', `航路点 ${pt.name} 已删除`);
    saveState();
});

document.getElementById('save-route').addEventListener('click', () => {
    if (!state.editingRouteId) return;
    const route = state.routes.find(r => r.id === state.editingRouteId);
    if (!route) return;
    route.name = document.getElementById('route-name').value.trim() || route.name;
    route.color = document.getElementById('route-color').value;
    document.getElementById('route-edit-dialog').classList.add('hidden');
    updateRoutePanelList();
    saveState();
});

document.getElementById('delete-route-btn').addEventListener('click', () => {
    if (!state.editingRouteId) return;
    state.routes = state.routes.filter(r => r.id !== state.editingRouteId);
    state.aircraft.forEach(ac => {
        if (ac.routeId === state.editingRouteId) {
            ac.routeId = null;
            addComm('atc', `${ac.flightNo} 航线已删除，改为自由飞行`);
        }
    });
    state.selectedItem = null;
    document.getElementById('route-edit-dialog').classList.add('hidden');
    updateRoutePanelList();
    updateModeIndicator();
    saveState();
});

document.getElementById('ac-next-waypoint')?.addEventListener('change', function() {
    if (!state.editingAircraftId) return;
    const ac = state.aircraft.find(a => a.id === state.editingAircraftId);
    if (ac) {
        ac.nextWaypointIdx = this.value !== '' ? parseInt(this.value) : undefined;
        updateRoutePathPreview(ac);
    }
});

document.getElementById('confirm-next-waypoint')?.addEventListener('click', function() {
    const select = document.getElementById('next-waypoint-select');
    const nextIdx = parseInt(select.value);

    if (isNaN(nextIdx)) {
        alert('请选择下一航路点');
        return;
    }

    if (state.pendingNextWaypointSelection) {
        const ac = state.aircraft.find(a => a.id === state.pendingNextWaypointSelection.aircraftId);
        if (ac) {
            ac.nextWaypointIdx = nextIdx;
            saveBasePositions();
        }
        state.pendingNextWaypointSelection = null;
    }

    document.getElementById('next-waypoint-dialog').classList.add('hidden');

    if (state.isPausedForWaypointSelection) {
        state.isPausedForWaypointSelection = false;
        togglePlayPause();
    }
    saveState();
});

document.querySelectorAll('#next-waypoint-dialog .dialog-close').forEach(btn => {
    btn.addEventListener('click', function() {
        if (state.isPausedForWaypointSelection) {
            state.isPausedForWaypointSelection = false;
            state.pendingNextWaypointSelection = null;
            togglePlayPause();
        }
    });
});

document.getElementById('ac-route')?.addEventListener('change', function() {
    if (!state.editingAircraftId) return;
    const ac = state.aircraft.find(a => a.id === state.editingAircraftId);
    if (!ac) return;
    const routeId = this.value;
    if (routeId) {
        ac.routeId = parseInt(routeId);
        ac.routeDistance = 0;
    } else {
        ac.routeId = null;
    }
    updateWaypointSelectOptions(state.editingAircraftId);
    updateWaypointInfo(ac);
});

document.getElementById('ac-nav-mode')?.addEventListener('change', function() {
    if (!state.editingAircraftId) return;
    const ac = state.aircraft.find(a => a.id === state.editingAircraftId);
    if (!ac) return;
    ac.navMode = this.value;
    updateNavModeUI(this.value);
    if (this.value !== 'free') {
        ac.targetX = undefined;
        ac.targetY = undefined;
    }
});

document.getElementById('select-target-btn')?.addEventListener('click', function() {
    if (!state.editingAircraftId) return;
    state.targetSelectMode = state.editingAircraftId;
    this.style.background = '#0369a1';
    this.style.color = 'white';
    document.getElementById('mode-indicator').textContent = '🎯 点击地图选择目标点...';
    document.getElementById('mode-indicator').style.background = '#e0f2fe';
    document.getElementById('mode-indicator').style.borderColor = '#7dd3fc';
    document.getElementById('mode-indicator').style.color = '#0369a1';
});

document.getElementById('input-target-coords-btn')?.addEventListener('click', function() {
    const coordsInput = document.getElementById('target-coords-input');
    coordsInput.style.display = coordsInput.style.display === 'none' ? '' : 'none';
});

document.getElementById('confirm-target-btn')?.addEventListener('click', function() {
    if (!state.editingAircraftId) return;
    const ac = state.aircraft.find(a => a.id === state.editingAircraftId);
    if (!ac) return;
    const tx = parseFloat(document.getElementById('target-x').value);
    const ty = parseFloat(document.getElementById('target-y').value);
    if (!isNaN(tx) && !isNaN(ty)) {
        ac.targetX = tx;
        ac.targetY = ty;
        ac.navMode = 'free';
        updateTargetInfo(ac);
    }
});

document.getElementById('save-aircraft').addEventListener('click', () => {
    if (!state.editingAircraftId) return;
    const ac = state.aircraft.find(a => a.id === state.editingAircraftId);
    if (!ac) return;
    ac.flightNo = document.getElementById('ac-flight-no').value.trim() || ac.flightNo;
    ac.squawk = document.getElementById('ac-squawk').value.trim();
    ac.departure = document.getElementById('ac-departure').value.trim();
    ac.destination = document.getElementById('ac-destination').value.trim();
    ac.acType = document.getElementById('ac-type').value.trim();
    ac.altitude = parseInt(document.getElementById('ac-altitude').value) || ac.altitude;
    ac.speed = parseInt(document.getElementById('ac-speed').value) || ac.speed;
    ac.heading = parseFloat(document.getElementById('ac-heading').value) || ac.heading;
    ac.navMode = document.getElementById('ac-nav-mode').value || 'heading';

    const nextWpVal = document.getElementById('ac-next-waypoint')?.value;
    if (nextWpVal !== '' && nextWpVal !== undefined && nextWpVal !== null) {
        ac.nextWaypointIdx = parseInt(nextWpVal);
    }

    if (ac.navMode === 'free') {
        const tx = parseFloat(document.getElementById('target-x').value);
        const ty = parseFloat(document.getElementById('target-y').value);
        if (!isNaN(tx) && !isNaN(ty)) {
            ac.targetX = tx;
            ac.targetY = ty;
        }
        ac.routeId = null;
    }
    const routeId = document.getElementById('ac-route').value;
    if (routeId && ac.navMode !== 'free') {
        ac.routeId = parseInt(routeId);
        ac.routeDistance = 0;
    } else if (ac.navMode !== 'free') {
        ac.routeId = null;
    }

    const askNextWpCheckbox = document.getElementById('ac-ask-next-waypoint');
    ac.askNextWaypoint = askNextWpCheckbox ? askNextWpCheckbox.checked : false;

    saveBasePositions();
    document.getElementById('aircraft-edit-dialog').classList.add('hidden');
    updateAircraftPanelList();
    updateProgressList();
    updateCommTargetSelect();
    saveState();
});

document.getElementById('delete-aircraft-btn').addEventListener('click', () => {
    if (!state.editingAircraftId) return;
    state.aircraft = state.aircraft.filter(a => a.id !== state.editingAircraftId);
    state.connections = state.connections.filter(c => c.from !== state.editingAircraftId && c.to !== state.editingAircraftId);
    state.selectedItem = null;
    document.getElementById('aircraft-edit-dialog').classList.add('hidden');
    updateAircraftPanelList();
    updateProgressList();
    updateCommTargetSelect();
    updateModeIndicator();
    saveState();
});

document.getElementById('comm-send-btn').addEventListener('click', sendComm);
document.getElementById('comm-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') sendComm();
});

/* ---------------- 播放控制 ---------------- */

document.getElementById('play-pause-btn').addEventListener('click', () => {
    togglePlayPause();
});

document.getElementById('time-slider').addEventListener('input', e => {
    const newTime = parseInt(e.target.value);
    state.time = newTime;
    updateTimeDisplay();
    updateAircraftPositionsForTime(newTime);
});

document.getElementById('speed-select').addEventListener('change', e => {
    state.timeSpeed = parseInt(e.target.value);
});

document.getElementById('tool-delete').addEventListener('click', () => {
    if (!isEditMode() || !state.selectedItem) return;
    const { type, id } = state.selectedItem;
    if (type === 'aircraft') {
        state.aircraft = state.aircraft.filter(a => a.id !== id);
        state.connections = state.connections.filter(c => c.from !== id && c.to !== id);
        updateAircraftPanelList();
        updateProgressList();
        updateCommTargetSelect();
    } else if (type === 'point') {
        state.routePoints = state.routePoints.filter(p => p.id !== id);
        state.routes = state.routes.filter(r => !r.points.some(p => p.id === id));
        updatePointPanelList();
        updateRoutePanelList();
    } else if (type === 'route') {
        state.routes = state.routes.filter(r => r.id !== id);
        state.aircraft.forEach(ac => { if (ac.routeId === id) { ac.routeId = null; } });
        updateRoutePanelList();
        updateProgressList();
    }
    state.selectedItem = null;
    updateModeIndicator();
    updateProgressList();
    saveState();
});

document.getElementById('help-btn').addEventListener('click', () => {
    document.getElementById('help-dialog').classList.remove('hidden');
});

document.getElementById('settings-btn').addEventListener('click', () => {
    if (!isEditMode()) return;
    document.getElementById('settings-dialog').classList.remove('hidden');
    document.getElementById('def-altitude').value = state.defaults.altitude;
    document.getElementById('def-speed').value = state.defaults.speed;
    document.getElementById('def-ac-type').value = state.defaults.acType;
    document.getElementById('def-squawk').value = state.defaults.squawk;
    document.getElementById('def-grid-spacing').value = state.defaults.gridSpacing;
    document.getElementById('min-separation-nm').value = state.defaults.minSeparationNm;
    document.getElementById('time-max-mins').value = Math.round(state.defaults.timeMax / 60);
});

document.getElementById('save-settings').addEventListener('click', () => {
    state.defaults.altitude = parseInt(document.getElementById('def-altitude').value) || 10600;
    state.defaults.speed = parseInt(document.getElementById('def-speed').value) || 480;
    state.defaults.acType = document.getElementById('def-ac-type').value || 'B738';
    state.defaults.squawk = document.getElementById('def-squawk').value || '2000';
    state.defaults.gridSpacing = parseInt(document.getElementById('def-grid-spacing').value) || 50;
    state.defaults.minSeparationNm = parseInt(document.getElementById('min-separation-nm').value) || 15;
    state.defaults.timeMax = parseInt(document.getElementById('time-max-mins').value) * 60 || 2400;
    if (state.time > state.defaults.timeMax) state.time = 0;
    document.getElementById('settings-dialog').classList.add('hidden');
    updateTimeDisplay();
    addComm('atc', '默认参数已更新');
    saveState();
});

document.querySelectorAll('.dialog-close').forEach(btn => {
    btn.addEventListener('click', () => { btn.closest('.dialog').classList.add('hidden'); });
});
