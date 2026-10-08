/**
 * domain/phases.js — 飞行阶段有限状态机（领域层）
 *
 * 目的：把「进港/离港」与「飞行阶段」彻底分开，并让“此刻允许下什么指令”成为可查询的领域知识，
 * 供指令台灰显（P1）、拟真难度拦截（P3）、进程单/标签显示与评分判定共用。
 *
 * 设计约束：阶段一律 **由状态推导**（derivePhase），不引入隐藏状态，
 * 因此时间轴拖动/输入重放后阶段必然一致（可复盘的前提）。
 *
 * 字段迁移：早期版本把 'arrival' | 'departure' 存在 ac.phase；现拆分为
 *   ac.flow   : 'arrival' | 'departure'   进港 / 离港
 *   ac.phase  : PHASE.*                    飞行阶段（本模块维护）
 * flowOf() 兼容旧字段，读档迁移见 core/persistence.js。
 */

import { state } from '../core/store.js';
import { bus, EV } from '../core/eventBus.js';
import { altOf } from '../core/accessors.js';

/** 飞行阶段枚举 */
export const PHASE = {
    /* 地面 */
    PARKED: 'PARKED',
    PUSHBACK: 'PUSHBACK',
    ENGINE_START: 'ENGINE_START',
    TAXI: 'TAXI',
    HOLD_SHORT: 'HOLD_SHORT',
    TAKEOFF_ROLL: 'TAKEOFF_ROLL',
    VACATE: 'VACATE',
    TAXI_IN: 'TAXI_IN',
    /* 离港空中 */
    INIT_CLIMB: 'INIT_CLIMB',
    CLIMB: 'CLIMB',
    CRUISE: 'CRUISE',
    /* 进港空中 */
    DESCENT: 'DESCENT',
    STAR: 'STAR',
    HOLD: 'HOLD',
    VECTOR: 'VECTOR',
    FINAL_APPROACH: 'FINAL_APPROACH',
    LANDING_ROLL: 'LANDING_ROLL',
    /* 终态与异常 */
    ARRIVED: 'ARRIVED',
    GO_AROUND: 'GO_AROUND'
};

/** 中文标签（进程单/标签/HUD 显示） */
export const PHASE_LABEL = {
    PARKED: '停机位',
    PUSHBACK: '推出',
    ENGINE_START: '开车',
    TAXI: '滑行',
    HOLD_SHORT: '等待放行',
    TAKEOFF_ROLL: '起飞滑跑',
    VACATE: '脱离跑道',
    TAXI_IN: '滑入',
    INIT_CLIMB: '初始爬升',
    CLIMB: '爬升',
    CRUISE: '巡航',
    DESCENT: '下降',
    STAR: '程序进近',
    HOLD: '等待',
    VECTOR: '雷达引导',
    FINAL_APPROACH: '五边进近',
    LANDING_ROLL: '着陆滑跑',
    ARRIVED: '已落地',
    GO_AROUND: '复飞'
};

const AIRBORNE = new Set([
    PHASE.INIT_CLIMB, PHASE.CLIMB, PHASE.CRUISE,
    PHASE.DESCENT, PHASE.STAR, PHASE.HOLD, PHASE.VECTOR,
    PHASE.FINAL_APPROACH, PHASE.LANDING_ROLL, PHASE.GO_AROUND
]);

const TERMINAL = new Set([
    PHASE.STAR, PHASE.HOLD, PHASE.VECTOR, PHASE.FINAL_APPROACH, PHASE.LANDING_ROLL
]);

/** 进港/离港流向（兼容早期把流向写在 ac.phase 的存档） */
export function flowOf(ac) {
    if (ac.flow === 'arrival' || ac.flow === 'departure') return ac.flow;
    if (ac.phase === 'arrival' || ac.phase === 'departure') return ac.phase;
    return ac.destination ? 'arrival' : 'departure';
}

export function isAirborne(phase) { return AIRBORNE.has(phase); }
export function isTerminal(phase) { return TERMINAL.has(phase); }
export function phaseGroup(phase) {
    if (TERMINAL.has(phase)) return 'terminal';
    if (AIRBORNE.has(phase)) return 'enroute';
    return 'ground';
}
export function phaseLabel(phase) { return PHASE_LABEL[phase] || phase || '--'; }

/**
 * 由航空器状态推导当前阶段（纯函数：只读 ac，不写状态）。
 * 判定顺序即优先级：终态 → 异常 → 流向（离港/进港）→ 具体阶段。
 */
export function derivePhase(ac) {
    if (ac.landed) return PHASE.ARRIVED;
    if (ac.goAround) return PHASE.GO_AROUND;

    const alt = altOf(ac);
    if (flowOf(ac) === 'departure') {
        if (!ac.clearance) {
            return { parked: PHASE.PARKED, pushed: PHASE.PUSHBACK, started: PHASE.ENGINE_START,
                taxi: PHASE.TAXI, lineup: PHASE.HOLD_SHORT }[ac.groundStage] || PHASE.HOLD_SHORT;
        }
        if (alt < 1500) return PHASE.INIT_CLIMB;
        const top = ac.plannedAltitude ?? state.defaults.altitude;
        return alt < top - 150 ? PHASE.CLIMB : PHASE.CRUISE;
    }

    // 进港
    const cleared = ac.clearance === 'land';
    if (cleared) return alt <= 150 ? PHASE.LANDING_ROLL : PHASE.FINAL_APPROACH;
    if (ac.approachType) {
        if (alt <= 900) return PHASE.FINAL_APPROACH;
        return (ac.navMode === 'heading' || ac.navMode === 'free') ? PHASE.VECTOR : PHASE.STAR;
    }
    if (ac.navMode === 'heading' || ac.navMode === 'free') return PHASE.VECTOR;
    if (ac.unit === 'APP' || ac.unit === 'TWR') return PHASE.STAR;   // 已进终端区，默认走程序
    const descending = ac.altCon !== undefined && ac.altCon !== null && ac.altCon < alt - 50;
    return (descending || alt < 7000) ? PHASE.DESCENT : PHASE.CRUISE;
}

/**
 * 同步阶段：推导后写回 ac.phase，变化时广播 phase:changed。
 * @returns {boolean} 是否发生变化
 */
export function syncPhase(ac) {
    const next = derivePhase(ac);
    if (ac.phase === next) return false;
    const from = ac.phase;
    ac.phase = next;
    ac.phaseTime = state.time;
    bus.emit(EV.PHASE_CHANGED, { ac, from, to: next });
    return true;
}

/* ---------------- 指令合法性（指令台灰显 / 拟真拦截共用） ---------------- */

/**
 * 指令类型 → 允许的阶段。
 * 'airborne' 表示“任何空中阶段均可”，数组表示白名单。
 */
const ISSUE_RULES = {
    ALT: 'airborne',
    SPD: 'airborne',
    HDG: 'airborne',
    DIRECT: 'airborne',
    HOLD: 'airborne',
    HANDOFF: 'airborne',
    EXPECT_RWY: 'airborne',
    GOAROUND: 'airborne',
    APPROACH: [PHASE.DESCENT, PHASE.STAR, PHASE.HOLD, PHASE.VECTOR, PHASE.FINAL_APPROACH],
    LAND: [PHASE.STAR, PHASE.HOLD, PHASE.VECTOR, PHASE.FINAL_APPROACH],
    TAKEOFF: [PHASE.PARKED, PHASE.TAXI, PHASE.HOLD_SHORT]
};

/** 该阶段是否允许下发某类指令 */
export function canIssue(ac, type) {
    const rule = ISSUE_RULES[type];
    if (!rule) return true;                     // 未登记的类型不拦截
    const phase = ac.phase || derivePhase(ac);
    if (type === 'TAKEOFF' && ac.groundStage && ac.groundStage !== 'lineup') return false;
    if (rule === 'airborne') return isAirborne(phase) && !ac.landed;
    return rule.includes(phase);
}

/** 不允许时的原因说明（指令台提示用；允许时返回空串） */
export function issueHint(ac, type) {
    if (canIssue(ac, type)) return '';
    const phase = ac.phase || derivePhase(ac);
    if (ac.landed) return '该航班已落地';
    if (type === 'LAND') return `尚未进入进近阶段（当前：${phaseLabel(phase)}）`;
    if (type === 'APPROACH') return `尚未进入终端区（当前：${phaseLabel(phase)}）`;
    if (type === 'TAKEOFF') return `不在等待放行阶段（当前：${phaseLabel(phase)}）`;
    return `当前阶段 ${phaseLabel(phase)} 不允许该指令`;
}

