/**
 * game/director.js — 流量导演（游戏层）
 *
 * 职责（docs/PLAN-v2.md §13.4 的 P1 接入点）：
 *   · 消费 Endless ATC 位置文件的 [scenario] 事件时间轴：config / score / wind / text / arr / dep
 *     （elapse 已在 game/scenario.js 的时间轴换算中消化）
 *   · 按 [airportN] 的 entrypoints + airlines 概率表**无限生成**进离港航班
 *     （无位置文件时按焦点机场与空域半径生成 8 向入口 + 枢纽航司表）
 *   · 机型/呼号/航路全部由**带种子的伪随机**抽取，同一 seed 可完整复现（可复盘前提）
 *   · 跑道取自 game/scoring.js 的构型计划（[configurations] 门槛），因此解锁更多跑道后
 *     可用的落地/起飞跑道立即变化
 *
 * 依赖方向：core（0）/ data（1）/ domain（2）/ simulation（1）+ 同层 game（3）；不触碰渲染与界面。
 */

import { state, addComm } from '../core/store.js';
import { bus, EV, requestRedraw } from '../core/eventBus.js';
import { nextId } from '../core/ids.js';
import { kmToPxFixed, pxToKmFixed } from '../core/viewport.js';
import { KT_TO_KMPS, DEPARTURE_INIT_ALT, DEPARTURE_INIT_SPD } from '../core/constants.js';
import { makeRng, pickWeighted, DEFAULT_SEED } from '../core/random.js';
import { getAirport } from '../data/airports.js';
import { AIRCRAFT, COMMON_TYPES } from '../data/aircraft.js';
import { makeCallsign } from '../data/airlines.js';
import { setAltitudeConstraint, setSpeedConstraint } from '../simulation/motion.js';
import { headingBetween } from '../simulation/geometry.js';
import { normalizeAircraft } from '../domain/aircraft.js';
import { FT_TO_M } from '../domain/locations.js';
import {
    DIFFICULTY, normalizeScenario, defaultScenario, scenarioFromLocation
} from './scenario.js';
import { runwayPlan, setProgressScore, setRunwayConfigIndex } from './scoring.js';

/** 文件机型 → 本项目机型别名（社区文件常用 a330/b777/arj21 等写法） */
const TYPE_ALIASES = {
    A330: 'A332', A340: 'A332', A350: 'A359',
    B777: 'B77W', B747: 'B77W', B767: 'B77W', B737: 'B738',
    A319: 'A320',
    E195: 'E190', CRJ9: 'E190', ARJ21: 'E190', RJ85: 'E190'
};

function num(v, fallback = 0) {
    const n = parseFloat(String(v ?? '').replace(/[^0-9.+-]/g, ''));
    return Number.isFinite(n) ? n : fallback;
}

function ftToM(v) {
    const n = num(v, NaN);
    return Number.isFinite(n) && n > 0 ? n * FT_TO_M : null;
}

/** 看起来像呼号（而非 2 字码外站）时采用文件给出的呼号写法 */
function looksLikeCallsign(v) {
    const s = String(v || '').trim();
    if (s.length < 3) return false;
    return /[A-Za-z]{2,}\d|\d{3,}/.test(s) || s.length >= 5;
}

/* ---------------- 导演运行期状态 ---------------- */

const director = {
    running: false,
    scenario: null,
    rng: makeRng(DEFAULT_SEED),
    startT: 0,
    lastT: 0,
    cursor: 0,
    nextSpawnAt: 0,
    spawned: { arrival: 0, departure: 0 },
    totalSpawned: 0,
    events: [],
    banner: null,
    wind: null,
    configIndex: 0
};

/* ---------------- 几何与抽样辅助 ---------------- */

/** 进场点世界坐标（文件未给信标位置时按方位 + 空域半径推算） */
function entrypointPosition(ep, ap) {
    if (ep && Number.isFinite(ep.x) && Number.isFinite(ep.y)) return { x: ep.x, y: ep.y };
    const radiusKm = (state.location && state.location.airspace && state.location.airspace.radiusKm) || 45;
    const dist = kmToPxFixed(radiusKm * 0.9);
    const rad = (num(ep && ep.heading, 0) * Math.PI) / 180;
    return { x: ap.x + Math.sin(rad) * dist, y: ap.y - Math.cos(rad) * dist };
}

/** 选取进场点（确定性：用导演随机序列） */
function pickEntrypoint() {
    const list = (director.scenario && director.scenario.entrypoints) || [];
    if (!list.length) return { heading: 0, beacon: '', x: null, y: null };
    return list[Math.floor(director.rng() * list.length)];
}

/** 离港航路出口：优先用文件 SID 点，否则按随机方位取空域边缘 */
function departureExitPoint(ap, sidName) {
    const sc = director.scenario;
    const sid = sidName ? (sc.sids || []).find(s => String(s.name).toLowerCase() === String(sidName).toLowerCase()) : null;
    if (sid) return { x: sid.x, y: sid.y, name: String(sid.name).toUpperCase() };
    const ep = pickEntrypoint();
    const pos = entrypointPosition(ep, ap);
    return { x: pos.x, y: pos.y, name: ep && ep.beacon ? ep.beacon : '离港' };
}

/** 由文件机型码 / 航司机型池 / 通用机型表解算本项目机型（确定性） */
function resolveAcType(code) {
    const raw = String(code || '').trim().toUpperCase();
    for (const c of [raw, TYPE_ALIASES[raw]].filter(Boolean)) {
        if (AIRCRAFT[c]) return c;
    }
    const pool = [];
    ((director.scenario && director.scenario.airlineTable) || []).forEach(a => {
        (a.types || []).forEach(t => {
            const u = String(t).trim().toUpperCase();
            const mapped = AIRCRAFT[u] ? u : TYPE_ALIASES[u];
            if (mapped && AIRCRAFT[mapped] && !pool.includes(mapped)) pool.push(mapped);
        });
    });
    if (pool.length) return pool[Math.floor(director.rng() * pool.length)];

    const fallback = COMMON_TYPES.filter(t => AIRCRAFT[t]);
    return fallback.length ? fallback[Math.floor(director.rng() * fallback.length)] : 'B738';
}

/**
 * 自动流量的进港目标高度阶梯：在可指令高度区间内按 600m 步进取值，
 * 避免所有进港航班被导演压到同一高度（垂直间隔标准 300m 的两倍步进）。
 */
function autoTargetAlt() {
    const base = (state.location && state.location.airspace && state.location.airspace.descentAltM)
        || state.defaults.altMinM || 3600;
    const step = 600;
    const ceiling = state.defaults.altMaxM || base + step * 3;
    const ladder = Math.max(1, Math.min(4, Math.floor((ceiling - base) / step) + 1));
    return base + step * ((director.spawned.arrival + director.spawned.departure) % ladder);
}

/** 按航司概率表生成呼号（私有呼号如 n-12345 直接采用） */
function makeTrafficCallsign() {
    const table = (director.scenario && director.scenario.airlineTable) || [];
    const pick = table.length ? pickWeighted(director.rng, table, a => a.amount) : null;
    const code = pick && pick.code ? String(pick.code).trim() : '';
    if (!code) return makeCallsign('ATC', String(100 + Math.floor(director.rng() * 8999)));
    if (/[-\d]/.test(code) || code.length > 3) return code.toUpperCase();
    return makeCallsign(code.toUpperCase(), String(100 + Math.floor(director.rng() * 8999)));
}

/** 计划跑道：取自 [configurations] 解算出的构型计划（解锁更多跑道后自动变化） */
function plannedRunway(kind = 'land', identHint = '') {
    const plan = runwayPlan();
    const list = plan[kind] && plan[kind].length ? plan[kind] : plan.land;
    const hint = String(identHint || '').trim();
    if (hint) {
        const mapped = ((director.scenario && director.scenario.runwayIdents) || {})[hint.toLowerCase()];
        if (mapped && list.includes(mapped)) return mapped;
        if (list.includes(hint.toUpperCase())) return hint.toUpperCase();
    }
    return list[0] || '18';
}

/** 生成自动航路（不进 state.routePoints：导演航路不污染航路点面板与点渲染） */
function makeAutoRoute(label, points) {
    const route = {
        id: nextId(),
        name: `${label}·${director.totalSpawned + 1}`,
        points,
        color: label === '进港' ? '#0ea5e9' : '#f59e0b',
        auto: true
    };
    state.routes.push(route);
    return route;
}

function activeAircraftCount() {
    return state.aircraft.filter(ac => !ac.landed).length;
}

function landedCount() {
    return state.aircraft.filter(ac => ac.landed).length;
}

/* ---------------- 航班注入 ---------------- */

/**
 * 注入一架进港航班（从进场点飞向焦点机场，并按 targetAltM 开始下降）。
 * @param {{entrypoint?:object,acType?:string,altM?:number,targetAltM?:number,spd?:number,callsign?:string}} spec
 * @returns {object|null} 新建航空器
 */
export function spawnArrival(spec = {}) {
    const sc = director.scenario;
    const ap = sc ? getAirport(sc.airport) : null;
    if (!ap) return null;
    const ep = spec.entrypoint || pickEntrypoint();
    const start = entrypointPosition(ep, ap);
    const acType = resolveAcType(spec.acType);
    const def = AIRCRAFT[acType] || AIRCRAFT.B738;
    const spd = spec.spd || def.cruiseSpeed;
    const altM = spec.altM || def.cruiseAlt;
    const targetAltM = spec.targetAltM || autoTargetAlt();
    const now = state.time;
    const airportPt = { id: nextId(), name: sc.airport, x: ap.x, y: ap.y, type: 'navaid' };
    const entryPt = { id: nextId(), name: ep.beacon || `EP${num(ep.heading)}`, x: start.x, y: start.y, type: 'vor' };
    const route = makeAutoRoute('进港', [entryPt, airportPt]);
    const legKm = pxToKmFixed(Math.hypot(ap.x - start.x, ap.y - start.y));

    const ac = {
        id: nextId(),
        x: start.x, y: start.y,
        displayX: start.x, displayY: start.y,
        flightNo: spec.callsign || makeTrafficCallsign(),
        squawk: String(2000 + Math.floor(director.rng() * 7000)),
        departure: ep.beacon || '外站',
        destination: sc.airport,
        flow: 'arrival',
        runway: plannedRunway('land'),
        approachType: null,
        acType,
        altitude: Math.round(altM),
        speed: Math.round(spd),
        heading: headingBetween({ x: start.x, y: start.y }, { x: ap.x, y: ap.y }),
        routeId: route.id,
        routeDistance: 0,
        navMode: 'route',
        nextWaypointIdx: 1,
        startTime: now,
        // 计划落地时刻：按进场航段长度与地速估算（+15% 用于进近减速），用于延误评分
        schedLanding: now + Math.round((legKm / Math.max(1, spd * KT_TO_KMPS)) * 1.15),
        spawnedBy: 'director',
        trail: [],
        labelOffsetX: 18, labelOffsetY: -14
    };
    normalizeAircraft(ac);
    state.aircraft.push(ac);
    setSpeedConstraint(ac, ac.speed, now);
    setAltitudeConstraint(ac, Math.round(targetAltM), now);

    director.spawned.arrival++;
    director.totalSpawned++;
    bus.emit(EV.DIRECTOR_EVENT, { type: 'spawn', flow: 'arrival', callsign: ac.flightNo, t: Math.round(now) });
    requestRedraw();
    return ac;
}

/**
 * 注入一架离港航班（在焦点机场等待塔台放行，放行后爬升）。
 * @param {{acType?:string,runwayIdent?:string,sid?:string,callsign?:string}} spec
 * @returns {object|null} 新建航空器
 */
export function spawnDeparture(spec = {}) {
    const sc = director.scenario;
    const ap = sc ? getAirport(sc.airport) : null;
    if (!ap) return null;
    const acType = resolveAcType(spec.acType);
    const def = AIRCRAFT[acType] || AIRCRAFT.B738;
    const exit = departureExitPoint(ap, spec.sid);
    const now = state.time;
    const airportPt = { id: nextId(), name: sc.airport, x: ap.x, y: ap.y, type: 'navaid' };
    const exitPt = { id: nextId(), name: exit.name, x: exit.x, y: exit.y, type: 'normal' };
    const route = makeAutoRoute('离港', [airportPt, exitPt]);

    const ac = {
        id: nextId(),
        x: ap.x, y: ap.y,
        displayX: ap.x, displayY: ap.y,
        flightNo: spec.callsign || makeTrafficCallsign(),
        squawk: String(2000 + Math.floor(director.rng() * 7000)),
        departure: sc.airport,
        destination: exit.name,
        flow: 'departure',
        runway: plannedRunway('start', spec.runwayIdent),
        plannedAltitude: def.cruiseAlt,
        plannedSpeed: def.cruiseSpeed,
        clearance: null,
        acType,
        altitude: DEPARTURE_INIT_ALT,
        speed: DEPARTURE_INIT_SPD,
        heading: headingBetween({ x: ap.x, y: ap.y }, { x: exit.x, y: exit.y }),
        routeId: route.id,
        routeDistance: 0,
        navMode: 'route',
        nextWaypointIdx: 1,
        startTime: now,
        sid: spec.sid ? String(spec.sid).toUpperCase() : null,
        spawnedBy: 'director',
        trail: [],
        labelOffsetX: 18, labelOffsetY: -14
    };
    normalizeAircraft(ac);
    state.aircraft.push(ac);

    director.spawned.departure++;
    director.totalSpawned++;
    bus.emit(EV.DIRECTOR_EVENT, { type: 'spawn', flow: 'departure', callsign: ac.flightNo, t: Math.round(now) });
    requestRedraw();
    return ac;
}

/* ---------------- [scenario] 事件驱动 ---------------- */

/** arr 事件：entrypoint, <beacon>, <planetype>, <altitude>, <targetaltitude>, <speed>, <delaytimer>, <fuel>, <emergency>, <callsign>, ... */
function spawnArrivalFromEvent(args) {
    const heading = num(args[0], 0);
    const beacon = String(args[1] || '').trim();
    const list = director.scenario.entrypoints || [];
    const ep = (beacon && list.find(e => String(e.beacon).toLowerCase() === beacon.toLowerCase()))
        || list.find(e => num(e.heading, -1) === heading)
        || { heading, beacon, x: null, y: null };
    return spawnArrival({
        entrypoint: ep,
        acType: args[2] || '',
        altM: ftToM(args[3]),
        targetAltM: ftToM(args[4]),
        spd: num(args[5], 0) || null,
        callsign: looksLikeCallsign(args[9]) ? String(args[9]).trim() : ''
    });
}

/** dep 事件：runwayidentifier, sid, <planetype>, <emergency>, <callsign>, ... */
function spawnDepartureFromEvent(args) {
    return spawnDeparture({
        runwayIdent: String(args[0] || '').trim(),
        sid: String(args[1] || '').trim(),
        acType: args[2] || '',
        callsign: looksLikeCallsign(args[4]) ? String(args[4]).trim() : ''
    });
}

/** 执行一条时间轴事件；返回记录（含 spawned 标识） */
function applyScenarioEvent(ev) {
    const args = ev.args || [];
    const record = { t: Math.round(ev.t), at: Math.round(state.time), type: ev.type, args: args.slice() };
    switch (ev.type) {
        case 'config': {
            const idx = Math.max(0, Math.round(num(args[0], 1)) - 1);
            director.configIndex = idx;
            setRunwayConfigIndex(idx);
            addComm('atc', `场景事件：切换跑道构型 config${idx + 1}`);
            break;
        }
        case 'score': {
            const value = num(args[0], 0);
            setProgressScore(value);
            addComm('atc', `场景事件：解锁分设定为 ${value}（跑道门槛随之变化）`);
            break;
        }
        case 'wind': {
            director.wind = { dir: num(args[0], 0), spd: num(args[1], 0) };
            addComm('atc', `场景事件：风 ${director.wind.dir}° ${director.wind.spd}kt（跑道选择参考）`);
            break;
        }
        case 'text': {
            const text = args.join(' ').trim();
            director.banner = { text, t: state.time };
            addComm('atc', `【场景】${text}`);
            break;
        }
        case 'cloud':
            record.note = '云团事件（P3 天气接入，当前仅记录）';
            break;
        case 'arr': {
            const ac = spawnArrivalFromEvent(args);
            if (ac) record.spawned = 'arrival';
            break;
        }
        case 'dep': {
            const ac = spawnDepartureFromEvent(args);
            if (ac) record.spawned = 'departure';
            break;
        }
        case 'pressure':
            record.note = '气压值（本项目 QNH 固定 1013，忽略）';
            break;
        default:
            record.note = '未支持的事件类型';
            break;
    }
    director.events.push(record);
    bus.emit(EV.DIRECTOR_EVENT, record);
    return record;
}


/* ---------------- 无限流量 ---------------- */

/** 到达注入时刻则按难度节奏注入一架（受在管架数与总注入上限约束） */
function spawnInfinite() {
    const sc = director.scenario;
    const dif = DIFFICULTY[sc.difficulty] || DIFFICULTY.standard;
    const now = state.time;
    if (now < director.nextSpawnAt) return false;

    if (activeAircraftCount() >= dif.maxAircraft || director.totalSpawned >= dif.maxSpawn) {
        director.nextSpawnAt = now + dif.spawnIntervalSec;
        return false;
    }
    const isArrival = director.rng() < dif.arrivalRatio;
    const ac = isArrival ? spawnArrival({}) : spawnDeparture({});
    director.nextSpawnAt = now + dif.spawnIntervalSec * (ac ? 0.7 + 0.6 * director.rng() : 1);
    return !!ac;
}

/* ---------------- 生命周期 ---------------- */

/**
 * 启动导演。
 * @param {{scenario?:object, seed?:number}} [opts] 缺省时按当前位置文件/焦点机场推导关卡
 */
export function startDirector(opts = {}) {
    const sc = normalizeScenario(
        opts.scenario
        || (state.location && state.location.mainAirport ? scenarioFromLocation(state.location) : defaultScenario())
    );
    director.scenario = sc;
    director.rng = makeRng(Number.isFinite(opts.seed) ? opts.seed : sc.seed);
    director.running = true;
    director.startT = state.time;
    director.lastT = state.time;
    director.cursor = 0;
    director.spawned = { arrival: 0, departure: 0 };
    director.totalSpawned = 0;
    director.events = [];
    director.banner = null;
    director.configIndex = 0;
    director.wind = sc.config && sc.config.wind ? { ...sc.config.wind } : null;
    const dif = DIFFICULTY[sc.difficulty] || DIFFICULTY.standard;
    // 首个自动流量在半周期后进入，给出接班准备的缓冲
    director.nextSpawnAt = state.time + dif.spawnIntervalSec * 0.5;
    bus.emit(EV.DIRECTOR_EVENT, { type: 'start', scenario: sc.id, t: Math.round(state.time) });
    return directorSummary();
}

export function stopDirector() {
    const wasRunning = director.running;
    director.running = false;
    if (wasRunning) bus.emit(EV.DIRECTOR_EVENT, { type: 'stop', t: Math.round(state.time) });
    return wasRunning;
}

/**
 * 每时钟步进调用一次：先执行到点的时间轴事件，再做无限流量注入。
 * @returns {{spawned:number, events:number}}
 */
export function tickDirector() {
    if (!director.running || !state.isPlaying || !director.scenario) return { spawned: 0, events: 0 };
    const now = state.time;
    if (now < director.lastT) director.lastT = now;      // 时间轴回卷（timeMax）后重新对表
    director.lastT = now;

    let events = 0;
    while (director.cursor < director.scenario.timeline.length
        && director.scenario.timeline[director.cursor].t <= now) {
        applyScenarioEvent(director.scenario.timeline[director.cursor]);
        director.cursor++;
        events++;
    }
    spawnInfinite();
    return { spawned: director.totalSpawned, events };
}

/**
 * 班次完成条件（[scenario].finish：落地架数 / 时限）。
 * @returns {{met:boolean, reason:string|null}}
 */
export function directorGoal() {
    const sc = director.scenario;
    if (!sc || !sc.finish) return { met: false, reason: null };
    if (sc.finish.count && landedCount() >= sc.finish.count) {
        return { met: true, reason: `落地 ${landedCount()} 架 / 目标 ${sc.finish.count} 架` };
    }
    if (sc.finish.timeLimit && (state.time - director.startT) >= sc.finish.timeLimit) {
        return { met: true, reason: `班次时限 ${sc.finish.timeLimit}s 已到` };
    }
    return { met: false, reason: null };
}

/** 导演状态快照（HUD / 班次面板 / 冒烟断言） */
export function directorSummary() {
    const sc = director.scenario;
    const dif = sc ? (DIFFICULTY[sc.difficulty] || DIFFICULTY.standard) : DIFFICULTY.standard;
    return {
        running: director.running,
        scenarioId: sc ? sc.id : null,
        scenarioName: sc ? sc.name : null,
        airport: sc ? sc.airport : state.focusAirport,
        difficulty: sc ? sc.difficulty : 'standard',
        difficultyLabel: dif.label,
        entrypoints: sc ? sc.entrypoints.length : 0,
        airlines: sc ? sc.airlineTable.length : 0,
        timeline: sc ? sc.timeline.length : 0,
        cursor: director.cursor,
        timelineDone: sc ? director.cursor >= sc.timeline.length : false,
        spawned: { ...director.spawned },
        totalSpawned: director.totalSpawned,
        activeAircraft: activeAircraftCount(),
        landed: landedCount(),
        maxAircraft: dif.maxAircraft,
        nextSpawnAt: Math.round(director.nextSpawnAt),
        configIndex: director.configIndex,
        wind: director.wind,
        banner: director.banner,
        finish: sc ? sc.finish : null,
        events: director.events.slice(-10)
    };
}

/** 导演已触发的场景事件（复盘时间轴用） */
export function directorEvents(limit = 20) {
    return director.events.slice(-limit);
}
