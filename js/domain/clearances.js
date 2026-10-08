/**
 * domain/clearances.js — 管制许可与复诵记录（领域层）
 *
 * 由原 simulation/units.js 的“许可”部分上迁而来。许可分三类（对标 openScope 的 clearance）：
 *   · 塔台：起飞许可、落地许可、跑道指派
 *   · 进近：进近许可（ILS / RNAV / VOR-DME / 目视）+ 下高度调速
 * 每条许可都会写入 ac.clearances（含下发时刻与复诵状态），供进程单、评分与复盘读取；
 * 通话播报是成对的“管制指令 + 机组复诵”，与真实陆空通话一致。
 */

import { state, addComm } from '../core/store.js';
import { bus, EV } from '../core/eventBus.js';
import { setAltitudeConstraint, setSpeedConstraint, setHeadingConstraint } from '../simulation/constraints.js';
import { runwayHeading } from '../data/airports.js';
import { APPROACH_TYPES, approachLabel } from '../data/atcUnits.js';
import { referenceAirportCode, assignRunway, normalizeRunway } from './airspace.js';
import { flowOf } from './phases.js';
import { noteCorrectReadback } from './readback.js';
import { APPROACH_ALT, APPROACH_SPD, LANDING_ALT, LANDING_SPD } from '../core/constants.js';

/** 席位通话发送方键（commPanel 映射为 [塔台]/[进近]/[区调]） */
function seatSender(code) {
    return (code || 'ACC').toLowerCase();
}

/** 记录一条许可（含下发时刻，复诵状态默认为已确认） */
export function recordClearance(ac, type, args = null) {
    if (!ac.clearances) ac.clearances = [];
    const entry = { type, args, issuedAt: state.time, readback: 'ok' };
    ac.clearances.push(entry);
    return entry;
}

/** 取某类最近一条许可记录（进程单/HUD 显示用） */
export function lastClearanceOf(ac, type) {
    if (!ac.clearances) return null;
    for (let i = ac.clearances.length - 1; i >= 0; i--) {
        if (ac.clearances[i].type === type) return ac.clearances[i];
    }
    return null;
}

/** 进程单 / 对话框用的管制状态文本 */
export function clearanceText(ac) {
    if (ac.landed) return '已落地';
    if (ac.clearance === 'land') return '已发落地许可';
    if (ac.flow === 'departure' || ac.clearance === 'takeoff') {
        return ac.clearance === 'takeoff' ? '已放行起飞' : '待起飞放行';
    }
    if (ac.approachType) return `${approachLabel(ac.approachType)}进近中`;
    return '待进近许可';
}

/** 起飞许可（塔台）：按计划高度/速度放行离港航班 */
export function issueTakeoffClearance(ac, options = {}) {
    if (ac.landed || flowOf(ac) !== 'departure' || ac.clearance === 'takeoff'
        || (ac.groundStage && ac.groundStage !== 'lineup')) return false;
    if (!ac.flow) ac.flow = 'departure';
    ac.clearance = 'takeoff';
    ac.groundStage = 'takeoff';
    ac.takeoffTime = state.time;
    if (!ac.runway) ac.runway = assignRunway(ac);
    setAltitudeConstraint(ac, ac.plannedAltitude ?? state.defaults.altitude);
    setSpeedConstraint(ac, ac.plannedSpeed ?? state.defaults.speed);
    recordClearance(ac, 'TAKEOFF', { runway: ac.runway });
    addComm(seatSender(ac.unit || 'TWR'), `${ac.flightNo}，跑道 ${ac.runway}，可以起飞。`);
    addComm('pilot', `跑道 ${ac.runway}，可以起飞，${ac.flightNo}。`);
    noteCorrectReadback(ac, `跑道 ${ac.runway}，可以起飞，${ac.flightNo}`);
    bus.emit(EV.UNIT_CHANGED, { ac, clearance: 'takeoff', auto: !!options.auto });
    return true;
}

/**
 * 进近许可（进近）：指派进近方式与跑道，并给出典型的下高度调速目标。
 * ILS / RNAV 在「自由 / 航向」模式下同时把航道航向压给航空器（航线模式下继续沿航线飞行）。
 * @returns {{ok:boolean, approachType:string, runway:string, headingApplied:boolean}}
 */
export function issueApproachClearance(ac, approachType, runwayLabel) {
    const type = approachType && APPROACH_TYPES[approachType] ? approachType : 'ILS';
    ac.approachType = type;
    if (!ac.flow) ac.flow = 'arrival';
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
    recordClearance(ac, 'APPROACH', { approachType: type, runway: ac.runway });
    addComm(seatSender(ac.unit || 'APP'), `${ac.flightNo}，可以${approachLabel(type)}，跑道 ${ac.runway}。`);
    addComm('pilot', `${approachLabel(type)}，跑道 ${ac.runway}，${ac.flightNo}。`);
    noteCorrectReadback(ac, `${approachLabel(type)}，跑道 ${ac.runway}，${ac.flightNo}`);
    bus.emit(EV.UNIT_CHANGED, { ac, clearance: 'approach', approachType: type });
    return { ok: true, approachType: type, runway: ac.runway, headingApplied };
}

/** 落地许可（塔台）：下到决断高度并减速；随后由 domain/aircraft.js 判定接地 */
export function issueLandingClearance(ac, runwayLabel) {
    if (ac.landed) return false;
    const normalized = runwayLabel ? normalizeRunway(runwayLabel) : null;
    if (normalized) ac.runway = normalized;
    if (!ac.runway) ac.runway = assignRunway(ac, 0);
    if (!ac.flow) ac.flow = 'arrival';
    ac.clearance = 'land';
    setAltitudeConstraint(ac, LANDING_ALT);
    setSpeedConstraint(ac, LANDING_SPD);
    recordClearance(ac, 'LAND', { runway: ac.runway });
    addComm(seatSender(ac.unit || 'TWR'), `${ac.flightNo}，跑道 ${ac.runway}，可以落地。`);
    addComm('pilot', `跑道 ${ac.runway}，可以落地，${ac.flightNo}。`);
    noteCorrectReadback(ac, `跑道 ${ac.runway}，可以落地，${ac.flightNo}`);
    bus.emit(EV.UNIT_CHANGED, { ac, clearance: 'land' });
    return true;
}

/** 跑道指派（塔台/进近通用，仅记录不触发机动） */
export function assignRunwayClearance(ac, runwayLabel) {
    const rn = normalizeRunway(runwayLabel);
    if (!rn) return false;
    ac.runway = rn;
    recordClearance(ac, 'EXPECT_RWY', { runway: rn });
    addComm('atc', `${ac.flightNo}，预计使用跑道 ${rn}。`);
    return true;
}

/** 复飞标记（由指令层调用；阶段推导与评分据此判定） */
export function markGoAround(ac) {
    ac.goAround = true;
    ac.goAroundTime = state.time;
    recordClearance(ac, 'GO_AROUND', { runway: ac.runway || null });
}
