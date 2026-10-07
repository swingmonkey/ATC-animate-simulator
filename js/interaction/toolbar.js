/**
 * interaction/toolbar.js — 工具栏 / 右侧面板按钮（输入层）
 * 场景构建（航路点/航线/飞机）、删除、帮助与设置、场景生成、天气、播放控制。
 *
 * 变更点：不再导入任何 ui 刷新函数——状态变更经 store 动作触发事件，
 * 由 ui/subscriptions.js 统一刷新；对话框表单控件的事件绑定见 ui/formBindings.js。
 */

import {
    state, isEditMode, select, togglePlay, addComm, commitScene,
    setRouteConnectMode, cancelRouteConnect
} from '../core/store.js';
import { centerX, centerY } from '../core/viewport.js';
import { nextId } from '../core/ids.js';
import { requestRedraw } from '../core/eventBus.js';
import { $ } from '../core/dom.js';
import { updateAircraftPositionsForTime } from '../simulation/index.js';
import { updateProgressList, updateTimeDisplay, openPointDialog } from '../ui/index.js';
import { addPoint, addAircraft } from './factory.js';
import { generateScenario } from '../generators/flightGenerator.js';
import { toggleWeather, generateWeather } from '../weather/weather.js';

/* ---------------- 工具栏：增删 ---------------- */

$('add-point-btn')?.addEventListener('click', () => {
    if (!isEditMode()) return;
    addPoint(centerX + (Math.random() - 0.5) * 200, centerY + (Math.random() - 0.5) * 200, 'normal');
});

$('edit-point-btn')?.addEventListener('click', () => {
    if (!isEditMode()) return;
    if (state.selectedItem && state.selectedItem.type === 'point') {
        openPointDialog(state.selectedItem.id);
    } else if (state.routePoints.length > 0) {
        select({ type: 'point', id: state.routePoints[0].id });
        openPointDialog(state.routePoints[0].id);
    }
});

$('add-route-btn')?.addEventListener('click', () => {
    if (!isEditMode()) return;
    if (!state.routeConnectMode) {
        setRouteConnectMode(true);
        return;
    }
    /* 结束连接：>=2 个点则建航线 */
    if (state.routeConnectPoints.length >= 2) {
        const points = state.routeConnectPoints
            .map(id => state.routePoints.find(p => p.id === id))
            .filter(Boolean);
        if (points.length >= 2) {
            const route = {
                id: nextId(),
                name: `航线${state.routes.length + 1}`,
                points,
                color: '#2563eb'
            };
            state.routes.push(route);
            addComm('atc', `航线 ${route.name} 已建立，共 ${route.points.length} 个航路点`);
        }
    }
    cancelRouteConnect();
    commitScene();
});

$('add-aircraft-btn')?.addEventListener('click', () => {
    if (!isEditMode()) return;
    const ac = addAircraft(centerX + (Math.random() - 0.5) * 150, centerY + (Math.random() - 0.5) * 150);
    select({ type: 'aircraft', id: ac.id });
});


/* ---------------- 删除选中 ---------------- */

$('tool-delete')?.addEventListener('click', () => {
    if (!isEditMode() || !state.selectedItem) return;
    const { type, id } = state.selectedItem;
    if (type === 'aircraft') {
        state.aircraft = state.aircraft.filter(a => a.id !== id);
    } else if (type === 'point') {
        state.routePoints = state.routePoints.filter(p => p.id !== id);
        state.routes = state.routes.filter(r => !r.points.some(p => p.id === id));
    } else if (type === 'route') {
        state.routes = state.routes.filter(r => r.id !== id);
        state.aircraft.forEach(ac => { if (ac.routeId === id) ac.routeId = null; });
    }
    select(null);
    commitScene();
});

/* ---------------- 帮助 / 设置 ---------------- */

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

/* ---------------- 场景生成 ---------------- */

$('generate-scenario-btn')?.addEventListener('click', () => {
    const focus = $('scenario-focus')?.value || 'ZUUU';
    const summary = generateScenario(focus, 4, 3);
    addComm('atc', `已生成场景：焦点 ${summary.focus}，新增 ${summary.added} 架航班`);
    commitScene();
});

/* ---------------- 天气 ---------------- */

$('weather-toggle-btn')?.addEventListener('click', () => {
    const on = toggleWeather();
    const btn = $('weather-toggle-btn');
    if (btn) btn.textContent = on ? '🌩 关闭天气' : '🌤 开启天气';
    addComm('atc', on ? '天气图层已开启' : '天气图层已关闭');
    requestRedraw();
});

$('weather-regen-btn')?.addEventListener('click', () => {
    generateWeather(0.55);
    if (!state.weatherEnabled) {
        toggleWeather();
        const btn = $('weather-toggle-btn');
        if (btn) btn.textContent = '🌩 关闭天气';
    }
    addComm('atc', '已重新生成风暴场');
    requestRedraw();
});

/* ---------------- 播放控制 ---------------- */

$('play-pause-btn')?.addEventListener('click', () => togglePlay());

$('time-slider')?.addEventListener('input', e => {
    state.time = parseInt(e.target.value);
    updateTimeDisplay(true);
    updateAircraftPositionsForTime(state.time);
    updateProgressList();
    requestRedraw();
});

$('speed-select')?.addEventListener('change', e => {
    state.timeSpeed = parseInt(e.target.value);
});
