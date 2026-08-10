/**
 * simulation/index.js — 运动模型层集结 + 复用辅助
 */

import { state, pxToKm } from '../core.js';
import { getPositionOnRoute, pointToSegmentDist } from './geometry.js';
import {
    calculateAircraftPositionAtTime,
    updateAircraftPositionsForTime,
    updateTrails,
    setAltitudeConstraint,
    setSpeedConstraint,
    setHeadingConstraint
} from './motion.js';

export * from './geometry.js';
export * from './motion.js';
export * from './conflict.js';

/** 播放开始时捕获基准位置（用于回放/约束起点） */
export function saveBasePositions() {
    state.basePositions = {};
    state.aircraft.forEach(ac => {
        state.basePositions[ac.id] = {
            x: ac.displayX !== undefined ? ac.displayX : ac.x,
            y: ac.displayY !== undefined ? ac.displayY : ac.y,
            heading: ac.heading || 90,
            routeDistance: ac.routeDistance || 0,
            navMode: ac.navMode || 'heading',
            targetX: ac.targetX,
            targetY: ac.targetY,
            nextWaypointIdx: ac.nextWaypointIdx
        };
    });
    state.baseTime = state.time;
}

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
    const x = ac.displayX !== undefined ? ac.displayX : ac.x;
    const y = ac.displayY !== undefined ? ac.displayY : ac.y;
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
    const x = ac.displayX !== undefined ? ac.displayX : ac.x;
    const y = ac.displayY !== undefined ? ac.displayY : ac.y;
    const dx = pt.x - x, dy = pt.y - y;
    const distPx = Math.sqrt(dx * dx + dy * dy);
    const distKm = pxToKm(distPx);
    const speedKmPerSec = ((ac.displaySpeed ?? ac.speed ?? state.defaults.speed) * 0.00051444) * 1.852;
    const timeSec = distKm / speedKmPerSec;
    return { x: pt.x, y: pt.y, timeToReach: Math.round(timeSec), distance: Math.round(distKm) };
}

export { setAltitudeConstraint, setSpeedConstraint, setHeadingConstraint, calculateAircraftPositionAtTime, updateAircraftPositionsForTime, updateTrails };
