/**
 * game/events.js — 随机特情与经营事件引擎（游戏层）
 *
 * 「世界怎么变」的随机侧入口：随机数全部来自 core/random.js 的 seeded RNG，
 * 因此同一 scenario.seed 可完整复现同一场特情序列（复盘前提，docs/PLAN-v2.md §3.1）。
 *
 * 两类事件：
 *   · 现场特情（game/session 内）：风变 / 雷暴 / 跑道关闭 / 医疗 / 通讯失效 / 不稳定进近 / 低油量
 *     —— 优先落到既有指令链路（席位 / 评分 / 通话 / 复飞），不新造平行系统。
 *   · 经营事件（endDay 时）：设备故障 / 航班高峰 / 局方检查 / 员工病假 / 设备补贴
 *     —— 确定性产出 cashDelta / reputationDelta / mods，由 game/management.js 结算。
 *
 * 依赖方向：core(0) + data(1) + domain(2) + simulation(1) + weather(1) + 同层 game(3)；不碰 DOM。
 */

import { state, addComm } from '../core/store.js';
import { bus, EV, requestRedraw } from '../core/eventBus.js';
import { makeRng, pickWeighted } from '../core/random.js';
import { setAltitudeConstraint, setSpeedConstraint } from '../simulation/motion.js';
import { EMERGENCY_EVENTS, MANAGEMENT_EVENTS, EVENT_TUNING } from '../data/events.js';
import { addScoreEvent } from './scoring.js';

/* ---------------- 运行期状态 ---------------- */

const events = {
    rng: makeRng(1),
    seed: null,
    nextAt: 0,
    count: 0,
    spawned: [],
    active: new Map(),      // id → { type, acId, raisedAt, expiresAt, lastCheck }
    log: [],
    lastResolved: null
};

function logEntry(scope, type, name, text, extra = {}) {
    const entry = {
        id: `${scope}-${state.time}-${events.log.length}`,
        scope, type, name,
        day: state.management ? state.management.day : null,
        t: Math.round(state.time),
        severity: extra.severity || 'info',
        text,
        aircraft: extra.aircraft || null,
        meta: extra.meta || null
    };
    events.log.push(entry);
    while (events.log.length > 120) events.log.shift();
    state.eventLog = events.log.slice(-120);
    return entry;
}

function aircraftByFlightNo(flightNo) {
    return state.aircraft.find(ac => ac.flightNo === flightNo) || null;
}

/* ---------------- 生命周期 ---------------- */

/**
 * 班次开始时装配事件调度器（由 game/session.js 调用）。
 * @param {{seed?:number, difficulty?:string, curve?:object}} [opts]
 */
export function startEvents(opts = {}) {
    const seed = Number.isFinite(opts.seed) ? opts.seed : (state.management ? state.management.day : 1) * 7919;
    events.rng = makeRng(seed);
    events.seed = seed;
    events.nextAt = state.time + EVENT_TUNING.firstDelaySec;
    events.count = 0;
    events.spawned = [];
    events.active.clear();
    return eventsSummary();
}

export function stopEvents() {
    events.active.clear();
}

/** 清空日志（重开经营时用） */
export function resetEventLog() {
    events.log = [];
    state.eventLog = [];
    if (state.management) state.management.eventLog = [];
}

/* ---------------- 随机特情 ---------------- */

/** 难度曲线对事件频率的倍率（曲线越靠后事件越密） */
function eventIntervalSec() {
    const curve = state.difficultyCurve || null;
    const scale = curve && Number.isFinite(curve.eventRateScale) ? curve.eventRateScale : 1;
    return Math.max(EVENT_TUNING.minGapSec, EVENT_TUNING.baseIntervalSec / Math.max(0.2, scale));
}

/** 可用特情（过滤当前场上不成立的类型） */
function availableEmergencies() {
    const arrivals = state.aircraft.filter(ac => !ac.landed && (ac.flow || 'arrival') === 'arrival');
    const list = [];
    for (const ev of EMERGENCY_EVENTS) {
        if (ev.kind === 'runwayClosure' || ev.kind === 'unstableApproach'
            || ev.kind === 'goAround' || ev.kind === 'lowFuel' || ev.kind === 'medical') {
            if (arrivals.length === 0) continue;
        }
        if (ev.kind === 'commsFailure' && state.aircraft.length === 0) continue;
        list.push(ev);
    }
    return list;
}

/** 抽取下一次特情；返回事件记录或 null（受单班次上限 / 场上数量限制） */
export function tickEvents() {
    if (!state.isPlaying) return null;
    if (events.count >= EVENT_TUNING.maxPerSession) return null;
    if (state.aircraft.filter(ac => !ac.landed).length < EVENT_TUNING.spawnThreshold) return null;
    if (state.time < events.nextAt) return null;

    const pool = availableEmergencies();
    const def = pickWeighted(events.rng, pool, e => e.weight);
    events.nextAt = state.time + eventIntervalSec() * (0.7 + 0.6 * events.rng());
    if (!def) return null;

    const record = triggerEmergency(def, { random: true });
    return record;
}

/**
 * 触发一次特情（随机调度与手动测试共用入口 —— 冒烟测试可指定 type 稳定复现）。
 * @param {object|string} defOrId 事件定义或 id
 * @param {{random?:boolean, aircraftId?:string}} [opts]
 */
export function triggerEmergency(defOrId, opts = {}) {
    const def = typeof defOrId === 'string'
        ? EMERGENCY_EVENTS.find(e => e.id === defOrId)
        : defOrId;
    if (!def) return null;

    const arrivals = state.aircraft.filter(ac => !ac.landed && (ac.flow || 'arrival') === 'arrival');
    const pickFrom = arrivals.length ? arrivals : state.aircraft.filter(ac => !ac.landed);
    const ac = opts.aircraftId
        ? state.aircraft.find(a => a.id === opts.aircraftId) || pickFrom[0]
        : pickFrom[Math.floor(events.rng() * pickFrom.length)] || null;

    const record = applyEmergency(def, ac);
    if (!record) return null;

    events.count += 1;
    events.spawned.push(record.type);
    addComm('atc', `[特情] ${record.name}：${record.text}`);
    bus.emit(EV.EMERGENCY_RAISED, record);
    bus.emit(EV.PILOT_REQUEST, { kind: record.type, aircraft: record.aircraft, text: record.text });
    bus.emit(EV.DIRECTOR_EVENT, { type: 'emergency', t: Math.round(state.time), ...record });
    requestRedraw();
    return record;
}

function applyEmergency(def, ac) {
    const flightNo = ac ? ac.flightNo : null;
    const base = { type: def.id, kind: def.kind, name: def.name, severity: def.severity, aircraft: flightNo };

    switch (def.kind) {
    case 'windShift': {
        const wind = { hdg: (Math.round(events.rng() * 36) * 10 + 180) % 360, speed: 8 + Math.round(events.rng() * 12) };
        const note = `风向转为 ${String(wind.hdg).padStart(3, '0')}°，${wind.speed} m/s，评估跑道反向运行`;
        events.active.set(`emg-${state.time}-wind`, { type: def.id, acId: null, raisedAt: state.time, expiresAt: state.time + 240, wind });
        return logRecord(base, note, { wind });
    }
    case 'thunderstorm': {
        const cells = 1 + Math.floor(events.rng() * 2);
        events.active.set(`emg-${state.time}-storm`, { type: def.id, acId: null, raisedAt: state.time, expiresAt: state.time + EVENT_TUNING.stormDriftSec, cells });
        return logRecord(base, `雷暴单元 ${cells} 个逼近管制空域，进离场航路需绕飞`, { cells });
    }
    case 'runwayClosure': {
        if (!ac) return null;
        const runway = ac.runway || '--';
        events.active.set(`emg-${state.time}-rwy`, { type: def.id, acId: ac.id, raisedAt: state.time, expiresAt: state.time + EVENT_TUNING.runwayClosureSec, runway });
        return logRecord({ ...base, aircraft: ac.flightNo }, `跑道 ${runway} 临时关闭，进近航空器需复飞或改航`, { runway });
    }
    case 'medical': {
        if (!ac) return null;
        ac.emergency = { type: 'medical', since: state.time, priority: true };
        events.active.set(`emg-${state.time}-med`, { type: def.id, acId: ac.id, raisedAt: state.time, expiresAt: null });
        return logRecord({ ...base, aircraft: ac.flightNo }, `${ac.flightNo} 报告机上一名旅客急症，请求优先落地`, { severity: 'danger' });
    }
    case 'commsFailure': {
        if (!ac) return null;
        ac.emergency = { type: 'commsFailure', since: state.time, priority: true };
        ac.commFailure = true;
        events.active.set(`emg-${state.time}-comm`, { type: def.id, acId: ac.id, raisedAt: state.time, expiresAt: null, lastCheck: state.time });
        return logRecord({ ...base, aircraft: ac.flightNo }, `${ac.flightNo} 失去双向通讯，按通讯失效程序保持监视并清空空域`, { severity: 'danger' });
    }
    case 'unstableApproach': {
        if (!ac) return null;
        addScoreEvent('GO_AROUND');
        events.active.set(`emg-${state.time}-unst`, { type: def.id, acId: ac.id, raisedAt: state.time, expiresAt: state.time + 90 });
        return logRecord({ ...base, aircraft: ac.flightNo }, `${ac.flightNo} 进近不稳定，管制员应指令复飞`, { score: 'GO_AROUND' });
    }
    case 'lowFuel': {
        if (!ac) return null;
        ac.fuelLow = true;
        events.active.set(`emg-${state.time}-fuel`, { type: def.id, acId: ac.id, raisedAt: state.time, expiresAt: state.time + 300 });
        return logRecord({ ...base, aircraft: ac.flightNo }, `${ac.flightNo} 报告低油量，请求直飞 ${ac.destination || state.focusAirport} 优先落地`, { severity: 'danger' });
    }
    case 'goAround': {
        if (!ac) return null;
        forceGoAround(ac);
        addScoreEvent('GO_AROUND');
        return logRecord({ ...base, aircraft: ac.flightNo }, `${ac.flightNo} 进近不稳自行复飞，已指令爬升并重新排序`, { score: 'GO_AROUND' });
    }
    case 'handoffTimeout': {
        if (!ac) return null;
        events.active.set(`emg-${state.time}-handoff`, { type: def.id, acId: ac.id, raisedAt: state.time, expiresAt: state.time + 120 });
        return logRecord({ ...base, aircraft: ac.flightNo }, `邻区未及时接收 ${ac.flightNo} 的移交，保持监视并再次协调`, { severity: 'warning' });
    }
    case 'neighborCall': {
        if (!ac) return null;
        return logRecord({ ...base, aircraft: ac.flightNo }, `相邻扇区通报 ${ac.flightNo} 后续流量，注意排序与间隔`, { severity: 'info' });
    }
    default:
        return logRecord(base, def.brief || def.name);
    }
}

function logRecord(base, text, meta = {}) {
    return {
        ...base,
        t: Math.round(state.time),
        text,
        meta,
        entry: logEntry('emergency', base.type, base.name, text, { ...base, severity: base.severity, meta })
    };
}

/** 强制复飞：清进近许可、转爬升，重新排队进近 */
export function forceGoAround(ac) {
    if (!ac) return false;
    ac.goAround = true;
    ac.approachType = null;
    ac.clearance = null;
    const alt = Math.min(15000, Math.round((ac.displayAltitude ?? ac.altitude ?? 3000) + 3000));
    setAltitudeConstraint(ac, alt);
    setSpeedConstraint(ac, Math.max(220, Math.round((ac.displaySpeed ?? ac.speed ?? 280) * 0.95)));
    bus.emit(EV.GO_AROUND, { flightNo: ac.flightNo, t: Math.round(state.time) });
    addComm('atc', `${ac.flightNo}，复飞，爬升至 ${alt} 米保持，等待再次进近许可。`);
    addComm('pilot', `${ac.flightNo}，复飞，爬升 ${alt} 米保持。`);
    return true;
}

/**
 * 每时钟步进检查特情持续/消解（跑道上关闭到期、低油量升级、通讯失效提醒等）。
 * @returns {number} 本次消解的特情数
 */
export function resolveEvents() {
    if (events.active.size === 0) return 0;
    let resolved = 0;
    for (const [id, ev] of [...events.active.entries()]) {
        const ac = ev.acId ? state.aircraft.find(a => a.id === ev.acId) : null;

        // 航空器已落地 / 移除 → 特情消解
        if (ev.acId && (!ac || ac.landed)) {
            closeEmergency(id, ev, ac);
            resolved++;
            continue;
        }

        // 低油量未处置 45s 后升级为紧急
        if (ev.type === 'lowFuel' && ac && !ev.escalated && state.time - ev.raisedAt >= EVENT_TUNING.lowFuelDelaySec) {
            ev.escalated = true;
            ac.emergency = { type: 'lowFuel', since: state.time, priority: true };
            addComm('pilot', `${ac.flightNo}，油量持续下降，请求立即优先落地。`);
            bus.emit(EV.EMERGENCY_RAISED, { type: 'lowFuelEscalated', name: '低油量升级', aircraft: ac.flightNo, severity: 'danger', text: '低油量升级为紧急优先落地' });
        }

        // 通讯失效周期性提醒
        if (ev.type === 'commsFailure' && ac && state.time - (ev.lastCheck || 0) >= EVENT_TUNING.commFailureCheckSec) {
            ev.lastCheck = state.time;
            addComm('atc', `${ac.flightNo} 仍无通讯，按失效程序保持航向/高度，净空等待空域。`);
        }

        // 有到期时间的特情释放
        if (ev.expiresAt !== null && ev.expiresAt !== undefined && state.time >= ev.expiresAt) {
            closeEmergency(id, ev, ac);
            resolved++;
        }
    }
    return resolved;
}

function closeEmergency(id, ev, ac) {
    events.active.delete(id);
    if (ac) {
        if (ac.emergency && (ac.emergency.type === ev.type || ev.type === 'runwayClosure')) ac.emergency = null;
        if (ev.type === 'commsFailure') ac.commFailure = false;
        if (ev.type === 'lowFuel') ac.fuelLow = false;
    }
    const def = EMERGENCY_EVENTS.find(e => e.id === ev.type);
    const name = def ? def.name : ev.type;
    const text = ac ? `${ac.flightNo} ${name}已消解` : `${name}已消解`;
    const entry = logEntry('emergency', `${ev.type}:resolved`, name, text, { severity: 'info', aircraft: ac ? ac.flightNo : null });
    events.lastResolved = entry;
    bus.emit(EV.EMERGENCY_RESOLVED, { type: ev.type, aircraft: ac ? ac.flightNo : null, t: Math.round(state.time), duration: Math.round(state.time - ev.raisedAt) });
    addComm('atc', `[特情解除] ${text}`);
    requestRedraw();
}

/* ---------------- 经营事件（日结算） ---------------- */

/**
 * 结算经营事件（确定性：同一 management.day + 合同量得到同一事件）。
 * 由 game/management.js 的 endDay() 调用；返回事件记录（可能为 null）。
 * @param {object} m 经营状态（只读）
 * @param {() => number} [rng] 可注入 RNG（缺省按 day 派生，保证可复现）
 */
export function rollManagementEvent(m, rng) {
    const day = m && Number.isFinite(Number(m.day)) ? Math.floor(Number(m.day)) : 1;
    const dayRng = rng || makeRng(day * 104729 + (state.management ? Math.round(state.management.cash) : 0));
    // 约 45% 的营业日有事件
    if (dayRng() > 0.45) return null;
    const def = pickWeighted(dayRng, MANAGEMENT_EVENTS, e => e.weight);
    if (!def) return null;
    const record = {
        id: `mgmt-${day}-${def.id}`,
        scope: 'management',
        type: def.id,
        name: def.name,
        day,
        severity: def.severity,
        brief: def.brief,
        cashDelta: Number(def.cashDelta) || 0,
        reputationDelta: Number(def.reputationDelta) || 0,
        mods: { ...(def.mods || {}) }
    };
    return record;
}

/** 事件日志（持久化快照用） */
export function eventLog(limit = 40) {
    return events.log.slice(-limit);
}

/** 当前进行中的特情数 */
export function activeEmergencyCount() {
    return events.active.size;
}

/** 事件引擎快照（HUD / 面板 / 冒烟断言） */
export function eventsSummary() {
    return {
        seed: events.seed,
        count: events.count,
        active: events.active.size,
        spawned: events.spawned.slice(-12),
        log: events.log.slice(-12),
        lastResolved: events.lastResolved
    };
}

/** 触发一次经营事件（冒烟测试 / 手动调试用） */
export function triggerManagementEvent(id) {
    const def = MANAGEMENT_EVENTS.find(e => e.id === id);
    if (!def) return null;
    return {
        id: `mgmt-manual-${def.id}`,
        scope: 'management',
        type: def.id,
        name: def.name,
        day: state.management ? state.management.day : 1,
        severity: def.severity,
        brief: def.brief,
        cashDelta: Number(def.cashDelta) || 0,
        reputationDelta: Number(def.reputationDelta) || 0,
        mods: { ...(def.mods || {}) }
    };
}

/** 事件定义清单（UI 图鉴用） */
export function eventCatalog() {
    return {
        emergency: EMERGENCY_EVENTS.map(e => ({ id: e.id, name: e.name, severity: e.severity, brief: e.brief })),
        management: MANAGEMENT_EVENTS.map(e => ({ id: e.id, name: e.name, severity: e.severity, brief: e.brief }))
    };
}
