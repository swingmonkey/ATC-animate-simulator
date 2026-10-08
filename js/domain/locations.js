/**
 * domain/locations.js — Endless ATC 位置文件 → 本项目场景（领域层）
 *
 * 把 domain/locationFile.js 的通用解析结果解释为可用的场景模型，并可应用到运行期 state：
 *   [airspace]       → 空域参数（半径/高度上下限/间隔标准/速度限制/边界/信标/唤醒间隔表）
 *   [airport1..n]    → 本场与辅助机场（跑道、SID 点、进场点、航司概率表、爬升上限）
 *   [area1..n]       → 最低高度区 MVA（圆/多边形）
 *   [configurations] → 跑道构型（按分数启用：起飞/落地/反向/交叉口起飞/落地后回推）
 *   [departure1..n]  → 跑道离场程序（SID 详细航路）
 *   [approach1..n] / [transition1..n] → 跑道进场程序 / 过渡（ILS 拦截）
 *   [planetypes]     → 机型性能表
 *   [scenario]       → 事件时间轴（P1 director 的数据源）
 *   [background]     → 背景线（海岸线/空域线）
 *
 * 坐标统一约定：文件坐标为「本场中心」的相对量（海里或经纬度），
 * 本模块把全部几何一次性换算到本项目世界坐标系（km、x 向东、y 向南），
 * 其它层（渲染/生成/评分）不再关心文件坐标 —— 见 docs/PLAN-v2.md §13。
 *
 * 单位：高度统一为**米**（文件为英尺），距离统一为 **km**（文件为海里）。
 */

import { state, commitScene, setFocusAirport } from '../core/store.js';
import { getAirport, registerAirport, reciprocalRunway } from '../data/airports.js';
import {
    parseLocationFile, getSection, getSections, itemRows, itemTokens, itemValue,
    num, bool, parseLatLon, looksLikeLatLon
} from './locationFile.js';

/** 英尺 → 米 */
export const FT_TO_M = 0.3048;
/** 海里 → km */
export const NM_TO_KM = 1.852;
const ft = v => num(v) * FT_TO_M;
const nm = v => num(v) * NM_TO_KM;

/* ---------------- 坐标读取器 ---------------- */

/** 本场跑道位置均值（作为经纬度模式的原点） */
function averageLatLon(rows) {
    let latSum = 0, lonSum = 0, n = 0;
    rows.forEach(t => {
        const lat = parseLatLon(t[2]), lon = parseLatLon(t[3]);
        if (Number.isFinite(lat) && Number.isFinite(lon)) { latSum += lat; lonSum += lon; n++; }
    });
    return n ? { lat: latSum / n, lon: lonSum / n } : null;
}

/**
 * 建立坐标读取器：tokens → 相对本场的 {x, y}（km，x 向东、y 向南）。
 * @param {'latlon'|'nm'} mode
 * @param {{lat:number,lon:number}|null} origin 经纬度模式的原点
 */
function makeReader(mode, origin) {
    if (mode === 'latlon' && origin) {
        const kx = 111.32 * Math.cos((origin.lat * Math.PI) / 180);
        return tokens => {
            const lat = parseLatLon(tokens[0]), lon = parseLatLon(tokens[1]);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
            return { x: (lon - origin.lon) * kx, y: -(lat - origin.lat) * 110.57 };
        };
    }
    return tokens => {
        const x = parseFloat(String(tokens[0] ?? '').replace(/[^0-9.+-]/g, ''));
        const y = parseFloat(String(tokens[1] ?? '').replace(/[^0-9.+-]/g, ''));
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return { x: x * NM_TO_KM, y: -y * NM_TO_KM };   // 文件 +y 为北，本项目 +y 为南
    };
}

/** 平移：把相对坐标补齐为世界坐标 */
function shift(point, placeAt) {
    if (!point) return { x: placeAt.x, y: placeAt.y };
    return { x: point.x + placeAt.x, y: point.y + placeAt.y };
}

/** 预读机场四字码（[airport1] 的 code；被注释掉时返回空串） */
export function peekLocationCode(parsed) {
    const ap1 = getSection(parsed, 'airport1');
    return String(itemValue(ap1, 'code') || '').trim().toUpperCase();
}

/* ---------------- [airspace] ---------------- */

function readAirspace(section, reader, placeAt) {
    if (!section) section = { keys: [], items: {} };    // 无 [airspace] 节时全部取默认值
    const ar = {
        radiusKm: nm(itemValue(section, 'radius', 0) || 30),
        zoom: num(itemValue(section, 'zoom', 0), 5),
        elevationM: ft(itemValue(section, 'elevation', 0)),
        floorM: ft(itemValue(section, 'floor', 0)),
        descentAltM: ft(itemValue(section, 'descentaltitude', 0)),
        ceilingM: ft(itemValue(section, 'ceiling', 0)),
        aboveM: ft(itemValue(section, 'above', 0)),
        diversionaltM: ft(itemValue(section, 'diversionaltitude', 0)),
        transitionAltFt: num(itemValue(section, 'transitionaltitude', 0)),
        separationNm: num(itemValue(section, 'separation', 0), 3),
        localizerSpeed: itemTokens(section, 'localizerspeed').map(v => num(v)),
        speedRestrictions: [],
        metric: bool(itemValue(section, 'metric'), false),
        usa: bool(itemValue(section, 'usa'), false),
        automatic: bool(itemValue(section, 'automatic'), false),
        strictspawn: bool(itemValue(section, 'strictspawn'), false),
        magneticVar: num(itemValue(section, 'magneticvar', 0), 0),
        center: null,
        boundary: [],
        lines: [],
        handoffs: []
    };
    const sr = itemTokens(section, 'speedrestriction');
    if (sr.length) ar.speedRestrictions.push(sr.slice(0, 4).map(v => num(v)));

    const c = itemTokens(section, 'center');
    if (c.length >= 2) ar.center = { lat: parseLatLon(c[0]), lon: parseLatLon(c[1]) };

    itemRows(section, 'boundary').forEach(t => {
        const p = reader(t);
        if (p) ar.boundary.push(shift(p, placeAt));
    });
    // [airspace] 内的 line1..line5：位置列表（无颜色行）
    section.keys.filter(k => /^line\d+$/.test(k)).forEach(key => {
        const pts = [];
        itemRows(section, key).forEach(t => { const p = reader(t); if (p) pts.push(shift(p, placeAt)); });
        if (pts.length) ar.lines.push({ color: 'coast', points: pts });
    });
    itemRows(section, 'handoff').forEach(t => {
        ar.handoffs.push({ heading: num(t[0]), name: t[1] || '', pronunciation: t[2] || '', freq: t[3] || '' });
    });
    return ar;
}

/** [airspace].beacons → 导航点（VOR / 无方向信标） */
function readBeacons(section, reader, placeAt) {
    return itemRows(section, 'beacons').map(t => {
        const p = reader([t[1], t[2]]);
        return {
            name: (t[0] || '').trim(),
            x: p ? p.x : 0, y: p ? p.y : 0,
            holdingHeading: t[3] === undefined || t[3] === '' ? 0 : num(t[3]),
            pronunciation: t[4] || '',
            type: 'vor'
        };
    }).filter(b => b.name).map(b => ({ ...b, x: b.x + placeAt.x, y: b.y + placeAt.y }));
}

/* ---------------- [airport1..n] ---------------- */

function readAirport(section, index, reader, placeAt) {
    const runways = itemRows(section, 'runways').map(t => {
        const p = reader([t[2], t[3]]);
        const pos = shift(p, placeAt);
        return {
            ident: (t[0] || '').toLowerCase(),
            name: (t[1] || '').toUpperCase(),
            x: pos.x, y: pos.y,
            heading: t[4] === undefined || t[4] === '' ? null : num(t[4]),
            lengthFt: num(t[5], 0),
            displacedFt: num(t[6], 0),
            displaced2Ft: num(t[7], 0),
            elevationM: ft(t[8]),
            glideslope: t[9] === undefined || t[9] === '' ? 3 : num(t[9]),
            localizer: t[10] === undefined || t[10] === '' ? null : num(t[10]),
            beacon: t[13] || '',
            beaconDistanceNm: t[14] === undefined || t[14] === '' ? null : num(t[14]),
            towerFreq: t[17] || '',
            towerPronunciation: t[18] || ''
        };
    });

    const sids = itemRows(section, 'sids').map(t => {
        const p = (t[1] !== undefined && t[2] !== undefined) ? reader([t[1], t[2]]) : null;
        return {
            name: (t[0] || '').trim(),
            x: p ? p.x + placeAt.x : null,
            y: p ? p.y + placeAt.y : null,
            pronunciation: t[3] || ''
        };
    });

    const entrypoints = itemRows(section, 'entrypoints').map(t => ({
        heading: num(t[0]),
        beacon: (t[1] || '').trim(),
        altM: t[2] === undefined || t[2] === '' ? null : ft(t[2])
    }));

    const airlines = itemRows(section, 'airlines').map(t => ({
        code: (t[0] || '').trim(),
        amount: num(t[1], 1),
        types: String(t[2] || '').split('/').map(s => s.trim()).filter(Boolean),
        pronunciation: t[3] || '',
        direction: t[4] || ''
    }));

    const climb = itemTokens(section, 'climbaltitude');
    return {
        index,
        code: (itemValue(section, 'code') || '').trim().toUpperCase(),
        name: itemValue(section, 'name'),
        codeCommented: !itemTokens(section, 'code').length,
        runways,
        climbAltM: climb.length && climb[0] !== '' ? ft(climb[0]) : null,
        sids,
        entrypoints,
        airlines
    };
}

/* ---------------- [area1..n]：最低高度区（MVA） ---------------- */

function readAreas(sections, reader, placeAt) {
    return sections.map(section => {
        const shape = (itemValue(section, 'shape') || 'circle').toLowerCase();
        const area = {
            name: itemValue(section, 'name'),
            shape,
            altM: ft(itemValue(section, 'altitude', 0)),
            radiusKm: nm(itemValue(section, 'radius', 0)),
            x: placeAt.x, y: placeAt.y,
            labelX: null, labelY: null,
            points: [],
            drawDegrees: null,
            drawn: true
        };
        const pos = itemTokens(section, 'position');
        if (pos.length >= 2) {
            const p = shift(reader(pos), placeAt);
            area.x = p.x; area.y = p.y;
        }
        const label = itemTokens(section, 'labelpos');
        if (label.length >= 2) {
            const p = shift(reader(label), placeAt);
            area.labelX = p.x; area.labelY = p.y;
        }
        itemRows(section, 'points').forEach(t => {
            const p = reader(t);
            if (p) area.points.push(shift(p, placeAt));
        });
        const arc = itemTokens(section, 'drawdegrees');
        if (arc.length >= 2) area.drawDegrees = { start: num(arc[0]), end: num(arc[1]) };
        const draw = itemTokens(section, 'draw');
        if (draw.length && draw[0] !== '') area.points = area.points.slice(0, Math.max(0, area.points.length - num(draw[0])));
        return area;
    });
}

/* ---------------- [configurations]：跑道构型 ---------------- */

function readConfigurations(section) {
    if (!section) return [];
    return section.keys.filter(k => /^config\d+$/.test(k)).map(key => {
        const entries = itemRows(section, key).map(t => {
            const usageText = String(t[2] || '').toLowerCase();
            return {
                score: num(t[0], 0),
                ident: (t[1] || '').toLowerCase(),
                usage: {
                    start: usageText.includes('start'),
                    land: usageText.includes('land'),
                    rev: usageText.includes('rev'),
                    int: usageText.includes('int'),
                    track: usageText.includes('track')
                },
                offsetHeading: t[3] === undefined || t[3] === '' ? null : num(t[3]),
                nosid: String(t[4] || '').toLowerCase() === 'nosid'
            };
        }).sort((a, b) => a.score - b.score);
        return { name: key, entries };
    });
}

/* ---------------- [departure1..n]：SID 详细航路（P3 消费） ---------------- */

function readDepartureRoutes(section, reader, placeAt) {
    const rt = itemTokens(section, 'runway');
    const out = {
        ident: (rt[0] || '').toLowerCase(),
        rev: String(rt[1] || '').toLowerCase() === 'rev',
        routes: []
    };
    section.keys.filter(k => /^route\d+$/.test(k)).forEach(key => {
        const rows = itemRows(section, key);
        if (!rows.length) return;
        const head = rows[0];
        const route = { name: (head[0] || '').trim(), pronunciation: head[1] || '', points: [] };
        rows.slice(1).forEach((t, idx) => {
            const p = reader(t);
            if (!p) return;
            route.points.push({
                x: p.x + placeAt.x, y: p.y + placeAt.y,
                altM: idx === 0 && t[1] !== undefined && t[1] !== '' ? ft(t[1]) : null
            });
        });
        out.routes.push(route);
    });
    return out;
}

/* ---------------- [approach1..n] / [transition1..n]：进场程序与 ILS 过渡（P3 消费） ---------------- */

function readApproachRoutes(section, reader, placeAt, kind) {
    const rt = itemTokens(section, 'runway');
    const bt = itemTokens(section, 'beacon');
    const out = {
        kind,
        ident: (rt[0] || '').toLowerCase(),
        rev: String(rt[1] || '').toLowerCase() === 'rev',
        beacon: (bt[0] || '').trim(),
        beaconDef: null,
        routes: []
    };
    if (bt.length >= 5) {
        const p = reader([bt[1], bt[2]]);
        out.beaconDef = p
            ? { x: p.x + placeAt.x, y: p.y + placeAt.y, holdingHeading: num(bt[3]), pronunciation: bt[4] }
            : null;
    }
    section.keys.filter(k => /^route\d+$/.test(k)).forEach(key => {
        const rows = itemRows(section, key);
        if (!rows.length) return;
        const head = rows[0];
        const route = {
            bearing: num(head[0]),
            name: (head[1] || '').trim(),
            pronunciation: head[2] || '',
            points: [],
            end: null
        };
        rows.slice(1).forEach(t => {
            const word = String(t[0] || '').trim().toLowerCase();
            if (word === 'end') {                    // 允许在最后航路点结束（等待向量）或进入等待航线
                route.end = { type: String(t[1] || '').trim().toLowerCase() };
                return;
            }
            const p = reader(t);
            if (!p) return;
            route.points.push({
                x: p.x + placeAt.x, y: p.y + placeAt.y,
                maxAltM: t[2] === undefined || t[2] === '' ? null : ft(t[2]),
                maxSpd: t[3] === undefined || t[3] === '' ? null : num(t[3])
            });
        });
        out.routes.push(route);
    });
    return out;
}

/* ---------------- [planetypes] / [scenario] / [background] ---------------- */

function readPlanetypes(section) {
    if (!section) return [];
    return itemRows(section, 'types').map(t => ({
        type: (t[0] || '').trim(),
        category: num(t[1], 4),
        minSpeed: num(t[2], 140), maxSpeed: num(t[3], 250),
        minTurnRate: num(t[4], 2.9), maxTurnRate: num(t[5], 3.1),
        minDescentRate: num(t[6], 1400), maxDescentRate: num(t[7], 1600),
        approachSpeed: [num(t[8], 120), num(t[9], 140)],
        accel: [num(t[10], 1.1), num(t[11], 1.3)],
        manufacturer: t[12] || '',
        rollAngle: [num(t[13], 25), num(t[14], 30)],
        rollRate: [num(t[15], 3), num(t[16], 5)],
        climbRate: [num(t[17], 4000), num(t[18], 5000)]
    }));
}

function readScenario(section) {
    if (!section) return null;
    const finishTokens = itemTokens(section, 'finish');
    return {
        finish: finishTokens.length
            ? {
                count: num(finishTokens[0], 0),
                timeLimit: finishTokens[1] === undefined || finishTokens[1] === '' ? null : num(finishTokens[1])
            }
            : null,
        events: itemRows(section, 'events').map(t => ({
            delay: num(t[0], 0),
            type: String(t[1] || '').toLowerCase(),
            args: t.slice(2)
        }))
    };
}

const LINE_COLORS = new Set(['coast', 'airspace', 'runway']);

function readBackground(section, reader, placeAt) {
    if (!section) return [];
    const lines = [];
    section.keys.filter(k => /^line\d+$/.test(k)).forEach(key => {
        const rows = itemRows(section, key);
        if (!rows.length) return;
        let color = 'coast';
        let start = 0;
        const first = rows[0];
        if (first.length === 1 && LINE_COLORS.has(String(first[0]).toLowerCase())) {
            color = String(first[0]).toLowerCase(); start = 1;
        } else if (first.length === 3 && first.every(v => /^\d+$/.test(v))) {
            color = first.join(','); start = 1;
        }
        const points = [];
        rows.slice(start).forEach(t => { const p = reader(t); if (p) points.push(shift(p, placeAt)); });
        if (points.length) lines.push({ color, points });
    });
    return lines;
}

/* ---------------- 解析结果 → 场景模型 ---------------- */

/**
 * 把解析结果转换为本项目场景模型（所有几何已换算到世界坐标系 km）。
 * @param {object} parsed parseLocationFile 的结果
 * @param {{placeAt?:{x:number,y:number}, fallbackCode?:string}} [opts] placeAt = 本场在世界坐标中的位置
 */
export function locationToScene(parsed, opts = {}) {
    const placeAt = opts.placeAt || { x: 0, y: 0 };
    const airportSections = getSections(parsed, 'airport');
    const mainSection = getSection(parsed, 'airport1') || airportSections[0] || null;
    if (!mainSection) {
        return {
            code: opts.fallbackCode || 'CUSTOM',
            warnings: [...parsed.warnings, '缺少 [airport1] 节，无法构建场景']
        };
    }

    const rwyRows = itemRows(mainSection, 'runways');
    const airspaceSection = getSection(parsed, 'airspace');
    const decimalDegrees = airspaceSection ? bool(itemValue(airspaceSection, 'decimaldegrees'), false) : false;
    const latlonMode = decimalDegrees || rwyRows.some(t => looksLikeLatLon(t[2]) || looksLikeLatLon(t[3]));
    const mode = latlonMode ? 'latlon' : 'nm';
    const origin = latlonMode ? averageLatLon(rwyRows) : null;
    const reader = makeReader(mode, origin);

    const airports = airportSections.map((s, i) => readAirport(s, i + 1, reader, placeAt));
    const main = airports[0] || null;

    return {
        code: (main && main.code) ? main.code : (opts.fallbackCode || 'CUSTOM'),
        name: main ? main.name : '',
        mode, origin,
        airspace: readAirspace(airspaceSection, reader, placeAt),
        beacons: readBeacons(airspaceSection, reader, placeAt),
        airports,
        mainAirport: main,
        areas: readAreas(getSections(parsed, 'area'), reader, placeAt),
        configurations: readConfigurations(getSection(parsed, 'configurations')),
        departures: getSections(parsed, 'departure').map(s => readDepartureRoutes(s, reader, placeAt)),
        approaches: getSections(parsed, 'approach').map(s => readApproachRoutes(s, reader, placeAt, 'approach')),
        transitions: getSections(parsed, 'transition').map(s => readApproachRoutes(s, reader, placeAt, 'transition')),
        planetypes: readPlanetypes(getSection(parsed, 'planetypes')),
        scenario: readScenario(getSection(parsed, 'scenario')),
        background: readBackground(getSection(parsed, 'background'), reader, placeAt),
        warnings: parsed.warnings.slice()
    };
}

/* ---------------- 应用到运行期场景 ---------------- */

function firstTowerFrequency(mainAirport) {
    if (!mainAirport) return '';
    const r = mainAirport.runways.find(x => x.towerFreq);
    return r ? r.towerFreq : '';
}

/**
 * 应用到运行期 state：注册/覆盖机场、写入隔离标准与高度上下限、切换焦点机场、广播刷新。
 * @param {object} scene locationToScene 的结果
 * @returns {{code:string,runways:number,beacons:number,areas:number,configurations:number,events:number,warnings:number}}
 */
export function applyLocation(scene) {
    const code = scene.code;
    const known = getAirport(code);
    const place = known ? { x: known.x, y: known.y } : { x: 0, y: 0 };
    const main = scene.mainAirport;
    const pairs = [...new Set(((main && main.runways) || []).map(r => `${r.name}/${reciprocalRunway(r.name)}`))];

    registerAirport(code, {
        name: scene.name || code,
        region: known ? known.region : '自定义',
        x: place.x, y: place.y,
        runways: pairs.length ? pairs : ['18/36'],
        twr: firstTowerFrequency(main) || (known ? known.twr : '118.0'),
        app: known ? known.app : '120.0'
    });

    state.location = scene;
    if (scene.airspace.separationNm) {
        state.defaults.minSeparationNm = Math.max(1, Math.round(scene.airspace.separationNm));
    }
    if (scene.airspace.floorM) state.defaults.altMinM = Math.round(scene.airspace.floorM);
    if (scene.airspace.aboveM) {
        state.defaults.altMaxM = Math.round(scene.airspace.aboveM);
        state.defaults.altitude = Math.round(scene.airspace.aboveM);
    }
    setFocusAirport(code);   // M2 T7：同步 focusAirport / focusAirportCode（内部广播 UNIT_CHANGED）
    commitScene();

    return {
        code,
        runways: pairs.length,
        beacons: scene.beacons.length,
        areas: scene.areas.length,
        configurations: scene.configurations.length,
        events: scene.scenario ? scene.scenario.events.length : 0,
        warnings: scene.warnings.length
    };
}

/** 一步到位：文本 → 场景 → 应用（导入按钮与冒烟测试共用） */
export function importLocationText(text, opts = {}) {
    const parsed = parseLocationFile(text);
    const code = peekLocationCode(parsed) || opts.fallbackCode || 'CUSTOM';
    const known = getAirport(code);
    const scene = locationToScene(parsed, {
        placeAt: known ? { x: known.x, y: known.y } : { x: 0, y: 0 },
        fallbackCode: code
    });
    return { parsed, scene, applied: applyLocation(scene) };
}

