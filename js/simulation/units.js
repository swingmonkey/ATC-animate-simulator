/**
 * simulation/units.js — 管制席位归属、移交与塔台/进近许可（模拟层）
 *
 * 内容对标 openScope 的两类操作：
 *   · 席位/扇区（sector）：航空器按「距参考机场的距离」归属 塔台/进近/区调，跨界时移交（handoff）
 *   · 许可（clearance）：起飞许可、进近许可（ILS/RNAV/VOR/目视）、落地许可
 * 由 motion.js 的逐帧位置循环调用 updateAircraftUnitState，时间仍是唯一驱动：
 * 通话播报与落地判定都只在「播放中」发生，因此拖拽时间轴（scrub）不会刷屏。
 */

import { state, addComm } from '../core/store.js';
import { bus, EV, requestRedraw } from '../core/eventBus.js';
import { pxToKmFixed } from '../core/viewport.js';
import { posX, posY, altOf } from '../core/accessors.js';
import {
    setAltitudeConstraint, setSpeedConstraint, setHeadingConstraint
} from './constraints.js';
import { getAirport, runwayList, runwayEnd, runwayHeading } from '../data/airports.js';
import {
    ATC_UNITS, UNIT_ORDER, APPROACH_TYPES, approachLabel,
    nextUnit, unit, unitFrequency
} from '../data/atcUnits.js';
import { windAt } from '../weather/weather.js';
import {
    UNIT_SCOPE_HYSTERESIS, APPROACH_ALT, APPROACH_SPD, LANDING_ALT, LANDING_SPD,
    LANDING_ARRIVE_KM, LANDING_ARRIVE_ALT, AUTO_TAKEOFF_DELAY
} from '../core/constants.js';

/* ---------------- 阶段与参考机场 ---------------- */

/** 进港/离港阶段（缺省按有无目的地推断） */
export function phaseOf(ac) {
    if (ac.phase === 'arrival' || ac.phase === 'departure') return ac.phase;
    return ac.destination ? 'arrival' : 'departure';
}

/** 参考机场：进港取目的地、离港取起飞机场（都没有时回退场景焦点机场） */
export function referenceAirportCode(ac) {
    const phase = phaseOf(ac);
    const code = phase === 'departure' ? (ac.departure || ac.destination) : (ac.destination || ac.departure);
    return code || state.focusAirport;
}

/** 航空器到某机场的水平距离 (km)，机场不存在返回 Infinity */
export function distanceToAirportKm(ac, code) {
    const ap = getAirport(code);
    if (!ap) return Infinity;
    const dx = posX(ac) - ap.x, dy = posY(ac) - ap.y;
    return pxToKmFixed(Math.sqrt(dx * dx + dy * dy));
}

/* ---------------- 席位归属与移交 ---------------- */

/**
 * 由距离解算席位：由内到外依次判断，已在该席位的航空器使用放大后的边界（迟滞），
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
    return ac.unit || resolveUnitForDistance(distanceToAirportKm(ac, referenceAirportCode(ac)), null);
}

/** 通话发送方键：席位代码小写（commPanel 映射为 [塔台]/[进近]/[区调]） */
function seatSender(code) {
    return (code || 'ACC').toLowerCase();
}

/**
 * 手动/自动移交：切换席位并播报成对的管制指令与机组复诵。
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

/** 向下一席位移交（进港由外到内、离港由内到外），已是末端则不动作 */
export function handoffToNextUnit(ac) {
    const next = nextUnit(ac.unit || 'ACC', phaseOf(ac));
    if (!next) return false;
    return handoffAircraft(ac, next);
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
 * 指派跑道：随机取一条跑道，天气开启时按风场选择逆风方向的那一端。
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

/* ---------------- 许可（起飞 / 进近 / 落地） ---------------- */

/** 起飞许可（塔台）：按计划高度/速度放行离港航班 */
export function issueTakeoffClearance(ac, options = {}) {
    if (ac.landed || ac.clearance === 'takeoff') return false;
    ac.phase = ac.phase || 'departure';
    ac.clearance = 'takeoff';
    if (!ac.runway) ac.runway = assignRunway(ac);
    setAltitudeConstraint(ac, ac.plannedAltitude ?? state.defaults.altitude);
    setSpeedConstraint(ac, ac.plannedSpeed ?? state.defaults.speed);
    addComm(seatSender(ac.unit || 'TWR'), `${ac.flightNo}，跑道 ${ac.runway}，可以起飞。`);
    addComm('pilot', `跑道 ${ac.runway}，可以起飞，${ac.flightNo}。`);
    bus.emit(EV.UNIT_CHANGED, { ac, clearance: 'takeoff', auto: !!options.auto });
    return true;
}

/**
 * 进近许可（进近）：指派进近方式与跑道，并给出典型的下高度调速目标。
 * ILS/RNAV 在「自由/航向」模式下同时把航道航向压给航空器（航线模式下继续沿航线飞行）。
 * @returns {{ok:boolean, approachType:string, runway:string, headingApplied:boolean}}
 */
export function issueApproachClearance(ac, approachType, runwayLabel) {
    const type = approachType && APPROACH_TYPES[approachType] ? approachType : 'ILS';
    ac.approachType = type;
    ac.phase = ac.phase || 'arrival';
    const normalized = runwayLabel ? normalizeRunway(runwayLabel) : null;
    if (normalized) ac.runway = normalized;
    if (!ac.runway) ac.runway = assignRunway(ac, 0);
    setAltitudeConstraint(ac, APPROACH_ALT);
    setSpeedConstraint(ac, APPROACH_SPD);

    let headingApplied = false;
    const hdg = runwayHeading(ac.runway);
    if (hdg !== null && (ac.navMode === 'free' || ac.navMode === 'heading')) {
        setHeadingConstraint(ac, hdg);
        headingApplied = true;
    }
    addComm(seatSender(ac.unit || 'APP'), `${ac.flightNo}，可以${approachLabel(type)}，跑道 ${ac.runway}。`);
    addComm('pilot', `${approachLabel(type)}，跑道 ${ac.runway}，${ac.flightNo}。`);
    bus.emit(EV.UNIT_CHANGED, { ac, clearance: 'approach', approachType: type });
    return { ok: true, approachType: type, runway: ac.runway, headingApplied };
}

/** 落地许可（塔台）：下到决断高度并减速，随后由 checkLanding 判定接地 */
export function issueLandingClearance(ac, runwayLabel) {
    if (ac.landed) return false;
    const normalized = runwayLabel ? normalizeRunway(runwayLabel) : null;
    if (normalized) ac.runway = normalized;
    if (!ac.runway) ac.runway = assignRunway(ac, 0);
    ac.phase = ac.phase || 'arrival';
    ac.clearance = 'land';
    setAltitudeConstraint(ac, LANDING_ALT);
    setSpeedConstraint(ac, LANDING_SPD);
    addComm(seatSender(ac.unit || 'TWR'), `${ac.flightNo}，跑道 ${ac.runway}，可以落地。`);
    addComm('pilot', `跑道 ${ac.runway}，可以落地，${ac.flightNo}。`);
    bus.emit(EV.UNIT_CHANGED, { ac, clearance: 'land' });
    return true;
}

/** 接地判定：已发落地许可 + 已进入塔台区 + 距离/高度到位 → 落地完成（离开雷达） */
function checkLanding(ac) {
    if (!state.isPlaying || ac.landed) return;
    if (ac.clearance !== 'land') return;
    if (distanceToAirportKm(ac, referenceAirportCode(ac)) > LANDING_ARRIVE_KM) return;
    if (altOf(ac) > LANDING_ARRIVE_ALT) return;
    ac.landed = true;
    ac.landedTime = state.time;
    ac._visible = false;
    addComm('pilot', `${ac.flightNo} 已落地，跑道 ${ac.runway || '--'} 脱离，谢谢指挥，再见。`);
    bus.emit(EV.UNIT_CHANGED, { ac, landed: true });
    requestRedraw();
}

/* ---------------- 逐帧席位推进 ---------------- */

/**
 * 每帧对单架航空器推进席位状态（由 motion.js 的位置循环调用）：
 * 席位归属 → 自动移交 → 离港自动放行 → 接地判定。
 * 非播放（暂停/拖拽时间轴）时只静默同步席位，不产生通话。
 */
export function updateAircraftUnitState(ac) {
    if (ac.landed) { ac._visible = false; return; }
    if (state.time < (ac.startTime || 0)) return;

    const target = resolveUnitForDistance(
        distanceToAirportKm(ac, referenceAirportCode(ac)), ac.unit
    );

    if (!ac.unit) {                    // 首次进入雷达：静默初始化席位
        ac.unit = target;
        ac.unitTarget = target;
        return;
    }
    ac.unitTarget = target;
    if (target !== ac.unit && state.autoHandoff && state.isPlaying) {
        handoffAircraft(ac, target, { auto: true });
    }

    // 自动许可链：离港放行（塔台）→ 进近许可（进近）→ 落地许可（塔台），可在面板关闭
    if (state.isPlaying && state.autoClearance) {
        if (phaseOf(ac) === 'departure' && !ac.clearance && ac.unit === 'TWR'
            && (state.time - (ac.startTime || 0)) >= AUTO_TAKEOFF_DELAY) {
            issueTakeoffClearance(ac, { auto: true });
        } else if (phaseOf(ac) === 'arrival') {
            if (!ac.approachType && (ac.unit === 'APP' || ac.unit === 'TWR')) {
                issueApproachClearance(ac, 'ILS');
            } else if (ac.approachType && ac.unit === 'TWR' && ac.clearance !== 'land') {
                issueLandingClearance(ac);
            }
        }
    }

    checkLanding(ac);
}

/* ---------------- 展示辅助（界面层读取） ---------------- */

/** 席位统计：各席位管制架数 + 待移交架数（席位面板用） */
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

/** 进程单/对话框用的管制状态文本 */
export function clearanceText(ac) {
    if (ac.landed) return '已落地';
    if (ac.clearance === 'land') return '已发落地许可';
    if (phaseOf(ac) === 'departure' || ac.clearance === 'takeoff') {
        return ac.clearance === 'takeoff' ? '已放行起飞' : '待起飞放行';
    }
    if (ac.approachType) return `${approachLabel(ac.approachType)}进近中`;
    return '待进近许可';
}
