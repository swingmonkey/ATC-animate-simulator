/**
 * ui/formBindings.js — 对话框表单与控件事件绑定（界面层）
 * 原 interaction/toolbar.js 中的对话框表单处理逻辑按分层原则归位界面层：
 * 输入层只保留工具栏/画布/键盘，界面层自管对话框与表单控件。
 *
 * 所有结构性变更经 store 动作/commitScene 触发事件刷新，不再手工调用刷新函数。
 */

import { state, select, addComm, commitScene, setPlaying, setAutoHandoff, setAutoClearance } from '../core/store.js';
import { bus, EV } from '../core/eventBus.js';
import { $ } from '../core/dom.js';
import { centerOnWorldPoint } from '../core/viewport.js';
import { getAirport } from '../data/airports.js';
import { updateAircraftPositionsForTime } from '../simulation/index.js';
import { handoffToNextUnit } from '../domain/airspace.js';
import {
    updateWaypointSelectOptions, updateWaypointInfo, updateRoutePathPreview,
    updateNavModeUI, updateTargetInfo, updateSeatFieldsInDialog
} from './dialogs.js';
import { updateTimeDisplay } from './indicators.js';

/** 到达航路点询问流程结束后的恢复播放 */
function resumeAfterWaypointSelection() {
    if (state.isPausedForWaypointSelection) {
        state.isPausedForWaypointSelection = false;
        setPlaying(true);
    }
}

export function initFormBindings() {
    /* ---------------- 航路点对话框 ---------------- */

    $('save-point')?.addEventListener('click', () => {
        if (!state.editingPointId) return;
        const pt = state.routePoints.find(p => p.id === state.editingPointId);
        if (!pt) return;
        pt.name = $('point-name').value.trim() || pt.name;
        pt.type = $('point-type').value;
        $('point-edit-dialog').classList.add('hidden');
        commitScene();
    });

    $('delete-point-btn')?.addEventListener('click', () => {
        if (!state.editingPointId) return;
        const pt = state.routePoints.find(p => p.id === state.editingPointId);
        state.routePoints = state.routePoints.filter(p => p.id !== state.editingPointId);
        state.routes = state.routes.filter(r => !r.points.some(p => p.id === state.editingPointId));
        state.editingPointId = null;
        select(null);
        $('point-edit-dialog').classList.add('hidden');
        if (pt) addComm('atc', `航路点 ${pt.name} 已删除`);
        commitScene();
    });

    /* ---------------- 航线对话框 ---------------- */

    $('save-route')?.addEventListener('click', () => {
        if (!state.editingRouteId) return;
        const route = state.routes.find(r => r.id === state.editingRouteId);
        if (!route) return;
        route.name = $('route-name').value.trim() || route.name;
        route.color = $('route-color').value;
        $('route-edit-dialog').classList.add('hidden');
        commitScene();
    });

    $('delete-route-btn')?.addEventListener('click', () => {
        if (!state.editingRouteId) return;
        const routeId = state.editingRouteId;
        state.routes = state.routes.filter(r => r.id !== routeId);
        state.aircraft.forEach(ac => {
            if (ac.routeId === routeId) {
                ac.routeId = null;
                addComm('atc', `${ac.flightNo} 航线已删除，改为自由飞行`);
            }
        });
        state.editingRouteId = null;
        select(null);
        $('route-edit-dialog').classList.add('hidden');
        commitScene();
    });

    /* ---------------- 飞机对话框 ---------------- */

    $('ac-next-waypoint')?.addEventListener('change', function () {
        if (!state.editingAircraftId) return;
        const ac = state.aircraft.find(a => a.id === state.editingAircraftId);
        if (ac) {
            ac.nextWaypointIdx = this.value !== '' ? parseInt(this.value) : undefined;
            updateRoutePathPreview(ac);
        }
    });

    $('confirm-next-waypoint')?.addEventListener('click', () => {
        const selectEl = $('next-waypoint-select');
        const nextIdx = parseInt(selectEl?.value);
        if (isNaN(nextIdx)) { alert('请选择下一航路点'); return; }
        if (state.pendingNextWaypointSelection) {
            const ac = state.aircraft.find(a => a.id === state.pendingNextWaypointSelection.aircraftId);
            if (ac) ac.nextWaypointIdx = nextIdx;
            state.pendingNextWaypointSelection = null;
        }
        $('next-waypoint-dialog').classList.add('hidden');
        resumeAfterWaypointSelection();
        commitScene();
    });

    $('ac-route')?.addEventListener('change', function () {
        if (!state.editingAircraftId) return;
        const ac = state.aircraft.find(a => a.id === state.editingAircraftId);
        if (!ac) return;
        if (this.value) {
            ac.routeId = parseInt(this.value);
            ac.routeDistance = 0;
        } else {
            ac.routeId = null;
        }
        updateWaypointSelectOptions(state.editingAircraftId);
        updateWaypointInfo(ac);
    });

    $('ac-nav-mode')?.addEventListener('change', function () {
        if (!state.editingAircraftId) return;
        const ac = state.aircraft.find(a => a.id === state.editingAircraftId);
        if (!ac) return;
        ac.navMode = this.value;
        updateNavModeUI(this.value);
        if (this.value !== 'free') { ac.targetX = undefined; ac.targetY = undefined; }
    });


    /* ---------------- 自由导航目标点 ---------------- */

    $('select-target-btn')?.addEventListener('click', function () {
        if (!state.editingAircraftId) return;
        state.targetSelectMode = state.editingAircraftId;
        this.style.background = '#0369a1';
        this.style.color = 'white';
        bus.emit(EV.SELECTION_CHANGED);
    });

    $('input-target-coords-btn')?.addEventListener('click', function () {
        const c = $('target-coords-input');
        if (!c) return;
        c.style.display = c.style.display === 'none' ? '' : 'none';
    });

    $('confirm-target-btn')?.addEventListener('click', () => {
        if (!state.editingAircraftId) return;
        const ac = state.aircraft.find(a => a.id === state.editingAircraftId);
        if (!ac) return;
        const tx = parseFloat($('target-x').value), ty = parseFloat($('target-y').value);
        if (!isNaN(tx) && !isNaN(ty)) {
            ac.targetX = tx;
            ac.targetY = ty;
            ac.navMode = 'free';
            updateTargetInfo(ac);
        }
    });

    /* ---------------- 飞机保存 / 删除 ---------------- */

    $('save-aircraft')?.addEventListener('click', () => {
        if (!state.editingAircraftId) return;
        const ac = state.aircraft.find(a => a.id === state.editingAircraftId);
        if (!ac) return;
        ac.flightNo = $('ac-flight-no').value.trim() || ac.flightNo;
        ac.squawk = $('ac-squawk').value.trim();
        ac.departure = $('ac-departure').value.trim();
        ac.destination = $('ac-destination').value.trim();
        ac.acType = $('ac-type').value.trim();
        ac.altitude = parseInt($('ac-altitude').value) || ac.altitude;
        ac.altCon = null;                                  // 手动编辑后清除约束，使显示值生效
        ac.speed = parseInt($('ac-speed').value) || ac.speed;
        ac.spdCon = null;
        ac.heading = parseFloat($('ac-heading').value) || ac.heading;
        ac.hdgCon = null;
        ac.navMode = $('ac-nav-mode').value || 'heading';
        // 塔台/进近内容：跑道与进近方式（当前席位由 simulation/units.js 依据距离自动维护）
        const rwyValue = $('ac-runway')?.value;
        if (rwyValue !== undefined) ac.runway = rwyValue || null;
        const approachValue = $('ac-approach')?.value;
        if (approachValue !== undefined) ac.approachType = approachValue || null;
        const nextWpVal = $('ac-next-waypoint')?.value;
        if (nextWpVal !== '' && nextWpVal !== undefined && nextWpVal !== null) {
            ac.nextWaypointIdx = parseInt(nextWpVal);
        }
        if (ac.navMode === 'free') {
            const tx = parseFloat($('target-x').value), ty = parseFloat($('target-y').value);
            if (!isNaN(tx) && !isNaN(ty)) { ac.targetX = tx; ac.targetY = ty; }
            ac.routeId = null;
        }
        const routeId = $('ac-route').value;
        if (routeId && ac.navMode !== 'free') {
            ac.routeId = parseInt(routeId);
            ac.routeDistance = 0;
        } else if (ac.navMode !== 'free') {
            ac.routeId = null;
        }
        const askNextWpCheckbox = $('ac-ask-next-waypoint');
        ac.askNextWaypoint = askNextWpCheckbox ? askNextWpCheckbox.checked : false;
        $('aircraft-edit-dialog').classList.add('hidden');
        updateAircraftPositionsForTime(state.time);        // 约束清除后立即按新参数重算显示值
        commitScene();
    });

    $('delete-aircraft-btn')?.addEventListener('click', () => {
        if (!state.editingAircraftId) return;
        state.aircraft = state.aircraft.filter(a => a.id !== state.editingAircraftId);
        state.editingAircraftId = null;
        select(null);
        $('aircraft-edit-dialog').classList.add('hidden');
        commitScene();
    });

    /* ---------------- 管制席位（塔台/进近）控件 ---------------- */

    $('ac-handoff-btn')?.addEventListener('click', () => {
        if (!state.editingAircraftId) return;
        const ac = state.aircraft.find(a => a.id === state.editingAircraftId);
        if (!ac) return;
        if (!handoffToNextUnit(ac)) {
            addComm('atc', `${ac.flightNo} 已在席位链末端，无需移交`);
        }
        updateSeatFieldsInDialog(ac);
    });

    $('seat-focus-btn')?.addEventListener('click', () => {
        const ap = getAirport(state.focusAirport);
        if (ap) centerOnWorldPoint(ap.x, ap.y);
        addComm('atc', `视图已定位到焦点机场 ${state.focusAirport}`);
    });

    $('auto-handoff-toggle')?.addEventListener('change', e => {
        setAutoHandoff(e.target.checked);
        addComm('atc', e.target.checked
            ? '已开启自动移交（跨界自动转频）'
            : '已关闭自动移交（需手动下发「移交××」指令）');
    });

    $('auto-clearance-toggle')?.addEventListener('change', e => {
        if (e.target.disabled) return;
        setAutoClearance(e.target.checked);
        addComm('atc', e.target.checked
            ? '已开启自动许可（离港放行 / 进近许可 / 落地许可）'
            : '已关闭自动许可（需手动下发许可指令）');
    });

    /* ---------------- 设置对话框 ---------------- */

    $('save-settings')?.addEventListener('click', () => {
        if (state.gameSessionActive) return;
        state.defaults.altitude = parseInt($('def-altitude').value) || 10600;
        state.defaults.speed = parseInt($('def-speed').value) || 480;
        state.defaults.acType = $('def-ac-type').value || 'B738';
        state.defaults.squawk = $('def-squawk').value || '2000';
        state.defaults.gridSpacing = parseInt($('def-grid-spacing').value) || 50;
        state.defaults.minSeparationNm = parseInt($('min-separation-nm').value) || 15;
        state.defaults.timeMax = parseInt($('time-max-mins').value) * 60 || 2400;
        if (state.time > state.defaults.timeMax) state.time = 0;
        $('settings-dialog').classList.add('hidden');
        updateTimeDisplay(true);
        addComm('atc', '默认参数已更新');
        commitScene();
    });

    /* ---------------- 通用关闭按钮 ---------------- */

    document.querySelectorAll('.dialog-close').forEach(btn => {
        btn.addEventListener('click', () => {
            const dialog = btn.closest('.dialog');
            if (dialog?.id === 'next-waypoint-dialog') {
                state.pendingNextWaypointSelection = null;
                resumeAfterWaypointSelection();
            }
            dialog?.classList.add('hidden');
        });
    });
}
