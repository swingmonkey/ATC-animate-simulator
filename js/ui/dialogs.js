/**
 * ui/dialogs.js — 对话框与模式指示（界面层）
 */

import { state, pxToKmFixed, isEditMode } from '../core.js';
import {
    pointToSegmentDist, getWaypointInfoForAircraft, getPositionAndTimeForWaypoint
} from '../simulation/index.js';
import { addComm } from '../comm.js';
import { togglePlayPause } from './indicators.js';

export function updateModeIndicator() {
    const indicator = document.getElementById('mode-indicator');
    const hint = document.getElementById('connection-hint');
    if (!indicator) return;
    if (state.routeConnectMode) {
        indicator.textContent = `模式：连接航路点 (${state.routeConnectPoints.length})`;
        indicator.style.background = '#e3f2fd';
        indicator.style.borderColor = '#64b5f6';
        indicator.style.color = '#1565c0';
        if (hint) {
            hint.classList.remove('hidden');
            hint.innerHTML = `点击航路点添加，已选: <span>${state.routeConnectPoints.map(id => state.routePoints.find(p => p.id === id)?.name || id).join(' → ')}</span>`;
        }
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
        if (hint) hint.classList.add('hidden');
    } else {
        indicator.textContent = '模式：选择 | 滚轮缩放 | ASWD移动';
        indicator.style.background = '#ffffff';
        indicator.style.borderColor = '#e2e8f0';
        indicator.style.color = '#475569';
        if (hint) hint.classList.add('hidden');
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
    if (!ac || !ac.routeId) { if (previewDiv) previewDiv.innerHTML = ''; return; }
    const route = state.routes.find(r => r.id === ac.routeId);
    if (!route || route.points.length < 2) { if (previewDiv) previewDiv.innerHTML = ''; return; }

    const x = ac.displayX !== undefined ? ac.displayX : ac.x;
    const y = ac.displayY !== undefined ? ac.displayY : ac.y;
    let segIdx = 0, minSegDist = Infinity;
    for (let i = 1; i < route.points.length; i++) {
        const d = pointToSegmentDist(x, y, route.points[i - 1], route.points[i]);
        if (d < minSegDist) { minSegDist = d; segIdx = i - 1; }
    }
    const p1 = route.points[segIdx], p2 = route.points[segIdx + 1];
    const prevIdx = segIdx > 0 ? segIdx - 1 : -1;
    const nextIdx = segIdx < route.points.length - 2 ? segIdx + 2 : -1;
    if (nextIdx >= 0) {
        const pt = route.points[nextIdx];
        const opt = document.createElement('option');
        opt.value = nextIdx;
        opt.textContent = `→ ${pt.name || `P${pt.id}`} (后序点, ${pxToKmFixed(Math.sqrt((pt.x - x) ** 2 + (pt.y - y) ** 2)).toFixed(1)}km)`;
        opt.style.fontWeight = 'bold';
        select.appendChild(opt);
    }
    if (prevIdx >= 0) {
        const pt = route.points[prevIdx];
        const opt = document.createElement('option');
        opt.value = prevIdx;
        opt.textContent = `← ${pt.name || `P${pt.id}`} (前序点, ${pxToKmFixed(Math.sqrt((pt.x - x) ** 2 + (pt.y - y) ** 2)).toFixed(1)}km)`;
        opt.style.fontWeight = 'bold';
        select.appendChild(opt);
    }
    {
        const opt = document.createElement('option');
        opt.value = segIdx;
        opt.textContent = `${p1.name || `P${p1.id}`} (当前段起点, ${pxToKmFixed(Math.sqrt((p1.x - x) ** 2 + (p1.y - y) ** 2)).toFixed(1)}km)`;
        select.appendChild(opt);
    }
    {
        const opt = document.createElement('option');
        opt.value = segIdx + 1;
        opt.textContent = `${p2.name || `P${p2.id}`} (当前段终点, ${pxToKmFixed(Math.sqrt((p2.x - x) ** 2 + (p2.y - y) ** 2)).toFixed(1)}km)`;
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
        opt.textContent = `• ${pt.name || `P${pt.id}`} (${pxToKmFixed(Math.sqrt((pt.x - x) ** 2 + (pt.y - y) ** 2)).toFixed(1)}km)`;
        select.appendChild(opt);
    });
    const currentVal = ac.nextWaypointIdx !== undefined ? ac.nextWaypointIdx : '';
    if (currentVal !== '' && currentVal !== segIdx && currentVal !== segIdx + 1) select.value = currentVal;
    updateRoutePathPreview(ac);
}

export function updateRoutePathPreview(ac) {
    const previewDiv = document.getElementById('route-path-preview');
    if (!previewDiv || !ac || !ac.routeId) return;
    const route = state.routes.find(r => r.id === ac.routeId);
    if (!route) return;
    const nextIdx = parseInt(document.getElementById('ac-next-waypoint')?.value);
    if (isNaN(nextIdx)) { previewDiv.innerHTML = '<span style="color:#94a3b8;">请选择下一航路点以确定飞行方向</span>'; return; }
    const x = ac.displayX !== undefined ? ac.displayX : ac.x;
    const y = ac.displayY !== undefined ? ac.displayY : ac.y;
    let segIdx = 0, minSegDist = Infinity;
    for (let i = 1; i < route.points.length; i++) {
        const d = pointToSegmentDist(x, y, route.points[i - 1], route.points[i]);
        if (d < minSegDist) { minSegDist = d; segIdx = i - 1; }
    }
    const nextPt = route.points[nextIdx];
    const distKm = pxToKmFixed(Math.sqrt((nextPt.x - x) ** 2 + (nextPt.y - y) ** 2)).toFixed(1);
    let remainingPoints = [], nextNeighborIdx = -1;
    if (nextIdx === segIdx) { nextNeighborIdx = nextIdx - 1; if (nextNeighborIdx >= 0) remainingPoints = route.points.slice(0, nextNeighborIdx + 1).reverse().map(p => p.name || `P${p.id}`); }
    else if (nextIdx === segIdx + 1) { nextNeighborIdx = nextIdx + 1; if (nextNeighborIdx < route.points.length) remainingPoints = route.points.slice(nextNeighborIdx).map(p => p.name || `P${p.id}`); }
    else if (nextIdx > segIdx + 1) { nextNeighborIdx = nextIdx + 1; if (nextNeighborIdx < route.points.length) remainingPoints = route.points.slice(nextNeighborIdx).map(p => p.name || `P${p.id}`); }
    else { nextNeighborIdx = nextIdx - 1; if (nextNeighborIdx >= 0) remainingPoints = route.points.slice(0, nextNeighborIdx + 1).reverse().map(p => p.name || `P${p.id}`); }
    const nextNeighborName = nextNeighborIdx >= 0 && nextNeighborIdx < route.points.length ? (route.points[nextNeighborIdx].name || `P${route.points[nextNeighborIdx].id}`) : null;
    previewDiv.innerHTML = `
        <div style="color:#2563eb;">飞往: ${nextPt.name || `P${nextPt.id}`} | 距离: ${distKm}km ${nextNeighborName ? ` | 后续: ${nextNeighborName}` : ''}</div>
        <div style="color:#94a3b8;margin-top:2px;">路线: 当前位置 → ${nextPt.name || `P${nextPt.id}`} ${remainingPoints.length ? ' → ' + remainingPoints.join(' → ') : ' → (继续飞行)'}</div>`;
}

export function updateWaypointSelectOptions(acId) {
    const group = document.getElementById('waypoint-select-group');
    if (!group) return;
    const ac = state.aircraft.find(a => a.id === acId);
    if (!ac || !ac.routeId) { group.style.display = 'none'; return; }
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
    document.getElementById('ac-altitude').value = ac.displayAltitude ?? ac.altitude ?? 10600;
    document.getElementById('ac-speed').value = ac.displaySpeed ?? ac.speed ?? '';
    document.getElementById('ac-heading').value = Math.round(ac.displayHeading ?? ac.heading) || '';
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
    if (askNextWpCheckbox) askNextWpCheckbox.checked = ac.askNextWaypoint || false;
    const startTimeDisplay = document.getElementById('ac-start-time-display');
    if (startTimeDisplay) {
        const t = ac.startTime || 0;
        startTimeDisplay.textContent = `${Math.floor(t / 3600).toString().padStart(2, '0')}:${Math.floor((t % 3600) / 60).toString().padStart(2, '0')}:${Math.floor(t % 60).toString().padStart(2, '0')}`;
    }
}

export function updateNavModeUI(mode) {
    const freeNavGroup = document.getElementById('free-nav-group');
    const routeGroup = document.getElementById('waypoint-select-group');
    if (mode === 'free') { if (freeNavGroup) freeNavGroup.style.display = ''; if (routeGroup) routeGroup.style.display = 'none'; }
    else if (mode === 'route') { if (freeNavGroup) freeNavGroup.style.display = 'none'; if (routeGroup) routeGroup.style.display = ''; }
    else { if (freeNavGroup) freeNavGroup.style.display = 'none'; if (routeGroup) routeGroup.style.display = 'none'; }
}

export function updateTargetInfo(ac) {
    const infoDiv = document.getElementById('target-info');
    if (!infoDiv || !ac) return;
    if (ac.targetX === undefined || ac.targetY === undefined) { infoDiv.innerHTML = '<span style="color:#94a3b8;">未设置目标点</span>'; return; }
    const x = ac.displayX !== undefined ? ac.displayX : ac.x;
    const y = ac.displayY !== undefined ? ac.displayY : ac.y;
    const dx = ac.targetX - x, dy = ac.targetY - y;
    const distKm = pxToKmFixed(Math.sqrt(dx * dx + dy * dy));
    const heading = Math.atan2(dx, -dy) * 180 / Math.PI;
    const headingNorm = heading < 0 ? heading + 360 : heading;
    infoDiv.innerHTML = `<span style="color:#0369a1;">目标: (${Math.round(ac.targetX)}, ${Math.round(ac.targetY)}) | 距离: ${distKm.toFixed(1)}km | 航向: ${headingNorm.toFixed(0)}°</span>`;
}

export function updateWaypointInfo(ac) {
    const infoDiv = document.getElementById('waypoint-info');
    if (!infoDiv) return;
    if (!ac || !ac.routeId) { infoDiv.innerHTML = ''; return; }
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
    if (!info) { infoDiv.innerHTML = ''; return; }
    const pt = route.points[currentIdx];
    const ptName = pt.name || `P${pt.id}`;
    if (info.timeToReach >= 0) {
        infoDiv.innerHTML = `<div style="font-size:11px;color:#16a34a;margin-top:4px;"><strong>当前: ${ptName}</strong> | 距离: ${info.distance}km | 到达: ${info.timeToReach}秒<br><span style="color:#64748b;">速度: ${ac.displaySpeed ?? ac.speed}kt | 航向: ${Math.round(ac.displayHeading ?? ac.heading ?? 90)}°</span></div>`;
    } else {
        infoDiv.innerHTML = `<div style="font-size:11px;color:#ea580c;margin-top:4px;"><strong>${ptName}</strong> - 已通过 (距离: ${Math.abs(info.distance)}km)</div>`;
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
        opt.textContent = `${ptName}${label} - ${pxToKmFixed(distPx).toFixed(1)}km`;
        select.appendChild(opt);
    });
    if (currentWaypointIdx + 1 < route.points.length) select.value = currentWaypointIdx + 1;
    else if (currentWaypointIdx - 1 >= 0) select.value = currentWaypointIdx - 1;
    updateNextWaypointPreview(ac, currentWaypointIdx, select.value);
    select.onchange = function () { updateNextWaypointPreview(ac, currentWaypointIdx, this.value); };
    state.pendingNextWaypointSelection = { aircraftId: ac.id, currentWaypointIdx };
    dialog.classList.remove('hidden');
    if (state.isPlaying) { state.isPausedForWaypointSelection = true; togglePlayPause(); }
}

export function updateNextWaypointPreview(ac, currentIdx, nextIdx) {
    const previewDiv = document.getElementById('next-waypoint-preview');
    const route = state.routes.find(r => r.id === ac.routeId);
    if (!nextIdx || !route) { previewDiv.innerHTML = '<span style="color:#94a3b8;">请选择下一航路点</span>'; return; }
    const nextIdxNum = parseInt(nextIdx);
    const nextPt = route.points[nextIdxNum];
    const currentPt = route.points[currentIdx];
    const distKm = pxToKmFixed(Math.sqrt((nextPt.x - currentPt.x) ** 2 + (nextPt.y - currentPt.y) ** 2)).toFixed(1);
    let directionText = '';
    if (nextIdxNum < currentIdx) directionText = '← 向前序点飞行';
    else if (nextIdxNum > currentIdx) directionText = '→ 向后序点飞行';
    previewDiv.innerHTML = `
        <div><strong>下一目标:</strong> ${nextPt.name || `P${nextPt.id}`}</div>
        <div><strong>距离:</strong> ${distKm}km</div>
        <div style="color:#2563eb;">${directionText}</div>`;
}
