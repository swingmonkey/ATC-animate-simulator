/**
 * tools/check-location.mjs — Endless ATC 位置文件离线校验器（开发工具，Node 直跑）
 *
 * 用法：node tools/check-location.mjs <位置文件.txt> [更多文件...]
 * 作用：对任意 Endless ATC 机场文件跑「解析 → 场景转换」，输出节数、告警、跑道、信标、
 *      最低高度区、跑道构型、程序航段、航司行、换算后的空域参数等，用于导入前的兼容性自检。
 *
 * 不依赖 DOM 与 Electron：domain 层与 data 层均为纯模块，可直接在 Node 中导入。
 */

import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { parseLocationFile } from '../js/domain/locationFile.js';
import { locationToScene, peekLocationCode } from '../js/domain/locations.js';

const files = process.argv.slice(2);
if (!files.length) {
    console.error('用法：node tools/check-location.mjs <位置文件.txt> [更多文件...]');
    process.exit(2);
}

let failed = 0;
for (const file of files) {
    let text;
    try {
        text = readFileSync(file, 'utf8');
    } catch (err) {
        console.error(`${basename(file)}：读取失败 — ${err.message}`);
        failed++;
        continue;
    }
    const parsed = parseLocationFile(text);
    const code = peekLocationCode(parsed);
    const scene = locationToScene(parsed, { fallbackCode: 'CUSTOM' });
    const routeCount = scene.departures.reduce((n, d) => n + d.routes.length, 0)
        + scene.approaches.reduce((n, a) => n + a.routes.length, 0)
        + scene.transitions.reduce((n, t) => n + t.routes.length, 0);

    console.log(JSON.stringify({
        file: basename(file),
        lines: text.split('\n').length,
        sections: parsed.sections.length,
        warnings: parsed.warnings.length,
        warningSample: parsed.warnings.slice(0, 3),
        code,
        mode: scene.mode,
        runways: scene.mainAirport ? scene.mainAirport.runways.map(r => r.name) : [],
        beacons: scene.beacons.length,
        airports: scene.airports.length,
        areas: scene.areas.length,
        configurations: scene.configurations.length,
        configEntries: scene.configurations.reduce((n, c) => n + c.entries.length, 0),
        routeSegments: routeCount,
        approachSections: scene.approaches.length,
        transitionSections: scene.transitions.length,
        planetypes: scene.planetypes.length,
        events: scene.scenario ? scene.scenario.events.length : 0,
        airlines: scene.airports.reduce((n, a) => n + a.airlines.length, 0),
        backgroundLines: scene.background.length,
        radiusKm: Math.round(scene.airspace.radiusKm * 100) / 100,
        separationNm: scene.airspace.separationNm,
        floorM: Math.round(scene.airspace.floorM),
        aboveM: Math.round(scene.airspace.aboveM)
    }, null, 1));

    if (parsed.warnings.length) failed++;
}

process.exit(failed ? 1 : 0);
