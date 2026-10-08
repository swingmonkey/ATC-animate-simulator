/**
 * ui/indicators.js — 指示器与播放控制（界面层）
 * 模式指示（自 dialogs.js 迁入，消除 indicators⇄dialogs 循环）、
 * 编辑态 UI、时间显示、进程单、通讯目标选择。
 *
 * 性能：updateTimeDisplay / updateProgressList 内置节流——
 * 播放 60× 时进程单原先每秒重建 DOM 数千次，现限制为 250ms 一次；
 * 关键交互（选中/场景变更/拖动进度条）通过 force 参数绕过节流立即刷新。
 */

import { state, isEditMode, select } from '../core/store.js';
import { pxToKmFixed } from '../core/viewport.js';
import { escapeHtml, formatHMS } from '../core/dom.js';
import { PROGRESS_REFRESH_MS } from '../core/constants.js';
import { getWaypointInfoForAircraft } from '../simulation/index.js';
import { clearanceText } from '../domain/clearances.js';
import { unit } from '../data/atcUnits.js';
import { openAircraftDialog } from './dialogs.js';

const TIME_REFRESH_MS = 100;
let _lastTimeRender = 0;
let _lastProgressRender = 0;

export function updateEditModeUI() {
    const playIndicator = document.getElementById('play-indicator');
    const addBtns = document.querySelectorAll(
        '#add-point-btn, #edit-point-btn, #add-route-btn, #add-aircraft-btn, '
        + '#tool-delete, #settings-btn, #generate-scenario-btn, #weather-regen-btn, '
        + '#location-sample-btn, #location-import-btn'
    );
    const paletteItems = document.querySelectorAll('.draggable-item');
    playIndicator?.classList.toggle('hidden', !state.isPlaying);
    const locked = !isEditMode();
    addBtns.forEach(btn => {
        btn.classList.toggle('edit-disabled', locked);
        btn.disabled = locked;
    });
    paletteItems.forEach(item => {
        item.classList.toggle('edit-disabled', locked);
        item.draggable = !locked;
    });
    const timeSlider = document.getElementById('time-slider');
    if (timeSlider) timeSlider.disabled = state.gameSessionActive;
}

/** 播放按钮文字（由 playback:changed 触发） */
export function updatePlayButton() {
    const btn = document.getElementById('play-pause-btn');
    if (btn) btn.textContent = state.isPlaying ? '⏸ 暂停' : '▶ 播放';
}

/**
 * 模式指示条（自 ui/dialogs.js 迁入）。
 * 覆盖：目标点选择、航线连接、选中实体、默认态四种情况。
 */
export function updateModeIndicator() {
    const indicator = document.getElementById('mode-indicator');
    const hint = document.getElementById('connection-hint');
    if (!indicator) return;

    const setStyle = (bg, border, color) => {
        indicator.style.background = bg;
        indicator.style.borderColor = border;
        indicator.style.color = color;
    };

    if (state.targetSelectMode) {
        indicator.textContent = '🎯 点击地图选择目标点...';
        setStyle('#e0f2fe', '#7dd3fc', '#0369a1');
        hint?.classList.add('hidden');
        return;
    }
    if (state.routeConnectMode) {
        indicator.textContent = `模式：连接航路点 (${state.routeConnectPoints.length})`;
        setStyle('#e3f2fd', '#64b5f6', '#1565c0');
        if (hint) {
            hint.classList.remove('hidden');
            const names = state.routeConnectPoints
                .map(id => state.routePoints.find(p => p.id === id)?.name || id);
            hint.innerHTML = `点击航路点添加，已选: <span>${escapeHtml(names.join(' → '))}</span>`;
        }
        return;
    }
    if (state.selectedItem) {
        const { type, id } = state.selectedItem;
        if (type === 'aircraft') {
            const ac = state.aircraft.find(a => a.id === id);
            indicator.textContent = `已选飞机: ${ac?.flightNo || id}`;
        } else if (type === 'point') {
            const pt = state.routePoints.find(p => p.id === id);
            indicator.textContent = `已选航路点: ${pt?.name || id}`;
        } else if (type === 'route') {
            const route = state.routes.find(r => r.id === id);
            indicator.textContent = `已选航线: ${route?.name || id}`;
        }
        if (state.isPlaying) setStyle('#dcfce7', '#86efac', '#166534');
        else setStyle('#fff3e0', '#ffb74d', '#e65100');
        hint?.classList.add('hidden');
        return;
    }
    indicator.textContent = '模式：选择 | 滚轮缩放 | ASWD移动';
    setStyle('#ffffff', '#e2e8f0', '#475569');
    hint?.classList.add('hidden');
}

/** 时间显示（force 绕过节流：启动/拖动进度条/设置变更时立即刷新） */
export function updateTimeDisplay(force = false) {
    const now = performance.now();
    if (!force && now - _lastTimeRender < TIME_REFRESH_MS) return;
    _lastTimeRender = now;
    const display = document.getElementById('time-display');
    if (display) display.textContent = formatHMS(state.time);
    const slider = document.getElementById('time-slider');
    if (slider) {
        slider.max = state.defaults.timeMax;
        slider.value = state.time;
    }
}

function openProgressAircraft(ac) {
    select({ type: 'aircraft', id: ac.id });
    if (!isEditMode()) return;
    openAircraftDialog(ac.id);
}

/**
 * 进程单刷新（含右侧覆盖层副本）。
 * @param {boolean} force 忽略节流立即重建
 */
export function updateProgressList(force = false) {
    const now = performance.now();
    if (!force && now - _lastProgressRender < PROGRESS_REFRESH_MS) return;
    _lastProgressRender = now;

    const container = document.getElementById('progress-list');
    const containerOverlay = document.getElementById('progress-list-overlay');
    if (!container) return;
    container.innerHTML = '';
    if (containerOverlay) containerOverlay.innerHTML = '';

    state.aircraft.forEach(ac => {
        if (state.time < (ac.startTime || 0)) return;
        // 席位过滤：点击席位面板后只显示该席位管辖的航空器
        if (state.seatFilter && (ac.unit || 'ACC') !== state.seatFilter) return;
        const route = ac.routeId ? state.routes.find(r => r.id === ac.routeId) : null;
        const navMode = ac.navMode || (ac.routeId ? 'route' : 'heading');
        let modeText = '';
        if (navMode === 'free' && ac.targetX !== undefined) {
            const x = ac.displayX ?? ac.x;
            const y = ac.displayY ?? ac.y;
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
        const seat = unit(ac.unit || 'ACC');
        const seatText = `${seat.short}${ac.runway ? ` R${ac.runway}` : ''}`;
        const div = document.createElement('div');
        div.className = 'progress-item';
        div.dataset.flightNo = ac.flightNo;
        div.innerHTML = `
            <div class="flight-no" style="color:${isSelected ? '#006400' : (ac.landed ? '#94a3b8' : '#1e40af')}">${escapeHtml(ac.flightNo)}${isSelected ? ' ✓' : ''}${ac.landed ? ' 🛬' : ''}</div>
            <div class="info">${escapeHtml(ac.departure)} → ${escapeHtml(ac.destination)} | ${ac.displayAltitude ?? ac.altitude}m | ${ac.displaySpeed ?? ac.speed}kt${escapeHtml(modeText)}${escapeHtml(waypointInfo)}</div>
            <div class="seat-line" style="color:${seat.color}">${escapeHtml(seatText)} · ${escapeHtml(clearanceText(ac))}</div>
        `;
        if (isSelected) { div.style.borderLeftColor = '#006400'; div.style.background = '#f0fff0'; }
        div.style.cursor = 'pointer';
        div.addEventListener('click', () => openProgressAircraft(ac));
        container.appendChild(div);
        if (containerOverlay) containerOverlay.appendChild(div.cloneNode(true));
    });

    // 覆盖层克隆节点不携带监听器，用事件委托补上点击行为
    if (containerOverlay) {
        containerOverlay.onclick = e => {
            const item = e.target.closest('.progress-item');
            if (!item) return;
            const flightNo = item.dataset.flightNo
                || item.querySelector('.flight-no')?.textContent.replace(' ✓', '').trim();
            const ac = state.aircraft.find(a => a.flightNo === flightNo);
            if (ac) openProgressAircraft(ac);
        };
    }
}

export function updateCommTargetSelect() {
    const selectEl = document.getElementById('comm-target');
    if (!selectEl) return;
    selectEl.innerHTML = '<option value="atc">管制员广播</option>';
    state.aircraft.forEach(ac => {
        if (state.time < (ac.startTime || 0)) return;
        const opt = document.createElement('option');
        opt.value = ac.id;
        opt.textContent = ac.flightNo;
        selectEl.appendChild(opt);
    });
}
