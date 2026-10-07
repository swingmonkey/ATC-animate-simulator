/**
 * ui/panels.js — 侧边面板渲染（界面层）
 * 航路点 / 航线 / 飞机 列表项与整列刷新。
 * 仅由 ui/subscriptions.js 在 scene:changed / selection:changed 时调用，
 * 业务层不再直接触发（原先散落的 updateXxxPanelList() 人肉调用链已移除）。
 */

import { state, isEditMode, select } from '../core/store.js';
import { escapeHtml } from '../core/dom.js';
import { POINT_COLORS } from '../data/waypointTypes.js';
import { openPointDialog, openRouteDialog, openAircraftDialog } from './dialogs.js';

export function addPointPanelItem(pt) {
    const list = document.getElementById('route-points-list');
    if (!list) return;
    const item = document.createElement('div');
    item.className = 'panel-item';
    item.dataset.pointId = pt.id;
    const color = POINT_COLORS[pt.type] || POINT_COLORS.normal;
    item.innerHTML = `
        <span style="width:10px;height:10px;background:${color};border-radius:50%;display:inline-block;border:2px solid white;box-shadow:0 0 2px ${color};"></span>
        <span style="flex:1;font-size:12px;color:#1e293b;font-weight:600;">${escapeHtml(pt.name)}</span>
    `;
    item.style.cursor = 'pointer';
    item.addEventListener('click', () => {
        if (!isEditMode()) return;
        select({ type: 'point', id: pt.id });
        openPointDialog(pt.id);
    });
    list.appendChild(item);
}

export function updatePointPanelList() {
    const list = document.getElementById('route-points-list');
    if (!list) return;
    list.innerHTML = '';
    state.routePoints.forEach(pt => addPointPanelItem(pt));
}

export function addRoutePanelItem(route) {
    const list = document.getElementById('route-list');
    if (!list) return;
    const item = document.createElement('div');
    item.className = 'panel-item';
    item.dataset.routeId = route.id;
    item.innerHTML = `
        <span style="width:16px;height:2px;background:${escapeHtml(route.color)};display:inline-block;border-radius:1px;"></span>
        <span style="flex:1;font-size:12px;color:#1e293b;font-weight:600;">${escapeHtml(route.name)}</span>
    `;
    item.style.cursor = 'pointer';
    item.addEventListener('click', () => {
        if (!isEditMode()) return;
        select({ type: 'route', id: route.id });
        openRouteDialog(route.id);
    });
    list.appendChild(item);
}

export function updateRoutePanelList() {
    const list = document.getElementById('route-list');
    if (!list) return;
    list.innerHTML = '';
    state.routes.forEach(route => addRoutePanelItem(route));
}

export function addAircraftPanelItem(ac) {
    const list = document.getElementById('aircraft-list');
    if (!list) return;
    const item = document.createElement('div');
    item.className = 'panel-item';
    item.dataset.aircraftId = ac.id;
    const isSelected = state.selectedItem && state.selectedItem.type === 'aircraft' && state.selectedItem.id === ac.id;
    item.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16"><polygon points="12,2 22,22 12,17 2,22" fill="${isSelected ? '#006400' : '#1a1a2e'}" stroke="${isSelected ? '#228b22' : '#64748b'}" stroke-width="1"/></svg>
        <span style="flex:1;font-size:12px;color:${isSelected ? '#006400' : '#1e293b'};font-weight:600;">${escapeHtml(ac.flightNo)}</span>
    `;
    item.style.cursor = 'pointer';
    item.addEventListener('click', () => {
        if (!isEditMode()) return;
        select({ type: 'aircraft', id: ac.id });
        openAircraftDialog(ac.id);
    });
    list.appendChild(item);
}

export function updateAircraftPanelList() {
    const list = document.getElementById('aircraft-list');
    if (!list) return;
    list.innerHTML = '';
    state.aircraft.forEach(ac => addAircraftPanelItem(ac));
}