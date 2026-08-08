/**
 * simulation.js — 飞机运动模拟
 * 位置计算、轨迹更新、冲突检测、几何辅助。
 */

import {
    state,
    getPixelsPerKm,
    kmToPx,
    pxToKm,
    pxToKmFixed,
} from './core.js';

export function pointToSegmentDist(px, py, p1, p2) {
    const A = px - p1.x, B = py - p1.y, C = p2.x - p1.x, D = p2.y - p1.y;
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    if (lenSq === 0) return Math.sqrt(A * A + B * B);
    let param = Math.max(0, Math.min(1, dot / lenSq));
    return Math.sqrt((px - (p1.x + param * C)) ** 2 + (py - (p1.y + param * D)) ** 2);
}

export function pointOnRoute(mx, my, route) {
    let minDist = Infinity;
    for (let i = 1; i < route.points.length; i++) {
        const d = pointToSegmentDist(mx, my, route.points[i - 1], route.points[i]);
        if (d < minDist) minDist = d;
    }
    return minDist;
}

export function getPositionOnRoute(px, py, route) {
    let minDist = Infinity;
    let bestParam = 0;
    let bestSegIdx = 0;
    let minX = px, minY = py;

    for (let i = 1; i < route.points.length; i++) {
        const p1 = route.points[i - 1];
        const p2 = route.points[i];
        const A = px - p1.x, B = py - p1.y;
        const C = p2.x - p1.x, D = p2.y - p1.y;
        const lenSq = C * C + D * D;
        if (lenSq === 0) continue;
        let param = Math.max(0, Math.min(1, (A * C + B * D) / lenSq));
        const ix = p1.x + param * C;
        const iy = p1.y + param * D;
        const dist = Math.sqrt((px - ix) ** 2 + (py - iy) ** 2);
        if (dist < minDist) {
            minDist = dist;
            bestParam = param;
            bestSegIdx = i - 1;
            minX = ix;
            minY = iy;
        }
    }

    let totalDist = 0;
    for (let i = 1; i <= bestSegIdx; i++) {
        const dx = route.points[i].x - route.points[i - 1].x;
        const dy = route.points[i].y - route.points[i - 1].y;
        totalDist += Math.sqrt(dx * dx + dy * dy);
    }
    const segDx = route.points[bestSegIdx + 1].x - route.points[bestSegIdx].x;
    const segDy = route.points[bestSegIdx + 1].y - route.points[bestSegIdx].y;
    const segLen = Math.sqrt(segDx * segDx + segDy * segDy);
    totalDist += bestParam * segLen;

    return { dist: totalDist, x: minX, y: minY, segIdx: bestSegIdx, param: bestParam };
}

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

export function calculateAircraftPositionAtTime(ac, targetTime) {
    const acStartTime = ac.startTime || 0;

    if (targetTime < acStartTime) {
        return { visible: false, x: ac.x, y: ac.y, heading: ac.heading || 90 };
    }

    const speedKmPerSec = ((ac.speed || state.defaults.speed) * 0.00051444) * 1.852;
    const pixelsPerKm = getPixelsPerKm();

    if (ac.navMode === 'free' && ac.targetX !== undefined && ac.targetY !== undefined) {
        const startX = ac.x;
        const startY = ac.y;
        const timeFromStart = targetTime - acStartTime;
        const distPx = speedKmPerSec * timeFromStart * pixelsPerKm;

        const dx = ac.targetX - startX;
        const dy = ac.targetY - startY;
        const totalDist = Math.sqrt(dx * dx + dy * dy);
        const heading = Math.atan2(dx, -dy) * 180 / Math.PI;
        if (heading < 0) heading += 360;

        if (distPx >= totalDist && totalDist > 0) {
            return { visible: true, x: ac.targetX, y: ac.targetY, heading: heading };
        }

        const ratio = totalDist > 0 ? distPx / totalDist : 0;
        return {
            visible: true,
            x: startX + dx * ratio,
            y: startY + dy * ratio,
            heading: heading
        };
    }

    if (!ac.routeId) {
        const heading = ac.heading || 90;
        const startX = ac.x;
        const startY = ac.y;
        const timeFromStart = targetTime - acStartTime;
        const headRad = (heading - 90) * Math.PI / 180;
        const distPx = speedKmPerSec * timeFromStart * pixelsPerKm;
        return {
            visible: true,
            x: startX + Math.cos(headRad) * distPx,
            y: startY - Math.sin(headRad) * distPx,
            heading: heading
        };
    }

    const route = state.routes.find(r => r.id === ac.routeId);
    if (!route || route.points.length < 2) {
        return { visible: true, x: ac.x, y: ac.y, heading: ac.heading || 90 };
    }

    let totalLen = 0, segLengths = [];
    for (let i = 1; i < route.points.length; i++) {
        const dx = route.points[i].x - route.points[i - 1].x;
        const dy = route.points[i].y - route.points[i - 1].y;
        const len = Math.sqrt(dx * dx + dy * dy);
        segLengths.push(len);
        totalLen += len;
    }
    if (totalLen === 0) {
        return { visible: true, x: route.points[0].x, y: route.points[0].y, heading: ac.heading || 90 };
    }

    const timeFromStart = targetTime - acStartTime;
    const distanceMoved = speedKmPerSec * timeFromStart * pixelsPerKm;

    let startX = ac.x;
    let startY = ac.y;

    let targetIdx = ac.nextWaypointIdx !== undefined ? ac.nextWaypointIdx : -1;
    if (targetIdx < 0 || targetIdx >= route.points.length) {
        let minDist = Infinity;
        for (let i = 0; i < route.points.length; i++) {
            const dx = route.points[i].x - startX, dy = route.points[i].y - startY;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < minDist) { minDist = d; targetIdx = i; }
        }
    }

    let remainingDist = distanceMoved;
    let currentX = startX, currentY = startY;
    let currentIdx = -1;
    let nextIdx = targetIdx;
    let cameFromIdx = -1;

    while (remainingDist > 0.001 && nextIdx >= 0 && nextIdx < route.points.length) {
        const targetPt = route.points[nextIdx];
        const dx = targetPt.x - currentX, dy = targetPt.y - currentY;
        const distToTarget = Math.sqrt(dx * dx + dy * dy);

        if (remainingDist <= distToTarget) {
            const ratio = distToTarget > 0 ? remainingDist / distToTarget : 0;
            const heading = Math.atan2(dx, -dy) * 180 / Math.PI;
            return {
                visible: true,
                x: currentX + dx * ratio,
                y: currentY + dy * ratio,
                heading: heading < 0 ? heading + 360 : heading
            };
        }

        remainingDist -= distToTarget;
        currentX = targetPt.x;
        currentY = targetPt.y;

        if (currentIdx === -1) {
            let currentSegmentIdx = -1;
            let minDistToSegment = Infinity;

            for (let i = 0; i < route.points.length - 1; i++) {
                const dist = pointToSegmentDist(startX, startY, route.points[i], route.points[i + 1]);
                if (dist < minDistToSegment) {
                    minDistToSegment = dist;
                    currentSegmentIdx = i;
                }
            }

            if (currentSegmentIdx >= 0 && currentSegmentIdx < route.points.length - 1) {
                const segStartIdx = currentSegmentIdx;
                const segEndIdx = currentSegmentIdx + 1;

                if (targetIdx > segEndIdx) {
                    cameFromIdx = segStartIdx;
                } else if (targetIdx < segStartIdx) {
                    cameFromIdx = segEndIdx;
                } else {
                    if (targetIdx === segEndIdx) {
                        cameFromIdx = segStartIdx;
                    } else if (targetIdx === segStartIdx) {
                        cameFromIdx = segEndIdx;
                    } else {
                        const prevPt = route.points[targetIdx - 1];
                        const postPt = route.points[targetIdx + 1];
                        const distToPrev = Math.sqrt((startX - prevPt.x) ** 2 + (startY - prevPt.y) ** 2);
                        const distToPost = Math.sqrt((startX - postPt.x) ** 2 + (startY - postPt.y) ** 2);
                        cameFromIdx = distToPost < distToPrev ? targetIdx + 1 : targetIdx - 1;
                    }
                }
            } else if (route.points.length > 1) {
                const prevPt = route.points[Math.max(0, targetIdx - 1)];
                const postPt = route.points[Math.min(route.points.length - 1, targetIdx + 1)];
                const distToPrev = Math.sqrt((startX - prevPt.x) ** 2 + (startY - prevPt.y) ** 2);
                const distToPost = Math.sqrt((startX - postPt.x) ** 2 + (startY - postPt.y) ** 2);
                cameFromIdx = distToPost < distToPrev ? targetIdx + 1 : targetIdx - 1;
            }
        } else {
            cameFromIdx = currentIdx;
        }
        currentIdx = nextIdx;

        const prevIdx = currentIdx - 1;
        const postIdx = currentIdx + 1;

        const isFirstNode = currentIdx === 0;
        const isLastNode = currentIdx === route.points.length - 1;

        if (isLastNode && cameFromIdx < currentIdx) {
            nextIdx = -1;
        } else if (isFirstNode && cameFromIdx > currentIdx) {
            nextIdx = -1;
        } else if (cameFromIdx > currentIdx) {
            if (prevIdx >= 0) {
                nextIdx = prevIdx;
            } else {
                nextIdx = -1;
            }
        } else if (cameFromIdx < currentIdx) {
            if (postIdx < route.points.length) {
                nextIdx = postIdx;
            } else {
                nextIdx = -1;
            }
        } else {
            if (postIdx < route.points.length) {
                nextIdx = postIdx;
            } else if (prevIdx >= 0) {
                nextIdx = prevIdx;
            } else {
                nextIdx = -1;
            }
        }

        if (nextIdx < 0 || nextIdx >= route.points.length || nextIdx === currentIdx) {
            let heading;
            let moveDx = 0, moveDy = 0;
            if (cameFromIdx >= 0 && cameFromIdx < route.points.length) {
                const pFrom = route.points[cameFromIdx];
                const dx = currentX - pFrom.x;
                const dy = currentY - pFrom.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > 0.001) {
                    moveDx = dx / dist;
                    moveDy = dy / dist;
                    heading = Math.atan2(dx, -dy) * 180 / Math.PI;
                } else {
                    heading = ac.heading || 90;
                    const headRad = (heading - 90) * Math.PI / 180;
                    moveDx = Math.cos(headRad);
                    moveDy = -Math.sin(headRad);
                }
            } else {
                heading = ac.heading || 90;
                const headRad = (heading - 90) * Math.PI / 180;
                moveDx = Math.cos(headRad);
                moveDy = -Math.sin(headRad);
            }
            if (heading < 0) heading += 360;
            return { visible: true, x: currentX + moveDx * remainingDist, y: currentY + moveDy * remainingDist, heading };
        }
    }

    if (remainingDist > 0.001) {
        let heading;
        let moveDx = 0, moveDy = 0;
        if (cameFromIdx >= 0 && cameFromIdx < route.points.length) {
            const pFrom = route.points[cameFromIdx];
            const dx = currentX - pFrom.x;
            const dy = currentY - pFrom.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 0.001) {
                moveDx = dx / dist;
                moveDy = dy / dist;
                heading = Math.atan2(dx, -dy) * 180 / Math.PI;
            } else {
                heading = ac.heading || 90;
                const headRad = (heading - 90) * Math.PI / 180;
                moveDx = Math.cos(headRad);
                moveDy = -Math.sin(headRad);
            }
        } else {
            heading = ac.heading || 90;
            const headRad = (heading - 90) * Math.PI / 180;
            moveDx = Math.cos(headRad);
            moveDy = -Math.sin(headRad);
        }
        if (heading < 0) heading += 360;
        return { visible: true, x: currentX + moveDx * remainingDist, y: currentY + moveDy * remainingDist, heading };
    }

    const targetPt = route.points[nextIdx] || route.points[0];
    const dx = targetPt.x - currentX, dy = targetPt.y - currentY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const ratio = dist > 0 ? Math.min(1, distanceMoved / dist) : 0;
    const heading = Math.atan2(dx, -dy) * 180 / Math.PI;
    return { visible: true, x: currentX + dx * ratio, y: currentY + dy * ratio, heading: heading < 0 ? heading + 360 : heading };
}

export function updateAircraftPositionsForTime(targetTime) {
    state.aircraft.forEach(ac => {
        const pos = calculateAircraftPositionAtTime(ac, targetTime);
        ac.displayX = pos.x;
        ac.displayY = pos.y;
        ac.displayHeading = pos.heading;
        ac._visible = pos.visible;
    });
}

export function updateTrails(dt) {
    state.aircraft.forEach(ac => {
        if (state.time < (ac.startTime || 0)) return;
        if (!ac.trail) ac.trail = [];

        const x = ac.displayX !== undefined ? ac.displayX : ac.x;
        const y = ac.displayY !== undefined ? ac.displayY : ac.y;

        if (ac.trail.length === 0 ||
            Math.sqrt((x - ac.trail[ac.trail.length - 1].x) ** 2 + (y - ac.trail[ac.trail.length - 1].y) ** 2) > 2) {
            ac.trail.push({ x, y });
        }

        const maxTrail = 30;
        if (ac.trail.length > maxTrail) ac.trail.shift();
    });
}

export function isAircraftInConflictAt(x, y, altitude, acId) {
    const thresholdPx = kmToPx(state.defaults.minSeparationNm);
    const altThreshold = 300;
    for (const other of state.aircraft) {
        if (other.id === acId) continue;
        if (state.time < (other.startTime || 0)) continue;
        if (Math.abs(other.altitude - altitude) > altThreshold) continue;
        const ox = other.displayX !== undefined ? other.displayX : other.x;
        const oy = other.displayY !== undefined ? other.displayY : other.y;
        const dx = ox - x, dy = oy - y;
        if (Math.sqrt(dx * dx + dy * dy) < thresholdPx) return true;
    }
    return false;
}

export function isAircraftInConflict(ac) {
    const x = ac.displayX !== undefined ? ac.displayX : ac.x;
    const y = ac.displayY !== undefined ? ac.displayY : ac.y;
    return isAircraftInConflictAt(x, y, ac.altitude, ac.id);
}

export function getWaypointInfoForAircraft(ac) {
    if (!ac.routeId) return null;
    const route = state.routes.find(r => r.id === ac.routeId);
    if (!route || route.points.length < 2) return null;

    let totalLen = 0, segLengths = [];
    for (let i = 1; i < route.points.length; i++) {
        const dx = route.points[i].x - route.points[i - 1].x;
        const dy = route.points[i].y - route.points[i - 1].y;
        segLengths.push(Math.sqrt(dx * dx + dy * dy));
        totalLen += segLengths[segLengths.length - 1];
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
    const distKm = pxToKm(minDist);

    return {
        nextPointName: ptName,
        nextPointIdx: nearestIdx + 1,
        totalPoints: route.points.length,
        distance: Math.round(distKm)
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
    const speedKmPerSec = ((ac.speed || state.defaults.speed) * 0.00051444) * 1.852;
    const timeSec = distKm / speedKmPerSec;

    return {
        x: pt.x, y: pt.y,
        timeToReach: Math.round(timeSec),
        distance: Math.round(distKm)
    };
}
