/**
 * ui/dialogs.js — 对话框（界面层）
 * 航路点/航线/飞机编辑对话框与下一航路点选择。
 * 模式指示 updateModeIndicator 已迁至 indicators.js（消除 indicators⇄dialogs 循环依赖）。
 * 所有插入用户文本（航路点名/航线名）处经 escapeHtml 转义。
 */

import { state, isEditMode, setPlaying } from '../core/store.js';
import { pxToKmFixed } from '../core/viewport.js';
import { escapeHtml } from '../core/dom.js';
import {
    pointToSegmentDist, getWaypointInfoForAircraft, getPositionAndTimeForWaypoint,
    clearanceText, referenceAirportCode, unitOfAircraft
} from '../simulation/index.js';
import { unit } from '../data/atcUnits.js';
import { runwayList, runwayEnd } from '../data/airports.js';

/** 飞机对话框：航线选择下拉（原 indicators.js，唯一调用方为 openAircraftDialog，就近内聚） */
function updateRouteSelectOptions() {
    const select = document.getElementById('ac-route');
    if (!select) return;
    select.innerHTML = '<option value="">无（自由飞行）</option>';
    state.routes.forEach(route => {
        const opt = document.createElement('option');
        opt.value = route.id;
        opt.textContent = route.name || `航线${route.id}`;
        select.appendChild(opt);
    });
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
    document.getElementById('route-points-display').value =
        route.points.map(p => p.name || `P${p.id}`).join(' → ');
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

    const x = ac.displayX ?? ac.x;
    const y = ac.displayY ?? ac.y;
    let segIdx = 0, minSegDist = Infinity;
    for (let i = 1; i < route.points.length; i++) {
        const d = pointToSegmentDist(x, y, route.points[i - 1], route.points[i]);
        if (d < minSegDist) { minSegDist = d; segIdx = i - 1; }
    }
    const p1 = route.points[segIdx], p2 = route.points[segIdx + 1];
    const prevIdx = segIdx > 0 ? segIdx - 1 : -1;
    const nextIdx = segIdx < route.points.length - 2 ? segIdx + 2 : -1;
    const addOpt = (value, text, bold = false) => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = text;
        if (bold) opt.style.fontWeight = 'bold';
        select.appendChild(opt);
        return opt;
    };
    if (nextIdx >= 0) {
        const pt = route.points[nextIdx];
        addOpt(nextIdx, `→ ${pt.name || `P${pt.id}`} (后序点, ${pxToKmFixed(Math.sqrt((pt.x - x) ** 2 + (pt.y - y) ** 2)).toFixed(1)}km)`, true);
    }
    if (prevIdx >= 0) {
        const pt = route.points[prevIdx];
        addOpt(prevIdx, `← ${pt.name || `P${pt.id}`} (前序点, ${pxToKmFixed(Math.sqrt((pt.x - x) ** 2 + (pt.y - y) ** 2)).toFixed(1)}km)`, true);
    }
    addOpt(segIdx, `${p1.name || `P${p1.id}`} (当前段起点, ${pxToKmFixed(Math.sqrt((p1.x - x) ** 2 + (p1.y - y) ** 2)).toFixed(1)}km)`);
    addOpt(segIdx + 1, `${p2.name || `P${p2.id}`} (当前段终点, ${pxToKmFixed(Math.sqrt((p2.x - x) ** 2 + (p2.y - y) ** 2)).toFixed(1)}km)`);
    if ((nextIdx >= 0 || prevIdx >= 0) && route.points.length > 3) {
        const sepOpt = document.createElement('option');
        sepOpt.disabled = true;
        sepOpt.textContent = '─── 直飞到任意航路点 ───';
        select.appendChild(sepOpt);
    }
    route.points.forEach((pt, idx) => {
        if (idx === segIdx || idx === segIdx + 1 || idx === nextIdx || idx === prevIdx) return;
        addOpt(idx, `• ${pt.name || `P${pt.id}`} (${pxToKmFixed(Math.sqrt((pt.x - x) ** 2 + (pt.y - y) ** 2)).toFixed(1)}km)`);
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
    if (isNaN(nextIdx)) {
        previewDiv.innerHTML = '<span style="color:#94a3b8;">请选择下一航路点以确定飞行方向</span>';
        return;
    }
    const x = ac.displayX ?? ac.x;
    const y = ac.displayY ?? ac.y;
    let segIdx = 0, minSegDist = Infinity;
    for (let i = 1; i < route.points.length; i++) {
        const d = pointToSegmentDist(x, y, route.points[i - 1], route.points[i]);
        if (d < minSegDist) { minSegDist = d; segIdx = i - 1; }
    }
    const nextPt = route.points[nextIdx];
    if (!nextPt) return;
    const distKm = pxToKmFixed(Math.sqrt((nextPt.x - x) ** 2 + (nextPt.y - y) ** 2)).toFixed(1);
    let remainingPoints = [], nextNeighborIdx = -1;
    if (nextIdx === segIdx) {
        nextNeighborIdx = nextIdx - 1;
        if (nextNeighborIdx >= 0) remainingPoints = route.points.slice(0, nextNeighborIdx + 1).reverse().map(p => p.name || `P${p.id}`);
    } else if (nextIdx === segIdx + 1) {
        nextNeighborIdx = nextIdx + 1;
        if (nextNeighborIdx < route.points.length) remainingPoints = route.points.slice(nextNeighborIdx).map(p => p.name || `P${p.id}`);
    } else if (nextIdx > segIdx + 1) {
        nextNeighborIdx = nextIdx + 1;
        if (nextNeighborIdx < route.points.length) remainingPoints = route.points.slice(nextNeighborIdx).map(p => p.name || `P${p.id}`);
    } else {
        nextNeighborIdx = nextIdx - 1;
        if (nextNeighborIdx >= 0) remainingPoints = route.points.slice(0, nextNeighborIdx + 1).reverse().map(p => p.name || `P${p.id}`);
    }
    const nextNeighborName = nextNeighborIdx >= 0 && nextNeighborIdx < route.points.length
        ? (route.points[nextNeighborIdx].name || `P${route.points[nextNeighborIdx].id}`) : null;
    previewDiv.innerHTML = `
        <div style="color:#2563eb;">飞往: ${escapeHtml(nextPt.name || `P${nextPt.id}`)} | 距离: ${distKm}km ${nextNeighborName ? ` | 后续: ${escapeHtml(nextNeighborName)}` : ''}</div>
        <div style="color:#94a3b8;margin-top:2px;">路线: 当前位置 → ${escapeHtml(nextPt.name || `P${nextPt.id}`)} ${remainingPoints.length ? ' → ' + escapeHtml(remainingPoints.join(' → ')) : ' → (继续飞行)'}</div>`;
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
        startTimeDisplay.textContent =
            `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    }
    updateSeatFieldsInDialog(ac);
}

/**
 * 飞机对话框内的管制席位区块（塔台/进近内容）：
 * 当前席位与管制状态、参考机场跑道下拉、进近方式。
 */
export function updateSeatFieldsInDialog(ac) {
    if (!ac) return;
    const unitEl = document.getElementById('ac-unit-display');
    if (unitEl) {
        const u = unit(unitOfAircraft(ac));
        unitEl.textContent = `${u.name} · ${clearanceText(ac)}`;
    }

    const rwySel = document.getElementById('ac-runway');
    if (rwySel) {
        const code = referenceAirportCode(ac);
        const ends = [];
        runwayList(code).forEach(pair => { ends.push(runwayEnd(pair, 0), runwayEnd(pair, 1)); });
        if (ac.runway && !ends.includes(ac.runway)) ends.unshift(ac.runway);
        rwySel.innerHTML = '<option value="">未指派</option>'
            + ends.map(r => `<option value="${escapeHtml(r)}">跑道 ${escapeHtml(r)}</option>`).join('');
        rwySel.value = ac.runway || '';
    }

    const approachSel = document.getElementById('ac-approach');
    if (approachSel) approachSel.value = ac.approachType || '';
}

export function updateNavModeUI(mode) {
    const freeNavGroup = document.getElementById('free-nav-group');
    const routeGroup = document.getElementById('waypoint-select-group');
    if (mode === 'free') {
        if (freeNavGroup) freeNavGroup.style.display = '';
        if (routeGroup) routeGroup.style.display = 'none';
    } else if (mode === 'route') {
        if (freeNavGroup) freeNavGroup.style.display = 'none';
        if (routeGroup) routeGroup.style.display = '';
    } else {
        if (freeNavGroup) freeNavGroup.style.display = 'none';
        if (routeGroup) routeGroup.style.display = 'none';
    }
}

export function updateTargetInfo(ac) {
    const infoDiv = document.getElementById('target-info');
    if (!infoDiv || !ac) return;
    if (ac.targetX === undefined || ac.targetY === undefined) {
        infoDiv.innerHTML = '<span style="color:#94a3b8;">未设置目标点</span>';
        return;
    }
    const x = ac.displayX ?? ac.x;
    const y = ac.displayY ?? ac.y;
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
    const x = ac.displayX ?? ac.x;
    const y = ac.displayY ?? ac.y;
    let minDist = Infinity, currentIdx = 0;
    for (let i = 0; i < route.points.length; i++) {
        const dx = route.points[i].x - x, dy = route.points[i].y - y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < minDist) { minDist = d; currentIdx = i; }
    }
    const info = getPositionAndTimeForWaypoint(ac, currentIdx);
    if (!info) { infoDiv.innerHTML = ''; return; }
    const pt = route.points[currentIdx];
    const ptName = escapeHtml(pt.name || `P${pt.id}`);
    if (info.timeToReach >= 0) {
        infoDiv.innerHTML = `<div style="font-size:11px;color:#16a34a;margin-top:4px;"><strong>当前: ${ptName}</strong> | 距离: ${info.distance}km | 到达: ${info.timeToReach}秒<br><span style="color:#64748b;">速度: ${ac.displaySpeed ?? ac.speed}kt | 航向: ${Math.round(ac.displayHeading ?? ac.heading ?? 90)}°</span></div>`;
    } else {
        infoDiv.innerHTML = `<div style="font-size:11px;color:#ea580c;margin-top:4px;"><strong>${ptName}</strong> - 已通过 (距离: ${Math.abs(info.distance)}km)</div>`;
    }
}


export function showNextWaypointDialog(ac, currentWaypointIdx) {
    const route = state.routes.find(r => r.id === ac.routeId);
    if (!route || route.points.length < 2) return;
    // 先暂停（playback:changed 订阅会关闭所有已打开对话框），再打开本对话框——
    // 原实现先开窗后暂停，暂停事件会立刻把刚开的窗关掉。
    if (state.isPlaying) {
        state.isPausedForWaypointSelection = true;
        setPlaying(false);
    }
    const dialog = document.getElementById('next-waypoint-dialog');
    const select = document.getElementById('next-waypoint-select');
    const currentNameDiv = document.getElementById('current-waypoint-name');
    const previewDiv = document.getElementById('next-waypoint-preview');
    const currentPt = route.points[currentWaypointIdx];
    if (!dialog || !select || !currentNameDiv || !previewDiv || !currentPt) return;
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
}

export function updateNextWaypointPreview(ac, currentIdx, nextIdx) {
    const previewDiv = document.getElementById('next-waypoint-preview');
    const route = state.routes.find(r => r.id === ac.routeId);
    if (!previewDiv) return;
    if (!nextIdx || !route) {
        previewDiv.innerHTML = '<span style="color:#94a3b8;">请选择下一航路点</span>';
        return;
    }
    const nextIdxNum = parseInt(nextIdx);
    const nextPt = route.points[nextIdxNum];
    const currentPt = route.points[currentIdx];
    if (!nextPt || !currentPt) return;
    const distKm = pxToKmFixed(Math.sqrt((nextPt.x - currentPt.x) ** 2 + (nextPt.y - currentPt.y) ** 2)).toFixed(1);
    let directionText = '';
    if (nextIdxNum < currentIdx) directionText = '← 向前序点飞行';
    else if (nextIdxNum > currentIdx) directionText = '→ 向后序点飞行';
    previewDiv.innerHTML = `
        <div><strong>下一目标:</strong> ${escapeHtml(nextPt.name || `P${nextPt.id}`)}</div>
        <div><strong>距离:</strong> ${distKm}km</div>
        <div style="color:#2563eb;">${directionText}</div>`;
}

export function updateWaypointSelectOptions(acId) {
    const group = document.getElementById('waypoint-select-group');
    if (!group) return;
    const ac = state.aircraft.find(a => a.id === acId);
    if (!ac || !ac.routeId) { group.style.display = 'none'; return; }
    group.style.display = 'block';
    buildNextWaypointSelect(acId);
}
