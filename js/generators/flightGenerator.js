/**
 * generators/flightGenerator.js — 航班/航迹生成器（生成层）
 * 移植参考项目 flight_generator：按机场枢纽数据自动生成进港/离港航班，
 * 自动创建 STAR/SID 航线，并使用约束模型模拟下降/爬升。
 */

import { state, setFocusAirport } from '../core/store.js';
import { nextId } from '../core/ids.js';
import { kmToPxFixed } from '../core/viewport.js';
import { pickOverflightRoute } from '../data/overflightRoute.js';
import {
    getAirport, distantAirport, airportName, AIRPORTS
} from '../data/airports.js';
import {
    airlineForHub, makeCallsign, randomFlightNumber
} from '../data/airlines.js';
import {
    getAircraft, defaultSpeed, defaultAltitude, randomType
} from '../data/aircraft.js';
import { setAltitudeConstraint, setSpeedConstraint } from '../simulation/motion.js';
import { assignRunwayFor } from '../domain/airspace.js';
import { normalizeAircraft } from '../domain/aircraft.js';

/** 统一 ID（core/ids.js）：原 Date.now() 自增在同毫秒多实体时会碰撞 */
const genId = nextId;

/** 在 a、b 之间插值生成 n 个中间点（带轻微横向偏移，更像航路） */
function interpolatePoints(a, b, n) {
    const pts = [];
    for (let i = 1; i <= n; i++) {
        const t = i / (n + 1);
        const x = a.x + (b.x - a.x) * t + (Math.random() - 0.5) * 40;
        const y = a.y + (b.y - a.y) * t + (Math.random() - 0.5) * 40;
        pts.push({ id: genId(), name: `W${genId() % 9000 + 1000}`, x: Math.round(x), y: Math.round(y), type: 'normal' });
    }
    return pts;
}

function makeRoute(fromPt, toPt, nWaypoints = 2) {
    const mids = interpolatePoints(fromPt, toPt, nWaypoints);
    const points = [fromPt, ...mids, toPt];
    const route = {
        id: genId(),
        name: `航线${state.routes.length + 1}`,
        points,
        color: `hsl(${Math.floor(Math.random() * 360)}, 65%, 55%)`
    };
    state.routePoints.push(...points);
    state.routes.push(route);
    return route;
}

/** 生成一架进港航班（从外站飞向焦点机场，模拟下降） */
export function createArrival(focusCode = 'ZUUU', startTime = 0) {
    const focus = getAirport(focusCode) || { name: focusCode, x: 0, y: 0 };
    const focusPt = { id: genId(), name: focusCode, x: focus.x, y: focus.y, type: 'navaid' };
    const originCode = distantAirport(focusCode);
    const origin = getAirport(originCode);
    const originPt = { id: genId(), name: originCode, x: origin.x, y: origin.y, type: 'navaid' };

    const acType = randomType();
    const def = getAircraft(acType);
    const airline = airlineForHub(originCode);
    const route = makeRoute(originPt, focusPt, 2);

    const ac = {
        id: genId(),
        x: originPt.x, y: originPt.y,
        displayX: originPt.x, displayY: originPt.y,
        flightNo: makeCallsign(airline, randomFlightNumber()),
        squawk: String(Math.floor(Math.random() * 7000) + 2000),
        departure: originCode,
        destination: focusCode,
        flow: 'arrival',                                    // 进港：由区调 → 进近 → 塔台
        runway: assignRunwayFor(focusCode, 0),               // 预指派落地跑道（塔台可改）
        approachType: null,                                  // 进近方式待发进近许可时确定
        acType,
        altitude: def.cruiseAlt,
        speed: def.cruiseSpeed,
        heading: 90,
        routeId: route.id,
        routeDistance: 0,
        navMode: 'route',
        nextWaypointIdx: 1,
        startTime,
        trail: [],
        labelOffsetX: 18, labelOffsetY: -14
    };
    normalizeAircraft(ac);                                  // 统一 flow/phase/wake/clearances 字段
    state.aircraft.push(ac);
    // 进港过程：下降并减速
    setAltitudeConstraint(ac, 3600, 0);
    setSpeedConstraint(ac, 250, 0);
    return ac;
}

/** 生成一架离港航班（从焦点机场飞向外站，模拟爬升） */
export function createDeparture(focusCode = 'ZUUU', startTime = 0) {
    const focus = getAirport(focusCode) || { name: focusCode, x: 0, y: 0 };
    const focusPt = { id: genId(), name: focusCode, x: focus.x, y: focus.y, type: 'navaid' };
    const destCode = distantAirport(focusCode);
    const dest = getAirport(destCode);
    const destPt = { id: genId(), name: destCode, x: dest.x, y: dest.y, type: 'navaid' };

    const acType = randomType();
    const def = getAircraft(acType);
    const airline = airlineForHub(focusCode);
    const route = makeRoute(focusPt, destPt, 2);

    const ac = {
        id: genId(),
        x: focusPt.x, y: focusPt.y + kmToPxFixed(2.1),
        displayX: focusPt.x, displayY: focusPt.y + kmToPxFixed(2.1),
        flightNo: makeCallsign(airline, randomFlightNumber()),
        squawk: String(Math.floor(Math.random() * 7000) + 2000),
        departure: focusCode,
        destination: destCode,
        flow: 'departure',                                  // 离港：由塔台 → 进近 → 区调
        runway: assignRunwayFor(focusCode, 1),               // 起飞跑道（塔台放行时使用）
        plannedAltitude: def.cruiseAlt,                      // 计划巡航高度：起飞许可后爬升
        plannedSpeed: def.cruiseSpeed,                       // 计划巡航速度：起飞许可后加速
        clearance: null,                                     // 待塔台放行
        groundStage: 'parked',
        acType,
        altitude: 0,
        speed: 0,
        heading: 90,
        routeId: route.id,
        routeDistance: 0,
        navMode: 'route',
        nextWaypointIdx: 1,
        startTime,
        trail: [],
        labelOffsetX: 18, labelOffsetY: -14
    };
    normalizeAircraft(ac);                                  // 统一 flow/phase/wake/clearances 字段
    state.aircraft.push(ac);
    // 爬升/加速不在此处施加：由塔台「可以起飞」许可（或自动许可）触发，
    // 从而让 塔台放行 → 进近 → 区调 的席位流程在时间轴上可观察。
    return ac;
}

/** 自由场景也加入一架立即可见的区域飞越航班。 */
export function createOverflight(focusCode = 'ZUUU', startTime = 0) {
    const sector = pickOverflightRoute(focusCode);
    if (!sector) return null;
    const fromPt = { id: genId(), name: '区域入口', ...sector.entry, type: 'normal' };
    const toPt = { id: genId(), name: '区域出口', ...sector.exit, type: 'normal' };
    const route = makeRoute(fromPt, toPt, 0);
    route.name = `飞越航路 ${sector.departure}-${sector.destination}`;
    route.color = '#8274b8';
    const acType = randomType();
    const def = getAircraft(acType);
    const ac = {
        id: genId(), x: fromPt.x, y: fromPt.y,
        displayX: fromPt.x, displayY: fromPt.y,
        flightNo: makeCallsign(airlineForHub(sector.departure), randomFlightNumber()),
        squawk: String(Math.floor(Math.random() * 7000) + 2000),
        departure: sector.departure, destination: sector.destination,
        flow: 'overflight', unit: 'ACC', runway: null, sectorAirport: focusCode,
        acType, altitude: def.cruiseAlt, speed: def.cruiseSpeed,
        plannedAltitude: def.cruiseAlt, plannedSpeed: def.cruiseSpeed,
        heading: 90, routeId: route.id, routeDistance: 0,
        navMode: 'route', nextWaypointIdx: 1, startTime,
        trail: [], labelOffsetX: 18, labelOffsetY: -14
    };
    normalizeAircraft(ac);
    state.aircraft.push(ac);
    return ac;
}

/**
 * 生成一整套场景：若干进港 + 离港，可选焦点机场。
 * 直接写入全局 state，返回统计信息。
 */
export function generateScenario(focusCode = 'ZUUU', arrivals = 4, departures = 3) {
    const before = state.aircraft.length;
    setFocusAirport(focusCode);            // 管制区渲染 + 席位参考机场随场景切换
    const tMax = state.defaults.timeMax;
    for (let i = 0; i < arrivals; i++) {
        createArrival(focusCode, Math.floor(Math.random() * tMax * 0.25));
    }
    for (let i = 0; i < departures; i++) {
        createDeparture(focusCode, Math.floor(Math.random() * tMax * 0.25));
    }
    const overflights = createOverflight(focusCode, 0) ? 1 : 0;
    return {
        focus: airportName(focusCode),
        added: state.aircraft.length - before,
        arrivals, departures, overflights
    };
}

export { AIRPORTS };
