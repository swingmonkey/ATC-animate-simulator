/** 雷达值班的常用指令入口。所有操作仍走文字指令通道，以保留复诵、记录和评分。 */
import { state, isEditMode } from '../core/store.js';
import { altOf, hdgOf } from '../core/accessors.js';
import { canIssue, issueHint, phaseLabel } from '../domain/phases.js';
import { submitAtcText } from './commPanel.js';

const $ = id => document.getElementById(id);
const DEFAULT_HINT = '拖动飞机：松在航路点上直飞；松在空白处按方向引导。';
let lastAircraftId = null;
let lastPointsKey = '';
let lastRefresh = 0;

function selectedAircraft() {
    const item = state.selectedItem;
    if (item?.type !== 'aircraft') return null;
    return state.aircraft.find(ac => ac.id === item.id && state.time >= (ac.startTime || 0)) || null;
}

export function showQuickFeedback(message, error = false) {
    const box = $('quick-feedback');
    if (!box) return;
    box.textContent = message || DEFAULT_HINT;
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

function rebuildWaypoints() {
    const select = $('quick-waypoint');
    if (!select) return;
    const key = state.routePoints.map(point => `${point.id}:${point.name}`).join('|');
    if (key === lastPointsKey) return;
    lastPointsKey = key;
    const previous = select.value;
    select.replaceChildren();
    if (!state.routePoints.length) {
        select.add(new Option('暂无航路点', ''));
        return;
    }
    select.add(new Option('选择航路点…', ''));
    for (const point of state.routePoints) select.add(new Option(point.name || `点 ${point.id}`, String(point.id)));
    if ([...select.options].some(option => option.value === previous)) select.value = previous;
}

export function updateQuickControl(force = false) {
    const now = performance.now();
    if (!force && now - lastRefresh < 240) return;
    lastRefresh = now;
    rebuildWaypoints();
    const ac = selectedAircraft();
    const selectedChanged = (ac?.id ?? null) !== lastAircraftId;
    lastAircraftId = ac?.id ?? null;
    const readout = $('quick-readout');
    if (readout) readout.textContent = ac
        ? `${ac.flightNo}  ·  ${phaseLabel(ac.phase)}  ·  ${Math.round(altOf(ac))} m  ·  ${String(Math.round(hdgOf(ac)) % 360).padStart(3, '0')}°`
        : '点选雷达上的飞机或进程单，开始指挥。';
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
    control('quick-waypoint', ac, 'DIRECT', state.routePoints.length > 0);
    control('quick-direct', ac, 'DIRECT', !!$('quick-waypoint')?.value);
    control('quick-takeoff', ac, 'TAKEOFF');
    control('quick-approach', ac, 'APPROACH');
    control('quick-land', ac, 'LAND');
    if (selectedChanged) showQuickFeedback(ac ? DEFAULT_HINT : '点选飞机后，可拖动引导或使用上方按钮。');
}

export function initQuickControl() {
    $('quick-waypoint')?.addEventListener('change', () => updateQuickControl(true));
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
        const point = state.routePoints.find(p => String(p.id) === $('quick-waypoint')?.value);
        if (ac && point && canIssue(ac, 'DIRECT')) issue(ac, `直飞 ${point.name}`);
    });
    [['quick-takeoff', 'TAKEOFF', '可以起飞'], ['quick-approach', 'APPROACH', 'ILS 进近'], ['quick-land', 'LAND', '可以落地']].forEach(([id, type, words]) => {
        $(id)?.addEventListener('click', () => {
            const ac = selectedAircraft();
            if (ac && canIssue(ac, type)) issue(ac, `${words}${ac.runway ? ` 跑道 ${ac.runway}` : ''}`);
        });
    });
    $('radar-advanced-toggle')?.addEventListener('click', event => {
        const open = $('right-panel').classList.toggle('advanced-open');
        event.currentTarget.setAttribute('aria-expanded', String(open));
        event.currentTarget.textContent = open ? '收起高级工具与完整指令 ▴' : '展开高级工具与完整指令 ▾';
    });
    updateQuickControl(true);
}
