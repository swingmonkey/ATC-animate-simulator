/**
 * domain/airspace.js — 管制席位、扇区与跑道（领域层）
 *
 * 由原 simulation/units.js 的“席位/跑道”部分上迁而来（units.js 已删除，不留兼容 shim）。
 * 职责：
 *   · 席位归属：按「距参考机场的水平距离」解算 TWR / APP / ACC，带边界迟滞
 *   · 移交（handoff）：自动/手动切换席位，播报成对的管制指令与机组复诵
 *   · 跑道：由机场跑道数据指派（有风时选逆风端）、跑道号规范化
 *
 * 尺度约定：距离换算一律使用 pxToKmFixed（不含 viewScale），
 * 因此缩放地图不会改变席位归属判定，也保证时间轴重放结果一致。
 */

import { state, addComm } from '../core/store.js';
import { bus, EV, requestRedraw } from '../core/eventBus.js';
import { pxToKmFixed } from '../core/viewport.js';
import { posX, posY } from '../core/accessors.js';
import { getAirport, runwayList, runwayEnd, runwayHeading } from '../data/airports.js';
import { ATC_UNITS, UNIT_ORDER, nextUnit, unit, unitFrequency } from '../data/atcUnits.js';
import { windAt } from '../weather/weather.js';
import { UNIT_SCOPE_HYSTERESIS } from '../core/constants.js';
import { flowOf } from './phases.js';

/* ---------------- 参考机场与距离 ---------------- */

/** 参考机场：进港取目的地、离港取起飞机场（都没有时回退场景焦点机场） */
export function referenceAirportCode(ac) {
    const flow = flowOf(ac);
    const code = flow === 'departure'
        ? (ac.departure || ac.destination)
        : (ac.destination || ac.departure);
    return code || state.focusAirport;
}

/** 航空器到某机场的水平距离 (km)；机场不存在返回 Infinity */
export function distanceToAirportKm(ac, code) {
    const ap = getAirport(code);
    if (!ap) return Infinity;
    const dx = posX(ac) - ap.x, dy = posY(ac) - ap.y;
    return pxToKmFixed(Math.sqrt(dx * dx + dy * dy));
}

/* ---------------- 席位归属 ---------------- */

/**
 * 由距离解算席位：由内到外依次判断；已在该席位的航空器使用放大边界（迟滞），
 * 避免航空器在边界上左右横跳导致反复移交。
 */
export function resolveUnitForDistance(distKm, currentUnit) {
    const inScope = code => distKm <= ATC_UNITS[code].scopeKm * (currentUnit === code ? UNIT_SCOPE_HYSTERESIS : 1);
    if (inScope('TWR')) return 'TWR';
    if (inScope('APP')) return 'APP';
    return 'ACC';
}

/** 航空器当前应有的席位（不改状态，供面板/渲染读取） */
export function unitOfAircraft(ac) {
    if (ac.unit) return ac.unit;
    return resolveUnitForDistance(distanceToAirportKm(ac, referenceAirportCode(ac)), null);
}

/** 通话发送方键：席位代码小写（commPanel 映射为 [塔台]/[进近]/[区调]） */
function seatSender(code) {
    return (code || 'ACC').toLowerCase();
}

/**
 * 移交：切换席位并播报成对的管制指令与机组复诵。
 * @param {object} ac 航空器
 * @param {string} toCode 目标席位代码（TWR/APP/ACC）
 * @param {{auto?:boolean}} [options]
 * @returns {boolean} 是否发生了移交
 */
export function handoffAircraft(ac, toCode, options = {}) {
    if (!toCode || !ATC_UNITS[toCode]) return false;
    const from = ac.unit;
    if (from === toCode) return false;
    ac.unit = toCode;
    ac.unitTarget = toCode;
    ac.handoffTime = state.time;
    const freq = unitFrequency(toCode, referenceAirportCode(ac));
    addComm(seatSender(from || toCode), `${ac.flightNo}，联系${unit(toCode).name} ${freq}。`);
    addComm('pilot', `${unit(toCode).name} ${freq}，${ac.flightNo}。`);
    bus.emit(EV.UNIT_CHANGED, { ac, from, to: toCode, auto: !!options.auto });
    requestRedraw();
    return true;
}

/** 向下一席位移交（进港由外到内、离港由内到外）；已是席位链端点则返回 false */
export function handoffToNextUnit(ac) {
    const next = nextUnit(ac.unit || 'ACC', flowOf(ac));
    if (!next) return false;
    return handoffAircraft(ac, next);
}

/** 席位统计：各席位在管架数 + 待移交架数（席位面板用） */
export function unitSummary() {
    const summary = {};
    UNIT_ORDER.forEach(code => { summary[code] = { code, count: 0, pending: 0 }; });
    state.aircraft.forEach(ac => {
        if (state.time < (ac.startTime || 0) || ac.landed) return;
        const code = ac.unit || 'ACC';
        if (!summary[code]) return;
        summary[code].count++;
        if (ac.unitTarget && ac.unitTarget !== code) summary[code].pending++;
    });
    return summary;
}

/* ---------------- 跑道 ---------------- */

/** 跑道号规范化：'2l' / '跑道02L' → '02L'；非法返回 null */
export function normalizeRunway(text) {
    const m = String(text || '').toUpperCase().replace(/\s+/g, '').match(/(\d{1,2})([LRC]?)/);
    if (!m) return null;
    const num = parseInt(m[1], 10);
    if (isNaN(num) || num < 1 || num > 36) return null;
    return String(num).padStart(2, '0') + m[2];
}

/**
 * 指派跑道：随机取一条跑道；天气开启时按风场选择逆风端。
 * @param {string} airportCode 机场四字码
 * @param {number} [preferEnd] 0 = 跑道对前段，1 = 后段
 */
export function assignRunwayFor(airportCode, preferEnd = 0) {
    const pairs = runwayList(airportCode);
    const pair = pairs[Math.floor(Math.random() * pairs.length)];
    let end = preferEnd;
    const ap = getAirport(airportCode);
    if (ap) {
        const w = windAt(ap.x, ap.y);
        const windTo = w && typeof w.hdg === 'number' ? w.hdg : null;
        const h0 = runwayHeading(runwayEnd(pair, 0));
        const h1 = runwayHeading(runwayEnd(pair, 1));
        if (windTo !== null && h0 !== null && h1 !== null) {
            const windFrom = (windTo + 180) % 360;
            const angleDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
            end = angleDiff(h0, windFrom) <= angleDiff(h1, windFrom) ? 0 : 1;
        }
    }
    return runwayEnd(pair, end);
}

/** 按航空器的参考机场指派跑道 */
export function assignRunway(ac, preferEnd = 0) {
    return assignRunwayFor(referenceAirportCode(ac), preferEnd);
}

/** 参考机场跑道端点列表（飞机对话框跑道下拉用） */
export function runwayEndsFor(airportCode) {
    const ends = [];
    runwayList(airportCode).forEach(pair => {
        ends.push(runwayEnd(pair, 0), runwayEnd(pair, 1));
    });
    return ends;
}
