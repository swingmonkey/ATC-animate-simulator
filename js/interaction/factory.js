/**
 * interaction/factory.js — 实体工厂（输入层）
 * 统一创建航路点 / 飞机并写入 state；面板刷新与持久化由事件总线驱动，
 * 工厂不再直接操作 UI（原先的 addPointPanelItem/updateCommTargetSelect 调用已移除）。
 */

import { state, addComm, commitScene } from '../core/store.js';
import { nextId } from '../core/ids.js';
import { randomAirline, randomFlightNumber, makeCallsign } from '../data/airlines.js';

export function addPoint(x, y, type = 'normal') {
    const pt = {
        id: nextId(),
        name: `P${state.pointNameCounter++}`,
        x, y,
        type
    };
    state.routePoints.push(pt);
    addComm('atc', `航路点 ${pt.name} 已创建`);
    commitScene();
    return pt;
}

export function addAircraft(x, y) {
    const airline = randomAirline();
    const ac = {
        id: nextId(),
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
    addComm('pilot', `${ac.flightNo} 呼叫，高度${ac.altitude}m，速度${ac.speed}kt`);
    addComm('atc', `${ac.flightNo} 雷达识别，自由飞行`);
    commitScene();
    return ac;
}