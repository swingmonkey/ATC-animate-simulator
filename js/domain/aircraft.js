/**
 * domain/aircraft.js — 航空器模型与逐帧状态推进（领域层）
 *
 * 职责：
 *   · 对象规范化（flow / phase / wake / clearances 字段统一，生成器·编辑器·旧存档迁移共用）
 *   · 每模拟秒推进：席位归属（含迟滞）→ 自动移交 → 自动许可链 → 接地判定 → 阶段同步
 *   · 状态采样：高度/速度/航向按 1Hz 环形写入 ac.history（P2 高度剖面图的数据源）
 *
 * 调用方式：由 js/main.js 通过 simulation/motion.js 的 onAircraftStep() 注册（依赖倒置，
 * 仿真层不反向依赖领域层）。
 */

import { state, addComm } from '../core/store.js';
import { bus, EV, requestRedraw } from '../core/eventBus.js';
import { altOf, spdOf, hdgOf } from '../core/accessors.js';
import { AUTO_TAKEOFF_DELAY, LANDING_ARRIVE_KM, LANDING_ARRIVE_ALT } from '../core/constants.js';
import { derivePhase, flowOf, syncPhase } from './phases.js';
import {
    referenceAirportCode, distanceToAirportKm, resolveUnitForDistance, handoffAircraft
} from './airspace.js';
import {
    issueTakeoffClearance, issueApproachClearance, issueLandingClearance
} from './clearances.js';
import { issueGroundAction, checkCrossingAltitude } from './dutyOps.js';

/* ---------------- 尾流类别 ---------------- */

const WAKE_HEAVY = new Set(['B777', 'B787', 'A330', 'A350', 'A380', 'B747', 'B767', 'A300']);
const WAKE_LIGHT = new Set(['E190', 'E195', 'CRJ900', 'ARJ21']);

/**
 * 尾流类别（H/M/L，简化：按机型分档，真实标准见 P3）。
 * 间隔标准（时间/距离加码）在 P3 的 separation 中按类别加权。
 */
export function wakeOf(acType) {
    const t = String(acType || '').toUpperCase();
    if (WAKE_HEAVY.has(t)) return 'H';
    if (WAKE_LIGHT.has(t)) return 'L';
    return 'M';
}

/* ---------------- 对象规范化 ---------------- */

/**
 * 规范化航空器对象：补齐新领域字段。
 * 旧存档把进/离港写在 ac.phase（'arrival'|'departure'），此处迁移为 ac.flow 并重新推导阶段。
 * @returns {object} 同一个对象（便于链式调用）
 */
export function normalizeAircraft(ac) {
    if (!ac.flow) ac.flow = flowOf(ac);
    if (!ac.wake) ac.wake = wakeOf(ac.acType);
    if (!ac.clearances) ac.clearances = [];
    if (!ac.history) ac.history = [];
    if (!ac.phase || ac.phase === 'arrival' || ac.phase === 'departure') {
        ac.phase = derivePhase(ac);
    }
    return ac;
}

/* ---------------- 逐帧推进 ---------------- */

/**
 * 自动许可链（可在席位面板关闭）：离港放行（塔台）→ 进近许可（进近）→ 落地许可（塔台）。
 * 关闭后全部改为手动下发，「塔台 · 进近 · 区调」流程仍随距离自动移交。
 */
function applyAutoClearance(ac) {
    if (flowOf(ac) === 'departure') {
        const elapsed = state.time - (ac.startTime || 0);
        if (ac.unit === 'TWR' && ac.groundStage && !ac.clearance) {
            if (elapsed >= 10 && ac.groundStage === 'parked') issueGroundAction(ac, 'pushback', { auto: true });
            if (elapsed >= 20 && ac.groundStage === 'pushed') issueGroundAction(ac, 'startup', { auto: true });
            if (elapsed >= 30 && ac.groundStage === 'started') issueGroundAction(ac, 'taxi', { auto: true });
            if (elapsed >= 40 && ac.groundStage === 'taxi') issueGroundAction(ac, 'lineup', { auto: true });
        }
        if (!ac.clearance && ac.unit === 'TWR'
            && elapsed >= AUTO_TAKEOFF_DELAY) {
            issueTakeoffClearance(ac, { auto: true });
        }
        return;
    }
    if (!ac.approachType && (ac.unit === 'APP' || ac.unit === 'TWR')) {
        issueApproachClearance(ac, 'ILS');
    } else if (ac.approachType && ac.unit === 'TWR' && ac.clearance !== 'land') {
        issueLandingClearance(ac);
    }
}

/** 接地判定：已发落地许可 + 已进入塔台区 + 距离/高度到位 → 落地完成（离开雷达） */
function checkLanding(ac) {
    if (!state.isPlaying || ac.landed) return;
    if (ac.clearance !== 'land') return;
    if (distanceToAirportKm(ac, referenceAirportCode(ac)) > LANDING_ARRIVE_KM) return;
    if (altOf(ac) > LANDING_ARRIVE_ALT) return;
    ac.landed = true;
    ac.landedTime = state.time;
    ac.goAround = false;
    ac._visible = false;
    addComm('pilot', `${ac.flightNo} 已落地，跑道 ${ac.runway || '--'} 脱离，谢谢指挥，再见。`);
    bus.emit(EV.UNIT_CHANGED, { ac, landed: true });
    requestRedraw();
}

/**
 * 每个业务时钟步进单架航空器（由 motion.js 的位置循环经钩子调用）：
 * 席位 → 自动许可 → 接地 → 阶段。
 * 非播放（暂停/回放跳转）时不产生通话，只静默同步席位与阶段。
 */
export function syncAircraftState(ac) {
    if (ac.landed) { ac._visible = false; return; }
    if (state.time < (ac.startTime || 0)) return;

    if (!ac.wake) ac.wake = wakeOf(ac.acType);

    /* 1. 席位归属与自动移交 */
    const target = resolveUnitForDistance(
        distanceToAirportKm(ac, referenceAirportCode(ac)), ac.unit
    );
    if (!ac.unit) {
        ac.unit = target;                 // 首次进入雷达：静默初始化
        ac.unitTarget = target;
    } else {
        ac.unitTarget = target;
        if (target !== ac.unit && state.autoHandoff && state.isPlaying) {
            handoffAircraft(ac, target, { auto: true });
        }
    }

    /* 2. 自动许可链 */
    if (state.isPlaying && state.autoClearance) applyAutoClearance(ac);

    /* 3. 接地判定与阶段同步 */
    checkLanding(ac);
    syncPhase(ac);
    checkCrossingAltitude(ac);
    if (ac.landed) ac._visible = false;
}

/* ---------------- 状态采样（高度剖面图 / 复盘的数据源） ---------------- */

/** 环形上限：5 分钟 @1Hz */
const HISTORY_MAX = 300;

/** 采样单架：同一模拟秒内只记一次（按 Math.floor(time) 去重） */
export function sampleAircraftHistory(ac) {
    if (state.time < (ac.startTime || 0)) return;
    const t = Math.floor(state.time);
    if (ac.historyLastT === t) return;
    ac.historyLastT = t;
    if (!ac.history) ac.history = [];
    ac.history.push({ t, alt: altOf(ac), spd: spdOf(ac), hdg: Math.round(hdgOf(ac)) });
    while (ac.history.length > HISTORY_MAX) ac.history.shift();
}

/** 采样全部航空器（由 game/session.js 订阅 clock:tick 后调用） */
export function sampleAllAircraftHistory() {
    state.aircraft.forEach(sampleAircraftHistory);
}

/**
 * 规范化整套场景：读档或批量生成后调用，逐架补齐领域字段
 * （旧存档的 ac.phase='arrival' 会在此迁移为 ac.flow + 重新推导阶段）。
 */
export function normalizeScene() {
    state.aircraft.forEach(normalizeAircraft);
}
