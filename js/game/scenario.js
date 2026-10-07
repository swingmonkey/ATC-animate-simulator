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
import { kmToPxFixed } from '../core/viewport.js';

/** 场景包版本（存储键规划详见 docs/PLAN-v2.md §9） */
export const SCENARIO_VERSION = 3;

/** 难度预设：流量注入节奏、在管架数上限与复诵严格度（用语强制/间隔严格度见 P3） */
export const DIFFICULTY = {
    arcade: { key: 'arcade', label: '街机', spawnIntervalSec: 55, arrivalRatio: 0.6, maxAircraft: 26, maxSpawn: 90, readbackErrorRate: 0 },
    standard: { key: 'standard', label: '标准', spawnIntervalSec: 80, arrivalRatio: 0.62, maxAircraft: 22, maxSpawn: 70, readbackErrorRate: 0.08 },
    realistic: { key: 'realistic', label: '拟真', spawnIntervalSec: 110, arrivalRatio: 0.65, maxAircraft: 18, maxSpawn: 50, readbackErrorRate: 0.2 }
};

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

/** 默认关卡：无位置文件时也能开一局（无限流量 + 评分） */
export function defaultScenario(opts = {}) {
    const airport = opts.airport || state.focusAirport || 'ZUUU';
    const radiusKm = (state.location && state.location.airspace && state.location.airspace.radiusKm) || 45;
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
