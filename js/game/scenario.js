/**
 * game/scenario.js — 关卡场景包与确定性随机（游戏层）
 *
 * 职责：
 *   · 场景包 v3 模型（docs/PLAN-v2.md §9）：机场 / 难度 / 种子 / 目标 / 时间轴事件
 *   · 由 Endless ATC 位置文件场景（domain/locations.js 的 [scenario]/entrypoints/airlines/
 *     [configurations]）派生关卡，使社区机场文件导入即可作为班次玩法数据源
 *   · [scenario].events 时间轴换算：文件首列为「距上一事件的经过秒数」，`elapse` 只推进时间轴，
 *     其余事件按累积绝对时刻（相对班次起点）排入 timeline
 *   · 带种子的确定性伪随机（mulberry32）：同一 seed 的流量注入序列完全可复现（可复盘的前提）
 *
 * 依赖方向：本模块只 import core/data/domain（层 0–2），不触碰渲染与界面。
 */

import { state } from '../core/store.js';
import { DEFAULT_SEED } from '../core/random.js';
import { getAirport } from '../data/airports.js';
import { AIRLINES, airlinesByHub } from '../data/airlines.js';
import { MANAGEMENT } from '../data/management.js';
import { kmToPxFixed } from '../core/viewport.js';

/** 场景包版本（存储键规划详见 docs/PLAN-v2.md §9） */
export const SCENARIO_VERSION = 3;

/** 难度预设：流量注入节奏与在管架数上限，外加固化的五维难度性格
 *  —— 间隔严格度 / 用语强制 / 飞行员请求频率 / 天气随机 / 告警宽容。
 *  五维随经营天数由 difficultyCurveFor() 放大或收紧（见下方 CURVE_TUNING）。
 *  运行期消费进度（M2/T5）：director 消费流量四字段，events 消费 eventRateScale；
 *  其余四维目前只产出、未接线，接入点见各模块（separation / readback / scoring / weather）。 */
export const DIFFICULTY = {
    arcade: {
        key: 'arcade', label: '街机', spawnIntervalSec: 55, arrivalRatio: 0.6, maxAircraft: 26, maxSpawn: 90, readbackErrorRate: 0,
        separationStrictness: 0.9, phraseologyStrictness: 0.6, pilotRequestRate: 0.7, weatherRandomness: 0.2, alertTolerance: 1.4
    },
    standard: {
        key: 'standard', label: '标准', spawnIntervalSec: 80, arrivalRatio: 0.62, maxAircraft: 22, maxSpawn: 70, readbackErrorRate: 0.08,
        separationStrictness: 1.0, phraseologyStrictness: 1.0, pilotRequestRate: 1.0, weatherRandomness: 0.45, alertTolerance: 1.0
    },
    realistic: {
        key: 'realistic', label: '拟真', spawnIntervalSec: 110, arrivalRatio: 0.65, maxAircraft: 18, maxSpawn: 50, readbackErrorRate: 0.2,
        separationStrictness: 1.1, phraseologyStrictness: 1.25, pilotRequestRate: 1.3, weatherRandomness: 0.7, alertTolerance: 0.7
    }
};

/* ---------------- 难度曲线（M2 / T2 起用，T5 扩五维） ---------------- */

/**
 * 难度曲线调参（示意值，【需试玩校验】）：随经营天数把固定难度预设推向更高强度。
 *   · 流量/容量：trafficScale 单调增，压 spawnIntervalSec、抬 maxAircraft/maxSpawn
 *   · 事件频率：eventRateScale 单调增，由 game/events.js 的 eventIntervalSec() 消费（越大间隔越短）
 *   · 五维：间隔严格度 / 用语强制 / 飞行员请求频率 / 天气随机 单调增，告警宽容 单调减
 */
export const CURVE_TUNING = Object.freeze({
    eventRateGrowthPerDay: 0.02,   // 每日事件频率倍率增量
    eventRateMaxScale: 2.4,        // 事件频率倍率上限
    trafficMaxScale: 1.8,          // 流量/容量倍率上限
    minSpawnIntervalSec: 20,       // 生成间隔下限
    separationGrowthPerDay: 0.004, // 每日间隔严格度增量
    separationMaxScale: 1.6,       // 间隔严格度上限（相对本档基线）
    phraseologyGrowthPerDay: 0.005,// 每日用语强制增量
    phraseologyMaxScale: 1.8,      // 用语强制上限（相对本档基线）
    pilotRateGrowthPerDay: 0.01,   // 每日飞行员请求频率增量
    pilotRateMaxScale: 2.0,        // 飞行员请求频率上限（相对本档基线）
    weatherGrowthPerDay: 0.005,    // 每日天气随机增量（绝对值）
    weatherRandomnessMax: 1.0,     // 天气随机上限（绝对值）
    alertToleranceDecayPerDay: 0.008, // 每日告警宽容衰减（绝对值）
    alertToleranceMin: 0.5         // 告警宽容下限（绝对值）
});

/** 把基线值按天放大（上限按相对倍率封顶）；day 从 1 起算 */
function scaleByDay(base, growthPerDay, dayOffset, maxScale) {
    const b = Number.isFinite(base) ? base : 1;
    return Math.min(maxScale, b * (1 + dayOffset * growthPerDay));
}

/** 把基线值按天线性推移（用于绝对值语义的维度），并按 [min,max] 夹紧 */
function shiftByDay(base, delta, dayOffset, min, max) {
    const b = Number.isFinite(base) ? base : min;
    return Math.max(min, Math.min(max, b + dayOffset * delta));
}

/**
 * 由经营状态与关卡难度推导「随天数增长的难度曲线」。纯函数：只读入参，不写 state
 * （调用方负责落盘到 state.difficultyCurve）。
 *
 * @param {object|null} management 经营状态（读 day）；缺省按第 1 天
 * @param {{scenario?:object, difficulty?:string}} [opts] 关卡（难度来源：scenario.difficulty）
 * @returns {{day:number,difficulty:string,label:string,trafficScale:number,eventRateScale:number,
 *            spawnIntervalSec:number,maxAircraft:number,maxSpawn:number,arrivalRatio:number,
 *            separationStrictness:number,phraseologyStrictness:number,pilotRequestRate:number,
 *            weatherRandomness:number,alertTolerance:number}}
 */
export function difficultyCurveFor(management, opts = {}) {
    const m = management && typeof management === 'object' ? management : null;
    const rawDay = m ? Number(m.day) : NaN;
    const day = Number.isFinite(rawDay) ? Math.max(1, Math.floor(rawDay)) : 1;
    const key = (opts.scenario && opts.scenario.difficulty)
        || (m && typeof m.difficulty === 'string' ? m.difficulty : null)
        || (typeof opts.difficulty === 'string' ? opts.difficulty : null)
        || 'standard';
    const dif = DIFFICULTY[key] || DIFFICULTY.standard;
    const dayOffset = day - 1;

    const trafficScale = Math.min(CURVE_TUNING.trafficMaxScale,
        Math.pow(1 + MANAGEMENT.trafficGrowthPerDay, dayOffset));
    const eventRateScale = Math.min(CURVE_TUNING.eventRateMaxScale,
        1 + dayOffset * CURVE_TUNING.eventRateGrowthPerDay);

    return {
        day,
        difficulty: dif.key,
        label: dif.label,
        trafficScale,
        eventRateScale,
        spawnIntervalSec: Math.max(CURVE_TUNING.minSpawnIntervalSec,
            Math.round(dif.spawnIntervalSec / trafficScale)),
        maxAircraft: Math.round(dif.maxAircraft * trafficScale),
        maxSpawn: Math.round(dif.maxSpawn * trafficScale),
        arrivalRatio: dif.arrivalRatio,
        // —— 五维（T5）：随天数单调变化，未知基线一律回落到标准档 ——
        separationStrictness: scaleByDay(dif.separationStrictness, CURVE_TUNING.separationGrowthPerDay, dayOffset, CURVE_TUNING.separationMaxScale),
        phraseologyStrictness: scaleByDay(dif.phraseologyStrictness, CURVE_TUNING.phraseologyGrowthPerDay, dayOffset, CURVE_TUNING.phraseologyMaxScale),
        pilotRequestRate: scaleByDay(dif.pilotRequestRate, CURVE_TUNING.pilotRateGrowthPerDay, dayOffset, CURVE_TUNING.pilotRateMaxScale),
        weatherRandomness: shiftByDay(dif.weatherRandomness, CURVE_TUNING.weatherGrowthPerDay, dayOffset, 0, CURVE_TUNING.weatherRandomnessMax),
        alertTolerance: shiftByDay(dif.alertTolerance, -CURVE_TUNING.alertToleranceDecayPerDay, dayOffset, CURVE_TUNING.alertToleranceMin, 2)
    };
}
function num(v, fallback = 0) {
    const n = parseFloat(String(v ?? '').replace(/[^0-9.+-]/g, ''));
    return Number.isFinite(n) ? n : fallback;
}

/* ---------------- [scenario] 事件时间轴 ---------------- */

/**
 * 把文件的 events 列表换算为绝对时刻时间轴。
 * @param {Array<{delay:number,type:string,args:string[]}>} events
 * @returns {Array<{t:number,type:string,args:string[]}>} 已按 t 升序、剔除 elapse
 */
export function buildTimeline(events = []) {
    const timeline = [];
    let t = 0;
    for (const ev of events) {
        if (!ev || !ev.type) continue;
        t += Math.max(0, num(ev.delay, 0));
        const args = (ev.args || []).map(v => String(v));
        if (ev.type === 'elapse') {           // 仅推进时间轴（用于班次开始前预置流量）
            t += Math.max(0, num(args[0], 0));
            continue;
        }
        timeline.push({ t, type: ev.type, args });
    }
    return timeline.sort((a, b) => a.t - b.t);
}


/* ---------------- 进场点 / 航司表 ---------------- */

/** 由机场与空域半径生成通用进场点（未导入位置文件时的无限流量入口） */
export function entrypointsFromAirport(airportCode, radiusKm) {
    const ap = getAirport(airportCode);
    if (!ap) return [];
    const dist = kmToPxFixed(radiusKm || 45);
    const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return names.map((name, i) => {
        const hdg = i * 45;
        const rad = (hdg * Math.PI) / 180;
        return {
            heading: hdg,
            beacon: `${airportCode}-${name}`,
            altM: null,
            x: ap.x + Math.sin(rad) * dist,
            y: ap.y - Math.cos(rad) * dist,
            synthetic: true
        };
    });
}

/** 通用航司表（未导入位置文件时按机场枢纽推导） */
export function airlineTableFromHub(airportCode) {
    const codes = airlinesByHub(airportCode);
    const list = codes.length ? codes : Object.keys(AIRLINES).slice(0, 6);
    return list.map(code => ({ code: code.toLowerCase(), amount: 1, types: [], direction: '' }));
}

/* ---------------- 场景包模型 ---------------- */

/**
 * M2 T7：把当前焦点机场写到 state（focusAirport 旧字段 + focusAirportCode 显式字段）。
 * 只做状态对齐，不广播、不重绘 —— 广播由上层动作（导入位置文件 / 开始班次）负责，
 * 避免在纯派生路径里产生副作用风暴。
 */
function syncFocusAirport(code) {
    if (!code) return;
    state.focusAirport = code;
    state.focusAirportCode = code;
}

/** 默认关卡：无位置文件时也能开一局（无限流量 + 评分） */
export function defaultScenario(opts = {}) {
    const airport = opts.airport || state.focusAirport || 'ZUUU';
    const radiusKm = (state.location && state.location.airspace && state.location.airspace.radiusKm) || 45;
    syncFocusAirport(airport);   // M2 T7：自由流量班次也把焦点机场代码落到 state.focusAirportCode
    return normalizeScenario({
        v: SCENARIO_VERSION,
        id: opts.id || `free-${airport}`,
        name: opts.name || `${airport} · 自由流量班次`,
        airport,
        difficulty: opts.difficulty || 'standard',
        seed: opts.seed ?? DEFAULT_SEED,
        entrypoints: entrypointsFromAirport(airport, radiusKm),
        airlineTable: airlineTableFromHub(airport),
        timeline: [],
        objectives: opts.objectives,
        finish: opts.finish || null
    });
}

/**
 * 由 Endless ATC 位置文件场景派生关卡。
 * @param {object} scene domain/locations.js 的 locationToScene() 结果
 * @param {{id?:string,name?:string,difficulty?:string,seed?:number,objectives?:Array}} [opts]
 */
export function scenarioFromLocation(scene, opts = {}) {
    if (!scene || !scene.code || !scene.mainAirport) return defaultScenario(opts);
    const main = scene.mainAirport;
    const beaconByName = new Map((scene.beacons || []).map(b => [String(b.name).toLowerCase(), b]));

    const entrypoints = (main.entrypoints || []).map(ep => {
        const b = beaconByName.get(String(ep.beacon || '').toLowerCase());
        return {
            heading: Number.isFinite(ep.heading) ? ep.heading : 0,
            beacon: ep.beacon || '',
            altM: ep.altM,
            x: b ? b.x : null,
            y: b ? b.y : null,
            synthetic: false
        };
    });
    // 文件未给 entrypoints 时按空域半径生成 8 向入口，保证仍有无限流量
    const radiusKm = (scene.airspace && scene.airspace.radiusKm) || 45;
    const fallback = entrypoints.length ? [] : entrypointsFromAirport(scene.code, radiusKm);

    const runwayIdents = {};
    (main.runways || []).forEach(r => { if (r.ident) runwayIdents[r.ident] = r.name; });

    syncFocusAirport(scene.code);   // M2 T7：位置文件机场成为当前焦点，与经营汇总（multiAirport）对齐

    return normalizeScenario({
        v: SCENARIO_VERSION,
        id: opts.id || `loc-${scene.code}`,
        name: opts.name || `${scene.name || scene.code}（位置文件）`,
        airport: scene.code,
        difficulty: opts.difficulty || 'standard',
        seed: opts.seed ?? DEFAULT_SEED,
        finish: scene.scenario && scene.scenario.finish ? scene.scenario.finish : null,
        entrypoints: [...entrypoints, ...fallback],
        airlineTable: (main.airlines && main.airlines.length ? main.airlines : airlineTableFromHub(scene.code)),
        runwayIdents,
        runwayPairs: (main.runways || []).map(r => r.name).filter(Boolean),
        dischargeAltM: main.climbAltM || null,
        sids: (main.sids || []).filter(s => Number.isFinite(s.x) && Number.isFinite(s.y)).map(s => ({ name: s.name, x: s.x, y: s.y })),
        configurations: scene.configurations || [],
        timeline: buildTimeline(scene.scenario ? scene.scenario.events : []),
        objectives: opts.objectives
    });
}

/** 规范化场景包：补齐全部字段（缺省即默认），保证导演与评分可安全读取 */
export function normalizeScenario(raw = {}) {
    const airport = raw.airport || state.focusAirport || 'ZUUU';
    const dif = DIFFICULTY[raw.difficulty] || DIFFICULTY.standard;
    return {
        v: SCENARIO_VERSION,
        id: raw.id || `scenario-${airport}`,
        name: raw.name || airport,
        airport,
        difficulty: dif.key,
        seed: Number.isFinite(raw.seed) ? raw.seed : DEFAULT_SEED,
        config: raw.config || { wind: null, weather: { enabled: false, intensity: 0.4 }, autoRunways: true },
        finish: raw.finish && (raw.finish.count || raw.finish.timeLimit)
            ? { count: num(raw.finish.count, 0), timeLimit: raw.finish.timeLimit ? num(raw.finish.timeLimit, 0) : null }
            : null,
        entrypoints: Array.isArray(raw.entrypoints) ? raw.entrypoints : [],
        airlineTable: Array.isArray(raw.airlineTable) ? raw.airlineTable : [],
        runwayIdents: raw.runwayIdents || {},
        runwayPairs: Array.isArray(raw.runwayPairs) ? raw.runwayPairs : [],
        dischargeAltM: raw.dischargeAltM || null,
        sids: Array.isArray(raw.sids) ? raw.sids : [],
        configurations: Array.isArray(raw.configurations) ? raw.configurations : [],
        timeline: Array.isArray(raw.timeline) ? raw.timeline : [],
        objectives: Array.isArray(raw.objectives) && raw.objectives.length ? raw.objectives : null,
        traffic: Array.isArray(raw.traffic) ? raw.traffic : []
    };
}

/** 关卡摘要（面板/通话播报/冒烟断言用） */
export function scenarioSummary(sc) {
    if (!sc) return null;
    return {
        id: sc.id,
        name: sc.name,
        airport: sc.airport,
        difficulty: sc.difficulty,
        difficultyLabel: (DIFFICULTY[sc.difficulty] || DIFFICULTY.standard).label,
        entrypoints: sc.entrypoints.length,
        airlines: sc.airlineTable.length,
        events: sc.timeline.length,
        configurations: sc.configurations.length,
        finish: sc.finish,
        source: sc.runwayPairs.length ? 'location' : 'default'
    };
}
