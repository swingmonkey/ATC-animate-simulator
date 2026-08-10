/**
 * interaction/factory.js — 实体工厂（输入层）
 * 统一创建航路点 / 飞机并写入 state + 面板，供调色板拖放与工具栏按钮复用。
 */

import { state } from '../core.js';
import { randomAirline, randomFlightNumber, makeCallsign } from '../data/airlines.js';
import { addPointPanelItem, addAircraftPanelItem, updateCommTargetSelect } from '../ui/index.js';
import { addComm } from '../comm.js';

let _seq = Math.floor(Math.random() * 1e6);
function newId() { return ++_seq; }

export function addPoint(x, y, type = 'normal') {
    const pt = {
        id: newId(),
        name: `P${state.pointNameCounter++}`,
        x, y,
        type
    };
    state.routePoints.push(pt);
    addPointPanelItem(pt);
    addComm('atc', `航路点 ${pt.name} 已创建`);
    return pt;
}

export function addAircraft(x, y) {
    const airline = randomAirline();
    const ac = {
        id: newId(),
        x, y, displayX: x, displayY: y,
        flightNo: makeCallsign(airline, randomFlightNumber()),
        squawk: state.defaults.squawk,
        departure: 'ZBAA',
        destination: 'ZSSS',
        acType: state.defaults.acType,
        altitude: state.defaults.altitude,
        speed: state.defaults.speed,
        heading: 90,
        routeId: null,
        routeDistance: 0,
        navMode: 'heading',
        startTime: state.time,
        trail: [],
        labelOffsetX: 18,
        labelOffsetY: -14
    };
    state.aircraft.push(ac);
    addAircraftPanelItem(ac);
    updateCommTargetSelect();
    addComm('pilot', `${ac.flightNo} 呼叫，高度${ac.altitude}m，速度${ac.speed}kt`);
    addComm('atc', `${ac.flightNo} 雷达识别，自由飞行`);
    return ac;
}
