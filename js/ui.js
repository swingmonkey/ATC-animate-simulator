/**
 * ui.js — UI 更新、对话框与面板渲染
 * 不含事件监听（见 interactions.js），只提供可调用函数。
 */

import {
    state,
    pxToKmFixed,
    isEditMode,
} from './core.js';
import {
    saveBasePositions,
    updateAircraftPositionsForTime,
    getWaypointInfoForAircraft,
    getPositionAndTimeForWaypoint,
    pointToSegmentDist,
} from './simulation.js';

export function updateEditModeUI() {
    const playIndicator = document.getElementById('play-indicator');
    const addBtns = document.querySelectorAll('.add-btn, .edit-btn, .route-btn, .settings-btn, #tool-delete');
    const paletteItems = document.querySelectorAll('.draggable-item');

    if (state.isPlaying) {
        playIndicator.classList.remove('hidden');
        addBtns.forEach(btn => {
            btn.classList.add('edit-disabled');
            btn.style.pointerEvents = 'none';
        });
        paletteItems.forEach(item => {
            item.classList.add('edit-disabled');
            item.style.pointerEvents = 'none';
        });
    } else {
        playIndicator.classList.add('hidden');
        addBtns.forEach(btn => {
            btn.classList.remove('edit-disabled');
            btn.style.pointerEvents = '';
        });
        paletteItems.forEach(item => {
            item.classList.remove('edit-disabled');
            item.style.pointerEvents = '';
        });
    }
}

export function updateTimeDisplay() {
    const h = Math.floor(state.time / 3600).toString().padStart(2, '0');
    const m = Math.floor((state.time % 3600) / 60).toString().padStart(2, '0');
    const s = Math.floor(state.time % 60).toString().padStart(2, '0');
    document.getElementById('time-display').textContent = `${h}:${m}:${s}`;
    const slider = document.getElementById('time-slider');
    slider.max = state.defaults.timeMax;
    slider.value = state.time;
}

export function updateProgressList() {
    const container = document.getElementById('progress-list');
    const containerOverlay = document.getElementById('progress-list-overlay');
    container.innerHTML = '';
    if (containerOverlay) containerOverlay.innerHTML = '';

    state.aircraft.forEach(ac => {
        if (state.time < (ac.startTime || 0)) return;

        const div = document.createElement('div');
        div.className = 'progress-item';
        const route = ac.routeId ? state.routes.find(r => r.id === ac.routeId) : null;
        const navMode = ac.navMode || (ac.routeId ? 'route' : 'heading');
        let modeText = '';
        if (navMode === 'free' && ac.targetX !== undefined) {
            const x = ac.displayX !== undefined ? ac.displayX : ac.x;
            const y = ac.displayY !== undefined ? ac.displayY : ac.y;
            const distPx = Math.sqrt((ac.targetX - x) ** 2 + (ac.targetY - y) ** 2);
            modeText = ` | 🎯直飞(${pxToKmFixed(distPx).toFixed(1)}km)`;
        } else if (navMode === 'route') {
            const routeName = route ? route.name : '';
            modeText = ` | 🔗${routeName}`;
        } else {
            modeText = ` | 🧭航向${Math.round(ac.heading || 0)}°`;
        }
        const isSelected = state.selectedItem && state.selectedItem.type === 'aircraft' && state.selectedItem.id === ac.id;

        let waypointInfo = '';
        if (navMode === 'route' && route) {
            const wpInfo = getWaypointInfoForAircraft(ac);
            if (wpInfo) {
                waypointInfo = ` | ${wpInfo.nextPointName}(${wpInfo.distance}km)`;
            }
        }

        div.innerHTML = `
            <div class="flight-no" style="color:${isSelected ? '#006400' : '#1e40af'}">${ac.flightNo}${isSelected ? ' ✓' : ''}</div>
            <div class="info">${ac.departure} → ${ac.destination} | ${ac.altitude}m | ${ac.speed}kt${modeText}${waypointInfo}</div>
        `;
        if (isSelected) {
            div.style.borderLeftColor = '#006400';
            div.style.background = '#f0fff0';
        }
        div.style.cursor = 'pointer';
        div.addEventListener('click', () => {
            state.selectedItem = { type: 'aircraft', id: ac.id };
            updateModeIndicator();
            if (!state.isPlaying) {
                openAircraftDialog(ac.id);
            }
            updateProgressList();
        });
        container.appendChild(div);

        if (containerOverlay) {
            const div2 = div.cloneNode(true);
            div2.addEventListener('click', () => {
                state.selectedItem = { type: 'aircraft', id: ac.id };
                updateModeIndicator();
                if (!state.isPlaying) {
                    openAircraftDialog(ac.id);
                }
                updateProgressList();
            });
            containerOverlay.appendChild(div2);
        }
    });
}

export function updateCommTargetSelect() {
    const select = document.getElementById('comm-target');
    select.innerHTML = '<option value="atc">管制员广播</option>';
    state.aircraft.forEach(ac => {
        if (state.time < (ac.startTime || 0)) return;
        const opt = document.createElement('option');
        opt.value = ac.id;
        opt.textContent = ac.flightNo;
        select.appendChild(opt);
    });
}

export function addComm(sender, text) {
    const now = new Date(0);
    now.setSeconds(state.time);
    const timeStr = now.toTimeString().slice(0, 8);
    state.commMessages.push({ sender, text, time: timeStr });
    const container = document.getElementById('comm-messages');
    const div = document.createElement('div');
    div.className = `comm-msg ${sender}`;
    div.innerHTML = `<span class="comm-time">${timeStr}</span><span class="comm-label">${sender === 'atc' ? '[管制]' : `[${sender}]:`}</span> ${text}`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

export function updateModeIndicator() {
    const indicator = document.getElementById('mode-indicator');
    const hint = document.getElementById('connection-hint');
    if (state.routeConnectMode) {
        indicator.textContent = `模式：连接航路点 (${state.routeConnectPoints.length})`;
        indicator.style.background = '#e3f2fd';
        indicator.style.borderColor = '#64b5f6';
        indicator.style.color = '#1565c0';
        hint.classList.remove('hidden');
        hint.innerHTML = `点击航路点添加，已选: <span>${state.routeConnectPoints.map(id => state.routePoints.find(p => p.id === id)?.name || id).join(' → ')}</span>`;
    } else if (state.selectedItem) {
        if (state.selectedItem.type === 'aircraft') {
            const ac = state.aircraft.find(a => a.id === state.selectedItem.id);
            indicator.textContent = `已选飞机: ${ac?.flightNo || state.selectedItem.id}`;
            indicator.style.background = state.isPlaying ? '#dcfce7' : '#fff3e0';
            indicator.style.borderColor = state.isPlaying ? '#86efac' : '#ffb74d';
            indicator.style.color = state.isPlaying ? '#166534' : '#e65100';
        } else if (state.selectedItem.type === 'point') {
            const pt = state.routePoints.find(p => p.id === state.selectedItem.id);
            indicator.textContent = `已选航路点: ${pt?.name || state.selectedItem.id}`;
            indicator.style.background = '#fff3e0';
            indicator.style.borderColor = '#ffb74d';
            indicator.style.color = '#e65100';
        } else if (state.selectedItem.type === 'route') {
            const route = state.routes.find(r => r.id === state.selectedItem.id);
            indicator.textContent = `已选航线: ${route?.name || state.selectedItem.id}`;
            indicator.style.background = '#fff3e0';
            indicator.style.borderColor = '#ffb74d';
            indicator.style.color = '#e65100';
        }
        hint.classList.add('hidden');
    } else {
        indicator.textContent = '模式：选择 | 滚轮缩放 | ASWD移动';
        indicator.style.background = '#ffffff';
        indicator.style.borderColor = '#e2e8f0';
        indicator.style.color = '#475569';
        hint.classList.add('hidden');
    }
}

export function openPointDialog(ptId) {
    if (!isEditMode()) return;
    state.editingPointId = ptId;
    const pt = state.routePoints.find(p => p.id === ptId);
    if (!pt) return;
    document.getElementById('point-edit-dialog').classList.remove('hidden');
    document.getElementById('point-name').value = pt.name || '';
    document.getElementById('point-type').value = pt.type || 'normal';
    document.getElementById('point-x-display').textContent = Math.round(pt.x);
    document.getElementById('point-y-display').textContent = Math.round(pt.y);
}

export function updatePointDialogPosition() {
    if (!state.editingPointId) return;
    const pt = state.routePoints.find(p => p.id === state.editingPointId);
    if (pt) {
        document.getElementById('point-x-display').textContent = Math.round(pt.x);
        document.getElementById('point-y-display').textContent = Math.round(pt.y);
    }
}

export function openRouteDialog(routeId) {
    if (!isEditMode()) return;
    state.editingRouteId = routeId;
    const route = state.routes.find(r => r.id === routeId);
    if (!route) return;
    document.getElementById('route-edit-dialog').classList.remove('hidden');
    document.getElementById('route-name').value = route.name || '';
    document.getElementById('route-color').value = route.color || '#2563eb';
    document.getElementById('route-points-display').value = route.points.map(p => p.name || `P${p.id}`).join(' → ');
}

export function buildNextWaypointSelect(acId) {
    const select = document.getElementById('ac-next-waypoint');
    const previewDiv = document.getElementById('route-path-preview');
    if (!select) return;

    const ac = state.aircraft.find(a => a.id === acId);
    select.innerHTML = '<option value="">-- 选择下一航路点 --</option>';

    if (!ac || !ac.routeId) {
        if (previewDiv) previewDiv.innerHTML = '';
        return;
    }

    const route = state.routes.find(r => r.id === ac.routeId);
    if (!route || route.points.length < 2) {
        if (previewDiv) previewDiv.innerHTML = '';
        return;
    }

    const x = ac.displayX !== undefined ? ac.displayX : ac.x;
    const y = ac.displayY !== undefined ? ac.displayY : ac.y;

    let segIdx = 0, minSegDist = Infinity;
    for (let i = 1; i < route.points.length; i++) {
        const d = pointToSegmentDist(x, y, route.points[i - 1], route.points[i]);
        if (d < minSegDist) { minSegDist = d; segIdx = i - 1; }
    }

    const p1 = route.points[segIdx];
    const p2 = route.points[segIdx + 1];
    const prevIdx = segIdx > 0 ? segIdx - 1 : -1;
    const nextIdx = segIdx < route.points.length - 2 ? segIdx + 2 : -1;

    if (nextIdx >= 0) {
        const pt = route.points[nextIdx];
        const opt = document.createElement('option');
        opt.value = nextIdx;
        const ptName = pt.name || `P${pt.id}`;
        const distPx = Math.sqrt((pt.x - x) ** 2 + (pt.y - y) ** 2);
        const distKm = pxToKmFixed(distPx).toFixed(1);
        opt.textContent = `→ ${ptName} (后序点, ${distKm}km)`;
        opt.style.fontWeight = 'bold';
        select.appendChild(opt);
    }

    if (prevIdx >= 0) {
        const pt = route.points[prevIdx];
        const opt = document.createElement('option');
        opt.value = prevIdx;
        const ptName = pt.name || `P${pt.id}`;
        const distPx = Math.sqrt((pt.x - x) ** 2 + (pt.y - y) ** 2);
        const distKm = pxToKmFixed(distPx).toFixed(1);
        opt.textContent = `← ${ptName} (前序点, ${distKm}km)`;
        opt.style.fontWeight = 'bold';
        select.appendChild(opt);
    }

    const p1Name = p1.name || `P${p1.id}`;
    const p2Name = p2.name || `P${p2.id}`;
    const p1Dist = Math.sqrt((p1.x - x) ** 2 + (p1.y - y) ** 2);
    const p2Dist = Math.sqrt((p2.x - x) ** 2 + (p2.y - y) ** 2);

    {
        const opt = document.createElement('option');
        opt.value = segIdx;
        opt.textContent = `${p1Name} (当前段起点, ${pxToKmFixed(p1Dist).toFixed(1)}km)`;
        select.appendChild(opt);
    }

    {
        const opt = document.createElement('option');
        opt.value = segIdx + 1;
        opt.textContent = `${p2Name} (当前段终点, ${pxToKmFixed(p2Dist).toFixed(1)}km)`;
        select.appendChild(opt);
    }

    if ((nextIdx >= 0 || prevIdx >= 0) && route.points.length > 3) {
        const sepOpt = document.createElement('option');
        sepOpt.disabled = true;
        sepOpt.textContent = '─── 直飞到任意航路点 ───';
        select.appendChild(sepOpt);
    }

    route.points.forEach((pt, idx) => {
        if (idx === segIdx || idx === segIdx + 1 || idx === nextIdx || idx === prevIdx) return;
        const opt = document.createElement('option');
        opt.value = idx;
        const ptName = pt.name || `P${pt.id}`;
        const distPx = Math.sqrt((pt.x - x) ** 2 + (pt.y - y) ** 2);
        const distKm = pxToKmFixed(distPx).toFixed(1);
        opt.textContent = `• ${ptName} (${distKm}km)`;
        select.appendChild(opt);
    });

    const currentVal = ac.nextWaypointIdx !== undefined ? ac.nextWaypointIdx : '';
    if (currentVal !== '' && currentVal !== segIdx && currentVal !== segIdx + 1) {
        select.value = currentVal;
    }

    updateRoutePathPreview(ac);
}

export function updateRoutePathPreview(ac) {
    const previewDiv = document.getElementById('route-path-preview');
    if (!previewDiv || !ac || !ac.routeId) return;

    const route = state.routes.find(r => r.id === ac.routeId);
    if (!route) return;

    const nextIdx = parseInt(document.getElementById('ac-next-waypoint')?.value);
    if (isNaN(nextIdx)) {
        previewDiv.innerHTML = '<span style="color:#94a3b8;">请选择下一航路点以确定飞行方向</span>';
        return;
    }

    const x = ac.displayX !== undefined ? ac.displayX : ac.x;
    const y = ac.displayY !== undefined ? ac.displayY : ac.y;

    let segIdx = 0, minSegDist = Infinity;
    for (let i = 1; i < route.points.length; i++) {
        const d = pointToSegmentDist(x, y, route.points[i - 1], route.points[i]);
        if (d < minSegDist) { minSegDist = d; segIdx = i - 1; }
    }

    const nextPt = route.points[nextIdx];
    const distPx = Math.sqrt((nextPt.x - x) ** 2 + (nextPt.y - y) ** 2);
    const distKm = pxToKmFixed(distPx).toFixed(1);

    let remainingPoints = [];
    let nextNeighborIdx = -1;

    if (nextIdx === segIdx) {
        nextNeighborIdx = nextIdx - 1;
        if (nextNeighborIdx >= 0) {
            remainingPoints = route.points.slice(0, nextNeighborIdx + 1).reverse().map(p => p.name || `P${p.id}`);
        }
    } else if (nextIdx === segIdx + 1) {
        nextNeighborIdx = nextIdx + 1;
        if (nextNeighborIdx < route.points.length) {
            remainingPoints = route.points.slice(nextNeighborIdx).map(p => p.name || `P${p.id}`);
        }
    } else if (nextIdx > segIdx + 1) {
        nextNeighborIdx = nextIdx + 1;
        if (nextNeighborIdx < route.points.length) {
            remainingPoints = route.points.slice(nextNeighborIdx).map(p => p.name || `P${p.id}`);
        }
    } else {
        nextNeighborIdx = nextIdx - 1;
        if (nextNeighborIdx >= 0) {
            remainingPoints = route.points.slice(0, nextNeighborIdx + 1).reverse().map(p => p.name || `P${p.id}`);
        }
    }

    const nextNeighborName = nextNeighborIdx >= 0 && nextNeighborIdx < route.points.length
        ? (route.points[nextNeighborIdx].name || `P${route.points[nextNeighborIdx].id}`)
        : null;

    previewDiv.innerHTML = `
        <div style="color:#2563eb;">
            飞往: ${nextPt.name || `P${nextPt.id}`} | 距离: ${distKm}km
            ${nextNeighborName ? ` | 后续: ${nextNeighborName}` : ''}
        </div>
        <div style="color:#94a3b8;margin-top:2px;">
            路线: 当前位置 → ${nextPt.name || `P${nextPt.id}`}
            ${remainingPoints.length ? ' → ' + remainingPoints.join(' → ') : ' → (继续飞行)'}
        </div>
    `;
}

export function updateWaypointSelectOptions(acId) {
    const group = document.getElementById('waypoint-select-group');
    if (!group) return;

    const ac = state.aircraft.find(a => a.id === acId);

    if (!ac || !ac.routeId) {
        group.style.display = 'none';
        return;
    }

    group.style.display = 'block';
    buildNextWaypointSelect(acId);
}

export function openAircraftDialog(acId) {
    if (!isEditMode()) return;
    state.editingAircraftId = acId;
    const ac = state.aircraft.find(a => a.id === acId);
    if (!ac) return;
    document.getElementById('aircraft-edit-dialog').classList.remove('hidden');
    document.getElementById('ac-flight-no').value = ac.flightNo || '';
    document.getElementById('ac-squawk').value = ac.squawk || '';
    document.getElementById('ac-departure').value = ac.departure || '';
    document.getElementById('ac-destination').value = ac.destination || '';
    document.getElementById('ac-type').value = ac.acType || 'B738';
    document.getElementById('ac-altitude').value = ac.altitude || 10600;
    document.getElementById('ac-speed').value = ac.speed || '';
    document.getElementById('ac-heading').value = Math.round(ac.heading) || '';

    const navMode = ac.navMode || (ac.routeId ? 'route' : 'heading');
    document.getElementById('ac-nav-mode').value = navMode;
    updateNavModeUI(navMode);

    if (ac.targetX !== undefined && ac.targetY !== undefined) {
        document.getElementById('target-x').value = Math.round(ac.targetX);
        document.getElementById('target-y').value = Math.round(ac.targetY);
        updateTargetInfo(ac);
    }

    updateRouteSelectOptions();
    document.getElementById('ac-route').value = ac.routeId || '';
    updateWaypointSelectOptions(acId);
    updateWaypointInfo(ac);

    const askNextWpCheckbox = document.getElementById('ac-ask-next-waypoint');
    if (askNextWpCheckbox) {
        askNextWpCheckbox.checked = ac.askNextWaypoint || false;
    }

    const startTimeDisplay = document.getElementById('ac-start-time-display');
    if (startTimeDisplay) {
        const startTime = ac.startTime || 0;
        const hours = Math.floor(startTime / 3600);
        const minutes = Math.floor((startTime % 3600) / 60);
        const seconds = Math.floor(startTime % 60);
        startTimeDisplay.textContent = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
}

export function updateNavModeUI(mode) {
    const freeNavGroup = document.getElementById('free-nav-group');
    const routeGroup = document.getElementById('waypoint-select-group');
    if (mode === 'free') {
        freeNavGroup.style.display = '';
        routeGroup.style.display = 'none';
    } else if (mode === 'route') {
        freeNavGroup.style.display = 'none';
        routeGroup.style.display = '';
    } else {
        freeNavGroup.style.display = 'none';
        routeGroup.style.display = 'none';
    }
}

export function updateTargetInfo(ac) {
    const infoDiv = document.getElementById('target-info');
    if (!infoDiv || !ac) return;

    if (ac.targetX === undefined || ac.targetY === undefined) {
        infoDiv.innerHTML = '<span style="color:#94a3b8;">未设置目标点</span>';
        return;
    }

    const x = ac.displayX !== undefined ? ac.displayX : ac.x;
    const y = ac.displayY !== undefined ? ac.displayY : ac.y;
    const dx = ac.targetX - x;
    const dy = ac.targetY - y;
    const distPx = Math.sqrt(dx * dx + dy * dy);
    const distKm = pxToKmFixed(distPx);
    const heading = Math.atan2(dx, -dy) * 180 / Math.PI;
    const headingNorm = heading < 0 ? heading + 360 : heading;

    infoDiv.innerHTML = `<span style="color:#0369a1;">目标: (${Math.round(ac.targetX)}, ${Math.round(ac.targetY)}) | 距离: ${distKm.toFixed(1)}km | 航向: ${headingNorm.toFixed(0)}°</span>`;
}

export function updateWaypointInfo(ac) {
    const infoDiv = document.getElementById('waypoint-info');
    if (!infoDiv) return;

    if (!ac || !ac.routeId) {
        infoDiv.innerHTML = '';
        return;
    }

    const route = state.routes.find(r => r.id === ac.routeId);
    if (!route) return;

    const x = ac.displayX !== undefined ? ac.displayX : ac.x;
    const y = ac.displayY !== undefined ? ac.displayY : ac.y;

    let minDist = Infinity, currentIdx = 0;
    for (let i = 0; i < route.points.length; i++) {
        const dx = route.points[i].x - x, dy = route.points[i].y - y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < minDist) { minDist = d; currentIdx = i; }
    }

    const info = getPositionAndTimeForWaypoint(ac, currentIdx);
    if (!info) {
        infoDiv.innerHTML = '';
        return;
    }

    const pt = route.points[currentIdx];
    const ptName = pt.name || `P${pt.id}`;

    if (info.timeToReach >= 0) {
        infoDiv.innerHTML = `<div style="font-size:11px;color:#16a34a;margin-top:4px;">
            <strong>当前: ${ptName}</strong> | 距离: ${info.distance}km | 到达: ${info.timeToReach}秒<br>
            <span style="color:#64748b;">速度: ${ac.speed}kt | 航向: ${Math.round(ac.heading || 90)}°</span>
        </div>`;
    } else {
        infoDiv.innerHTML = `<div style="font-size:11px;color:#ea580c;margin-top:4px;">
            <strong>${ptName}</strong> - 已通过 (距离: ${Math.abs(info.distance)}km)
        </div>`;
    }
}

export function showNextWaypointDialog(ac, currentWaypointIdx) {
    const route = state.routes.find(r => r.id === ac.routeId);
    if (!route || route.points.length < 2) return;

    const dialog = document.getElementById('next-waypoint-dialog');
    const select = document.getElementById('next-waypoint-select');
    const currentNameDiv = document.getElementById('current-waypoint-name');
    const previewDiv = document.getElementById('next-waypoint-preview');

    const currentPt = route.points[currentWaypointIdx];
    currentNameDiv.textContent = currentPt.name || `P${currentPt.id}`;

    select.innerHTML = '<option value="">-- 请选择 --</option>';

    route.points.forEach((pt, idx) => {
        if (idx === currentWaypointIdx) return;

        const opt = document.createElement('option');
        opt.value = idx;
        const ptName = pt.name || `P${pt.id}`;

        let label = '';
        if (idx === currentWaypointIdx - 1) label = ' (前序点)';
        else if (idx === currentWaypointIdx + 1) label = ' (后序点)';

        const distPx = Math.sqrt((pt.x - currentPt.x) ** 2 + (pt.y - currentPt.y) ** 2);
        const distKm = pxToKmFixed(distPx).toFixed(1);

        opt.textContent = `${ptName}${label} - ${distKm}km`;
        select.appendChild(opt);
    });

    if (currentWaypointIdx + 1 < route.points.length) {
        select.value = currentWaypointIdx + 1;
    } else if (currentWaypointIdx - 1 >= 0) {
        select.value = currentWaypointIdx - 1;
    }

    updateNextWaypointPreview(ac, currentWaypointIdx, select.value);

    select.onchange = function() {
        updateNextWaypointPreview(ac, currentWaypointIdx, this.value);
    };

    state.pendingNextWaypointSelection = {
        aircraftId: ac.id,
        currentWaypointIdx: currentWaypointIdx
    };

    dialog.classList.remove('hidden');
    if (state.isPlaying) {
        state.isPausedForWaypointSelection = true;
        togglePlayPause();
    }
}

export function updateNextWaypointPreview(ac, currentIdx, nextIdx) {
    const previewDiv = document.getElementById('next-waypoint-preview');
    const route = state.routes.find(r => r.id === ac.routeId);

    if (!nextIdx || !route) {
        previewDiv.innerHTML = '<span style="color:#94a3b8;">请选择下一航路点</span>';
        return;
    }

    const nextIdxNum = parseInt(nextIdx);
    const nextPt = route.points[nextIdxNum];
    const currentPt = route.points[currentIdx];
    const distPx = Math.sqrt((nextPt.x - currentPt.x) ** 2 + (nextPt.y - currentPt.y) ** 2);
    const distKm = pxToKmFixed(distPx).toFixed(1);

    let directionText = '';
    if (nextIdxNum < currentIdx) directionText = '← 向前序点飞行';
    else if (nextIdxNum > currentIdx) directionText = '→ 向后序点飞行';

    previewDiv.innerHTML = `
        <div><strong>下一目标:</strong> ${nextPt.name || `P${nextPt.id}`}</div>
        <div><strong>距离:</strong> ${distKm}km</div>
        <div style="color:#2563eb;">${directionText}</div>
    `;
}

export function sendComm() {
    const input = document.getElementById('comm-input');
    const text = input.value.trim();
    if (!text) return;
    const target = document.getElementById('comm-target').value;
    if (target === 'atc') {
        addComm('atc', text);
        processCommand(text);
    } else {
        const ac = state.aircraft.find(a => a.id === parseInt(target));
        if (ac) {
            addComm('atc', `→${ac.flightNo}: ${text}`);
            addComm(ac.flightNo, `收到指令：${text}`);
        }
    }
    input.value = '';
}

export function processCommand(text) {
    const lower = text.toLowerCase();
    if (lower.includes('加速') || lower.includes('增加速度')) {
        state.aircraft.forEach(ac => { if (state.time >= (ac.startTime || 0)) ac.speed = Math.min(600, (ac.speed || 480) + 20); });
        addComm('atc', '所有飞机速度增加20kt');
    } else if (lower.includes('减速') || lower.includes('减小速度')) {
        state.aircraft.forEach(ac => { if (state.time >= (ac.startTime || 0)) ac.speed = Math.max(200, (ac.speed || 480) - 20); });
        addComm('atc', '所有飞机速度减少20kt');
    } else if (lower.includes('上升') || lower.includes('爬升')) {
        state.aircraft.forEach(ac => { if (state.time >= (ac.startTime || 0)) ac.altitude = Math.min(15000, (ac.altitude || 10600) + 600); });
        addComm('atc', '所有飞机上升600m');
    } else if (lower.includes('下降')) {
        state.aircraft.forEach(ac => { if (state.time >= (ac.startTime || 0)) ac.altitude = Math.max(3000, (ac.altitude || 10600) - 600); });
        addComm('atc', '所有飞机下降600m');
    }
}

import { POINT_COLORS } from './render.js';

export function addPointPanelItem(pt) {
    const list = document.getElementById('route-points-list');
    const item = document.createElement('div');
    item.className = 'panel-item';
    item.dataset.pointId = pt.id;
    const color = POINT_COLORS[pt.type] || POINT_COLORS.normal;
    item.innerHTML = `
        <span style="width:10px;height:10px;background:${color};border-radius:50%;display:inline-block;border:2px solid white;box-shadow:0 0 2px ${color};"></span>
        <span style="flex:1;font-size:12px;color:#1e293b;font-weight:600;">${pt.name}</span>
    `;
    item.style.cursor = 'pointer';
    item.addEventListener('click', () => {
        if (!isEditMode()) return;
        state.selectedItem = { type: 'point', id: pt.id };
        updateModeIndicator();
        openPointDialog(pt.id);
    });
    list.appendChild(item);
}

export function updatePointPanelList() {
    const list = document.getElementById('route-points-list');
    list.innerHTML = '';
    state.routePoints.forEach(pt => addPointPanelItem(pt));
}

export function addRoutePanelItem(route) {
    const list = document.getElementById('route-list');
    const item = document.createElement('div');
    item.className = 'panel-item';
    item.dataset.routeId = route.id;
    item.innerHTML = `
        <span style="width:16px;height:2px;background:${route.color};display:inline-block;border-radius:1px;"></span>
        <span style="flex:1;font-size:12px;color:#1e293b;font-weight:600;">${route.name}</span>
    `;
    item.style.cursor = 'pointer';
    item.addEventListener('click', () => {
        if (!isEditMode()) return;
        state.selectedItem = { type: 'route', id: route.id };
        updateModeIndicator();
        openRouteDialog(route.id);
    });
    list.appendChild(item);
}

export function updateRoutePanelList() {
    const list = document.getElementById('route-list');
    list.innerHTML = '';
    state.routes.forEach(route => addRoutePanelItem(route));
}

export function addAircraftPanelItem(ac) {
    const list = document.getElementById('aircraft-list');
    const item = document.createElement('div');
    item.className = 'panel-item';
    item.dataset.aircraftId = ac.id;
    const isSelected = state.selectedItem && state.selectedItem.type === 'aircraft' && state.selectedItem.id === ac.id;
    item.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16"><polygon points="12,2 22,22 12,17 2,22" fill="${isSelected ? '#006400' : '#1a1a2e'}" stroke="${isSelected ? '#228b22' : '#64748b'}" stroke-width="1"/></svg>
        <span style="flex:1;font-size:12px;color:${isSelected ? '#006400' : '#1e293b'};font-weight:600;">${ac.flightNo}</span>
    `;
    item.style.cursor = 'pointer';
    item.addEventListener('click', () => {
        if (!isEditMode()) return;
        state.selectedItem = { type: 'aircraft', id: ac.id };
        updateModeIndicator();
        updateProgressList();
        openAircraftDialog(ac.id);
    });
    list.appendChild(item);
}

export function updateAircraftPanelList() {
    const list = document.getElementById('aircraft-list');
    list.innerHTML = '';
    state.aircraft.forEach(ac => addAircraftPanelItem(ac));
}

export function updateRouteSelectOptions() {
    const select = document.getElementById('ac-route');
    select.innerHTML = '<option value="">无（自由飞行）</option>';
    state.routes.forEach(route => {
        const opt = document.createElement('option');
        opt.value = route.id;
        opt.textContent = route.name || `航线${route.id}`;
        select.appendChild(opt);
    });
}

export function togglePlayPause() {
    state.isPlaying = !state.isPlaying;
    document.getElementById('play-pause-btn').textContent = state.isPlaying ? '⏸ 暂停' : '▶ 播放';

    if (state.isPlaying) {
        saveBasePositions();
        updateAircraftPositionsForTime(state.time);
        updateProgressList();
    } else {
        saveBasePositions();
    }

    updateEditModeUI();
    updateModeIndicator();

    if (!state.isPlaying) {
        document.querySelectorAll('.dialog:not(.hidden)').forEach(d => d.classList.add('hidden'));
    }
}
