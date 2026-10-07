/**
 * simulation/index.js — 运动模型层集结 + 复用辅助
 * （原 saveBasePositions/basePositions 已移除：全库只写不读的死状态）
 */

import { state } from '../core/store.js';
import { pxToKm } from '../core/viewport.js';
import { KT_TO_KMPS } from '../core/constants.js';
import { posX, posY, spdOf } from '../core/accessors.js';

export * from './geometry.js';
export * from './motion.js';
export * from './constraints.js';

export function getWaypointInfoForAircraft(ac) {
    if (!ac.routeId) return null;
    const route = state.routes.find(r => r.id === ac.routeId);
    if (!route || route.points.length < 2) return null;

    let totalLen = 0;
    for (let i = 1; i < route.points.length; i++) {
        const dx = route.points[i].x - route.points[i - 1].x;
        const dy = route.points[i].y - route.points[i - 1].y;
        totalLen += Math.sqrt(dx * dx + dy * dy);
    }
    const x = posX(ac);
    const y = posY(ac);
    let minDist = Infinity, nearestIdx = 0;
    for (let i = 0; i < route.points.length; i++) {
        const dx = route.points[i].x - x, dy = route.points[i].y - y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < minDist) { minDist = d; nearestIdx = i; }
    }
    const pt = route.points[nearestIdx];
    const ptName = pt.name || `P${pt.id}`;
    return {
        nextPointName: ptName,
        nextPointIdx: nearestIdx + 1,
        totalPoints: route.points.length,
        distance: Math.round(pxToKm(minDist))
    };
}

export function getPositionAndTimeForWaypoint(ac, waypointIdx) {
    if (!ac.routeId) return null;
    const route = state.routes.find(r => r.id === ac.routeId);
    if (!route || waypointIdx < 0 || waypointIdx >= route.points.length) return null;
    const pt = route.points[waypointIdx];
    const x = posX(ac);
    const y = posY(ac);
    const dx = pt.x - x, dy = pt.y - y;
    const distPx = Math.sqrt(dx * dx + dy * dy);
    const distKm = pxToKm(distPx);
    const speedKmPerSec = (spdOf(ac) ?? state.defaults.speed) * KT_TO_KMPS;
    const timeSec = distKm / speedKmPerSec;
    return { x: pt.x, y: pt.y, timeToReach: Math.round(timeSec), distance: Math.round(distKm) };
}
