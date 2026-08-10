/**
 * interaction/toolbar.js — 工具栏与对话框按钮（输入层）
 * 含新增：场景生成（generators）、天气开关（weather）。
 */

import {
    state, centerX, centerY, isEditMode, saveState
} from '../core.js';
import {
    saveBasePositions, updateAircraftPositionsForTime
} from '../simulation/index.js';
import {
    updateModeIndicator, updateProgressList, openPointDialog,
    updateRoutePanelList, updatePointPanelList, updateAircraftPanelList,
    updateCommTargetSelect, openAircraftDialog, updateNavModeUI,
    updateTargetInfo, updateWaypointInfo, updateWaypointSelectOptions,
    updateRoutePathPreview, showNextWaypointDialog, updateNextWaypointPreview,
    togglePlayPause, sendComm, addComm
} from '../ui/index.js';
import { addPoint, addAircraft } from './factory.js';
import { generateScenario } from '../generators/flightGenerator.js';
import { toggleWeather, generateWeather } from '../weather/weather.js';

const $ = id => document.getElementById(id);

/* ---------------- 工具栏：增删 ---------------- */

$('add-point-btn')?.addEventListener('click', () => {
    if (!isEditMode()) return;
    addPoint(centerX + (Math.random() - 0.5) * 200, centerY + (Math.random() - 0.5) * 200, 'normal');
    saveState();
});

$('edit-point-btn')?.addEventListener('click', () => {
    if (!isEditMode()) return;
    if (state.selectedItem && state.selectedItem.type === 'point') openPointDialog(state.selectedItem.id);
    else if (state.routePoints.length > 0) {
        state.selectedItem = { type: 'point', id: state.routePoints[0].id };
        updateModeIndicator();
        openPointDialog(state.selectedItem.id);
    }
});

$('add-route-btn')?.addEventListener('click', () => {
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
            updateRoutePanelList();
            addComm('atc', `航线 ${route.name} 已建立，共 ${route.points.length} 个航路点`);
            saveState();
        }
        state.routeConnectMode = false;
        state.routeConnectPoints = [];
        $('add-route-btn')?.classList.remove('active');
        updateModeIndicator();
    } else {
        state.routeConnectMode = true;
        state.routeConnectPoints = [];
        $('add-route-btn')?.classList.add('active');
        updateModeIndicator();
    }
});

$('add-aircraft-btn')?.addEventListener('click', () => {
    if (!isEditMode()) return;
    const ac = addAircraft(centerX + (Math.random() - 0.5) * 150, centerY + (Math.random() - 0.5) * 150);
    state.selectedItem = { type: 'aircraft', id: ac.id };
    updateModeIndicator();
    updateProgressList();
    saveState();
});

/* ---------------- 对话框：航路点 ---------------- */

$('save-point')?.addEventListener('click', () => {
    if (!state.editingPointId) return;
    const pt = state.routePoints.find(p => p.id === state.editingPointId);
    if (!pt) return;
    pt.name = $('point-name').value.trim() || pt.name;
    pt.type = $('point-type').value;
    $('point-edit-dialog').classList.add('hidden');
    updatePointPanelList();
    updateRoutePanelList();
    saveState();
});

$('delete-point-btn')?.addEventListener('click', () => {
    if (!state.editingPointId) return;
    const pt = state.routePoints.find(p => p.id === state.editingPointId);
    state.routePoints = state.routePoints.filter(p => p.id !== state.editingPointId);
    state.routes = state.routes.filter(r => !r.points.some(p => p.id === state.editingPointId));
    state.selectedItem = null;
    $('point-edit-dialog').classList.add('hidden');
    updatePointPanelList();
    updateRoutePanelList();
    updateModeIndicator();
    if (pt) addComm('atc', `航路点 ${pt.name} 已删除`);
    saveState();
});

/* ---------------- 对话框：航线 ---------------- */

$('save-route')?.addEventListener('click', () => {
    if (!state.editingRouteId) return;
    const route = state.routes.find(r => r.id === state.editingRouteId);
    if (!route) return;
    route.name = $('route-name').value.trim() || route.name;
    route.color = $('route-color').value;
    $('route-edit-dialog').classList.add('hidden');
    updateRoutePanelList();
    saveState();
});

$('delete-route-btn')?.addEventListener('click', () => {
    if (!state.editingRouteId) return;
    state.routes = state.routes.filter(r => r.id !== state.editingRouteId);
    state.aircraft.forEach(ac => { if (ac.routeId === state.editingRouteId) { ac.routeId = null; addComm('atc', `${ac.flightNo} 航线已删除，改为自由飞行`); } });
    state.selectedItem = null;
    $('route-edit-dialog').classList.add('hidden');
    updateRoutePanelList();
    updateModeIndicator();
    saveState();
});

/* ---------------- 对话框：飞机 ---------------- */

$('ac-next-waypoint')?.addEventListener('change', function () {
    if (!state.editingAircraftId) return;
    const ac = state.aircraft.find(a => a.id === state.editingAircraftId);
    if (ac) { ac.nextWaypointIdx = this.value !== '' ? parseInt(this.value) : undefined; updateRoutePathPreview(ac); }
});

$('confirm-next-waypoint')?.addEventListener('click', function () {
    const select = $('next-waypoint-select');
    const nextIdx = parseInt(select.value);
    if (isNaN(nextIdx)) { alert('请选择下一航路点'); return; }
    if (state.pendingNextWaypointSelection) {
        const ac = state.aircraft.find(a => a.id === state.pendingNextWaypointSelection.aircraftId);
        if (ac) { ac.nextWaypointIdx = nextIdx; saveBasePositions(); }
        state.pendingNextWaypointSelection = null;
    }
    $('next-waypoint-dialog').classList.add('hidden');
    if (state.isPausedForWaypointSelection) { state.isPausedForWaypointSelection = false; togglePlayPause(); }
    saveState();
});

document.querySelectorAll('#next-waypoint-dialog .dialog-close').forEach(btn => {
    btn.addEventListener('click', function () {
        if (state.isPausedForWaypointSelection) { state.isPausedForWaypointSelection = false; state.pendingNextWaypointSelection = null; togglePlayPause(); }
    });
});

$('ac-route')?.addEventListener('change', function () {
    if (!state.editingAircraftId) return;
    const ac = state.aircraft.find(a => a.id === state.editingAircraftId);
    if (!ac) return;
    const routeId = this.value;
    if (routeId) { ac.routeId = parseInt(routeId); ac.routeDistance = 0; }
    else ac.routeId = null;
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

$('select-target-btn')?.addEventListener('click', function () {
    if (!state.editingAircraftId) return;
    state.targetSelectMode = state.editingAircraftId;
    this.style.background = '#0369a1';
    this.style.color = 'white';
    const mi = $('mode-indicator');
    mi.textContent = '🎯 点击地图选择目标点...';
    mi.style.background = '#e0f2fe';
    mi.style.borderColor = '#7dd3fc';
    mi.style.color = '#0369a1';
});

$('input-target-coords-btn')?.addEventListener('click', function () {
    const c = $('target-coords-input');
    c.style.display = c.style.display === 'none' ? '' : 'none';
});

$('confirm-target-btn')?.addEventListener('click', function () {
    if (!state.editingAircraftId) return;
    const ac = state.aircraft.find(a => a.id === state.editingAircraftId);
    if (!ac) return;
    const tx = parseFloat($('target-x').value), ty = parseFloat($('target-y').value);
    if (!isNaN(tx) && !isNaN(ty)) { ac.targetX = tx; ac.targetY = ty; ac.navMode = 'free'; updateTargetInfo(ac); }
});

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
    const nextWpVal = $('ac-next-waypoint')?.value;
    if (nextWpVal !== '' && nextWpVal !== undefined && nextWpVal !== null) ac.nextWaypointIdx = parseInt(nextWpVal);
    if (ac.navMode === 'free') {
        const tx = parseFloat($('target-x').value), ty = parseFloat($('target-y').value);
        if (!isNaN(tx) && !isNaN(ty)) { ac.targetX = tx; ac.targetY = ty; }
        ac.routeId = null;
    }
    const routeId = $('ac-route').value;
    if (routeId && ac.navMode !== 'free') { ac.routeId = parseInt(routeId); ac.routeDistance = 0; }
    else if (ac.navMode !== 'free') ac.routeId = null;
    const askNextWpCheckbox = $('ac-ask-next-waypoint');
    ac.askNextWaypoint = askNextWpCheckbox ? askNextWpCheckbox.checked : false;
    saveBasePositions();
    $('aircraft-edit-dialog').classList.add('hidden');
    updateAircraftPanelList();
    updateProgressList();
    updateCommTargetSelect();
    saveState();
});

$('delete-aircraft-btn')?.addEventListener('click', () => {
    if (!state.editingAircraftId) return;
    state.aircraft = state.aircraft.filter(a => a.id !== state.editingAircraftId);
    state.connections = state.connections.filter(c => c.from !== state.editingAircraftId && c.to !== state.editingAircraftId);
    state.selectedItem = null;
    $('aircraft-edit-dialog').classList.add('hidden');
    updateAircraftPanelList();
    updateProgressList();
    updateCommTargetSelect();
    updateModeIndicator();
    saveState();
});

/* ---------------- 通讯 ---------------- */

$('comm-send-btn')?.addEventListener('click', sendComm);
$('comm-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') sendComm(); });

/* ---------------- 播放控制 ---------------- */

$('play-pause-btn')?.addEventListener('click', () => togglePlayPause());

$('time-slider')?.addEventListener('input', e => {
    state.time = parseInt(e.target.value);
    updateTimeDisplay();
    updateAircraftPositionsForTime(state.time);
});

$('speed-select')?.addEventListener('change', e => { state.timeSpeed = parseInt(e.target.value); });

$('tool-delete')?.addEventListener('click', () => {
    if (!isEditMode() || !state.selectedItem) return;
    const { type, id } = state.selectedItem;
    if (type === 'aircraft') {
        state.aircraft = state.aircraft.filter(a => a.id !== id);
        state.connections = state.connections.filter(c => c.from !== id && c.to !== id);
        updateAircraftPanelList(); updateProgressList(); updateCommTargetSelect();
    } else if (type === 'point') {
        state.routePoints = state.routePoints.filter(p => p.id !== id);
        state.routes = state.routes.filter(r => !r.points.some(p => p.id === id));
        updatePointPanelList(); updateRoutePanelList();
    } else if (type === 'route') {
        state.routes = state.routes.filter(r => r.id !== id);
        state.aircraft.forEach(ac => { if (ac.routeId === id) ac.routeId = null; });
        updateRoutePanelList(); updateProgressList();
    }
    state.selectedItem = null;
    updateModeIndicator(); updateProgressList();
    saveState();
});

/* ---------------- 设置 / 帮助 ---------------- */

$('help-btn')?.addEventListener('click', () => $('help-dialog')?.classList.remove('hidden'));

$('settings-btn')?.addEventListener('click', () => {
    if (!isEditMode()) return;
    $('settings-dialog')?.classList.remove('hidden');
    $('def-altitude').value = state.defaults.altitude;
    $('def-speed').value = state.defaults.speed;
    $('def-ac-type').value = state.defaults.acType;
    $('def-squawk').value = state.defaults.squawk;
    $('def-grid-spacing').value = state.defaults.gridSpacing;
    $('min-separation-nm').value = state.defaults.minSeparationNm;
    $('time-max-mins').value = Math.round(state.defaults.timeMax / 60);
});

$('save-settings')?.addEventListener('click', () => {
    state.defaults.altitude = parseInt($('def-altitude').value) || 10600;
    state.defaults.speed = parseInt($('def-speed').value) || 480;
    state.defaults.acType = $('def-ac-type').value || 'B738';
    state.defaults.squawk = $('def-squawk').value || '2000';
    state.defaults.gridSpacing = parseInt($('def-grid-spacing').value) || 50;
    state.defaults.minSeparationNm = parseInt($('min-separation-nm').value) || 15;
    state.defaults.timeMax = parseInt($('time-max-mins').value) * 60 || 2400;
    if (state.time > state.defaults.timeMax) state.time = 0;
    $('settings-dialog').classList.add('hidden');
    updateTimeDisplay();
    addComm('atc', '默认参数已更新');
    saveState();
});

document.querySelectorAll('.dialog-close').forEach(btn => {
    btn.addEventListener('click', () => btn.closest('.dialog')?.classList.add('hidden'));
});

/* ---------------- 新增：场景生成 ---------------- */

$('generate-scenario-btn')?.addEventListener('click', () => {
    const focus = $('scenario-focus')?.value || 'ZUUU';
    const summary = generateScenario(focus, 4, 3);
    updateRoutePanelList();
    updatePointPanelList();
    updateAircraftPanelList();
    updateCommTargetSelect();
    addComm('atc', `已生成场景：焦点 ${summary.focus}，新增 ${summary.added} 架航班`);
    saveState();
});

/* ---------------- 新增：天气开关 ---------------- */

$('weather-toggle-btn')?.addEventListener('click', () => {
    const on = toggleWeather();
    const btn = $('weather-toggle-btn');
    if (btn) btn.textContent = on ? '🌩 关闭天气' : '🌤 开启天气';
    addComm('atc', on ? '天气图层已开启' : '天气图层已关闭');
    saveState();
});

$('weather-regen-btn')?.addEventListener('click', () => {
    generateWeather(0.55);
    if (!state.weatherEnabled) toggleWeather();
    addComm('atc', '已重新生成风暴场');
    saveState();
});
