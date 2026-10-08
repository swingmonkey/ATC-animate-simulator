/** 雷达值班的常用指令入口。所有操作仍走文字指令通道，以保留复诵、记录和评分。 */
import { state, isEditMode } from '../core/store.js';
import { altOf, hdgOf } from '../core/accessors.js';
import { canIssue, issueHint, phaseLabel } from '../domain/phases.js';
import { submitAtcText } from './commPanel.js';
import { runwayEndsFor, unitOfAircraft } from '../domain/airspace.js';
import { nextUnit, unit } from '../data/atcUnits.js';
import { flowOf } from '../domain/phases.js';
import { canGroundAction, groundStageOf } from '../domain/dutyOps.js';

const $ = id => document.getElementById(id);
const HINTS = {
    TWR: '塔台：离港按推出→开车→滑行→进跑道→起飞操作；进港确认跑道与落地许可。',
    APP: '进近：安排进港顺位、过点高度，拖动飞机引导航向与直飞。',
    ACC: '区调：安排高度层、设置高度上限与流控速度，接近终端区时移交。'
};
let lastAircraftId = null;
let lastPointsKey = '';
let lastRunwaysKey = '';
let lastView = null;
let lastRefresh = 0;

function selectedAircraft() {
    const item = state.selectedItem;
    if (item?.type !== 'aircraft') return null;
    return state.aircraft.find(ac => ac.id === item.id && state.time >= (ac.startTime || 0)
        && (unitOfAircraft(ac) === state.activeView || unitOfAircraft(ac).startsWith(`${state.activeView}-`))) || null;
}

export function showQuickFeedback(message, error = false) {
    const box = $('quick-feedback');
    if (!box) return;
    box.textContent = message || HINTS[state.activeView] || HINTS.APP;
    box.classList.toggle('error', !!error);
}

function issue(ac, text) {
    const result = submitAtcText(`${ac.flightNo} ${text}`);
    if (result?.ok && text.startsWith('高度 ')) $('quick-altitude').value = String(ac.altCon ?? Math.round(altOf(ac)));
    showQuickFeedback(result?.message || '请先选择飞机', !result?.ok);
    updateQuickControl(true);
    return result;
}

function control(id, ac, type, extra = true) {
    const element = $(id);
    if (!element) return;
    element.disabled = !ac || isEditMode() || !extra || !canIssue(ac, type);
    element.title = !ac ? '先选择一架飞机' : isEditMode() ? '播放后可下达指令' : !extra ? '请先选择航路点' : issueHint(ac, type);
}

function routePointsFor(ac) {
    const route = ac?.routeId ? state.routes.find(item => item.id === ac.routeId) : null;
    const points = [...state.routePoints];
    for (const point of route?.points || []) {
        if (!points.some(item => item.name?.toUpperCase() === point.name?.toUpperCase())) points.push(point);
    }
    return points;
}

function rebuildWaypoints(ac) {
    const select = $('quick-waypoint');
    if (!select) return;
    const points = routePointsFor(ac);
    const key = `${ac?.id || ''}|${points.map(point => `${point.id}:${point.name}`).join('|')}`;
    if (key === lastPointsKey) return;
    lastPointsKey = key;
    const previous = select.value;
    select.replaceChildren();
    if (!points.length) {
        select.add(new Option('暂无航路点', ''));
        return;
    }
    select.add(new Option('选择航路点…', ''));
    for (const point of points) select.add(new Option(point.name || `点 ${point.id}`, String(point.id)));
    if ([...select.options].some(option => option.value === previous)) select.value = previous;
}

function rebuildRunways() {
    const select = $('quick-runway');
    if (!select) return;
    const runways = runwayEndsFor(state.focusAirport);
    const key = `${state.focusAirport}:${runways.join('|')}`;
    if (key === lastRunwaysKey) return;
    lastRunwaysKey = key;
    const previous = select.value;
    select.replaceChildren();
    for (const runway of runways) select.add(new Option(`跑道 ${runway}`, runway));
    if (runways.includes(previous)) select.value = previous;
}

export function updateQuickControl(force = false) {
    const now = performance.now();
    if (!force && now - lastRefresh < 240) return;
    lastRefresh = now;
    const ac = selectedAircraft();
    rebuildWaypoints(ac);
    rebuildRunways();
    const code = state.activeView;
    const selectedViewChanged = code !== lastView;
    lastView = code;
    $('quick-alt-field').hidden = code === 'TWR';
    $('quick-direct-field').hidden = code === 'TWR';
    $('quick-flight-levels').hidden = code !== 'ACC';
    $('quick-runway-field').hidden = code === 'ACC';
    $('quick-takeoff').hidden = code !== 'TWR';
    $('quick-land').hidden = code !== 'TWR';
    $('quick-approach').hidden = code !== 'APP';
    $('quick-go-around').hidden = code === 'ACC';
    $('quick-handoff').hidden = false;
    $('quick-ground').hidden = code !== 'TWR';
    $('quick-approach-plan').hidden = code !== 'APP';
    $('quick-area-plan').hidden = code !== 'ACC';
    const kicker = document.querySelector('#quick-control .quick-kicker span:last-child');
    if (kicker) kicker.textContent = `${code} / 01`;
    const selectedChanged = (ac?.id ?? null) !== lastAircraftId || selectedViewChanged;
    lastAircraftId = ac?.id ?? null;
    if (selectedChanged && ac?.runway && [...($('quick-runway')?.options || [])].some(option => option.value === ac.runway)) {
        $('quick-runway').value = ac.runway;
    }
    $('quick-ground-stage').textContent = ac && flowOf(ac) === 'departure'
        ? ({ parked: '停机位', pushed: '已推出', started: '已开车', taxi: '滑行中', lineup: '跑道等待', takeoff: '已起飞' }[groundStageOf(ac)] || '待命')
        : '选中离港航班';
    $('quick-auto-clearance').checked = !!state.autoClearance;
    document.querySelectorAll('#quick-ground button[data-ground]').forEach(button => {
        button.disabled = !ac || isEditMode() || !canGroundAction(ac, button.dataset.ground);
    });
    $('quick-order-readout').textContent = ac?.arrivalOrder ? `第 ${ac.arrivalOrder} 顺位` : '未排序';
    document.querySelectorAll('#quick-approach-plan button[data-order]').forEach(button => {
        button.disabled = !ac || isEditMode() || flowOf(ac) !== 'arrival';
        button.classList.toggle('active', Number(button.dataset.order) === ac?.arrivalOrder);
    });
    $('quick-crossing-apply').disabled = !ac || isEditMode() || !$('quick-waypoint')?.value;
    $('quick-area-readout').textContent = ac
        ? `${ac.areaAltitudeLimitM ? `上限 ${ac.areaAltitudeLimitM}m` : '无限高'} · ${ac.flowSpeedKt ? `${ac.flowSpeedKt}kt 流控` : '无流控'}`
        : '无限高 · 无流控';
    ['quick-area-limit-apply', 'quick-area-limit-clear', 'quick-flow-apply', 'quick-flow-clear'].forEach(id => {
        $(id).disabled = !ac || isEditMode();
    });
    if (selectedChanged) {
        $('quick-crossing-alt').value = ac ? String(ac.crossingAltM ?? Math.round(ac.altCon ?? altOf(ac))) : '';
        $('quick-area-limit').value = ac ? String(ac.areaAltitudeLimitM ?? Math.round(ac.altCon ?? altOf(ac))) : '';
    }
    const readout = $('quick-readout');
    if (readout) readout.textContent = ac
        ? `${ac.flightNo}  ·  ${phaseLabel(ac.phase)}  ·  ${code === 'ACC' ? `FL${Math.round(altOf(ac) / 30.48)}` : `${Math.round(altOf(ac))} m`}  ·  ${String(Math.round(hdgOf(ac)) % 360).padStart(3, '0')}°`
        : `点选${unit(code).short}在管航班，开始指挥。`;
    const altitude = $('quick-altitude');
    if (altitude) {
        altitude.disabled = !ac || isEditMode() || !canIssue(ac, 'ALT');
        altitude.min = String(state.defaults.altMinM || 3000);
        altitude.max = String(state.defaults.altMaxM || 15000);
        if (selectedChanged || (document.activeElement !== altitude && !altitude.value)) {
            altitude.value = ac ? String(Math.round(ac.altCon ?? altOf(ac))) : '';
        }
    }
    control('quick-alt-down', ac, 'ALT');
    control('quick-alt-up', ac, 'ALT');
    control('quick-alt-apply', ac, 'ALT');
    control('quick-waypoint', ac, 'DIRECT', routePointsFor(ac).length > 0);
    control('quick-direct', ac, 'DIRECT', !!$('quick-waypoint')?.value);
    control('quick-takeoff', ac, 'TAKEOFF');
    control('quick-approach', ac, 'APPROACH');
    control('quick-land', ac, 'LAND');
    control('quick-go-around', ac, 'GOAROUND');
    control('quick-assign-runway', ac, 'RUNWAY', !!$('quick-runway')?.value);
    const next = ac ? nextUnit((ac.unit || code).split('-')[0], flowOf(ac)) : null;
    control('quick-handoff', ac, 'HANDOFF', !!next);
    if ($('quick-handoff')) $('quick-handoff').textContent = next ? `移交${unit(next).short}` : '移交';
    document.querySelectorAll('#quick-flight-levels button[data-fl]').forEach(button => {
        button.disabled = !ac || isEditMode() || !canIssue(ac, 'ALT');
    });
    if (selectedChanged) showQuickFeedback();
}

export function initQuickControl() {
    $('quick-waypoint')?.addEventListener('change', () => updateQuickControl(true));
    $('quick-auto-clearance')?.addEventListener('change', event => {
        const source = $('auto-clearance-toggle');
        source.checked = event.target.checked;
        source.dispatchEvent(new Event('change'));
        updateQuickControl(true);
    });
    $('quick-ground')?.addEventListener('click', event => {
        const action = event.target.closest('button[data-ground]')?.dataset.ground;
        const ac = selectedAircraft();
        if (!ac || !action || !canGroundAction(ac, action)) return;
        issue(ac, { pushback: '推出', startup: '开车', taxi: '滑行', lineup: '进跑道' }[action]);
    });
    $('quick-approach-plan')?.addEventListener('click', event => {
        const button = event.target.closest('button[data-order]');
        const ac = selectedAircraft();
        if (button && ac && flowOf(ac) === 'arrival') issue(ac, `排序 ${button.dataset.order}`);
    });
    $('quick-crossing-apply')?.addEventListener('click', () => {
        const ac = selectedAircraft();
        const point = routePointsFor(ac).find(p => String(p.id) === $('quick-waypoint')?.value);
        const alt = Number($('quick-crossing-alt')?.value);
        if (!ac || !point) return showQuickFeedback('先选择一个过点航路点', true);
        if (!Number.isFinite(alt) || alt < (state.defaults.altMinM || 3000) || alt > (state.defaults.altMaxM || 15000)) {
            return showQuickFeedback('过点高度超出当前可指令范围', true);
        }
        issue(ac, `过点 ${point.name} 高度 ${Math.round(alt)}`);
    });
    $('quick-area-limit-apply')?.addEventListener('click', () => {
        const ac = selectedAircraft();
        const alt = Number($('quick-area-limit')?.value);
        if (!ac) return;
        if (!Number.isFinite(alt) || alt < (state.defaults.altMinM || 3000) || alt > (state.defaults.altMaxM || 15000)) {
            return showQuickFeedback('高度限制超出当前可指令范围', true);
        }
        issue(ac, `高度限制 ${Math.round(alt)}`);
    });
    $('quick-area-limit-clear')?.addEventListener('click', () => {
        const ac = selectedAircraft();
        if (ac) issue(ac, '取消高度限制');
    });
    $('quick-flow-apply')?.addEventListener('click', () => {
        const ac = selectedAircraft();
        if (ac) issue(ac, `流控速度 ${$('quick-flow-speed').value}`);
    });
    $('quick-flow-clear')?.addEventListener('click', () => {
        const ac = selectedAircraft();
        if (ac) issue(ac, '解除流控');
    });
    $('quick-alt-down')?.addEventListener('click', () => {
        const ac = selectedAircraft();
        if (ac && canIssue(ac, 'ALT')) issue(ac, `高度 ${Math.max(state.defaults.altMinM || 3000, Math.round((ac.altCon ?? altOf(ac)) - 600))}`);
    });
    $('quick-alt-up')?.addEventListener('click', () => {
        const ac = selectedAircraft();
        if (ac && canIssue(ac, 'ALT')) issue(ac, `高度 ${Math.min(state.defaults.altMaxM || 15000, Math.round((ac.altCon ?? altOf(ac)) + 600))}`);
    });
    $('quick-alt-apply')?.addEventListener('click', () => {
        const ac = selectedAircraft();
        const value = Number($('quick-altitude')?.value);
        if (!ac || !canIssue(ac, 'ALT')) return;
        if (!Number.isFinite(value) || value < (state.defaults.altMinM || 3000) || value > (state.defaults.altMaxM || 15000)) {
            showQuickFeedback(`高度须在 ${state.defaults.altMinM || 3000}–${state.defaults.altMaxM || 15000} 米之间`, true);
            return;
        }
        issue(ac, `高度 ${Math.round(value)}`);
    });
    $('quick-direct')?.addEventListener('click', () => {
        const ac = selectedAircraft();
        const point = routePointsFor(ac).find(p => String(p.id) === $('quick-waypoint')?.value);
        if (ac && point && canIssue(ac, 'DIRECT')) issue(ac, `直飞 ${point.name}`);
    });
    $('quick-assign-runway')?.addEventListener('click', () => {
        const ac = selectedAircraft();
        const runway = $('quick-runway')?.value;
        if (ac && runway) issue(ac, `跑道 ${runway}`);
    });
    $('quick-flight-levels')?.addEventListener('click', event => {
        const button = event.target.closest('button[data-fl]');
        const ac = selectedAircraft();
        if (button && ac && canIssue(ac, 'ALT')) issue(ac, `高度 ${Math.round(Number(button.dataset.fl) * 30.48)}`);
    });
    $('quick-go-around')?.addEventListener('click', () => {
        const ac = selectedAircraft();
        if (ac && canIssue(ac, 'GOAROUND')) issue(ac, '复飞');
    });
    $('quick-handoff')?.addEventListener('click', () => {
        const ac = selectedAircraft();
        const next = ac ? nextUnit((ac.unit || state.activeView).split('-')[0], flowOf(ac)) : null;
        if (ac && next && canIssue(ac, 'HANDOFF')) issue(ac, `移交${unit(next).name}`);
    });
    [['quick-takeoff', 'TAKEOFF', '可以起飞'], ['quick-approach', 'APPROACH', 'ILS 进近'], ['quick-land', 'LAND', '可以落地']].forEach(([id, type, words]) => {
        $(id)?.addEventListener('click', () => {
            const ac = selectedAircraft();
            const runway = $('quick-runway')?.value || ac?.runway;
            if (ac && canIssue(ac, type)) issue(ac, `${words}${runway ? ` 跑道 ${runway}` : ''}`);
        });
    });
    $('radar-advanced-toggle')?.addEventListener('click', event => {
        const open = $('right-panel').classList.toggle('advanced-open');
        event.currentTarget.setAttribute('aria-expanded', String(open));
        event.currentTarget.textContent = open ? '收起高级工具与完整指令 ▴' : '展开高级工具与完整指令 ▾';
    });
    updateQuickControl(true);
}
