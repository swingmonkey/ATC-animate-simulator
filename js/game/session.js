/**
 * game/session.js — 班次（Session）、输入录制与领域层装配（游戏层）
 *
 * P0 职责：
 *   · 装配：把领域层的逐帧推进 `syncAircraftState` 注册进仿真层钩子（依赖倒置的注入点）
 *   · 输入录制：记录管制员每条文本指令（含模拟时刻）—— 复盘与评分的数据基础
 *   · 采样：订阅 `clock:tick`，按 1Hz 采样各机高度/速度/航向（高度剖面图数据源）
 *
 * P1 将在此基础上加入：关卡装载、交通流调度（director）、目标判定与评分、结果页。
 */

import { state } from '../core/store.js';
import { bus, EV } from '../core/eventBus.js';
import { onAircraftStep } from '../simulation/motion.js';
import { syncAircraftState, sampleAllAircraftHistory } from '../domain/aircraft.js';

/** 当前班次（P0：应用启动即值班；P1 改为由关卡启动） */
let session = null;

/**
 * 开始一个班次。
 * @param {object} [meta] 班次元信息（场景 id / 难度 / 焦点机场等）
 */
export function startSession(meta = {}) {
    session = {
        id: `s${Date.now()}`,
        startedAtReal: Date.now(),
        startedAtSim: state.time,
        meta,
        inputs: [],
        ended: false
    };
    return session;
}

export function currentSession() { return session; }

export function isSessionActive() { return !!session && !session.ended; }

/**
 * 记录一条管制员输入（由通讯面板/指令台调用）。
 * @param {string} text 原始输入文本
 * @param {'console'|'quick'|'click'} [source] 输入来源
 * @returns {{t:number,text:string,source:string}|null} 录制条目
 */
export function recordInput(text, source = 'console') {
    if (!text || !text.trim()) return null;
    if (!session) startSession({ kind: 'sandbox' });
    const entry = { t: state.time, text: text.trim(), source };
    session.inputs.push(entry);
    return entry;
}

/**
 * 结束班次并返回汇总（P1 的评分入口）。
 * @returns {{id:string, simDuration:number, inputs:number, clearances:number, landed:number, handoffs:number}|null}
 */
export function endSession() {
    if (!session) return null;
    session.ended = true;
    return {
        id: session.id,
        simDuration: state.time - session.startedAtSim,
        inputs: session.inputs.length,
        clearances: state.aircraft.reduce((n, ac) => n + (ac.clearances ? ac.clearances.length : 0), 0),
        landed: state.aircraft.filter(ac => ac.landed).length,
        handoffs: state.aircraft.filter(ac => ac.handoffTime !== undefined).length
    };
}

/**
 * 装配：把领域层推进与采样接入仿真循环与时钟。由 js/main.js 启动时调用一次。
 */
export function initSessionWiring() {
    onAircraftStep(syncAircraftState);
    bus.on(EV.CLOCK_TICK, sampleAllAircraftHistory);
    if (!session) startSession({ kind: 'sandbox' });
}
