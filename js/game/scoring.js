/**
 * game/scoring.js — 评分、目标输入与跑道构型解锁（游戏层）
 *
 * 两条分数轴（对应 docs/PLAN-v2.md §7.2 与 §13.4）：
 *   · performance（绩效分，0–100）—— 安全（间隔不足 / MVA 违规 / 复飞）+ 效率（延误）
 *     按 SCORE_WEIGHTS 扣分，最后映射到 S/A/B/C/D 评级：班次结算与 HUD 显示
 *   · progress（解锁进度分）—— 每落地一架 +1，[scenario] 的 `score` 事件可直接设定；
 *     驱动 [configurations] 的跑道开关（分数升高解锁跑道、降低关闭跑道）
 *
 * 计入去重：间隔配对 45 模拟秒、MVA 单机 60 模拟秒的冷却，避免同一违规被反复扣分。
 *
 * 依赖方向：core（0）、data（1）、domain（2）与同层模块；不触碰渲染与界面。
 */

import { state, addComm } from '../core/store.js';
import { bus, EV, requestRedraw } from '../core/eventBus.js';
import { reciprocalRunway, runwayList, runwayEnd } from '../data/airports.js';
import { flowOf } from '../domain/phases.js';
import { mvaViolationFor } from '../domain/airspace.js';
import { getConflictPairs } from '../domain/separation.js';
import { isReadbackPending, READBACK_GRACE_SEC } from '../domain/readback.js';

/** 评分基数与扣/加分权重（PLAN §7.2） */
export const SCORE_BASE = 100;
export const SCORE_WEIGHTS = {
    SEPARATION_BREACH: -15,
    MVA_BREACH: -10,
    GO_AROUND: -6,
    DELAY: -2,
    HANDOFF_TIMEOUT: -2,
    READBACK_MISSED: -3,
    /* CCAR-93TM-R6 对齐 R1：值班 / 交接 / 休息相关评分项 */
    HANDOVER_MISSED: -2,
    REST_IGNORED: -5,
    NOT_FIT_FOR_DUTY: 2,
    EARLY_BONUS: 5
};

/** 效率项：落地延误超过该秒数才扣分 */
export const DELAY_TOLERANCE_SEC = 180;
/** 连击奖励：连续 N 架无延误落地 → EARLY_BONUS（PLAN §7.2） */
export const STREAK_LENGTH = 5;
/** 记分冷却（模拟秒） */
export const SEPARATION_COOLDOWN_SEC = 45;
export const MVA_COOLDOWN_SEC = 60;

/** 评级门槛（PLAN §7.2） */
export const GRADES = [
    { key: 'S', min: 95, label: 'S · 完美' },
    { key: 'A', min: 85, label: 'A · 优秀' },
    { key: 'B', min: 75, label: 'B · 良好' },
    { key: 'C', min: 60, label: 'C · 合格' },
    { key: 'D', min: -Infinity, label: 'D · 需改进' }
];

/** 分数 → 评级 */
export function gradeFor(score) {
    return GRADES.find(g => score >= g.min) || GRADES[GRADES.length - 1];
}

/** 计分账本（运行期，不入存档） */
const ledger = {
    active: false,
    startedAtSim: 0,
    events: [],
    counts: { separation: 0, mva: 0, goAround: 0, delay: 0, handoff: 0, readback: 0, handover: 0, notFit: 0, restIgnored: 0 },
    penaltyTotal: 0,
    bonusTotal: 0,
    cooldowns: {},
    progress: 0,
    landed: 0,
    streak: 0,
    configIndex: 0,
    plan: null,
    runwayChanges: [],
    /** 当前班次的关卡（提供 runwayPairs / configurations / runwayIdents，位置文件缺失时兜底） */
    scenario: null
};

/** 设定当前班次关卡（开始班次时由 game/session.js 调用） */
export function setScoringScenario(scenario) {
    ledger.scenario = scenario || null;
    return ledger.scenario;
}

/** 重置账本（开始班次时调用） */
export function resetScoring(opts = {}) {
    ledger.active = true;
    ledger.startedAtSim = state.time;
    ledger.events = [];
    ledger.counts = { separation: 0, mva: 0, goAround: 0, delay: 0, handoff: 0, readback: 0, handover: 0, notFit: 0, restIgnored: 0 };
    ledger.penaltyTotal = 0;
    ledger.bonusTotal = 0;
    ledger.cooldowns = {};
    ledger.progress = Number.isFinite(opts.progress) ? opts.progress : 0;
    ledger.landed = 0;
    ledger.streak = 0;
    ledger.configIndex = opts.configIndex || 0;
    ledger.runwayChanges = [];
    ledger.plan = null;                          // 先清空：避免把上一班的构型当成"本班变更"记录
    ledger.plan = applyRunwayPlan({ silent: true });
    bus.emit(EV.SCORE_CHANGED, { reason: 'reset' });
    requestRedraw();
    return scoringSummary();
}

/* ---------------- 记分事件 ---------------- */

/** 事件中文描述（HUD 告警、结算时间轴、通话播报共用） */
export function scoreEventText(e) {
    if (!e) return '';
    switch (e.kind) {
        case 'SEPARATION_BREACH':
            return `间隔不足：${e.detail.callsigns ? e.detail.callsigns.join(' / ') : '--'}`;
        case 'MVA_BREACH':
            return `低于最低高度区：${e.detail.callsign || '--'} ${e.detail.altM}m < ${e.detail.limitM}m`;
        case 'READBACK_MISSED':
            return `复诵不符未纠正：${e.detail.callsign || '--'}（漏 ${e.detail.missing || '--'}）`;
        case 'GO_AROUND':
            return `复飞：${e.detail.callsign || '--'}`;
        case 'DELAY':
            return `落地延误 ${e.detail.delayedSec}s：${e.detail.callsign || '--'}`;
        case 'EARLY_BONUS':
            return `连击奖励（连续 ${e.detail.streak || 5} 架无延误落地）`;
        case 'HANDOFF_TIMEOUT':
            return `移交超时：${e.detail.callsign || '--'}`;
        case 'HANDOVER_MISSED':
            return `交接班漏项：${e.detail.item || e.detail.title || '--'}（${e.detail.callsign || '--'}）`;
        case 'REST_IGNORED':
            return `忽视强制休息：${e.detail.reason || '连续执勤超限'}`;
        case 'NOT_FIT_FOR_DUTY':
            return `申报不适合执勤：${e.detail.reason || '管制员主动申报（§128 权利）'}`;
        case 'RUNWAY_CHANGE':
            return `跑道构型变更：落地 ${(e.detail.land || []).join('/') || '--'} · 起飞 ${(e.detail.start || []).join('/') || '--'}`;
        case 'LANDED':
            return `落地：${e.detail.callsign || '--'}`;
        default:
            return e.kind;
    }
}

/**
 * 记一条评分事件并调整分数。
 * @param {string} kind SCORE_WEIGHTS 的键（或 'LANDED' / 'RUNWAY_CHANGE' 等零权重事件）
 * @param {object} [detail] 事件细节
 * @returns {object} 事件条目
 */
export function addScoreEvent(kind, detail = {}) {
    const weight = SCORE_WEIGHTS[kind] || 0;
    const entry = { t: state.time, kind, weight, detail };
    ledger.events.push(entry);
    if (weight < 0) {
        ledger.penaltyTotal += weight;
        const key = kind === 'SEPARATION_BREACH' ? 'separation'
            : kind === 'MVA_BREACH' ? 'mva'
                : kind === 'GO_AROUND' ? 'goAround'
                    : kind === 'DELAY' ? 'delay'
                        : kind === 'READBACK_MISSED' ? 'readback'
                            : kind === 'HANDOVER_MISSED' ? 'handover'
                                : kind === 'REST_IGNORED' ? 'restIgnored' : 'handoff';
        ledger.counts[key] = (ledger.counts[key] || 0) + 1;
    } else if (weight > 0) {
        ledger.bonusTotal += weight;
        if (kind === 'NOT_FIT_FOR_DUTY') ledger.counts.notFit = (ledger.counts.notFit || 0) + 1;
    }
    bus.emit(EV.SCORE_CHANGED, { event: entry });
    requestRedraw();
    return entry;
}

/** 绩效分（0–100，四舍五入保存 1 位小数） */
export function computeScore() {
    const raw = SCORE_BASE + ledger.penaltyTotal + ledger.bonusTotal;
    return Math.max(0, Math.min(100, Math.round(raw * 10) / 10));
}

export function currentGrade() { return gradeFor(computeScore()); }

/** 已落地飞机的平均延误（秒；无计划落地时刻的飞机不计入） */
export function averageDelaySec() {
    const planned = state.aircraft.filter(ac => ac.landed && Number.isFinite(ac.schedLanding));
    if (!planned.length) return 0;
    const total = planned.reduce((n, ac) => n + Math.max(0, (ac.landedTime || state.time) - ac.schedLanding), 0);
    return total / planned.length;
}


/* ---------------- 解锁进度分（驱动 [configurations] 跑道开关） ---------------- */

/** 增加解锁进度分（每落地一架 +amount） */
export function addProgress(amount = 1) {
    ledger.progress = Math.max(0, ledger.progress + amount);
    applyRunwayPlan();
    return ledger.progress;
}

/** 直接设定进度分（[scenario] 的 `score` 事件） */
export function setProgressScore(value) {
    ledger.progress = Math.max(0, Number.isFinite(value) ? value : 0);
    applyRunwayPlan();
    return ledger.progress;
}

/* ---------------- 跑道构型（[configurations] 分数门槛） ---------------- */

/**
 * 按解锁进度分计算可用跑道。
 * 语义（Endless ATC）：[configurations] 每条 `分数, 跑道标识, 用法` 是「该用法生效所需的最低分数」，
 * 分数升高 → 更多跑道可用；分数下降 → 相应跑道关闭。`rev` 表示使用反向跑道端。
 * @param {number} [progress] 解锁进度分（默认取账本当前值）
 * @returns {{index:number,name:string,land:string[],start:string[],entries:number,total:number}}
 */
export function runwayPlan(progress = ledger.progress) {
    const loc = state.location;
    const sc = ledger.scenario;
    // 位置文件优先（导入即用其 [configurations]）；否则用内置关卡包的数据；再退回机场表跑道
    const configs = (loc && loc.configurations && loc.configurations.length)
        ? loc.configurations
        : ((sc && sc.configurations) || []);
    const identMap = {};
    if (loc && loc.mainAirport) {
        (loc.mainAirport.runways || []).forEach(r => { if (r.ident) identMap[r.ident] = r.name; });
    } else if (sc && sc.runwayIdents) {
        Object.assign(identMap, sc.runwayIdents);
    }

    if (configs.length) {
        const index = ((ledger.configIndex % configs.length) + configs.length) % configs.length;
        const cfg = configs[index];
        const plan = { index, name: cfg.name, land: [], start: [], entries: 0, total: cfg.entries.length };
        cfg.entries.forEach(e => {
            if (e.score > progress) return;
            plan.entries++;
            let rwy = identMap[e.ident] || String(e.ident || '').toUpperCase();
            if (!rwy) return;
            if (e.usage.rev) rwy = reciprocalRunway(rwy);
            if (e.usage.land && !plan.land.includes(rwy)) plan.land.push(rwy);
            if (e.usage.start && !plan.start.includes(rwy)) plan.start.push(rwy);
        });
        if (!plan.land.length || !plan.start.length) {
            // 门槛过高导致无可用跑道时回退到最低门槛条目，保证班次仍可运行
            const lowest = cfg.entries.reduce((m, e) => (m === null || e.score < m.score ? e : m), null);
            if (lowest) {
                let rwy = identMap[lowest.ident] || String(lowest.ident || '').toUpperCase();
                if (lowest.usage.rev) rwy = reciprocalRunway(rwy);
                if (!plan.land.length) plan.land.push(rwy);
                if (!plan.start.length) plan.start.push(rwy);
            }
        }
        return plan;
    }

    const airportCode = (loc && loc.code) || (sc && sc.airport) || state.focusAirport;
    const pairs = (!loc && sc && sc.runwayPairs && sc.runwayPairs.length)
        ? sc.runwayPairs
        : runwayList(airportCode);
    const ends = pairs.map(p => runwayEnd(p, 0)).filter(Boolean);
    const fallback = ends.length ? ends : ['18'];
    return { index: 0, name: '默认', land: fallback.slice(), start: fallback.slice(), entries: fallback.length, total: fallback.length };
}

/** 跑道构型签名（变化检测用） */
export function runwaySignature(plan) {
    if (!plan) return '';
    return `${plan.index}|${plan.land.join(',')}|${plan.start.join(',')}`;
}

/**
 * 重算跑道构型；构型发生变化（解锁/关闭跑道）时播报并记入时间轴。
 * @param {{silent?:boolean}} [opts] silent = 初始化，不播报
 */
export function applyRunwayPlan(opts = {}) {
    const plan = runwayPlan();
    const sig = runwaySignature(plan);
    const changed = !!ledger.plan && runwaySignature(ledger.plan) !== sig;
    ledger.plan = plan;
    if (changed) {
        ledger.runwayChanges.push({ t: state.time, land: plan.land.slice(), start: plan.start.slice(), progress: ledger.progress });
        addScoreEvent('RUNWAY_CHANGE', { land: plan.land.slice(), start: plan.start.slice(), progress: ledger.progress });
        if (!opts.silent) {
            addComm('atc', `跑道构型变更（解锁分 ${Math.round(ledger.progress)}）：落地 ${plan.land.join('/') || '--'}，`
                + `起飞 ${plan.start.join('/') || '--'}`);
        }
    }
    return plan;
}

/** 切换跑道构型（[scenario] 的 config 事件） */
export function setRunwayConfigIndex(index) {
    ledger.configIndex = Math.max(0, Math.floor(Number.isFinite(index) ? index : 0));
    return applyRunwayPlan();
}



/* ---------------- 逐帧记分（由 game/session.js 订阅 clock:tick 调用） ---------------- */

/** 落地记账：解锁分 +1、延误判定、连击奖励、时间轴记录 */
function noteLanded(ac) {
    ledger.landed++;
    addProgress(1);
    addScoreEvent('LANDED', { callsign: ac.flightNo, runway: ac.runway || null, at: Math.round(state.time) });
    const delayedSec = Number.isFinite(ac.schedLanding)
        ? Math.round((ac.landedTime || state.time) - ac.schedLanding)
        : 0;
    if (Number.isFinite(ac.schedLanding) && delayedSec > DELAY_TOLERANCE_SEC) {
        ledger.streak = 0;
        addScoreEvent('DELAY', { callsign: ac.flightNo, delayedSec, schedLanding: Math.round(ac.schedLanding) });
        return;
    }
    // 连击（PLAN §7.2）：连续 5 架无延误落地 → +5
    ledger.streak++;
    if (ledger.streak > 0 && ledger.streak % STREAK_LENGTH === 0) {
        addScoreEvent('EARLY_BONUS', { streak: ledger.streak });
    }
}

/**
 * 最低高度区（MVA）判定。
 * 简化规则：只对**进港且尚未发进近许可**的航空器计违规 —— 已按程序进近/落地的飞机由进近程序提供
 * 超障保护（真实 MVA 规则同理），因此把进港航班引导到 MVA 以下才会被记分。
 */
function checkMva(now) {
    state.aircraft.forEach(ac => {
        if (state.time < (ac.startTime || 0) || ac.landed) return;
        if (flowOf(ac) !== 'arrival' || ac.approachType || ac.clearance === 'land') return;
        const v = mvaViolationFor(ac);
        if (!v) return;
        const key = `mva-${ac.id}`;
        if ((ledger.cooldowns[key] || -Infinity) > now) return;
        ledger.cooldowns[key] = now + MVA_COOLDOWN_SEC;
        addScoreEvent('MVA_BREACH', {
            callsign: ac.flightNo,
            limitM: Math.round(v.limitM),
            altM: Math.round(v.altM),
            area: v.area ? v.area.name : '',
            at: Math.round(now)
        });
    });
}

/** 间隔不足（现行判定，非预测）：同一配对冷却 45 模拟秒 */
function checkSeparation(now) {
    getConflictPairs().forEach(([a, b]) => {
        const key = `sep-${[a.id, b.id].sort((x, y) => x - y).join('-')}`;
        if ((ledger.cooldowns[key] || -Infinity) > now) return;
        ledger.cooldowns[key] = now + SEPARATION_COOLDOWN_SEC;
        addScoreEvent('SEPARATION_BREACH', {
            callsigns: [a.flightNo, b.flightNo],
            at: Math.round(now)
        });
    });
}

/** 复飞与落地状态记账（按航空器只记一次） */
function checkFlightOutcomes() {
    state.aircraft.forEach(ac => {
        if (ac.goAround && !ac._goAroundScored) {
            ac._goAroundScored = true;
            addScoreEvent('GO_AROUND', { callsign: ac.flightNo, at: Math.round(state.time) });
        }
        if (ac.landed && !ac._scoredLanding) {
            ac._scoredLanding = true;
            noteLanded(ac);
        }
    });
}

/**
 * 复诵复核（PLAN §7.2「未复诵 −3」）：定向指令播报的复诵若漏掉关键参数，
 * 管制员需在宽限期（READBACK_GRACE_SEC）内重新下发纠正；逾期记一次未复诵。
 */
function checkReadbacks(now) {
    state.aircraft.forEach(ac => {
        if (state.time < (ac.startTime || 0)) return;
        const rb = ac.readback;
        if (!rb || rb.penalized || !isReadbackPending(ac)) return;
        if (now - rb.t < READBACK_GRACE_SEC) return;
        rb.penalized = true;
        addScoreEvent('READBACK_MISSED', {
            callsign: ac.flightNo,
            missing: rb.missing || null,
            waitedSec: Math.round(now - rb.t),
            at: Math.round(now)
        });
    });
}

/** 每时钟步进调用一次（暂停时不记分，避免拖时间轴造成重复扣分） */
export function tickScoring() {
    if (!ledger.active || !state.isPlaying) return;
    const now = state.time;
    checkSeparation(now);
    checkMva(now);
    checkReadbacks(now);
    checkFlightOutcomes();
}


/* ---------------- 汇总 ---------------- */

/** 评分汇总（HUD / 班次面板 / 结算结果共用单一口径） */
export function scoringSummary() {
    const performance = computeScore();
    const grade = gradeFor(performance);
    const plan = ledger.plan || runwayPlan();
    return {
        active: ledger.active,
        performance,
        score: performance,
        grade: grade.key,
        gradeLabel: grade.label,
        progress: Math.round(ledger.progress * 10) / 10,
        landed: ledger.landed,
        streak: ledger.streak,
        avgDelaySec: Math.round(averageDelaySec()),
        counts: { ...ledger.counts },
        penaltyTotal: ledger.penaltyTotal,
        bonusTotal: ledger.bonusTotal,
        runway: {
            index: plan.index,
            name: plan.name,
            land: plan.land.slice(),
            start: plan.start.slice(),
            entries: plan.entries,
            total: plan.total
        },
        runwayChanges: ledger.runwayChanges.length,
        alerts: ledger.events.slice(-5).map(e => ({ t: Math.round(e.t), kind: e.kind, text: scoreEventText(e) })),
        eventCount: ledger.events.length,
        elapsed: Math.round(state.time - ledger.startedAtSim)
    };
}

/** 结算用的事件时间轴（最近 limit 条，含中文描述） */
export function scoreTimeline(limit = 20) {
    return ledger.events.slice(-limit).map(e => ({
        t: Math.round(e.t), kind: e.kind, weight: e.weight, text: scoreEventText(e)
    }));
}
