/**
 * ui/indicators.js — 指示器与播放控制（界面层）
 * 模式指示、编辑态 UI、时间显示、进程单、通讯目标选择、播放开关。
 */

import { state, pxToKmFixed, isEditMode } from '../core.js';
import {
    saveBasePositions, updateAircraftPositionsForTime,
    getWaypointInfoForAircraft
} from '../simulation/index.js';
import { addComm } from '../comm.js';
import { updateModeIndicator } from './dialogs.js';

export function updateEditModeUI() {
    const playIndicator = document.getElementById('play-indicator');
    const addBtns = document.querySelectorAll('.add-btn, .edit-btn, .route-btn, .settings-btn, #tool-delete');
    const paletteItems = document.querySelectorAll('.draggable-item');
    if (state.isPlaying) {
        playIndicator.classList.remove('hidden');
        addBtns.forEach(btn => { btn.classList.add('edit-disabled'); btn.style.pointerEvents = 'none'; });
        paletteItems.forEach(item => { item.classList.add('edit-disabled'); item.style.pointerEvents = 'none'; });
    } else {
        playIndicator.classList.add('hidden');
        addBtns.forEach(btn => { btn.classList.remove('edit-disabled'); btn.style.pointerEvents = ''; });
        paletteItems.forEach(item => { item.classList.remove('edit-disabled'); item.style.pointerEvents = ''; });
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
    if (!container) return;
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
            modeText = ` | 🔗${route ? route.name : ''}`;
        } else {
            modeText = ` | 🧭航向${Math.round(ac.displayHeading ?? ac.heading ?? 0)}°`;
        }
        const isSelected = state.selectedItem && state.selectedItem.type === 'aircraft' && state.selectedItem.id === ac.id;
        let waypointInfo = '';
        if (navMode === 'route' && route) {
            const wpInfo = getWaypointInfoForAircraft(ac);
            if (wpInfo) waypointInfo = ` | ${wpInfo.nextPointName}(${wpInfo.distance}km)`;
        }
        div.innerHTML = `
            <div class="flight-no" style="color:${isSelected ? '#006400' : '#1e40af'}">${ac.flightNo}${isSelected ? ' ✓' : ''}</div>
            <div class="info">${ac.departure} → ${ac.destination} | ${ac.displayAltitude ?? ac.altitude}m | ${ac.displaySpeed ?? ac.speed}kt${modeText}${waypointInfo}</div>
        `;
        if (isSelected) { div.style.borderLeftColor = '#006400'; div.style.background = '#f0fff0'; }
        div.style.cursor = 'pointer';
        div.addEventListener('click', () => {
            state.selectedItem = { type: 'aircraft', id: ac.id };
            updateModeIndicator();
            if (!state.isPlaying) {
                import('./dialogs.js').then(m => m.openAircraftDialog(ac.id));
            }
            updateProgressList();
        });
        container.appendChild(div);
        if (containerOverlay) {
            const div2 = div.cloneNode(true);
            div2.addEventListener('click', () => {
                state.selectedItem = { type: 'aircraft', id: ac.id };
                updateModeIndicator();
                if (!state.isPlaying) import('./dialogs.js').then(m => m.openAircraftDialog(ac.id));
                updateProgressList();
            });
            containerOverlay.appendChild(div2);
        }
    });
}

export function updateCommTargetSelect() {
    const select = document.getElementById('comm-target');
    if (!select) return;
    select.innerHTML = '<option value="atc">管制员广播</option>';
    state.aircraft.forEach(ac => {
        if (state.time < (ac.startTime || 0)) return;
        const opt = document.createElement('option');
        opt.value = ac.id;
        opt.textContent = ac.flightNo;
        select.appendChild(opt);
    });
}

export function updateRouteSelectOptions() {
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

export function togglePlayPause() {
    state.isPlaying = !state.isPlaying;
    const btn = document.getElementById('play-pause-btn');
    if (btn) btn.textContent = state.isPlaying ? '⏸ 暂停' : '▶ 播放';

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
