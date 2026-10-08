/**
 * game/session.js — 班次（Session）、输入录制与游戏循环装配（游戏层）
 *
 * 职责：
 *   · 装配：把领域层的逐帧推进 `syncAircraftState` 注册进仿真层钩子（依赖倒置的注入点）
 *   · 输入录制：记录管制员每条文本指令（含模拟时刻）—— 复盘与评分的数据基础
 *   · 采样：订阅 `clock:tick`，按 1Hz 采样各机高度/速度/航向（高度剖面图数据源）
 *   · P1 班次玩法：装载关卡 → 启动导演（无限流量 + 场景事件）→ 逐帧记分 → 结算（评级/目标/时间轴）
 *
 * 边界：班次内**实时不可回溯**（时间轴拖动在游戏模式被拦截，见 interaction/toolbar.js），
 * 复盘依赖 game/scoring.js 的事件时间轴与 game/director.js 的场景事件序列。
 */

import { state, addComm, setPlaying } from '../core/store.js';
import { bus, EV } from '../core/eventBus.js';
import { resetClockAccumulator } from '../core/clock.js';
import { onAircraftStep } from '../simulation/motion.js';
import { syncAircraftState, sampleAllAircraftHistory } from '../domain/aircraft.js';
import {
    startDirector, stopDirector, tickDirector, directorGoal, directorSummary
} from './director.js';
import { resetScoring, tickScoring, scoringSummary, scoreTimeline, setScoringScenario } from './scoring.js';
import {
    startEvents, stopEvents, tickEvents, resolveEvents
} from './events.js';
import {
    defaultScenario, normalizeScenario, scenarioFromLocation, scenarioSummary, DIFFICULTY, difficultyCurveFor
} from './scenario.js';
import { getBuiltinScenario } from '../data/scenarios.js';
import { seedReadback } from '../domain/readback.js';
import { defaultObjectives, evaluateObjectives } from './objectives.js';

/** 当前班次（P0：应用启动即值班；游戏模式由 startGameSession 装载关卡） */
let session = null;
/** 上一次结算结果（结果页读取；新班次开始时清除） */
let lastResult = null;

/**
 * 开始一个班次。
 * @param {object} [meta] 班次元信息（场景 id / 难度 / 焦点机场等）
 */
export function startSession(meta = {}) {
    state.gameSessionActive = meta.kind === 'game';
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

export function isSessionActive() {
    return !!session && !session.ended && session.meta.kind === 'game';
}

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
    state.gameSessionActive = false;
    return {
        id: session.id,
        simDuration: state.time - session.startedAtSim,
        inputs: session.inputs.length,
        clearances: state.aircraft.reduce((n, ac) => n + (ac.clearances ? ac.clearances.length : 0), 0),
        landed: state.aircraft.filter(ac => ac.landed).length,
        handoffs: state.aircraft.filter(ac => ac.handoffTime !== undefined).length
    };
}

/* ---------------- P1 班次玩法：装载 / 结算 ---------------- */

/** 当前班次的目标集（关卡可覆盖默认目标） */
export function currentObjectives() {
    return (session && session.meta && session.meta.objectives) || defaultObjectives();
}

/** 当前关卡的导演状态快照 */
export function currentDirector() { return directorSummary(); }

/** 上一次结算结果 */
export function sessionResult() { return lastResult; }

/**
 * 开始班次（游戏模式）：装载关卡 → 清空沙盒流量 → 启动导演与记分 → 开始播放。
 * @param {{scenarioId?:string, scenario?:object, seed?:number, difficulty?:string, progress?:number, airport?:string}} [opts]
 *   scenarioId 为内置关卡 id（L1/L2/L3，自带难度）；未给则优先用已导入的位置文件，其次自由流量班次
 * @returns {{session:object, scenario:object, summary:object}}
 */
export function startGameSession(opts = {}) {
    const builtin = getBuiltinScenario(opts.scenarioId);
    const scenario = normalizeScenario(
        opts.scenario
        || builtin
        || (state.location && state.location.mainAirport
            ? scenarioFromLocation(state.location, opts)
            : defaultScenario(opts))
    );
    const dif = DIFFICULTY[scenario.difficulty] || DIFFICULTY.standard;

    // 班次从零开始：清空沙盒航班与导演自动航路（用户自建航路点/航线保留）
    state.aircraft = [];
    state.routes = state.routes.filter(r => !r.auto);
    state.selectedItem = null;
    state.time = 0;
    resetClockAccumulator();
    lastResult = null;

    // 难度相关的运行期参数：复诵错诵概率（拟真 > 标准 > 街机）
    state.defaults.readbackErrorRate = dif.readbackErrorRate;
    seedReadback(scenario.seed);                 // 复诵抽取用同一 seed → 可复现

    session = startSession({
        kind: 'game',
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        scenarioBrief: scenario.brief || '',
        difficulty: scenario.difficulty,
        objectives: scenario.objectives || defaultObjectives()
    });
    setScoringScenario(scenario);                // 跑道构型/门槛优先取关卡数据
    resetScoring({ progress: opts.progress ?? 0, configIndex: 0 });
    // 难度曲线：随经营天数增长（事件频率倍率由此进入 startEvents 的调度间隔）
    const curve = difficultyCurveFor(state.management, { scenario });
    state.difficultyCurve = curve;
    startDirector({ scenario, seed: opts.seed });
    startEvents({ seed: opts.seed ?? scenario.seed, difficulty: scenario.difficulty, curve });
    setPlaying(true);

    const summary = scenarioSummary(scenario);
    bus.emit(EV.SESSION_STARTED, { session, scenario: summary });
    addComm('atc', `班次开始：${summary.name} · 难度 ${summary.difficultyLabel} · 机场 ${summary.airport}`);
    if (scenario.brief) addComm('atc', `任务提示：${scenario.brief}`);
    addComm('atc', `进场点 ${summary.entrypoints} 个 · 航司 ${summary.airlines} 家 · 场景事件 ${summary.events} 条 · `
        + `跑道构型 ${summary.configurations} 组 · 复诵错诵率 ${Math.round(dif.readbackErrorRate * 100)}%`);
    addComm('atc', summary.finish
        ? `班次目标：落地 ${summary.finish.count} 架${summary.finish.timeLimit ? ` / 时限 ${summary.finish.timeLimit}s` : ''}`
        : '班次目标：无限流量（按目标清单结算）');
    return { session, scenario, summary };
}

/**
 * 结束班次并结算：导演停止 → 评分汇总 → 目标达成评估 → 评级与事件时间轴。
 * @param {{reason?:string, auto?:boolean}} [opts]
 * @returns {object} 结算结果（同时广播 session:ended）
 */
export function endGameSession(opts = {}) {
    const wasActive = isSessionActive();
    const summary = endSession();                 // 时长 / 输入 / 许可 / 落地 / 移交 汇总
    stopDirector();
    stopEvents();                                 // 清空进行中的特情调度（active 归零）
    setPlaying(false);

    const sc = scoringSummary();
    const objectives = evaluateObjectives(currentObjectives(), { scoring: sc, session: summary });
    const result = {
        sessionId: summary ? summary.id : null,
        scenarioName: session && session.meta ? session.meta.scenarioName : null,
        difficulty: session && session.meta ? session.meta.difficulty : null,
        simDuration: summary ? Math.round(summary.simDuration) : 0,
        score: sc.score,
        grade: sc.grade,
        gradeLabel: sc.gradeLabel,
        progress: sc.progress,
        landed: sc.landed,
        streak: sc.streak,
        penaltyTotal: sc.penaltyTotal,
        bonusTotal: sc.bonusTotal,
        avgDelaySec: sc.avgDelaySec,
        counts: sc.counts,
        runway: sc.runway,
        objectives,
        timeline: scoreTimeline(20),
        inputs: summary ? summary.inputs : 0,
        handoffs: summary ? summary.handoffs : 0,
        reason: opts.reason || (wasActive ? '手动结束' : '无进行中的班次'),
        auto: !!opts.auto
    };
    lastResult = result;
    bus.emit(EV.SESSION_ENDED, result);
    addComm('atc', `班次结束（${result.reason}）：${result.gradeLabel} · 得分 ${result.score}`
        + ` · 落地 ${result.landed} 架 · 平均延误 ${result.avgDelaySec}s · 目标达成 ${objectives.passed}/${objectives.total}`);
    return result;
}

/**
 * 每个时钟步进：导演推进（流量注入 + 场景事件）→ 评分记账 → 完成条件判定。
 * 由 initSessionWiring 订阅 clock:tick 调用。
 */
export function tickSession() {
    if (!isSessionActive()) return;
    tickDirector();
    tickScoring();
    tickEvents();          // 随机特情抽检/推进
    resolveEvents();       // 特情消解/到期释放
    const goal = directorGoal();
    if (goal.met) endGameSession({ reason: goal.reason, auto: true });
}

/**
 * 装配：把领域层推进与采样接入仿真循环与时钟。由 js/main.js 启动时调用一次。
 */
export function initSessionWiring() {
    onAircraftStep(syncAircraftState);
    bus.on(EV.CLOCK_TICK, sampleAllAircraftHistory);
    bus.on(EV.CLOCK_TICK, tickSession);          // 班次内：导演 + 评分 + 完成条件
    if (!session) startSession({ kind: 'sandbox' });
}
